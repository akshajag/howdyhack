import * as THREE from 'three';
import { loadMesh } from '../core/assets';
import { patchMaterial } from '../core/env';
import { PUFF, type Dust } from '../fx/dust';
import type { Runner } from './runner';
import type { ChunkManager } from './chunks';

/**
 * Life on the reef floor that notices you (cosmetic, no collision):
 *  - garden eels: colonies sticking up out of the sand on open patches beside your line, heads bent into the current,
 *    swaying. As you swim close they drop into their burrows, the nearest first, so a ripple runs through the colony;
 *    once you're past they ease back out (real ones do just this when a diver comes near)
 *  - an octopus sitting on the seabed beside your line; come within a few metres and it inks and jets away, mantle
 *    first, in pulses
 */
const EELS = 220, EEL_H = 0.72;
interface Colony { live: boolean; x: number; z: number; first: number; count: number }
interface Octo { mesh: THREE.Mesh; live: boolean; state: 'sit' | 'jet'; x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number }

export class ReefLife {
  readonly group = new THREE.Group();
  private eels!: THREE.InstancedMesh;
  private out = new Float32Array(EELS);         // 1 standing out of the sand .. 0 down in its burrow
  private wait = new Float32Array(EELS);        // s before it dares come back out
  private base: { x: number; y: number; z: number; live: boolean }[] = [];
  private colonies: Colony[] = [];
  private octos: Octo[] = [];
  private clock = 0;
  private nextColony = 3; private nextOcto = 8;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3();

  constructor(private material: THREE.Material, private dust: Dust) {}

