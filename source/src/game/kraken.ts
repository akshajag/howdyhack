import * as THREE from 'three';
import { loadMesh } from '../core/assets';
import { patchMaterial } from '../core/env';
import { GROTTO_ROOF } from './patterns/lib';
import { PUFF, type Dust } from '../fx/dust';
import type { Runner } from './runner';
import type { ChunkManager } from './chunks';
import type { Chunk, KrakenAttack, Obstacle } from './types';

/**
 * The Kraken of the Shipwreck Grotto: a boss. Deep in the grotto the cave opens into a wide chamber (the grotto_kraken
 * pattern) and a giant octopus hangs in the dark at the far end, two glowing eyes and the mantle, drifting back as you
 * come on so it always looms ahead. Its tentacles do the attacking, each one telegraphed: a ghost of where it will land
 * glows for a moment first (and the tentacle itself coils out of the wall or roof, suckers pulsing), then it whips
 * into place, holds, and withdraws.
 *  - SLAM     a tentacle comes down from a roof corner across that half of the chamber: be in the other half
 *  - SWEEP    a tentacle reaches straight across the chamber low or high: go over or under it
 *  - PINCER   two slams at once, from both corners: thread the gap between them in the middle
 *  - GRAB     a tentacle shoots from the head at where you are right now and closes there: keep moving
 *  - WALL     two sweeps at once, one low and one high: only the band in the middle is open
 * Every strike becomes real obstacles (spheres along the tentacle's curve) in the chunk, so the runner's own collision
 * and near-miss rules apply; during the warning they are "phantoms" that only the test bot sees. Fair by design: each
 * attack leaves a safe region at least a third of the chamber across, and the warning lasts longer than a swim from
 * the far side (longer still with a camera control, via the chunk's `warn`). At the end of the chamber it rears up
 * into the roof and you're through: ESCAPED THE KRAKEN.
 * Models: the head and eyes are ours (build_kraken.py), the tentacle is Quaternius' (Public Domain), bent along a cubic
 * Bezier in the vertex shader so one straight mesh does every pose.
 */
export type KrakenEvent = { kind: 'wake' } | { kind: 'strike'; x: number; y: number; z: number } | { kind: 'escaped' } | { kind: 'heart' };

const STRIKE_T = 0.28, WITHDRAW_T = 0.55, HOLD_MIN = 0.6;
const THICK = 0.7;                                   // tentacle radius at the base (m)
const MODEL_R = 0.09;                                // the tentacle model's radius at its base (it is 1 m long)
const HAZARD_R = 0.9;
const HEAD_SCALE = 0.8;
const HEAD_Y = -14.0;
const GHOST = new THREE.Color('#ff5a4a');

type Phase = 'warn' | 'strike' | 'hold' | 'withdraw';
interface Live {
  att: KrakenAttack; z: number; phase: Phase; t: number;
  arms: Arm[];                                       // one, or two for a pincer
  obstacles: Obstacle[];
}
interface Arm { mesh: THREE.Mesh; ghost: THREE.Mesh; rest: THREE.Vector3[]; strike: THREE.Vector3[]; len: number; uni: ArmUniforms; guni: ArmUniforms; free: boolean }
interface ArmUniforms extends Record<string, THREE.IUniform> { uP0: { value: THREE.Vector3 }; uP1: { value: THREE.Vector3 }; uP2: { value: THREE.Vector3 }; uP3: { value: THREE.Vector3 }; uLen: { value: number }; uThick: { value: number }; uGlow: { value: number }; uAlpha: { value: number } }

/** the bend: a cubic Bezier through uP0..uP3 (world); the mesh runs 0..1 along +y, x / z are its cross-section */
const BEND_GLSL = /* glsl */ `
uniform vec3 uP0, uP1, uP2, uP3; uniform float uLen, uThick, uGlow;
vec3 t12_bez(float t) { float s = 1.0 - t; return s * s * s * uP0 + 3.0 * s * s * t * uP1 + 3.0 * s * t * t * uP2 + t * t * t * uP3; }
vec3 t12_bezT(float t) { float s = 1.0 - t; return normalize(3.0 * s * s * (uP1 - uP0) + 6.0 * s * t * (uP2 - uP1) + 3.0 * t * t * (uP3 - uP2) + 1e-5); }
void t12_frame(float t, out vec3 T, out vec3 N, out vec3 B) {
  T = t12_bezT(t);
  vec3 up = abs(T.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  N = normalize(cross(up, T)); B = cross(T, N);
}`;
const BEND_DEFORM = /* glsl */ `
  {
    float t = clamp(position.y, 0.0, 1.0);
    vec3 T, N, B; t12_frame(t, T, N, B);
    float th = uThick * uLen;
    transformed = t12_bez(t) + N * position.x * th + B * position.z * th;
  }`;
