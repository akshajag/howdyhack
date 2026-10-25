import * as THREE from 'three';
import { env } from '../core/env';
import type { Runner } from '../game/runner';

/**
 * The board's wake: a ribbon of foam laid on the water behind the tail. Samples stay where they were dropped, so
 * carving draws a curve on the wave; the ribbon spreads and fades over a second and a half. Gaps while airborne.
 */
const N = 72, LIFE = 1.6;
interface Sample { x: number; y: number; z: number; t: number; gap: boolean }

export class Wake {
  readonly mesh: THREE.Mesh;
  private pts: Sample[] = [];
  private pos = new Float32Array(N * 2 * 3);
  private a = new Float32Array(N * 2);
  private u = new Float32Array(N * 2);
  private geo = new THREE.BufferGeometry();
  private since = 0;

  constructor() {
    const idx: number[] = [];
    for (let i = 0; i + 1 < N; i++) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aU', new THREE.BufferAttribute(this.u, 1));
    for (let i = 0; i < N; i++) { this.u[i * 2] = -1; this.u[i * 2 + 1] = 1; }
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { uTime: env.uTime },
      vertexShader: /* glsl */ `
        attribute float aAlpha; attribute float aU;
        varying float vA; varying float vU; varying vec3 vW;
        void main() { vA = aAlpha; vU = aU; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying float vA; varying float vU; varying vec3 vW;
        float h(vec2 p) { return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float edge = 1.0 - smoothstep(0.55, 1.0, abs(vU));
          float lace = smoothstep(0.35, 0.75, n(vW.xz * 2.4 + uTime * 0.3) * 0.6 + n(vW.xz * 6.0) * 0.4);
          float a = vA * edge * mix(0.45, 1.0, lace);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.96, 0.99, 1.0), a);
        }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 11; this.mesh.visible = false;
  }

  reset() { this.pts.length = 0; this.mesh.visible = false; }

  update(dt: number, r: Runner, on: boolean) {
    for (const p of this.pts) p.t += dt;
    while (this.pts.length && this.pts[this.pts.length - 1].t > LIFE) this.pts.pop();
    this.since += dt;
    if (on && this.since > 0.035) {
      this.since = 0;
      // (the tail of the board, a little behind the rider, on the water)
      this.pts.unshift({ x: r.pos.x + r.vx * 0.04, y: r.pos.y + 0.05, z: r.pos.z + 0.85, t: 0, gap: r.airborne });
      if (this.pts.length > N) this.pts.length = N;
    }
    const n = this.pts.length;
    this.mesh.visible = n > 1;
    if (n < 2) return;
    for (let i = 0; i < N; i++) {
      const p = this.pts[Math.min(i, n - 1)], q = this.pts[Math.min(i + 1, n - 1)], o = this.pts[Math.min(Math.max(i - 1, 0), n - 1)];
      let dx = o.x - q.x, dz = o.z - q.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const w = 0.28 + 0.9 * (p.t / LIFE), k = i * 2;
      // perpendicular to the trail in the water plane
      this.pos[k * 3] = p.x - dz * w; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z + dx * w;
      this.pos[k * 3 + 3] = p.x + dz * w; this.pos[k * 3 + 4] = p.y; this.pos[k * 3 + 5] = p.z - dx * w;
      const alpha = i >= n - 1 || p.gap ? 0 : Math.pow(1 - p.t / LIFE, 1.6) * 0.85;
      this.a[k] = alpha; this.a[k + 1] = alpha;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}
