import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patchMaterial } from '../core/env';
import { MOVE } from './types';
import type { Runner } from './runner';
import type { ChunkManager } from './chunks';

/** who follows whom: the collie (the runner's companion) or the runner (Reveille's, when you play as her) */
export interface FollowerConfig {
  url: string; height: number;
  /** the model's clips for each role (one-shot: jump) */
  clips: { run: string; jump: string; idle: string; idle2: string; walk: string };
  /** clip speed is r.speed / runRate; the jump clip's length (s) */
  runRate: number; jumpLen: number;
  /** her blanket (the collie only) */
  cape: boolean;
  /** a bark and a bounce at a diving gull, a lap round you after a swim */
  bark: boolean; zoomies: boolean;
  /** m inside the player's line */
  side: number;
}
export const DOG: FollowerConfig = { url: 'runner/models/Reveille.glb', height: 0.95, clips: { run: 'Gallop', jump: 'Gallop_Jump', idle: 'Idle', idle2: 'Idle_2', walk: 'Walk' }, runRate: 7.5, jumpLen: 0.917, cape: true, bark: true, zoomies: false, side: 1.1 };
export const HUMAN: FollowerConfig = { url: 'runner/models/Runner_Beach.glb', height: 1.75, clips: { run: 'Run', jump: 'Jump', idle: 'Idle', idle2: 'Wave', walk: 'Run' }, runRate: 12, jumpLen: 0.833, cape: false, bark: false, zoomies: false, side: 1.2 };

/** load a follower's model: normalised to `height`, paws / feet on the ground, facing +z (the game turns it) */
export async function loadFollower(cfg: FollowerConfig): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  const gltf = await new GLTFLoader().loadAsync(cfg.url);
  const scene = gltf.scene;
  let skin: THREE.Color | null = null; const top: THREE.MeshStandardMaterial[] = [];
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.castShadow = true; m.frustumCulled = false;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const sm = mat as THREE.MeshStandardMaterial;
      sm.metalness = 0;
      if (cfg.cape && sm.name === 'Reveille_Cape') {
        // her blanket: maroon satin with white piping, the ATM monogram and her name, painted at load (the model carries
        // the shape and its texture coordinates, see build_reveille.py); a sheen of its own, so the shaded side still
        // reads maroon rather than black
        const tex = capeTexture();
        sm.map = tex; sm.color.set(0xffffff); sm.roughness = 0.42; sm.side = THREE.DoubleSide;
        sm.emissiveMap = tex; sm.emissive.setScalar(0.3);
      }
      if (!cfg.cape) {
        // the runner as Character dresses him: shirtless (the top takes the skin's colour), maroon trunks
        sm.roughness = 0.7;
        if (sm.name.startsWith('Skin')) skin = sm.color;
        if (sm.name.startsWith('LightBrown')) top.push(sm);
        if (sm.name.startsWith('Red_Dark')) sm.color.setHex(0x500000);
      }
      patchMaterial(sm, { caustics: true });
    }
  });
  for (const sm of top) if (skin) sm.color.copy(skin);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const s = cfg.height / Math.max(0.01, box.max.y - box.min.y);
  scene.scale.setScalar(s);
  scene.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  return { scene, animations: gltf.animations };
}

/**
 * Reveille, the collie who runs with you. She waits on the research station's steps at the start (the sitting prop),
 * leaps up as you run past and gallops in beside you. From then on she runs at your shoulder on the inside of
 * your lane, on your own footprints: she goes where you went a moment ago (so she jumps what you jumped and never
 * crosses a lane you didn't) shifted a metre toward the middle of the course, which is clear of single-lane obstacles.
 * Collies don't dive: when you swim she stops at the water's edge and watches you go, and when you come back on land
 * she races up from behind and runs a happy lap round you before falling in beside you. A gull diving at you gets a
 * bark and a bounce. Cosmetic only (no collision, no effect on the run).
 * Model: Quaternius' CC0 "Husky" made over as a sable-and-white collie with a maroon collar
 * (blender/runner/build_reveille.py); its Gallop / Walk / Idle clips play through three.js' AnimationMixer.
 */
type Clip = 'Gallop' | 'Gallop_Jump' | 'Idle' | 'Idle_2' | 'Walk';
const ROLE: Record<Clip, keyof FollowerConfig['clips']> = { Gallop: 'run', Gallop_Jump: 'jump', Idle: 'idle', Idle_2: 'idle2', Walk: 'walk' };
type State = 'station' | 'joining' | 'zoomies' | 'running' | 'waiting' | 'gone';
const LAG = 0.35;               // m behind the runner (on your footprints, so a touch behind; level with you on screen)
const CATCH_UP = 7;             // m/s faster than the runner while she catches up
const ZOOM_T = 2.3, ZOOM_R = 2.4;   // the happy lap round you: how long, how wide
interface Step { x: number; y: number; z: number; air: boolean; slide: boolean }

