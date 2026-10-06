"use client";
/**
 * The 3D building. Levels are slabs with room blocks on top; the route is drawn as a line above the
 * floor. Exploded and solid layouts differ only in each level's height, and the change is animated.
 */
import { Text } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { interiorPoint, orientedExtent } from "@wf/geometry";
import type { Level, Point, Room } from "@wf/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BuildingData } from "@/lib/data";
import { type Pose, lerpPose, overviewPose, spanPose, zoomPose } from "@/lib/camera";
import { createController } from "@/lib/controller";
import { type GuideStep, type LevelRibbon, type RouteGeometry, ribbonActivity, riserEndingAt, stepSpan } from "@/lib/route-geometry";
import { CATEGORY_COLOR, EXPLODE_GAP_M, ROOM_HEIGHT, SLAB_THICKNESS, type Vec3, boundsOf, labelColor, levelHeights, levelVisibility, planToShape, toScene } from "@/lib/scene";
import { RouteRibbon } from "./RouteRibbon";
import { RouteTransition } from "./RouteTransition";
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
  const labelGroup = useRef<THREE.Group>(null);
  // Labels are mounted the first time they are wanted and only hidden after that. Mounting and
  // unmounting a dozen text meshes as the camera crossed a distance threshold stalled the frame.
  const [labelsMounted, setLabelsMounted] = useState(showLabels);
  if (showLabels && !labelsMounted) setLabelsMounted(true);

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
    const labels = labelGroup.current;
    if (labels) {
      const near = Math.hypot(camera.position.x - g.position.x, camera.position.y - g.position.y, camera.position.z - g.position.z) < LABEL_VISIBLE_DISTANCE;
      const visible = showLabels && near;
      if (labels.visible !== visible) labels.visible = visible;
    }
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
      {/*
        The `key` on each material matters: turning `transparent` on or off needs a new shader, and
        three will not recompile one in place. Without it a level that was lit once stayed lit for the
        rest of the session, however the focus changed.
      */}
      <mesh geometry={slab}>
        <meshStandardMaterial key={dimmed ? "dim" : "lit"} color="#f2efe9" transparent={dimmed} opacity={opacity} roughness={0.95} />
      </mesh>
      {rooms.map(({ color, geometry }) => (
        <mesh key={color} geometry={geometry}>
          <meshStandardMaterial key={dimmed ? "dim" : "lit"} color={color} transparent={dimmed} opacity={opacity} roughness={0.8} />
        </mesh>
      ))}
      {labelsMounted && (
        <group ref={labelGroup} visible={false}>
          {labels.map((label) => {
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
        </group>
      )}
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
          <sphereGeometry args={[0.45, 16, 16]} />
          <meshStandardMaterial color="#16a34a" />
        </mesh>
      )}
      {isEnd && last && (
        <mesh position={[last[0], last[1] + 1.0, last[2]]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.5, 1.4, 16]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
      )}
    </>
  );
}

/**
 * Camera control: a thin shell around `createController`, which owns every gesture. This only turns
 * DOM events into controller calls, applies the pose to the camera, and runs guided flights.
 *
 * Framing still only happens through an explicit flight, never as a side effect of state changing.
 */
