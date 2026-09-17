"""ingest: HEIC/JPEG/PNG -> ingest.png (EXIF orientation applied, long edge capped) + ingest.json (camera focal length)."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pillow_heif
from PIL import Image, ImageOps

from wf.paths import raw_dir
from wf.stages import StageContext, stage

pillow_heif.register_heif_opener()

MAX_LONG_EDGE = 4000
EXIF_IFD = 0x8769
FOCAL_35MM = 41989
FULL_FRAME_DIAGONAL_MM = math.hypot(36, 24)


def load_photo(path: Path, max_long_edge: int = MAX_LONG_EDGE) -> Image.Image:
    with Image.open(path) as im:
        img = ImageOps.exif_transpose(im).convert("RGB")
    scale = max_long_edge / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    return img


def focal_length_px(path: Path, size: tuple[int, int]) -> float | None:
    """Focal length in pixels of the (possibly resized) image, from the 35mm-equivalent EXIF tag."""
    with Image.open(path) as im:
        f35 = im.getexif().get_ifd(EXIF_IFD).get(FOCAL_35MM)
    if not f35:
        return None
    return float(f35) / FULL_FRAME_DIAGONAL_MM * math.hypot(*size)


@stage("ingest")
def run(ctx: StageContext) -> None:
    from wf.io import wdir, write_json

    src = raw_dir(ctx.building.id) / ctx.level.photo
    if not src.exists():
        raise FileNotFoundError(f"photo for level {ctx.level.id} not found: {src}")
    img = load_photo(src)
    out = wdir(ctx)
    img.save(out / "ingest.png")
    img.save(out / "ingest.jpg", quality=85)  # display copy for the author tool
    focal = focal_length_px(src, img.size)
    write_json(out / "ingest.json", {"source": src.name, "size": list(img.size), "focalPx": focal})
    arr = np.asarray(img)
    print(f"  ingest: {src.name} -> ingest.png {arr.shape[1]}x{arr.shape[0]} focal={focal and round(focal)}px")
