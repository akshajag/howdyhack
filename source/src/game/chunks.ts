import * as THREE from 'three';
import type { CourseGenerator } from './generator';
import type { Chunk, ChunkEvent, Current, Obstacle, Pearl, Prop } from './types';
import { KitLibrary, InstancePool } from '../world/pool';
import { CATALOG, FALLBACK } from '../world/catalog';
import { GroundMeshes, GroundStrip, type GroundPaint } from '../world/ground';
import { Streams } from '../fx/streams';
import { SurfWaves } from '../world/surfwave';
import { patchMaterial } from '../core/env';

/**
 * Streams chunks from the generator: keeps ~5 chunks ahead of the player and recycles the ones behind. Owns every
 * per-chunk render resource (instanced props, ground mesh, pearls, current streaks) and answers world queries
 * (ground, deck, currents, nearby obstacles) for the player controller.
 */
const AHEAD = 330;      // metres of course kept ahead of the player
const BEHIND = 45;      // metres kept behind before recycling

interface LiveProp { pool: InstancePool; slot: number }
/** props that ride the swell (a gentle bob, no collision) */
const FLOATERS = new Set(['Research_Buoy_A', 'Research_Buoy_B', 'Prop_Buoy']);
interface Bobber { pool: InstancePool; slot: number; base: THREE.Matrix4; ob: Obstacle }
/** a treasure chest's lid on its hinge: shut until you jump the chest, then it flies open (t: seconds since) */
interface Lid { pool: InstancePool; slot: number; x: number; y: number; z: number; yaw: number; s: number; chestX: number; chestZ: number; t: number }
interface LivePearl { slot: number; pearl: Pearl; taken: boolean }
/** the collie sitting by the research station (until she gets up to run with you, see pet.ts) */
interface StationCollie { pool: InstancePool; slot: number; x: number; y: number; z: number; yaw: number; gone: boolean }
interface Live {
  ground: ReturnType<GroundMeshes['build']> | null;
  props: LiveProp[];
  bobbers: Bobber[];
  lids: Lid[];
  pearls: LivePearl[];
  streams: (ReturnType<Streams['add']>)[];
  firedEvents: Set<ChunkEvent>;
  entered: boolean;
  collie?: StationCollie;
  /** the boards waiting at the water's edge where you pick one up */
  boards?: { pool: InstancePool; slot: number; x: number; z: number }[];
}

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();

export class ChunkManager {
  readonly group = new THREE.Group();
  chunks: Chunk[] = [];
  readonly kits: KitLibrary;
  readonly grounds: GroundMeshes;
  readonly strip: GroundStrip;
  readonly streams = new Streams();
  /** Shorebreak Point's waves */
  readonly waves = new SurfWaves();
  private pearlPool: InstancePool;
  private pearlMaterial: THREE.Material;
  private collecting: { slot: number; x: number; y: number; z: number; s: number; t: number }[] = [];
  onEvent: ((chunk: Chunk, e: ChunkEvent) => void) | null = null;
  onEnter: ((chunk: Chunk) => void) | null = null;
  waterY = () => 0;
  private gen!: CourseGenerator;

