import * as THREE from 'three';
import { MOVE, LANES, LANE_W, WAVE_CLIMB, LIP_VY, LIP_DRIFT, AIR_REACH, SKI_LAT, SKI_BOOST, WAKE_VY, laneOf, speedAt, type Chunk, type Obstacle } from './types';
import { waveY, LIP_PAD } from './wave';
import type { InputState } from './input';
import type { ChunkManager } from './chunks';
import { capsuleClearance, alongExtent, type Body, type Contact } from './collide';

/**
 * The runner: automatic forward motion; on foot three lanes (keyboard taps step a lane, the hand's left / centre /
 * right zone picks one), jump and slide; the same on the board at Shorebreak Point, where the water is the floor; under
 * water free steering in x and y. Currents, surges, capsule collision with near-miss detection. Fixed 240 Hz substeps so
 * nothing tunnels.
 */
export type RunnerMode = 'run' | 'surf' | 'swim' | 'board' | 'ski';
export type RunnerEvent =
  | { kind: 'jump' } | { kind: 'land'; surf: boolean } | { kind: 'slide' } | { kind: 'surge' }
  | { kind: 'near'; closeness: number; ob: Obstacle } | { kind: 'hit'; ob: Obstacle | null; fatal: boolean; shielded: boolean }
  | { kind: 'pearl'; value: number; risky: boolean } | { kind: 'dive' } | { kind: 'surface' } | { kind: 'risky'; bonus: number } | { kind: 'fall' } | { kind: 'ring'; streak: number }
  | { kind: 'bump' } | { kind: 'swept'; dir: number } | { kind: 'airLow' } | { kind: 'airOut' }
  // on the board
  | { kind: 'mount' } | { kind: 'release' } | { kind: 'spray'; k: number }
  | { kind: 'launch' } | { kind: 'trick'; name: string; points: number; clean: boolean }
  | { kind: 'skiMount' } | { kind: 'skiOff' } | { kind: 'wakeHop' };

const STEP = 1 / 240;
const G = (2 * MOVE.jumpHeight) / Math.pow(MOVE.jumpTime / 2, 2);
const JUMP_V = G * MOVE.jumpTime / 2;
/** spin rate in the air (rad/s): a 360 in 0.7 s */
const SPIN = 9;

interface Pass { key: string; min: number; hit: boolean; ob: Obstacle; chunk: Chunk }

/** running out of breath counts as a hit (the run-over screen says why) */
/** lane-change spring (rad/s): 90 % of the way across a lane in ~0.2 s */
const LANE_SPRING = 20;
const AIR_OUT: Obstacle = { shape: { kind: 'sphere', x: 0, y: 0, along: 0, r: 0 }, tag: 'air', name: 'OUT OF AIR', nearMiss: false };


/** standing / sliding heights and hip heights: the runner, and Reveille (1.2 m tall standing proud, 0.55 flat) */
export const HUMAN_BODY = { stand: MOVE.standHeight, slide: MOVE.slideHeight, hip: 0.95, hipSlide: 0.5 };
export const DOG_BODY = { stand: 1.2, slide: 0.55, hip: 0.6, hipSlide: 0.33 };

export class Runner {
  /** feet position (run) or hip position (swim) in world space */
  readonly pos = new THREE.Vector3(0, 0.7, 0);
  vx = 0; vy = 0;
  /** forward speed over ground (m/s) including currents and surge */
  speed = 0;
  baseSpeed = 11.5;
  mode: RunnerMode = 'run';
  airborne = false;
  sliding = 0;            // seconds left
  /** height of the last deck underfoot (a pier gap is fallen through once you're well below it) */
  private deckY = 0;
  surgeT = 0; surgeCd = 0;
  invuln = 0;
  shield = 1;
  /** breath under water, 0..1 */
  air = 1;
  alive = true;
  distance = 0;
  /** posture height of the collision capsule */
  /** how fast the run speeds up with distance (1 normal; the demo uses less), matched by the course generator */
  pace = 1;
  /** the body's size: the runner's, or Reveille's when you play as her (lower, so some overheads she runs under) */
  frame = { ...HUMAN_BODY };
  get height() { return this.mode === 'swim' ? 0.9 : this.mode === 'ski' ? (this.sliding > 0 ? 0.85 : 1.45) : this.sliding > 0 ? this.frame.slide : this.frame.stand; }
  /** hip height above feet, for the camera / character */
  get hipY() { return this.mode === 'swim' ? this.pos.y : this.mode === 'ski' ? this.pos.y + (this.sliding > 0 ? 0.55 : 0.95) : this.pos.y + (this.sliding > 0 ? this.frame.hipSlide : this.frame.hip); }
  // ---------------- on the board (Shorebreak Point: the same lanes, jump and slide, on the water)
  /** slope of the water across x under the board (dy/dx), for its tilt */
  faceSlope = 0;
  private sprayT = 0;
  /** carving up the wave's face from the left lane, toward the lip */
  onWave = false;
  /** landed from a launch, carving back down the face to the lane */
  private descending = false;
  /** world z where this climb should leave the lip (an air spot's arc of coins starts there), or null: untimed */
  private launchZ: number | null = null;
  /** off the top of the wave: a big air with room for tricks */
  bigAir = false;
  airT = 0;
  /** board rotation in the air (rad); a trick lands on a whole turn */
  spin = 0;
  /** the backflip off the top of the wave (rad, 0 .. 2 pi over the air) */
  flip = 0;
  private spinTarget = 0;
  grab = false;
  readonly curVel = new THREE.Vector3();
  readonly water = { y: 0, depth: 0 };
  /** lean (-1..1) from lateral velocity, for the character and camera */
  lean = 0;
  stumble = 0;
  events: RunnerEvent[] = [];
  private acc = 0;
  private passes = new Map<string, Pass>();
  private tmp = new THREE.Vector3();
  private contact: Contact = { depth: 0, nx: 0, ny: 0, nz: 0 };
  private riskyAcc = 0; private riskyKey = ''; private riskyLen = 0;
  private ringStreak = 0;
  private slideHeldT = 0;
  private jumpBuf = 0; private slideBuf = 0; private sinceGround = 0;
  private wasGrounded = true;
  private groundY = 0;
  speedScale = 1;
  /** current lane 0..2 on foot (left, middle, right) */
  lane = 1;
  private prevLane = 1;
  private laneInit = false;
  private zone = 0;            // hand / sim zone: -1 left, 0 centre, 1 right
  private laneLock = 0;        // s during which lane input is ignored (carried by a current, bounced off an obstacle)
  private sweep = 0;
  private nearGroups = new Set<string>();

