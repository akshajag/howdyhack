import * as THREE from 'three';
import { loadMesh } from '../core/assets';
import type { Runner } from './runner';
import type { ChunkManager } from './chunks';
import type { Streams } from '../fx/streams';
import { waveY } from './wave';

/**
 * Ambient wildlife: life on screen with nothing to dodge (no collision anywhere here).
 *  - gulls standing on the sand beside the lanes and on the pier rails flap away as you run up to them
 *  - a few gulls wheel overhead; dolphin pods leap offshore, pacing you for a few jumps; sailboats drift far out
 *  - under water, sea turtles paddle through the canyon, and in the grotto glowing plankton drifts in the dark and
 *    swirls round you as you swim through it
 *  - the collie by the research station at the start (Reveille) turns her head to watch you come, until she gets up
 *    to run with you (pet.ts)
 *  - at Shorebreak Point dolphins breach out past the wave, a gull now and then swoops down to skim the face just ahead
 *    of you, and surfers far out ride their own swells
 * Everything is pooled and placed relative to the runner, so it also livens up the title screen.
 */

/** a flying gull: body plus two wings hinged at the shoulders (the left is the right wing mirrored) */
export class FlyGull {
  readonly root = new THREE.Group();
  private wr: THREE.Mesh; private wl: THREE.Mesh;
  /** `shoulder`: half the body's width at the wing roots (a pelican's are wider set than a gull's) */
  constructor(body: THREE.BufferGeometry, wing: THREE.BufferGeometry, mat: THREE.Material, shoulder = 0.1) {
    const b = new THREE.Mesh(body, mat);
    this.wr = new THREE.Mesh(wing, mat); this.wl = new THREE.Mesh(wing, mat);
    this.wr.position.set(shoulder, 0.06, 0); this.wl.position.set(-shoulder, 0.06, 0); this.wl.scale.x = -1;
    for (const m of [b, this.wr, this.wl]) { m.castShadow = true; this.root.add(m); }
    this.root.rotation.order = 'YXZ';
    this.root.visible = false;
  }
  /** wing angle in radians, up positive */
  wings(a: number) { this.wr.rotation.z = a; this.wl.rotation.z = -a; }
  /** face along a velocity, nose pitched with the climb, rolled by `bank` */
  face(vx: number, vy: number, vz: number, bank = 0) {
    this.root.rotation.set(-Math.atan2(vy, Math.hypot(vx, vz)) * 0.7, Math.atan2(vx, vz), bank);
  }
}

export async function loadGullParts() {
  const [body, wing] = await Promise.all([loadMesh('runner/models/Gull_Body.glb'), loadMesh('runner/models/Gull_Wing.glb')]);
  return { body: body.geometry, wing: wing.geometry };
}

/** a gull on the ground: stand (fidget, peck, shuffle) -> walk off, or crouch -> fly. Every bird has its own nerve
 *  (how close you get before it reacts), wingbeat and line, so a flock breaks up rather than lifting as one */
interface Perched {
  perch: THREE.Mesh; fly: FlyGull; live: boolean; state: 'stand' | 'walk' | 'crouch' | 'fly';
  x: number; y: number; z: number; yaw: number; look: number; side: number; t: number; next: number;
  nerve: number; walker: boolean; rail: boolean; steps: number; hop: number;
  heading: number; turn: number; speed: number; climb: number; beat: number; amp: number; burst: number;
}
interface Wheeler { fly: FlyGull; c: THREE.Vector3; r: number; w: number; a: number; flapAt: number }
interface Dolphin { mesh: THREE.Mesh; live: boolean; x: number; z: number; t: number; h: number; leaps: number; inAir: boolean }
interface Boat { mesh: THREE.Mesh; x: number; z: number; v: number; ph: number }
interface Turtle { root: THREE.Group; fl: THREE.Mesh; fr: THREE.Mesh; live: boolean; x: number; y: number; z: number; vx: number; vz: number; t: number }

const PLANKTON = 260;
const DOLPHIN_PERIOD = 1.55, DOLPHIN_AIR = 0.95;

