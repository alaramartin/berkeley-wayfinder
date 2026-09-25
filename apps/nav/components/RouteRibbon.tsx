"use client";
/**
 * The route drawn as a flat ribbon lying on the floor, with chevrons flowing towards the destination
 * and the path fading out further ahead. It is a real mesh with depth testing on, so a floor above it
 * hides it instead of it floating through the ceiling.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { type LevelRibbon, alphaAt } from "@/lib/route-geometry";
import { ROUTE_COLOR } from "@/lib/scene";

const WIDTH_M = 1.1;
/** One chevron every this many metres. */
const ARROW_PERIOD_M = 2.2;
const MITER_LIMIT = 3;

/**
 * One chevron, drawn once into a canvas and shared by every ribbon. The material multiplies this by
 * the route colour, so the arrow has to be *darker* than the background to show up at all.
 */
let arrowTexture: THREE.Texture | null = null;
function chevronTexture(): THREE.Texture {
  if (arrowTexture) return arrowTexture;
  const w = 128;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  // Chevron pointing along +u, the direction of travel.
  ctx.strokeStyle = "rgba(0,0,0,0.42)";
  ctx.lineWidth = h * 0.16;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(w * 0.34, h * 0.22);
  ctx.lineTo(w * 0.56, h * 0.5);
  ctx.lineTo(w * 0.34, h * 0.78);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  arrowTexture = texture;
  return texture;
}

function ribbonGeometry(ribbon: LevelRibbon): THREE.BufferGeometry {
  const { points, distances } = ribbon;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const half = WIDTH_M / 2;

  for (let i = 0; i < points.length; i++) {
    const previous = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    // Direction in the XZ plane; the ribbon is flat so y never enters the offset.
    let dx = next[0] - previous[0];
    let dz = next[2] - previous[2];
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    // Left normal, scaled by the miter so corners stay the same width without spiking.
    const prevDir = [points[i]![0] - previous[0], points[i]![2] - previous[2]];
    const nextDir = [next[0] - points[i]![0], next[2] - points[i]![2]];
    const pl = Math.hypot(prevDir[0]!, prevDir[1]!) || 1;
    const nl = Math.hypot(nextDir[0]!, nextDir[1]!) || 1;
    const cos = (prevDir[0]! / pl) * (nextDir[0]! / nl) + (prevDir[1]! / pl) * (nextDir[1]! / nl);
    const miter = Math.min(MITER_LIMIT, 1 / Math.max(0.2, Math.sqrt((1 + cos) / 2)));
    const nx = -dz * half * miter;
    const nz = dx * half * miter;
    const [x, y, z] = points[i]!;
    positions.push(x + nx, y, z + nz, x - nx, y, z - nz);
    const u = distances[i]! / ARROW_PERIOD_M;
    uvs.push(u, 0, u, 1);
    colors.push(1, 1, 1, 1, 1, 1, 1, 1);
  }

  const indices: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = (i - 1) * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function RouteRibbon({ ribbon, activeDistance }: { ribbon: LevelRibbon; activeDistance: number | null }) {
  const geometry = useMemo(() => ribbonGeometry(ribbon), [ribbon]);
  const texture = useMemo(() => chevronTexture(), []);
  const material = useRef<THREE.MeshBasicMaterial>(null);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // Fade: what is behind you is dim, the next stretch is bright, further ahead falls away.
  useEffect(() => {
    const color = geometry.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < ribbon.distances.length; i++) {
      const alpha = alphaAt(ribbon.distances[i]!, activeDistance);
      color.setW(i * 2, alpha);
      color.setW(i * 2 + 1, alpha);
    }
    color.needsUpdate = true;
  }, [geometry, ribbon, activeDistance]);

  useFrame((_, delta) => {
    if (material.current?.map) material.current.map.offset.x -= delta * 0.35;
  });

  return (
    <mesh geometry={geometry} renderOrder={2}>
      <meshBasicMaterial
        ref={material}
        color={ROUTE_COLOR}
        map={texture}
        vertexColors
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}