const BEND_NORMAL = /* glsl */ `
  {
    float t = clamp(position.y, 0.0, 1.0);
    vec3 T, N, B; t12_frame(t, T, N, B);
    objectNormal = normalize(N * objectNormal.x + T * objectNormal.y + B * objectNormal.z);
  }`;

function armUniforms(): ArmUniforms {
  return { uP0: { value: new THREE.Vector3() }, uP1: { value: new THREE.Vector3() }, uP2: { value: new THREE.Vector3() }, uP3: { value: new THREE.Vector3() }, uLen: { value: 10 }, uThick: { value: THICK / MODEL_R / 10 }, uGlow: { value: 0 }, uAlpha: { value: 1 } };
}

export class Kraken {
  readonly group = new THREE.Group();
  private head!: THREE.Group;
  private eyes!: THREE.Mesh;
  private arms: Arm[] = [];
  private idle: Arm[] = [];
  private live: Live[] = [];
  private chunk: Chunk | null = null;
  private done = new Set<number>();                 // attack indices launched for this chunk
  private clock = 0;
  private heartT = 0;
  private woke = false; private escaped = false;
  private inkT = 0;
  /** 0..1 while you're in its chamber (for the music and the camera) */
  presence = 0;
  readonly events: KrakenEvent[] = [];
  private v = new THREE.Vector3();

  constructor(private dust: Dust) {}

