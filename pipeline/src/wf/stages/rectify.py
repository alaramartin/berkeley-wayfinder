"""rectify: find the placard board, undo perspective, and flatten lighting -> rectified.png + rectify.json.

Board corners come from corners.json when present (author-tool override), else auto-detection:
  1. Long straight lines (Canny + probabilistic Hough, merged when collinear).
  2. Search pairs of near-horizontal and near-vertical lines for the largest quad whose sides are
     well covered by edges. These lines are parallel to the board edges (board edge, title rule or legend
     rule), which is all perspective correction needs, but they may not be the outermost ones.
  3. Aspect ratio from the camera focal length (Zhang & He 2004), falling back to side lengths.
  4. In the provisionally rectified image, grow each side outward while rows/columns still look like
     board (same white as just inside) and stop at a strong straight edge or the end of the photo.
     This recovers legends below a rule and handles boards cut off by the photo frame (Wheeler L4).
  5. Lighting: divide by a smooth estimate of the board white.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass

import cv2
import numpy as np

from wf.context import StageContext
from wf.io import read_json_optional, read_rgb, wdir, write_debug, write_json, write_rgb
from wf.stages import stage

DETECT_LONG_EDGE = 1000
OUTPUT_LONG_EDGE = 3000
VIRTUAL_SIDE_COVERAGE = 0.55  # score for using the photo border as a side
MAX_LINES_PER_ORIENTATION = 14


@dataclass
class Line:
    abc: np.ndarray  # a x + b y + c = 0, a^2 + b^2 = 1
    length: float
    angle: float  # degrees in [0, 180)
    virtual: bool = False


@dataclass
class Quad:
    corners: np.ndarray  # (4, 2) float: tl, tr, br, bl in full-resolution pixels
    confidence: float
    notes: list[str]


def find_lines(gray: np.ndarray) -> tuple[np.ndarray, list[Line]]:
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    med = float(np.median(blur))
    edges = cv2.Canny(blur, 0.4 * med, 1.0 * med)
    h, w = gray.shape
    segs = cv2.HoughLinesP(edges, 1, np.pi / 720, threshold=60, minLineLength=int(0.12 * min(h, w)), maxLineGap=8)
    segs = np.zeros((0, 4)) if segs is None else segs.reshape(-1, 4)

    groups: list[dict] = []
    for x1, y1, x2, y2 in segs.astype(float):
        theta = math.atan2(y2 - y1, x2 - x1) % math.pi
        normal = np.array([-math.sin(theta), math.cos(theta)])
        rho = float(normal @ (x1, y1))
        length = math.hypot(x2 - x1, y2 - y1)
        for g in groups:
            dth = abs(g["theta"] - theta)
            if min(dth, math.pi - dth) > math.radians(2.5):
                continue
            # Distance of this segment's midpoint from the group's line.
            if abs(g["normal"] @ ((x1 + x2) / 2, (y1 + y2) / 2) - g["rho"]) < 6:
                g["length"] += length
                g["points"] += [(x1, y1), (x2, y2)]
                break
        else:
            groups.append({"theta": theta, "normal": normal, "rho": rho, "length": length, "points": [(x1, y1), (x2, y2)]})

    lines = []
    for g in groups:
        vx, vy, x0, y0 = cv2.fitLine(np.array(g["points"], np.float32), cv2.DIST_L2, 0, 0.01, 0.01).ravel()
        a, b = float(-vy), float(vx)
        lines.append(Line(np.array([a, b, -(a * x0 + b * y0)]), g["length"], math.degrees(math.atan2(vy, vx)) % 180))
    return edges, lines


def _intersect(l1: np.ndarray, l2: np.ndarray) -> np.ndarray | None:
    p = np.cross(l1, l2)
    return None if abs(p[2]) < 1e-9 else p[:2] / p[2]


def _coverage(edge_mask: np.ndarray, a: np.ndarray, b: np.ndarray, samples: int = 80) -> float:
    h, w = edge_mask.shape
    pts = a[None] + np.linspace(0, 1, samples)[:, None] * (b - a)[None]
    inside = (pts[:, 0] >= 0) & (pts[:, 0] < w) & (pts[:, 1] >= 0) & (pts[:, 1] < h)
    p = pts[inside].astype(int)
    return float((edge_mask[p[:, 1], p[:, 0]] > 0).sum()) / samples


def search_quad(gray: np.ndarray) -> tuple[np.ndarray, list[float]]:
    h, w = gray.shape
    edges, lines = find_lines(gray)
    edge_mask = cv2.dilate(edges, np.ones((5, 5), np.uint8))
    horiz = sorted((ln for ln in lines if ln.angle < 35 or ln.angle > 145), key=lambda ln: -ln.length)
    vert = sorted((ln for ln in lines if 55 < ln.angle < 125), key=lambda ln: -ln.length)
    horiz = horiz[:MAX_LINES_PER_ORIENTATION] + [
        Line(np.array([0.0, 1.0, 0.0]), 0, 0, True),
        Line(np.array([0.0, 1.0, -(h - 1.0)]), 0, 0, True),
    ]
    vert = vert[:MAX_LINES_PER_ORIENTATION] + [
        Line(np.array([1.0, 0.0, 0.0]), 0, 90, True),
        Line(np.array([1.0, 0.0, -(w - 1.0)]), 0, 90, True),
    ]

    def y_mid(ln: Line) -> float:
        return -(ln.abc[0] * w / 2 + ln.abc[2]) / ln.abc[1]

    def x_mid(ln: Line) -> float:
        return -(ln.abc[1] * h / 2 + ln.abc[2]) / ln.abc[0]

    best: tuple[float, np.ndarray, list[float]] | None = None
    for top, bottom in itertools.permutations(horiz, 2):
        if y_mid(top) >= y_mid(bottom) - 0.2 * h:
            continue
        for left, right in itertools.permutations(vert, 2):
            if x_mid(left) >= x_mid(right) - 0.2 * w:
                continue
            sides = [top, right, bottom, left]
            if sum(s.virtual for s in sides) > 1:
                continue
            pts = [_intersect(left.abc, top.abc), _intersect(top.abc, right.abc), _intersect(right.abc, bottom.abc), _intersect(bottom.abc, left.abc)]
            if any(p is None for p in pts):
                continue
            corners = np.array(pts)
            if (corners[:, 0] < -0.1 * w).any() or (corners[:, 0] > 1.1 * w).any():
                continue
            if (corners[:, 1] < -0.1 * h).any() or (corners[:, 1] > 1.1 * h).any():
                continue
            area = cv2.contourArea(corners.astype(np.float32)) / (w * h)
            if area < 0.12:
                continue
            covs = [
                VIRTUAL_SIDE_COVERAGE if s.virtual else _coverage(edge_mask, corners[i], corners[(i + 1) % 4])
                for i, s in enumerate(sides)
            ]
            if min(covs) < 0.45:
                continue
            score = area * float(np.prod(covs)) ** 0.5
            if best is None or score > best[0]:
                best = (score, corners, covs)
    if best is None:
        raise RuntimeError("no board quad found; set corners.json manually in the author tool")
    return best[1], best[2]


def aspect_ratio(corners: np.ndarray, size: tuple[int, int], focal_px: float | None) -> tuple[float, str]:
    """Physical width/height of the rectangle. Zhang & He, 'Whiteboard scanning and image enhancement' (2004)."""
    tl, tr, br, bl = corners
    side_ratio = float((np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)))
    if not focal_px:
        return side_ratio, "sides"
    u0, v0 = size[0] / 2, size[1] / 2
    m1, m2, m3, m4 = (np.array([p[0] - u0, p[1] - v0, 1.0]) for p in (tl, tr, bl, br))
    k2 = np.dot(np.cross(m1, m4), m3) / np.dot(np.cross(m2, m4), m3)
    k3 = np.dot(np.cross(m1, m4), m2) / np.dot(np.cross(m3, m4), m2)
    n2, n3 = k2 * m2 - m1, k3 * m3 - m1
    a_inv = np.diag([1 / focal_px, 1 / focal_px, 1.0])
    den = n3 @ a_inv.T @ a_inv @ n3
    if den <= 0:
        return side_ratio, "sides"
    ratio = math.sqrt((n2 @ a_inv.T @ a_inv @ n2) / den)
    if not (0.3 < ratio < 3.5) or abs(ratio - side_ratio) / side_ratio > 0.35:
        return side_ratio, "sides"
    return ratio, "focal"


def _target_size(ratio: float, long_edge: int) -> tuple[int, int]:
    return (long_edge, round(long_edge / ratio)) if ratio >= 1 else (round(long_edge * ratio), long_edge)


def grow_to_board(small: np.ndarray, corners: np.ndarray, ratio: float) -> np.ndarray:
    """Expand a board-parallel quad outward to the board's real extent. Works in rectified space."""
    rw, rh = _target_size(ratio, 700)
    margin_x, margin_y = rw, rh  # room to grow by up to 100% per side
    dst = np.array([[margin_x, margin_y], [margin_x + rw, margin_y], [margin_x + rw, margin_y + rh], [margin_x, margin_y + rh]], np.float32)
    hom = cv2.getPerspectiveTransform(corners.astype(np.float32), dst)
    cw, ch = rw + 2 * margin_x, rh + 2 * margin_y
    warped = cv2.warpPerspective(small, hom, (cw, ch), flags=cv2.INTER_LINEAR)
    valid = cv2.warpPerspective(np.full(small.shape[:2], 255, np.uint8), hom, (cw, ch), flags=cv2.INTER_NEAREST) > 0
    lab = cv2.cvtColor(warped, cv2.COLOR_RGB2LAB).astype(np.float32)
    gray = cv2.cvtColor(warped, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 30, 90)
    horiz_edges = cv2.dilate(edges, np.ones((3, 1), np.uint8))
    vert_edges = cv2.dilate(edges, np.ones((1, 3), np.uint8))

    x0, y0, x1, y1 = margin_x, margin_y, margin_x + rw, margin_y + rh

    def paper(pixels_lab: np.ndarray) -> np.ndarray:
        """Robust paper color of a strip: mean of its brightest 40% (ignores ink)."""
        lightness = pixels_lab[:, 0]
        keep = lightness >= np.percentile(lightness, 60)
        return pixels_lab[keep].mean(axis=0)

    def grow(side: str) -> int:
        nonlocal x0, y0, x1, y1
        step = {"top": -1, "left": -1, "bottom": 1, "right": 1}[side]
        horizontal = side in ("top", "bottom")
        pos = {"top": y0, "bottom": y1, "left": x0, "right": x1}[side]
        span = (x0, x1) if horizontal else (y0, y1)
        inner = slice(pos + 3, pos + 15) if step < 0 else slice(pos - 15, pos - 3)
        strip = lab[inner, span[0] : span[1]] if horizontal else lab[span[0] : span[1], inner]
        ref = paper(strip.reshape(-1, 3))
        limit = ch if horizontal else cw
        cur = pos
        for _ in range(limit):
            nxt = cur + step
            if nxt < 1 or nxt >= limit - 1:
                break
            row_valid = valid[nxt, span[0] : span[1]] if horizontal else valid[span[0] : span[1], nxt]
            if row_valid.mean() < 0.97:
                break
            px = lab[nxt, span[0] : span[1]] if horizontal else lab[span[0] : span[1], nxt]
            color = paper(px)
            if np.linalg.norm(color - ref) > 14:
                break
            emap = horiz_edges if horizontal else vert_edges
            cov = (emap[nxt, span[0] : span[1]] > 0).mean() if horizontal else (emap[span[0] : span[1], nxt] > 0).mean()
            if abs(nxt - pos) > 6 and cov > 0.6:
                cur = nxt
                break
            ref = 0.95 * ref + 0.05 * color  # follow slow lighting changes
            cur = nxt
        return cur

    for _ in range(2):
        y0 = grow("top")
        y1 = grow("bottom")
        x0 = grow("left")
        x1 = grow("right")

    grown = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float64)
    back = cv2.perspectiveTransform(grown[None].astype(np.float32), np.linalg.inv(hom))[0]
    return back.astype(np.float64)


