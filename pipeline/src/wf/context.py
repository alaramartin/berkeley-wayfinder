"""Per-run context passed to every stage."""

from __future__ import annotations

from dataclasses import dataclass

from wf.config import BuildingConfig, LevelConfig


@dataclass(frozen=True)
class StageContext:
    building: BuildingConfig
    level: LevelConfig
