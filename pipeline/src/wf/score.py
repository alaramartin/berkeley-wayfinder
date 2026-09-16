"""Score pipeline OCR output against data/raw/<building>/golden.yaml."""

from __future__ import annotations

from dataclasses import dataclass

import yaml

from wf.io import read_json_optional
from wf.paths import raw_dir, work_dir


@dataclass
class LevelScore:
    level: str
    gold: int
    accepted_correct: int
    accepted_wrong: list[str]
    duplicates: list[str]
    found_any: int
    missing: list[str]

    @property
    def accepted_recall(self) -> float:
        return self.accepted_correct / self.gold if self.gold else 1.0

    @property
    def any_recall(self) -> float:
        return self.found_any / self.gold if self.gold else 1.0


def score_building(building: str) -> list[LevelScore]:
    path = raw_dir(building) / "golden.yaml"
    golden = yaml.safe_load(path.read_text()) if path.exists() else {}
    scores = []
    for level, spec in golden.items():
        if not isinstance(spec, dict) or "rooms" not in spec:
            continue
        ocr = read_json_optional(work_dir(building, level) / "ocr.json")
        if ocr is None:
            continue
        gold = set(spec["rooms"])
        accepted_list = [e["number"] for r in ocr["rooms"] for e in r["numbers"]]
        accepted = set(accepted_list)
        anywhere = accepted | {e["number"] for r in ocr["rooms"] for e in r["candidates"]} | {e["number"] for e in ocr["orphans"]}
        scores.append(
            LevelScore(
                level=level,
                gold=len(gold),
                accepted_correct=len(accepted & gold),
                accepted_wrong=sorted(accepted - gold),
                duplicates=sorted({n for n in accepted_list if accepted_list.count(n) > 1}),
                found_any=len(anywhere & gold),
                missing=sorted(gold - anywhere),
            )
        )
    return scores
