import * as THREE from 'three';

export interface HeightmapMeta { file: string; nx: number; ny: number; bx0: number; bx1: number; by0: number; by1: number }

/** Terrain heights exported from Blender. three (x, z) maps to Blender (x, -z). */
export class Heightfield {
  readonly texture: THREE.DataTexture;

  constructor(private data: Float32Array, private m: HeightmapMeta) {
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    const tex = new THREE.DataTexture(half, m.nx, m.ny, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.texture = tex;
  }

  get bounds() { return new THREE.Vector4(this.m.bx0, this.m.bx1, this.m.by0, this.m.by1); }

  /** Bilinear terrain height at three.js world (x, z). */
  sample(x: number, z: number): number {
    const { nx, ny, bx0, bx1, by0, by1 } = this.m;
    const fx = THREE.MathUtils.clamp(((x - bx0) / (bx1 - bx0)) * (nx - 1), 0, nx - 1.001);
    const fy = THREE.MathUtils.clamp(((-z - by0) / (by1 - by0)) * (ny - 1), 0, ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const d = this.data;
    const a = d[j * nx + i], b = d[j * nx + i + 1], c = d[(j + 1) * nx + i], e = d[(j + 1) * nx + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
  }
}
