import { Rng } from '../core/rng';
import { PATTERNS } from './patterns';
import { validateChunk, type SwimExit, type LaneExit, type SkiExit } from './validate';
import { settlePearls } from './pearls';
export { pearlViolations } from './pearls';
export { MOVE, speedAt } from './types';     // (for tools/gentest.mjs)
export { validateChunk } from './validate';
export { waveY } from './wave';            // (for tools/gentest.mjs)
import { speedAt, tierAt, type Biome, type Chunk, type Pattern, type PatternCtx, type TidePhase } from './types';
import { DEMO_COURSE, DEMO_COURSE_LAND } from './demo';

/**
 * Seeded, grammar-constrained course generator.
 *  - Biomes persist for a few chunks, then move along allowed edges through transition patterns.
 *  - The tide counter runs 1..12; step 12 is the 12th Tide surge (3 chunks) and steps 9-11 are the rising tide.
 *  - Every chunk is validated for a reachable route; failing builds are retried easier, then replaced by a calm chunk.
 *  - A set course (`script`, e.g. the demo's) plays its sections in order first, gentler, then the course runs on.
 */
const STAY: Record<Biome, [number, number]> = { beach: [2, 4], pier: [2, 3], lagoon: [2, 3], coral: [3, 5], grotto: [2, 3], surf: [2, 3], ski: [2, 3] };
const EDGES: Record<Biome, { to: Biome; w: number; minTier?: number }[]> = {
  beach: [{ to: 'pier', w: 0.3 }, { to: 'surf', w: 0.3 }, { to: 'coral', w: 0.25 }, { to: 'ski', w: 0.25 }],
  pier: [{ to: 'coral', w: 0.4 }, { to: 'surf', w: 0.3 }, { to: 'ski', w: 0.4 }],
  ski: [{ to: 'beach', w: 0.5 }, { to: 'coral', w: 0.5 }],
  lagoon: [{ to: 'beach', w: 1 }],        // (the lagoon was removed; nothing leads here)
  coral: [{ to: 'grotto', w: 0.45, minTier: 2 }, { to: 'beach', w: 0.55 }],
  grotto: [{ to: 'coral', w: 1 }],
  surf: [{ to: 'coral', w: 0.6 }, { to: 'beach', w: 0.4 }],
};

export interface GenStats { built: number; retries: number; fallbacks: number; invalidReasons: string[]; pearls: { kept: number; lifted: number; shifted: number; dropped: number } }

/** obstacle spacing with a camera control (body, head or hand): 30 % more room than on the keyboard */
export const CAMERA_SPACING = 1.3;

export class CourseGenerator {
  private rng: Rng;
  private seq = 0;
  private distance = 0;
  private biome: Biome = 'beach';
  private stay = 0;
  private tideStep = 0;
  private queue: Pattern[] = [];
  private lastId = '';
  private pendingBiomeAfterSurge: Biome | null = null;
  /** where a swimmer can be at the end of the last chunk if it was under water (the next one is checked from there) */
  private swimExit: SwimExit | null = null;
  /** on foot: the last jump / slide in each lane of the last chunk (the next one keeps clear of it) */
  private laneExit: LaneExit | null = null;
  /** on the jet ski: where across the channel you can be at the end of the last chunk */
  private skiExit: SkiExit | null = null;
  readonly stats: GenStats = { built: 0, retries: 0, fallbacks: 0, invalidReasons: [], pearls: { kept: 0, lifted: 0, shifted: 0, dropped: 0 } };
  /** chunks the player has not yet reached; used by the tide HUD */
  /** a set course to play first: [pattern id, tide count (12 = the 12th Tide)] */
  private script: [string, number][] | null;
  private scriptI = 0;
  /** land only (playing as Reveille): beach, pier and Shorebreak Point, never a dive */
  /** `pace`: the speed curve runs over distance x pace (the demo speeds up more slowly; the runner uses the same) */
  constructor(readonly seed: string, private readonly debug = false, private readonly tutorial = false, readonly spacing = 1, script: [string, number][] | 'demo' | null = null, readonly land = false, readonly pace = 1) {
    this.rng = new Rng(seed);
    this.stay = this.rng.int(STAY.beach[0], STAY.beach[1]);
    this.script = script === 'demo' ? (land ? DEMO_COURSE_LAND : DEMO_COURSE) : script;
  }
  /** still on the set course */
  get scripted() { return !!this.script && this.scriptI < this.script.length; }

