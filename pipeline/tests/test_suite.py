"""split_region: two rooms drawn inside one color blob, joined by a doorway gap."""

import numpy as np

from wf.suite import split_region

WALL = 3


def _labels() -> np.ndarray:
    # 200x200 plan: color everywhere, a horizontal wall at y=100 with a doorway gap at x=90..110.
    labels = np.zeros((200, 200), np.uint8)
    labels[98:103, :] = WALL
    labels[98:103, 90:110] = 0
    return labels


def test_splits_along_the_printed_wall() -> None:
    poly = [[10, 10], [190, 10], [190, 190], [10, 190]]
    pieces = split_region(_labels(), WALL, poly, [(100.0, 50.0), (100.0, 150.0)])
    assert len(pieces) == 2
    top, bottom = (np.array(p) for p in pieces)
    # Each piece stays on its own side of the wall, and neither leaks through the doorway.
    assert top[:, 1].max() < 115
    assert bottom[:, 1].min() > 85
    assert top[:, 1].min() < 20 and bottom[:, 1].max() > 180


def test_seed_printed_on_a_wall_still_gets_a_piece() -> None:
    poly = [[10, 10], [190, 10], [190, 190], [10, 190]]
    pieces = split_region(_labels(), WALL, poly, [(100.0, 100.0), (100.0, 150.0)])
    assert all(len(p) >= 3 for p in pieces)
