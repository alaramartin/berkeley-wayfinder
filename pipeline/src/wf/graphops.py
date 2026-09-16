"""Operations on the proposal graph (rectified-image pixels): projection, edge splitting, door placement."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Projection:
    edge_index: int
    point: tuple[float, float]
    t: float  # fraction of the edge polyline's length, from a to b
    distance: float
    side: str  # "left" | "right" of the edge walking a -> b, in y-up (world) orientation


def polyline_length(pts: np.ndarray) -> float:
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum()) if len(pts) > 1 else 0.0


def project(edges: list[dict], p: tuple[float, float]) -> Projection | None:
    best: Projection | None = None
    q = np.array(p, float)
    for ei, e in enumerate(edges):
        pts = np.array(e["polyline"], float)
        seg_lens = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        total = seg_lens.sum()
        if total == 0:
            continue
        walked = 0.0
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            d = b - a
            L2 = float(d @ d)
            u = 0.0 if L2 == 0 else float(np.clip((q - a) @ d / L2, 0, 1))
            c = a + u * d
            dist = float(np.linalg.norm(q - c))
            if best is None or dist < best.distance:
                # Image y points down; world y points up. Flip y so "left" means left when viewed on a map.
                cross = d[0] * (-(q[1] - c[1])) - (-d[1]) * (q[0] - c[0])
                best = Projection(ei, (float(c[0]), float(c[1])), float((walked + u * seg_lens[i]) / total), dist, "left" if cross > 0 else "right")
            walked += seg_lens[i]
    return best


def split_edge(nodes: list[dict], edges: list[dict], proj: Projection, new_node: dict, snap: float) -> str:
    """Insert new_node at the projection, splitting the edge. Reuses an endpoint within `snap` px instead."""
    e = edges[proj.edge_index]
    by_id = {n["id"]: n for n in nodes}
    for end in (e["a"], e["b"]):
        n = by_id[end]
        if np.hypot(n["x"] - proj.point[0], n["y"] - proj.point[1]) <= snap:
            return end
    pts = np.array(e["polyline"], float)
    seg_lens = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    target = proj.t * seg_lens.sum()
    walked = 0.0
    cut = len(pts) - 1
    for i, L in enumerate(seg_lens):
        if walked + L >= target:
            cut = i + 1
            break
        walked += L
    first = [p.tolist() for p in pts[:cut]] + [list(proj.point)]
    second = [list(proj.point)] + [p.tolist() for p in pts[cut:]]
    new_node = {**new_node, "x": proj.point[0], "y": proj.point[1]}
    nodes.append(new_node)
    base = e["id"]
    edges[proj.edge_index] = {**e, "id": f"{base}a", "b": new_node["id"], "polyline": first}
    edges.append({**e, "id": f"{base}b", "a": new_node["id"], "polyline": second})
    return new_node["id"]


def door_point(polygon: np.ndarray, corridor: np.ndarray, offset: tuple[int, int], reach: float) -> tuple[tuple[float, float], float]:
    """Midpoint of the longest stretch of room wall that faces corridor pixels within `reach`. Returns (point, confidence)."""
    px, py = offset
    h, w = corridor.shape
    boundary = []
    for i in range(len(polygon)):
        a, b = polygon[i], polygon[(i + 1) % len(polygon)]
        n = max(2, int(np.linalg.norm(b - a) / 4))
        for u in np.linspace(0, 1, n, endpoint=False):
            boundary.append(a + u * (b - a))
    boundary = np.array(boundary)
    centroid = polygon.mean(axis=0)
    faces = np.zeros(len(boundary), bool)
    for i, p in enumerate(boundary):
        outward = p - centroid
        norm = np.linalg.norm(outward)
        if norm == 0:
            continue
        direction = outward / norm
        for step in np.linspace(2, reach, 6):
            x, y = int(p[0] + direction[0] * step - px), int(p[1] + direction[1] * step - py)
            if 0 <= x < w and 0 <= y < h and corridor[y, x] > 0:
                faces[i] = True
                break
    if not faces.any():
        return (float(centroid[0]), float(centroid[1])), 0.2
    # Longest circular run of facing samples.
    best_len, best_start, run, start = 0, 0, 0, 0
    doubled = np.concatenate([faces, faces])
    for i, f in enumerate(doubled):
        if f:
            if run == 0:
                start = i
            run += 1
            if run > best_len and run <= len(faces):
                best_len, best_start = run, start
        else:
            run = 0
    mid = boundary[(best_start + best_len // 2) % len(boundary)]
    return (float(mid[0]), float(mid[1])), 0.5
