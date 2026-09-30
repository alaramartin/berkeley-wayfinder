"use client";
/**
 * Where the route changes floor. A cone alone reads as scenery, so this draws a riser that visibly
 * spans the gap between the two levels, with arrows climbing it and a label at each end.
 */
import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { MergedTransition } from "@/lib/route-geometry";
import { ROUTE_COLOR, SLAB_THICKNESS, toScene } from "@/lib/scene";

const RISER_RADIUS = 0.28;
/** One climbing arrow per this many metres of riser. */
const ARROW_SPACING_M = 2.2;

function Pill({ text, position }: { text: string; position: [number, number, number] }) {
  return (
    <Billboard position={position}>
      <mesh>
        <planeGeometry args={[Math.max(3, text.length * 0.42), 1]} />
        <meshBasicMaterial color="#ffffff" opacity={0.92} transparent depthWrite={false} />
      </mesh>
      <Text position={[0, 0, 0.01]} fontSize={0.58} color="#1f2937" anchorX="center" anchorY="middle">
        {text}
      </Text>
    </Billboard>
  );
}

export function RouteTransition({
  transition,
  fromY,
  toY,
  levelName,
  exploded,
}: {
  transition: MergedTransition;
  fromY: number;
  toY: number;
  levelName: string;
  exploded: boolean;
}) {
  const arrows = useRef<THREE.Group>(null);

  const [start, end] = useMemo(() => {
    const a = toScene(transition.at, fromY + SLAB_THICKNESS);
    const b = toScene(transition.to, toY + SLAB_THICKNESS);
    return [new THREE.Vector3(...a), new THREE.Vector3(...b)];
  }, [transition, fromY, toY]);

  const up = end.y > start.y;
  const label = `${transition.kind === "elevator" ? "Elevator" : "Stairs"} ${up ? "up" : "down"} to Level ${levelName}`;

  // Arrows climb the riser; in solid view the levels touch, so there is nothing to span.
  const { length, midpoint, quaternion, count } = useMemo(() => {
    const direction = new THREE.Vector3().subVectors(end, start);
    const len = direction.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    return {
      length: len,
      midpoint: new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5),
      quaternion: q,
      count: Math.max(1, Math.floor(len / ARROW_SPACING_M)),
    };
  }, [start, end]);

  useFrame((_, delta) => {
    const g = arrows.current;
    if (!g) return;
    // Arrows slide along the riser and wrap, so it reads as movement in the travel direction.
    for (const child of g.children) {
      child.position.y += (up ? 1 : -1) * delta * 1.6;
      if (up && child.position.y > length / 2) child.position.y -= length;
      if (!up && child.position.y < -length / 2) child.position.y += length;
    }
  });

  if (!exploded) {
    // Levels are stacked solid: mark the shaft on the floor and say where it goes.
    return (
      <group position={start}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
          <circleGeometry args={[1.1, 24]} />
          <meshBasicMaterial color={ROUTE_COLOR} transparent opacity={0.85} depthWrite={false} />
        </mesh>
        <Pill text={label} position={[0, 2.6, 0]} />
      </group>
    );
  }

  return (
    <group>
      <group position={midpoint} quaternion={quaternion}>
        <mesh>
          <cylinderGeometry args={[RISER_RADIUS, RISER_RADIUS, length, 12, 1, true]} />
          <meshBasicMaterial color={ROUTE_COLOR} transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <group ref={arrows}>
          {Array.from({ length: count }, (_, i) => (
            <mesh key={i} position={[0, -length / 2 + (i + 0.5) * (length / count), 0]} rotation={[up ? 0 : Math.PI, 0, 0]}>
              <coneGeometry args={[RISER_RADIUS * 1.9, 0.9, 10]} />
              <meshBasicMaterial color={ROUTE_COLOR} />
            </mesh>
          ))}
        </group>
      </group>
      <Pill text={label} position={[start.x, start.y + 2.2, start.z]} />
      <mesh position={[end.x, end.y + 0.06, end.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.8, 1.15, 24]} />
        <meshBasicMaterial color={ROUTE_COLOR} transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </group>
  );
}
