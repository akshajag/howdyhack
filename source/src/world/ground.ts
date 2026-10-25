import * as THREE from 'three';
import { env } from '../core/env';
import type { Chunk } from '../game/types';

/**
 * Ground for a streamed course:
 *  - GroundStrip: a sliding heightfield texture (64 across x 512 along) that feeds the water shader (depth colour,
 *    shoreline foam) and the caustic overhang test, in place of the old static level heightmap.
 *  - ChunkGround: a pooled vertex-coloured mesh per chunk, sampled from the chunk's ground function.
 */
export const GROUND_HALF = 64;          // metres each side covered by the ground mesh and the strip
const STRIP_NX = 64, STRIP_NZ = 512, STRIP_LEN = 640;

export class GroundStrip {
  readonly texture: THREE.DataTexture;
  private data = new Uint16Array(STRIP_NX * STRIP_NZ);
  private floats = new Float32Array(STRIP_NX * STRIP_NZ);
  /** world z at the far (forward) edge and the near edge of the window */
  private zFar = 0; private zNear = 0;
  constructor(private heightAt: (x: number, z: number) => number) {
    const tex = new THREE.DataTexture(this.data, STRIP_NX, STRIP_NZ, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    this.texture = tex;
  }

  /** Rebuild so the window spans [playerZ - behind, playerZ - behind - STRIP_LEN] (remember forward is -z). */
  rebuild(playerZ: number, behind = 90) {
    this.zNear = playerZ + behind;
    this.zFar = this.zNear - STRIP_LEN;
    // heightfield convention: uv.y = (-z - by0) / (by1 - by0), rows j from by0 (= -zNear) to by1 (= -zFar)
    const by0 = -this.zNear, by1 = -this.zFar;
    for (let j = 0; j < STRIP_NZ; j++) {
      const z = -(by0 + (by1 - by0) * (j / (STRIP_NZ - 1)));
      for (let i = 0; i < STRIP_NX; i++) {
        const x = -GROUND_HALF + (2 * GROUND_HALF) * (i / (STRIP_NX - 1));
        const h = this.heightAt(x, z);
        this.floats[j * STRIP_NX + i] = h;
        this.data[j * STRIP_NX + i] = THREE.DataUtils.toHalfFloat(h);
      }
    }
    this.texture.needsUpdate = true;
    env.uHeightTex.value = this.texture;
    env.uHeightBounds.value.set(-GROUND_HALF, GROUND_HALF, by0, by1);
  }

  /** does the window still comfortably cover the player? */
  covers(playerZ: number) { return playerZ < this.zNear - 40 && playerZ > this.zFar + 300; }

  sample(x: number, z: number) {
    const fx = THREE.MathUtils.clamp(((x + GROUND_HALF) / (2 * GROUND_HALF)) * (STRIP_NX - 1), 0, STRIP_NX - 1.001);
    const fy = THREE.MathUtils.clamp(((-z + this.zNear) / STRIP_LEN) * (STRIP_NZ - 1), 0, STRIP_NZ - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, d = this.floats;
    const a = d[j * STRIP_NX + i], b = d[j * STRIP_NX + i + 1], c = d[(j + 1) * STRIP_NX + i], e = d[(j + 1) * STRIP_NX + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
  }
}

// ---------------------------------------------------------------- per-chunk ground meshes
// the +x side runs on past the strip to the beach's back hills so the land meets the horizon instead of ending
const COLS = [-64, -52, -42, -34, -28, -23, -19, -16, -13.5, -11.5, -10, -8.5, -7, -5.5, -4, -2.5, -1, 0.5, 2, 3.5, 5, 6.5, 8, 9.5, 11, 12.5, 14.5, 17, 20, 24, 29, 35, 43, 53, 64, 78, 94, 112, 135];
const NX = COLS.length;
const STEP = 2.0;

export type GroundPaint = (x: number, along: number, h: number, out: THREE.Color) => void;

interface GroundSlot { mesh: THREE.Mesh; rows: number; inUse: boolean }

export class GroundMeshes {
  readonly group = new THREE.Group();
  private slots: GroundSlot[] = [];
  constructor(private material: THREE.Material) {}

  private make(rows: number): GroundSlot {
    const n = rows * NX;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const idx: number[] = [];
    // rows advance toward -z, columns toward +x: (a, b, c) / (b, d, c) is counter-clockwise seen from above (+y normal)
    for (let r = 0; r < rows - 1; r++) for (let i = 0; i < NX - 1; i++) {
      const a = r * NX + i, b = a + 1, c = a + NX, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const slot = { mesh, rows, inUse: false };
    this.slots.push(slot);
    this.group.add(mesh);
    return slot;
  }

  /** Build (or reuse) a ground mesh for the chunk. Returns a handle to release later. */
  build(chunk: Chunk, paint: GroundPaint): GroundSlot {
    const rows = Math.ceil(chunk.length / STEP) + 1;
    let slot = this.slots.find((s) => !s.inUse && s.rows === rows);
    if (!slot) slot = this.make(rows);
    slot.inUse = true;
    const pos = slot.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = slot.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let r = 0; r < rows; r++) {
      const along = Math.min(chunk.length, r * STEP);
      for (let i = 0; i < NX; i++) {
        const x = COLS[i];
        const h = chunk.ground(x, along);
        const k = r * NX + i;
        pos.setXYZ(k, x, h, chunk.zStart - along);
        paint(x, along, h, c);
        col.setXYZ(k, c.r, c.g, c.b);
      }
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    slot.mesh.geometry.computeVertexNormals();
    slot.mesh.visible = true;
    return slot;
  }

  release(slot: GroundSlot) { slot.inUse = false; slot.mesh.visible = false; }
}