export class Wildlife {
  readonly group = new THREE.Group();
  private perched: Perched[] = [];
  private wheelers: Wheeler[] = [];
  private dolphins: Dolphin[] = [];
  private boats: Boat[] = [];
  private turtles: Turtle[] = [];
  private plankton!: THREE.Points;
  private pPos = new Float32Array(PLANKTON * 3);
  private pVel = new Float32Array(PLANKTON * 3);
  private pPh = new Float32Array(PLANKTON);
  private pFade = 0;
  private clock = 0;
  private nextFlock = 0;            // course distance (m) for the next flock of standing gulls
  private nextPod = 6;              // clock (s) for the next dolphin pod
  private nextTurtle = 4;
  /** Shorebreak Point: a gull that skims the wave ahead of you, and surfers far out */
  private skimmer!: FlyGull;
  private skim = { t: -1, x: 0, z: 0, v: 0, next: 6 };
  private farSurfers: { mesh: THREE.Mesh; x: number; z: number; ph: number }[] = [];
  /** the collie's head (its body is an ordinary prop placed with the research station) */
  private collieHead!: THREE.Mesh;
  private headYaw = 0;
  /** sound cues */
  onFlutter: (() => void) | null = null;
  onSquawk: (() => void) | null = null;
  onSplash: ((size: number) => void) | null = null;

  constructor(private material: THREE.Material, private streams: Streams) {}

