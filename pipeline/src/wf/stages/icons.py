"""icons: find legend icons on the plan -> icons.json (+ review items for doubtful matches and restroom genders).

Templates are cut from this placard's own legend (the icon left of labels like "Disabled Access"), then
matched on the plan at several scales. Exit signs and the you-are-here star are found by color instead,
since not every legend shows them.
"""

from __future__ import annotations

import cv2
import numpy as np

from wf.context import StageContext
from wf.io import read_json, read_rgb, wdir, write_debug, write_json, write_rgb
from wf.legend import find_swatches
from wf.ocr import read_text
from wf.stages import stage

ICON_LABELS = {
    "accessible": ["disabled access", "accessible"],
    "gender-inclusive-restroom": ["gender inclusive", "all gender"],
    "dwa": ["designated waiting"],
    "evac-chair": ["evacuation chair"],
}
# Legend icons are drawn larger and on different backgrounds than plan icons, so weak correlations are
# mostly window dashes and facade columns. Only strong matches are kept.
ACCEPT = 0.85
REVIEW = 0.78


def legend_templates(legend: np.ndarray, boxes, board_long: int) -> dict[str, np.ndarray]:
    lab = cv2.cvtColor(legend, cv2.COLOR_RGB2LAB).astype(np.float32)
    chroma = np.hypot(lab[..., 1] - 128, lab[..., 2] - 128)
    ink = ((lab[..., 0] < 200) | (chroma > 22)).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(cv2.dilate(ink, np.ones((5, 5), np.uint8)))
    swatches = find_swatches(legend, board_long)
    templates = {}
    for kind, words in ICON_LABELS.items():
        label = next((b for b in boxes if any(w in b.text.lower() for w in words)), None)
        if label is None:
            continue
        best = None
        for i in range(1, n):
            x, y, w, h, _ = (int(v) for v in stats[i])
            if x + w > label.x or label.x - (x + w) > 3 * label.h:
                continue
            if abs((y + h / 2) - label.cy) > 1.5 * max(h, label.h) or h < 0.5 * label.h:
                continue
            if any(abs(sx - x) < 5 and abs(sy - y) < 5 for sx, sy, _, _ in swatches):
                continue
            dist = label.x - (x + w)
            if best is None or dist < best[0]:
                best = (dist, (x, y, w, h))
        if best:
            x, y, w, h = best[1]
            t = legend[y : y + h, x : x + w]
            gray = cv2.cvtColor(t, cv2.COLOR_RGB2GRAY)
            # Near-blank or near-solid crops correlate with everything; skip them.
            if gray.std() > 30 and 0.15 < (gray < 200).mean() < 0.95:
                templates[kind] = t
    return templates


