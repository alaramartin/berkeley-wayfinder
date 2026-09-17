"""Local FastAPI service for the author tool: re-run pipeline stages after overrides change.

Runs are synchronous and serialized (one at a time); a level takes seconds to a minute with the OCR cache.
"""

from __future__ import annotations

import io
import threading
from contextlib import redirect_stdout

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from wf import __version__, stages
from wf.config import load_config
from wf.context import StageContext

api = FastAPI(title="wayfinder pipeline", version=__version__)
_lock = threading.Lock()


class RunRequest(BaseModel):
    building: str
    level: str
    fromStage: str | None = None
    toStage: str | None = None


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