  reset(z = 0) {
    this.pos.set(0, 0.7, z); this.vx = 0; this.vy = 0; this.speed = 0; this.mode = 'run'; this.airborne = false; this.sliding = 0; this.jumpBuf = 0; this.slideBuf = 0; this.sinceGround = 0;
    this.surgeT = 0; this.surgeCd = 0; this.invuln = 0; this.shield = 1; this.air = 1; this.alive = true; this.distance = 0; this.events.length = 0;
    this.passes.clear(); this.riskyAcc = 0; this.riskyKey = ''; this.ringStreak = 0; this.lean = 0; this.stumble = 0; this.acc = 0; this.baseSpeed = speedAt(0);
    this.lane = 1; this.prevLane = 1; this.laneInit = true; this.zone = 0; this.laneLock = 0; this.sweep = 0; this.nearGroups.clear();
    this.faceSlope = 0; this.sprayT = 0; this.onWave = false; this.descending = false; this.bigAir = false; this.airT = 0; this.spin = 0; this.spinTarget = 0; this.grab = false; this.flip = 0;
  }

  update(dt: number, inp: InputState, world: ChunkManager, waterLevel: number, t: number) {
    if (!this.alive) return;
    this.acc += Math.min(dt, 0.1);
    // in slow motion a frame can pass without a physics step: presses wait for the next step instead of being lost
    const c = this.carry;
    if (c.jump) inp.jump = true; if (c.slide) inp.slide = true; if (c.surge) inp.surge = true; if (c.lane && !inp.laneDelta) inp.laneDelta = c.lane;
    let steps = 0;
    while (this.acc >= STEP && steps++ < 40) { this.step(STEP, inp, world, waterLevel, t); this.acc -= STEP; inp.jump = false; inp.slide = false; inp.surge = false; inp.laneDelta = 0; }
    if (steps === 0) { c.jump = inp.jump; c.slide = inp.slide; c.surge = inp.surge; c.lane = inp.laneDelta; }
    else { c.jump = c.slide = c.surge = false; c.lane = 0; }
  }
  private carry = { jump: false, slide: false, surge: false, lane: 0 };

