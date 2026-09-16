"""Small helpers for reading/writing stage artifacts in a level work dir."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from wf.context import StageContext
from wf.paths import debug_dir, work_dir


def wdir(ctx: StageContext) -> Path:
    d = work_dir(ctx.building.id, ctx.level.id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def read_rgb(path: Path) -> np.ndarray:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise FileNotFoundError(f"{path} missing; run the earlier stages first")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def write_rgb(path: Path, rgb: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))


def read_json(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(f"{path} missing; run the earlier stages first")
    return json.loads(path.read_text())


def read_json_optional(path: Path) -> Any | None:
    return json.loads(path.read_text()) if path.exists() else None


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def write_debug(ctx: StageContext, name: str, rgb: np.ndarray, max_long_edge: int = 2000) -> Path:
    h, w = rgb.shape[:2]
    scale = max_long_edge / max(h, w)
    if scale < 1:
        rgb = cv2.resize(rgb, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    path = debug_dir(ctx.building.id, ctx.level.id) / f"{name}.png"
    write_rgb(path, rgb)
    return path
