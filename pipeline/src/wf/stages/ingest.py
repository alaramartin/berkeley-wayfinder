"""ingest: HEIC/JPEG/PNG -> ingest.png with EXIF orientation applied and long edge capped."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pillow_heif
from PIL import Image, ImageOps

from wf.paths import raw_dir, work_dir
from wf.stages import StageContext, stage

pillow_heif.register_heif_opener()

MAX_LONG_EDGE = 4000


def load_photo(path: Path, max_long_edge: int = MAX_LONG_EDGE) -> Image.Image:
    with Image.open(path) as im:
        img = ImageOps.exif_transpose(im).convert("RGB")
    scale = max_long_edge / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    return img


@stage("ingest")
def run(ctx: StageContext) -> None:
    src = raw_dir(ctx.building.id) / ctx.level.photo
    if not src.exists():
        raise FileNotFoundError(f"photo for level {ctx.level.id} not found: {src}")
    img = load_photo(src)
    out = work_dir(ctx.building.id, ctx.level.id)
    out.mkdir(parents=True, exist_ok=True)
    img.save(out / "ingest.png")
    arr = np.asarray(img)
    print(f"  ingest: {src.name} -> ingest.png {arr.shape[1]}x{arr.shape[0]}")