  async load() {
    const [head, eyes, tent] = await Promise.all([loadMesh('runner/models/Kraken_Head.glb'), loadMesh('runner/models/Kraken_Eyes.glb'), loadMesh('runner/models/Kraken_Tentacle.glb')]);
    // the head: dark, with the grotto's glowing edge so it reads in the gloom
    const skin = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), {
      fogScale: 0.45,
      colorHook: /* glsl */ `
        {
          vec3 vdir = normalize(vT12World - cameraPosition);
          vec3 wn = inverseTransformDirection(normal, viewMatrix);
          float rim = pow(1.0 - clamp(dot(wn, -vdir), 0.0, 1.0), 2.5);
          t12Col += vec3(0.55, 0.12, 0.22) * rim * 1.2 + diffuseColor.rgb * 0.25;
        }`,
    });
    this.head = new THREE.Group();
    const hm = new THREE.Mesh(head.geometry, skin); hm.castShadow = false;
    this.eyes = new THREE.Mesh(eyes.geometry, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    this.eyes.material = patchMaterial(this.eyes.material as THREE.MeshBasicMaterial, { caustics: false, fogScale: 0.25, colorHook: /* glsl */ `t12Col *= 2.6 + 0.8 * sin(uTime * 2.1);` });
    this.head.add(hm, this.eyes);
    this.head.scale.setScalar(HEAD_SCALE);           // (built with its eyes toward -y in Blender = +z here: toward you, since you come from +z)
    this.head.visible = false;
    this.group.add(this.head);
    // tentacles: a pool bent by the shader; each has a ghost twin for the telegraph
    const geo = tent.geometry;
    for (let i = 0; i < 9; i++) {
      const uni = armUniforms(), guni = armUniforms();
      const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), {
        vertexHeader: BEND_GLSL, deform: BEND_DEFORM, uniforms: uni, fogScale: 0.6,
        fragmentHeader: `uniform float uGlow;`,
        colorHook: /* glsl */ `
          {
            vec3 vdir = normalize(vT12World - cameraPosition);
            vec3 wn = inverseTransformDirection(normal, viewMatrix);
            float rim = pow(1.0 - clamp(dot(wn, -vdir), 0.0, 1.0), 2.5);
            // pale suckers (the paler vertex colours) pulse when the arm is about to strike
            float pale = smoothstep(0.45, 0.7, diffuseColor.r + diffuseColor.g);
            t12Col += vec3(0.55, 0.12, 0.22) * rim * 0.8 + vec3(1.0, 0.45, 0.5) * pale * uGlow * (0.6 + 0.4 * sin(uTime * 14.0));
          }`,
      });
      this.bendNormals(mat, 'arm');
      const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.visible = false;
      const gmat = patchMaterial(new THREE.MeshBasicMaterial({ color: GHOST, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), {
        vertexHeader: BEND_GLSL, deform: BEND_DEFORM, uniforms: guni, caustics: false, fogScale: 0.4,
        fragmentHeader: `uniform float uAlpha;`,
        colorHook: /* glsl */ `t12Col *= uAlpha * (0.7 + 0.3 * sin(uTime * 9.0));`,
      });
      const ghost = new THREE.Mesh(geo, gmat); ghost.frustumCulled = false; ghost.visible = false; ghost.renderOrder = 13;
      this.group.add(mesh, ghost);
      this.arms.push({ mesh, ghost, rest: [], strike: [], len: 10, uni, guni, free: true });
    }
    // four idle arms trailing from the head, always waving (the other five strike)
    for (let i = 0; i < 4; i++) { const a = this.arms[5 + i]; a.free = false; this.idle.push(a); }
  }

  /** the normals follow the bend too (three computes them before the deform hook, so patch that stage) */
  private bendNormals(mat: THREE.Material, key: string) {
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = (sh, r) => { prev.call(mat, sh, r); sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${BEND_NORMAL}`); };
    mat.customProgramCacheKey = () => prevKey.call(mat) + ':bend:' + key;
  }

  reset() {
    for (const l of this.live) this.endAttack(l);
    this.live = []; this.done.clear(); this.chunk = null; this.woke = false; this.escaped = false; this.presence = 0;
    this.head.visible = false;
    for (const a of this.arms) { a.mesh.visible = false; a.ghost.visible = false; }
  }

  private setCurve(u: ArmUniforms, p: THREE.Vector3[], len: number) {
    u.uP0.value.copy(p[0]); u.uP1.value.copy(p[1]); u.uP2.value.copy(p[2]); u.uP3.value.copy(p[3]);
    u.uLen.value = len; u.uThick.value = THICK / MODEL_R / len;          // (th = uThick * uLen scales the model's radius to THICK)
  }

  /** the strike pose of an attack: four Bezier points in world space, and where its hazard spheres go */
  private poses(att: KrakenAttack, z: number, r: Runner, side: number, high = att.high): { pts: THREE.Vector3[]; rest: THREE.Vector3[] } {
    const V = (x: number, y: number, zz = z) => new THREE.Vector3(x, y, zz);
    const s = side;
    if (att.kind === 'slam' || att.kind === 'pincer') {
      const tipX = att.kind === 'pincer' ? s * 3.0 : s * 0.5;
      const pts = [V(s * 9.6, GROTTO_ROOF - 0.1), V(s * 7.6, -13.0), V(s * (att.kind === 'pincer' ? 5.6 : 3.6), -16.4), V(tipX, -17.9)];
      const rest = [V(s * 9.6, GROTTO_ROOF - 0.1), V(s * 9.0, -11.6), V(s * 9.8, -12.4, z + 0.6), V(s * 8.6, -12.9, z + 0.2)];
      return { pts, rest };
    }
    if (att.kind === 'sweep' || att.kind === 'wall') {
      const y = high ? -12.2 : -16.3;
      const pts = [V(s * 10.2, y), V(s * 4, y + 0.3), V(-s * 3, y - 0.3), V(-s * 9.2, y)];
      const rest = [V(s * 10.2, y), V(s * 9.4, y + 0.6), V(s * 8.6, y + 0.9, z + 0.8), V(s * 8.4, y + 0.2, z + 0.4)];
      return { pts, rest };
    }
    // grab: from the head's mouth to where you are now, the tip hooking round
    const hx = this.head.position.x, hy = this.head.position.y - 1.2, hz = this.head.position.z + 2.5;
    const tx = THREE.MathUtils.clamp(r.pos.x, -8.5, 8.5), ty = THREE.MathUtils.clamp(r.hipY, -17.0, -11.4);
    const pts = [V(hx, hy, hz), V(hx * 0.4 + tx * 0.6, hy * 0.5 + ty * 0.5, hz + (z - hz) * 0.45), V(tx - 2.2, ty + 1.6, z - 1.2), V(tx + 1.4, ty - 0.4, z + 0.2)];
    const rest = [V(hx, hy, hz), V(hx, hy - 0.4, hz + 2.5), V(hx + 1, hy - 0.2, hz + 3.5), V(hx + 1.5, hy + 0.6, hz + 3.0)];
    return { pts, rest };
  }

  private bez(p: THREE.Vector3[], t: number, out: THREE.Vector3) {
    const s = 1 - t;
    return out.set(0, 0, 0).addScaledVector(p[0], s * s * s).addScaledVector(p[1], 3 * s * s * t).addScaledVector(p[2], 3 * s * t * t).addScaledVector(p[3], t * t * t);
  }

  private startAttack(att: KrakenAttack, idx: number, c: Chunk, r: Runner) {
    const z = c.zStart - att.along;
    const parts: [number, boolean | undefined][] = att.kind === 'pincer' ? [[-1, att.high], [1, att.high]] : att.kind === 'wall' ? [[-att.side, false], [att.side, true]] : [[att.side, att.high]];
    const arms: Arm[] = [];
    for (const [s, high] of parts) {
      const a = this.arms.find((q) => q.free);
      if (!a) return;
      a.free = false;
      const { pts, rest } = this.poses(att, z, r, s, high);
      a.strike = pts; a.rest = rest;
      a.len = 0; for (let i = 1; i <= 16; i++) a.len += this.bez(pts, i / 16, this.v).distanceTo(this.bez(pts, (i - 1) / 16, new THREE.Vector3()));
      this.setCurve(a.uni, rest, Math.max(3, a.len * 0.35)); this.setCurve(a.guni, pts, a.len);
      a.mesh.visible = true; a.ghost.visible = true; a.uni.uGlow.value = 1; a.guni.uAlpha.value = 0.6;
      arms.push(a);
    }
    // the hazard: spheres along each arm's final curve, phantoms until it strikes (the bot plans round them)
    const obstacles: Obstacle[] = [];
    for (const a of arms) {
      const n = Math.max(5, Math.round(a.len / 1.6));
      for (let i = 1; i <= n; i++) {
        const p = this.bez(a.strike, i / n, new THREE.Vector3());
        obstacles.push({ shape: { kind: 'sphere', x: p.x, y: p.y, along: c.zStart - p.z, r: HAZARD_R * (1 - 0.35 * (i / n)) }, tag: 'kraken', name: 'CRUSHED BY THE KRAKEN', phantom: true });
      }
    }
    c.obstacles.push(...obstacles);
    this.live.push({ att, z, phase: 'warn', t: 0, arms, obstacles });
    this.done.add(idx);
  }

  private endAttack(l: Live) {
    if (this.chunk) for (const o of l.obstacles) { const i = this.chunk.obstacles.indexOf(o); if (i >= 0) this.chunk.obstacles.splice(i, 1); }
    for (const a of l.arms) { a.free = true; a.mesh.visible = false; a.ghost.visible = false; a.uni.uGlow.value = 0; }
  }

  update(dt: number, r: Runner, world: ChunkManager) {
    if (dt <= 0) return;
    this.clock += dt;
    const c = world.chunkAt(r.pos.z);
    const here = c && c.kraken ? c : null;
    if (here !== this.chunk) {
      // a new chamber (or out of one): clear the old attacks
      for (const l of this.live) this.endAttack(l);
      this.live = []; this.done.clear();
      this.chunk = here; this.woke = false; this.escaped = false;
    }
    if (!here || !here.kraken) { this.presence = Math.max(0, this.presence - dt); this.head.visible = this.presence > 0; if (this.presence <= 0) for (const a of this.idle) a.mesh.visible = false; return; }
    const K = here.kraken, along = here.zStart - r.pos.z, zEnd = here.zStart - here.length;
    if (!this.woke && along > 4) { this.woke = true; this.events.push({ kind: 'wake' }); this.heartT = 0; }
    this.presence = Math.min(1, this.presence + dt * 0.8);
    // ---- the head: looming ahead, drifting back; at the escape it rears up into the roof
    const rear = THREE.MathUtils.clamp((along - K.escape) / 10, 0, 1);
    const hz = Math.max(r.pos.z - 26, zEnd + 12);
    this.head.visible = true;
    this.head.position.set(Math.sin(this.clock * 0.3) * 1.2, HEAD_Y + Math.sin(this.clock * 0.7) * 0.4 + rear * 9, hz);
    this.head.rotation.set(Math.sin(this.clock * 0.5) * 0.06 - rear * 0.6, Math.sin(this.clock * 0.4) * 0.1, Math.sin(this.clock * 0.45) * 0.05);
    // idle arms trailing off the head
    this.idle.forEach((a, k) => {
      const s = k % 2 ? 1 : -1, hi = k >= 2, hp = this.head.position, t = this.clock * 0.9 + k * 1.7;
      const dy = hi ? 1.2 : -1.6, spread = hi ? 0.7 : 1;
      const pts = [new THREE.Vector3(hp.x + s * 2.6, hp.y + dy * 0.6, hp.z + 1.5), new THREE.Vector3(hp.x + s * 5 * spread, hp.y + dy + Math.sin(t) * 0.8, hp.z + 4.5), new THREE.Vector3(hp.x + s * (6.5 + Math.sin(t * 0.7)) * spread, hp.y + dy * 0.5 + Math.cos(t) * 1.2, hp.z + 8.5), new THREE.Vector3(hp.x + s * (8 + Math.cos(t * 0.8) * 1.5) * spread, hp.y + Math.sin(t * 1.3) * 1.5 + dy * 0.3, hp.z + 12 + Math.sin(t * 0.5))];
      this.setCurve(a.uni, pts, 14); a.mesh.visible = rear < 0.9;
    });
    // ---- heartbeat while it's awake, ink now and then from the head
    this.heartT += dt;
    const beat = 0.95 - 0.35 * Math.min(1, this.live.length / 2);
    if (this.heartT > beat) { this.heartT = 0; this.events.push({ kind: 'heart' }); }
    this.inkT -= dt;
    if (this.inkT <= 0) { this.inkT = 3 + Math.random() * 3; this.dust.burst(PUFF.ink, this.head.position.x, this.head.position.y - 1, this.head.position.z + 3, 10, 1.2, 0.2, 1.6); }
    // ---- attacks: launched so the strike lands as you arrive, with the warning before it
    const lead = r.speed * (K.warn + STRIKE_T) + 2.5;
    K.attacks.forEach((att, i) => {
      if (this.done.has(i)) return;
      const z = here.zStart - att.along;
      if (r.pos.z - z <= lead && r.pos.z > z) this.startAttack(att, i, here, r);
    });
    for (const l of this.live) {
      l.t += dt;
      const warn = K.warn;
      if (l.phase === 'warn') {
        // coiling out of the wall, the ghost of the strike glowing where it will land
        for (const a of l.arms) {
          const w = Math.sin(this.clock * 6 + a.len) * 0.3;
          const p = a.rest.map((q) => q.clone()); p[2].y += w; p[3].x += w * 0.6; p[3].y -= w * 0.4;
          this.setCurve(a.uni, p, Math.max(3, a.len * (0.3 + 0.1 * (l.t / warn))));
          a.guni.uAlpha.value = 0.45 + 0.55 * Math.min(1, l.t / warn);
        }
        if (l.t >= warn) { l.phase = 'strike'; l.t = 0; }
      } else if (l.phase === 'strike') {
        const k = Math.min(1, l.t / STRIKE_T), e = k * k * (3 - 2 * k);
        for (const a of l.arms) {
          const p = a.rest.map((q, i) => q.clone().lerp(a.strike[i], e));
          this.setCurve(a.uni, p, Math.max(3, a.len * (0.4 + 0.6 * e)));
          a.guni.uAlpha.value = 1 - e;
        }
        if (k >= 1) {
          l.phase = 'hold'; l.t = 0;
          for (const o of l.obstacles) o.phantom = false;
          for (const a of l.arms) { a.ghost.visible = false; const tip = a.strike[3]; this.events.push({ kind: 'strike', x: tip.x, y: tip.y, z: tip.z }); this.dust.burst(PUFF.silt, tip.x, tip.y + 0.3, tip.z, 14, 2.2, 0.8, 1.4); }
        }
      } else if (l.phase === 'hold') {
        for (const a of l.arms) {
          const w = Math.sin(this.clock * 4 + a.len) * 0.15;
          const p = a.strike.map((q) => q.clone()); p[2].y += w; p[3].x += w;
          this.setCurve(a.uni, p, a.len);
        }
        if (l.t >= HOLD_MIN && r.pos.z < l.z - 3) { l.phase = 'withdraw'; l.t = 0; }
      } else {
        const k = Math.min(1, l.t / WITHDRAW_T), e = k * k;
        for (const a of l.arms) {
          const p = a.strike.map((q, i) => q.clone().lerp(a.rest[i], e));
          this.setCurve(a.uni, p, Math.max(3, a.len * (1 - 0.65 * e)));
          a.uni.uGlow.value = 1 - e;
        }
        for (const o of l.obstacles) o.phantom = true;                      // (no longer solid as it goes)
        if (k >= 1) { this.endAttack(l); l.t = -1; }
      }
    }
    this.live = this.live.filter((l) => l.t >= 0);
    // ---- the escape
    if (!this.escaped && along > K.escape + 8) { this.escaped = true; this.events.push({ kind: 'escaped' }); }
  }
}
