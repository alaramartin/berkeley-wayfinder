"""Raster -> vector helpers shared by stages."""

from __future__ import annotations

import cv2
import numpy as np


def fill_holes(mask: np.ndarray) -> np.ndarray:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros_like(mask)
    cv2.drawContours(out, contours, -1, 255, thickness=cv2.FILLED)
    return out


def snap_rectilinear(poly: np.ndarray, angle_tol_deg: float = 10.0, passes: int = 2) -> np.ndarray:
    """Make near-horizontal/vertical edges exact. Placards are drawn axis-aligned after rectification."""
    p = poly.astype(np.float64).copy()
    n = len(p)
    tol = np.tan(np.radians(angle_tol_deg))
    for _ in range(passes):
        for i in range(n):
            j = (i + 1) % n
            dx, dy = p[j] - p[i]
            if abs(dx) > 1e-9 and abs(dy / dx) < tol:
                p[i, 1] = p[j, 1] = (p[i, 1] + p[j, 1]) / 2
            elif abs(dy) > 1e-9 and abs(dx / dy) < tol:
                p[i, 0] = p[j, 0] = (p[i, 0] + p[j, 0]) / 2
    # Drop consecutive duplicates / collinear points created by snapping.
    keep = []
    for i in range(n):
        a, b, c = p[i - 1], p[i], p[(i + 1) % n]
        if np.linalg.norm(b - a) < 1.0:
            continue
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if abs(cross) < 1e-6 * max(1.0, np.linalg.norm(b - a) * np.linalg.norm(c - b)):
            continue
        keep.append(b)
    return np.array(keep) if len(keep) >= 3 else p


def mask_to_polygons(mask: np.ndarray, min_area: float, epsilon: float, offset: tuple[int, int] = (0, 0)) -> list[np.ndarray]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    polys = []
    for c in contours:
        if cv2.contourArea(c) < min_area:
            continue
        approx = cv2.approxPolyDP(c, epsilon, True).reshape(-1, 2)
        if len(approx) < 3:
            continue
        snapped = snap_rectilinear(approx)
        polys.append(snapped + np.array(offset, np.float64))
    return polys
