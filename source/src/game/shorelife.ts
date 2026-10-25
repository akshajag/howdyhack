import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadMesh } from '../core/assets';
import { env, swashFront } from '../core/env';
import { FlyGull, loadGullParts } from './wildlife';
import { waveY } from './wave';
import { PUFF, type Dust } from '../fx/dust';
import type { Ripples } from '../fx/ripples';
import type { Streams } from '../fx/streams';
import type { Runner } from './runner';
import type { ChunkManager } from './chunks';

/**
 * Small life along the shore, all cosmetic (no collision):
 *  - footprints in the sand behind you (and Reveille's paw prints beside them), fading as they dry, and wiped away
 *    when the swash runs up over them (the same swash line the sand shader draws, see env.swashFront)
 *  - sanderlings: little flocks on the wet sand at the water's edge that run down after each backwash and scurry back
 *    up ahead of the next uprush (real ones do it to catch the sand crabs it uncovers), and all lift off together, low
 *    over the water, when you come close
 *  - sandcastles beside the lanes, each with a tiny maroon pennant; the 12th Tide's flood slumps them into mounds
 *  - brown pelicans in a line, gliding low over the water (at Shorebreak Point riding the updraft over the wave's back),
 *    flapping follow-the-leader; now and then one folds up and plunges in after a fish, then sits bobbing on the water
 */

// ---------------------------------------------------------------- footprints
const PRINTS = 140, PAWS = 150, PRINT_LIFE = 9;
interface Print { x: number; y: number; z: number; t: number; erase: number; live: boolean }
const PRINT_DARK = new THREE.Color(0.64, 0.6, 0.55), PAW_DARK = new THREE.Color(0.7, 0.66, 0.61), WHITE = new THREE.Color(1, 1, 1);

function oval(rx: number, rz: number, cx: number, cz: number) {
  return new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2).scale(rx, 1, rz).translate(cx, 0, cz);
}
/** a bare foot (front toward -z): ball and heel */
const footGeo = () => mergeGeometries([oval(0.05, 0.07, 0, -0.06), oval(0.042, 0.05, 0, 0.07)]);
/** a paw: the pad and four toes */
const pawGeo = () => mergeGeometries([oval(0.032, 0.027, 0, 0.012), oval(0.012, 0.014, -0.03, -0.022), oval(0.012, 0.015, -0.011, -0.036), oval(0.012, 0.015, 0.011, -0.036), oval(0.012, 0.014, 0.03, -0.022)]);

// ---------------------------------------------------------------- sanderlings
interface Sander {
  mesh: THREE.Mesh; fly: FlyGull; live: boolean; state: 'run' | 'fly';
  x: number; y: number; z: number; vx: number; off: number; t: number; peck: number; yaw: number; delay: number;
  heading: number; climb: number; speed: number;
}
// ---------------------------------------------------------------- sandcastles
interface Castle { mesh: THREE.Mesh; live: boolean; x: number; y: number; z: number; s: number; melt: number }
// ---------------------------------------------------------------- pelicans
interface Pelican {
  bird: FlyGull; live: boolean; state: 'glide' | 'plunge' | 'float';
  x: number; y: number; z: number; vy: number; k: number; t: number; pitch: number;
}

export class ShoreLife {
  readonly group = new THREE.Group();
  private prints!: THREE.InstancedMesh; private paws!: THREE.InstancedMesh;
  private printData: Print[] = []; private pawData: Print[] = [];
  private nextPrint = 0; private nextPaw = 0; private pawSide = 1;
  private sanders: Sander[] = [];
  private castles: Castle[] = [];
  private pelicans: Pelican[] = [];
  private pelicanGroup = { speed: 0, flapAt: 0, plunged: false, x: 0 };
  private clock = 0;
  private nextFlock = 60; private nextCastle = 40; private nextPelicans = 12;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private sc = new THREE.Vector3(); private col = new THREE.Color();
  /** sound cues */
  onFlutter: (() => void) | null = null;
  onSplash: ((size: number) => void) | null = null;

