import * as THREE from 'three';
import { loadMesh } from '../core/assets';
import { LANES, MOVE, type Obstacle } from './types';
import { patchMaterial } from '../core/env';
import type { Runner } from './runner';
import type { ChunkManager } from './chunks';
import { FlyGull, loadGullParts } from './wildlife';

/**
 * Moving hazards, spawned at run time (the chunk validator only sees static obstacles, so each spawn checks the course
 * around it and only goes where the dodge is always possible):
 *  - crabs scuttle sideways across the lanes on the beach. They're low, so a jump always clears one (and counts as a
 *    near miss). A crab reaches one lane just as you do, so it's a jumpable obstacle in that lane: the lane is kept
 *    empty for a jump plus a moment either side (the validator's spacing rule), and nothing you'd have to slide under
 *    is within a jump length in any lane (the timing drifts a little if you surge).
 *  - gulls dive at the lane you're in. Their shadow grows on the sand for 1.4 s first; change lanes or slide under.
 *    The lane is empty from a jump length before the target spot to 4 m past it, so the shadow is in plain view and
 *    you're never mid-jump over something else when the gull comes through.
 *  - cannons on the beach and the pier fire one slow cannonball down their lane when you're ~70 m off (muzzle flash,
 *    smoke, a boom). It rolls toward you at whatever speed makes it meet you a jump length + 0.25 s + 2 m before the
 *    cannon (so: jump the ball, land, jump the cannon, never back to back), and it only fires if that stretch of its
 *    lane is otherwise empty with nothing overhead near. Or just step into another lane.
 *  - under water, in the shark waters (the coral_sharks pattern, which has nothing else in it), sharks cross the canyon
 *    at your depth, coming out of the gloom at the side with a two-note warning; swim up or down out of the way. One
 *    spawns only where the water a body length above or below its line is open, the line itself is clear (it never
 *    swims through rock), and there's no reef gate near.
 */
const CRAB_SPEED = 3.2;          // m/s sideways
const GULL_WARN = 1.45;          // s from the shadow appearing to the swoop
const CRAB_SCALE = 1.3;          // the model is 0.8 m across; a bit bigger reads better at speed
const AS_NEAR: Obstacle = { shape: { kind: 'sphere', x: 0, y: 0, along: 0, r: 0 }, tag: 'critter', name: 'A NEAR MISS', nearMiss: true };

interface Crab { mesh: THREE.Mesh; x: number; z: number; dir: number; live: boolean; jumped: boolean }
interface Gull { fly: FlyGull; shadow: THREE.Mesh; laneX: number; zImp: number; side: number; t: number; live: boolean; surface: number }
interface Shark { mesh: THREE.Mesh; x: number; y: number; z: number; dir: number; t: number; live: boolean; escape: number; near: boolean }
interface Ball { mesh: THREE.Mesh; x: number; z: number; v: number; live: boolean; near: boolean; roll: number }
const BALL_R = 0.32, CANNON_RANGE = 70;
const SHARK_SPEED = 7.5;         // m/s across the canyon
const SHARK_WARN = 2.1;          // s from appearing at the side to crossing your line
const SHARK_HALF = 1.3;          // half its body length (it swims along x)

export class Critters {
  readonly group = new THREE.Group();
  private crabs: Crab[] = [];
  private gulls: Gull[] = [];
  private sharks: Shark[] = [];
  private balls: Ball[] = [];
  /** cannons already decided (fired or not), by chunk id and obstacle index */
  private cannons = new Set<string>();
  /** a cannon fires: muzzle flash, smoke and a boom (x, y, z of the muzzle) */
  onCannon: ((x: number, y: number, z: number) => void) | null = null;
  private nextCrab = 4; private nextGull = 7; private nextShark = 6; private clock = 0;
  /** squawk / warning cues for the audio */
  onGull: (() => void) | null = null;
  onShark: (() => void) | null = null;

  constructor(private material: THREE.Material) {}

