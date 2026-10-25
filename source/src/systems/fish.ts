import * as THREE from 'three';
import { patchMaterial } from '../core/env';
import type { Heightfield } from '../core/heightfield';

/** Body-wave swim (ABZÛ-style: no skeleton, motion lives in the vertex shader). Head is +Z. */
const SWIM = /* glsl */ `
  {
    float L = uBodyLength;
    float u = clamp(position.z / L + 0.5, 0.0, 1.0);          // 1 head .. 0 tail
    float ph = uTime * aFish.y * uBeat + aFish.x;
    float tail = pow(1.0 - u, 1.6);
    transformed.x += sin(ph - u * 5.5) * tail * L * 0.16 * aFish.z;
    transformed.x += sin(ph) * L * 0.02;                         // whole-body yaw
    transformed.y += sin(ph * 0.5 + u * 2.0) * L * 0.012;
  }`;

interface Fish { pos: THREE.Vector3; vel: THREE.Vector3; off: THREE.Vector3; jitter: number; orbitR: number; orbitW: number; orbitY: number }
interface School {
  fish: Fish[];
  anchor: THREE.Vector3;
  radius: THREE.Vector3;
  speed: number;
  phase: number;
  center: THREE.Vector3;
  heading: THREE.Vector3;
  maxSpeed: number;
  start: number;
  minDepth: number;
  mode: SchoolMode;
  axis: THREE.Vector3;
  avoid: number;
}

/** figure8: leader wanders a figure-eight; loop: leader circles a long ellipse along `axis` (a guiding stream);
 *  vortex: a bait ball, every fish on its own orbit around a vertical axis (opens up around the diver). */
export type SchoolMode = 'figure8' | 'loop' | 'vortex';

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmpM = new THREE.Matrix4();
const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3();

export interface SchoolSpec {
  anchor: [number, number, number]; radius: [number, number, number]; count: number; speed: number; spread: number; maxSpeed: number;
  mode?: SchoolMode; axis?: [number, number, number];
}

export class FishSchools {
  readonly mesh: THREE.InstancedMesh;
  private schools: School[] = [];
  private scales: number[] = [];