def match_template(plan: np.ndarray, template: np.ndarray, scales: np.ndarray) -> list[tuple[float, int, int, int, int]]:
    """Multi-scale normalized cross-correlation on color. Returns (score, x, y, w, h) after NMS."""
    hits = []
    for s in scales:
        t = cv2.resize(template, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        th, tw = t.shape[:2]
        if th < 10 or tw < 10 or th >= plan.shape[0] or tw >= plan.shape[1]:
            continue
        res = cv2.matchTemplate(plan, t, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.nonzero(res >= REVIEW)
        for y, x in zip(ys, xs, strict=True):
            hits.append((float(res[y, x]), int(x), int(y), tw, th))
    hits.sort(key=lambda h: -h[0])
    kept: list[tuple[float, int, int, int, int]] = []
    for h in hits:
        cx, cy = h[1] + h[3] / 2, h[2] + h[4] / 2
        # Suppress anything centered inside an already-kept box, whatever its scale.
        if not any(k[1] <= cx <= k[1] + k[3] and k[2] <= cy <= k[2] + k[4] for k in kept):
            kept.append(h)
    return kept


def restroom_gender(plan: np.ndarray, poly: np.ndarray) -> tuple[str, float]:
    """Guess from the white figures inside a restroom: a skirt widens the lower body."""
    x, y, w, h = cv2.boundingRect(poly.round().astype(np.int32))
    sub = plan[max(0, y) : y + h, max(0, x) : x + w]
    if sub.size == 0:
        return "all", 0.0
    white = (cv2.cvtColor(sub, cv2.COLOR_RGB2GRAY) > 200).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(white)
    figures = [i for i in range(1, n) if stats[i][3] > 0.35 * h and stats[i][3] > 1.6 * stats[i][2]]
    if not figures:
        return "all", 0.2
    fig = max(figures, key=lambda i: stats[i][3])
    fx, fy, fw, fh, _ = stats[fig]
    m = labels[fy : fy + fh, fx : fx + fw] == fig
    width_at = lambda frac: int(m[int(frac * (fh - 1))].sum())
    torso, skirt = width_at(0.35), max(width_at(0.6), width_at(0.65), width_at(0.7))
    ratio = skirt / max(1, torso)
    return ("women", 0.6) if ratio > 1.15 else ("men", 0.6)


@stage("icons")
def run(ctx: StageContext) -> None:
    out = wdir(ctx)
    rgb = read_rgb(out / "rectified.png")
    crop = read_json(out / "crop.json")
    regions = read_json(out / "regions.json")
    board_long = max(rgb.shape[:2])
    px, py, pw, ph = crop["plan"]
    plan = rgb[py : py + ph, px : px + pw]
    lx, ly, lw, lh = crop["legend"]
    legend = rgb[ly : ly + lh, lx : lx + lw]
    templates = legend_templates(legend, read_text(legend, out, "legend"), board_long)

    icons = []
    review = []
    (out / "review-crops").mkdir(exist_ok=True)
    scales = np.linspace(0.25, 0.8, 12)
    for kind, tmpl in templates.items():
        for score, x, y, w, h in match_template(plan, tmpl, scales):
            icon_id = f"{ctx.building.id}-{ctx.level.id}-i{len(icons):03d}"
            icon = {"id": icon_id, "kind": kind, "at": [px + x + w / 2, py + y + h / 2], "box": [px + x, py + y, w, h], "confidence": round(score, 3)}
            icons.append(icon)
            if score < ACCEPT:
                m = 2 * max(w, h)
                crop_img = plan[max(0, y - m) : y + h + m, max(0, x - m) : x + w + m].copy()
                cv2.rectangle(crop_img, (min(m, x), min(m, y)), (min(m, x) + w, min(m, y) + h), (255, 0, 160), 2)
                rel = f"review-crops/{icon_id}.png"
                write_rgb(out / rel, crop_img)
                review.append({"id": f"{icon_id}-icon", "kind": "icon", "crop": rel, "candidates": [{"value": kind, "confidence": round(score, 3)}], "targetId": icon_id})

    # Exit signs are found by color + shape (not every legend shows them). The you-are-here star is not
    # detected: its magenta is too close to dark purple room fills on some placards.
    unit = (0.004 * board_long) ** 2
    lab_plan = cv2.cvtColor(plan, cv2.COLOR_RGB2LAB).astype(np.float32)
    for kind, color, tol, solidity_range in [
        ("exit", (98.0, 162.0, 158.0), 20.0, (0.2, 0.95)),  # red sign with a white figure
    ]:
        mask = (np.linalg.norm(lab_plan - np.array(color, np.float32), axis=2) < tol).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = cv2.contourArea(c)
            x, y, w, h = cv2.boundingRect(c)
            if not (4 * unit <= w * h <= 60 * unit and 0.7 < w / max(h, 1) < 1.4):
                continue
            hull_area = cv2.contourArea(cv2.convexHull(c))
            solidity = area / hull_area if hull_area else 0
            if not (solidity_range[0] <= solidity <= solidity_range[1]):
                continue
            icons.append({"id": f"{ctx.building.id}-{ctx.level.id}-i{len(icons):03d}", "kind": kind, "at": [px + x + w / 2, py + y + h / 2], "box": [px + x, py + y, w, h], "confidence": 0.7})

    for r in regions["rooms"]:
        if r["category"] != "restroom":
            continue
        poly = np.array(r["polygon"]) - (px, py)
        inclusive = any(
            i["kind"] == "gender-inclusive-restroom" and cv2.pointPolygonTest(poly.astype(np.float32), (i["at"][0] - px, i["at"][1] - py), False) >= 0
            for i in icons
        )
        gender, conf = ("all", 0.75) if inclusive else restroom_gender(plan, poly)
        r_id = f"{r['id']}-gender"
        bx, by, bw, bh = cv2.boundingRect(poly.round().astype(np.int32))
        rel = f"review-crops/{r_id}.png"
        write_rgb(out / rel, plan[max(0, by - 20) : by + bh + 20, max(0, bx - 20) : bx + bw + 20])
        review.append({"id": r_id, "kind": "restroom-gender", "crop": rel, "candidates": [{"value": gender, "confidence": conf}], "targetId": r["id"]})

    write_json(out / "icons.json", {"templates": sorted(templates), "icons": icons, "review": review})

    dbg = plan.copy()
    colors = {"accessible": (0, 90, 255), "gender-inclusive-restroom": (0, 200, 200), "dwa": (120, 0, 200), "evac-chair": (0, 150, 0), "you-are-here": (255, 0, 160), "exit": (230, 0, 0)}
    for i in icons:
        x, y, w, h = (np.array(i["box"]) - (px, py, 0, 0)).round().astype(int)
        cv2.rectangle(dbg, (x, y), (x + w, y + h), colors.get(i["kind"], (0, 0, 0)), 3 if i["confidence"] >= ACCEPT else 1)
        cv2.putText(dbg, f"{i['kind'][:4]} {i['confidence']:.2f}", (x, y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, colors.get(i["kind"], (0, 0, 0)), 1)
    write_debug(ctx, "icons", dbg)
    counts: dict[str, int] = {}
    for i in icons:
        counts[i["kind"]] = counts.get(i["kind"], 0) + 1
    print(f"  icons: templates={sorted(templates)} found={counts} review={len(review)}")
