"""emit: assemble and validate proposal.json + review-queue.json, and draw debug/summary.png."""

from __future__ import annotations

from datetime import UTC, datetime

import cv2
import numpy as np

from wf import __version__
from wf.context import StageContext
from wf.io import read_json, read_rgb, wdir, write_debug, write_json
from wf.schema import validate
from wf.stages import stage

ALIAS_CONFIDENCE = 0.9


def _pt(p: list[float]) -> list[float]:
    return [round(float(p[0]), 1), round(float(p[1]), 1)]


@stage("emit")
def run(ctx: StageContext) -> None:
    out = wdir(ctx)
    rectify = read_json(out / "rectify.json")
    regions = read_json(out / "regions.json")
    ocr = read_json(out / "ocr.json")
    icons = read_json(out / "icons.json")
    conn = read_json(out / "connect.json")

    directory = ocr["directory"]
    aliases: dict[str, list[str]] = {}
    for d in directory:
        if d["confidence"] >= ALIAS_CONFIDENCE:
            aliases.setdefault(d["room"], []).append(d["name"])

    proposal = {
        "buildingId": ctx.building.id,
        "levelId": ctx.level.id,
        "imageSize": rectify["size"],
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "pipelineVersion": __version__,
        "outline": [_pt(p) for p in regions["outline"]],
        "voids": [[_pt(p) for p in v] for v in regions["voids"]],
        "nodes": [{"id": n["id"], "x": round(n["x"], 1), "y": round(n["y"], 1), "kind": n["kind"], "confidence": n["confidence"]} for n in conn["nodes"]],
        "edges": [
            {"id": e["id"], "a": e["a"], "b": e["b"], "kind": e["kind"], "polyline": [_pt(p) for p in e["polyline"]], "confidence": e["confidence"]}
            for e in conn["edges"]
        ],
        "rooms": [
            {
                "id": r["id"],
                "number": r["number"],
                "numberConfidence": r["numberConfidence"],
                "category": r["category"],
                "group": r["group"],
                "polygon": [_pt(p) for p in r["polygon"]],
                "doors": [{k: d[k] for k in ("edgeId", "t", "side", "confidence")} for d in r["doors"]],
                "aliases": aliases.get(r["number"] or "", []),
            }
            for r in conn["rooms"]
        ],
        "icons": [{"id": i["id"], "kind": i["kind"], "at": _pt(i["at"]), "confidence": i["confidence"]} for i in icons["icons"]],
        "entrances": [
            {"id": e["id"], "nodeId": e["nodeId"], "accessible": e["accessible"], "evidence": e["evidence"], "confidence": round(e["confidence"], 2)}
            for e in conn["entrances"]
        ],
        "directory": directory,
    }
    validate("proposal", proposal)
    write_json(out / "proposal.json", proposal)

    queue = {"buildingId": ctx.building.id, "levelId": ctx.level.id, "items": ocr["review"] + icons["review"]}
    validate("review-queue", queue)
    write_json(out / "review-queue.json", queue)

    rgb = read_rgb(out / "rectified.png")
    px, py, pw, ph = regions["planBox"]
    dbg = (rgb * 0.55 + 110).astype(np.uint8)
    o = (0, 0)

    def pts(poly: list) -> np.ndarray:
        return (np.array(poly) - o).round().astype(np.int32)

    cv2.polylines(dbg, [pts(proposal["outline"])], True, (200, 0, 0), 4)
    for v in proposal["voids"]:
        cv2.polylines(dbg, [pts(v)], True, (0, 170, 220), 3)
    for r in proposal["rooms"]:
        color = (0, 150, 0) if r["number"] else (255, 0, 200)
        cv2.polylines(dbg, [pts(r["polygon"])], True, color, 2)
    for e in proposal["edges"]:
        cv2.polylines(dbg, [pts(e["polyline"])], False, (220, 40, 40), 4)
    node_colors = {"junction": (40, 40, 220), "stair": (0, 160, 0), "elevator": (240, 140, 0), "entrance": (230, 0, 160)}
    for n in proposal["nodes"]:
        cv2.circle(dbg, (round(n["x"]), round(n["y"])), 9 if n["kind"] != "junction" else 6, node_colors.get(n["kind"], (0, 0, 0)), -1)
    for r in conn["rooms"]:
        for d in r["doors"]:
            cv2.circle(dbg, (round(d["at"][0]), round(d["at"][1])), 7, (255, 200, 0) if d["confidence"] >= 0.5 else (255, 0, 0), -1)
        if r["number"] and r["suitePrimary"]:
            poly = np.array(r["polygon"])
            c = poly.mean(axis=0)
            cv2.putText(dbg, r["number"], (int(c[0]) - 20, int(c[1]) + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 90, 0), 2)
    write_debug(ctx, "summary", dbg[max(0, py - 20) : py + ph + 20, max(0, px - 20) : px + pw + 20], max_long_edge=2400)
    print(f"  emit: proposal.json ({len(proposal['rooms'])} rooms, {len(proposal['nodes'])} nodes, {len(proposal['edges'])} edges), review-queue.json ({len(queue['items'])} items)")