def detect_quad(rgb: np.ndarray, focal_px: float | None) -> Quad:
    h, w = rgb.shape[:2]
    scale = DETECT_LONG_EDGE / max(h, w)
    small = cv2.resize(rgb, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    corners, covs = search_quad(cv2.cvtColor(small, cv2.COLOR_RGB2GRAY))
    ratio, _ = aspect_ratio(corners / scale, (w, h), focal_px)
    grown = grow_to_board(small, corners, ratio)
    notes = []
    confidence = 0.9 if min(covs) > 0.7 else 0.6
    if (grown[:, 0] < 2).any() or (grown[:, 1] < 2).any() or (grown[:, 0] > small.shape[1] - 3).any() or (grown[:, 1] > small.shape[0] - 3).any():
        notes.append("board reaches the photo edge; part of it may be cut off")
        confidence = min(confidence, 0.6)
    return Quad(corners=grown / scale, confidence=confidence, notes=notes)


def flatten_lighting(rgb: np.ndarray) -> np.ndarray:
    """Divide out a smooth estimate of the board white so paper is ~250 everywhere (removes shading and color cast)."""
    h, w = rgb.shape[:2]
    small = cv2.resize(rgb, (max(1, w // 8), max(1, h // 8)), interpolation=cv2.INTER_AREA)
    k = max(3, (min(small.shape[:2]) // 6) | 1)
    white = cv2.dilate(small, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    white = cv2.GaussianBlur(white, (0, 0), k / 2)
    white = cv2.resize(white, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)
    out = rgb.astype(np.float32) / np.maximum(white, 1) * 250
    return np.clip(out, 0, 255).astype(np.uint8)


@stage("rectify")
def run(ctx: StageContext) -> None:
    out_dir = wdir(ctx)
    rgb = read_rgb(out_dir / "ingest.png")
    meta = read_json_optional(out_dir / "ingest.json") or {}
    h, w = rgb.shape[:2]

    override = read_json_optional(out_dir / "corners.json")
    if override:
        quad = Quad(corners=np.array(override["corners"], dtype=np.float64), confidence=1.0, notes=[])
        source = "corners.json"
    else:
        quad = detect_quad(rgb, meta.get("focalPx"))
        source = "auto"

    ratio, ratio_source = aspect_ratio(quad.corners, (w, h), meta.get("focalPx"))
    if override and override.get("aspect"):
        ratio, ratio_source = float(override["aspect"]), "corners.json"
    out_w, out_h = _target_size(ratio, OUTPUT_LONG_EDGE)
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], dtype=np.float32)
    homography = cv2.getPerspectiveTransform(quad.corners.astype(np.float32), dst)
    warped = cv2.warpPerspective(rgb, homography, (out_w, out_h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))
    flat = flatten_lighting(warped)
    write_rgb(out_dir / "rectified.png", flat)

    write_json(
        out_dir / "rectify.json",
        {
            "source": source,
            "corners": quad.corners.round(1).tolist(),
            "confidence": quad.confidence,
            "notes": quad.notes,
            "aspect": round(ratio, 4),
            "aspectSource": ratio_source,
            "size": [out_w, out_h],
            "homography": homography.tolist(),
        },
    )

    dbg = rgb.copy()
    thick = max(4, w // 300)
    cv2.polylines(dbg, [quad.corners.astype(np.int32)], True, (255, 0, 160), thickness=thick)
    for p, label in zip(quad.corners, ["TL", "TR", "BR", "BL"], strict=True):
        cv2.circle(dbg, (int(p[0]), int(p[1])), 3 * thick, (0, 200, 255), -1)
        cv2.putText(dbg, label, (int(p[0]) + 20, int(p[1]) + 40), cv2.FONT_HERSHEY_SIMPLEX, w / 1200, (255, 0, 160), thick)
    write_debug(ctx, "rectify-quad", dbg)
    write_debug(ctx, "rectify", flat)
    notes = f" notes={quad.notes}" if quad.notes else ""
    print(f"  rectify: {source} {out_w}x{out_h} aspect={ratio:.3f} ({ratio_source}) conf={quad.confidence}{notes}")
