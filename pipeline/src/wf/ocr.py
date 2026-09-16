"""EasyOCR wrapper with an on-disk cache so re-running later stages doesn't re-OCR unchanged crops."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from functools import cache
from pathlib import Path
from typing import Any

import numpy as np


@dataclass
class TextBox:
    text: str
    confidence: float
    x: float  # left
    y: float  # top
    w: float
    h: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2


@cache
def _reader() -> Any:
    import warnings

    import easyocr
    import torch

    warnings.filterwarnings("ignore", module="torch")
    return easyocr.Reader(["en"], gpu=torch.backends.mps.is_available() or torch.cuda.is_available(), verbose=False)


def read_text(rgb: np.ndarray, cache_dir: Path, name: str, **params: Any) -> list[TextBox]:
    """OCR an image; results are cached in cache_dir/ocr-<name>.json keyed by image content + params."""
    key = hashlib.sha1(rgb.tobytes() + json.dumps(params, sort_keys=True).encode() + str(rgb.shape).encode()).hexdigest()
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"ocr-{name}.json"
    if path.exists():
        cached = json.loads(path.read_text())
        if cached.get("key") == key:
            return [TextBox(**b) for b in cached["boxes"]]
    boxes = []
    for quad, text, conf in _reader().readtext(rgb, **params):
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        boxes.append(TextBox(str(text), float(conf), float(min(xs)), float(min(ys)), float(max(xs) - min(xs)), float(max(ys) - min(ys))))
    path.write_text(json.dumps({"key": key, "params": params, "boxes": [asdict(b) for b in boxes]}, indent=1))
    return boxes