  async load() {
    const [crab, gull, shark] = await Promise.all([loadMesh('runner/models/Crab.glb'), loadGullParts(), loadMesh('runner/models/Shark.glb')]);
    const iron = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.45, flatShading: true }), {});
    const ballGeo = new THREE.IcosahedronGeometry(BALL_R, 1);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(ballGeo, iron); m.visible = false; m.castShadow = true;
      this.group.add(m); this.balls.push({ mesh: m, x: 0, z: 0, v: 0, live: false, near: false, roll: 0 });
    }
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(shark.geometry, this.material); m.visible = false; m.rotation.order = 'YXZ';
      this.group.add(m); this.sharks.push({ mesh: m, x: 0, y: 0, z: 0, dir: 1, t: 0, live: false, escape: 1, near: false });
    }
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const disc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(crab.geometry, this.material); m.visible = false; m.castShadow = true; m.scale.setScalar(CRAB_SCALE);
      this.group.add(m); this.crabs.push({ mesh: m, x: 0, z: 0, dir: 1, live: false, jumped: false });
    }
    for (let i = 0; i < 2; i++) {
      const f = new FlyGull(gull.body, gull.wing, this.material);
      const s = new THREE.Mesh(disc, shadowMat.clone()); s.visible = false; s.renderOrder = 2;
      this.group.add(f.root, s); this.gulls.push({ fly: f, shadow: s, laneX: 0, zImp: 0, side: 1, t: 0, live: false, surface: 0 });
    }
  }

  reset() {
    for (const c of this.crabs) { c.live = false; c.mesh.visible = false; }
    for (const g of this.gulls) { g.live = false; g.fly.root.visible = false; g.shadow.visible = false; }
    for (const k of this.sharks) { k.live = false; k.mesh.visible = false; }
    for (const b of this.balls) { b.live = false; b.mesh.visible = false; }
    this.cannons.clear();
    this.clock = 0; this.nextCrab = 4; this.nextGull = 7; this.nextShark = 6;
  }

  /** for tests and the bot: live hazards */
  list() {
    return [
      ...this.crabs.filter((c) => c.live).map((c) => ({ kind: 'crab' as const, x: c.x, z: c.z, dir: c.dir })),
      ...this.gulls.filter((g) => g.live).map((g) => ({ kind: 'gull' as const, x: g.laneX, z: g.zImp, t: g.t })),
      ...this.balls.filter((b) => b.live).map((b) => ({ kind: 'ball' as const, x: b.x, z: b.z, v: b.v })),
      ...this.sharks.filter((k) => k.live).map((k) => ({ kind: 'shark' as const, x: k.x, y: k.y, z: k.z, dir: k.dir, t: k.t, escape: k.escape })),
    ];
  }

  update(dt: number, r: Runner, world: ChunkManager, enabled: boolean) {
    this.clock += dt;
    if (enabled && r.alive && r.mode !== 'swim') this.spawn(r, world);
    if (enabled && r.alive && r.mode === 'swim') this.spawnShark(r, world);
    for (const c of this.crabs) if (c.live) this.stepCrab(c, dt, r, world);
    for (const g of this.gulls) if (g.live) this.stepGull(g, dt, r, world);
    for (const k of this.sharks) if (k.live) this.stepShark(k, dt, r);
    for (const b of this.balls) if (b.live) this.stepBall(b, dt, r, world);
  }

  /** no live crab or gull within `range` of z: one needs a jump, the other a slide or a lane change, never both at once */
  private apart(z: number, range: number) {
    return this.crabs.every((c) => !c.live || Math.abs(c.z - z) > range) && this.gulls.every((g) => !g.live || Math.abs(g.zImp - z) > range);
  }

  /** is the course clear of static obstacles near `along` (in one lane, or any lane when x is null)? `slideRange`:
   *  also no slide-under obstacle (something overhead) within this distance in any lane */
  private clear(world: ChunkManager, z: number, range: number, x: number | null, slideRange = 0) {
    for (const { chunk, ob } of world.obstaclesNear(z, Math.max(range, slideRange) + 4)) {
      const s = ob.shape, oz = chunk.zStart - s.along;
      const half = s.kind === 'sphere' ? s.r : Math.max(s.sx, s.sz) / 2;
      const dz = Math.abs(oz - z) - half;
      const overhead = s.kind === 'box' && s.y - world.groundAt(s.x, oz) > 0.9;
      if (overhead && dz < slideRange) return false;
      if (dz < range && (x === null || Math.abs(s.x - x) < half + 1.2)) return false;
    }
    return true;
  }

  private spawn(r: Runner, world: ChunkManager) {
    const tier = r.distance < 200 ? 0 : r.distance < 550 ? 1 : r.distance < 1000 ? 2 : r.distance < 1600 ? 3 : 4;
    if (tier >= 1) this.fireCannons(r, world);
    // crabs: plain beach only (no deck, no flood), from tier 1
    if (tier >= 1 && this.clock > this.nextCrab) {
      const crab = this.crabs.find((c) => !c.live), jump = r.speed * 1.1;
      // a few arrival times ahead; the first spot with a free lane wins (none: retried next frame, and the interval
      // only starts once a crab is out)
      let tArr = 0, z = 0, lanes: number[] = [];
      for (const t of crab ? [1.7, 2.0, 2.3, 2.6] : []) {
        z = r.pos.z - r.speed * t; tArr = t;
        const ch = world.chunkAt(z);
        if (!ch || ch.biome !== 'beach' || ch.mode !== 'run' || ch.floor || ch.tide === 'surge' || !this.apart(z, jump) || !this.clear(world, z, 3, null, r.speed * 0.9)) continue;
        lanes = LANES.filter((x) => this.clear(world, z, jump, x));
        if (lanes.length) break;
      }
      if (crab && lanes.length) {
        this.nextCrab = this.clock + Math.max(1.6, 3.8 - tier * 0.55) + Math.random() * 1.2;
        const dir = Math.random() < 0.5 ? -1 : 1;                       // the side it walks toward
        const xArr = lanes[Math.floor(Math.random() * lanes.length)] + (Math.random() - 0.5) * 0.8;
        Object.assign(crab, { live: true, jumped: false, dir, z, x: xArr - dir * CRAB_SPEED * tArr });
        crab.mesh.visible = true;
      }
    }
    // gulls: beach or pier, from tier 2
    if (tier >= 2 && this.clock > this.nextGull) {
      const z = r.pos.z - r.speed * GULL_WARN;
      const ch = world.chunkAt(z);
      const gull = this.gulls.find((g) => !g.live);
      const laneX = LANES[r.lane], lead = r.speed * 0.9;                // ~a jump length on the runner's side of the spot
      if (gull && ch && (ch.biome === 'beach' || ch.biome === 'pier') && ch.mode === 'run' && ch.tide !== 'surge' && this.apart(z, r.speed * 1.1) && this.clear(world, z + lead / 2, lead / 2 + 4, laneX)) {
        this.nextGull = this.clock + Math.max(3.2, 6.6 - tier * 0.85) + Math.random() * 2;
        const floor = world.floorAt(laneX, z);
        Object.assign(gull, { live: true, laneX, zImp: z, side: Math.random() < 0.5 ? -1 : 1, t: 0, surface: floor ?? world.groundAt(laneX, z) });
        gull.fly.root.visible = true; gull.shadow.visible = true;
        this.onGull?.();
      }
    }
  }

  /** is anything solid in the box x0..x1, y0..y1, within `dz` of z? */
  private solidIn(world: ChunkManager, z: number, dz: number, x0: number, x1: number, y0: number, y1: number) {
    for (const { chunk, ob } of world.obstaclesNear(z, dz + 4)) {
      const s = ob.shape, oz = chunk.zStart - s.along;
      const half = s.kind === 'sphere' ? s.r : Math.max(s.sx, s.sz) / 2;
      const sy0 = s.kind === 'sphere' ? s.y - s.r : s.y, sy1 = s.kind === 'sphere' ? s.y + s.r : s.y + s.sy, bob = ob.bob ? ob.bob.amp : 0;
      if (Math.abs(oz - z) < dz + half && s.x + half > x0 && s.x - half < x1 && sy1 + bob > y0 && sy0 - bob < y1) return true;
    }
    return false;
  }

  private spawnShark(r: Runner, world: ChunkManager) {
    const tier = r.distance < 200 ? 0 : r.distance < 550 ? 1 : r.distance < 1000 ? 2 : r.distance < 1600 ? 3 : 4;
    const k = this.sharks.find((q) => !q.live);
    if (tier < 1 || !k || this.clock < this.nextShark) return;
    const z = r.pos.z - r.speed * SHARK_WARN, ch = world.chunkAt(z);
    if (!ch || ch.patternId !== 'coral_sharks' || ch.tide === 'surge') return;
    // no reef gate near the crossing (you'd be lining up with a hole)
    for (const c of world.chunks) for (const g of c.rings ?? []) if (Math.abs(c.zStart - g.along - z) < 12) return;
    const floor = world.groundAt(r.pos.x, z) + 0.9, ceil = -1.1;
    const y = Math.max(floor + 1.2, Math.min(ceil - 0.9, r.hipY));
    const dir = Math.random() < 0.5 ? -1 : 1, x0 = r.pos.x - dir * SHARK_SPEED * SHARK_WARN;
    // its own line clear, end to end, and room to get out of the way above or below where it crosses you
    const xa = Math.min(x0, r.pos.x + dir * 8), xb = Math.max(x0, r.pos.x + dir * 8);
    if (this.solidIn(world, z, 1.5, xa - 1.5, xb + 1.5, y - 0.9, y + 0.9)) return;
    const up = y + 2.4 < ceil && !this.solidIn(world, z, 6, r.pos.x - 4, r.pos.x + 4, y + 0.8, y + 2.6);
    const down = y - 2.4 > floor && !this.solidIn(world, z, 6, r.pos.x - 4, r.pos.x + 4, y - 2.6, y - 0.8);
    if (!up && !down) return;
    this.nextShark = this.clock + Math.max(1.8, 2.6 - tier * 0.2) + Math.random() * 0.8;
    Object.assign(k, { live: true, x: x0, y, z, dir, t: 0, escape: up && down ? (y > (floor + ceil) / 2 ? -1 : 1) : up ? 1 : -1, near: false });
    k.mesh.visible = true;
    this.onShark?.();
  }

  private fireCannons(r: Runner, world: ChunkManager) {
    for (const ch of world.chunks) {
      if (ch.mode !== 'run' || ch.tide === 'surge') continue;
      ch.obstacles.forEach((ob, i) => {
        if (ob.name !== 'HIT A CANNON') return;
        const key = `${ch.id}:${i}`, cz = ch.zStart - ob.shape.along, dist = r.pos.z - cz;
        if (this.cannons.has(key) || dist > CANNON_RANGE || dist < 20) return;
        this.cannons.add(key);                                           // decided once, fire or not
        const ball = this.balls.find((b) => !b.live);
        if (!ball || Math.random() > 0.85) return;
        // where the ball meets you: a jump + 0.25 s + 2 m before the cannon; how fast it has to roll to get there
        const meet = r.speed * (MOVE.jumpTime + 0.25) + 2, x = ob.shape.x, zMeet = cz + meet;
        const v = r.speed * meet / Math.max(1, dist - meet);
        if (v < 2.5 || v > 9) return;
        // fair: the ball's lane is otherwise empty round the meeting point, nothing overhead near, no crab or gull
        let blocked = false;
        for (const { chunk, ob: o } of world.obstaclesNear(zMeet, meet + 4)) {
          if (o === ob) continue;
          const sh = o.shape, oz = chunk.zStart - sh.along, half = sh.kind === 'sphere' ? sh.r : Math.max(sh.sx, sh.sz) / 2;
          if (Math.abs(sh.x - x) < half + 1.2 && Math.abs(oz - zMeet) < meet - 1 + half) blocked = true;
        }
        if (blocked || !this.clear(world, zMeet, 0, null, r.speed * 0.9) || !this.apart(zMeet, r.speed * 1.1)) return;
        Object.assign(ball, { live: true, near: false, x, z: cz + 1.2, v, roll: 0 });
        ball.mesh.visible = true;
        this.onCannon?.(x, world.groundAt(x, cz) + 0.75, cz + 1.15);
      });
    }
  }

  private stepBall(b: Ball, dt: number, r: Runner, world: ChunkManager) {
    b.z += b.v * dt; b.roll += (b.v / BALL_R) * dt;
    const g = world.floorAt(b.x, b.z) ?? world.groundAt(b.x, b.z);
    b.mesh.position.set(b.x, g + BALL_R, b.z);
    b.mesh.rotation.set(b.roll, 0, 0);
    if (b.z > r.pos.z + 12 || r.mode === 'swim') { b.live = false; b.mesh.visible = false; return; }
    // collision: a low ball; a jump clears it
    const dx = Math.abs(r.pos.x - b.x), dz = Math.abs(r.pos.z - b.z), feet = r.pos.y - g;
    if (dx < BALL_R + 0.35 && dz < BALL_R + 0.3) {
      if (feet < BALL_R * 2 - 0.05 && r.invuln <= 0) { r.hurt('HIT BY A CANNONBALL'); b.live = false; b.mesh.visible = false; }
      else if (feet >= BALL_R * 2 - 0.05 && !b.near) { b.near = true; r.events.push({ kind: 'near', closeness: 0.8, ob: AS_NEAR }); }
    }
  }

  private stepShark(k: Shark, dt: number, r: Runner) {
    k.t += dt; k.x += k.dir * SHARK_SPEED * dt;
    const wig = Math.sin(k.t * 9);
    k.mesh.position.set(k.x, k.y + Math.sin(k.t * 2) * 0.08, k.z);
    // the model faces +z; turn it to swim along x, with a tail beat
    k.mesh.rotation.set(0, k.dir * Math.PI / 2 + wig * 0.12, wig * 0.05);
    if (k.x * k.dir > 26 || k.z > r.pos.z + 20) { k.live = false; k.mesh.visible = false; return; }
    // collision: its body is a capsule along x at (y, z)
    const cx = Math.max(k.x - SHARK_HALF, Math.min(k.x + SHARK_HALF, r.pos.x));
    const dx = Math.abs(r.pos.x - cx), dy = Math.abs(r.hipY - k.y), dz = Math.abs(r.pos.z - k.z);
    if (r.mode === 'swim' && dz < 0.42 + 0.35 && dx < 0.42 + 0.35 && dy < 0.42 + 0.45) { if (r.invuln <= 0) r.hurt('A SHARK GOT YOU'); }
    else if (!k.near && dz < 0.8 && Math.hypot(dx, dy) < 1.8) { k.near = true; r.events.push({ kind: 'near', closeness: 0.8, ob: AS_NEAR }); }
  }

  private stepCrab(c: Crab, dt: number, r: Runner, world: ChunkManager) {
    c.x += c.dir * CRAB_SPEED * dt;
    const g = world.groundAt(c.x, c.z);
    c.mesh.position.set(c.x, g + 0.03 * Math.abs(Math.sin(this.clock * 18)), c.z);
    c.mesh.rotation.set(0, 0, 0.08 * Math.sin(this.clock * 18));
    if (c.x * c.dir > 9 || c.z > r.pos.z + 10) { c.live = false; c.mesh.visible = false; return; }   // off the far side, or behind
    // collision: a low box; a jump clears it (feet above its 0.55 m top, less a little grace)
    const dx = Math.abs(r.pos.x - c.x), dz = Math.abs(r.pos.z - c.z), feet = r.pos.y - g;
    if (dx < 0.85 && dz < 0.6) {
      if (feet < 0.48 && r.invuln <= 0) r.hurt('PINCHED BY A CRAB');
      else if (feet >= 0.48 && !c.jumped) { c.jumped = true; r.events.push({ kind: 'near', closeness: 0.7, ob: AS_NEAR }); }
    }
  }

  private stepGull(gl: Gull, dt: number, r: Runner, _world: ChunkManager) {
    gl.t += dt;
    const u = gl.t / GULL_WARN;
    const s = gl.surface;
    // the shadow grows and darkens on the target spot until the swoop
    const k = Math.min(1, u);
    gl.shadow.position.set(gl.laneX, s + 0.1, gl.zImp);
    gl.shadow.scale.setScalar(0.7 + 0.7 * k);
    (gl.shadow.material as THREE.MeshBasicMaterial).opacity = u < 1.15 ? 0.25 + 0.4 * k : Math.max(0, 0.65 - (u - 1.15) * 3);
    // flight: from high, ahead and off to one side, down through the target spot at head height, then up and away
    const a = new THREE.Vector3(gl.laneX + gl.side * 7, s + 10, gl.zImp - 18);
    const b = new THREE.Vector3(gl.laneX, s + 1.45, gl.zImp);
    const c = new THREE.Vector3(gl.laneX - gl.side * 5, s + 8, gl.zImp + 12);
    const p = u < 1 ? a.clone().lerp(b, 1 - Math.pow(1 - u, 2)) : b.clone().lerp(c, Math.min(1, (u - 1) / 0.7) ** 1.6);
    const ahead = u < 1 ? b.clone().sub(a) : c.clone().sub(b);
    gl.fly.root.position.copy(p);
    gl.fly.face(ahead.x, ahead.y, ahead.z, gl.side * (u < 1 ? 0.35 : -0.5));
    // wings half-folded in the dive, then hard beats to climb away
    gl.fly.wings(u < 1 ? 0.05 + 0.05 * Math.sin(gl.t * 6) : 0.25 + 0.8 * Math.sin(gl.t * 18));
    if (u > 1.9) { gl.live = false; gl.fly.root.visible = false; gl.shadow.visible = false; return; }
    // collision near the bottom of the swoop: standing (or jumping) into it is a hit, sliding passes under
    if (u > 0.82 && u < 1.2) {
      const h = Math.hypot(r.pos.x - p.x, r.pos.z - p.z);
      const bottom = r.pos.y, top = r.pos.y + r.height;
      if (h < 0.8 && p.y + 0.42 > bottom && p.y - 0.42 < top && r.invuln <= 0) r.hurt('HIT BY A GULL');
    }
  }
}