export class Pet {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<Clip, THREE.AnimationAction>();
  private current: Clip | null = null;
  private state: State = 'station';
  private trail: Step[] = [];       // the runner's footprints on land, newest last (z decreasing)
  private side = 1;                 // eased -1..1: which side of the runner's line she runs on
  private sideT = 1;
  private yaw = Math.PI;
  private wasAir = false;
  private wasSwim = false;
  private lastZ = 0;
  private idleT = 0;
  /** back from a swim: a lap round you once she has caught up */
  private zoomPending = false; private zoomT = 0;
  private hop = 0;
  /** her feet are on the ground and she's running (for paw prints) */
  get pawsDown() { return this.root.visible && (this.state === 'running' || this.state === 'zoomies' || this.state === 'joining') && !this.wasAir && this.hop <= 0; }
  get position() { return this.p; }
  get heading() { return this.yaw; }
  private readonly p = new THREE.Vector3();
  loaded = false;
  /** sound cue: a bark as she joins you */
  onBark: (() => void) | null = null;

  private readonly SIDE: number;
  constructor(private readonly cfg: FollowerConfig = DOG) {
    this.SIDE = cfg.side;
    this.root.add(this.body);
    this.root.visible = false;
    this.load().catch((e) => console.warn('the follower failed to load:', (e as Error).message));
  }

  private async load() {
    const { scene, animations } = await loadFollower(this.cfg);
    this.body.add(scene);
    this.mixer = new THREE.AnimationMixer(scene);
    for (const clip of animations) {
      const role = (Object.keys(ROLE) as Clip[]).find((k) => this.cfg.clips[ROLE[k]] === clip.name);
      if (!role) continue;
      const a = this.mixer.clipAction(clip);
      if (role === 'Gallop_Jump') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions.set(role, a);
    }
    this.play('Idle', 0);
    this.loaded = true;
  }

  private play(name: Clip, fade = 0.2, restart = false) {
    const next = this.actions.get(name);
    if (!next || (this.current === name && !restart)) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset(); next.enabled = true; next.setEffectiveWeight(1); next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    this.current = name;
  }
  private speed(name: Clip, ts: number) { const a = this.actions.get(name); if (a) a.timeScale = ts; }

  /** a new run: she is back on the station steps */
  reset() {
    this.state = 'station'; this.trail.length = 0; this.root.visible = false; this.wasSwim = false; this.wasAir = false; this.zoomPending = false; this.hop = 0;
  }

  /** a gull diving at you: a bark and a bounce on her front feet */
  alert() {
    if (!this.cfg.bark || this.state !== 'running' || this.hop > 0) return;
    this.hop = 0.32; this.onBark?.();
  }