  async load() {
    const [gull, perch, dolphin, boat, turtle, flipper, head, surfer] = await Promise.all([
      loadGullParts(), loadMesh('runner/models/Gull_Perch.glb'), loadMesh('runner/models/Dolphin.glb'), loadMesh('runner/models/Sailboat.glb'),
      loadMesh('runner/models/Turtle_Body.glb'), loadMesh('runner/models/Turtle_Flipper.glb'), loadMesh('runner/models/Collie_Head.glb'), loadMesh('runner/models/Surfer_Far.glb'),
    ]);
    const mat = this.material;
    this.skimmer = new FlyGull(gull.body, gull.wing, mat); this.skimmer.root.scale.setScalar(1.4); this.group.add(this.skimmer.root);
    for (let i = 0; i < 2; i++) { const m = new THREE.Mesh(surfer.geometry, mat); m.visible = false; m.scale.setScalar(1.3); this.group.add(m); this.farSurfers.push({ mesh: m, x: 0, z: 1e9, ph: Math.random() * 6 }); }
    this.collieHead = new THREE.Mesh(head.geometry, mat); this.collieHead.visible = false; this.collieHead.castShadow = true;
    this.collieHead.rotation.order = 'YXZ'; this.group.add(this.collieHead);
    for (let i = 0; i < 12; i++) {
      // (a little over life size, so they read at running pace)
      const p = new THREE.Mesh(perch.geometry, mat); p.visible = false; p.castShadow = true; p.scale.setScalar(1.25);
      const f = new FlyGull(gull.body, gull.wing, mat); f.root.scale.setScalar(1.25);
      this.group.add(p, f.root);
      this.perched.push({ perch: p, fly: f, live: false, state: 'stand', x: 0, y: 0, z: 0, yaw: 0, look: 0, side: 1, t: 0, next: 0, nerve: 12, walker: false, rail: false, steps: 0, hop: 0,
        heading: 0, turn: 0, speed: 0, climb: 0, beat: 15, amp: 0.4, burst: 0 });
    }
    for (let i = 0; i < 3; i++) {
      const f = new FlyGull(gull.body, gull.wing, mat); f.root.scale.setScalar(1.6); this.group.add(f.root);
      this.wheelers.push({ fly: f, c: new THREE.Vector3(0, 0, 1e9), r: 10, w: 0.4, a: Math.random() * 6.28, flapAt: Math.random() * 3 });
    }
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(dolphin.geometry, mat); m.visible = false; m.rotation.order = 'YXZ'; m.scale.setScalar(1.3); this.group.add(m);
      this.dolphins.push({ mesh: m, live: false, x: 0, z: 0, t: 0, h: 2, leaps: 0, inAir: false });
    }
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(boat.geometry, mat); m.visible = false; m.rotation.order = 'YXZ'; this.group.add(m);
      this.boats.push({ mesh: m, x: 0, z: 1e9, v: 2, ph: Math.random() * 6 });
    }
    for (let i = 0; i < 2; i++) {
      const root = new THREE.Group(); root.visible = false; root.rotation.order = 'YXZ';
      root.scale.setScalar(1.5);                                     // a big old green turtle
      const body = new THREE.Mesh(turtle.geometry, mat), fr = new THREE.Mesh(flipper.geometry, mat), fl = new THREE.Mesh(flipper.geometry, mat);
      fr.position.set(0.3, 0, 0.32); fl.position.set(-0.3, 0, 0.32); fl.scale.x = -1;
      root.add(body, fr, fl); this.group.add(root);
      this.turtles.push({ root, fl, fr, live: false, x: 0, y: 0, z: 0, vx: 0, vz: 0, t: 0 });
    }
    // glowing plankton: soft round dots, added light, brightest when you disturb them
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PLANKTON * 3), 3));
    for (let i = 0; i < PLANKTON; i++) this.pPh[i] = Math.random() * 100;
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d')!; const grd = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = grd; x.fillRect(0, 0, 32, 32);
    this.plankton = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.plankton.frustumCulled = false; this.plankton.visible = false;
    this.group.add(this.plankton);
  }

  reset() {
    this.skim.t = -1; this.skim.next = this.clock + 6;
    for (const p of this.perched) if (p.state === 'fly') this.free(p);
    for (const d of this.dolphins) { d.live = false; d.mesh.visible = false; }
    for (const t of this.turtles) { t.live = false; t.root.visible = false; }
    for (const w of this.wheelers) w.c.z = 1e9;
    for (const b of this.boats) b.z = 1e9;
    this.nextFlock = 0; this.nextPod = this.clock + 6; this.nextTurtle = this.clock + 4;
    this.pFade = 0;
  }

  update(dt: number, r: Runner, world: ChunkManager, waterY: number) {
    if (dt <= 0) return;
    this.clock += dt;
    const swim = r.mode === 'swim';
    this.updatePerched(dt, r, world, waterY);
    this.updateWheelers(dt, r, world, swim);
    this.updateDolphins(dt, r, world, waterY, swim);
    this.updateBoats(dt, r, world, waterY, swim);
    this.updateTurtles(dt, r, world, waterY, swim);
    this.updatePlankton(dt, r, world);
    this.updateCollie(dt, r, world);
    this.updateSurf(dt, r, world, waterY);
  }

  // ---------------------------------------------------------------- Shorebreak Point
  private updateSurf(dt: number, r: Runner, world: ChunkManager, waterY: number) {
    const ch = world.chunkAt(r.pos.z), surf = r.mode === 'board' && !!ch?.wave;
    // a gull swoops down from behind, skims the upper face just ahead of you, and climbs away
    const s = this.skim, g = this.skimmer;
    if (surf && s.t < 0 && this.clock > s.next) { s.t = 0; s.x = ch!.wave!.crest(ch!.zStart - r.pos.z) + 2.5 + Math.random() * 2; s.z = r.pos.z + 14; s.v = r.speed + 6; }
    if (s.t >= 0) {
      s.t += dt; s.z -= s.v * dt;
      const c = world.chunkAt(s.z), w = c?.wave;
      const water = waterY + (w ? waveY(w, s.x, c!.zStart - s.z) : 0);
      const dive = Math.min(1, s.t / 1.2), climb = Math.max(0, (s.t - 2.4) / 1.2);
      const y = water + 0.55 + 9 * (1 - dive) ** 2 + 11 * climb * climb;
      g.root.visible = true;
      g.root.position.set(s.x, y, s.z);
      g.face(0, s.t < 1.2 ? -8 * (1 - dive) : climb * 8, -s.v, Math.sin(s.t * 2) * 0.25);
      g.wings(s.t < 1.2 || s.t > 2.4 ? 0.15 + 0.6 * Math.sin(this.clock * 9) : -0.08);    // (glides wings-level along the water)
      if (s.t > 1.3 && s.t < 2.3 && Math.random() < dt * 6) this.streams.burst(s.x + 0.4, water + 0.05, s.z + 0.5, 3, 1.0, 1.2);
      if (s.t > 3.6) { s.t = -1; s.next = this.clock + 8 + Math.random() * 7; g.root.visible = false; }
    } else g.root.visible = false;
    // surfers far out riding their own swells, drawing level with you very slowly
    for (const f of this.farSurfers) {
      if (!surf) { f.mesh.visible = false; f.z = 1e9; continue; }
      if (f.z > r.pos.z + 30 || f.z < r.pos.z - 260) { f.x = -(62 + Math.random() * 30); f.z = r.pos.z - 60 - Math.random() * 120; }
      f.ph += dt; f.z -= r.speed * 0.97 * dt;
      f.mesh.visible = true;
      f.mesh.position.set(f.x + Math.sin(f.ph * 0.7) * 3, waterY + 0.9 + Math.sin(f.ph * 1.3) * 0.7, f.z);
      f.mesh.rotation.set(0, Math.PI + Math.sin(f.ph * 0.7) * 0.4, Math.sin(f.ph * 1.3 + 1) * 0.15);
      if (Math.random() < dt * 4) this.streams.burst(f.mesh.position.x + 0.5, waterY + 0.4, f.z + 1, 3, 1.5, 1.5);
    }
  }

  // ---------------------------------------------------------------- the collie by the research station (her head)
  private updateCollie(dt: number, r: Runner, world: ChunkManager) {
    const body = world.collie();                                 // (gone once she has got up to run with you)
    this.collieHead.visible = !!body;
    if (!body) return;
    // the neck sits 0.7 m up and 0.2 m forward of the body's origin (model space, facing +z)
    const s = Math.sin(body.yaw), co = Math.cos(body.yaw);
    const hx = body.x + s * 0.195, hz = body.z + co * 0.195;
    this.collieHead.position.set(hx, body.y + 0.7, hz);
    // look at the runner (within what a neck can do), easing round; a tilt of the head as you go by
    const want = Math.atan2(r.pos.x - hx, r.pos.z - hz);
    let rel = want - body.yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    rel = Math.max(-1.3, Math.min(1.3, rel));
    this.headYaw += (rel - this.headYaw) * Math.min(1, dt * 4);
    const near = Math.max(0, 1 - Math.abs(r.pos.z - hz) / 12);
    this.collieHead.rotation.set(-0.12 + Math.sin(this.clock * 1.3) * 0.03, body.yaw + this.headYaw, near * 0.22 * Math.sign(this.headYaw));
  }

  // ---------------------------------------------------------------- standing gulls
  private free(p: Perched) { p.live = false; p.state = 'stand'; p.perch.visible = false; p.fly.root.visible = false; }

  /** nothing (obstacle or dressing) standing on this spot */
  private spotFree(world: ChunkManager, x: number, z: number, rad: number) {
    for (const { chunk, ob } of world.obstaclesNear(z, rad + 4)) {
      const s = ob.shape, oz = chunk.zStart - s.along, half = s.kind === 'sphere' ? s.r : Math.max(s.sx, s.sz) / 2;
      if (Math.abs(oz - z) < half + rad && Math.abs(s.x - x) < half + rad) return false;
    }
    const ch = world.chunkAt(z);
    if (ch) for (const p of ch.props) if (Math.abs(p.x - x) < rad && Math.abs(ch.zStart - p.along - z) < rad) return false;
    return true;
  }

  private spawnFlock(r: Runner, world: ChunkManager, waterY: number) {
    const z0 = r.pos.z - 45 - Math.random() * 30;
    const ch = world.chunkAt(z0);
    if (!ch || ch.mode !== 'run' || ch.tide === 'surge' || (ch.biome !== 'beach' && ch.biome !== 'pier')) return;
    const n = 2 + Math.floor(Math.random() * 3), side = Math.random() < 0.5 ? -1 : 1;
    const pier = ch.biome === 'pier';
    let placed = 0, along = 0;
    for (const p of this.perched) {
      if (p.live || placed >= n) continue;
      let x: number, y: number, z: number;
      if (pier) {
        // in a row on top of a pier rail, a little apart (only where a rail really stands)
        x = side * 4.1; along += 0.9 + Math.random() * 0.8; z = z0 - along;
        const c = world.chunkAt(z), rail = c?.props.find((q) => q.kit === 'Pier_Rail_4m' && Math.abs(q.x - x) < 0.2 && Math.abs(c.zStart - q.along - z) < 1.9);
        if (!rail) continue;
        y = rail.y + 1.0 * rail.scale;
      } else {
        x = side * (4.3 + Math.random() * 2.6); z = z0 + (Math.random() - 0.5) * 3; y = world.groundAt(x, z);
        if (y < waterY + 0.1 || world.floorAt(x, z) !== null || !this.spotFree(world, x, z, 0.9)) continue;
      }
      const yaw = (pier ? -side * Math.PI / 2 : Math.random() * 6.28) + (Math.random() - 0.5) * 0.9;
      Object.assign(p, { live: true, state: 'stand', x, y, z, side, yaw, look: yaw, t: 0, next: Math.random() * 2,
        // the bolder ones let you come close; birds well off the lanes may just walk away
        nerve: 7 + Math.random() * 16, walker: !pier && Math.abs(x) > 5.5 && Math.random() < 0.45, rail: pier, steps: 0, hop: 0 });
      p.perch.position.set(x, y, z); p.perch.rotation.set(0, yaw, 0); p.perch.visible = true;
      placed++;
    }
  }

  private updatePerched(dt: number, r: Runner, world: ChunkManager, waterY: number) {
    if (r.distance >= this.nextFlock && r.mode !== 'swim') {
      this.nextFlock = r.distance + 35 + Math.random() * 45;
      this.spawnFlock(r, world, waterY);
    }
    let fluttered = false;
    for (const p of this.perched) {
      if (!p.live) continue;
      const ahead = r.pos.z - p.z;
      if (ahead < -30 || ahead > 160 || p.y > 40) { this.free(p); continue; }   // passed, flown off, or left behind by a restart
      p.t += dt; p.next -= dt;
      const near = ahead < p.nerve && r.speed > 2;
      if (p.state === 'stand') {
        // fidget: turn the head (the whole bird) smoothly toward somewhere new, peck at the sand, shuffle a step
        if (p.next <= 0) {
          p.next = 0.6 + Math.random() * 2.2;
          const k = Math.random();
          if (k < 0.5) p.look = p.yaw + (Math.random() - 0.5) * 1.4;
          else if (k < 0.8) p.hop = 0.32;                                // peck
          else if (!p.rail) { p.steps = 1; p.state = 'walk'; p.t = 0; }  // a single step (not along a rail)
        }
        if (near) {
          if (p.walker) { p.state = 'walk'; p.steps = 3 + Math.floor(Math.random() * 3); p.look = Math.atan2(p.side, -0.3 + Math.random() * 0.6); p.t = 0; }
          else { p.state = 'crouch'; p.t = 0; p.next = 0.1 + Math.random() * 0.25; }
        }
      } else if (p.state === 'walk') {
        // little hopping steps, a step every 0.22 s
        const ph = (p.t % 0.22) / 0.22;
        p.x += Math.sin(p.look) * dt * 1.6; p.z += Math.cos(p.look) * dt * 1.6; p.y = world.groundAt(p.x, p.z);
        p.perch.position.y = p.y + Math.sin(ph * Math.PI) * 0.06;
        if (p.t > 0.22 * p.steps) { p.state = 'stand'; p.yaw = p.look; p.next = 0.5 + Math.random(); }
        // a walker that still gets crowded flies after all
        if (p.walker && ahead < Math.min(5, p.nerve * 0.4)) { p.walker = false; p.state = 'crouch'; p.t = 0; p.next = 0.1; }
      } else if (p.state === 'crouch') {
        p.perch.position.y = p.y - 0.06;
        if (p.next <= 0) {
          // off: a line of its own, mostly away from the lanes, some along the beach either way
          p.state = 'fly'; p.t = 0; p.perch.visible = false; p.fly.root.visible = true;
          const away = Math.atan2(p.side, 0);
          p.heading = away + (Math.random() - 0.5) * 2.2 + (Math.random() < 0.3 ? Math.PI * 0.6 * (Math.random() < 0.5 ? 1 : -1) : 0);
          p.turn = (Math.random() - 0.5) * 0.9; p.speed = 3 + Math.random() * 2.5; p.climb = 1.6 + Math.random() * 1.0;
          p.beat = 13 + Math.random() * 5; p.amp = 0.32 + Math.random() * 0.16; p.burst = 0.6 + Math.random() * 0.7;
          if (!fluttered && Math.abs(ahead) < 30) { fluttered = true; this.onFlutter?.(); if (Math.random() < 0.3) this.onSquawk?.(); }
        }
      } else {
        // flying: climb that eases off, a slow wandering turn, wingbeats in bursts between glides
        p.turn += (Math.random() - 0.5) * dt * 1.5; p.turn *= Math.exp(-dt * 0.4);
        p.heading += p.turn * dt;
        p.climb = Math.max(0.5, p.climb - dt * 0.8);
        const vx = Math.sin(p.heading) * p.speed, vz = Math.cos(p.heading) * p.speed;
        p.x += vx * dt; p.z += vz * dt; p.y += p.climb * dt;
        p.burst -= dt;
        if (p.burst < -1.4) p.burst = 0.3 + Math.random() * 0.4;     // another few beats after a glide
        p.fly.wings(p.burst > 0 ? 0.1 + p.amp * Math.sin(p.t * p.beat) : 0.12 + 0.03 * Math.sin(p.t * 2));
        p.fly.root.position.set(p.x, p.y, p.z);
        p.fly.face(vx, p.climb, vz, -p.turn * 0.6);
      }
      if (p.state !== 'fly') {
        const ry = p.perch.rotation.y;
        p.perch.rotation.y = ry + (p.look - ry) * Math.min(1, dt * 8);
        p.hop = Math.max(0, p.hop - dt);
        p.perch.rotation.x = p.hop > 0 ? Math.sin((p.hop / 0.32) * Math.PI) * 0.45 : 0;   // the peck: tip forward and back
        p.perch.position.x = p.x; p.perch.position.z = p.z;
        if (p.state === 'stand') p.perch.position.y = p.y;
      }
    }
  }

  // ---------------------------------------------------------------- gulls wheeling overhead
  private updateWheelers(dt: number, r: Runner, world: ChunkManager, swim: boolean) {
    for (const w of this.wheelers) {
      if (w.c.z > r.pos.z + 25 || w.c.z < r.pos.z - 260) {
        w.c.set((Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 10), 0, r.pos.z - 50 - Math.random() * 50);
        w.c.y = Math.max(0, world.groundAt(w.c.x, w.c.z)) + 8 + Math.random() * 5;
        w.r = 6 + Math.random() * 5; w.w = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.25);
      }
      w.fly.root.visible = !swim;
      if (swim) continue;
      w.a += w.w * dt;
      const x = w.c.x + Math.cos(w.a) * w.r, z = w.c.z + Math.sin(w.a) * w.r, y = w.c.y + Math.sin(w.a * 2.3) * 0.8;
      w.fly.root.position.set(x, y, z);
      w.fly.face(-Math.sin(w.a) * w.w, 0, Math.cos(w.a) * w.w, Math.sign(w.w) * 0.45);
      // mostly gliding, a few lazy wingbeats every few seconds
      w.flapAt -= dt;
      if (w.flapAt < -0.9) w.flapAt = 2 + Math.random() * 3;
      w.fly.wings(w.flapAt < 0 ? 0.2 + 0.55 * Math.sin(this.clock * 10) : 0.12);
    }
  }

  // ---------------------------------------------------------------- dolphins offshore
  /** the nearest water past the surf to leap from (they only show in the air, so half a metre is plenty) */
  private seaX(world: ChunkManager, waterY: number, z: number, side: number) {
    for (let d = 14; d <= 56; d += 2) {
      const x = side * d, deep = (gx: number, gz: number) => world.groundAt(gx, gz) < waterY - 0.5;
      if (deep(x, z) && deep(x, z - 35) && deep(x + side * 4, z - 15)) return x + side * 3;
    }
    return null;
  }

  private updateDolphins(dt: number, r: Runner, world: ChunkManager, waterY: number, swim: boolean) {
    if (!swim && this.clock > this.nextPod && this.dolphins.every((d) => !d.live)) {
      this.nextPod = this.clock + 14 + Math.random() * 14;
      const z0 = r.pos.z - 14 - Math.random() * 8;
      const ch = world.chunkAt(z0);
      if (ch && ch.tide !== 'surge' && ((ch.mode === 'run' && (ch.biome === 'beach' || ch.biome === 'pier')) || ch.biome === 'surf')) {
        const sides = ch.biome === 'pier' ? [Math.random() < 0.5 ? -1 : 1] : [-1];
        // (at the surf, out past the back of the wave)
        const x0 = ch.biome === 'surf' ? -(30 + Math.random() * 18) : this.seaX(world, waterY, z0, sides[0]);
        if (x0 !== null) {
          const n = 2 + Math.floor(Math.random() * 2);
          this.dolphins.slice(0, n).forEach((d, k) => Object.assign(d, { live: true, x: x0 + (Math.random() - 0.5) * 3, z: z0 - k * 2.6 - Math.random(), t: -k * 0.28, h: 1.5 + Math.random() * 0.6, leaps: 3 + Math.floor(Math.random() * 2), inAir: false }));
        }
      } else this.nextPod = this.clock + 3;
    }
    const pace = Math.max(r.speed, 6) * 0.96;                       // a touch slower: you slowly draw level
    for (const d of this.dolphins) {
      if (!d.live) continue;
      d.t += dt; d.z -= pace * dt;
      const cyc = Math.floor(d.t / DOLPHIN_PERIOD), u = (d.t - cyc * DOLPHIN_PERIOD) / DOLPHIN_AIR;
      const air = d.t >= 0 && u < 1 && cyc < d.leaps;
      if (air !== d.inAir) {
        // breaking the surface, out or back in
        this.streams.burst(d.x, waterY + 0.05, d.z, air ? 9 : 12, 2.0, 2.2);
        if (Math.abs(r.pos.z - d.z) < 35 && Math.random() < 0.6) this.onSplash?.(0.22);
        d.inAir = air;
      }
      const y = air ? waterY - 0.45 + d.h * 4 * u * (1 - u) : waterY - 1.8;
      const vy = air ? d.h * 4 * (1 - 2 * u) / DOLPHIN_AIR : 0;
      d.mesh.position.set(d.x, y, d.z);
      d.mesh.rotation.set(-Math.atan2(vy, pace), Math.PI, 0);
      d.mesh.visible = air;                                      // (between leaps it's under the surface)
      if (cyc >= d.leaps + 1 || d.z > r.pos.z + 30 || d.z < r.pos.z - 200) { d.live = false; d.mesh.visible = false; }
    }
  }

  // ---------------------------------------------------------------- sailboats on the horizon
  private updateBoats(dt: number, r: Runner, world: ChunkManager, waterY: number, swim: boolean) {
    for (const b of this.boats) {
      if (b.z > r.pos.z + 40 || b.z < r.pos.z - 420) {
        for (let i = 0; i < 6; i++) {
          b.x = -(75 + Math.random() * 70); b.z = r.pos.z - 120 - Math.random() * 220;
          if (world.groundAt(b.x, b.z) < waterY - 2) break;
        }
        b.v = (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 2.5);
      }
      b.z += b.v * dt; b.ph += dt;
      b.mesh.visible = !swim;
      b.mesh.position.set(b.x, waterY - 0.15 + Math.sin(b.ph * 1.1) * 0.08, b.z);
      b.mesh.rotation.set(Math.sin(b.ph * 0.9) * 0.03, b.v > 0 ? 0 : Math.PI, Math.sin(b.ph * 0.7) * 0.06 + 0.08);
    }
  }

  // ---------------------------------------------------------------- sea turtles under water
  private updateTurtles(dt: number, r: Runner, world: ChunkManager, waterY: number, swim: boolean) {
    if (swim && this.clock > this.nextTurtle) {
      this.nextTurtle = this.clock + 2;                               // (retry soon if this spot doesn't work)
      const t = this.turtles.find((q) => !q.live);
      const z = r.pos.z - 32 - Math.random() * 14, ch = world.chunkAt(z);
      if (t && ch && ch.biome === 'coral' && ch.tide !== 'surge' && !(ch.rings ?? []).some((q) => Math.abs(ch.zStart - q.along - z) < 6)) {
        // off to one side of where you're swimming, near your depth, so it passes right by
        const side = Math.random() < 0.5 ? -1 : 1, x = r.pos.x + side * (3.2 + Math.random() * 3);
        const lo = world.groundAt(x, z) + 1.6, hi = Math.min(waterY - 2.2, world.ceilingAt(x, z) - 1.5);
        const y = Math.max(lo, Math.min(hi, r.hipY + (Math.random() - 0.3) * 3));
        if (hi > lo && this.spotFree(world, x, z, 2.5)) {
          Object.assign(t, { live: true, x, y, z, t: Math.random() * 3, vx: -side * (0.2 + Math.random() * 0.3), vz: -(0.8 + Math.random() * 0.8) });
          t.root.visible = true;
          this.nextTurtle = this.clock + 9 + Math.random() * 9;
        }
      }
    }
    for (const t of this.turtles) {
      if (!t.live) continue;
      t.t += dt; t.x += t.vx * dt; t.z += t.vz * dt;
      const s = t.t * 2.1;
      t.root.position.set(t.x, t.y + Math.sin(s) * 0.06, t.z);
      t.root.rotation.set(Math.sin(s) * 0.05, Math.atan2(t.vx, t.vz), Math.sin(s * 0.5) * 0.08);
      // slow strokes: the front flippers sweep down and back, then glide
      t.fr.rotation.set(0, 0.35 * Math.cos(s), 0.25 + 0.55 * Math.sin(s));
      t.fl.rotation.set(0, -0.35 * Math.cos(s), -(0.25 + 0.55 * Math.sin(s)));
      if (!swim || t.z > r.pos.z + 14 || t.z < r.pos.z - 200) { t.live = false; t.root.visible = false; }
    }
  }

  // ---------------------------------------------------------------- grotto plankton
  private updatePlankton(dt: number, r: Runner, world: ChunkManager) {
    const ch = world.chunkAt(r.pos.z);
    const inCave = r.mode === 'swim' && ((ch?.biome === 'grotto') || world.ceilingAt(r.pos.x, r.pos.z) < Infinity);
    this.pFade += ((inCave ? 1 : 0) - this.pFade) * Math.min(1, dt * 1.2);
    this.plankton.visible = this.pFade > 0.01;
    if (!this.plankton.visible) return;
    const P = this.pPos, V = this.pVel, col = this.plankton.geometry.getAttribute('color') as THREE.BufferAttribute;
    const cx = r.pos.x, cy = r.hipY, cz = r.pos.z;
    for (let i = 0; i < PLANKTON; i++) {
      const k = i * 3;
      // keep a box of motes round the swimmer: one that just dropped behind reappears at the far end ahead, anything
      // else out of the box (first frame, a sharp turn) anywhere in it
      const rel = P[k + 2] - cz;
      if (rel > 6 || rel < -28 || Math.abs(P[k] - cx) > 10 || Math.abs(P[k + 1] - cy) > 4.5) {
        const behind = rel > 6 && rel < 30;
        P[k] = cx + (Math.random() - 0.5) * 18; P[k + 1] = cy + (Math.random() - 0.5) * 7;
        P[k + 2] = behind ? cz - 22 - Math.random() * 6 : cz + 6 - Math.random() * 34;
        V[k] = V[k + 1] = V[k + 2] = 0;
      }
      // the swimmer's wake pushes them aside and spins them
      const dx = P[k] - cx, dy = P[k + 1] - cy, dz = P[k + 2] - cz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 5) {
        const f = (5 - d2) * 1.6 * dt;
        V[k] += (dx + dy * 0.6) * f; V[k + 1] += (dy - dx * 0.6) * f; V[k + 2] += dz * f * 0.3 + r.speed * 0.05 * f;
      }
      const damp = Math.exp(-dt * 1.4);
      V[k] *= damp; V[k + 1] *= damp; V[k + 2] *= damp;
      P[k] += (V[k] + Math.sin(this.pPh[i] + this.clock * 0.4) * 0.08) * dt;
      P[k + 1] += (V[k + 1] + 0.05) * dt;
      P[k + 2] += V[k + 2] * dt;
      const stir = Math.min(1, Math.hypot(V[k], V[k + 1], V[k + 2]) * 0.6);
      const tw = (0.35 + 0.4 * (0.5 + 0.5 * Math.sin(this.pPh[i] * 3 + this.clock * (1.5 + (i % 5) * 0.4))) + stir) * this.pFade;
      col.setXYZ(i, 0.3 * tw, 0.95 * tw, 0.85 * tw);
    }
    (this.plankton.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    col.needsUpdate = true;
  }
}
