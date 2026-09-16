"""regions: color classes -> building outline, courtyards/voids, corridor mask, and room polygons.

Outputs (coordinates in rectified-board pixels; masks in plan-crop pixels):
  regions.json  outline, voids, rooms[{id, classId, category, group, polygon, area}]
  corridor.png  walkable paper inside the building (255)
"""

from __future__ import annotations

import cv2
import numpy as np

from wf.context import StageContext
from wf.geom import fill_holes, mask_to_polygons
from wf.io import read_json, read_rgb, wdir, write_debug, write_json
from wf.stages import stage

VERTICAL_CATEGORIES = {"stair", "elevator"}


def _kernel(size: int) -> np.ndarray:
    size = max(3, size | 1)
    return cv2.getStructuringElement(cv2.MORPH_RECT, (size, size))


def building_mask(labels: np.ndarray, paper_id: int, seal: int, unknown_id: int = 255) -> np.ndarray:
    """Filled footprint: everything printed, closed to seal window dashes and doorways, holes filled.

    Unknown colors (site boundary bands, exit signs outside the walls) are not part of the building.
    """
    printed = ((labels != paper_id) & (labels != unknown_id)).astype(np.uint8) * 255
    closed = cv2.morphologyEx(printed, cv2.MORPH_CLOSE, _kernel(seal))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(closed)
    if n <= 1:
        raise RuntimeError("no building found in plan")
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return fill_holes((lab == biggest).astype(np.uint8) * 255)


