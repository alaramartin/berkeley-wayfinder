"""Skeleton -> graph: junctions/endpoints become nodes, pixel paths between them become edges."""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np
from skimage.morphology import skeletonize

OFFSETS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


@dataclass
class GNode:
    id: int
    x: float
    y: float
    pixels: list[tuple[int, int]] = field(default_factory=list)


@dataclass
class GEdge:
    a: int
    b: int
    path: list[tuple[float, float]]  # (x, y) from a to b

    def length(self) -> float:
        p = np.array(self.path)
        return float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum()) if len(p) > 1 else 0.0


@dataclass
class Graph:
    nodes: dict[int, GNode]
    edges: list[GEdge]

    def degree(self, nid: int) -> int:
        return sum((e.a == nid) + (e.b == nid) for e in self.edges)

    def components(self) -> int:
        parent = {n: n for n in self.nodes}

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for e in self.edges:
            parent[find(e.a)] = find(e.b)
        return len({find(n) for n in self.nodes})


def skeleton_of(mask: np.ndarray) -> np.ndarray:
    return skeletonize(mask > 0).astype(np.uint8)


def build_graph(skel: np.ndarray) -> Graph:
    ys, xs = np.nonzero(skel)
    on = set(zip(ys.tolist(), xs.tolist(), strict=True))
    skel_f = skel.astype(np.float32)
    nbr_count = np.rint(cv2.filter2D(skel_f, -1, np.ones((3, 3), np.float32), borderType=cv2.BORDER_CONSTANT) - skel_f)

    node_px = skel.copy()
    node_px[(nbr_count == 2)] = 0
    node_px[skel == 0] = 0
    n, comp = cv2.connectedComponents(node_px, connectivity=8)
    nodes: dict[int, GNode] = {}
    owner: dict[tuple[int, int], int] = {}
    for i in range(1, n):
        py, px_ = np.nonzero(comp == i)
        pixels = list(zip(py.tolist(), px_.tolist(), strict=True))
        nodes[i] = GNode(i, float(px_.mean()), float(py.mean()), pixels)
        for p in pixels:
            owner[p] = i

    def neighbors(p: tuple[int, int]) -> list[tuple[int, int]]:
        y, x = p
        return [(y + dy, x + dx) for dy, dx in OFFSETS if (y + dy, x + dx) in on]

    edges: list[GEdge] = []
    visited: set[tuple[int, int]] = set()
    for nid, node in nodes.items():
        for start in node.pixels:
            for nb in neighbors(start):
                if nb in owner or nb in visited:
                    if nb in owner and owner[nb] != nid and nid < owner[nb]:
                        # Two node clusters directly adjacent.
                        edges.append(GEdge(nid, owner[nb], [(node.x, node.y), (nodes[owner[nb]].x, nodes[owner[nb]].y)]))
                    continue
                path = [start, nb]
                visited.add(nb)
                prev, cur = start, nb
                end = None
                while True:
                    nxt = [q for q in neighbors(cur) if q != prev and q not in path[-3:]]
                    owned = [q for q in nxt if q in owner and not (owner[q] == nid and len(path) < 3)]
                    if owned:
                        end = owner[owned[0]]
                        path.append(owned[0])
                        break
                    nxt = [q for q in nxt if q not in visited]
                    if not nxt:
                        break
                    prev, cur = cur, nxt[0]
                    visited.add(cur)
                    path.append(cur)
                if end is None:
                    continue
                pts = [(node.x, node.y)] + [(float(x), float(y)) for y, x in path[1:-1]] + [(nodes[end].x, nodes[end].y)]
                edges.append(GEdge(nid, end, pts))

    # Deduplicate edges discovered from both ends.
    seen = set()
    unique = []
    for e in edges:
        key = (min(e.a, e.b), max(e.a, e.b), round(e.length()))
        if key in seen:
            continue
        seen.add(key)
        unique.append(e)
    return Graph(nodes, unique)


def _merge_through(g: Graph, nid: int) -> None:
    """Remove a degree-2 node by joining its two edges."""
    inc = [e for e in g.edges if nid in (e.a, e.b)]
    if len(inc) != 2 or inc[0] is inc[1]:
        return
    e1, e2 = inc
    p1 = e1.path if e1.b == nid else list(reversed(e1.path))
    a = e1.a if e1.b == nid else e1.b
    p2 = e2.path if e2.a == nid else list(reversed(e2.path))
    b = e2.b if e2.a == nid else e2.a
    if a == b:
        return  # would turn a corridor loop into a self-loop; keep the node so cycles stay routable
    g.edges = [e for e in g.edges if e is not e1 and e is not e2]
    g.edges.append(GEdge(a, b, p1 + p2[1:]))
    del g.nodes[nid]


def prune(g: Graph, spur_len: float, merge_len: float) -> Graph:
    changed = True
    while changed:
        changed = False
        # Short dead-end spurs (from corridor bulges, icons, doorway notches).
        for e in list(g.edges):
            if e not in g.edges:
                continue
            da, db = g.degree(e.a), g.degree(e.b)
            if (da == 1) != (db == 1) and e.length() < spur_len:
                leaf = e.a if da == 1 else e.b
                g.edges.remove(e)
                del g.nodes[leaf]
                changed = True
        # Contract very short edges between junctions (wide corridors make ladders of junctions).
        for e in list(g.edges):
            if e not in g.edges or e.a == e.b or e.length() >= merge_len:
                continue
            keep, drop = e.a, e.b
            ka, kb = g.nodes[keep], g.nodes[drop]
            g.nodes[keep] = GNode(keep, (ka.x + kb.x) / 2, (ka.y + kb.y) / 2)
            g.edges.remove(e)
            for other in g.edges:
                if other.a == drop:
                    other.a = keep
                    other.path[0] = (g.nodes[keep].x, g.nodes[keep].y)
                if other.b == drop:
                    other.b = keep
                    other.path[-1] = (g.nodes[keep].x, g.nodes[keep].y)
                if other.a == keep:
                    other.path[0] = (g.nodes[keep].x, g.nodes[keep].y)
                if other.b == keep:
                    other.path[-1] = (g.nodes[keep].x, g.nodes[keep].y)
            del g.nodes[drop]
            changed = True
        # Self-loops that are tiny are artifacts.
        for e in list(g.edges):
            if e.a == e.b and e.length() < 4 * spur_len:
                g.edges.remove(e)
                changed = True
        for nid in list(g.nodes):
            if nid in g.nodes and g.degree(nid) == 2:
                before = len(g.edges)
                _merge_through(g, nid)
                changed = changed or len(g.edges) != before
        for nid in list(g.nodes):
            if g.degree(nid) == 0:
                del g.nodes[nid]
    return g


def simplify(g: Graph, epsilon: float) -> Graph:
    for e in g.edges:
        if len(e.path) > 2:
            arr = np.array(e.path, np.float32).reshape(-1, 1, 2)
            e.path = [tuple(map(float, p)) for p in cv2.approxPolyDP(arr, epsilon, False).reshape(-1, 2)]
    return g
