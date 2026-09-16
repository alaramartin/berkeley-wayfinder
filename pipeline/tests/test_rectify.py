"""Rectify on a synthetic photo: a known board warped into a wall with a known camera."""

import math

import cv2
import numpy as np

from wf.stages.rectify import aspect_ratio, detect_quad, flatten_lighting


def synthetic_photo(board_w: int = 600, board_h: int = 900, focal: float = 1400.0):
    rng = np.random.default_rng(0)
    board = np.full((board_h, board_w, 3), 245, np.uint8)
    cv2.rectangle(board, (60, 80), (540, 560), (60, 60, 60), 8)  # plan outline
    cv2.rectangle(board, (100, 120), (300, 300), (70, 90, 40), -1)  # a room
    cv2.line(board, (40, 620), (560, 620), (40, 40, 40), 6)  # legend rule
    for i in range(4):
        cv2.rectangle(board, (60, 660 + i * 50), (90, 690 + i * 50), (40 + 50 * i, 150, 80), -1)

    # Place the board on a plane rotated about the vertical axis, then project with a pinhole camera.
    W, H = 1500, 1200
    yaw = math.radians(28)
    rot = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    k = np.array([[focal, 0, W / 2], [0, focal, H / 2], [0, 0, 1]])
    obj = np.array([[-300, -450, 0], [300, -450, 0], [300, 450, 0], [-300, 450, 0]], float)
    cam = (rot @ obj.T).T + np.array([0, 0, 1900.0])
    img_pts = (k @ cam.T).T
    img_pts = (img_pts[:, :2] / img_pts[:, 2:]).astype(np.float32)
    src = np.array([[0, 0], [board_w, 0], [board_w, board_h], [0, board_h]], np.float32)
    hom = cv2.getPerspectiveTransform(src, img_pts)

    wall = np.clip(rng.normal(200, 4, (H, W, 3)), 0, 255).astype(np.uint8)
    wall[..., 2] = np.clip(wall[..., 2].astype(int) - 25, 0, 255)  # beige
    warped = cv2.warpPerspective(board, hom, (W, H))
    mask = cv2.warpPerspective(np.full((board_h, board_w), 255, np.uint8), hom, (W, H))
    photo = np.where(mask[..., None] > 0, warped, wall)
    return photo, img_pts, focal, board_w / board_h


def test_detects_board_and_recovers_aspect():
    photo, truth, focal, true_aspect = synthetic_photo()
    quad = detect_quad(photo, focal)
    err = np.linalg.norm(quad.corners - truth, axis=1)
    assert err.max() < 12, err
    ratio, source = aspect_ratio(quad.corners, (photo.shape[1], photo.shape[0]), focal)
    assert source == "focal"
    assert abs(ratio - true_aspect) / true_aspect < 0.03


def test_flatten_lighting_evens_out_gradient():
    img = np.full((400, 400, 3), 240, np.uint8)
    img = (img * np.linspace(0.6, 1.0, 400)[None, :, None]).astype(np.uint8)
    before = img.mean(axis=(0, 2))
    after = flatten_lighting(img).mean(axis=(0, 2))
    assert before.max() - before.min() > 90
    assert after.max() - after.min() < 30  # 96 -> ~27 on this steep synthetic ramp