  private step(dt: number, inp: InputState, world: ChunkManager, waterLevel: number, t: number) {
    const p = this.pos;
    const chunk = world.chunkAt(p.z);
    const width = chunk ? chunk.width : 8;
    // ---------------- speed
    this.baseSpeed = speedAt(this.distance * this.pace);
    this.surgeCd = Math.max(0, this.surgeCd - dt); this.surgeT = Math.max(0, this.surgeT - dt);
    this.invuln = Math.max(0, this.invuln - dt); this.stumble = Math.max(0, this.stumble - dt);
    if (inp.surge && this.surgeCd <= 0) { this.surgeT = MOVE.surgeTime; this.surgeCd = MOVE.surgeCooldown + MOVE.surgeTime; this.events.push({ kind: 'surge' }); }
    const cw = world.currentAt(p.x, this.hipY, p.z, this.tmp);
    this.curVel.lerp(this.tmp, 1 - Math.exp(-dt * (cw > 0 ? 3.5 : 2.0)));
    // the board: picked up at the water's edge (or wherever a surf chunk begins), let go where the wave ends (dive)
    // or where it runs up onto the sand (back to running)
    const along = chunk ? chunk.zStart - p.z : 0;
    if (chunk?.wave && (this.mode === 'run' || this.mode === 'surf') && (chunk.board?.mount !== undefined ? along >= chunk.board.mount : chunk.mode === 'board' && chunk.board?.dive === undefined)) this.mount();
    if (this.mode === 'board' && chunk) {
      if (chunk.board?.dive !== undefined && along >= chunk.board.dive) this.release(waterLevel);
      else if (chunk.board?.land !== undefined && along >= chunk.board.land) { this.mode = 'run'; this.onWave = false; this.events.push({ kind: 'release' }); }
      else if (!chunk.wave && chunk.mode !== 'board') this.release(waterLevel);
    }
    // the jet ski: on at the rental dock, off where you beach it (back to running) or ditch it over the reef (dive)
    if (chunk?.ski && (this.mode === 'run' || this.mode === 'surf' || this.mode === 'board') && (chunk.ski.mount !== undefined ? along >= chunk.ski.mount : chunk.mode === 'ski' && chunk.ski.dive === undefined && chunk.ski.land === undefined)) {
      this.mode = 'ski'; this.sliding = 0; this.laneInit = false; this.events.push({ kind: 'skiMount' });
    }
    if (this.mode === 'ski' && chunk) {
      if (chunk.ski?.dive !== undefined && along >= chunk.ski.dive) { this.events.push({ kind: 'skiOff' }); this.release(waterLevel); }
      else if (chunk.ski?.land !== undefined && along >= chunk.ski.land) {
        // pull up at the dock and hop off onto it
        this.mode = 'run'; this.airborne = true; this.vy = 4.6; this.sinceGround = 1; this.sliding = 0;
        this.events.push({ kind: 'skiOff' });
      }
      else if (!chunk.ski && chunk.mode !== 'ski') { this.events.push({ kind: 'skiOff' }); this.release(waterLevel); }
    }
    const modeScale = this.mode === 'surf' ? 0.93 : this.mode === 'swim' ? 0.9 : this.mode === 'ski' ? SKI_BOOST : 1;
    const stumbleScale = 1 - 0.45 * Math.min(1, this.stumble / 1.2);
    const target = this.baseSpeed * modeScale * stumbleScale * this.speedScale + (this.surgeT > 0 ? MOVE.surgeBoost : 0) + this.curVel.z;
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * 2.5));
    const dz = this.speed * dt;
    p.z -= dz; this.distance += dz;

    // ---------------- lateral
    if (this.mode === 'swim') {
      this.laneInit = false;
      // the hand aims at a spot across the canyon (position control); keys / sticks steer (rate control)
      const steer = inp.aim ? THREE.MathUtils.clamp((inp.aim.x * Math.min(width, 10.5) - p.x) / 2.2, -1, 1) : inp.steer;
      const latTarget = steer * MOVE.latSpeed * 0.95 + this.curVel.x;
      const dv = latTarget - this.vx;
      this.vx += Math.sign(dv) * Math.min(Math.abs(dv), MOVE.latAccel * dt);
      p.x += this.vx * dt;
      const lim = width + 0.4;
      if (p.x > lim) { p.x = lim; if (this.vx > 0) this.vx *= -0.25; } else if (p.x < -lim) { p.x = -lim; if (this.vx < 0) this.vx *= -0.25; }
    } else if (this.mode === 'ski') {
      // the jet ski: free across the channel. The hand / body is where you ride (position), keys steer (rate); the
      // ski banks into it and the sideways speed lags the stick a touch so it carves rather than snaps
      this.laneInit = false;
      const steer = inp.aim ? THREE.MathUtils.clamp((inp.aim.x * (width - 0.5) - p.x) / 2.2, -1, 1) : inp.steer;
      const target = steer * SKI_LAT + this.curVel.x;
      this.vx += (target - this.vx) * (1 - Math.exp(-dt * 7));
      const vx0 = this.vx;
      p.x += this.vx * dt;
      const lim = width + 0.3;
      if (p.x > lim) { p.x = lim; if (this.vx > 0) this.vx *= -0.3; } else if (p.x < -lim) { p.x = -lim; if (this.vx < 0) this.vx *= -0.3; }
      this.sprayT -= dt;
      if (Math.abs(vx0) > 6 && this.sprayT <= 0) { this.sprayT = 0.07; this.events.push({ kind: 'spray', k: Math.min(1, Math.abs(vx0) / SKI_LAT) }); }
    } else this.stepLanes(dt, inp, chunk, along);
    // (a lane change peaks near 18 m/s sideways; swimming tops out at latSpeed)
    const leanT = THREE.MathUtils.clamp(this.vx / (this.mode === 'swim' ? MOVE.latSpeed : this.mode === 'ski' ? SKI_LAT : 16), -1, 1);
    this.lean += (leanT - this.lean) * (1 - Math.exp(-dt * 10));
    // on the board a hard lane change throws a sheet of spray off the rail
    if (this.mode === 'board') { this.sprayT -= dt; if (Math.abs(this.vx) > 7 && this.sprayT <= 0) { this.sprayT = 0.08; this.events.push({ kind: 'spray', k: Math.min(1, Math.abs(this.vx) / 16) }); } }

    // ---------------- vertical: surface & water
    const ground = world.groundAt(p.x, p.z);
    let deck = world.floorAt(p.x, p.z);
    // on the board the water is the floor: the wave's surface over the sea level (which the tide moves)
    if (this.mode === 'board' && chunk?.wave) {
      const wy = waterLevel + waveY(chunk.wave, p.x, along);
      deck = deck === null ? wy : Math.max(deck, wy);
      this.faceSlope = (waveY(chunk.wave, p.x + 0.25, along) - waveY(chunk.wave, p.x - 0.25, along)) / 0.5;
    }
    if (this.mode === 'ski') deck = Math.max(deck ?? -1e9, waterLevel + 0.03);              // (the ski rides the water, and up a ramp's planks)
    const surface = deck ?? ground;
    this.groundY = surface;
    const depth = waterLevel - surface;
    this.water.y = waterLevel; this.water.depth = depth;
    const deckChunk = world.hasDeck(p.z);

    if (this.mode === 'swim') {
      // free 3D swimming between the seabed and the ceiling
      const floor = ground + MOVE.swimFloor, ceil = Math.min(waterLevel + MOVE.swimCeiling, world.ceilingAt(p.x, p.z) - MOVE.roofGap);
      const vert = inp.aim ? THREE.MathUtils.clamp((floor + (inp.aim.y * 0.5 + 0.5) * (ceil - floor) - p.y) / 1.6, -1, 1) : inp.vert;
      const vyT = vert * MOVE.swimVy + this.curVel.y;
      this.vy += (vyT - this.vy) * (1 - Math.exp(-dt * 6));
      p.y += this.vy * dt;
      if (p.y < floor) { p.y = floor; if (this.vy < 0) this.vy = 0; }
      if (p.y > ceil) { p.y += (ceil - p.y) * (1 - Math.exp(-dt * 10)); if (this.vy > 0) this.vy *= 0.5; }
      if (depth < 2.3) {
        // surfacing: back to surf mode, feet on the ground
        this.mode = 'surf'; p.y = surface; this.vy = 0; this.airborne = false;
        this.events.push({ kind: 'surface' });
      }
    } else {
      // land / shallow water: gravity, jump, slide, falls, dives
      // (on the board the water is never a ledge: carving down the wave's face you stay on it rather than hopping off)
      const grounded = !this.airborne && p.y <= surface + (this.mode === 'board' || this.mode === 'ski' ? 0.6 : 0.05);
      if (grounded) { p.y = surface; this.sinceGround = 0; } else this.sinceGround += dt;
      // forgiving input: a jump / slide pressed a moment early is kept until it can happen (buffer); a jump just after
      // running off an edge still counts (coyote time); a slide in the air slams you down and slides on landing
      if (inp.jump) this.jumpBuf = 0.15;
      if (inp.slide) { this.slideBuf = 0.25; if (this.airborne && this.vy > -JUMP_V) this.vy = -JUMP_V; }
      // sliding again while still down starts the slide over (a press for the next obstacle is never lost)
      if (inp.slide && this.sliding > 0 && grounded) { this.sliding = MOVE.slideTime; this.slideHeldT = 0; this.slideBuf = 0; }
      const canJump = this.sliding <= 0 && !this.onWave && (grounded || (this.sinceGround < 0.1 && this.vy <= 0));
      if (this.jumpBuf > 0 && canJump) { this.vy = JUMP_V; this.airborne = true; this.jumpBuf = 0; this.sinceGround = 1; this.events.push({ kind: 'jump' }); }
      if (this.slideBuf > 0 && grounded && this.sliding <= 0 && !this.airborne) { this.sliding = MOVE.slideTime; this.slideHeldT = 0; this.slideBuf = 0; this.events.push({ kind: 'slide' }); }
      this.jumpBuf = Math.max(0, this.jumpBuf - dt); this.slideBuf = Math.max(0, this.slideBuf - dt);
      if (this.sliding > 0) {
        this.sliding -= dt;
        if (inp.slideHeld && this.slideHeldT < 0.5) { this.slideHeldT += dt; this.sliding = Math.max(this.sliding, 0.2); }
        // never stand up into something: stay down while it's still overhead, and a slide pressed again chains on
        // without a standing frame in between
        if (this.sliding <= 0 && (this.slideBuf > 0 || this.overhead(world))) { this.sliding = this.slideBuf > 0 ? MOVE.slideTime : 0.05; this.slideBuf = 0; }
      }
      if (deck !== null) this.deckY = deck;
      if (this.airborne && this.bigAir) {
        // off the top of the wave: a backflip and a 360 on their own (slowed down through the top of the arc, see main),
        // a tap left / right (or a hand held to a side) adds a turn, jump grabs the rail; near the water the spin is
        // helped round to the nearest whole turn and the flip finishes
        this.airT += dt;
        const near = this.vy < 0 && p.y - surface < 1.2;
        const fu = Math.min(1, Math.max(0, (this.airT - 0.06) / 0.9));
        this.flip = near ? Math.min(Math.PI * 2, this.flip + dt * 14) : Math.max(this.flip, Math.PI * 2 * fu * fu * (3 - 2 * fu));
        const byZone = inp.source === 'hand' || inp.source === 'sim';
        const want = inp.laneDelta !== 0 ? Math.sign(inp.laneDelta) : byZone && Math.abs(inp.steer) > 0.55 ? Math.sign(inp.steer) : 0;
        if (want && Math.abs(this.spinTarget - this.spin) < Math.PI * 0.6) this.spinTarget += want * Math.PI * 2;
        if (near) this.spinTarget = Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2;
        const rem = this.spinTarget - this.spin;
        this.spin += Math.sign(rem) * Math.min(Math.abs(rem), SPIN * dt);
        if (inp.jump && this.airT > 0.05) this.grab = true;
        this.jumpBuf = 0;
      }
      if (this.airborne || p.y > surface + 0.05) {
        this.vy -= G * dt;
        p.y += this.vy * dt;
        // over a hole in the deck: once your feet are well below the deck you came off, you've gone through (running
        // across without jumping used to dip for a moment and land on the far side, since the water is metres down)
        if (deckChunk && deck === null && depth > 2.2 && p.y < this.deckY - 0.35) this.fall(world);
        else if (!deckChunk && depth > 2.3 && p.y <= waterLevel - 0.25 && this.vy <= 0) {
          // hit deep water: dive at the surface (never fall through the water column)
          p.y = waterLevel - 1.4; this.mode = 'swim'; this.vy = Math.min(-1.5, this.vy * 0.5); this.airborne = false; this.events.push({ kind: 'dive' });
        } else if (p.y <= surface && this.vy <= 0) {
          if (deckChunk && deck === null && depth > 2.2) {
            // fell through a pier gap
            this.fall(world);
          } else if (!deckChunk && depth > 2.3) {
            // deep water below: dive
            p.y = waterLevel - 1.4; this.mode = 'swim'; this.vy = -1.5; this.airborne = false; this.events.push({ kind: 'dive' });
          } else {
            p.y = surface; this.vy = 0; this.airborne = false;
            if (this.mode !== 'board' && this.mode !== 'ski') this.mode = depth > 0.12 ? 'surf' : 'run';
            this.events.push({ kind: 'land', surf: this.mode !== 'run' });
            if (this.bigAir) this.landTrick();
          }
        }
      } else {
        // walking the surface: follow slopes; drop off edges
        if (deckChunk && deck === null && depth > 2.2) this.fall(world);
        else if (!deckChunk && depth > 2.3) { this.airborne = true; this.vy = 0; }           // walked into deep water: fall in, then dive
        else {
          p.y = surface;
          const m: RunnerMode = depth > 0.12 ? 'surf' : 'run';
          if (m !== this.mode && this.mode !== 'board' && this.mode !== 'ski') this.mode = m;
        }
      }
      this.wasGrounded = grounded;
    }

    // ---------------- obstacles: collision + near misses
    if (chunk) this.collide(world, t);
    // ---------------- pearls
    for (const { chunk: c, lp } of world.pearlsNear(p.z)) {
      const pz = c.zStart - lp.pearl.along;
      const hy = this.hipY;
      // on foot the height window is tight, so a jump carries you over the coin line (and catches the arcs instead)
      if (Math.abs(lp.pearl.x - p.x) < 1.2 && Math.abs(lp.pearl.y - hy) < (this.mode === 'swim' ? 1.6 : MOVE.pickupY) && Math.abs(pz - p.z) < 1.2) {
        world.takePearl(c, lp);
        this.events.push({ kind: 'pearl', value: lp.pearl.value, risky: !!lp.pearl.risky });
      }
    }
    // ---------------- reef gates: threading a hole (twin gates have two rings at the same along; one counts)
    if (chunk?.rings) {
      const along = chunk.zStart - p.z, prev = along - dz;
      let crossed = false, threaded = false;
      for (const g of chunk.rings) if (prev < g.along && along >= g.along) { crossed = true; if (Math.hypot(p.x - g.x, this.hipY - g.y) < g.r + 0.2) threaded = true; }
      if (threaded) { this.ringStreak++; this.air = 1; this.events.push({ kind: 'ring', streak: this.ringStreak }); }
      else if (crossed) this.ringStreak = 0;
    }
    // ---------------- air: drains under water, refilled by gate holes (above) or by surfacing. Running out costs the
    // shield (and leaves a little breath to reach the next hole) or the run.
    if (this.mode === 'swim' && this.alive) {
      const before = this.air;
      this.air = Math.max(0, this.air - dt / MOVE.airTime);
      if (before >= MOVE.airLow && this.air < MOVE.airLow) this.events.push({ kind: 'airLow' });
      if (this.air <= 0) {
        this.events.push({ kind: 'airOut' });
        this.invuln = 0; this.hit(AIR_OUT);
        this.air = 0.45;
      }
    } else this.air = Math.min(1, this.air + dt * 0.8);
    // ---------------- risky line tracking
    if (chunk?.riskyLine) {
      const r = chunk.riskyLine, along = chunk.zStart - p.z;
      const key = `${chunk.id}`;
      if (this.riskyKey !== key) { this.riskyKey = key; this.riskyAcc = 0; this.riskyLen = r.along1 - r.along0; }
      if (along >= r.along0 && along <= r.along1 && p.x >= Math.min(r.x0, r.x1) && p.x <= Math.max(r.x0, r.x1)) this.riskyAcc += dz;
      if (along > r.along1 && this.riskyAcc > 0) {
        if (this.riskyAcc > this.riskyLen * 0.7) this.events.push({ kind: 'risky', bonus: r.bonus });
        this.riskyAcc = 0;
      }
    }
  }

  private setLane(n: number, lock = 0) {
    n = Math.max(0, Math.min(2, n));
    if (n !== this.lane) { this.prevLane = this.lane; this.lane = n; }
    if (lock) this.laneLock = Math.max(this.laneLock, lock);
  }

  /** on foot: lanes. Keyboard taps step one lane; the hand (and the test bot) choose a lane by zone. */
  private stepLanes(dt: number, inp: InputState, chunk: Chunk | null, along: number) {
    const p = this.pos;
    if (!this.laneInit) { this.lane = this.prevLane = laneOf(p.x); this.zone = this.lane - 1; this.laneInit = true; }
    this.laneLock = Math.max(0, this.laneLock - dt);
    // up the wave (on the board, anywhere it stands tall): from the left lane, left once more (a hand / body far to the
    // left: steer -2) carves you up the face, and at the lip you launch (see below); right on the way up bails out.
    // Off the top, left / right spin you instead of changing lanes (see the air in step)
    const w = this.mode === 'board' && chunk?.mode === 'board' ? chunk.wave : undefined;
    const canClimb = !!w && w.h(along) > 3 && !chunk!.noAir?.some(([a0, a1]) => along > a0 && along < a1);
    if (this.onWave && !canClimb) this.onWave = false;
    const flying = this.airborne && this.bigAir;
    if (this.laneLock <= 0 && !flying) {
      const byZone = inp.source === 'hand' || inp.source === 'sim';
      if (this.onWave) {
        if (inp.laneDelta > 0 || (byZone && inp.steer >= 0)) { this.onWave = false; this.zone = -1; }
      } else if (canClimb && this.lane === 0 && !this.airborne && (inp.laneDelta < 0 || (byZone && inp.steer < -1.5))) {
        this.onWave = true; this.events.push({ kind: 'spray', k: 0.8 });
        // an air spot's arc of coins just ahead: time the climb to leave the lip where the arc starts
        const s = chunk!.airAt?.find((a) => a - along > AIR_REACH[0] * this.speed && a - along < AIR_REACH[1] * this.speed);
        this.launchZ = s !== undefined ? chunk!.zStart - s : null;
      } else if (inp.laneDelta) { this.setLane(this.lane + inp.laneDelta); this.zone = this.lane - 1; }
      else if (byZone) {
        // left / centre / right zones with hysteresis so a hand near a border doesn't flicker between lanes
        const st = inp.steer, z = this.zone;
        let nz = z;
        if (st < -0.4) nz = -1; else if (st > 0.4) nz = 1;
        else if ((z === -1 && st > -0.22) || (z === 1 && st < 0.22)) nz = 0;
        this.zone = nz;
        if (nz + 1 !== this.lane) this.setLane(nz + 1);
      }
    }
    if (this.onWave && w) {
      // carving up the face, faster and faster (toward an air spot: just fast enough to reach the lip where its arc
      // starts); at the lip, launched
      const lipX = w.crest(along) + LIP_PAD + 0.15;
      let target = -WAVE_CLIMB;
      if (this.launchZ !== null) target = -THREE.MathUtils.clamp((p.x - lipX) / Math.max(0.05, (p.z - this.launchZ) / Math.max(4, this.speed)), 7, 24);
      this.vx += (target - this.vx) * (1 - Math.exp(-dt * (this.launchZ !== null ? 10 : 7)));
      p.x += this.vx * dt;
      if (p.x <= lipX) this.launch();
      return;
    }
    if (flying) { p.x += this.vx * dt; return; }                 // off the lip: drifting back over the face
    // a lateral current carries you a lane over (and holds you there for a moment)
    if (Math.abs(this.curVel.x) > 0.6) {
      this.sweep += this.curVel.x * dt;
      if (Math.abs(this.sweep) > LANE_W * 0.9) {
        const dir = Math.sign(this.sweep);
        const before = this.lane;
        this.setLane(this.lane + dir, 0.6);
        if (this.lane !== before) this.events.push({ kind: 'swept', dir });
        this.sweep = 0;
      }
    } else this.sweep *= Math.exp(-dt * 2);
    // glide to the lane centre on a critically damped spring: eases out and in, never overshoots, and covers 90 % of
    // a lane in ~laneTime (a new lane mid-move just bends the curve, no snap)
    const dx = LANES[this.lane] - p.x, k = LANE_SPRING;
    if (this.descending && Math.abs(dx) > 0.3) {
      // back down the face after a launch: a carve that builds up and eases out into the lane, not a spring's snap
      const want = THREE.MathUtils.clamp(dx * 3, -13, 13);
      this.vx += (want - this.vx) * (1 - Math.exp(-dt * 5));
    } else {
      this.descending = false;
      this.vx += (k * k * dx - 2 * k * this.vx) * dt;
      if (this.mode === 'board') this.vx = THREE.MathUtils.clamp(this.vx, -16, 16);
    }
    p.x += this.vx * dt;
  }

  private fall(world: ChunkManager) {
    this.events.push({ kind: 'fall' });
    this.hit(null);
    if (this.alive) {
      // put the runner back on the deck just past the gap
      const p = this.pos;
      for (let d = 0; d < 12; d += 0.5) { const f = world.floorAt(0, p.z - d); if (f !== null) { p.z -= d + 0.3; p.x = 0; this.lane = this.prevLane = 1; this.zone = 0; p.y = f; break; } }
      this.vy = 0; this.airborne = false;
    }
  }

  private body: Body = { x: 0, y: 0, along: 0, height: 1.75, radius: MOVE.radius };

  private collide(world: ChunkManager, t: number) {
    const p = this.pos;
    const b = this.body;
    b.x = p.x; b.radius = MOVE.radius; b.height = this.height;
    const hip = this.hipY;
    b.y = this.mode === 'swim' ? hip - b.height / 2 : p.y;
    for (const { chunk: c, ob, index } of world.obstaclesNear(p.z, 4)) {
      if (ob.phantom) continue;
      const s = ob.shape;
      const along = c.zStart - p.z;
      const ext = alongExtent(s) + 1.6;
      if (Math.abs(s.along - along) > ext) continue;
      b.along = along;
      const bobY = ob.bob ? Math.sin(t * ob.bob.freq * 6.283 + ob.bob.phase) * ob.bob.amp : 0;
      const d = capsuleClearance(b, s, bobY, this.contact);
      const key = `${c.id}:${index}`;
      let pass = this.passes.get(key);
      if (!pass && d < 1.0 && ob.nearMiss !== false) { pass = { key, min: d, hit: false, ob, chunk: c }; this.passes.set(key, pass); }
      if (pass) pass.min = Math.min(pass.min, d);
      if (d < 0) {
        // on the ski: a wake throws you up for a moment, a ramp launches you into a big air (a flip)
        if (this.mode === 'ski' && (ob.tag === 'wake' || ob.tag === 'ramp')) {
          if (!this.airborne) {
            this.airborne = true; this.sinceGround = 1; this.sliding = 0;
            if (ob.tag === 'ramp') { this.vy = LIP_VY * 0.95; this.bigAir = true; this.airT = 0; this.spin = 0; this.spinTarget = Math.PI * 2; this.grab = false; this.flip = 0; this.events.push({ kind: 'launch' }); }
            else { this.vy = WAKE_VY; this.events.push({ kind: 'wakeHop' }); }
          }
          continue;
        }
        if (ob.lethal === false) { this.slow(Math.exp(-2 * STEP * 60 * 0.02)); if (pass) pass.hit = true; continue; }
        // push out
        const n = this.contact;
        const depth = -d + 0.01;
        p.x += n.nx * depth;
        // on foot, running into the side of something while changing lanes bounces you back with a stumble
        const changing = this.mode !== 'swim' && this.mode !== 'ski' && Math.abs(p.x - LANES[this.lane]) > 0.15;
        if (changing && Math.abs(n.nx) > Math.abs(n.nz) + 0.2) {
          if (this.laneLock <= 0.3) { this.setLane(this.prevLane, 0.4); this.stumble = Math.max(this.stumble, 0.7); this.speed *= 0.85; this.vx *= -0.3; this.events.push({ kind: 'bump' }); }
          if (pass) pass.hit = true;
          continue;
        }
        if (this.mode === 'swim') { p.y += n.ny * depth; this.vy = Math.max(this.vy, 0) * (n.ny > 0 ? 1 : 0); }
        if (pass) pass.hit = true;
        if (ob.group) this.nearGroups.add(ob.group);
        if (this.invuln <= 0) this.hit(ob);
        if (!this.alive) return;
      }
    }
    // resolve finished passes (the obstacle is now behind the player)
    for (const pass of this.passes.values()) {
      const along = pass.chunk.zStart - p.z;
      if (along > pass.ob.shape.along + alongExtent(pass.ob.shape) + 0.8 || pass.chunk.live === undefined) {
        this.passes.delete(pass.key);
        const g = pass.ob.group;
        if (g && this.nearGroups.has(g)) continue;                 // one near miss per arch / rib, not one per piece
        if (!pass.hit && pass.min < 0.6 && this.invuln <= 0) { if (g) this.nearGroups.add(g); this.events.push({ kind: 'near', closeness: 1 - Math.max(0, pass.min) / 0.6, ob: pass.ob }); }
      }
    }
  }

  /** is something low overhead here or just ahead (standing up would hit it within ~0.12 s)? */
  private overhead(world: ChunkManager) {
    const p = this.pos, b = this.body, ahead = Math.max(0.5, this.speed * 0.12);
    b.x = p.x; b.y = p.y; b.radius = MOVE.radius; b.height = this.frame.stand;
    for (const { chunk: c, ob } of world.obstaclesNear(p.z, 4 + ahead)) {
      const s = ob.shape;
      if (s.kind !== 'box' || ob.lethal === false || s.y - p.y < this.frame.slide) continue;
      for (let k = 0; k <= ahead + 1e-6; k += 0.5) {
        b.along = c.zStart - p.z + k;
        if (capsuleClearance(b, s, 0, this.contact) < 0.05) return true;
      }
    }
    return false;
  }

  /** lose a share of your speed */
  private slow(f: number) { this.speed *= f; }

  // ---------------------------------------------------------------- Shorebreak Point: on the board
  private mount() {
    this.mode = 'board'; this.sliding = 0; this.sprayT = 0;
    this.events.push({ kind: 'mount' });
  }

  /** off the top of the wave: straight up over the lip, drifting back over the face, the board free to spin */
  private launch() {
    this.onWave = false; this.launchZ = null; this.setLane(0); this.zone = -1;
    this.airborne = true; this.vy = LIP_VY; this.vx = LIP_DRIFT; this.sinceGround = 1; this.sliding = 0;
    this.bigAir = true; this.airT = 0; this.spin = 0; this.spinTarget = Math.PI * 2; this.grab = false; this.flip = 0;
    this.events.push({ kind: 'launch' });
  }

  /** touching down from the big air: a whole number of turns is a trick; half way round is a stumble */
  private landTrick() {
    const turns = Math.round(this.spin / (Math.PI * 2)), off = Math.abs(this.spin - turns * Math.PI * 2);
    const n = Math.abs(turns), grab = this.grab, air = this.airT, flipped = this.flip > Math.PI * 1.5;
    this.bigAir = false; this.spin = 0; this.spinTarget = 0; this.grab = false; this.airT = 0; this.flip = 0; this.descending = true;
    if (off < 1.1) {
      const name = [flipped ? 'BACKFLIP' : '', n ? `${n * 360}` : '', grab ? 'GRAB' : ''].filter(Boolean).join(' ') || 'AIR';
      this.events.push({ kind: 'trick', name, points: Math.round(100 + (flipped ? 200 : 0) + 150 * n + (grab ? 90 : 0) + 60 * air), clean: true });
    } else { this.stumble = Math.max(this.stumble, 0.9); this.slow(0.75); this.events.push({ kind: 'trick', name: 'SKETCHY', points: 0, clean: false }); }
  }

  /** the wave's done: let the board go and dive */
  private release(waterLevel: number) {
    this.onWave = false; this.descending = false; this.bigAir = false; this.spin = 0; this.spinTarget = 0; this.grab = false; this.flip = 0;
    this.mode = 'swim'; this.pos.y = waterLevel - 1.4; this.vy = -1.5; this.airborne = false; this.sliding = 0;
    this.events.push({ kind: 'release' }, { kind: 'dive' });
  }

  private hit(ob: Obstacle | null) {
    if (this.invuln > 0) return;
    if (this.shield > 0) {
      this.shield--; this.invuln = 2.0; this.stumble = 1.2; this.slow(0.55);
      this.events.push({ kind: 'hit', ob, fatal: false, shielded: true });
    } else {
      this.alive = false;
      this.events.push({ kind: 'hit', ob, fatal: true, shielded: false });
    }
  }

  /** a hit from something outside the chunk obstacles (crabs, gulls): the shield takes it first, as usual */
  hurt(name: string) { this.hit({ shape: { kind: 'sphere', x: 0, y: 0, along: 0, r: 0 }, tag: 'critter', name, nearMiss: false }); }

  /** standing surface under the feet (for the character) */
  get surfaceY() { return this.groundY; }
  get grounded() { return this.wasGrounded; }
}