  /** where the runner was when at course position z (the trail is newest last, z decreasing) */
  private stepAt(z: number): Step | null {
    const t = this.trail;
    if (t.length < 2 || z > t[0].z || z < t[t.length - 1].z) return null;
    let i = t.length - 1;
    while (i > 0 && t[i - 1].z < z) i--;
    const a = t[i - 1], b = t[i], k = (a.z - z) / Math.max(1e-6, a.z - b.z);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z, air: a.air || b.air, slide: a.slide || b.slide };
  }

  update(dt: number, r: Runner, world: ChunkManager, playing: boolean) {
    if (!this.loaded) return;
    const swim = r.mode === 'swim' || r.mode === 'board' || r.mode === 'ski';   // (in the water either way: she waits ashore)
    // ---- footprints (on land only; a jump back across a gap you fell into is not a path)
    if (playing && !swim) {
      if (Math.abs(r.pos.z - this.lastZ) > 3) this.trail.length = 0;            // put back on the deck after a fall
      const last = this.trail[this.trail.length - 1];
      if (!last || last.z - r.pos.z > 0.12) {
        this.trail.push({ x: r.pos.x, y: r.pos.y, z: r.pos.z, air: r.airborne, slide: r.sliding > 0 });
        if (this.trail.length > 240) this.trail.splice(0, this.trail.length - 200);
      }
    }
    this.lastZ = r.pos.z;

    // ---- state changes
    const station = this.cfg.cape ? world.collie() : null;
    if (this.state === 'station') {
      if (!playing) return;
      if (!station) this.catchUp(r, world);
      else if (r.pos.z - station.z < 10) {
        // up off the steps as you come by
        world.releaseCollie();
        this.p.set(station.x, station.y, station.z);
        this.yaw = station.yaw;
        this.state = 'joining'; this.root.visible = true;
        this.play('Gallop_Jump', 0.05, true); this.speed('Gallop_Jump', 1.3);
        this.onBark?.();
      } else return;
    }
    if (swim && (this.state === 'running' || this.state === 'joining')) { this.state = 'waiting'; this.idleT = 0; }
    if (!swim && this.wasSwim && playing) { this.catchUp(r, world); this.zoomPending = this.cfg.zoomies; }
    this.wasSwim = swim;

    // ---- the runner's line: which side she keeps to (inside the outer lanes; she keeps her side in the middle)
    if (r.pos.x > 0.9) this.sideT = -1; else if (r.pos.x < -0.9) this.sideT = 1;
    this.side += Math.sign(this.sideT - this.side) * Math.min(Math.abs(this.sideT - this.side), dt * 2.2);

    const p = this.p;
    let vx = 0, vz = 0;
    if (this.state === 'running') {
      const z = r.pos.z + LAG;
      const s = this.stepAt(z);
      const x = (s ? s.x : r.pos.x) + this.side * this.SIDE;
      const y = s ? s.y : r.pos.y;
      vx = dt > 0 ? (x - p.x) / dt : 0; vz = dt > 0 ? (z - p.z) / dt : 0;
      p.set(x, y, z);
      this.body.scale.y = s?.slide ? 0.82 : 1;                                   // ducks under what you slid under
      const air = !!s && s.air && y - world.groundAt(x, z) > 0.3;
      if (air && !this.wasAir) { this.play('Gallop_Jump', 0.08, true); this.speed('Gallop_Jump', this.cfg.jumpLen / (MOVE.jumpTime * 1.1)); }
      else if (!air && r.speed > 0.5) { this.play('Gallop', this.wasAir ? 0.1 : 0.25); this.speed('Gallop', THREE.MathUtils.clamp(r.speed / this.cfg.runRate, 0.8, 2.6)); }
      else if (!air) { this.play('Idle', 0.4); }
      this.wasAir = air;
    } else if (this.state === 'joining') {
      // gallop to her place beside you, faster than you run
      const s = this.stepAt(r.pos.z + LAG);
      const tx = (s ? s.x : r.pos.x) + this.side * this.SIDE, tz = r.pos.z + LAG;
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), v = Math.max(4, r.speed + CATCH_UP) * dt;
      if (d <= v + 0.05) {
        this.state = this.zoomPending ? 'zoomies' : 'running';
        if (this.zoomPending) { this.zoomPending = false; this.zoomT = 0; this.onBark?.(); }
      }
      const k = Math.min(1, v / Math.max(1e-6, d));
      vx = dx * k / Math.max(dt, 1e-6); vz = dz * k / Math.max(dt, 1e-6);
      p.x += dx * k; p.z += dz * k;
      const g = world.floorAt(p.x, p.z) ?? world.groundAt(p.x, p.z);
      p.y = g < r.pos.y - 1 ? r.pos.y : g;                                         // (leaping a gap in the deck)
      const jump = this.actions.get('Gallop_Jump');
      if (this.current !== 'Gallop_Jump' || !jump?.isRunning()) { this.play('Gallop', 0.15); this.speed('Gallop', THREE.MathUtils.clamp((r.speed + CATCH_UP) / this.cfg.runRate, 1, 2.6)); }
    } else if (this.state === 'zoomies') {
      // round you once: out to the side, past you ahead, across, and back to her place
      this.zoomT += dt;
      const u = Math.min(1, this.zoomT / ZOOM_T), a = u * Math.PI * 2, rr = ZOOM_R * Math.sin(u * Math.PI) ** 0.6;
      const s = this.stepAt(r.pos.z + LAG);
      const cx = (s ? s.x : r.pos.x) + this.side * this.SIDE * (1 - Math.sin(u * Math.PI));
      const x = cx + this.side * Math.sin(a) * rr, z = r.pos.z + LAG - Math.sin(a * 0.5) * rr * 1.4;
      vx = dt > 0 ? (x - p.x) / dt : 0; vz = dt > 0 ? (z - p.z) / dt : 0;
      p.set(x, world.floorAt(x, z) ?? world.groundAt(x, z), z);
      if (p.y < r.pos.y - 1) p.y = r.pos.y;
      this.play('Gallop', 0.15); this.speed('Gallop', THREE.MathUtils.clamp((r.speed + 6) / this.cfg.runRate, 1.2, 2.8));
      if (u >= 1) this.state = 'running';
    } else if (this.state === 'waiting') {
      // trot to where you went in, then stand and watch the water
      const s = this.trail[this.trail.length - 1];
      if (s) {
        const tx = s.x + this.side * this.SIDE * 0.5, tz = s.z + 0.5;
        const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), v = Math.min(d, Math.max(3, r.speed * 0.6) * dt);
        if (d > 0.05) { p.x += dx / d * v; p.z += dz / d * v; vx = dx / d; vz = dz / d; }
        p.y = world.floorAt(p.x, p.z) ?? Math.max(world.groundAt(p.x, p.z), p.y - 2 * dt);
        if (d > 0.3) { this.play('Gallop', 0.25); this.speed('Gallop', 0.9); }
        else { this.idleT += dt; this.play(this.idleT % 9 < 6 ? 'Idle' : 'Idle_2', 0.5); }
      }
      if (p.z - r.pos.z > 90) { this.state = 'gone'; this.root.visible = false; }
    } else return;

    // face the way she's going, easing round
    if (Math.hypot(vx, vz) > 0.3) {
      const want = Math.atan2(vx, vz);
      let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 10);
    }
    this.root.position.copy(p);
    if (this.hop > 0) { this.hop = Math.max(0, this.hop - dt); this.root.position.y += Math.sin((this.hop / 0.32) * Math.PI) * 0.22; }
    this.root.rotation.y = this.yaw;
    this.mixer?.update(dt);
  }

  /** come racing up from behind (start of a run without the station, back on land after a swim) */
  private catchUp(r: Runner, world: ChunkManager) {
    this.trail.length = 0;
    this.p.set(r.pos.x + this.side * this.SIDE, r.pos.y, r.pos.z + 16);
    const g = world.floorAt(this.p.x, this.p.z) ?? world.groundAt(this.p.x, this.p.z);
    this.p.y = Math.max(g, r.pos.y);
    this.yaw = Math.PI;
    this.state = 'joining'; this.root.visible = true;
    this.play('Gallop', 0.1);
  }
}

