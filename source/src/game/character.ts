import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patchMaterial } from '../core/env';
import { loadMesh } from '../core/assets';
import { MOVE } from './types';
import type { Runner } from './runner';

/**
 * The runner's body: Quaternius' CC0 "Beach Character" (poly.pizza/m/DojKLcO34E) with its hand-animated clips
 * (Idle, Run, Roll, Hit, Death, Wave) plus Jump and Swim keyed on the same rig (blender/runner/author_q_clips.py), and
 * on the board (Shorebreak Point) Surf and SurfGrab (blender/runner/author_surf_clips.py) standing side-on on our board,
 * which tilts with the water, leans into a lane change and comes up in a grab on an ollie.
 * Clips are cross-faded with three.js' AnimationMixer, as in the official skinning-blending example; the code only
 * picks the clip, its playback speed, and the body's lean / prone pitch. On top of the clips, small touches: a stretch on
 * take-off and a squash on landing, the hat lifting off his head on a close shave or a launch and dropping back, skin
 * that glistens after a swim and dries, a shake of the head as he surfaces, and a glance at what he just skimmed past.
 */
type ClipName = 'Idle' | 'Run' | 'Roll' | 'Hit' | 'Death' | 'Wave' | 'Jump' | 'Swim' | 'Surf' | 'SurfGrab';
const HEIGHT = 1.75;
const HIP = 0.9;
/** where the dive pack sits (model space at load: centre height, distance behind the body's centre line) */
const PACK_AT = [0, 1.2, 0.1];            // pivot height for leaning and the prone swim pitch
/** the hat (Runner_Hat.glb, brim HAT_BRIM m across) against the head's box: brim / head width, how far down the head
 *  the opening sits (fraction of its height), how far back (fraction), and a tilt back off the brow (rad) */
const HAT_BRIM = 0.624;
/** height of the board's deck above its bottom (Runner_Board.glb) */
const BOARD_TOP = 0.11;
/** height above the feet the backflip turns about (the rider's middle) */
const FLIP_PIVOT = 0.85;
const HAT_FIT = [2.35, 0.42, 0.03, -0.1];

export class Character {
  readonly root = new THREE.Group();          // placed at the runner's feet, facing -z
  /** the surfboard's frame: tilts with the wave's face and into the carve, spins in a trick (identity off the board) */
  private deck = new THREE.Group();
  private board: THREE.Mesh | null = null;
  private ski: THREE.Mesh | null = null;
  private feet: THREE.Object3D[] = [];
  private stanceY = 0;
  private carveYaw = 0;
  private faceRoll = 0;
  /** the board after you let it go at the end of a ride, drifting off */
  private drift: { t: number; vx: number; vz: number; spin: number; y: number; bob: number } | null = null;
  private body = new THREE.Group();            // lean / prone pitch, pivoting at the hips
  private model = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private current: ClipName | null = null;
  private swimBlend = 0;
  private hitT = 0;
  private lastStumble = 0;
  private wasAir = false;
  private wasSlide = false;
  private wasAirSq = false; private lastVy = 0;
  private dead = false;
  loaded = false;
  ready: Promise<void>;
  private fallback: THREE.Mesh | null = null;
  // ---- touches
  /** squash / stretch: a damped spring on the height (+ stretched, - squashed), volume kept across */
  private sq = 0; private sqV = 0;
  private head: THREE.Object3D | null = null;
  private hat: THREE.Mesh | null = null;
  private hatBase = new THREE.Vector3(); private hatBaseQ = new THREE.Quaternion();
  private hatLift = 0; private hatV = 0;
  private skin: THREE.MeshStandardMaterial[] = []; private skinBase: THREE.Color[] = [];
  private wet = 0;
  private shakeT = 0;
  private glanceT = 0; private glanceDir = 0;
  private tq = new THREE.Quaternion(); private tq2 = new THREE.Quaternion(); private tv = new THREE.Vector3();

