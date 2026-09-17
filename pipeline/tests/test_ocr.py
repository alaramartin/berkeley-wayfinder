import pytest

from wf.ocr import TextBox
from wf.score import score_building
from wf.stages.ocr import normalize_number, parse_directory


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("M2O", "M20"), ("150A", "150A"), ("1O4", "104"), ("22B", "22B"), (" 31a", "31A"), ("B12", "B12"), ("4I2", "412")],
)
def test_normalize_number(raw, expected):
    assert normalize_number(raw) == expected


def test_parse_directory_pairs_rows():
    boxes = [
        TextBox("LEVEL 3", 0.99, 0, 0, 80, 20),
        TextBox("English Dept. Main Office", 0.9, 0, 30, 200, 14),
        TextBox("322", 0.95, 260, 29, 30, 15),
        TextBox("Maude Fife Seminar Room", 0.8, 0, 60, 190, 14),
        TextBox("315", 0.99, 260, 61, 30, 15),
    ]
    parsed = parse_directory(boxes)
    assert all(len(d["box"]) == 4 for d in parsed)
    pairs = {(d["name"], d["room"]) for d in parsed}
    assert pairs == {("English Dept. Main Office", "322"), ("Maude Fife Seminar Room", "315")}


def test_wheeler_room_number_scores():
    """Regression gate on real outputs. Run `uv run wf run wheeler` first; skipped when outputs are absent (CI)."""
    scores = score_building("wheeler")
    if not scores:
        pytest.skip("no pipeline outputs; run `uv run wf run wheeler`")
    total_gold = sum(s.gold for s in scores)
    total_accepted = sum(s.accepted_correct for s in scores)
    for s in scores:
        assert not s.accepted_wrong, f"{s.level} accepted wrong numbers {s.accepted_wrong}"
        assert not s.duplicates, f"{s.level} duplicate numbers {s.duplicates}"
        assert s.any_recall >= 0.85, f"{s.level} found only {s.any_recall:.0%}"
    assert total_accepted / total_gold >= 0.9
