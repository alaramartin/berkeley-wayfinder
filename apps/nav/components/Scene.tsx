"use client";
/**
 * The 3D building. Levels are slabs with room blocks on top; the route is drawn as a line above the
 * floor. Exploded and solid layouts differ only in each level's height, and the change is animated.
 */
import { OrbitControls, Text } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { interiorPoint, orientedExtent } from "@wf/geometry";
import type { Level, Point, Room } from "@wf/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BuildingData } from "@/lib/data";
import { type Pose, lerpPose, overviewPose, stepPose } from "@/lib/camera";
import { type LevelRibbon, type RouteGeometry, locateStep } from "@/lib/route-geometry";
import { CATEGORY_COLOR, EXPLODE_GAP_M, ROOM_HEIGHT, SLAB_THICKNESS, type Vec3, boundsOf, labelColor, levelHeights, planToShape, toScene } from "@/lib/scene";
import { RouteRibbon } from "./RouteRibbon";
import type { ViewMode } from "@/lib/url";

/** Folds a level's axis into (-90, 90] so room numbers are never printed upside down. */
function labelAngle(rotation: number): number {
  let a = rotation;
  while (a > Math.PI / 2) a -= Math.PI;
  while (a <= -Math.PI / 2) a += Math.PI;
  return a;
}

/** Room numbers disappear when the camera is further away than this. */
const LABEL_VISIBLE_DISTANCE = 70;

/**
 * Plan polygon -> THREE.Shape, via `planToShape` so the extruded mesh lands where `toScene` says it
 * should. Using a different y sign here is what used to mirror the whole building against its labels.
 */
