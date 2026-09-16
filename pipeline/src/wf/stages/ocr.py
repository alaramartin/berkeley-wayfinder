"""ocr: read room numbers inside regions and name/number pairs from a directory panel -> ocr.json + review crops.

Confident numbers (>= NUMBER_CONFIDENCE) are accepted. Everything else becomes a review item with a saved
crop, including colored rooms where no number was read at all.
"""

from __future__ import annotations

import re

import cv2
import numpy as np

from wf.context import StageContext
from wf.io import read_json, read_rgb, wdir, write_debug, write_json, write_rgb
from wf.ocr import TextBox, read_text
from wf.stages import stage

NUMBER_CONFIDENCE = 0.8  # accept above this even without a level pattern
PATTERN_CONFIDENCE = 0.5  # accept above this when the number matches the level's roomPattern
ZOOM_CONFIDENCE = 0.75  # zoomed crops hallucinate more; require more
ALIAS_CONFIDENCE = 0.9
ROOM_NUMBER = re.compile(r"^[A-Z]?\d{1,3}[A-Z]?$")
NEEDS_NUMBER = {"classroom", "computer-lab", "seminar", "library", "office", "lactation", "auditorium", "other"}
# Common OCR confusions inside room numbers.
FIXES = str.maketrans({"O": "0", "I": "1", "L": "1", "S": "5", "Z": "2"})


def normalize_number(text: str) -> str:
    t = re.sub(r"[^0-9A-Za-z]", "", text).upper()
    if len(t) >= 2:
        # Only the digit core gets letter->digit fixes; a leading level letter (B, M) and trailing suffix stay.
        head, core, tail = t[0], t[1:-1], t[-1]
        head = head if head in "BM" or head.isdigit() else head.translate(FIXES)
        core = core.translate(FIXES)
        # Suffix letters on real rooms are A-H; O/I/L/S/Z at the end are misread digits.
        tail = tail.translate(FIXES) if tail in "OILSZ" else tail
        t = head + core + tail
    return t


def point_in(poly: np.ndarray, x: float, y: float) -> bool:
    return cv2.pointPolygonTest(poly.astype(np.float32), (float(x), float(y)), False) >= 0


def parse_directory(boxes: list[TextBox]) -> list[dict]:
    """Rows of '<name> ... <number>' in a directory panel."""
    numbers = [b for b in boxes if ROOM_NUMBER.match(normalize_number(b.text)) and len(b.text.strip()) <= 5]
    names = [b for b in boxes if b not in numbers and re.search(r"[a-z]{3}", b.text) and not b.text.strip().upper().startswith("LEVEL")]
    out = []
    for num in numbers:
        row = [n for n in names if abs(n.cy - num.cy) < 0.7 * max(n.h, num.h) and n.x < num.x]
        if not row:
            continue
        name = max(row, key=lambda n: n.x + n.w)
        out.append(
            {
                "name": re.sub(r"\s+", " ", name.text).strip(" -"),
                "room": normalize_number(num.text),
                "confidence": round(min(name.confidence, num.confidence), 3),
            }
        )
    return out


def save_crop(ctx: StageContext, rgb: np.ndarray, poly: np.ndarray, name: str) -> str:
    x, y, w, h = cv2.boundingRect(poly.round().astype(np.int32))
    m = int(0.25 * max(w, h)) + 20
    crop = rgb[max(0, y - m) : y + h + m, max(0, x - m) : x + w + m].copy()
    cv2.polylines(crop, [(poly - (max(0, x - m), max(0, y - m))).round().astype(np.int32)], True, (255, 0, 160), 2)
    rel = f"review-crops/{name}.png"
    write_rgb(wdir(ctx) / rel, crop)
    return rel