function CameraRig({
  flight,
  maxDistance,
  onTakeover,
  onZoomApi,
  modelCentre,
  modelRadius,
}: {
  flight: Flight | null;
  maxDistance: number;
  onTakeover: () => void;
  onZoomApi: (zoom: (factor: number) => void) => void;
  modelCentre: Vec3;
  modelRadius: number;
}) {
  const { camera, gl, size } = useThree();
  const active = useRef<{ flight: Flight; from: Pose; started: number } | null>(null);
  /** Where the camera looks. Held here because the camera object only stores where it is. */
  const target = useRef(new THREE.Vector3(...modelCentre));
  const takeoverRef = useRef(onTakeover);
  takeoverRef.current = onTakeover;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const limitsRef = useRef({ min: MIN_ZOOM_DISTANCE, max: maxDistance });
  limitsRef.current = { min: MIN_ZOOM_DISTANCE, max: maxDistance };

  const poseNow = useCallback(
    (): Pose => ({
      eye: [camera.position.x, camera.position.y, camera.position.z],
      target: [target.current.x, target.current.y, target.current.z],
    }),
    [camera],
  );

  const startFlight = useCallback(
    (f: Flight) => {
      if (f.immediate) {
        apply(camera, target.current, f.to);
        active.current = null;
        f.onArrive?.();
      } else active.current = { flight: f, from: poseNow(), started: performance.now() };
    },
    [camera, poseNow],
  );

  const { scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  /** The nearest visible surface under a screen position. */
  const pick = useCallback(
    (x: number, y: number): Vec3 | null => {
      const { width, height } = sizeRef.current;
      ndc.set((x / width) * 2 - 1, 1 - (y / height) * 2);
      raycaster.setFromCamera(ndc, camera);
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        let shown = true;
        for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (!o.visible) shown = false;
        if (shown && hit.object.type === "Mesh") return [hit.point.x, hit.point.y, hit.point.z];
      }
      return null;
    },
    [camera, scene, raycaster, ndc],
  );

  const controller = useMemo(
    () =>
      createController({
        getPose: poseNow,
        setPose: (pose) => apply(camera, target.current, pose),
        viewport: () => ({ width: sizeRef.current.width, height: sizeRef.current.height }),
        fovDegrees: (camera as THREE.PerspectiveCamera).fov ?? 45,
        limits: () => limitsRef.current,
        pick,
        centre: modelCentre,
        radius: modelRadius,
        onTakeover: () => {
          active.current = null;
          takeoverRef.current();
        },
        animateTo: (pose, ms) => {
          active.current = { flight: { to: pose, ms, key: -1 } as Flight, from: poseNow(), started: performance.now() };
        },
      }),
    [camera, poseNow, pick, modelCentre, modelRadius],
  );

  useEffect(() => {
    const element = gl.domElement;
    const local = (e: { clientX: number; clientY: number }) => {
      const rect = element.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const info = (e: PointerEvent) => ({
      id: e.pointerId,
      ...local(e),
      time: e.timeStamp,
      type: e.pointerType as "mouse" | "touch" | "pen",
      button: e.button,
      shift: e.shiftKey,
    });

    const onDown = (e: PointerEvent) => {
      // Mouse: only left, middle and right start something.
      if (e.pointerType === "mouse" && e.button > 2) return;
      // Captured, so the release always arrives here even if the finger leaves the canvas or the
      // browser was about to start something else. A lost release is what "stuck" looks like.
      try {
        element.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
      controller.down(info(e));
      element.style.cursor = e.pointerType === "mouse" ? "grabbing" : "";
    };
    const onMove = (e: PointerEvent) => {
      if (controller.pointerCount === 0) return;
      controller.move(info(e));
    };
    const onUp = (e: PointerEvent) => {
      controller.up(info(e));
      if (controller.pointerCount === 0) element.style.cursor = "grab";
    };
    const onCancel = (e: PointerEvent) => {
      controller.cancel(e.pointerId);
      if (controller.pointerCount === 0) element.style.cursor = "grab";
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      controller.wheel({ deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey, timeStamp: e.timeStamp, ...local(e) });
    };
    const stop = (e: Event) => e.preventDefault();
    const onBlur = () => controller.reset();

    element.style.cursor = "grab";
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onCancel);
    element.addEventListener("lostpointercapture", onCancel);
    element.addEventListener("wheel", onWheel, { passive: false });
    // No browser selection, context menu, drag ghost or double-tap zoom on the model.
    element.addEventListener("contextmenu", stop);
    element.addEventListener("dblclick", stop);
    element.addEventListener("selectstart", stop);
    element.addEventListener("dragstart", stop);
    window.addEventListener("blur", onBlur);
    return () => {
      controller.reset();
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onCancel);
      element.removeEventListener("lostpointercapture", onCancel);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("contextmenu", stop);
      element.removeEventListener("dblclick", stop);
      element.removeEventListener("selectstart", stop);
      element.removeEventListener("dragstart", stop);
      window.removeEventListener("blur", onBlur);
    };
  }, [gl, controller]);

  // The on-screen buttons zoom without a gesture.
  useEffect(() => {
    onZoomApi((factor: number) => {
      active.current = null;
      takeoverRef.current();
      apply(camera, target.current, zoomPose(poseNow(), factor, null, { width: size.width, height: size.height }, (camera as THREE.PerspectiveCamera).fov ?? 45, limitsRef.current));
    });
  }, [camera, onZoomApi, poseNow, size.width, size.height]);

  // Flights are queued and started in the frame loop so they begin from the camera's actual pose.
  const queued = useRef<Flight | null>(null);
  useEffect(() => {
    if (flight) queued.current = flight;
  }, [flight]);

  useFrame((_, delta) => {
    const next = queued.current;
    if (next) {
      queued.current = null;
      startFlight(next);
    }
    controller.tick(delta * 1000);

    const run = active.current;
    if (!run) return;
    const t = Math.min(1, (performance.now() - run.started) / run.flight.ms);
    apply(camera, target.current, lerpPose(run.from, run.flight.to, t));
    if (t >= 1) {
      active.current = null;
      run.flight.onArrive?.();
    }
  });

  return null;
}

/** Closest the camera may get to what it is looking at. */
const MIN_ZOOM_DISTANCE = 2;

function apply(camera: THREE.Camera, target: THREE.Vector3, pose: Pose): void {
  camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
  target.set(pose.target[0], pose.target[1], pose.target[2]);
  camera.lookAt(target);
}

interface FlightTiming {
  ms: number;
  key: number;
  immediate?: boolean;
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
  /** The guide step being shown, used to frame the camera and to highlight its stretch of path. */
  activeStep: GuideStep | null;
  /** Bumped when the guide wants a new flight; null means "leave the camera alone". */
  flightRequest: { kind: "overview" } & FlightTiming | ({ kind: "step"; step: GuideStep } & FlightTiming) | null;
  /** The user asked to see every level, which overrides the route's own dimming and cutaway. */
  showAll: boolean;
  onFlightArrive: () => void;
  onTakeover: () => void;
  focusLevel: string | null;
  onSelectLevel: (levelId: string) => void;
  /** Overrides the trackpad/mouse guess when the user tells us which they have. */
  onZoomApi: (zoom: (factor: number) => void) => void;
}

