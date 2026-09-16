"""Read a placard legend: color swatches, their labels, and label -> room category."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from wf.ocr import TextBox

# Checked in order; first case-insensitive substring match wins. Buildings can prepend rules in config.yaml.
DEFAULT_CATEGORY_RULES: list[tuple[str, str]] = [
    ("stair", "stair"),
    ("elevator", "elevator"),
    ("restroom", "restroom"),
    ("lactation", "lactation"),
    ("library", "library"),
    ("auditorium", "auditorium"),
    ("seminar", "seminar"),
    ("computer", "computer-lab"),
    ("classroom", "classroom"),
    ("office", "office"),
    ("department", "office"),
    ("program", "office"),
]


@dataclass
class Swatch:
    x: int
    y: int
    w: int
    h: int
    lab: tuple[float, float, float]  # OpenCV 8-bit LAB
    rgb: tuple[int, int, int]
    label: str | None
    label_confidence: float
    category: str

    def box(self) -> list[int]:
        return [self.x, self.y, self.w, self.h]


def categorize(label: str | None, extra_rules: list[dict[str, str]] | None = None) -> str:
    if not label:
        return "other"
    lower = label.lower()
    rules = [(r["match"].lower(), r["category"]) for r in (extra_rules or [])] + DEFAULT_CATEGORY_RULES
    for match, category in rules:
        if match in lower:
            return category
    return "other"


def find_swatches(rgb: np.ndarray, board_long_edge: int) -> list[tuple[int, int, int, int]]:
    """Filled, uniformly colored squares. Icons (wheelchair, star, DWA) fail the uniformity test."""
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    chroma = np.hypot(lab[..., 1] - 128, lab[..., 2] - 128)
    ink = ((lab[..., 0] < 200) | (chroma > 22)).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(ink)
    lo, hi = 0.012 * board_long_edge, 0.06 * board_long_edge
    found = []
    for i in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[i])
        if not (lo <= w <= hi and lo <= h <= hi and 0.75 <= w / h <= 1.33):
            continue
        if area < 0.85 * w * h:
            continue
        inner = lab[y + h // 4 : y + 3 * h // 4, x + w // 4 : x + 3 * w // 4].reshape(-1, 3)
        if inner.std(axis=0).max() > 10:
            continue
        found.append((x, y, w, h))
    return found


def label_for(sw: tuple[int, int, int, int], boxes: list[TextBox], others: list[tuple[int, int, int, int]]) -> tuple[str | None, float]:
    x, y, w, h = sw
    right = x + w
    # Candidate first line: starts just right of the swatch, vertically overlapping it (labels sit a bit low).
    cands = [b for b in boxes if right - 0.2 * w <= b.x <= right + 1.5 * w and y - 0.4 * h <= b.cy <= y + 1.4 * h]
    if not cands:
        return None, 0.0
    first = min(cands, key=lambda b: (abs(b.cy - (y + h / 2)), b.x))
    lines = [first]
    # Wrapped continuation lines: same left edge, directly below, not beside another swatch.
    for b in sorted(boxes, key=lambda b: b.y):
        if b is first or abs(b.x - first.x) > 0.6 * w:
            continue
        prev = lines[-1]
        same_column = [o for o in others if o != sw and abs(o[0] - x) < 2 * w]
        if 0 < b.y - prev.y < 1.6 * prev.h and not any(abs(o[1] - b.y) < 0.6 * o[3] for o in same_column):
            lines.append(b)
    text = " ".join(b.text.strip() for b in lines)
    conf = float(min(b.confidence for b in lines))
    return text, conf


def read_legend(rgb: np.ndarray, boxes: list[TextBox], board_long_edge: int, extra_rules: list[dict[str, str]] | None = None) -> list[Swatch]:
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    squares = find_swatches(rgb, board_long_edge)
    swatches = []
    for sq in squares:
        x, y, w, h = sq
        inner_lab = lab[y + h // 4 : y + 3 * h // 4, x + w // 4 : x + 3 * w // 4].reshape(-1, 3)
        inner_rgb = rgb[y + h // 4 : y + 3 * h // 4, x + w // 4 : x + 3 * w // 4].reshape(-1, 3)
        label, conf = label_for(sq, boxes, squares)
        med_lab = np.median(inner_lab, axis=0)
        med_rgb = np.median(inner_rgb, axis=0)
        swatches.append(
            Swatch(
                x, y, w, h,
                lab=(float(med_lab[0]), float(med_lab[1]), float(med_lab[2])),
                rgb=(int(med_rgb[0]), int(med_rgb[1]), int(med_rgb[2])),
                label=label,
                label_confidence=conf,
                category=categorize(label, extra_rules),
            )
        )
    return sorted(swatches, key=lambda s: (s.x // max(1, s.w * 4), s.y))
