import * as THREE from 'three';
import { patchMaterial } from '../core/env';
import { loadMesh } from '../core/assets';
import { MOVE } from './types';
import { loadFollower, DOG } from './pet';
import type { Runner } from './runner';

/**
 * Reveille as the player (the land-only option: beach, pier and Shorebreak Point, no diving). The same collie model and
 * clips as the companion (pet.ts): she gallops, leaps what you jump (Gallop_Jump timed to the air), flattens into a
 * crouch for a slide, crouches low on the board and leans into the carve; a hit rolls her; she keels over at the end.
 * It answers the same calls as Character, so main.ts swaps one for the other.
 */
const BOARD_TOP = 0.11;

export class DogCharacter {
  readonly root = new THREE.Group();
  private deck = new THREE.Group();
  private body = new THREE.Group();
  private board: THREE.Mesh | null = null;
  private ski: THREE.Mesh | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current = '';
  private crouch = 0;
  private wasAir = false;
  private hitT = 0; private lastStumble = 0;
  private dead = 0;
  private faceRoll = 0; private carveYaw = 0;
  private head: THREE.Object3D | null = null;
  private glanceT = 0; private glanceDir = 0;
  loaded = false;
  ready: Promise<void>;

  constructor() {
    this.root.add(this.deck); this.deck.add(this.body);
    this.ready = this.load();
  }