  async load() {
    // a garden eel: a slim tube, a little thicker at the head, base at y = 0
    const g = new THREE.CylinderGeometry(0.026, 0.03, EEL_H, 6, 10, false).translate(0, EEL_H / 2, 0);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y > EEL_H - 0.12) { const k = 1.25 - Math.abs(y - (EEL_H - 0.05)) * 3; pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); } }
    g.computeVertexNormals();
    g.setAttribute('aOut', new THREE.InstancedBufferAttribute(this.out, 1).setUsage(THREE.DynamicDrawUsage));
    const ph = new Float32Array(EELS); for (let i = 0; i < EELS; i++) ph[i] = Math.random() * 6.28;
    g.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color('#fbf6e6'), roughness: 0.5, emissive: new THREE.Color('#3a3628') }), {
      vertexHeader: `attribute float aOut; attribute float aPh; varying vec3 vEel;`,
      deform: /* glsl */ `
        {
          vEel = position;
          float k = clamp(position.y / ${EEL_H.toFixed(2)}, 0.0, 1.0);
          // down into the burrow, tail first; out, the body sways and the head hooks into the current
          transformed.y -= (1.0 - aOut) * ${(EEL_H + 0.08).toFixed(2)};
          transformed.x += sin(uTime * 1.5 + aPh) * 0.05 * k * k * aOut;
          transformed.z += (k * k * k * 0.2 + sin(uTime * 1.1 + aPh * 1.7) * 0.02 * k) * aOut;
        }`,
      fragmentHeader: `varying vec3 vEel;`,
      // spotted, with a dark eye near the head
      albedoHook: /* glsl */ `
        {
          float spot = step(0.68, t12_noise(vec2(atan(vEel.z, vEel.x) * 2.0, vEel.y * 28.0)));
          diffuseColor.rgb *= 1.0 - 0.45 * spot;
          float eye = smoothstep(0.012, 0.006, length(vec2(abs(vEel.x) - 0.022, vEel.y - ${(EEL_H - 0.05).toFixed(2)}))) * step(0.0, -vEel.z);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), eye);
        }`,
    });
    this.eels = new THREE.InstancedMesh(g, mat, EELS);
    this.eels.frustumCulled = false; this.eels.castShadow = false;
    this.m4.makeScale(0, 0, 0);
    for (let i = 0; i < EELS; i++) { this.eels.setMatrixAt(i, this.m4); this.base.push({ x: 0, y: 0, z: 0, live: false }); }
    this.group.add(this.eels);
    for (let i = 0; i < 6; i++) this.colonies.push({ live: false, x: 0, z: 0, first: i * 36, count: 0 });
    const octo = await loadMesh('runner/models/Octopus.glb');
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(octo.geometry, this.material); m.visible = false; m.castShadow = true;
      this.group.add(m); this.octos.push({ mesh: m, live: false, state: 'sit', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 });
    }
  }

  reset() {
    for (const c of this.colonies) this.freeColony(c);
    for (const o of this.octos) { o.live = false; o.mesh.visible = false; }
    this.nextColony = this.clock + 3; this.nextOcto = this.clock + 8;
  }

  private open(world: ChunkManager, x: number, z: number, rad: number) {
    for (const { chunk, ob } of world.obstaclesNear(z, rad + 6)) {
      const s = ob.shape, oz = chunk.zStart - s.along, half = s.kind === 'sphere' ? s.r : Math.max(s.sx, s.sz) / 2;
      if (Math.abs(oz - z) < half + rad && Math.abs(s.x - x) < half + rad) return false;
    }
    const ch = world.chunkAt(z);
    if (!ch) return false;
    for (const p of ch.props) if (Math.abs(p.x - x) < rad + 1 && Math.abs(ch.zStart - p.along - z) < rad + 1) return false;
    if ((ch.rings ?? []).some((g) => Math.abs(ch.zStart - g.along - z) < rad + 5)) return false;
    return true;
  }

  private freeColony(c: Colony) {
    c.live = false;
    this.m4.makeScale(0, 0, 0);
    for (let i = c.first; i < c.first + c.count; i++) { this.base[i].live = false; this.eels.setMatrixAt(i, this.m4); }
    this.eels.instanceMatrix.needsUpdate = true;
  }

  private spawnColony(r: Runner, world: ChunkManager, waterY: number) {
    const c = this.colonies.find((q) => !q.live);
    const z = r.pos.z - 42 - Math.random() * 16, ch = world.chunkAt(z);
    if (!c || !ch || ch.biome !== 'coral' || ch.mode !== 'swim' || ch.tide === 'surge') return false;
    const x = THREE.MathUtils.clamp(r.pos.x + (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 5), -11, 11);
    const g0 = world.groundAt(x, z);
    // an open, level patch of sand, well under the surface
    if (g0 > waterY - 4 || [[1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8]].some(([dx, dz]) => Math.abs(world.groundAt(x + dx, z + dz) - g0) > 0.35)) return false;
    if (!this.open(world, x, z, 2.6)) return false;
    const n = 18 + Math.floor(Math.random() * 16);
    const pts: [number, number][] = [];
    for (let tries = 0; tries < 200 && pts.length < n; tries++) {
      const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * 2.3, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (pts.every(([qx, qz]) => Math.hypot(qx - px, qz - pz) > 0.32)) pts.push([px, pz]);
    }
    Object.assign(c, { live: true, x, z, count: pts.length });
    pts.forEach(([px, pz], k) => {
      const i = c.first + k, y = world.groundAt(px, pz) - 0.03;
      Object.assign(this.base[i], { x: px, y, z: pz, live: true });
      this.out[i] = 1; this.wait[i] = 0;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), (Math.random() - 0.5) * 0.8);     // heads into the current (+z bend)
      this.m4.compose(this.v.set(px, y, pz), this.q, this.s.setScalar(0.85 + Math.random() * 0.35));
      this.eels.setMatrixAt(i, this.m4);
    });
    this.eels.instanceMatrix.needsUpdate = true;
    return true;
  }

  private spawnOcto(r: Runner, world: ChunkManager, waterY: number) {
    const o = this.octos.find((q) => !q.live);
    const z = r.pos.z - 38 - Math.random() * 10, ch = world.chunkAt(z);
    if (!o || !ch || ch.biome !== 'coral' || ch.mode !== 'swim' || ch.tide === 'surge') return false;
    const x = THREE.MathUtils.clamp(r.pos.x + (Math.random() < 0.5 ? -1 : 1) * (2.2 + Math.random() * 3), -11, 11), y = world.groundAt(x, z);
    if (y > waterY - 3.5 || !this.open(world, x, z, 1.4)) return false;
    Object.assign(o, { live: true, state: 'sit', x, y: y + 0.2, z, vx: 0, vy: 0, vz: 0, t: Math.random() * 3 });
    o.mesh.visible = true; o.mesh.rotation.set(0, Math.random() * 6.28, 0); o.mesh.scale.setScalar(1.1);
    return true;
  }

  update(dt: number, r: Runner, world: ChunkManager, waterY: number) {
    if (dt <= 0) return;
    this.clock += dt;
    const swim = r.mode === 'swim';
    if (swim && this.clock > this.nextColony) this.nextColony = this.clock + (this.spawnColony(r, world, waterY) ? 6 + Math.random() * 8 : 1);
    if (swim && this.clock > this.nextOcto && this.octos.every((o) => !o.live)) this.nextOcto = this.clock + (this.spawnOcto(r, world, waterY) ? 22 + Math.random() * 18 : 2);
    // ---- eels: down when you come near (the nearest first), back out a while after you've gone by
    const hx = r.pos.x, hy = r.hipY, hz = r.pos.z;
    let dirty = false;
    for (const c of this.colonies) {
      if (!c.live) continue;
      if (c.z > hz + 30 || c.z < hz - 160 || !swim) { this.freeColony(c); continue; }
      for (let i = c.first; i < c.first + c.count; i++) {
        const b = this.base[i];
        const d = Math.hypot(b.x - hx, b.y + 0.5 - hy, b.z - hz);
        if (d < 6.5) { this.out[i] = Math.max(0, this.out[i] - dt / 0.14); this.wait[i] = 1 + Math.random() * 2.5; }
        else if (hz < b.z - 3 && (this.wait[i] -= dt) <= 0) this.out[i] = Math.min(1, this.out[i] + dt / 1.6);
      }
      dirty = true;
    }
    if (dirty) (this.eels.geometry.getAttribute('aOut') as THREE.BufferAttribute).needsUpdate = true;
    // ---- octopus
    for (const o of this.octos) {
      if (!o.live) continue;
      o.t += dt;
      if (o.z > hz + 30 || o.z < hz - 160 || !swim) { o.live = false; o.mesh.visible = false; continue; }
      if (o.state === 'sit') {
        o.mesh.position.set(o.x, o.y, o.z);
        const b = 1 + Math.sin(o.t * 2.2) * 0.04;
        o.mesh.scale.set(1.1 * b, 1.1 / b, 1.1 * b);
        if (Math.hypot(o.x - hx, o.y - hy, o.z - hz) < 6) {
          // ink, then off, away from you and up
          o.state = 'jet'; o.t = 0;
          const dx = o.x - hx, dz = o.z - hz, l = Math.hypot(dx, dz) || 1;
          o.vx = dx / l; o.vy = 0.55; o.vz = dz / l;
          this.dust.burst(PUFF.ink, o.x, o.y + 0.25, o.z, 14, 1.4, 0.4, 1.3);
          this.dust.burst(PUFF.silt, o.x, o.y - 0.1, o.z, 8, 1.6, 0.6);
        }
      } else {
        // pulsed jets: a squeeze and a burst, coasting between, slowing as it gets clear
        const pulse = Math.max(0, Math.sin(o.t * 11)), k = Math.exp(-o.t * 0.9) * (2.5 + 7 * pulse);
        o.x += o.vx * k * dt; o.y += o.vy * k * dt; o.z += o.vz * k * dt;
        o.y = Math.min(o.y, waterY - 1.2);
        o.mesh.position.set(o.x, o.y, o.z);
        this.v.set(o.x - o.vx, o.y - o.vy, o.z - o.vz);
        o.mesh.lookAt(this.v);                                     // (+z, its eyes, trailing: the mantle leads)
        o.mesh.scale.set(1.1 * (0.85 + 0.15 * pulse), 1.1 * (0.85 + 0.15 * pulse), 1.1 * (1.3 - 0.25 * pulse));
        if (o.t < 1.2 && Math.random() < dt * 10) this.dust.emit(PUFF.ink, o.x, o.y, o.z, 0, 0.1, 0, 0.6);
        if (o.t > 5) { o.live = false; o.mesh.visible = false; }
      }
    }
  }
}
