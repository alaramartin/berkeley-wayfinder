"""graph: corridor mask -> skeleton -> pruned node/edge graph -> graph.json (rectified-board pixels)."""

from __future__ import annotations

import cv2
import numpy as np

from wf.context import StageContext
from wf.io import read_json, read_rgb, wdir, write_debug, write_json
from wf.skeleton import Graph, build_graph, prune, simplify, skeleton_of
from wf.stages import stage


def clean_corridor(mask: np.ndarray, plan_long: int) -> np.ndarray:
    """Fill holes left by text/icons printed in corridors (DWA, stars, dots) and smooth ragged edges."""
    m = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    inv = (m == 0).astype(np.uint8)
    n, comp, stats, _ = cv2.connectedComponentsWithStats(inv)
    max_hole = (0.03 * plan_long) ** 2
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        touches_edge = x == 0 or y == 0 or x + w >= m.shape[1] or y + h >= m.shape[0]
        if area < max_hole and not touches_edge:
            m[comp == i] = 255
    return cv2.GaussianBlur(m, (9, 9), 0) > 127


def drop_small_components(g: Graph, min_length: float) -> int:
    """Remove disconnected fragments whose total corridor length is tiny (facade slivers, notches)."""
    comp: dict[int, int] = {}
    for start in g.nodes:
        if start in comp:
            continue
        stack = [start]
        comp[start] = start
        while stack:
            cur = stack.pop()
            for e in g.edges:
                for a, b in ((e.a, e.b), (e.b, e.a)):
                    if a == cur and b not in comp:
                        comp[b] = start
                        stack.append(b)
    lengths: dict[int, float] = {}
    for e in g.edges:
        lengths[comp[e.a]] = lengths.get(comp[e.a], 0.0) + e.length()
    small = {c for c in set(comp.values()) if lengths.get(c, 0.0) < min_length}
    g.edges = [e for e in g.edges if comp[e.a] not in small]
    for nid in [n for n in g.nodes if comp[n] in small]:
        del g.nodes[nid]
    return len(small)


@stage("graph")
def run(ctx: StageContext) -> None:
    out = wdir(ctx)
    regions = read_json(out / "regions.json")
    px, py, pw, ph = regions["planBox"]
    corridor = cv2.imread(str(out / "corridor.png"), cv2.IMREAD_GRAYSCALE)
    plan_long = max(corridor.shape)

    mask = clean_corridor(corridor, plan_long).astype(np.uint8) * 255
    skel = skeleton_of(mask)
    g = build_graph(skel)
    raw_nodes, raw_edges = len(g.nodes), len(g.edges)
    g = prune(g, spur_len=0.045 * plan_long, merge_len=0.012 * plan_long)
    g = simplify(g, epsilon=max(2.0, 0.002 * plan_long))
    dropped = drop_small_components(g, min_length=0.05 * plan_long)

    ids = {}
    order = sorted(g.nodes.values(), key=lambda n: (round(n.y / 20), n.x))
    for i, node in enumerate(order):
        ids[node.id] = f"{ctx.building.id}-{ctx.level.id}-n{i:03d}"
    nodes = [
        {"id": ids[n.id], "x": round(n.x + px, 1), "y": round(n.y + py, 1), "kind": "junction", "confidence": 0.8}
        for n in order
    ]
    edges = []
    for i, e in enumerate(sorted(g.edges, key=lambda e: (ids[e.a], ids[e.b]))):
        edges.append(
            {
                "id": f"{ctx.building.id}-{ctx.level.id}-e{i:03d}",
                "a": ids[e.a],
                "b": ids[e.b],
                "kind": "corridor",
                "polyline": [[round(x + px, 1), round(y + py, 1)] for x, y in e.path],
                "confidence": 0.8,
            }
        )
    components = g.components()
    write_json(out / "graph.json", {"nodes": nodes, "edges": edges, "components": components})

    rgb = read_rgb(out / "rectified.png")[py : py + ph, px : px + pw]
    dbg = (rgb * 0.5 + 120).astype(np.uint8)
    dbg[mask > 0] = (dbg[mask > 0] * 0.6 + np.array([255, 245, 170]) * 0.4).astype(np.uint8)
    for e in g.edges:
        cv2.polylines(dbg, [np.array(e.path).round().astype(np.int32)], False, (220, 30, 30), 4)
    for n in g.nodes.values():
        deg = g.degree(n.id)
        cv2.circle(dbg, (round(n.x), round(n.y)), 9, (30, 30, 220) if deg != 1 else (30, 160, 30), -1)
    write_debug(ctx, "graph", dbg)
    print(
        f"  graph: skeleton {raw_nodes}n/{raw_edges}e -> {len(nodes)} nodes, {len(edges)} edges, "
        f"{components} component(s), dropped {dropped} fragment(s)"
    )
