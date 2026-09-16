"""crop: locate the plan, legend and (if present) directory panels on the rectified board -> crop.json.

A crop.json with "source": "manual" (written by the author tool) is kept as-is.

Heuristics (all relative to board size, so they carry across placard templates):
  - "ink" = anything that isn't paper.
  - Rules = long, thin horizontal ink runs (title underline, legend separator).
  - Plan = largest blob of ink (after merging nearby marks) between the title rule and the next rule below.
  - Legend = below the rule under the plan, within that rule's horizontal span.
  - Directory = the area left of the plan when the plan doesn't start near the left edge (Wheeler L1 style).
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from wf.context import StageContext
from wf.io import read_json_optional, read_rgb, wdir, write_debug, write_json
from wf.stages import stage

Box = tuple[int, int, int, int]  # x, y, w, h


@dataclass
class Rule:
    x: int
    y: int
    w: int
    h: int


def ink_mask(rgb: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.int16)
    chroma = np.hypot(lab[..., 1] - 128, lab[..., 2] - 128)
    return ((lab[..., 0] < 200) | (chroma > 22)).astype(np.uint8) * 255


def find_rules(ink: np.ndarray) -> list[Rule]:
    h, w = ink.shape
    long = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (int(0.2 * w), 1)))
    n, _, stats, _ = cv2.connectedComponentsWithStats(long)
    rules = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if bw > 0.2 * w and bh < 0.012 * max(h, w) and area > 0.6 * bw * bh:
            rules.append(Rule(int(x), int(y), int(bw), int(bh)))
    return sorted(rules, key=lambda r: r.y)


def detect(rgb: np.ndarray) -> dict:
    h, w = rgb.shape[:2]
    ink = ink_mask(rgb)
    # Ignore a thin frame (board edge shadow, screws).
    frame = int(0.012 * max(h, w))
    ink[:frame], ink[-frame:], ink[:, :frame], ink[:, -frame:] = 0, 0, 0, 0
    rules = find_rules(ink)

    title = next((r for r in rules if r.y < 0.3 * h), None)
    top = title.y + title.h if title else 0
    below = [r for r in rules if r.y > top + 0.1 * h]

    no_rules = ink.copy()
    for r in rules:
        no_rules[max(0, r.y - 3) : r.y + r.h + 3, r.x : r.x + r.w] = 0
    no_rules[:top] = 0
    k = max(5, int(0.012 * max(h, w)))
    merged = cv2.dilate(no_rules, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(merged)
    candidates = []
    for i in range(1, n):
        x, y, bw, bh, _ = stats[i]
        # Blobs must end above the first rule that starts below them (the legend separator).
        filled = int((no_rules[labels == i] > 0).sum())
        candidates.append((filled, (int(x), int(y), int(bw), int(bh))))
    if not candidates:
        raise RuntimeError("no plan found on board")
    # Rank by ink area but prefer blobs that aren't text lines (text blobs are very wide and short).
    candidates.sort(key=lambda c: -c[0] * min(1.0, 4 * c[1][3] / max(c[1][2], 1)))
    plan = candidates[0][1]
    px, py, pw, ph = plan
    pad = int(0.01 * max(h, w))
    plan = (max(0, px - pad), max(0, py - pad), min(w, px + pw + pad) - max(0, px - pad), min(h, py + ph + pad) - max(0, py - pad))

    under = next((r for r in below if r.y >= py + ph - pad and r.x < px + pw and r.x + r.w > px), None)
    if under:
        legend: Box = (under.x, under.y + under.h, under.w, h - frame - (under.y + under.h))
    else:
        legend = (0, py + ph + pad, w, h - frame - (py + ph + pad))

    directory: Box | None = None
    if px > 0.3 * w:
        directory = (frame, top, px - pad - frame, h - frame - top)

    return {
        "source": "auto",
        "size": [w, h],
        "plan": list(plan),
        "legend": list(legend),
        "directory": list(directory) if directory else None,
        "rules": [[r.x, r.y, r.w, r.h] for r in rules],
    }


@stage("crop")
def run(ctx: StageContext) -> None:
    out = wdir(ctx)
    rgb = read_rgb(out / "rectified.png")
    existing = read_json_optional(out / "crop.json")
    if existing and existing.get("source") == "manual":
        crop = existing
    else:
        crop = detect(rgb)
        write_json(out / "crop.json", crop)

    dbg = rgb.copy()
    t = max(3, rgb.shape[1] // 400)
    for name, color in [("plan", (255, 0, 160)), ("legend", (0, 160, 255)), ("directory", (0, 190, 90))]:
        box = crop.get(name)
        if box:
            x, y, bw, bh = box
            cv2.rectangle(dbg, (x, y), (x + bw, y + bh), color, 2 * t)
            cv2.putText(dbg, name, (x + 10, y + 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5, color, t)
    for x, y, bw, bh in crop.get("rules", []):
        cv2.rectangle(dbg, (x, y), (x + bw, y + bh), (255, 200, 0), t)
    write_debug(ctx, "crop", dbg)
    print(f"  crop: {crop['source']} plan={crop['plan']} legend={crop['legend']} directory={crop['directory']}")
