import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Heightfield, type HeightmapMeta } from './heightfield';

export interface UniqueEntry { name: string; model: string; family?: string; pos: number[]; quat: number[]; scale: number[] }
export interface ShotEntry { pos: number[]; target: number[]; fov?: number }
export interface SchoolEntry { anchor: [number, number, number]; radius: [number, number, number]; count: number; speed: number; spread: number; maxSpeed: number }
export interface Layout {
  version: number;
  level?: string;
  kits: Record<string, { lod0: string; lod1: string | null; family?: string }>;
  instanceStride: number;
  instances: Record<string, number[][]>;
  unique: UniqueEntry[];
  heightmap: HeightmapMeta;
  shots?: Record<string, ShotEntry>;
  schools?: { schooler: SchoolEntry[]; reef: SchoolEntry[] };
  mantas?: { c: [number, number, number]; r: number; w: number; p: number }[];
  start?: [number, number, number];
  cull?: { under: number; above: number };
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<{ geometry: THREE.BufferGeometry; material: THREE.Material }>>();
let onProgress: (f: number) => void = () => {};
let pending = 0, done = 0;

export function setProgressHandler(fn: (f: number) => void) { onProgress = fn; }

/** Load the first mesh of a GLB (our kit pieces are single-mesh, origin-centred): geometry + its glTF material. */
export function loadMesh(url: string): Promise<{ geometry: THREE.BufferGeometry; material: THREE.Material }> {
  let p = cache.get(url);
  if (!p) {
    pending++;
    p = loader.loadAsync(url).then((gltf) => {
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => {
        if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
      });
      if (!mesh) throw new Error(`no mesh in ${url}`);
      done++;
      onProgress(done / Math.max(pending, 1));
      const m = mesh as THREE.Mesh;
      // Blender sometimes writes a blank COLOR_0 ahead of our painted layer: prefer the painted one
      const g = m.geometry;
      if (g.getAttribute('color_1')) { g.setAttribute('color', g.getAttribute('color_1')); g.deleteAttribute('color_1'); }
      return { geometry: m.geometry, material: (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material };
    });
    cache.set(url, p);
  }
  return p;
}

export async function loadGeometry(url: string): Promise<THREE.BufferGeometry> {
  return (await loadMesh(url)).geometry;
}

export async function loadLayout(path = 'data/layout.json'): Promise<{ layout: Layout; heightfield: Heightfield }> {
  const layout = (await (await fetch(path)).json()) as Layout;
  const buf = await (await fetch(layout.heightmap.file)).arrayBuffer();
  return { layout, heightfield: new Heightfield(new Float32Array(buf), layout.heightmap) };
}

export function applyTransform(o: THREE.Object3D, e: { pos: number[]; quat: number[]; scale: number[] }) {
  o.position.fromArray(e.pos);
  o.quaternion.fromArray(e.quat);
  o.scale.fromArray(e.scale);
}
