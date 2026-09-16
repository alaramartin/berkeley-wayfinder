"""Repo-relative locations. Everything the pipeline touches lives under data/."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA = REPO_ROOT / "data"
SCHEMA_DIR = REPO_ROOT / "packages" / "schema" / "schema"


def raw_dir(building: str) -> Path:
    return DATA / "raw" / building


def work_dir(building: str, level: str) -> Path:
    return DATA / "work" / building / level


def debug_dir(building: str, level: str) -> Path:
    d = work_dir(building, level) / "debug"
    d.mkdir(parents=True, exist_ok=True)
    return d
