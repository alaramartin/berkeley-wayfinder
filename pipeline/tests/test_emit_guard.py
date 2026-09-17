"""emit must never overwrite a proposal that the author tool has edited."""

import json

from wf import stages
from wf.config import load_config
from wf.context import StageContext
from wf.paths import work_dir


def test_emit_writes_auto_file_when_proposal_was_edited(tmp_path, monkeypatch):
    cfg = load_config("wheeler")
    level = cfg.level("M")
    src = work_dir("wheeler", "M")
    if not (src / "connect.json").exists():
        import pytest

        pytest.skip("run `uv run wf run wheeler --level M` first")
    # Run emit against a copy of the work dir so the real files are untouched.
    import shutil

    dst = tmp_path / "work" / "wheeler" / "M"
    shutil.copytree(src, dst)
    monkeypatch.setattr("wf.io.work_dir", lambda b, lv: tmp_path / "work" / b / lv)
    monkeypatch.setattr("wf.io.debug_dir", lambda b, lv: (tmp_path / "work" / b / lv / "debug"))
    edited = json.loads((dst / "proposal.json").read_text())
    edited["editedAt"] = "2026-09-16T12:00:00+00:00"
    edited["rooms"][0]["number"] = "HAND-EDIT"
    (dst / "proposal.json").write_text(json.dumps(edited))

    stages.get("emit")(StageContext(cfg, level))

    assert json.loads((dst / "proposal.json").read_text())["rooms"][0]["number"] == "HAND-EDIT"
    assert (dst / "proposal.auto.json").exists()