@stage("ocr")
def run(ctx: StageContext) -> None:
    out = wdir(ctx)
    rgb = read_rgb(out / "rectified.png")
    crop = read_json(out / "crop.json")
    regions = read_json(out / "regions.json")
    px, py, pw, ph = crop["plan"]
    plan = rgb[py : py + ph, px : px + pw]
    boxes = read_text(plan, out, "plan", allowlist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", mag_ratio=2.0, text_threshold=0.5, low_text=0.3)

    for old in (out / "review-crops").glob("*.png") if (out / "review-crops").exists() else []:
        old.unlink()

    pattern = re.compile(ctx.level.room_pattern) if ctx.level.room_pattern else None

    def plausible(e: dict) -> bool:
        floor = ZOOM_CONFIDENCE if e.get("pass") == "zoom" else PATTERN_CONFIDENCE
        if pattern is None:
            return e["confidence"] >= max(floor, NUMBER_CONFIDENCE)
        return bool(pattern.match(e["number"])) and e["confidence"] >= floor

    polys = {r["id"]: np.array(r["polygon"]) for r in regions["rooms"]}
    found: dict[str, list[dict]] = {r["id"]: [] for r in regions["rooms"]}
    orphans = []
    for b in boxes:
        text = normalize_number(b.text)
        if not ROOM_NUMBER.match(text):
            continue
        cx, cy = b.cx + px, b.cy + py
        hits = [rid for rid, poly in polys.items() if point_in(poly, cx, cy)]
        entry = {"number": text, "raw": b.text, "confidence": round(b.confidence, 3), "box": [b.x + px, b.y + py, b.w, b.h]}
        if hits:
            # Nested regions: the smallest containing region wins.
            rid = min(hits, key=lambda r: cv2.contourArea(polys[r].astype(np.float32)))
            found[rid].append(entry)
        else:
            orphans.append(entry)

    # Second pass: zoom into rooms that still have no number (small labels, single digits, busy crops).
    plan_area = pw * ph
    for r in regions["rooms"]:
        small_service = r["category"] == "service" and r["area"] < 0.01 * plan_area
        if r["category"] not in NEEDS_NUMBER and not small_service:
            continue
        x, y, w, h = cv2.boundingRect(polys[r["id"]].round().astype(np.int32))
        pad = 6
        sub = rgb[max(0, y - pad) : y + h + pad, max(0, x - pad) : x + w + pad]
        if sub.size == 0:
            continue
        scale = max(2.0, min(4.0, 200 / max(1, min(sub.shape[:2]))))
        zoomed = cv2.resize(sub, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        for b in read_text(zoomed, out / "ocr-zoom", r["id"], allowlist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
            text = normalize_number(b.text)
            if not ROOM_NUMBER.match(text) or b.h > 0.5 * zoomed.shape[0]:
                continue  # a "character" filling the crop is the room outline, not a label
            box = [max(0, x - pad) + b.x / scale, max(0, y - pad) + b.y / scale, b.w / scale, b.h / scale]
            cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
            containing = [rid for rid, poly in polys.items() if point_in(poly, cx, cy)]
            if not containing or min(containing, key=lambda q: cv2.contourArea(polys[q].astype(np.float32))) != r["id"]:
                continue  # belongs to a smaller nested region, which gets its own pass
            overlaps = any(e["box"][0] <= cx <= e["box"][0] + e["box"][2] and e["box"][1] <= cy <= e["box"][1] + e["box"][3] for e in found[r["id"]])
            if overlaps:
                continue
            found[r["id"]].append({"number": text, "raw": b.text, "confidence": round(b.confidence, 3), "box": box, "pass": "zoom"})

    # Both passes often read the same label; keep one entry per number per room (the most confident).
    for rid, entries in found.items():
        by_number: dict[str, dict] = {}
        for e in entries:
            if e["number"] not in by_number or e["confidence"] > by_number[e["number"]]["confidence"]:
                by_number[e["number"]] = e
        found[rid] = list(by_number.values())

    # A number can only belong to one room per level: keep the most confident, send the rest to review.
    best: dict[str, float] = {}
    for entries in found.values():
        for e in entries:
            if plausible(e):
                best[e["number"]] = max(best.get(e["number"], 0.0), e["confidence"])

    claimed: set[str] = set()

    def accept(e: dict) -> bool:
        if not plausible(e) or e["confidence"] < best.get(e["number"], 0.0) or e["number"] in claimed:
            return False
        claimed.add(e["number"])
        return True

    review = []
    rooms = []
    for r in regions["rooms"]:
        numbers = sorted(found[r["id"]], key=lambda e: -e["box"][3] * e["box"][2])
        decisions = [(e, accept(e)) for e in numbers]
        accepted = [e for e, ok in decisions if ok]
        doubtful = [e for e, ok in decisions if not ok]
        rooms.append({"regionId": r["id"], "numbers": accepted, "candidates": doubtful})
        poly = np.array(r["polygon"])
        if doubtful or (not numbers and r["category"] in NEEDS_NUMBER):
            item_id = f"{r['id']}-num"
            review.append(
                {
                    "id": item_id,
                    "kind": "room-number",
                    "crop": save_crop(ctx, rgb, poly, item_id),
                    "candidates": [{"value": e["number"], "confidence": e["confidence"]} for e in doubtful],
                    "targetId": r["id"],
                }
            )

    directory = []
    if crop.get("directory"):
        dx, dy, dw, dh = crop["directory"]
        dir_boxes = read_text(rgb[dy : dy + dh, dx : dx + dw], out, "directory")
        directory = parse_directory(dir_boxes)
        for i, d in enumerate(directory):
            if d["confidence"] < ALIAS_CONFIDENCE:
                review.append(
                    {
                        "id": f"{ctx.building.id}-{ctx.level.id}-alias{i:02d}",
                        "kind": "alias",
                        "crop": "",
                        "candidates": [{"value": f"{d['name']} = {d['room']}", "confidence": d["confidence"]}],
                        "targetId": f"{ctx.building.id}-{ctx.level.id}-directory",
                    }
                )

    write_json(out / "ocr.json", {"rooms": rooms, "orphans": orphans, "directory": directory, "review": review})

    dbg = plan.copy()
    for r in regions["rooms"]:
        cv2.polylines(dbg, [(np.array(r["polygon"]) - (px, py)).round().astype(np.int32)], True, (150, 150, 150), 2)
    for room in rooms:
        for e, color in [(e, (0, 170, 0)) for e in room["numbers"]] + [(e, (240, 140, 0)) for e in room["candidates"]]:
            x, y, w, h = (np.array(e["box"]) - (px, py, 0, 0)).round().astype(int)
            cv2.rectangle(dbg, (x, y), (x + w, y + h), color, 3)
    for e in orphans:
        x, y, w, h = (np.array(e["box"]) - (px, py, 0, 0)).round().astype(int)
        cv2.rectangle(dbg, (x, y), (x + w, y + h), (220, 0, 0), 3)
    for item in review:
        if item["kind"] == "room-number" and not item["candidates"]:
            poly = (polys[item["targetId"]] - (px, py)).round().astype(np.int32)
            cv2.polylines(dbg, [poly], True, (255, 0, 200), 4)
    write_debug(ctx, "ocr", dbg)
    n_numbers = sum(len(r["numbers"]) for r in rooms)
    print(f"  ocr: {n_numbers} numbers accepted, {len(review)} review items, {len(orphans)} orphan numbers, {len(directory)} directory entries")
