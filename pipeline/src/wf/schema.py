"""Validate pipeline outputs against JSON Schema generated from packages/schema (the single source of truth)."""

from __future__ import annotations

import json
from functools import cache
from typing import Any

from jsonschema import Draft202012Validator

from wf.paths import SCHEMA_DIR


@cache
def _validator(name: str) -> Draft202012Validator:
    path = SCHEMA_DIR / f"{name}.json"
    if not path.exists():
        raise FileNotFoundError(f"{path} missing; run `pnpm --filter @wf/schema gen:jsonschema`")
    return Draft202012Validator(json.loads(path.read_text()))


def validate(name: str, data: Any) -> None:
    errors = sorted(_validator(name).iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        lines = [f"  {'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}" for e in errors[:10]]
        raise ValueError(f"{name} failed schema validation:\n" + "\n".join(lines))