  get currentBiome() { return this.biome; }

  /** Tide phase for the chunk at tideStep (1-based). */
  static phase(step: number): TidePhase { return step >= 12 ? 'surge' : step >= 9 ? 'rising' : 'calm'; }

  next(): Chunk {
    const seq = this.seq++;
    const tier = tierAt(this.distance);
    const speed = speedAt((this.distance + 60) * this.pace);
    let pattern: Pattern;
    let tidePhase: TidePhase;

    const fromScript = this.scripted;
    if (fromScript) {
      // the set course: its sections in order, with the tide it gives them; then the course runs on from where it ends
      const [id, step] = this.script![this.scriptI++];
      pattern = PATTERNS.find((p) => p.id === id)!;
      if (!pattern) throw new Error(`set course: no pattern ${id}`);
      tidePhase = step >= 12 ? 'surge' : CourseGenerator.phase(step);
      if (step < 12) this.tideStep = step;
      this.biome = pattern.to;
      if (!this.scripted) this.stay = this.rng.int(STAY[this.biome][0], STAY[this.biome][1]);
    } else if (this.queue.length) {
      pattern = this.queue.shift()!;
      tidePhase = 'surge';
      if (!this.queue.length && this.pendingBiomeAfterSurge) { this.biome = this.pendingBiomeAfterSurge; this.pendingBiomeAfterSurge = null; this.stay = this.rng.int(1, 2); this.tideStep = 0; }
    } else {
      this.tideStep++;
      tidePhase = CourseGenerator.phase(this.tideStep);
      if (seq === 0) pattern = PATTERNS.find((p) => p.id === (this.tutorial ? 'beach_tutorial' : 'beach_intro'))!;
      else if (this.tideStep >= 12 && this.biome === 'surf') {
        // THE 12TH TIDE at Shorebreak Point: the big wave full of wreckage, then it closes out into the rip and you dive
        pattern = PATTERNS.find((p) => p.id === 's_surf_big')!;
        this.queue.push(PATTERNS.find((p) => p.id === (this.land ? 't_surf_beach' : 't_surf_dive'))!);
        this.pendingBiomeAfterSurge = this.land ? 'beach' : 'coral';
      } else if (this.tideStep >= 12 && this.biome === 'ski') {
        // THE 12TH TIDE on the channel: a storm of wakes, then you beach the ski (land) or ditch it over the reef
        pattern = PATTERNS.find((p) => p.id === 's_ski_storm')!;
        this.queue.push(PATTERNS.find((p) => p.id === (this.land ? 't_ski_beach' : 't_ski_dive'))!);
        this.pendingBiomeAfterSurge = this.land ? 'beach' : 'coral';
      } else if (this.tideStep >= 12) {
        // THE 12TH TIDE: arrive + one flood/rip chunk, then the biome resets to open water
        const land = this.biome === 'beach' || this.biome === 'pier';
        const arrive = PATTERNS.find((p) => p.id === (land ? `s_arrive_${this.biome}` : `s_rip_${this.biome}`))!;
        const second = land ? this.rng.pick(PATTERNS.filter((p) => p.id === 's_flood_a' || p.id === 's_flood_b')) : PATTERNS.find((p) => p.id === 's_rip_b')!;
        pattern = arrive;
        this.queue.push(second);
        this.pendingBiomeAfterSurge = land ? 'beach' : 'coral';
      } else if (this.stay <= 0) {
        const edges = EDGES[this.biome].filter((e) => (e.minTier ?? 0) <= tier && !(this.land && (e.to === 'coral' || e.to === 'grotto')));
        const to = this.rng.weighted(edges, (e) => e.w)!.to;
        const cands = PATTERNS.filter((p) => p.role === 'transition' && p.from === this.biome && p.to === to && p.tiers[0] <= tier);
        pattern = this.rng.pick(cands);
        this.biome = to;
        this.stay = this.rng.int(STAY[to][0], STAY[to][1]);
      } else {
        const cands = PATTERNS.filter((p) => (p.role ?? 'normal') === 'normal' && p.biome === this.biome && p.tiers[0] <= tier && p.tiers[1] >= tier && p.weight > 0);
        const notLast = cands.filter((p) => p.id !== this.lastId);
        pattern = this.rng.weighted(notLast.length ? notLast : cands, (p) => p.weight)!;
        // at Shorebreak Point the rip channel likes to be the last section before you leave the surf
        const rip = cands.find((p) => p.id === 'surf_rip');
        if (rip && this.stay === 1 && this.lastId !== 'surf_rip' && this.rng.chance(0.5)) pattern = rip;
        // and the Kraken's chamber is the last thing in the grotto (never twice in a row)
        const kraken = cands.find((p) => p.id === 'grotto_kraken');
        if (kraken) pattern = this.stay === 1 && this.lastId !== 'grotto_kraken' && this.rng.chance(0.8) ? kraken : pattern.id === 'grotto_kraken' ? this.rng.pick(notLast.filter((p) => p.id !== 'grotto_kraken')) ?? pattern : pattern;
        this.stay--;
      }
    }
    // (the set course is gentler: a presenter on the camera should get all the way through it)
    const chunk = this.buildValidated(pattern, seq, fromScript ? Math.min(tier, 1) : tier, speed, tidePhase, fromScript);
    this.lastId = pattern.id;
    this.distance += chunk.length;
    return chunk;
  }