  constructor(geo: THREE.BufferGeometry, private hf: Heightfield, specs: SchoolSpec[], opts: { bodyLength: number; beat: number; tints: THREE.Color[]; scale: [number, number]; seed: number }) {
    const max = specs.reduce((a, s) => a + s.count, 0);
    const rand = mulberry(opts.seed);
    const attr = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) {
      attr[i * 3] = rand() * Math.PI * 2;
      attr[i * 3 + 1] = 0.75 + rand() * 0.6;
      attr[i * 3 + 2] = 0.8 + rand() * 0.4;
      this.scales.push(opts.scale[0] + rand() * (opts.scale[1] - opts.scale[0]));
    }
    geo.setAttribute('aFish', new THREE.InstancedBufferAttribute(attr, 3));
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.15, side: THREE.DoubleSide }), {
      deform: SWIM,
      vertexHeader: `attribute vec3 aFish; uniform float uBodyLength; uniform float uBeat;`,
      uniforms: { uBodyLength: { value: opts.bodyLength }, uBeat: { value: opts.beat } },
      colorHook: /* glsl */ `
        // silver sheen flashing toward the sun
        vec3 vdir = normalize(vT12World - cameraPosition);
        t12Col += uSunColor * pow(max(dot(reflect(vdir, inverseTransformDirection(normal, viewMatrix)), uSunDirWater), 0.0), 12.0) * 0.6;`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    let k = 0;
    for (const s of specs) {
      const mode = s.mode ?? 'figure8';
      const school: School = {
        fish: [], anchor: new THREE.Vector3(...s.anchor), radius: new THREE.Vector3(...s.radius), speed: s.speed,
        phase: rand() * 10, center: new THREE.Vector3(), heading: new THREE.Vector3(0, 0, 1), maxSpeed: s.maxSpeed, start: k, minDepth: 1.2,
        mode, axis: new THREE.Vector3(...(s.axis ?? [0, 0, 1])).normalize(), avoid: mode === 'vortex' ? 64 : 30,
      };
      for (let i = 0; i < s.count; i++, k++) {
        // ellipsoidal school volume, flattened vertically and stretched along travel
        const off = new THREE.Vector3(gauss(rand) * s.spread, gauss(rand) * s.spread * 0.35, gauss(rand) * s.spread * (mode === 'loop' ? 3.2 : 1.6));
        const R = s.radius[0];
        const orbitR = R * (0.35 + 0.65 * Math.sqrt(rand()));
        school.fish.push({
          pos: school.anchor.clone().add(off), vel: new THREE.Vector3(), off, jitter: rand() * 100,
          orbitR, orbitW: (2.2 + rand() * 1.2) / orbitR * (rand() < 0.08 ? -1 : 1), orbitY: gauss(rand) * s.radius[1],
        });
        this.mesh.setColorAt(k, opts.tints[Math.floor(rand() * opts.tints.length)]);
      }
      this.schools.push(school);
    }

    this.mesh.count = k;
  }

  private frac = 1;
  /** Quality: thin every school by the same fraction (instances are compacted each frame). */
  setActiveFraction(f: number) {
    this.frac = THREE.MathUtils.clamp(f, 0.05, 1);
  }

  update(t: number, dt: number, player: THREE.Vector3, current?: (p: THREE.Vector3, out: THREE.Vector3) => number) {
    dt = Math.min(dt, 0.05);
    const flow = new THREE.Vector3();
    let k = 0;
    for (const s of this.schools) {
      const w = s.speed, a = t * w + s.phase;
      const prev = tmp2.copy(s.center);
      if (s.mode === 'loop') {
        // leader circles a long ellipse along the axis (a living current that points the way)
        const side = tmp.crossVectors(UP, s.axis).normalize();
        s.center.copy(s.anchor).addScaledVector(s.axis, Math.cos(a) * s.radius.x).addScaledVector(side, Math.sin(a) * s.radius.z);
        s.center.y += Math.sin(a) * s.radius.y;
      } else if (s.mode === 'vortex') {
        s.center.copy(s.anchor);
        s.center.y += Math.sin(t * 0.21 + s.phase) * 1.2;
      } else {
        // leader path: a slow figure-eight inside the school's region
        s.center.set(
          s.anchor.x + s.radius.x * Math.sin(a),
          s.anchor.y + s.radius.y * Math.sin(a * 0.7 + 1.3),
          s.anchor.z + s.radius.z * Math.sin(a * 2.0 + 0.4) * 0.5,
        );
      }
      const ground = this.hf.sample(s.center.x, s.center.z);
      s.center.y = THREE.MathUtils.clamp(s.center.y, ground + 2.2, -s.minDepth);
      if (t > 0) s.heading.copy(s.center).sub(prev).normalize();
      if (!isFinite(s.heading.x) || s.heading.lengthSq() < 0.5) s.heading.set(0, 0, 1);
      bz.copy(s.heading); bx.crossVectors(UP, bz).normalize(); by.crossVectors(bz, bx);
      const end = s.start + Math.max(1, Math.floor(s.fish.length * this.frac));
      for (let i = s.start; i < end; i++) {
        const f = s.fish[i - s.start];
        const wob = Math.sin(t * 0.6 + f.jitter) * 0.25;
        let target: THREE.Vector3;
        if (s.mode === 'vortex') {
          // bait ball: own orbit, slightly breathing radius and height
          const ph = f.jitter + t * f.orbitW;
          const r = f.orbitR * (1 + 0.12 * Math.sin(t * 0.5 + f.jitter));
          target = tmp.set(s.center.x + Math.cos(ph) * r, s.center.y + f.orbitY + Math.sin(ph * 2.0 + f.jitter) * 0.5, s.center.z + Math.sin(ph) * r);
        } else {
          target = tmp.copy(s.center)
            .addScaledVector(bx, f.off.x * (1 + wob))
            .addScaledVector(by, f.off.y)
            .addScaledVector(bz, f.off.z);
        }
        const desired = target.sub(f.pos).multiplyScalar(s.mode === 'vortex' ? 1.4 : 0.9);
        // part around the diver (the bait ball opens a wide hole)
        const dx = f.pos.x - player.x, dy = f.pos.y - player.y, dz = f.pos.z - player.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < s.avoid) {
          const k = (s.avoid - d2) / s.avoid * 7.0 / Math.sqrt(d2 + 0.01);
          desired.x += dx * k; desired.y += dy * k * 0.5; desired.z += dz * k;
        }
        // drift with the tide where there is one
        if (current && (i & 3) === 0) {
          const cw = current(f.pos, flow);
          if (cw > 0) f.vel.addScaledVector(flow, cw * 0.35 * dt);
        }
        const g = this.hf.sample(f.pos.x, f.pos.z);
        if (f.pos.y < g + 0.8) desired.y += (g + 0.8 - f.pos.y) * 4.0;
        if (f.pos.y > -0.6) desired.y -= (f.pos.y + 0.6) * 4.0;
        f.vel.lerp(desired, Math.min(1, dt * 1.6));
        const sp = f.vel.length();
        if (sp > s.maxSpeed) f.vel.multiplyScalar(s.maxSpeed / sp);
        f.pos.addScaledVector(f.vel, dt);
        // orientation from velocity (blend with school heading when slow)
        const fwd = tmp.copy(f.vel);
        if (fwd.lengthSq() < 0.01) fwd.copy(s.heading); else fwd.normalize();
        bz.copy(fwd); bx.crossVectors(UP, bz);
        if (bx.lengthSq() < 1e-4) bx.set(1, 0, 0);
        bx.normalize(); by.crossVectors(bz, bx);
        const sc = this.scales[i];
        tmpM.makeBasis(bx.multiplyScalar(sc), by.multiplyScalar(sc), bz.multiplyScalar(sc));
        tmpM.setPosition(f.pos);
        this.mesh.setMatrixAt(k++, tmpM);
      }
      bz.copy(s.heading); bx.crossVectors(UP, bz).normalize(); by.crossVectors(bz, bx);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Mantas glide on wide circles; wing flap is a shader wave travelling out along the span. */
export class Mantas {
  readonly mesh: THREE.InstancedMesh;
  private paths: { c: THREE.Vector3; r: number; w: number; p: number; y: number }[] = [];

  constructor(geo: THREE.BufferGeometry, paths: { c: [number, number, number]; r: number; w: number; p: number }[]) {
    const n = paths.length;
    const phase = new Float32Array(n);
    paths.forEach((p, i) => { phase[i] = p.p; this.paths.push({ c: new THREE.Vector3(...p.c), r: p.r, w: p.w, p: p.p, y: p.c[1] }); });
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide }), {
      deform: /* glsl */ `
        {
          float ax = abs(position.x);
          float ph = uTime * 1.1 + aPhase;
          transformed.y += sin(ph - ax * 0.55) * pow(ax, 1.5) * 0.22;
          transformed.y += sin(ph * 0.5 - position.z * 0.8) * 0.05;
        }`,
      vertexHeader: `attribute float aPhase;`,
      fogScale: 0.8,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  update(t: number) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    this.paths.forEach((p, i) => {
      const a = t * p.w + p.p;
      const pos = new THREE.Vector3(p.c.x + Math.cos(a) * p.r, p.y + Math.sin(a * 2.0) * 1.5, p.c.z + Math.sin(a) * p.r);
      const yaw = Math.atan2(-Math.sin(a) * Math.sign(p.w), Math.cos(a) * Math.sign(p.w));
      e.set(Math.cos(a * 2.0) * 0.08, yaw, -Math.sign(p.w) * 0.22);
      q.setFromEuler(e);
      m.compose(pos, q, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Large slow creature (whale shark) cruising a wide ellipse with a gentle depth swell. No skeleton: the body sway,
 * travelling tail beat and pectoral flex all live in the vertex shader (head is +Z, like the fish kits).
 */
export class Cruiser {
  readonly mesh: THREE.Mesh;
  private c: THREE.Vector3;
  private prev = new THREE.Vector3();

  constructor(geo: THREE.BufferGeometry, path: { c: number[]; r: number; period: number }, length = 12) {
    this.c = new THREE.Vector3(...(path.c as [number, number, number]));
    this.r = path.r; this.w = (Math.PI * 2) / path.period;
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }), {
      deform: /* glsl */ `
        {
          float L = ${length.toFixed(1)};
          float u = clamp(0.5 - position.z / L, 0.0, 1.0);             // 0 head .. 1 tail
          float ph = uTime * 1.05;
          float tail = pow(u, 1.8);
          transformed.x += sin(ph - u * 3.2) * tail * 0.95 + sin(ph * 0.5) * 0.06;
          float fin = smoothstep(1.0, 2.8, abs(position.x));            // pectorals flex slowly
          transformed.y += sin(ph * 0.5 + 1.0) * fin * 0.18;
        }`,
      fogScale: 0.85,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  private r: number;
  private w: number;

  update(t: number) {
    const a = t * this.w;
    const p = this.mesh.position;
    this.prev.copy(p);
    p.set(this.c.x + Math.cos(a) * this.r, this.c.y + Math.sin(a * 2.0) * 3.0, this.c.z + Math.sin(a) * this.r * 0.62);
    const v = tmp.set(-Math.sin(a) * this.r, Math.cos(a * 2.0) * 6.0, Math.cos(a) * this.r * 0.62).normalize();
    this.mesh.lookAt(tmp2.copy(p).add(v));
    this.mesh.rotateZ(-Math.sign(this.w) * 0.1);                     // lean into the turn
  }
}

export function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number) { return (r() + r() + r() - 1.5) / 1.5; }
