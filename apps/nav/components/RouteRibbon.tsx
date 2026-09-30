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
import { buildRibbonMesh } from "@/lib/ribbon-mesh";
import { ROUTE_COLOR } from "@/lib/scene";

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
  ctx.lineWidth = h * 0.14;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(w * 0.38, h * 0.28);
  ctx.lineTo(w * 0.56, h * 0.5);
  ctx.lineTo(w * 0.38, h * 0.72);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  arrowTexture = texture;
  return texture;
}

function geometryFor(ribbon: LevelRibbon): THREE.BufferGeometry {
  const mesh = buildRibbonMesh(ribbon.points, ribbon.distances);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(mesh.uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(mesh.colors, 4));
  geometry.setIndex(mesh.indices);
  geometry.computeVertexNormals();
  geometry.userData.vertexDistances = mesh.vertexDistances;
  return geometry;
}

export function RouteRibbon({ ribbon, activeDistance }: { ribbon: LevelRibbon; activeDistance: number | null }) {
  const geometry = useMemo(() => geometryFor(ribbon), [ribbon]);
  const texture = useMemo(() => chevronTexture(), []);
  const material = useRef<THREE.MeshBasicMaterial>(null);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // Fade: what is behind you is dim, the next stretch is bright, further ahead falls away. A bevelled
  // corner emits extra vertex pairs, so the distances come from the mesh rather than the ribbon.
  useEffect(() => {
    const color = geometry.getAttribute("color") as THREE.BufferAttribute;
    const distances = geometry.userData.vertexDistances as number[];
    for (let i = 0; i < distances.length; i++) color.setW(i, alphaAt(distances[i]!, activeDistance));
    color.needsUpdate = true;
  }, [geometry, activeDistance]);

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
