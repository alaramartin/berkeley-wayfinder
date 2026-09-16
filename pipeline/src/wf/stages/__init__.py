"""Stage registry. Stages run in STAGE_ORDER; each reads prior outputs from the level work dir and writes its own."""

from __future__ import annotations

from collections.abc import Callable

from wf.context import StageContext

Stage = Callable[[StageContext], None]

STAGE_ORDER = ["ingest", "rectify", "crop", "classify", "regions", "graph", "ocr", "icons", "connect", "emit"]
_REGISTRY: dict[str, Stage] = {}


def stage(name: str) -> Callable[[Stage], Stage]:
    if name not in STAGE_ORDER:
        raise ValueError(f"unknown stage {name!r}")

    def register(fn: Stage) -> Stage:
        _REGISTRY[name] = fn
        return fn

    return register


def get(name: str) -> Stage | None:
    return _REGISTRY.get(name)


def select(from_stage: str | None, to_stage: str | None) -> list[str]:
    start = STAGE_ORDER.index(from_stage) if from_stage else 0
    end = STAGE_ORDER.index(to_stage) if to_stage else len(STAGE_ORDER) - 1
    if start > end:
        raise ValueError(f"--from-stage {from_stage} comes after --to-stage {to_stage}")
    return STAGE_ORDER[start : end + 1]


# Import stage modules so their @stage decorators register.
from wf.stages import ingest, rectify  # noqa: F401
