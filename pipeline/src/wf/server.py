"""FastAPI service used by the local author tool to re-run stages. Endpoints filled in during M2."""

from __future__ import annotations

from fastapi import FastAPI

from wf import __version__, stages

api = FastAPI(title="wayfinder pipeline", version=__version__)


@api.get("/status")
def status() -> dict[str, object]:
    return {"version": __version__, "stages": {n: stages.get(n) is not None for n in stages.STAGE_ORDER}}