  private buildValidated(pattern: Pattern, seq: number, tier: number, speed: number, tide: TidePhase, gentle = false): Chunk {
    const zStart = -this.distance;
    const tierSpan = [250, 450, 700, 1000, 2000][tier];
    const tierStart = [0, 250, 700, 1400, 2400][tier];
    let difficulty = Math.min(gentle ? 0.4 : 1, (this.distance - tierStart) / tierSpan) + (tide === 'rising' ? 0.15 : 0);
    const mirrored = this.rng.chance(0.5);
    const salt = this.rng.int(0, 1e9);
    let data = null as ReturnType<Pattern['build']> | null;
    let exit: SwimExit | null = null, lanes: LaneExit | null = null, ski: SkiExit | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const ctx: PatternCtx = { rng: new Rng(`${this.seed}:${seq}:${salt}:${attempt}`), difficulty: Math.max(0, Math.min(1, difficulty)), tier, mirrored, tide, speed, spacing: this.spacing, length: pattern.length, zStart };
      const built = pattern.build(ctx);
      const v = validateChunk(built, pattern.mode, pattern.length, speed, this.swimExit, this.laneExit, this.skiExit);
      this.stats.built++;
      if (v.ok) { data = built; exit = v.exit ?? null; lanes = v.lanes ?? null; ski = v.ski ?? null; break; }
      this.stats.retries++;
      if (this.debug) this.stats.invalidReasons.push(`${pattern.id}@${seq}: ${v.reason}`);
      difficulty -= 0.25;
    }
    if (!data) {
      // never ship an impossible chunk: fall back to the biome's calm pattern (or the pattern itself with no obstacles)
      this.stats.fallbacks++;
      const calm = PATTERNS.find((p) => p.id === `${pattern.biome}_calm` || p.id === `${pattern.biome}_open_safe`);
      const ctx: PatternCtx = { rng: new Rng(`${this.seed}:${seq}:calm`), difficulty: 0, tier, mirrored, tide, speed, spacing: this.spacing, length: (calm ?? pattern).length, zStart };
      data = (calm ?? pattern).build(ctx);
      if (!calm || pattern.role === 'transition' || pattern.role === 'surge') { data = pattern.build(ctx); data.obstacles = []; }
      else pattern = calm;
      // (nothing in the way, so it passes from anywhere; this just works out where it leaves you)
      const fv = validateChunk(data, pattern.mode, pattern.length, speed, this.swimExit, null, null);
      exit = fv.exit ?? null; lanes = fv.lanes ?? null; ski = fv.ski ?? null;
    }
    // where a swimmer can be at the end of this chunk; the next under-water chunk starts from here
    this.swimExit = pattern.mode === 'swim' ? exit : null;
    this.laneExit = pattern.mode === 'run' || pattern.mode === 'board' ? lanes : null;
    this.skiExit = pattern.mode === 'ski' ? ski : null;
    // coins never sit inside an obstacle or a solid prop
    const s = settlePearls(data, pattern.mode);
    this.stats.pearls.kept += s.kept; this.stats.pearls.lifted += s.lifted; this.stats.pearls.shifted += s.shifted; this.stats.pearls.dropped += s.dropped;
    return {
      ...data, id: seq, seq, biome: pattern.biome, toBiome: pattern.to, mode: pattern.mode, patternId: pattern.id, length: pattern.length, zStart, tier, mirrored, tide,
      tideStep: tide === 'surge' ? 12 : this.tideStep,
    };
  }
}
