"use client";
/**
 * The 3D building. Levels are slabs with room blocks on top; the route is drawn as a line above the
 * floor. Exploded and solid layouts differ only in each level's height, and the change is animated.
 */
import { Billboard, Line, OrbitControls, Text } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { Level, Point, Room } from "@wf/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BuildingData } from "@/lib/data";
import { CATEGORY_COLOR, EXPLODE_GAP_M, ROUTE_COLOR, type Vec3, boundsOf, cameraFor, levelHeights, routePoints, toScene } from "@/lib/scene";
import type { ViewMode } from "@/lib/url";

const SLAB_THICKNESS = 0.35;
const ROOM_HEIGHT = 1.6;
/** Room numbers disappear when the camera is further away than this. */
const LABEL_VISIBLE_DISTANCE = 70;

function shapeOf(outline: Point[], holes: Point[][] = []): THREE.Shape {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, -y)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, -y))));
  return shape;
}

/** One level: slab, rooms, and labels. Geometry is built once and reused as the level moves. */
function LevelMesh({
  level,
  targetY,
  dimmed,
  showLabels,
  hidden,
  onSelect,
}: {
  level: Level;
  targetY: number;
  dimmed: boolean;
  showLabels: boolean;
  /** In solid view, levels above the one being looked at are in the way. */
  hidden: boolean;
  onSelect: (levelId: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const [labelsVisible, setLabelsVisible] = useState(false);

  const slab = useMemo(() => {
    const geometry = new THREE.ExtrudeGeometry(shapeOf(level.outline, level.voids), { depth: SLAB_THICKNESS, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }, [level.outline, level.voids]);

  const rooms = useMemo(() => {
    // One merged geometry per colour keeps the draw calls down on phones.
    const byColor = new Map<string, THREE.BufferGeometry[]>();
    for (const room of level.rooms) {
      const color = CATEGORY_COLOR[room.category] ?? CATEGORY_COLOR.other!;
      const geometry = new THREE.ExtrudeGeometry(shapeOf(room.polygon), { depth: ROOM_HEIGHT, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, SLAB_THICKNESS, 0);
      const list = byColor.get(color);
      if (list) list.push(geometry);
      else byColor.set(color, [geometry]);
    }
    return [...byColor.entries()].map(([color, geometries]) => ({ color, geometry: mergeGeometries(geometries) }));
  }, [level.rooms]);

  const labels = useMemo(
    () =>
      level.rooms
        .filter((room: Room) => room.number && room.category !== "service")
        .map((room: Room) => {
          const cx = room.polygon.reduce((s, p) => s + p[0], 0) / room.polygon.length;
          const cy = room.polygon.reduce((s, p) => s + p[1], 0) / room.polygon.length;
          return { id: room.id, text: room.number!, at: [cx, -cy] as [number, number] };
        }),
    [level.rooms],
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    // Ease towards the layout's height instead of snapping, so the toggle reads as a movement.
    g.position.y += (targetY - g.position.y) * 0.12;
    if (showLabels) {
      const distance = camera.position.distanceTo(new THREE.Vector3(g.position.x, g.position.y, g.position.z));
      const visible = distance < LABEL_VISIBLE_DISTANCE;
      if (visible !== labelsVisible) setLabelsVisible(visible);
    } else if (labelsVisible) setLabelsVisible(false);
  });

  const opacity = dimmed ? 0.22 : 1;
  return (
    <group ref={group} visible={!hidden} position={[0, targetY, 0]} onClick={(e) => (e.stopPropagation(), onSelect(level.id))}>
      <mesh geometry={slab} receiveShadow>
        <meshStandardMaterial color="#f2efe9" transparent={dimmed} opacity={opacity} roughness={0.95} />
      </mesh>
      {rooms.map(({ color, geometry }) => (
        <mesh key={color} geometry={geometry} castShadow>
          <meshStandardMaterial color={color} transparent={dimmed} opacity={opacity} roughness={0.8} />
        </mesh>
      ))}
      {labelsVisible &&
        labels.map((label) => (
          <Billboard key={label.id} position={[label.at[0], SLAB_THICKNESS + ROOM_HEIGHT + 1.1, label.at[1]]}>
            <Text fontSize={1.6} color="#1f2937" anchorX="center" anchorY="middle" outlineWidth={0.12} outlineColor="#ffffff">
              {label.text}
            </Text>
          </Billboard>
        ))}
    </group>
  );
}

/** three's BufferGeometryUtils is an optional import; this does the same for our simple case. */
function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  for (const geometry of geometries) {
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const index = geometry.getIndex();
    const push = (i: number) => {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    };
    if (index) for (let i = 0; i < index.count; i++) push(index.getX(i));
    else for (let i = 0; i < position.count; i++) push(i);
    geometry.dispose();
  }
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return merged;
}

function RouteLine({ points }: { points: Vec3[] }) {
  const dash = useRef(0);
  const line = useRef<{ material: THREE.Material & { dashOffset?: number } }>(null);
  useFrame((_, delta) => {
    dash.current -= delta * 2;
    const material = line.current?.material as (THREE.Material & { dashOffset?: number }) | undefined;
    if (material && "dashOffset" in material) material.dashOffset = dash.current;
  });
  if (points.length < 2) return null;
  return (
    <>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Line ref={line as never} points={points} color={ROUTE_COLOR} lineWidth={7} dashed dashSize={2.2} gapSize={1.1} depthTest={false} renderOrder={10} />
      <mesh position={points[0]}>
        <sphereGeometry args={[0.9, 16, 16]} />
        <meshStandardMaterial color="#16a34a" />
      </mesh>
      <mesh position={points[points.length - 1]}>
        <coneGeometry args={[1, 2.4, 16]} />
        <meshStandardMaterial color="#dc2626" />
      </mesh>
    </>
  );
}

/** Moves the camera to frame whatever matters right now, without fighting the user's dragging. */
function CameraRig({ target, fit }: { target: Vec3; fit: number }) {
  const { camera, size } = useThree();
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  useEffect(() => {
    const eye = cameraFor(target, fit, 45, size.width / Math.max(1, size.height));
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.lookAt(target[0], target[1], target[2]);
    const c = controls.current as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (c) {
      c.target.set(target[0], target[1], target[2]);
      c.update();
    }
  }, [camera, size.width, size.height, target[0], target[1], target[2], fit]);
  return <OrbitControls ref={controls} enablePan enableDamping dampingFactor={0.12} minDistance={8} maxPolarAngle={Math.PI / 2.05} makeDefault />;
}

export interface SceneProps {
  data: BuildingData;
  view: ViewMode;
  /** Levels the route touches; others are dimmed when a route is shown. */
  routeLevels: string[];
  routeNodes: { x: number; y: number; levelId: string }[];
  focusLevel: string | null;
  onSelectLevel: (levelId: string) => void;
}

export function Scene({ data, view, routeLevels, routeNodes, focusLevel, onSelectLevel }: SceneProps) {
  const heights = useMemo(() => levelHeights(data.building, data.levels, view), [data, view]);
  const points = useMemo(() => routePoints(routeNodes, heights), [routeNodes, heights]);

  const { target, fit } = useMemo(() => {
    // Focusing a level means looking at that level, even when a route is showing.
    const level = focusLevel ? data.levels.find((l) => l.id === focusLevel) : null;
    if (level) {
      const onLevel = points.length > 1 ? points.filter((p) => Math.abs(p[1] - ((heights.get(level.id) ?? 0) + 0.6)) < 0.01) : [];
      const b = boundsOf(onLevel.length > 1 ? onLevel : level.outline.map((p) => toScene(p, heights.get(level.id) ?? 0)));
      return { target: b.center, fit: Math.max(25, b.radius * 1.6) };
    }
    if (points.length > 1) {
      const b = boundsOf(points);
      // Pull back well past the route itself: seeing the surrounding rooms is what makes it legible.
      return { target: b.center, fit: Math.max(30, b.radius * 2.2) };
    }
    const all: Vec3[] = data.levels.flatMap((l) => l.outline.map((p) => toScene(p, heights.get(l.id) ?? 0)));
    const b = boundsOf(all);
    return { target: b.center, fit: b.radius };
  }, [points, data.levels, heights, focusLevel]);

  const dimmed = (levelId: string) => {
    if (focusLevel) return levelId !== focusLevel;
    if (routeLevels.length) return !routeLevels.includes(levelId);
    return false;
  };

  /**
   * Room numbers only go on the levels being looked at. Showing every level at once turns into an
   * unreadable pile, because labels from levels behind still draw over the one in front.
   */
  const labelLevels = new Set(focusLevel ? [focusLevel] : routeLevels);

  // Solid view stacks the levels at their real heights, so anything above what you care about is in
  // the way: cut away above the focused level, or above the highest level the route reaches.
  const order = new Map(data.building.levels.map((l) => [l.id, l.sortIndex]));
  const topOfRoute = routeLevels.length ? Math.max(...routeLevels.map((id) => order.get(id) ?? 0)) : null;
  const cutAbove = focusLevel ? (order.get(focusLevel) ?? null) : topOfRoute;
  const hidden = (levelId: string) => view === "solid" && cutAbove !== null && (order.get(levelId) ?? 0) > cutAbove;

  return (
    <Canvas shadows camera={{ fov: 45, near: 0.5, far: 4000 }} dpr={[1, 1.8]} gl={{ antialias: true }}>
      <color attach="background" args={["#eef1f5"]} />
      <hemisphereLight intensity={0.85} groundColor="#cbd5e1" />
      <directionalLight position={[60, 120, 40]} intensity={1.5} castShadow />
      {data.levels.map((level) => (
        <LevelMesh
          key={level.id}
          level={level}
          targetY={heights.get(level.id) ?? 0}
          dimmed={dimmed(level.id)}
          showLabels={labelLevels.has(level.id)}
          hidden={hidden(level.id)}
          onSelect={onSelectLevel}
        />
      ))}
      <RouteLine points={points} />
      <CameraRig target={target} fit={fit} />
    </Canvas>
  );
}

export { EXPLODE_GAP_M };