/** Reveille's blanket, one side of it (both sides use the same picture; the front edge is on the left, the hem at the
 *  bottom, the spine along the top): maroon satin with a sheen, white piping on the open edges, the ATM monogram and
 *  'Reveille' in script below it */
function capeTexture(): THREE.Texture {
  const W = 1024, H = 384, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const sheen = g.createLinearGradient(0, 0, W, H);
  sheen.addColorStop(0, '#521020'); sheen.addColorStop(0.35, '#68192a'); sheen.addColorStop(0.5, '#82303f'); sheen.addColorStop(0.65, '#661728'); sheen.addColorStop(1, '#4e0f1d');
  g.fillStyle = sheen; g.fillRect(0, 0, W, H);
  // piping along the front edge, the hem and the back edge
  const P = 18;
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, P, H); g.fillRect(W - P, 0, P, H); g.fillRect(0, H - P, W, P);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(P, 0, 3, H - P); g.fillRect(W - P - 3, 0, 3, H - P); g.fillRect(P, H - P - 3, W - 2 * P, 3);
  // the monogram: a tall T whose bar caps a block A and M, white with a maroon keyline
  const u = 0.9, ox = W * 0.5 - 150 * u, oy = 96;
  const poly = (pts: [number, number][]) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(ox + x * u, oy + y * u) : g.moveTo(ox + x * u, oy + y * u))); g.closePath(); };
  const letters: [number, number][][] = [
    [[0, 0], [300, 0], [300, 34], [176, 34], [176, 200], [124, 200], [124, 34], [0, 34]],                                   // T
    [[6, 200], [44, 46], [92, 46], [122, 200], [86, 200], [80, 168], [52, 168], [44, 200]],                                    // A
    [[178, 200], [178, 46], [212, 46], [239, 118], [266, 46], [300, 46], [300, 200], [270, 200], [270, 108], [246, 172], [232, 172], [208, 108], [208, 200]],   // M
  ];
  g.lineJoin = 'round';
  for (const L of letters) { poly(L); g.fillStyle = '#f4f1ea'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#4a0a12'; g.stroke(); }
  poly([[58, 142], [74, 142], [66, 98]]); g.fillStyle = '#68192a'; g.fill();                                                  // the A's counter
  // her name in script under it
  g.fillStyle = '#f4f1ea';
  g.font = 'italic 600 64px "Brush Script MT", "Snell Roundhand", "Segoe Script", cursive';
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText('Reveille', W * 0.5, H - P - 26);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;                       // (glTF texture coordinates: v = 0 at the top)
  tex.anisotropy = 4;
  return tex;
}