function shapeOf(outline: Point[], holes: Point[][] = []): THREE.Shape {
  const toVec = (p: Point) => {
    const [sx, sy] = planToShape(p);
    return new THREE.Vector2(sx, sy);
  };
  const shape = new THREE.Shape(outline.map(toVec));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(toVec)));
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
  children,
}: {
  level: Level;
  targetY: number;
  dimmed: boolean;
  showLabels: boolean;
  /** In solid view, levels above the one being looked at are in the way. */
  hidden: boolean;
  onSelect: (levelId: string) => void;
  children?: React.ReactNode;
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

  // One label per distinct outline: L2 has suites whose rooms still share a polygon, and five
  // labels stacked on one point is worse than one label naming them all.
  const labels = useMemo(() => {
    const byPolygon = new Map<string, { rooms: Room[]; polygon: Point[] }>();
    for (const room of level.rooms as Room[]) {
      if (!room.number || room.category === "service") continue;
      const key = room.polygon.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(";");
      const group = byPolygon.get(key);
      if (group) group.rooms.push(room);
      else byPolygon.set(key, { rooms: [room], polygon: room.polygon });
    }
    const axis = labelAngle(level.imageTransform.rotation);
    return [...byPolygon.values()].map(({ rooms, polygon }) => {
      const numbers = rooms.map((r) => r.number!);
      const text = numbers.length > 3 ? `${numbers.slice(0, 3).join("/")} +${numbers.length - 3}` : numbers.join("/");
      const at = interiorPoint(polygon);
      const { along, across } = orientedExtent(polygon, axis);
      const fontSize = Math.min(2.4, Math.max(0.55, Math.min(across * 0.5, along / (0.62 * text.length))));
      return { id: rooms[0]!.id, text, at, fontSize, axis, color: labelColor(rooms[0]!.category) };
    });
  }, [level.rooms, level.imageTransform.rotation]);

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
  // Orbiting the camera ends in a click on whatever is under the cursor, so only treat a press that
  // barely moved as picking a level.
  const pressed = useRef<{ x: number; y: number } | null>(null);
  return (
    <group
      ref={group}
      visible={!hidden}
      position={[0, targetY, 0]}
      onPointerDown={(e) => {
        pressed.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
      }}
      onPointerUp={(e) => {
        const start = pressed.current;
        pressed.current = null;
        if (!start) return;
        if (Math.hypot(e.nativeEvent.clientX - start.x, e.nativeEvent.clientY - start.y) > 4) return;
        e.stopPropagation();
        onSelect(level.id);
      }}
    >
      <mesh geometry={slab} receiveShadow>
        <meshStandardMaterial color="#f2efe9" transparent={dimmed} opacity={opacity} roughness={0.95} />
      </mesh>
      {rooms.map(({ color, geometry }) => (
        <mesh key={color} geometry={geometry} castShadow>
          <meshStandardMaterial color={color} transparent={dimmed} opacity={opacity} roughness={0.8} />
        </mesh>
      ))}
      {labelsVisible &&
        labels.map((label) => {
          const [x, , z] = toScene(label.at, 0);
          return (
            <Text
              key={label.id}
              position={[x, SLAB_THICKNESS + ROOM_HEIGHT + 0.03, z]}
              rotation={[-Math.PI / 2, 0, label.axis]}
              fontSize={label.fontSize}
              color={label.color}
              anchorX="center"
              anchorY="middle"
            >
              {label.text}
            </Text>
          );
        })}
      {children}
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

/** Start and destination markers, sitting on the floor of their own level. */
function RouteMarkers({ ribbon, isStart, isEnd }: { ribbon: LevelRibbon; isStart: boolean; isEnd: boolean }) {
  const first = ribbon.points[0];
  const last = ribbon.points[ribbon.points.length - 1];
  return (
    <>
      {isStart && first && (
        <mesh position={[first[0], first[1] + 0.5, first[2]]}>
          <sphereGeometry args={[0.7, 16, 16]} />
          <meshStandardMaterial color="#16a34a" />
        </mesh>
      )}
      {isEnd && last && (
        <mesh position={[last[0], last[1] + 1.3, last[2]]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.8, 2, 16]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
      )}
    </>
  );
}

/** A marker where the route leaves one level for another. */
function TransitionMarker({ at, up, kind }: { at: Point; up: boolean; kind: "stair" | "elevator" }) {
  const [x, , z] = toScene(at, 0);
  return (
    <group position={[x, SLAB_THICKNESS + 0.1, z]}>
      <mesh position={[0, 1.1, 0]} rotation={[up ? 0 : Math.PI, 0, 0]}>
        <coneGeometry args={[0.35, 0.9, 12]} />
        <meshStandardMaterial color={kind === "elevator" ? "#e0a458" : "#4f9d69"} />
      </mesh>
    </group>
  );
}

/**
 * Camera control. Framing only ever happens through an explicit flight, never as a side effect of
 * state changing, which is what used to yank the camera back to one fixed spot on every zoom.
 */
function CameraRig({ flight, maxDistance, onTakeover }: { flight: Flight | null; maxDistance: number; onTakeover: () => void }) {
  const { camera } = useThree();
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const active = useRef<{ flight: Flight; from: Pose; started: number } | null>(null);

  useEffect(() => {
    const c = controls.current as unknown as { addEventListener: (e: string, f: () => void) => void; removeEventListener: (e: string, f: () => void) => void } | null;
    if (!c) return;
    // The controls' own "start" fires on drag and wheel, and never on a step tap.
    const onStart = () => {
      if (active.current) active.current = null;
      onTakeover();
    };
    c.addEventListener("start", onStart);
    return () => c.removeEventListener("start", onStart);
  }, [onTakeover]);

  useEffect(() => {
    if (!flight) return;
    const c = controls.current as unknown as { target: THREE.Vector3 } | null;
    const from: Pose = {
      eye: [camera.position.x, camera.position.y, camera.position.z],
      target: c ? [c.target.x, c.target.y, c.target.z] : [0, 0, 0],
    };
    if (flight.immediate) {
      apply(camera, controls.current, flight.to);
      active.current = null;
      flight.onArrive?.();
      return;
    }
    active.current = { flight, from, started: performance.now() };
  }, [flight, camera]);

  useFrame(() => {
    const run = active.current;
    if (!run) return;
    const t = Math.min(1, (performance.now() - run.started) / run.flight.ms);
    apply(camera, controls.current, lerpPose(run.from, run.flight.to, t));
    if (t >= 1) {
      active.current = null;
      run.flight.onArrive?.();
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableDamping
      dampingFactor={0.12}
      minDistance={2}
      maxDistance={maxDistance}
      zoomToCursor
      screenSpacePanning
      maxPolarAngle={Math.PI / 2.05}
    />
  );
}

function apply(camera: THREE.Camera, controls: unknown, pose: Pose): void {
  camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
  const c = controls as { target: THREE.Vector3; update: () => void } | null;
  if (c) {
    c.target.set(pose.target[0], pose.target[1], pose.target[2]);
    c.update();
  } else {
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  }
}

export interface Flight {
  to: Pose;
  ms: number;
  /** Bumped by the caller to re-run the same flight. */
  key: number;
  immediate?: boolean;
  onArrive?: () => void;
}

export interface SceneProps {
  data: BuildingData;
  view: ViewMode;
  /** Levels the route touches; others are dimmed when a route is shown. */
  routeLevels: string[];
  geometry: RouteGeometry | null;
  /** Step the guide is on, used for framing and for fading the path behind you. */
  activeStep: number | null;
  /** Bumped when the guide wants a new flight; null means "leave the camera alone". */
  flightRequest: { kind: "overview" | "step"; step: number; ms: number; key: number; immediate?: boolean } | null;
  onFlightArrive: () => void;
  onTakeover: () => void;
  focusLevel: string | null;
  onSelectLevel: (levelId: string) => void;
}

export function Scene({
  data,
  view,
  routeLevels,
  geometry,
  activeStep,
  flightRequest,
  onFlightArrive,
  onTakeover,
  focusLevel,
  onSelectLevel,
}: SceneProps) {
  const heights = useMemo(() => levelHeights(data.building, data.levels, view), [data, view]);
  const { size } = useThreeSafe();

  const buildingBounds = useMemo(
    () => boundsOf(data.levels.flatMap((l) => l.outline.map((p) => toScene(p, heights.get(l.id) ?? 0)))),
    [data.levels, heights],
  );

  /** Distance walked at the active step, so the ribbon can fade ahead of and behind the walker. */
  const activeDistance = useMemo(() => {
    if (!geometry || activeStep === null) return null;
    const found = locateStep(geometry, activeStep);
    return found ? (found.ribbon.distances[found.pointIndex] ?? 0) : null;
  }, [geometry, activeStep]);

  const flight = useMemo<Flight | null>(() => {
    if (!flightRequest) return null;
    const aspect = size.width / Math.max(1, size.height);
    if (flightRequest.kind === "overview" || !geometry) {
      return {
        to: overviewPose(buildingBounds.center, buildingBounds.radius, aspect),
        ms: flightRequest.ms,
        key: flightRequest.key,
        immediate: flightRequest.immediate,
        onArrive: onFlightArrive,
      };
    }
    const found = locateStep(geometry, flightRequest.step);
    if (found) {
      const levelY = heights.get(found.ribbon.levelId) ?? 0;
      const level = data.levels.find((l) => l.id === found.ribbon.levelId);
      const ceiling = view === "solid" && level ? levelY + level.heightM - 0.6 : undefined;
      return { to: stepPose(found.ribbon, found.pointIndex, levelY, ceiling), ms: flightRequest.ms, key: flightRequest.key, onArrive: onFlightArrive };
    }
    // Stairs and lifts have no ribbon of their own, so look at the shaft from just above it.
    const transition = geometry.transitions.find((t) => t.stepIndex === flightRequest.step);
    if (!transition) return null;
    const from = toScene(transition.at, heights.get(transition.fromLevelId) ?? 0);
    const to = toScene(transition.to, heights.get(transition.toLevelId) ?? 0);
    const centre: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + 2, (from[2] + to[2]) / 2];
    return {
      to: { eye: [centre[0] + 14, centre[1] + 11, centre[2] + 14], target: centre },
      ms: flightRequest.ms,
      key: flightRequest.key,
      onArrive: onFlightArrive,
    };
    // `heights` changes identity on every view toggle; keying on the request is what stops the camera
    // being re-framed behind the user's back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightRequest?.key, geometry, buildingBounds, size.width, size.height]);

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
  // While the guide is walking, cut away above the level being walked on, so the route stays visible.
  const walkingLevel = geometry && activeStep !== null ? (locateStep(geometry, activeStep)?.ribbon.levelId ?? null) : null;
  const cutAbove = focusLevel ? (order.get(focusLevel) ?? null) : (walkingLevel ? (order.get(walkingLevel) ?? null) : topOfRoute);
  const hidden = (levelId: string) => view === "solid" && cutAbove !== null && (order.get(levelId) ?? 0) > cutAbove;

  const ribbonsByLevel = new Map<string, LevelRibbon[]>();
  for (const ribbon of geometry?.ribbons ?? []) {
    const list = ribbonsByLevel.get(ribbon.levelId);
    if (list) list.push(ribbon);
    else ribbonsByLevel.set(ribbon.levelId, [ribbon]);
  }
  const lastRibbon = geometry?.ribbons[geometry.ribbons.length - 1];

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
        >
          {(ribbonsByLevel.get(level.id) ?? []).map((ribbon, i) => (
            <group key={`${ribbon.levelId}-${i}`}>
              <RouteRibbon ribbon={ribbon} activeDistance={activeDistance} />
              <RouteMarkers ribbon={ribbon} isStart={ribbon === geometry?.ribbons[0]} isEnd={ribbon === lastRibbon} />
            </group>
          ))}
          {view === "exploded" &&
            !dimmed(level.id) &&
            (geometry?.transitions ?? [])
              .filter((t) => t.fromLevelId === level.id)
              .map((t) => (
                <TransitionMarker
                  key={`${t.stepIndex}-${t.fromLevelId}`}
                  at={t.at}
                  up={(order.get(t.toLevelId) ?? 0) > (order.get(t.fromLevelId) ?? 0)}
                  kind={t.kind}
                />
              ))}
        </LevelMesh>
      ))}
      <CameraRig flight={flight} maxDistance={buildingBounds.radius * 4} onTakeover={onTakeover} />
    </Canvas>
  );
}

/** `useThree` outside the Canvas would throw, so the size comes from the window instead. */
function useThreeSafe(): { size: { width: number; height: number } } {
  const [size, setSize] = useState({ width: 1280, height: 800 });
  useEffect(() => {
    const read = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return { size };
}

export { EXPLODE_GAP_M };
