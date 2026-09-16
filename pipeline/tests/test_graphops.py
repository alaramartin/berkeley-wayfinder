import numpy as np

from wf.graphops import door_point, project, split_edge
from wf.skeleton import build_graph, prune, skeleton_of


def test_project_t_and_side_use_map_orientation():
    # Edge runs east (image +x). Image y grows downward, so a point with smaller y is north = LEFT when walking east.
    edges = [{"id": "e1", "a": "n1", "b": "n2", "polyline": [[0, 100], [100, 100]]}]
    north = project(edges, (25, 80))
    south = project(edges, (75, 130))
    assert north and south
    assert abs(north.t - 0.25) < 1e-6 and north.side == "left"
    assert abs(south.t - 0.75) < 1e-6 and south.side == "right"


def test_split_edge_inserts_node_and_keeps_geometry():
    nodes = [{"id": "n1", "x": 0, "y": 0}, {"id": "n2", "x": 100, "y": 0}]
    edges = [{"id": "e1", "a": "n1", "b": "n2", "kind": "corridor", "polyline": [[0, 0], [50, 0], [100, 0]]}]
    proj = project(edges, (70, 10))
    new = split_edge(nodes, edges, proj, {"id": "j1", "kind": "junction"}, snap=2)
    assert new == "j1"
    assert {e["id"] for e in edges} == {"e1a", "e1b"}
    first = next(e for e in edges if e["id"] == "e1a")
    assert first["b"] == "j1" and first["polyline"][-1] == [70.0, 0.0]
    # Near an endpoint, the endpoint is reused instead of splitting.
    assert split_edge(nodes, edges, project(edges, (1, 1)), {"id": "j2", "kind": "junction"}, snap=5) == "n1"


def test_door_faces_corridor():
    corridor = np.zeros((200, 200), np.uint8)
    corridor[100:130, :] = 255  # corridor band south of the room
    room = np.array([[40, 20], [160, 20], [160, 95], [40, 95]], float)
    (x, y), conf = door_point(room, corridor, (0, 0), reach=15)
    assert conf >= 0.5
    assert abs(y - 95) < 3 and 40 < x < 160


def test_skeleton_graph_of_plus_shaped_corridor():
    mask = np.zeros((300, 300), np.uint8)
    mask[135:165, 20:280] = 255
    mask[20:280, 135:165] = 255
    g = prune(build_graph(skeleton_of(mask)), spur_len=15, merge_len=10)
    degrees = sorted(g.degree(n) for n in g.nodes)
    assert degrees == [1, 1, 1, 1, 4]
    assert g.components() == 1