@stage("regions")
def run(ctx: StageContext) -> None:
    out = wdir(ctx)
    labels = cv2.imread(str(out / "labels.png"), cv2.IMREAD_GRAYSCALE)
    meta = read_json(out / "classify.json")
    px, py, pw, ph = meta["planBox"]
    classes = {c["id"]: c for c in meta["classes"]}
    by_name = {c["name"]: c["id"] for c in meta["classes"]}
    plan_long = max(labels.shape)
    seal = int(0.012 * plan_long)  # closes window dashes and doorways for the footprint
    min_room_area = (0.012 * plan_long) ** 2
    eps = max(2.0, 0.002 * plan_long)

    footprint = building_mask(labels, by_name["paper"], seal, meta["unknownId"])
    footprint_polys = mask_to_polygons(footprint, min_room_area, eps, (px, py))
    outline = max(footprint_polys, key=lambda p: cv2.contourArea(p.astype(np.float32)))

    service = np.isin(labels, [by_name["gray-dark"], by_name["gray-light"]])
    paper_id = by_name["paper"]
    inside_paper = ((footprint > 0) & (labels == paper_id)).astype(np.uint8)
    # Courtyards/voids are paper areas far wider than any corridor: an opening with a large disk keeps only
    # them. This is immune to dashed courtyard walls that connect corridors to courtyards.
    void_radius = int(0.09 * plan_long)  # wider than any lobby, narrower than any courtyard
    disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * void_radius + 1, 2 * void_radius + 1))
    wide = cv2.morphologyEx(inside_paper, cv2.MORPH_OPEN, disk)
    near_outside = cv2.dilate((footprint == 0).astype(np.uint8), _kernel(seal)) > 0
    ring = _kernel(max(3, seal // 2))

    legend_ids = [c["id"] for c in meta["classes"] if c["kind"] == "legend"]
    wide_ring = _kernel(seal)

    def looks_like_glare(m: np.ndarray) -> bool:
        """Glare on a gray service area: bordered by gray and touching no colored room, stair or elevator."""
        border = (cv2.dilate(m, ring) > 0) & (m == 0) & (labels != paper_id)
        if not border.any():
            return False
        touches_rooms = np.isin(labels[(cv2.dilate(m, wide_ring) > 0) & (m == 0)], legend_ids).mean()
        return bool(service[border].mean() > 0.6 and touches_rooms < 0.02)

    def outside_fraction(m: np.ndarray) -> float:
        return float(near_outside[m > 0].mean())

    voids = []
    n, comp, stats, _ = cv2.connectedComponentsWithStats(wide)
    void_mask = np.zeros_like(inside_paper)
    for i in range(1, n):
        m = (comp == i).astype(np.uint8)
        void_mask[m > 0] = 1  # glare-on-gray blobs are also excluded from corridors
        if looks_like_glare(m):
            continue
        voids.extend(mask_to_polygons(m * 255, min_room_area, eps, (px, py)))

    candidates = (inside_paper & (cv2.dilate(void_mask, _kernel(5)) == 0)).astype(np.uint8)
    # Cut thin paper slivers (window dashes, door marks in walls) off the corridors.
    candidates = cv2.morphologyEx(candidates, cv2.MORPH_OPEN, _kernel(int(0.008 * plan_long)))
    corridor = np.zeros_like(labels, np.uint8)
    n, comp, stats, _ = cv2.connectedComponentsWithStats(candidates)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < min_room_area:
            continue
        m = (comp == i).astype(np.uint8)
        if looks_like_glare(m):
            continue
        near_legend = np.isin(labels[(cv2.dilate(m, wide_ring) > 0) & (m == 0)], legend_ids)
        if not near_legend.any():
            continue  # courtyard corners, facade slivers: public corridors always reach a room/stair/elevator
        if outside_fraction(m) > 0.5:
            continue  # strip between the facade and a site boundary line
        corridor[m > 0] = 255

    rooms = []
    for cid, c in classes.items():
        if c["name"] == "paper" or c["name"] == "wall":
            continue
        if c["kind"] == "neutral":
            category, group = "service", None
            mask = service & (labels == cid)
        else:
            category, group = c["category"], c["label"]
            mask = labels == cid
        mask = mask.astype(np.uint8) * 255
        if category in VERTICAL_CATEGORIES:
            # Stair treads and the elevator X are drawn in dark lines inside the color block.
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, _kernel(seal))
        mask[footprint == 0] = 0
        # Numbers and icons are holes inside rooms; walls between rooms stay as separators.
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, _kernel(3))
        filled = np.zeros_like(mask)
        for poly in mask_to_polygons(mask, 0, 1.0):
            cv2.fillPoly(filled, [poly.round().astype(np.int32)], 255)
        for poly in mask_to_polygons(filled, min_room_area, eps, (px, py)):
            rooms.append(
                {
                    "classId": cid,
                    "category": category,
                    "group": group,
                    "polygon": poly.round(1).tolist(),
                    "area": round(float(cv2.contourArea(poly.astype(np.float32))), 1),
                }
            )

    # Numbers and icons printed inside rooms are paper too; they are never corridor.
    room_fill = np.zeros_like(corridor)
    for r in rooms:
        cv2.fillPoly(room_fill, [(np.array(r["polygon"]) - (px, py)).round().astype(np.int32)], 255)
    corridor[room_fill > 0] = 0
    n, comp, stats, _ = cv2.connectedComponentsWithStats((corridor > 0).astype(np.uint8))
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < min_room_area:
            corridor[comp == i] = 0
    cv2.imwrite(str(out / "corridor.png"), corridor)

    # Merge light/dark gray service fragments that share a class id ordering; stable ids by position.
    rooms.sort(key=lambda r: (min(p[1] for p in r["polygon"]), min(p[0] for p in r["polygon"])))
    for i, r in enumerate(rooms):
        r["id"] = f"{ctx.building.id}-{ctx.level.id}-g{i:03d}"

    write_json(
        out / "regions.json",
        {
            "planBox": meta["planBox"],
            "outline": outline.round(1).tolist(),
            "voids": [v.round(1).tolist() for v in voids],
            "rooms": rooms,
            "corridorFraction": round(float((corridor > 0).mean()), 4),
        },
    )

    rgb = read_rgb(out / "rectified.png")[py : py + ph, px : px + pw].copy()
    dbg = (rgb * 0.45 + 140).astype(np.uint8)
    dbg[corridor > 0] = (255, 250, 190)
    colors = {"stair": (40, 170, 60), "elevator": (240, 150, 40), "restroom": (40, 80, 220), "service": (120, 120, 120)}
    for r in rooms:
        poly = (np.array(r["polygon"]) - (px, py)).round().astype(np.int32)
        color = colors.get(r["category"], (170, 60, 200))
        cv2.polylines(dbg, [poly], True, color, 3)
    cv2.polylines(dbg, [(outline - (px, py)).round().astype(np.int32)], True, (220, 0, 0), 4)
    for v in voids:
        cv2.polylines(dbg, [(v - (px, py)).round().astype(np.int32)], True, (0, 180, 220), 4)
    write_debug(ctx, "regions", dbg)
    cats: dict[str, int] = {}
    for r in rooms:
        cats[r["category"]] = cats.get(r["category"], 0) + 1
    print(f"  regions: {len(rooms)} regions {cats} voids={len(voids)} corridor={(corridor > 0).mean():.1%}")
