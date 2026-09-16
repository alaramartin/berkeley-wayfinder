"""Load and validate data/raw/<building>/config.yaml against the generated JSON Schema."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import yaml

from wf.paths import raw_dir
from wf.schema import validate


@dataclass(frozen=True)
class LevelConfig:
    id: str
    display_name: str
    sort_index: int
    photo: str
    verified: bool


@dataclass(frozen=True)
class BuildingConfig:
    id: str
    name: str
    default_floor_height_m: float
    riser_height_m: float
    levels: list[LevelConfig]
    category_rules: list[dict[str, str]]
    raw: dict[str, Any]

    def level(self, level_id: str) -> LevelConfig:
        for lv in self.levels:
            if lv.id == level_id:
                return lv
        known = ", ".join(lv.id for lv in self.levels)
        raise KeyError(f"level {level_id!r} not in {self.id} config (known: {known})")


def load_config(building: str) -> BuildingConfig:
    path = raw_dir(building) / "config.yaml"
    if not path.exists():
        raise FileNotFoundError(f"missing {path}")
    data = yaml.safe_load(path.read_text())
    validate("building-config", data)
    return BuildingConfig(
        id=data["id"],
        name=data["name"],
        default_floor_height_m=data.get("defaultFloorHeightM", 4.5),
        riser_height_m=data.get("riserHeightM", 0.17),
        levels=[
            LevelConfig(
                id=lv["id"],
                display_name=lv["displayName"],
                sort_index=lv["sortIndex"],
                photo=lv["photo"],
                verified=lv.get("verified", True),
            )
            for lv in sorted(data["levels"], key=lambda lv: lv["sortIndex"])
        ],
        category_rules=data.get("categoryRules", []),
        raw=data,
    )