  constructor(materialFor: ConstructorParameters<typeof KitLibrary>[0], groundMaterial: THREE.Material, private paint: (chunk: Chunk) => GroundPaint) {
    this.kits = new KitLibrary(materialFor);
    this.grounds = new GroundMeshes(groundMaterial);
    this.strip = new GroundStrip((x, z) => this.groundAt(x, z));
    // coins: small gold discs standing edge-on to the runner's path, spinning and bobbing in the vertex shader (no CPU cost)
    this.pearlMaterial = patchMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffc93c'), emissive: new THREE.Color('#b87300'), emissiveIntensity: 0.6, roughness: 0.32, metalness: 0.1 }), {
      caustics: false, fogScale: 0.8,
      deform: /* glsl */ `
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float a = uTime * 3.2 + ip.x * 0.7 + ip.z * 0.35;
          float c = cos(a), s = sin(a);
          transformed.xz = mat2(c, -s, s, c) * transformed.xz;
          transformed.y += sin(uTime * 2.2 + ip.z * 0.5) * 0.07;
        }`,
      colorHook: /* glsl */ `t12Col += vec3(1.0, 0.8, 0.35) * 0.25 * pow(abs(sin(uTime * 3.2 + vT12World.x * 0.7)), 8.0);`,
    });
    const coin = new THREE.CylinderGeometry(0.3, 0.3, 0.07, 24);
    coin.rotateX(Math.PI / 2);                 // face the camera (along z)
    this.pearlPool = new InstancePool(coin, this.pearlMaterial, 1200, false);
    this.group.add(this.kits.group, this.grounds.group, this.streams.points, this.pearlPool.mesh, this.waves.group);
  }

  async load() { await this.kits.load(CATALOG); }

  /** fresh course */
  reset(gen: CourseGenerator) {
    for (const c of this.collecting) this.pearlPool.release(c.slot);
    this.collecting = [];
    for (const c of this.chunks) this.despawn(c);
    this.chunks = [];
    this.waves.clear();
    this.gen = gen;
    this.update(0, true);
  }

  update(playerZ: number, force = false) {
    // recycle behind
    while (this.chunks.length && this.chunks[0].zStart - this.chunks[0].length > playerZ + BEHIND) this.despawn(this.chunks.shift()!);
    // spawn ahead
    let guard = 0;
    while ((this.chunks.length === 0 || this.endZ() > playerZ - AHEAD) && guard++ < 12) this.spawn(this.gen.next());
    if (force || !this.strip.covers(playerZ)) this.strip.rebuild(playerZ);
    // chunk enter events
    const cur = this.chunkAt(playerZ);
    if (cur && !(cur.live as Live).entered) { (cur.live as Live).entered = true; this.onEnter?.(cur); }
    if (cur) {
      const live = cur.live as Live;
      const along = cur.zStart - playerZ;
      for (const e of cur.events) if (!live.firedEvents.has(e) && along >= e.along) { live.firedEvents.add(e); this.onEvent?.(cur, e); }
    }
  }

  private endZ() { const l = this.chunks[this.chunks.length - 1]; return l.zStart - l.length; }

  // ---------------------------------------------------------------- queries
  chunkAt(z: number): Chunk | null {
    for (const c of this.chunks) if (z <= c.zStart + 1e-6 && z > c.zStart - c.length) return c;
    return null;
  }
  groundAt(x: number, z: number): number {
    const c = this.chunkAt(z) ?? (this.chunks.length ? (z > this.chunks[0].zStart ? this.chunks[0] : this.chunks[this.chunks.length - 1]) : null);
    if (!c) return -12;
    const along = Math.max(0, Math.min(c.length, c.zStart - z));
    return c.ground(x, along);
  }
  /** deck height if a deck exists at this point; null when there is none (or the chunk has no deck at all) */
  /** underside of a cave roof above (x, z), Infinity in open water */
  ceilingAt(x: number, z: number): number {
    const c = this.chunkAt(z);
    return c && c.ceiling ? c.ceiling(x, c.zStart - z) : Infinity;
  }
  floorAt(x: number, z: number): number | null {
    const c = this.chunkAt(z);
    if (!c || !c.floor) return null;
    return c.floor(x, c.zStart - z);
  }
  hasDeck(z: number) { const c = this.chunkAt(z); return !!c && !!c.floor && !(c.deckEnd !== undefined && c.zStart - z > c.deckEnd); }
  /** sum of current velocities at a point into out (x, y, along) */
  currentAt(x: number, y: number, z: number, out: THREE.Vector3): number {
    out.set(0, 0, 0);
    let w = 0;
    const c = this.chunkAt(z);
    if (!c) return 0;
    const along = c.zStart - z;
    for (const cu of c.currents) {
      if (along < cu.along0 || along > cu.along1 || x < cu.x0 || x > cu.x1) continue;
      if (cu.y0 !== undefined && y < cu.y0 - 0.5) continue;
      if (cu.y1 !== undefined && y > cu.y1 + 0.5) continue;
      const fx = Math.min(1, Math.min(x - cu.x0, cu.x1 - x) / 1.5), fz = Math.min(1, Math.min(along - cu.along0, cu.along1 - along) / 2.5);
      const k = Math.max(0, Math.min(fx, fz));
      out.x += cu.vx * k; out.y += cu.vy * k; out.z += cu.vAlong * k;
      w = Math.max(w, k);
    }
    return w;
  }
  /** obstacles whose along-span may touch [z - range, z + range] */
  *obstaclesNear(z: number, range: number): Generator<{ chunk: Chunk; ob: Obstacle; index: number }> {
    for (const c of this.chunks) {
      if (c.zStart < z - range - 20 || c.zStart - c.length > z + range + 20) continue;
      for (let i = 0; i < c.obstacles.length; i++) yield { chunk: c, ob: c.obstacles[i], index: i };
    }
  }
  pearlsNear(z: number): { chunk: Chunk; lp: LivePearl }[] {
    const out: { chunk: Chunk; lp: LivePearl }[] = [];
    for (const c of this.chunks) {
      if (c.zStart < z - 6 || c.zStart - c.length > z + 6) continue;
      for (const lp of (c.live as Live).pearls) if (!lp.taken && Math.abs(c.zStart - lp.pearl.along - z) < 3) out.push({ chunk: c, lp });
    }
    return out;
  }
  /** collect a coin: it pops (swells, then shrinks away upward) and its slot is freed 0.2 s later */
  takePearl(chunk: Chunk, lp: LivePearl) {
    if (lp.taken) return;
    lp.taken = true;
    const z = chunk.zStart - lp.pearl.along;
    this.collecting.push({ slot: lp.slot, x: lp.pearl.x, y: lp.pearl.y, z, s: lp.pearl.risky ? 1.25 : 1, t: 0 });
    this.streams.burst(lp.pearl.x, lp.pearl.y, z, 10, 2.2, 1.5);
  }

  // ---------------------------------------------------------------- spawn / despawn
  private spawn(c: Chunk) {
    const live: Live = { ground: null, props: [], bobbers: [], lids: [], pearls: [], streams: [], firedEvents: new Set(), entered: false };
    c.live = live;
    live.ground = this.grounds.build(c, this.paint(c));
    this.waves.build(c);
    for (const p of c.props) this.placeProp(c, p, live);
    for (const pl of c.pearls) {
      tmpM.compose(tmpP.set(pl.x, pl.y, c.zStart - pl.along), tmpQ.identity(), tmpS.setScalar(pl.risky ? 1.25 : 1));
      const slot = this.pearlPool.alloc(tmpM, pl.risky ? [1.2, 0.5, 0.7] : [1, 1, 1]);
      live.pearls.push({ slot, pearl: pl, taken: false });
    }
    for (const cu of c.currents) live.streams.push(this.streams.add(cu, c.zStart, this.waterY, (x, z) => this.groundAt(x, z)));
    this.chunks.push(c);
    this.kits.flush(); this.pearlPool.flush();
  }

  private despawn(c: Chunk) {
    const live = c.live as Live | undefined;
    if (!live) return;
    if (live.ground) this.grounds.release(live.ground);
    this.waves.release(c);
    for (const p of live.props) p.pool.release(p.slot);
    for (const b of live.bobbers) b.pool.release(b.slot);
    for (const l of live.lids) l.pool.release(l.slot);
    for (const p of live.pearls) if (!p.taken) this.pearlPool.release(p.slot);
    for (const s of live.streams) this.streams.remove(s);
    c.live = undefined;
    this.kits.flush(); this.pearlPool.flush();
  }

  private placeProp(c: Chunk, p: Prop, live: Live) {
    let kit = p.kit, sx = 1, sy = 1, sz = 1, dy = 0;
    if (!this.kits.has(kit)) {
      const fb = FALLBACK[kit];
      if (!fb || !this.kits.has(fb.kit)) return;
      kit = fb.kit; [sx, sy, sz] = fb.scale ?? [1, 1, 1]; dy = fb.dy ?? 0;
    }
    const pool = this.kits.pool(kit)!;
    tmpE.set(p.pitch ?? 0, p.yaw, p.roll ?? 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpP.set(p.x, p.y + dy, c.zStart - p.along);
    tmpS.set(p.scale * sx, p.scale * sy * (p.sy ?? 1), p.scale * sz);
    tmpM.compose(tmpP, tmpQ, tmpS);
    const slot = pool.alloc(tmpM, p.tint);
    if (slot < 0) return;
    if (p.kit === 'Chest_Lid') {
      // (the chest's centre is 0.45 m in front of the hinge, along the chest's facing)
      const z = c.zStart - p.along, f = 0.45 * p.scale;
      live.lids.push({ pool, slot, x: p.x, y: p.y, z, yaw: p.yaw, s: p.scale, chestX: p.x + f * Math.sin(p.yaw), chestZ: z + f * Math.cos(p.yaw), t: -1 });
      return;
    }
    // jellyfish and sea mines: pair the prop with its bobbing obstacle so the mesh follows the collision sphere
    const bob = p.kit === 'Jellyfish' || p.kit === 'Sea_Mine' ? c.obstacles.find((o) => o.bob && Math.abs(o.shape.x - p.x) < 0.01 && Math.abs(o.shape.along - p.along) < 0.01) : undefined;
    const float = !bob && FLOATERS.has(p.kit) ? { shape: { kind: 'sphere', x: 0, y: 0, along: 0, r: 0 }, tag: 'float', bob: { amp: 0.08, freq: 0.22 + ((p.along * 7) % 1) * 0.1, phase: (p.x * 1.7 + p.along) % 6.28 } } as Obstacle : undefined;
    if (bob || float) live.bobbers.push({ pool, slot, base: tmpM.clone(), ob: (bob ?? float)! });
    else live.props.push({ pool, slot });
    if (p.kit === 'Collie_Body') live.collie = { pool, slot, x: p.x, y: p.y, z: c.zStart - p.along, yaw: p.yaw, gone: false };
    if (p.kit === 'Runner_Board' && c.board?.mount !== undefined) (live.boards ??= []).push({ pool, slot, x: p.x, z: c.zStart - p.along });
  }

  /** you've picked up the board nearest (x, z): off the sand it goes (the character carries its own) */
  takeBoard(x: number, z: number) {
    let best: NonNullable<Live['boards']>[number] | null = null, bd = 6;
    for (const c of this.chunks) for (const b of (c.live as Live | undefined)?.boards ?? []) { const d = Math.hypot(b.x - x, b.z - z); if (d < bd) { bd = d; best = b; } }
    if (!best) return;
    best.pool.setMatrix(best.slot, tmpM.makeScale(0, 0, 0));
    this.kits.flush();
  }

  /** the collie on the research station's steps, while she is there */
  collie(): StationCollie | null {
    for (const c of this.chunks) { const k = (c.live as Live | undefined)?.collie; if (k && !k.gone) return k; }
    return null;
  }
  /** she has got up to run with you: off the steps */
  releaseCollie() {
    const k = this.collie();
    if (!k) return;
    k.gone = true;
    k.pool.setMatrix(k.slot, tmpM.makeScale(0, 0, 0));
    this.kits.flush();
  }

  /** chests the runner has just jumped (airborne over one, in its lane): their lids start to open. Returns where */
  openChests(pos: THREE.Vector3) {
    const opened: THREE.Vector3[] = [];
    for (const c of this.chunks) for (const l of (c.live as Live).lids) {
      if (l.t >= 0 || Math.abs(pos.x - l.chestX) > 1.2 || pos.z > l.chestZ + 0.4 || pos.z < l.chestZ - 2.5) continue;
      if (pos.y - this.groundAt(l.chestX, l.chestZ) < 0.55) continue;            // (only when you go over it)
      l.t = 0; opened.push(new THREE.Vector3(l.chestX, l.y, l.chestZ));
    }
    return opened;
  }

  /** per-frame animation of bobbing obstacles, chest lids + streak particles */
  animate(t: number, dt: number) {
    for (const c of this.chunks) {
      const live = c.live as Live;
      for (const l of live.lids) {
        if (l.t < 0 || l.t > 1) continue;
        l.t += dt;
        // swing up and back on the hinge with a little overshoot, then settle open
        const k = Math.min(1, l.t / 0.45), back = 1.7;
        const e = 1 + (back + 1) * Math.pow(k - 1, 3) + back * Math.pow(k - 1, 2);
        tmpE.set(-1.95 * e, l.yaw, 0, 'YXZ'); tmpQ.setFromEuler(tmpE);
        tmpM.compose(tmpP.set(l.x, l.y, l.z), tmpQ, tmpS.setScalar(l.s));
        l.pool.setMatrix(l.slot, tmpM);
      }
      for (const b of live.bobbers) {
        const bob = b.ob.bob!;
        tmpM.copy(b.base);
        tmpM.elements[13] = b.base.elements[13] + Math.sin(t * bob.freq * 6.283 + bob.phase) * bob.amp;
        b.pool.setMatrix(b.slot, tmpM);
      }
    }
    for (let i = this.collecting.length - 1; i >= 0; i--) {
      const c = this.collecting[i];
      c.t += dt;
      if (c.t >= 0.2) { this.pearlPool.release(c.slot); this.collecting.splice(i, 1); continue; }
      const k = c.t < 0.07 ? 1 + 0.7 * (c.t / 0.07) : 1.7 * (1 - (c.t - 0.07) / 0.13);
      tmpM.compose(tmpP.set(c.x, c.y + c.t * 3, c.z), tmpQ.identity(), tmpS.setScalar(c.s * Math.max(0.001, k)));
      this.pearlPool.setMatrix(c.slot, tmpM);
    }
    this.kits.flush();
    this.pearlPool.flush();
    this.streams.update(dt, this.waterY());
  }

  /** current vertical offset of a bobbing obstacle */
  static bobY(ob: Obstacle, t: number) { return ob.bob ? Math.sin(t * ob.bob.freq * 6.283 + ob.bob.phase) * ob.bob.amp : 0; }

  get currentChunk() { return this.chunks[0] ?? null; }
}

export type { Live as ChunkLive, LivePearl };
export type CurrentRef = Current;
