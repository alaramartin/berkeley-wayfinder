"""classify: label every plan pixel with a color class -> labels.png + classify.json.

Palette = neutral classes (paper, wall, gray service areas) + one class per legend swatch, read from
this placard's own legend. Each pixel goes to the nearest palette color in LAB (lightness down-weighted
because lighting varies more than hue), or "unknown" when nothing is close.
"""

from __future__ import annotations

import cv2
import numpy as np

from wf.context import StageContext
from wf.io import read_json, read_rgb, wdir, write_debug, write_json
from wf.legend import read_legend
from wf.ocr import read_text
from wf.stages import stage

UNKNOWN = 255
MAX_DISTANCE = 26.0
L_WEIGHT = 0.5

# Neutral classes present on every placard. Initial LAB lightness (0-255 OpenCV scale) is refined per plan.
NEUTRALS = [("paper", 250.0), ("gray-light", 175.0), ("gray-dark", 100.0), ("wall", 40.0)]


def refine_neutrals(plan_lab: np.ndarray) -> list[tuple[str, float]]:
    """1-D k-means on lightness of low-chroma pixels, seeded with NEUTRALS."""
    chroma = np.hypot(plan_lab[..., 1] - 128, plan_lab[..., 2] - 128)
    lightness = plan_lab[..., 0][chroma < 8].astype(np.float32)
    if lightness.size < 1000:
        return NEUTRALS
    centers = np.array([c for _, c in NEUTRALS], np.float32)
    sample = lightness[:: max(1, lightness.size // 200_000)]
    for _ in range(15):
        assign = np.argmin(np.abs(sample[:, None] - centers[None]), axis=1)
        for k in range(len(centers)):
            members = sample[assign == k]
            # Keep the seed when a class is (nearly) absent; e.g. no light gray on this placard.
            if members.size > 0.002 * sample.size:
                centers[k] = members.mean()
    return [(name, float(c)) for (name, _), c in zip(NEUTRALS, centers, strict=True)]


def distance_to(lab: np.ndarray, color: np.ndarray) -> np.ndarray:
    d = lab - color[None, None, :]
    return np.sqrt((L_WEIGHT * d[..., 0]) ** 2 + d[..., 1] ** 2 + d[..., 2] ** 2)


@stage("classify")
def run(ctx: StageContext) -> None:
    out = wdir(ctx)
    rgb = read_rgb(out / "rectified.png")
    crop = read_json(out / "crop.json")
    board_long = max(rgb.shape[:2])

    lx, ly, lw, lh = crop["legend"]
    legend_rgb = rgb[ly : ly + lh, lx : lx + lw]
    swatches = read_legend(legend_rgb, read_text(legend_rgb, out, "legend"), board_long, ctx.building.category_rules)

    px, py, pw, ph = crop["plan"]
    plan = rgb[py : py + ph, px : px + pw]
    lab = cv2.cvtColor(plan, cv2.COLOR_RGB2LAB).astype(np.float32)

    classes = []
    for name, lightness in refine_neutrals(lab):
        classes.append({"id": len(classes), "name": name, "kind": "neutral", "lab": [lightness, 128.0, 128.0], "label": None, "category": None})
    for sw in swatches:
        classes.append(
            {
                "id": len(classes),
                "name": f"legend-{len(classes)}",
                "kind": "legend",
                "lab": list(sw.lab),
                "label": sw.label,
                "labelConfidence": sw.label_confidence,
                "category": sw.category,
                "rgb": list(sw.rgb),
                "swatch": [lx + sw.x, ly + sw.y, sw.w, sw.h],
            }
        )

    dists = np.stack([distance_to(lab, np.array(c["lab"], np.float32)) for c in classes], axis=0)
    labels = np.argmin(dists, axis=0).astype(np.uint8)
    labels[np.min(dists, axis=0) > MAX_DISTANCE] = UNKNOWN
    # Anti-aliased edges between colors create thin misclassified fringes; a median pass removes most.
    labels = cv2.medianBlur(labels, 5)
    cv2.imwrite(str(out / "labels.png"), labels)

    counts = np.bincount(labels.ravel(), minlength=256)
    total = labels.size
    for c in classes:
        c["fraction"] = round(float(counts[c["id"]]) / total, 4)
    write_json(
        out / "classify.json",
        {"planBox": crop["plan"], "unknownId": UNKNOWN, "unknownFraction": round(float(counts[UNKNOWN]) / total, 4), "classes": classes},
    )

    # Debug: flat class colors next to the source.
    display = np.zeros((256, 3), np.uint8)
    display[UNKNOWN] = (255, 0, 255)
    for c in classes:
        if c["kind"] == "legend":
            display[c["id"]] = c["rgb"]
        else:
            v = int(np.clip(c["lab"][0] * 100 / 255 * 2.55, 0, 255))
            display[c["id"]] = (v, v, v)
    flat = display[labels]
    write_debug(ctx, "classify", np.hstack([plan, flat]), max_long_edge=2400)
    legend_summary = ", ".join(f"{c['label']}→{c['category']}" for c in classes if c["kind"] == "legend")
    print(f"  classify: {len(swatches)} swatches [{legend_summary}] unknown={counts[UNKNOWN] / total:.1%}")