  constructor(private material: THREE.Material, private streams: Streams, private dust: Dust, private ripples: Ripples) {}

  async load() {
    const [sander, gull, castle, pelBody, pelWing] = await Promise.all([
      loadMesh('runner/models/Sanderling.glb'), loadGullParts(), loadMesh('runner/models/Sandcastle.glb'),
      loadMesh('runner/models/Pelican_Body.glb'), loadMesh('runner/models/Pelican_Wing.glb'),
    ]);
    const mark = () => new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.prints = new THREE.InstancedMesh(footGeo(), mark(), PRINTS);
    this.paws = new THREE.InstancedMesh(pawGeo(), mark(), PAWS);
    for (const [im, data, n] of [[this.prints, this.printData, PRINTS], [this.paws, this.pawData, PAWS]] as const) {
      im.frustumCulled = false; im.renderOrder = 3;
      this.m4.makeScale(0, 0, 0);
      for (let i = 0; i < n; i++) { im.setMatrixAt(i, this.m4); im.setColorAt(i, WHITE); data.push({ x: 0, y: 0, z: 0, t: 0, erase: -1, live: false }); }
      this.group.add(im);
    }
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(sander.geometry, this.material); m.visible = false; m.castShadow = true; m.scale.setScalar(1.6);
      const f = new FlyGull(gull.body, gull.wing, this.material); f.root.scale.setScalar(0.36);
      this.group.add(m, f.root);
      this.sanders.push({ mesh: m, fly: f, live: false, state: 'run', x: 0, y: 0, z: 0, vx: 0, off: 0, t: 0, peck: 0, yaw: 0, delay: 0, heading: 0, climb: 0, speed: 0 });
    }
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(castle.geometry, this.material); m.visible = false; m.castShadow = true; m.receiveShadow = true;
      this.group.add(m); this.castles.push({ mesh: m, live: false, x: 0, y: 0, z: 0, s: 1, melt: 0 });
    }
    for (let i = 0; i < 5; i++) {
      const b = new FlyGull(pelBody.geometry, pelWing.geometry, this.material, 0.16); b.root.scale.setScalar(1.15);
      this.group.add(b.root); this.pelicans.push({ bird: b, live: false, state: 'glide', x: 0, y: 0, z: 0, vy: 0, k: 0, t: 0, pitch: 0 });
    }
  }

  reset() {
    for (const s of this.sanders) this.freeSander(s);
    for (const c of this.castles) { c.live = false; c.mesh.visible = false; }
    for (const p of this.pelicans) { p.live = false; p.bird.root.visible = false; }
    for (const d of [this.printData, this.pawData]) for (const p of d) { p.live = false; p.t = PRINT_LIFE; }
    this.nextFlock = 60; this.nextCastle = 40; this.nextPelicans = this.clock + 12;
  }

  // ---------------------------------------------------------------- footprints
  /** a stride: a print under each foot, this one and the one half a stride back (on sand only: not on a deck, not
   *  under the water) */
  step(r: Runner, world: ChunkManager, waterY: number, stride = 2.3, paw = false) {
    const fx = r.vx, fz = -Math.max(1, r.speed), l = Math.hypot(fx, fz), dx = fx / l, dz = fz / l, yaw = Math.atan2(-dx, -dz);
    const w = paw ? 0.08 : 0.11;
    for (const [back, side] of [[stride / 2, -w], [0, w]]) {
      const x = r.pos.x - dx * back - dz * side, z = r.pos.z - dz * back + dx * side;
      if (paw) this.place(this.paws, this.pawData, this.nextPaw++ % PAWS, x, z, yaw + Math.PI, world, waterY, 1.15);
      else this.place(this.prints, this.printData, this.nextPrint++ % PRINTS, x, z, yaw, world, waterY, 1);
    }
  }
  /** a print where the companion's foot comes down: a paw (Reveille) or a foot (the runner following her) */
  paw(x: number, z: number, yaw: number, world: ChunkManager, waterY: number, paw = true) {
    const side = (this.pawSide = -this.pawSide) * (paw ? 0.07 : 0.11);
    if (paw) this.place(this.paws, this.pawData, this.nextPaw++ % PAWS, x + Math.cos(yaw) * side, z - Math.sin(yaw) * side, yaw + Math.PI, world, waterY, 1.15);
    else this.place(this.prints, this.printData, this.nextPrint++ % PRINTS, x + Math.cos(yaw) * side, z - Math.sin(yaw) * side, yaw + Math.PI, world, waterY, 1);
  }
  private place(im: THREE.InstancedMesh, data: Print[], i: number, x: number, z: number, yaw: number, world: ChunkManager, waterY: number, scale: number) {
    const ch = world.chunkAt(z);
    if (!ch || (ch.biome !== 'beach' && ch.biome !== 'surf' && ch.biome !== 'lagoon') || world.floorAt(x, z) !== null) return;
    const y = world.groundAt(x, z);
    if (y < waterY + 0.01 || y > 2.2) return;                                 // (under the water, or up on the grassy dunes)
    Object.assign(data[i], { x, y, z, t: 0, erase: -1, live: true });
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), yaw);
    // (a little up: the ground mesh is a coarse grid that can sit a few cm over the exact ground height)
    this.m4.compose(this.v.set(x, y + 0.05, z), this.q, this.sc.setScalar(scale));
    im.setMatrixAt(i, this.m4); im.instanceMatrix.needsUpdate = true;
  }
  private updatePrints(dt: number) {
    for (const [im, data, dark] of [[this.prints, this.printData, PRINT_DARK], [this.paws, this.pawData, PAW_DARK]] as const) {
      let dirty = false;
      for (let i = 0; i < data.length; i++) {
        const p = data[i];
        if (!p.live) continue;
        p.t += dt;
        if (p.erase >= 0) p.erase += dt;
        const k = Math.max(0, Math.min(1, (PRINT_LIFE - p.t) / 2.5)) * (p.erase >= 0 ? Math.max(0, 1 - p.erase / 0.5) : 1);
        if (k <= 0) { p.live = false; this.m4.makeScale(0, 0, 0); im.setMatrixAt(i, this.m4); im.instanceMatrix.needsUpdate = true; }
        im.setColorAt(i, this.col.copy(WHITE).lerp(dark, k));
        dirty = true;
      }
      if (dirty && im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  update(dt: number, r: Runner, world: ChunkManager, waterY: number, surging: boolean, tideStep: number) {
    if (dt <= 0) return;
    this.clock += dt;
    this.updatePrints(dt);
    this.updateSanders(dt, r, world, waterY, surging);
    this.updateCastles(dt, r, world, waterY, tideStep);
    this.updatePelicans(dt, r, world, waterY, surging);
  }

  // ---------------------------------------------------------------- sanderlings
  private freeSander(s: Sander) { s.live = false; s.mesh.visible = false; s.fly.root.visible = false; }

  /** where the sand stands at `height` along the line z, searching from x toward the shore or the sea */
  private shoreX(world: ChunkManager, x: number, z: number, height: number) {
    let g = world.groundAt(x, z);
    for (let i = 0; i < 40; i++) {
      const nx = x + (g < height ? 0.2 : -0.2), ng = world.groundAt(nx, z);
      if ((g < height) !== (ng < height)) return nx;
      x = nx; g = ng;
    }
    return x;
  }

  private spawnFlock(r: Runner, world: ChunkManager, waterY: number) {
    const z0 = r.pos.z - 55 - Math.random() * 25, ch = world.chunkAt(z0);
    if (!ch || ch.mode !== 'run' || ch.biome !== 'beach' || ch.tide === 'surge') return false;
    // the water's edge on the sea side, out past the lanes and still in view
    let xw = NaN;
    for (let x = -3; x > -34; x -= 0.5) if (world.groundAt(x, z0) < waterY) { xw = x; break; }
    if (Number.isNaN(xw) || xw > -5.5) return false;
    const n = 6 + Math.floor(Math.random() * 4);
    let placed = 0;
    for (const s of this.sanders) {
      if (s.live || placed >= n) continue;
      const z = z0 + (Math.random() - 0.5) * 8;
      Object.assign(s, { live: true, state: 'run', x: xw + 0.5, z, vx: 0, off: 0.02 + Math.random() * 0.1, t: Math.random() * 3, peck: 0, yaw: Math.random() * 6.28, delay: Math.random() * 0.3 });
      s.y = world.groundAt(s.x, z); s.mesh.visible = true; s.fly.root.visible = false;
      placed++;
    }
    return true;
  }

  private updateSanders(dt: number, r: Runner, world: ChunkManager, waterY: number, surging: boolean) {
    if (r.distance > this.nextFlock && r.mode !== 'swim' && this.sanders.every((s) => !s.live)) {
      this.nextFlock = r.distance + (this.spawnFlock(r, world, waterY) ? 110 + Math.random() * 90 : 15);
    }
    const t = env.uTime.value, storm = env.uStorm.value;
    let flushed = false;
    for (const s of this.sanders) {
      if (!s.live) continue;
      s.t += dt;
      const ahead = r.pos.z - s.z;
      if (ahead < -30 || ahead > 200 || s.y > 30 || surging) { this.freeSander(s); continue; }
      if (s.state === 'run') {
        // just up the sand from the swash's front: down after the backwash, back up ahead of the uprush
        const target = this.shoreX(world, s.x, s.z, waterY + swashFront(s.z, t, storm) + s.off);
        const want = THREE.MathUtils.clamp((target - s.x) * 4, -3.2, 3.2);
        s.vx += (want - s.vx) * (1 - Math.exp(-dt * 10));
        s.x += s.vx * dt;
        s.y = world.groundAt(s.x, s.z);
        const running = Math.abs(s.vx) > 0.4;
        if (running) s.yaw = s.vx > 0 ? Math.PI / 2 : -Math.PI / 2;
        else if (s.peck <= 0 && Math.random() < dt * 1.5) s.peck = 0.3;
        s.peck = Math.max(0, s.peck - dt);
        s.mesh.position.set(s.x, s.y + (running ? Math.abs(Math.sin(s.t * 30)) * 0.015 : 0), s.z);
        s.mesh.rotation.set(s.peck > 0 ? Math.sin((s.peck / 0.3) * Math.PI) * 0.7 : running ? 0.12 : 0, s.yaw, 0, 'YXZ');
        // you come close: the whole flock goes, each a beat apart
        if ((ahead < 13 && ahead > -4 && Math.abs(r.pos.x - s.x) < 14) || this.sanders.some((o) => o.live && o.state === 'fly')) {
          s.delay -= dt;
          if (s.delay <= 0) {
            s.state = 'fly'; s.t = 0; s.mesh.visible = false; s.fly.root.visible = true;
            s.heading = Math.PI + (Math.random() - 0.5) * 0.5 - 0.5;           // ahead (-z) and out over the water (-x)
            s.speed = 7 + Math.random() * 2; s.climb = 2.2 + Math.random();
            flushed = true;
          }
        }
      } else {
        // low and fast over the water, the flock twisting together
        s.heading += Math.sin(this.clock * 1.6) * dt * 0.9;
        s.climb = Math.max(0, s.climb - dt * 1.4);
        const vx = Math.sin(s.heading) * s.speed, vz = Math.cos(s.heading) * s.speed;
        s.x += vx * dt; s.z += vz * dt; s.y += s.climb * dt;
        s.fly.root.position.set(s.x, s.y + 0.15, s.z);
        s.fly.face(vx, s.climb, vz, Math.sin(this.clock * 1.6) * 0.5);
        s.fly.wings(0.15 + 0.5 * Math.sin(s.t * 26));
        if (s.t > 5) this.freeSander(s);
      }
    }
    if (flushed) this.onFlutter?.();
  }

  // ---------------------------------------------------------------- sandcastles
  private spotFree(world: ChunkManager, x: number, z: number, rad: number) {
    for (const { chunk, ob } of world.obstaclesNear(z, rad + 4)) {
      const s = ob.shape, oz = chunk.zStart - s.along, half = s.kind === 'sphere' ? s.r : Math.max(s.sx, s.sz) / 2;
      if (Math.abs(oz - z) < half + rad && Math.abs(s.x - x) < half + rad) return false;
    }
    const ch = world.chunkAt(z);
    if (ch) for (const p of ch.props) if (Math.abs(p.x - x) < rad + 0.6 && Math.abs(ch.zStart - p.along - z) < rad + 0.6) return false;
    return true;
  }

  private updateCastles(dt: number, r: Runner, world: ChunkManager, waterY: number, tideStep: number) {
    if (r.distance > this.nextCastle && r.mode !== 'swim') {
      // (more of them as the 12th Tide nears, so you see the flood take some)
      this.nextCastle = r.distance + (tideStep >= 10 ? 35 + Math.random() * 30 : 80 + Math.random() * 70);
      const c = this.castles.find((q) => !q.live);
      const z = r.pos.z - 70 - Math.random() * 25, ch = world.chunkAt(z);
      if (c && ch && ch.mode === 'run' && ch.biome === 'beach') {
        for (let tries = 0; tries < 6; tries++) {
          const x = (Math.random() < 0.5 ? -1 : 1) * (4.9 + Math.random() * 3.4), y = world.groundAt(x, z);
          if (y < waterY + 0.3 || y > 1.6 || world.floorAt(x, z) !== null || !this.spotFree(world, x, z, 0.9)) continue;
          Object.assign(c, { live: true, x, y, z, s: 0.85 + Math.random() * 0.3, melt: 0 });
          c.mesh.position.set(x, y - 0.03, z); c.mesh.rotation.set(0, Math.random() * 6.28, 0); c.mesh.scale.setScalar(c.s); c.mesh.visible = true;
          break;
        }
      }
    }
    for (const c of this.castles) {
      if (!c.live) continue;
      if (c.z > r.pos.z + 25 || c.z < r.pos.z - 260) { c.live = false; c.mesh.visible = false; continue; }
      // the flood (or a big wave's swash) reaches it: it slumps into a wet mound
      if (waterY > c.y - 0.05 && c.melt < 1) {
        if (c.melt === 0) this.dust.burst(PUFF.silt, c.x, Math.max(c.y, waterY) + 0.2, c.z, 10, 1.2, 0.4, 1.4);
        c.melt = Math.min(1, c.melt + dt * 0.5);
        const m = c.melt * c.melt * (3 - 2 * c.melt);
        c.mesh.scale.set(c.s * (1 + 0.45 * m), c.s * (1 - 0.8 * m), c.s * (1 + 0.45 * m));
        c.mesh.position.y = c.y - 0.03 - 0.08 * m;
        c.mesh.rotation.x = 0.06 * m;
      }
    }
  }

  // ---------------------------------------------------------------- pelicans
  /** the water's surface at (x, z): the wave at Shorebreak Point, else the sea */
  private surface(world: ChunkManager, x: number, z: number, waterY: number) {
    const c = world.chunkAt(z);
    return waterY + (c?.wave ? waveY(c.wave, x, c.zStart - z) : 0);
  }

  private spawnPelicans(r: Runner, world: ChunkManager, waterY: number) {
    const z0 = r.pos.z - 80 - Math.random() * 20, ch = world.chunkAt(z0);
    if (!ch || ch.tide === 'surge' || !(ch.biome === 'beach' || ch.biome === 'pier' || ch.biome === 'surf') || ch.mode === 'swim') return false;
    let x0: number;
    if (ch.wave) x0 = ch.wave.crest(ch.zStart - z0) - 5;                    // over the wave's back, in its updraft
    else {
      let xw = NaN;
      for (let x = -3; x > -50; x -= 1) if (world.groundAt(x, z0) < waterY - 0.6) { xw = x; break; }
      if (Number.isNaN(xw)) return false;
      x0 = Math.min(xw - 6, -9) - Math.random() * 6;
    }
    const n = 3 + Math.floor(Math.random() * 3);
    this.pelicanGroup = { speed: Math.max(6, r.speed * 0.55), flapAt: 1 + Math.random() * 2, plunged: Math.random() < 0.4, x: x0 };
    this.pelicans.slice(0, n).forEach((p, k) => {
      Object.assign(p, { live: true, state: 'glide', x: x0 - k * 0.5, z: z0 - k * 2.8, k, t: 0, vy: 0, pitch: 0 });
      p.y = this.surface(world, p.x, p.z, waterY) + 1.6 + Math.random() * 0.5;
      p.bird.root.visible = true;
    });
    return true;
  }

  private updatePelicans(dt: number, r: Runner, world: ChunkManager, waterY: number, surging: boolean) {
    if (this.clock > this.nextPelicans && r.mode !== 'swim' && !surging && this.pelicans.every((p) => !p.live)) {
      this.nextPelicans = this.clock + (this.spawnPelicans(r, world, waterY) ? 28 + Math.random() * 20 : 4);
    }
    const g = this.pelicanGroup;
    g.flapAt -= dt;
    if (g.flapAt < -2.5) g.flapAt = 4 + Math.random() * 3;
    for (const p of this.pelicans) {
      if (!p.live) continue;
      p.t += dt;
      if (p.z > r.pos.z + 30 || p.z < r.pos.z - 220 || r.mode === 'swim') { p.live = false; p.bird.root.visible = false; continue; }
      const water = this.surface(world, p.x, p.z, waterY);
      if (p.state === 'glide') {
        p.z -= g.speed * dt;
        // skim at a steady height over the water, following its rise and fall
        const want = water + 1.4 + 0.25 * Math.sin(p.t * 0.7 + p.k);
        p.y += (want - p.y) * (1 - Math.exp(-dt * 1.5));
        // follow-the-leader: a few slow beats rippling back down the line, then a long glide
        const f = g.flapAt + p.k * 0.28;
        p.bird.wings(f < 0 && f > -1.6 ? 0.1 + 0.42 * Math.sin((-f / 1.6) * Math.PI * 4) : 0.06 + 0.02 * Math.sin(p.t * 1.3 + p.k));
        p.bird.face(0, 0, -g.speed, Math.sin(p.t * 0.5 + p.k) * 0.08);
        // one of them sights a fish: up a little, wings folded, straight down into the water
        if (g.plunged && p.k === 1 && Math.abs(r.pos.z - p.z) < 45) { g.plunged = false; p.state = 'plunge'; p.vy = 2.5; p.t = 0; }
      } else if (p.state === 'plunge') {
        p.z -= g.speed * 0.6 * dt;
        p.vy -= 16 * dt; p.y += p.vy * dt;
        p.pitch = Math.min(1.35, p.pitch + dt * 3.2);
        p.bird.wings(-1.15);
        p.bird.face(0, p.vy, -g.speed * 0.6);
        if (p.y <= water) {
          p.state = 'float'; p.y = water; p.t = 0;
          this.streams.burst(p.x, water + 0.05, p.z, 22, 2.4, 3.2);
          this.ripples.spawn(p.x, water, p.z, 3.2, 1.3, 3);
          if (Math.abs(r.pos.z - p.z) < 45) this.onSplash?.(0.55);
        }
      } else {
        // sitting on the water after the dive, bobbing, bill up as it swallows
        p.y = water + 0.05 + Math.sin(p.t * 2.1) * 0.05;
        p.bird.wings(-1.2);
        p.bird.root.rotation.set(-0.15 + (p.t < 1.2 ? Math.sin(p.t * 7) * 0.12 : 0), Math.PI, Math.sin(p.t * 1.7) * 0.06, 'YXZ');
      }
      p.bird.root.position.set(p.x, p.y, p.z);
    }
  }
}
