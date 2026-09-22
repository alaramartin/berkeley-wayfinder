"""Cut one merged region into per-number rooms along the walls printed on the placard.

Colored areas merge into a single region wherever the drawn interior walls have doorway gaps, so a
suite arrives as one outline shared by several printed numbers. Given the outline and where each
number is printed, this grows one area per number through the free space between the walls.
"""

from __future__ import annotations

import cv2
import numpy as np
from skimage.segmentation import watershed

from wf.geom import mask_to_polygons

Point = tuple[float, float]


def _nearest_free(free: np.ndarray, at: tuple[int, int]) -> tuple[int, int] | None:
    """The free pixel closest to `at` (numbers are printed over walls and their own glyphs)."""
    ys, xs = np.nonzero(free)
    if len(xs) == 0:
        return None
    i = int(np.argmin((xs - at[0]) ** 2 + (ys - at[1]) ** 2))
    return int(xs[i]), int(ys[i])


def split_region(
    labels: np.ndarray,
    wall_id: int,
    polygon: list[list[float]] | np.ndarray,
    seeds: list[Point],
    offset: tuple[int, int] = (0, 0),
    epsilon: float | None = None,
) -> list[list[list[float]]]:
    """Split `polygon` into one polygon per seed. Coordinates are board pixels; `offset` is the plan box.

    Returns a list parallel to `seeds`; an entry is empty when that seed won a piece too small to keep.
    """
    poly = np.array(polygon, np.float64) - np.array(offset, np.float64)
    region = np.zeros(labels.shape, np.uint8)
    cv2.fillPoly(region, [poly.round().astype(np.int32)], 255)

    # Walls separate; their pixels go back to the rooms afterwards so pieces meet at the wall centre.
    walls = (labels == wall_id) & (region > 0)
    free = (region > 0) & ~walls

    markers = np.zeros(labels.shape, np.int32)
    radius = max(1, int(0.004 * max(labels.shape)))
    for i, (sx, sy) in enumerate(seeds, start=1):
        at = (round(sx - offset[0]), round(sy - offset[1]))
        if not (0 <= at[0] < labels.shape[1] and 0 <= at[1] < labels.shape[0] and free[at[1], at[0]]):
            found = _nearest_free(free, at)
            if found is None:
                continue
            at = found
        cv2.circle(markers, at, radius, i, -1)
    markers[free == 0] = 0
    if markers.max() == 0:
        return [[] for _ in seeds]

    grown = watershed(np.zeros_like(labels, np.uint8), markers, mask=free)
    # Hand the wall pixels back to whichever room reaches them first, so neighbours share the wall.
    filled = grown.copy()
    for _ in range(radius + 2):
        dilated = cv2.dilate(filled.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
        take = (filled == 0) & (region > 0) & (dilated > 0)
        filled[take] = dilated[take]

    min_area = (0.006 * max(labels.shape)) ** 2
    eps = epsilon if epsilon is not None else max(2.0, 0.002 * max(labels.shape))
    out: list[list[list[float]]] = []
    for i in range(1, len(seeds) + 1):
        piece = ((filled == i).astype(np.uint8)) * 255
        piece = cv2.morphologyEx(piece, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
        polys = mask_to_polygons(piece, min_area, eps, offset)
        if not polys:
            out.append([])
            continue
        best = max(polys, key=lambda p: cv2.contourArea(p.astype(np.float32)))
        out.append(best.round(1).tolist())
    return out
