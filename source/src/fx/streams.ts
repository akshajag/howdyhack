import * as THREE from 'three';
import { env, ENV_GLSL } from '../core/env';
import type { Current } from '../game/types';

/**
 * Visible currents: streaks that drift with the water velocity inside each current band (CPU-updated point sprites,
 * one shared buffer). Pearl sparkles and splash motes share the same system so there is one draw call for all motes.
 */
const CAP = 6000;

interface Band { c: Current; zStart: number; start: number; count: number }

export class Streams {
  readonly points: THREE.Points;
  private pos = new Float32Array(CAP * 3);
  private vel = new Float32Array(CAP * 3);
  private life = new Float32Array(CAP);          // >0 for free-flying motes (sparkles / splashes); -1 for stream particles
  private seed = new Float32Array(CAP);
  private bands: Band[] = [];
  private free: number[] = [];
  private moteHead = 0;
  private readonly moteStart = 4800;             // last slots are a ring buffer for one-shot motes

  constructor() {
    for (let i = this.moteStart - 1; i >= 0; i--) this.free.push(i);
    for (let i = 0; i < CAP; i++) { this.seed[i] = Math.random(); this.pos[i * 3 + 1] = -999; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...env, uPixelRatio: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uPixelRatio; uniform float uWaterLevel;
        attribute float aSeed; attribute float aLife;
        varying float vA; varying vec3 vW; varying float vKind;
        void main() {
          vec4 mv = viewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          vW = position;
          vKind = aLife;
          float a = aLife < 0.0 ? 0.55 + 0.45 * sin(uTime * 3.0 + aSeed * 40.0) : clamp(aLife, 0.0, 1.0);
          vA = a * smoothstep(0.5, 2.5, d) * smoothstep(90.0, 30.0, d);
          float size = aLife < 0.0 ? (0.12 + aSeed * 0.1) : (0.08 + aSeed * 0.08) * (0.5 + aLife);
          gl_PointSize = size * 700.0 * uPixelRatio / max(d, 0.5);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        varying float vA; varying vec3 vW; varying float vKind;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float r = length(q);
          float a = smoothstep(0.5, 0.05, r) * vA;
          vec3 col = vKind < 0.0 ? mix(uFogShallow, vec3(1.0), 0.7) : vec3(1.0, 0.92, 0.6);
          float under = vW.y < uWaterLevel ? 1.0 : 0.85;
          gl_FragColor = vec4(col * a * under * 0.9, 1.0);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 22;
  }

  setPixelRatio(r: number) { (this.points.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = r; }

  /** register a current band; returns a handle for removal */
  add(c: Current, zStart: number, waterY: () => number, groundAt: (x: number, z: number) => number): Band | null {
    if (c.visible === false) return null;
    const area = (c.x1 - c.x0) * (c.along1 - c.along0);
    const count = Math.min(140, Math.max(20, Math.floor(area * 0.45)));
    if (this.free.length < count) return null;
    const band: Band = { c, zStart, start: -1, count };
    const slots: number[] = [];
    for (let i = 0; i < count; i++) slots.push(this.free.pop()!);
    band.start = slots[0];
    (band as Band & { slots: number[] }).slots = slots;
    for (const s of slots) {
      this.life[s] = -1;
      this.pos[s * 3] = c.x0 + Math.random() * (c.x1 - c.x0);
      const z = zStart - (c.along0 + Math.random() * (c.along1 - c.along0));
      this.pos[s * 3 + 2] = z;
      const y0 = c.y0 ?? Math.max(groundAt(this.pos[s * 3], z) + 0.3, -1.4), y1 = c.y1 ?? waterY() - 0.15;
      this.pos[s * 3 + 1] = y0 + Math.random() * Math.max(0.05, y1 - y0);
      this.vel[s * 3] = c.vx; this.vel[s * 3 + 1] = c.vy; this.vel[s * 3 + 2] = -c.vAlong;
    }
    this.bands.push(band);
    return band;
  }

  remove(b: Band | null) {
    if (!b) return;
    const slots = (b as Band & { slots: number[] }).slots;
    for (const s of slots) { this.pos[s * 3 + 1] = -999; this.life[s] = 0; this.free.push(s); }
    this.bands.splice(this.bands.indexOf(b), 1);
  }

  /** one-shot mote (sparkle / splash droplet) */
  mote(x: number, y: number, z: number, vx: number, vy: number, vz: number, life = 1) {
    const s = this.moteStart + (this.moteHead++ % (CAP - this.moteStart));
    this.pos[s * 3] = x; this.pos[s * 3 + 1] = y; this.pos[s * 3 + 2] = z;
    this.vel[s * 3] = vx; this.vel[s * 3 + 1] = vy; this.vel[s * 3 + 2] = vz;
    this.life[s] = life;
  }
  burst(x: number, y: number, z: number, n: number, speed: number, up = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = speed * (0.3 + Math.random() * 0.7);
      this.mote(x, y, z, Math.cos(a) * r, up + Math.random() * speed * 0.6, Math.sin(a) * r, 0.6 + Math.random() * 0.5);
    }
  }

  update(dt: number, waterY: number) {
    const p = this.pos, v = this.vel;
    for (const b of this.bands) {
      const c = b.c;
      const slots = (b as Band & { slots: number[] }).slots;
      const zA = b.zStart - c.along0, zB = b.zStart - c.along1;   // zA > zB
      for (const s of slots) {
        const i = s * 3;
        p[i] += v[i] * dt; p[i + 1] += v[i + 1] * dt; p[i + 2] += v[i + 2] * dt;
        if (p[i] < c.x0) p[i] = c.x1 - 0.01; else if (p[i] > c.x1) p[i] = c.x0 + 0.01;
        if (p[i + 2] < zB) p[i + 2] = zA - 0.01; else if (p[i + 2] > zA) p[i + 2] = zB + 0.01;
        const top = c.y1 ?? waterY - 0.15, bottom = c.y0 ?? -1.6;
        if (p[i + 1] > top) p[i + 1] = bottom + 0.05; else if (p[i + 1] < bottom) p[i + 1] = top - 0.05;
      }
    }
    for (let s = this.moteStart; s < CAP; s++) {
      if (this.life[s] <= 0) continue;
      const i = s * 3;
      this.life[s] -= dt * 1.4;
      v[i + 1] -= (p[i + 1] > waterY ? 9.0 : 0.8) * dt;
      p[i] += v[i] * dt; p[i + 1] += v[i + 1] * dt; p[i + 2] += v[i + 2] * dt;
      if (this.life[s] <= 0) p[i + 1] = -999;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true;
  }
}