  constructor() {
    this.root.add(this.deck);
    this.deck.add(this.body);
    this.body.position.y = HIP;
    this.body.add(this.model);
    this.model.position.y = -HIP;
    this.ready = this.load();
  }

  private async load() {
    try {
      const gltf = await new GLTFLoader().loadAsync('runner/models/Runner_Beach.glb');
      const scene = gltf.scene;
      let skin: THREE.Color | null = null;
      const top: THREE.MeshStandardMaterial[] = [];
      scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          // the source materials are 40% metallic, which renders near-black without an environment map
          const sm = mat as THREE.MeshStandardMaterial;
          sm.metalness = 0; sm.roughness = 0.7;
          if (sm.name.startsWith('Skin')) { skin = sm.color; this.skin.push(sm); }
          // shirtless: the tank top takes the skin's colour (below); the trunks true maroon
          if (sm.name.startsWith('LightBrown')) top.push(sm);
          if (sm.name.startsWith('Red_Dark')) sm.color.setHex(0x500000);
          patchMaterial(sm, { caustics: true });
        }
      });
      for (const sm of top) if (skin) sm.color.copy(skin);
      this.skin.push(...top);
      this.skinBase = this.skin.map((m) => m.color.clone());
      // normalise: 1.75 m tall, feet on the ground, facing -z (the source faces +z)
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene, true);
      const s = HEIGHT / Math.max(0.01, box.max.y - box.min.y);
      scene.scale.setScalar(s);
      scene.position.y = -box.min.y * s;
      scene.rotation.y = Math.PI;
      this.model.add(scene);
      // a small dive pack with a white 12 on the runner's back, carried by the chest bone
      const chest = scene.getObjectByName('Chest');
      if (chest) {
        const packSrc = await loadMesh('runner/models/Runner_Pack.glb');
        const pack = new THREE.Mesh(packSrc.geometry, patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), { caustics: true }));
        pack.castShadow = true;
        pack.position.set(0, PACK_AT[1], PACK_AT[2]);           // the runner faces -z, so its back (and the pack's outer face) is +z
        this.model.add(pack);
        this.model.updateMatrixWorld(true);
        chest.attach(pack);
      }
      // a straw sun hat with a maroon band, sat on the crown of the head and carried by the head bone
      const head = scene.getObjectByName('Head'), headMesh = scene.getObjectByName('Beach_Head');
      if (head && headMesh) {
        this.model.updateMatrixWorld(true);
        const hb = new THREE.Box3().setFromObject(headMesh, true);
        const hatSrc = await loadMesh('runner/models/Runner_Hat.glb');
        const hat = new THREE.Mesh(hatSrc.geometry, patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), { caustics: true }));
        hat.castShadow = true;
        const w = hb.max.x - hb.min.x, h = hb.max.y - hb.min.y;
        hat.scale.setScalar((w * HAT_FIT[0]) / HAT_BRIM);
        // (the box is in world space)
        hat.position.copy(this.model.worldToLocal(new THREE.Vector3((hb.min.x + hb.max.x) / 2, hb.max.y - h * HAT_FIT[1], (hb.min.z + hb.max.z) / 2 + h * HAT_FIT[2])));
        hat.rotation.set(HAT_FIT[3], Math.PI, 0);                              // (the hat's front is +z; the runner faces -z)
        // hair under a hat lies flat: squash the spikes that would poke through the crown (done in the rest pose, where
        // the skin's local space maps to the world by the mesh's own matrix)
        const yc = hb.max.y - h * HAT_FIT[1] + 0.06, v = new THREE.Vector3();
        headMesh.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !(m.material as THREE.Material).name.startsWith('Hair')) return;
          const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute, inv = m.matrixWorld.clone().invert();
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
            if (v.y <= yc) continue;
            v.y = yc + (v.y - yc) * 0.12;
            v.applyMatrix4(inv); pos.setXYZ(i, v.x, v.y, v.z);
          }
          pos.needsUpdate = true; m.geometry.computeVertexNormals();
        });
        this.model.add(hat);
        this.model.updateMatrixWorld(true);
        head.attach(hat);
        this.hat = hat; this.hatBase.copy(hat.position); this.hatBaseQ.copy(hat.quaternion);
      }
      this.head = head ?? null;
      // the surfboard (shown on the board only)
      const boardSrc = await loadMesh('runner/models/Runner_Board.glb');
      this.board = new THREE.Mesh(boardSrc.geometry, patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), { caustics: true }));
      this.board.castShadow = true; this.board.visible = false;
      this.deck.add(this.board);
      const skiSrc = await loadMesh('runner/models/Jet_Ski.glb');
      this.ski = new THREE.Mesh(skiSrc.geometry, patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }), { caustics: true }));
      this.ski.castShadow = true; this.ski.visible = false; this.ski.rotation.y = Math.PI;      // (built facing +z; the course runs down -z)
      this.deck.add(this.ski);
      this.feet = ['FootL', 'FootR'].map((n) => scene.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
      this.mixer = new THREE.AnimationMixer(scene);
      for (const clip of gltf.animations) {
        const a = this.mixer.clipAction(clip);
        if (['Jump', 'Roll', 'Hit', 'Death'].includes(clip.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        this.actions.set(clip.name as ClipName, a);
      }
      this.play('Idle', 0);
      this.loaded = true;
    } catch (e) {
      console.warn('character failed to load, using a capsule:', (e as Error).message);
      const geo = new THREE.CapsuleGeometry(0.32, 1.1, 6, 12);
      geo.translate(0, 0.87, 0);
      this.fallback = new THREE.Mesh(geo, patchMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color('#f2ece2'), roughness: 0.6 })));
      this.fallback.castShadow = true;
      this.model.add(this.fallback);
    }
  }

  /** cross-fade to a clip; one-shot clips restart from the beginning */
  private play(name: ClipName, fade = 0.15, restart = false) {
    const next = this.actions.get(name);
    if (!next) return;
    if (this.current === name && !restart) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev && prev !== next) prev.stop();
    this.current = name;
  }

  private speed(name: ClipName, ts: number) { const a = this.actions.get(name); if (a) a.timeScale = ts; }

  /** dev: hold a clip at a fixed phase (?pose=run|jump|roll|swim|hit|death|idle) */
  debugPose(name: string, _t: number, _r: Runner, phase = 0.4) {
    const clip = (name.charAt(0).toUpperCase() + name.slice(1)) as ClipName;
    const a = this.actions.get(clip);
    if (!a || !this.mixer) return;
    if (this.current !== clip) { this.mixer.stopAllAction(); a.reset().play(); this.current = clip; }
    a.paused = true;
    a.time = a.getClip().duration * phase;
    this.mixer.update(0);
    this.body.rotation.set(clip === 'Swim' ? -(Math.PI / 2 - 0.15) : 0, 0, 0, 'YXZ');
  }

  update(dt: number, _t: number, r: Runner, idle = false) {
    const swim = r.mode === 'swim' && !idle;
    const onBoard = r.mode === 'board' && !idle;
    const onSki = r.mode === 'ski' && !idle;
    this.updateBoard(dt, r, onBoard);
    this.updateSki(dt, r, onSki);
    this.swimBlend += ((swim ? 1 : 0) - this.swimBlend) * (1 - Math.exp(-dt * 7));
    const sb = this.swimBlend;
    // swimming: runner.pos is the hip position; on land it is the feet
    this.root.position.set(r.pos.x, r.pos.y - HIP * sb, r.pos.z);
    // lean into a lane change: the body turns a little toward it and banks, both eased (lean is already smoothed)
    const yaw = -r.lean * 0.26 * (1 - sb * 0.4);
    const bank = -r.lean * (0.14 + 0.22 * sb);
    const pitch = -sb * (Math.PI / 2 - 0.15 - THREE.MathUtils.clamp(r.vy * 0.12, -0.45, 0.45));
    if (onBoard) this.body.rotation.set(0, Math.PI / 2, 0, 'YXZ');            // side-on to the board, facing the wave
    else if (onSki) this.body.rotation.set(0.42 + (r.airborne ? -0.25 : 0), yaw * 0.5, bank * 0.6, 'YXZ');   // leaning over the bars
    else this.body.rotation.set(idle ? 0 : pitch, idle ? 0 : yaw, idle ? 0 : bank, 'YXZ');
    if (this.fallback) this.fallback.scale.y = r.sliding > 0 && !idle ? 0.5 : 1;

    // ---------------- clip selection
    if (idle) { this.dead = false; this.play('Idle'); }
    else if (!r.alive) { if (!this.dead) { this.dead = true; this.play('Death', 0.1, true); } }
    else {
      this.dead = false;
      if (r.stumble > this.lastStumble + 0.5) this.hitT = 0.45;          // a fresh hit: stumble through the Hit clip
      this.hitT = Math.max(0, this.hitT - dt);
      const slideStart = r.sliding > 0 && !this.wasSlide;
      const jumpStart = r.airborne && !this.wasAir && r.vy > 0;
      if (onSki) {
        if (this.hitT > 0 && !r.airborne) { this.play('Hit', 0.08, this.hitT >= 0.44); this.speed('Hit', 1.2); }
        else if (r.airborne && r.bigAir) this.play('SurfGrab', 0.1);
        else this.play('Idle', 0.25);
      } else if (onBoard) {
        if (this.hitT > 0 && !r.airborne) { this.play('Hit', 0.08, this.hitT >= 0.44); this.speed('Hit', 1.2); }
        else if (r.airborne && (r.grab || !r.bigAir)) this.play('SurfGrab', 0.1);
        else { this.play('Surf', this.current === 'SurfGrab' ? 0.15 : 0.25); this.speed('Surf', r.sliding > 0 ? 1.6 : 1); }
      } else if (swim) {
        this.play('Swim', 0.3);
        this.speed('Swim', THREE.MathUtils.clamp(r.speed / 11, 0.8, 1.8) * (r.surgeT > 0 ? 1.4 : 1));
      } else if (this.hitT > 0 && !r.airborne && r.sliding <= 0) {
        this.play('Hit', 0.08, this.hitT >= 0.44); this.speed('Hit', 1.2);
      } else if (r.sliding > 0) {
        if (slideStart || this.current !== 'Roll') this.play('Roll', 0.08, true);
        this.speed('Roll', 1.333 / (MOVE.slideTime + 0.15));
      } else if (r.airborne) {
        // a real jump plays Jump timed to the airtime; dropping off a ledge keeps the current pose
        if (jumpStart) this.play('Jump', 0.06, true);
        this.speed('Jump', 0.833 / MOVE.jumpTime);
      } else {
        this.play('Run', this.current === 'Jump' ? 0.1 : 0.2);
        this.speed('Run', THREE.MathUtils.clamp(r.speed / 12, 0.85, 1.7) * (r.mode === 'surf' ? 0.85 : 1));
      }
      this.wasSlide = r.sliding > 0; this.wasAir = r.airborne;
    }
    this.lastStumble = r.stumble;
    this.mixer?.update(dt);
    if (onBoard) this.settleFeet(dt, r.sliding > 0);
    if (!idle) this.touches(dt, r, swim);
  }

  // ---------------------------------------------------------------- small touches (after the clips have posed the bones)
  /** the hat lifts off his head (a close shave, a launch off the lip: k 0..1) and drops back */
  hatPop(k: number) { this.hatV = Math.max(this.hatV, 2.2 + 2.4 * k); }
  /** surfacing: shake the water out of his hair */
  shakeHead() { this.shakeT = 0.55; }
  /** a near miss: a glance toward what he just skimmed (dir: -1 it was on his left, +1 on his right) */
  glance(dir: number) { this.glanceDir = dir; this.glanceT = 0.75; }
  /** where his head is (for the drops he shakes off) */
  headPos(out: THREE.Vector3) { if (this.head) this.head.getWorldPosition(out); else out.copy(this.root.position).setY(this.root.position.y + 1.6); return out; }

  /** turn a bone about the world's vertical, whatever its own axes are */
  private yawBone(bone: THREE.Object3D, a: number) {
    if (!bone.parent || Math.abs(a) < 1e-4) return;
    bone.parent.getWorldQuaternion(this.tq2);
    bone.getWorldQuaternion(this.tq);
    this.tq.premultiply(new THREE.Quaternion().setFromAxisAngle(this.tv.set(0, 1, 0), a));
    bone.quaternion.copy(this.tq2.invert().multiply(this.tq));
  }

  private touches(dt: number, r: Runner, swim: boolean) {
    // squash and stretch: kicked on take-off and touch-down, sprung back
    if (r.airborne && !this.wasAirSq && r.vy > 0) this.sqV += 2.6;
    if (!r.airborne && this.wasAirSq && !swim) this.sqV -= Math.min(4.5, 1.6 + Math.abs(this.lastVy) * 0.28);
    this.wasAirSq = r.airborne; this.lastVy = r.vy;
    this.sqV += (-170 * this.sq - 17 * this.sqV) * dt; this.sq += this.sqV * dt;
    const s = THREE.MathUtils.clamp(this.sq, -0.22, 0.18);
    this.root.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5);
    // the hat: a lift that falls back under its own weight and settles with a little bounce
    if (this.hat && this.head) {
      this.hatV -= 18 * dt; this.hatLift += this.hatV * dt;
      if (this.hatLift <= 0) { this.hatLift = 0; this.hatV = this.hatV < -1 ? -this.hatV * 0.25 : 0; }
      const ws = this.head.getWorldScale(this.tv).x || 1;
      // (up, in the head bone's frame)
      this.head.getWorldQuaternion(this.tq).invert();
      const up = this.tv.set(0, 1, 0).applyQuaternion(this.tq);
      this.hat.position.copy(this.hatBase).addScaledVector(up, (this.hatLift * 0.55) / ws);
      this.hat.quaternion.copy(this.hatBaseQ).multiply(this.tq2.setFromAxisAngle(this.tv.set(1, 0, 0), -this.hatLift * 0.9));
    }
    // wet from a swim: darker skin with a shine, drying over ten seconds on land
    this.wet = swim ? 1 : Math.max(0, this.wet - dt / 10);
    this.skin.forEach((m, i) => { m.roughness = 0.7 - 0.42 * this.wet; m.color.copy(this.skinBase[i]).multiplyScalar(1 - 0.16 * this.wet); });
    if (!this.head) return;
    // surfacing: a quick shake of the head; a near miss: a glance at it
    if (this.shakeT > 0) { this.shakeT -= dt; this.yawBone(this.head, Math.sin(this.shakeT * 46) * 0.5 * Math.min(1, this.shakeT / 0.2)); }
    if (this.glanceT > 0) {
      this.glanceT -= dt;
      const u = 1 - this.glanceT / 0.75;
      this.yawBone(this.head, -this.glanceDir * 0.6 * Math.sin(Math.min(1, u * 1.6) * Math.PI));
    }
  }

  /** the board: under the feet while riding (tilted with the face, leaning into the carve, spun by a trick); let go at
   *  the end of a ride it floats off on the surface for a few seconds */
  private updateBoard(dt: number, r: Runner, onBoard: boolean) {
    const b = this.board;
    if (!b) return;
    if (onBoard) {
      if (this.drift) { this.drift = null; this.deck.add(b); b.position.set(0, 0, 0); b.rotation.set(0, 0, 0); }
      b.visible = true;
      this.faceRoll += (Math.atan(r.faceSlope) * 0.85 - this.faceRoll) * (1 - Math.exp(-dt * 7));
      const roll = this.faceRoll - r.lean * 0.32;
      // the nose points where you're going: up or down the face as you carve, not only down the line
      const heading = r.airborne ? 0 : -Math.atan2(r.vx, Math.max(4, r.speed)) * 0.9;
      this.carveYaw += (heading - this.carveYaw) * (1 - Math.exp(-dt * 8));
      // (the backflip: end over end round the rider's middle, head going back first, then the yaw on top)
      this.deck.rotation.set(r.flip, r.spin + this.carveYaw, roll, 'YXZ');
      this.deck.position.set(0, FLIP_PIVOT, 0).sub(this.tv.set(0, FLIP_PIVOT, 0).applyEuler(this.deck.rotation));
      return;
    }
    if (r.mode !== 'ski') { this.deck.rotation.set(0, 0, 0); this.deck.position.set(0, 0, 0); }
    if (this.stanceY !== 0) { this.stanceY = 0; this.model.position.y = -HIP; }
    if (b.visible && !this.drift) {
      // let go: diving, the board stays on the surface and drifts off seaward; stepping onto the sand, it's left lying
      const parent = this.root.parent, swim = r.mode === 'swim';
      if (parent) { this.root.updateMatrixWorld(true); parent.attach(b); b.position.y = swim ? 0.02 : r.pos.y + 0.02; b.rotation.set(0, b.rotation.y, 0); }
      this.drift = swim ? { t: 0, vx: -1.4, vz: -2.5, spin: 0.6, y: 0.02, bob: 0.05 } : { t: 0, vx: 0, vz: 0, spin: 0, y: r.pos.y + 0.02, bob: 0 };
    }
    if (this.drift) {
      const d = this.drift;
      d.t += dt;
      b.position.x += d.vx * dt; b.position.z += d.vz * dt; b.rotation.y += d.spin * dt;
      d.vz *= Math.exp(-dt * 0.6);
      b.position.y = d.y + Math.sin(d.t * 2.2) * d.bob;
      if (d.t > 5) { b.visible = false; this.drift = null; this.deck.add(b); b.position.set(0, 0, 0); b.rotation.set(0, 0, 0); }
    } else b.visible = false;
  }

  /** the jet ski under him: banks into the turn, noses up off a wake, flips off a ramp */
  private updateSki(dt: number, r: Runner, onSki: boolean) {
    const s = this.ski;
    if (!s) return;
    s.visible = onSki;
    if (!onSki) { if (this.skiLean !== 0) { this.skiLean = 0; this.model.position.y = -HIP + this.stanceY; } return; }
    this.skiLean += (-r.lean * 0.5 - this.skiLean) * (1 - Math.exp(-dt * 8));
    const pitch = r.airborne ? THREE.MathUtils.clamp(-r.vy * 0.06, -0.35, 0.35) : -0.04 - Math.min(0.08, r.speed * 0.002);
    this.deck.rotation.set(r.flip + pitch, -r.lean * 0.12 + r.spin, this.skiLean, 'YXZ');
    this.deck.position.set(0, 0.6, 0).sub(this.tv.set(0, 0.6, 0).applyEuler(this.deck.rotation));
    this.model.position.y = -HIP + 0.55 - 0.38;                                     // (seated: on the saddle, crouched)
  }
  private skiLean = 0;

  /** bent knees lift the feet: sink the body until they stand on the deck */
  private settleFeet(dt: number, tuck: boolean) {
    if (!this.feet.length) return;
    this.deck.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let low = Infinity;
    for (const f of this.feet) { f.getWorldPosition(v); this.deck.worldToLocal(v); low = Math.min(low, v.y); }
    const want = this.stanceY + (BOARD_TOP + 0.08 - low);             // (the foot bone is the ankle)
    this.stanceY += (THREE.MathUtils.clamp(want, -0.9, 0.2) - this.stanceY) * (1 - Math.exp(-dt * (tuck ? 14 : 10)));
    this.model.position.y = -HIP + this.stanceY;
  }
}
