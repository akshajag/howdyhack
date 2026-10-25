import * as THREE from 'three';
import { loadMesh } from '../core/assets';

/**
 * Instanced pools for streamed chunks: one InstancedMesh per kit with a free list. Chunks allocate slots when they
 * spawn and release them when recycled, so geometry never grows with distance.
 */
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpC = new THREE.Color();

export class InstancePool {
  readonly mesh: THREE.InstancedMesh;
  private free: number[] = [];
  private dirty = false;
  high = 0;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number, shadow: boolean) {
    const m = new THREE.InstancedMesh(geometry, material, capacity);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = shadow; m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    for (let i = 0; i < capacity; i++) m.setMatrixAt(i, ZERO);
    this.mesh = m;
  }

  alloc(matrix: THREE.Matrix4, tint?: [number, number, number] | THREE.Color): number {
    const i = this.free.pop();
    if (i === undefined) return -1;                                   // pool exhausted: the piece is simply not drawn
    this.mesh.setMatrixAt(i, matrix);
    if (tint) { if (tint instanceof THREE.Color) tmpC.copy(tint); else tmpC.setRGB(tint[0], tint[1], tint[2]); }
    else tmpC.setRGB(1, 1, 1);
    this.mesh.setColorAt(i, tmpC);
    if (i + 1 > this.mesh.count) this.mesh.count = i + 1;
    this.high = Math.max(this.high, this.mesh.count);
    this.dirty = true;
    return i;
  }

  release(i: number) {
    if (i < 0) return;
    this.mesh.setMatrixAt(i, ZERO);
    this.free.push(i);
    this.dirty = true;
  }

  setMatrix(i: number, m: THREE.Matrix4) { if (i >= 0) { this.mesh.setMatrixAt(i, m); this.dirty = true; } }

  flush() {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.dirty = false;
  }

  get used() { return this.capacity - this.free.length; }
}

export interface KitDef { url: string; family: string; capacity?: number; shadow?: boolean; /** move the pivot to the base centre on load (world-authored meshes) */ recenter?: boolean }

/** Loads kit GLBs and owns one pool per kit. */
export class KitLibrary {
  readonly group = new THREE.Group();
  readonly pools = new Map<string, InstancePool>();
  readonly bounds = new Map<string, THREE.Box3>();
  private materialFor: (family: string, kit: string, gltf: THREE.Material | null) => THREE.Material;

  constructor(materialFor: KitLibrary['materialFor']) { this.materialFor = materialFor; }

  async load(defs: Record<string, KitDef>) {
    await Promise.all(Object.entries(defs).map(async ([name, d]) => {
      if (this.pools.has(name)) return;
      try {
        const { geometry, material } = await loadMesh(d.url);
        geometry.computeBoundingBox();
        if (d.recenter) {
          const bb = geometry.boundingBox!;
          geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
        }
        this.bounds.set(name, geometry.boundingBox!.clone());
        const pool = new InstancePool(geometry, this.materialFor(d.family, name, material), d.capacity ?? 256, d.shadow ?? true);
        this.pools.set(name, pool);
        this.group.add(pool.mesh);
      } catch (e) {
        console.warn(`kit ${name} failed to load from ${d.url}:`, (e as Error).message);
      }
    }));
  }

  has(name: string) { return this.pools.has(name); }
  pool(name: string) { return this.pools.get(name) ?? null; }

  flush() { for (const p of this.pools.values()) p.flush(); }

  stats() {
    let used = 0, cap = 0;
    for (const p of this.pools.values()) { used += p.used; cap += p.capacity; }
    return { used, cap, kits: this.pools.size };
  }
}