export function Scene({
  data,
  view,
  routeLevels,
  geometry,
  activeStep,
  flightRequest,
  showAll,
  onFlightArrive,
  onTakeover,
  focusLevel,
  onSelectLevel,
  onZoomApi,
}: SceneProps) {
  const heights = useMemo(() => levelHeights(data.building, data.levels, view), [data, view]);
  const { size } = useThreeSafe();

  const buildingBounds = useMemo(
    () => boundsOf(data.levels.flatMap((l) => l.outline.map((p) => toScene(p, heights.get(l.id) ?? 0)))),
    [data.levels, heights],
  );

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
    const overview = (): Flight => ({
      to: overviewPose(buildingBounds.center, buildingBounds.radius, aspect),
      ms: flightRequest.ms,
      key: flightRequest.key,
      onArrive: onFlightArrive,
    });
    const step = flightRequest.step;

    if (step.kind === "vertical") {
      // Stairs and lifts have no ribbon of their own, so look at the shaft from just above it.
      const riser = riserEndingAt(geometry, step.toNodeId);
      if (!riser) return overview();
      const from = toScene(riser.at, heights.get(riser.fromLevelId) ?? 0);
      const to = toScene(riser.to, heights.get(riser.toLevelId) ?? 0);
      const centre: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + 2, (from[2] + to[2]) / 2];
      return {
        to: { eye: [centre[0] + 14, centre[1] + 11, centre[2] + 14], target: centre },
        ms: flightRequest.ms,
        key: flightRequest.key,
        onArrive: onFlightArrive,
      };
    }

    // A walking step is framed by its own stretch of path, found through the nodes it runs between.
    const span = stepSpan(geometry, step);
    if (!span) return overview();
    const levelY = heights.get(span.ribbon.levelId) ?? 0;
    const level = data.levels.find((l) => l.id === span.ribbon.levelId);
    const ceiling = view === "solid" && level ? levelY + level.heightM - 0.6 : undefined;
    return { to: spanPose(span.ribbon, span.startDistance, span.endDistance, levelY, ceiling), ms: flightRequest.ms, key: flightRequest.key, onArrive: onFlightArrive };
    // `heights` changes identity on every view toggle; keying on the request is what stops the camera
    // being re-framed behind the user's back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightRequest?.key, geometry, buildingBounds, size.width, size.height]);

  const order = new Map(data.building.levels.map((l) => [l.id, l.sortIndex]));
  const visibility = levelVisibility({
    levelIds: data.levels.map((l) => l.id),
    order,
    focusLevel,
    routeLevels,
    walkingLevel: activeStep?.levelId ?? null,
    showAll,
    view,
  });
  const dimmed = (levelId: string) => visibility.dimmed.has(levelId);
  const hidden = (levelId: string) => visibility.hidden.has(levelId);
  const labelLevels = visibility.labelled;

  const ribbonsByLevel = new Map<string, LevelRibbon[]>();
  for (const ribbon of geometry?.ribbons ?? []) {
    const list = ribbonsByLevel.get(ribbon.levelId);
    if (list) list.push(ribbon);
    else ribbonsByLevel.set(ribbon.levelId, [ribbon]);
  }
  const lastRibbon = geometry?.ribbons[geometry.ribbons.length - 1];

  return (
    <Canvas camera={{ fov: 45, near: 0.5, far: 4000 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <color attach="background" args={["#eef1f5"]} />
      <hemisphereLight intensity={0.85} groundColor="#cbd5e1" />
      <directionalLight position={[60, 120, 40]} intensity={1.5} />
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
              <RouteRibbon ribbon={ribbon} active={geometry ? ribbonActivity(geometry, activeStep, ribbon) : null} />
              <RouteMarkers ribbon={ribbon} isStart={ribbon === geometry?.ribbons[0]} isEnd={ribbon === lastRibbon} />
            </group>
          ))}
        </LevelMesh>
      ))}
      {(geometry?.risers ?? []).map((riser) => (
        <RouteTransition
          key={`${riser.stepIndex}-${riser.fromLevelId}`}
          transition={riser}
          fromY={heights.get(riser.fromLevelId) ?? 0}
          toY={heights.get(riser.toLevelId) ?? 0}
          levelName={data.levels.find((l) => l.id === riser.toLevelId)?.displayName ?? riser.toLevelId}
          exploded={view === "exploded"}
        />
      ))}
      <CameraRig
        flight={flight}
        maxDistance={buildingBounds.radius * 4}
        onTakeover={onTakeover}
        onZoomApi={onZoomApi}
        modelCentre={buildingBounds.center}
        modelRadius={buildingBounds.radius}
      />
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