  private async load() {
    try {
      const { scene, animations } = await loadFollower(DOG);
      this.body.add(scene);
      this.head = scene.getObjectByName('Head') ?? scene.getObjectByName('head') ?? null;
      this.mixer = new THREE.AnimationMixer(scene);
      for (const clip of animations) {
        const a = this.mixer.clipAction(clip);
        if (clip.name === 'Gallop_Jump') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        this.actions.set(clip.name, a);
      }
      const boardSrc = await loadMesh('runner/models/Runner_Board.glb');
      this.board = new THREE.Mesh(boardSrc.geometry, patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), { caustics: true }));
      this.board.castShadow = true; this.board.visible = false;
      this.deck.add(this.board);
      const skiSrc = await loadMesh('runner/models/Jet_Ski.glb');
      this.ski = new THREE.Mesh(skiSrc.geometry, patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }), { caustics: true }));
      this.ski.castShadow = true; this.ski.visible = false; this.ski.rotation.y = Math.PI;
      this.deck.add(this.ski);
      this.play('Idle', 0);
      this.loaded = true;
    } catch (e) { console.warn('Reveille (player) failed to load:', (e as Error).message); }
  }

  private play(name: string, fade = 0.2, restart = false) {
    const next = this.actions.get(name);
    if (!next || (this.current === name && !restart)) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset(); next.enabled = true; next.setEffectiveWeight(1); next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    this.current = name;
  }
  private speed(name: string, ts: number) { const a = this.actions.get(name); if (a) a.timeScale = ts; }

  // the same hooks as Character (she has no hat; a glance she does)
  hatPop(_k: number) { /* no hat */ }
  shakeHead() { /* (her shake is in the touches below) */ this.shakeT = 0.5; }
  private shakeT = 0;
  glance(dir: number) { this.glanceDir = dir; this.glanceT = 0.6; }
  headPos(out: THREE.Vector3) { if (this.head) this.head.getWorldPosition(out); else out.copy(this.root.position).setY(this.root.position.y + 0.9); return out; }
  debugPose(_name: string, _t: number, _r: Runner) { /* not for the dog */ }

  update(dt: number, _t: number, r: Runner, idle = false) {
    const onBoard = r.mode === 'board' && !idle;
    const onSki = r.mode === 'ski' && !idle;
    const swim = r.mode === 'swim' && !idle;
    this.root.position.set(r.pos.x, r.pos.y + (onBoard ? BOARD_TOP + 0.02 : onSki ? 0.62 : swim ? -0.3 : 0), r.pos.z);
    // facing down the course, turning a little into a lane change, banking with it
    const yaw = idle ? 0 : -r.lean * 0.3, bank = idle ? 0 : -r.lean * 0.18;
    // ---- the board
    if (this.ski) this.ski.visible = onSki;
    if (this.ski && onSki) {
      // she stands on the saddle, the ski banking under her (the ski mesh sits below her feet)
      this.ski.position.y = -0.62;
      const pitch = r.airborne ? THREE.MathUtils.clamp(-r.vy * 0.06, -0.35, 0.35) : -0.05;
      this.deck.rotation.set(r.flip + pitch, r.spin, -r.lean * 0.45, 'YXZ');
      this.deck.position.set(0, 0.3, 0).sub(new THREE.Vector3(0, 0.3, 0).applyEuler(this.deck.rotation));
    }
    if (this.board) {
      this.board.visible = onBoard;
      if (onBoard) {
        this.faceRoll += (Math.atan(r.faceSlope) * 0.85 - this.faceRoll) * (1 - Math.exp(-dt * 7));
        const heading = r.airborne ? 0 : -Math.atan2(r.vx, Math.max(4, r.speed)) * 0.9;
        this.carveYaw += (heading - this.carveYaw) * (1 - Math.exp(-dt * 8));
        this.deck.rotation.set(r.flip, r.spin + this.carveYaw, this.faceRoll - r.lean * 0.32, 'YXZ');
        this.deck.position.set(0, 0.5, 0).sub(new THREE.Vector3(0, 0.5, 0).applyEuler(this.deck.rotation));
      } else if (!onSki) { this.deck.rotation.set(0, 0, 0); this.deck.position.set(0, 0, 0); }
    }
    // ---- clips
    if (idle) { this.dead = 0; this.play('Idle', 0.3); this.crouch += (0 - this.crouch) * (1 - Math.exp(-dt * 8)); }
    else if (!r.alive) {
      // keels over on her side
      this.dead = Math.min(1, this.dead + dt * 2.2);
      this.play('Idle', 0.2);
    } else {
      this.dead = 0;
      if (r.stumble > this.lastStumble + 0.5) this.hitT = 0.45;
      this.hitT = Math.max(0, this.hitT - dt);
      const jumpStart = r.airborne && !this.wasAir && r.vy > 0;
      const want = onBoard || onSki ? 0.55 : r.sliding > 0 ? 0.5 : 0;             // (crouch: flat for a slide, low on the board and the ski)
      this.crouch += (want - this.crouch) * (1 - Math.exp(-dt * 12));
      if (onBoard || onSki) { this.play('Idle', 0.25); }
      else if (swim) { this.play('Gallop', 0.3); this.speed('Gallop', 1.1); }     // (paddling)
      else if (r.airborne) { if (jumpStart) this.play('Gallop_Jump', 0.06, true); this.speed('Gallop_Jump', 0.917 / Math.max(0.5, MOVE.jumpTime)); }
      else if (r.sliding > 0) { this.play('Gallop', 0.1); this.speed('Gallop', 2.4); }
      else if (r.speed > 0.5) { this.play('Gallop', this.current === 'Gallop_Jump' ? 0.1 : 0.2); this.speed('Gallop', THREE.MathUtils.clamp(r.speed / 7.5, 0.9, 2.8)); }
      else this.play('Idle', 0.3);
      this.wasAir = r.airborne;
    }
    this.lastStumble = r.stumble;
    // the crouch: lower and longer; a hit rolls her; death tips her over
    const c = this.crouch;
    this.body.scale.set(1 + 0.12 * c, 1 - 0.45 * c, 1 + 0.1 * c);
    const roll = this.hitT > 0 ? Math.sin((0.45 - this.hitT) / 0.45 * Math.PI) * 0.5 : 0;
    const dd = this.dead * this.dead * (3 - 2 * this.dead);
    this.body.rotation.set(0.2 * c + (swim ? 0.5 : 0), Math.PI + yaw, bank + roll + dd * (Math.PI / 2), 'YXZ');
    this.body.position.y = -dd * 0.35;
    this.mixer?.update(dt);
    // a glance at what she skimmed, a shake of the head coming out of the water (the head bone, if the rig names one)
    if (this.head) {
      if (this.glanceT > 0) { this.glanceT -= dt; const u = 1 - this.glanceT / 0.6; this.head.rotation.y = -this.glanceDir * 0.5 * Math.sin(Math.min(1, u * 1.6) * Math.PI); }
      else if (this.shakeT > 0) { this.shakeT -= dt; this.head.rotation.y = Math.sin(this.shakeT * 44) * 0.45 * Math.min(1, this.shakeT / 0.2); }
    }
  }
}
