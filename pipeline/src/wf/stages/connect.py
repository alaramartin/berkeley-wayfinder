"""connect: link rooms, stairs, elevators and entrances to the corridor graph -> connect.json.

  - Stairs/elevators: a node at the region centroid, joined to the nearest corridor point (edge split).
  - Entrances: exit/accessible icons near the outline and corridor dead-ends at the facade.
  - Rooms: one per accepted number (suites with several numbers share a polygon); a door on the wall that
    faces a corridor, referenced by edge + t + side. Doors are always unverified guesses.
"""

from __future__ import annotations

import cv2
import numpy as np

from wf.context import StageContext
from wf.graphops import door_point, project, split_edge
from wf.io import read_json, wdir, write_json
from wf.stages import stage

ROOM_CATEGORIES = {"classroom", "computer-lab", "seminar", "library", "office", "lactation", "auditorium", "restroom", "other", "service"}


def outline_distance(outline: np.ndarray, p: tuple[float, float]) -> float:
    return abs(cv2.pointPolygonTest(outline.astype(np.float32), (float(p[0]), float(p[1])), True))


@stage("connect")
def run(ctx: StageContext) -> None:
    out = wdir(ctx)
    graph = read_json(out / "graph.json")
    regions = read_json(out / "regions.json")
    ocr = read_json(out / "ocr.json")
    icons = read_json(out / "icons.json")["icons"]
    px, py, pw, ph = regions["planBox"]
    plan_long = max(pw, ph)
    corridor = cv2.imread(str(out / "corridor.png"), cv2.IMREAD_GRAYSCALE)
    outline = np.array(regions["outline"], float)
    prefix = f"{ctx.building.id}-{ctx.level.id}"
    nodes, edges = graph["nodes"], graph["edges"]
    snap = 0.01 * plan_long
    counter = {"v": 0, "x": 0}

    def new_id(kind: str) -> str:
        counter[kind] += 1
        return f"{prefix}-{kind}{counter[kind]:02d}"

    # Vertical connectors.
    vertical = []
    for r in regions["rooms"]:
        if r["category"] not in ("stair", "elevator") or not edges:
            continue
        poly = np.array(r["polygon"], float)
        m = cv2.moments(poly.astype(np.float32))
        c = (m["m10"] / m["m00"], m["m01"] / m["m00"]) if m["m00"] else tuple(poly.mean(axis=0))
        proj = project(edges, c)
        if proj is None:
            continue
        node_id = new_id("v")
        attach = split_edge(nodes, edges, proj, {"id": f"{node_id}j", "kind": "junction", "confidence": 0.6}, snap)
        nodes.append({"id": node_id, "x": round(c[0], 1), "y": round(c[1], 1), "kind": r["category"], "confidence": 0.7})
        link = {"id": f"{node_id}-link", "a": attach, "b": node_id, "kind": "corridor", "polyline": [list(proj.point), [c[0], c[1]]], "confidence": 0.6}
        edges.append(link)
        vertical.append({"nodeId": node_id, "regionId": r["id"], "kind": r["category"], "distance": round(proj.distance, 1)})

    # Entrance candidates.
    candidates: list[dict] = []
    near = 0.035 * plan_long
    for icon in icons:
        if icon["kind"] in ("exit", "accessible") and outline_distance(outline, icon["at"]) < near:
            candidates.append({"at": icon["at"], "evidence": "exit-icon" if icon["kind"] == "exit" else "accessible-icon", "confidence": icon["confidence"]})
    degree: dict[str, int] = {}
    for e in edges:
        degree[e["a"]] = degree.get(e["a"], 0) + 1
        degree[e["b"]] = degree.get(e["b"], 0) + 1
    for n in nodes:
        if n["kind"] == "junction" and degree.get(n["id"], 0) == 1 and outline_distance(outline, (n["x"], n["y"])) < 0.02 * plan_long:
            candidates.append({"at": [n["x"], n["y"]], "evidence": "corridor-end", "confidence": 0.4})
    entrances = []
    for cand in sorted(candidates, key=lambda c: -c["confidence"]):
        merged = next((e for e in entrances if np.hypot(e["at"][0] - cand["at"][0], e["at"][1] - cand["at"][1]) < 0.05 * plan_long), None)
        if merged:
            merged["evidence"] = sorted(set(merged["evidence"]) | {cand["evidence"]})
            merged["confidence"] = min(0.9, merged["confidence"] + 0.15)
            continue
        entrances.append({"at": cand["at"], "evidence": [cand["evidence"]], "confidence": cand["confidence"]})
    for ent in entrances:
        proj = project(edges, tuple(ent["at"]))
        if proj is None:
            continue
        eid = new_id("x")
        ent["id"] = eid
        ent["nodeId"] = split_edge(nodes, edges, proj, {"id": f"{eid}n", "kind": "entrance", "confidence": ent["confidence"]}, snap)
        for n in nodes:
            if n["id"] == ent["nodeId"]:
                n["kind"] = "entrance"
        ent["accessible"] = "accessible-icon" in ent["evidence"]
    entrances = [e for e in entrances if "nodeId" in e]

    # Rooms and doors (after all splits, so edge ids are final).
    numbers = {r["regionId"]: r for r in ocr["rooms"]}
    rooms = []
    reach = 0.02 * plan_long
    for r in regions["rooms"]:
        if r["category"] not in ROOM_CATEGORIES:
            continue
        found = numbers.get(r["id"], {"numbers": [], "candidates": []})
        accepted = found["numbers"]
        if r["category"] == "service" and not accepted:
            continue  # unlabeled gray areas are not destinations
        poly = np.array(r["polygon"], float)
        doors = []
        if edges:
            point, conf = door_point(poly, corridor, (px, py), reach)
            proj = project(edges, point)
            if proj is not None:
                doors.append({"edgeId": edges[proj.edge_index]["id"], "t": round(proj.t, 4), "side": proj.side, "confidence": round(conf if proj.distance < 3 * reach else 0.2, 2), "at": [round(point[0], 1), round(point[1], 1)]})
        entries = accepted or [{"number": None, "confidence": 0.0}]
        for i, entry in enumerate(entries):
            number = entry["number"]
            rooms.append(
                {
                    "id": f"{prefix}-r{number}" if number else r["id"],
                    "regionId": r["id"],
                    "number": number,
                    "labelAt": [round(entry["box"][0] + entry["box"][2] / 2, 1), round(entry["box"][1] + entry["box"][3] / 2, 1)] if number else None,
                    "numberConfidence": entry["confidence"],
                    "category": r["category"],
                    "group": r["group"],
                    "polygon": r["polygon"],
                    "doors": doors,
                    "suitePrimary": i == 0,
                }
            )

    write_json(out / "connect.json", {"nodes": nodes, "edges": edges, "rooms": rooms, "vertical": vertical, "entrances": entrances})
    doors_ok = sum(1 for r in rooms if r["doors"] and r["doors"][0]["confidence"] >= 0.5)
    print(f"  connect: {len(vertical)} stairs/elevators linked, {len(entrances)} entrance candidates, {len(rooms)} rooms ({doors_ok} doors facing a corridor)")
