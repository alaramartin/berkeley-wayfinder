from PIL import Image

from wf import stages
from wf.config import load_config
from wf.paths import raw_dir
from wf.schema import validate
from wf.stages.ingest import load_photo


def test_wheeler_config_loads_in_sort_order():
    cfg = load_config("wheeler")
    assert [lv.id for lv in cfg.levels] == ["B", "M", "L1", "L2", "L3", "L4"]
    assert cfg.level("M").verified is False


def test_stage_selection():
    assert stages.select("classify", "graph") == ["classify", "regions", "graph"]
    assert stages.select(None, "ingest") == ["ingest"]


def test_schema_rejects_bad_proposal():
    import pytest

    with pytest.raises(ValueError):
        validate("proposal", {"buildingId": "wheeler"})


def test_ingest_reads_sample_heic():
    img = load_photo(raw_dir("wheeler") / "wheeler-L1.heic", max_long_edge=1000)
    assert isinstance(img, Image.Image)
    assert max(img.size) == 1000
    # Sample was shot in portrait; EXIF orientation must be applied.
    assert img.height > img.width
