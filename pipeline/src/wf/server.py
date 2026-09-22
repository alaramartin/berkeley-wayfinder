"""Local FastAPI service for the author tool: re-run pipeline stages after overrides change.

Runs are synchronous and serialized (one at a time); a level takes seconds to a minute with the OCR cache.
"""

from __future__ import annotations

import io
import threading
from contextlib import redirect_stdout

import cv2
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from wf import __version__, stages
from wf.config import load_config
from wf.context import StageContext
from wf.io import read_json, wdir
from wf.suite import split_region

api = FastAPI(title="wayfinder pipeline", version=__version__)
_lock = threading.Lock()


class RunRequest(BaseModel):
    building: str
    level: str
    fromStage: str | None = None
    toStage: str | None = None


class SuiteSplitRequest(BaseModel):
    building: str
    level: str
    """Region outline and the position of each printed number, in rectified-board pixels."""
    polygon: list[list[float]]
    seeds: list[list[float]]


@api.post("/suite-split")
def suite_split(req: SuiteSplitRequest) -> dict[str, object]:
    """Cut one merged suite along its printed walls; the author tool sends the outline it currently has."""
    if len(req.seeds) < 2 or len(req.polygon) < 3:
        raise HTTPException(status_code=400, detail="need a polygon and at least two seeds")
    try:
        cfg = load_config(req.building)
        ctx = StageContext(cfg, cfg.level(req.level))
        out = wdir(ctx)
        labels = cv2.imread(str(out / "labels.png"), cv2.IMREAD_GRAYSCALE)
        meta = read_json(out / "classify.json")
    except (FileNotFoundError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if labels is None:
        raise HTTPException(status_code=400, detail="run the classify stage for this level first")
    by_name = {c["name"]: c["id"] for c in meta["classes"]}
    px, py = meta["planBox"][0], meta["planBox"][1]
    polygons = split_region(labels, by_name["wall"], req.polygon, [(s[0], s[1]) for s in req.seeds], (px, py))
    return {"polygons": polygons}


@api.get("/status")
def status() -> dict[str, object]:
    return {"version": __version__, "busy": _lock.locked(), "stages": {n: stages.get(n) is not None for n in stages.STAGE_ORDER}}


@api.post("/run")
def run(req: RunRequest) -> dict[str, object]:
    try:
        cfg = load_config(req.building)
        level = cfg.level(req.level)
        names = stages.select(req.fromStage, req.toStage)
    except (FileNotFoundError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    with _lock:
        buf = io.StringIO()
        ctx = StageContext(cfg, level)
        ran: list[str] = []
        try:
            with redirect_stdout(buf):
                for name in names:
                    fn = stages.get(name)
                    if fn is None:
                        break
                    fn(ctx)
                    ran.append(name)
        except Exception as exc:  # noqa: BLE001 -- report stage failures to the UI instead of a 500
            return {"ok": False, "ran": ran, "failedStage": names[len(ran)], "error": str(exc), "log": buf.getvalue()}
        return {"ok": True, "ran": ran, "log": buf.getvalue()}
