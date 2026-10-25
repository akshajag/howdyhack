import type { Rng } from '../core/rng';

/**
 * Course data model. The course is a straight run along three.js -Z. Chunk-local "along" increases in the direction
 * of travel, so world z = chunk.zStart - along. Lateral x is shared between local and world space. Heights are world y
 * (water surface is y = 0).
 */
export type Mode = 'run' | 'surf' | 'swim' | 'board' | 'ski';
export type Biome = 'beach' | 'pier' | 'lagoon' | 'coral' | 'grotto' | 'surf' | 'ski';
export type TidePhase = 'calm' | 'rising' | 'surge';

export type Shape =
  | { kind: 'box'; x: number; y: number; along: number; sx: number; sy: number; sz: number; yaw?: number }   // centre + full sizes (sy from y upward: box spans y..y+sy)
  | { kind: 'sphere'; x: number; y: number; along: number; r: number };

/** one of the Kraken's attacks: where (along the chamber), which, and from which side (-1 left, 1 right) */
export interface KrakenAttack { along: number; kind: 'slam' | 'sweep' | 'pincer' | 'grab' | 'wall'; side: number; high?: boolean }

export interface Obstacle {
  shape: Shape;
  /** art tag for feedback ('rock', 'wood', 'coral', 'jelly', 'net', 'barrel'...). */
  tag: string;
  /** what the run-over screen says when this ends a run ('TRIPPED ON A LOG'); falls back to one per tag */
  name?: string;
  /** hitting it counts as a hit (default true); false = soft brush (kelp) that only slows */
  lethal?: boolean;
  /** eligible for near-miss scoring (default true) */
  nearMiss?: boolean;
  /** gentle bobbing (jellyfish) */
  bob?: { amp: number; freq: number; phase: number };
  /** not solid (yet): the Kraken's telegraphed strike. The runner passes through it; the test bot plans round it */
  phantom?: boolean;
  /** this obstacle belongs to the risky line; passing it cleanly pays extra */
  risky?: boolean;
  /** pieces of one prop (an arch's rectangles) share a group so a pass scores one near miss, not several */
  group?: string;
}

export interface Prop {
  kit: string;
  x: number; y: number; along: number;
  yaw: number; scale: number;
  /** per-instance tint multiplier */
  tint?: [number, number, number];
  /** pitch/roll in radians for lying pieces */
  pitch?: number; roll?: number;
  /** extra vertical stretch (multiplies scale on y) */
  sy?: number;
}

/** A band of moving water. Inside it the player is pushed by (vx, vy, vAlong) m/s, feathered at the edges. */
export interface Current {
  x0: number; x1: number; along0: number; along1: number;
  y0?: number; y1?: number;
  vx: number; vy: number; vAlong: number;
  /** visualised as a stream (default true) */
  visible?: boolean;
  /** a gate hole's slipstream: every route through the gate goes through it (the validator counts its speed) */
  jet?: boolean;
}

export interface Pearl { x: number; y: number; along: number; value: number; risky?: boolean }

/** A hole in the walkable surface (pier gaps). Standing over it on the ground = fall. */
export interface Gap { along0: number; along1: number; x0: number; x1: number }

export type ChunkEventKind = 'zone' | 'surgeExit' | 'tide12';
export interface ChunkEvent { kind: ChunkEventKind; along: number; label?: string; sub?: string }

export interface Connector { mode: Mode; width: number; groundY: number }

/** Everything a pattern authors. Positions are chunk-local. */
export interface ChunkData {
  obstacles: Obstacle[];
  props: Prop[];
  currents: Current[];
  pearls: Pearl[];
  gaps: Gap[];
  events: ChunkEvent[];
  /** world height of the ground at (x, along) */
  ground: (x: number, along: number) => number;
  /** the surface the player runs/surfs on, if different from the visual ground (pier deck) */
  floor?: (x: number, along: number) => number | null;
  /** past this along the deck is over (open sea): leaving it is a dive, not a fall through the pier */
  deckEnd?: number;
  /** a cave roof: the height of its underside (Infinity where it's open water); swimmers stay below it */
  ceiling?: (x: number, along: number) => number;
  /** playable half width (soft walls beyond it) */
  width: number;
  /** optional risky route marker for HUD */
  riskyLine?: { x0: number; x1: number; along0: number; along1: number; bonus: number };
  /** first-run tutorial: the move each row teaches (lane = the lane index you must be in) */
  tutorial?: { step: 'lane' | 'jump' | 'slide'; along: number; lane?: number }[];
  /** holes in reef gates (centre x / world y, radius): swimming through one scores */
  rings?: { x: number; y: number; along: number; r: number }[];
  /** where the water is for FX ('none' land only, 'shallow' ankle deep, 'deep' underwater) */
  water: 'none' | 'shallow' | 'deep';
  /** side dressing selection handled by the biome, patterns may disable (open ocean) */
  sides?: boolean;
  /** Shorebreak Point: the wave you ride (see wave.ts) */
  wave?: Wave;
  /** where you pick up the board (on foot, at this along), let it go and dive, or step off it onto the sand */
  board?: { mount?: number; dive?: number; land?: number };
  /** Shorebreak Point: stretches where you can't go up the wave (a launch there would fly into a pier's deck) */
  noAir?: [number, number][];
  /** the jet ski (Bolivar Channel): where you get on (on foot, at this along), beach it, or ditch it and dive */
  ski?: { mount?: number; land?: number; dive?: number };
  /** the Kraken's chamber (grotto_kraken): its attacks in order, how long each is telegraphed (s), and the along past
   *  which it rears up and you've escaped */
  kraken?: { attacks: KrakenAttack[]; warn: number; escape: number };
  /** Shorebreak Point: where an air spot's arc of coins leaves the lip (along); a climb started in reach of one is timed
   *  to launch there */
  airAt?: number[];
}

/**
 * A breaking wave running along the course (you ride along it, down the line). Across x it rises from its foot on the
 * shore side (+x) up the face to the crest (seaward, -x); behind the crest its back slopes down to the sea. Heights are
 * above the sea level. A barrel is a stretch where the lip throws out over the face: inside the tube you may ride no
 * higher than `hi` (the lip is overhead beyond it); lower than `lo` you're out in the open, in front of the curtain.
 * The tube closes out at `closeout`.
 */
export interface Wave {
  h: (along: number) => number;
  crest: (along: number) => number;
  foot: (along: number) => number;
  tube?: (along: number) => { hi: number; lo: number } | null;
  closeout?: number;
}

export interface PatternCtx {
  rng: Rng;
  /** 0..1 difficulty inside the tier */
  difficulty: number;
  tier: number;
  mirrored: boolean;
  tide: TidePhase;
  /** forward speed the player will have here (m/s), for fairness math */
  speed: number;
  /** room between obstacles: 1 on the keyboard, more with a camera control (a body / head / hand move takes longer
   *  than a key press). Rows, gates and swim obstacles are spaced by it; coin arcs still use the real speed */
  spacing: number;
  length: number;
  /** world z of the chunk entrance (ground noise is sampled in world space so chunks join seamlessly) */
  zStart: number;
}

export interface Pattern {
  id: string;
  biome: Biome;
  mode: Mode;
  length: number;
  /** selection weight */
  weight: number;
  /** [minTier, maxTier] inclusive, tiers are 0..4 */
  tiers: [number, number];
  /** biome at the entrance and at the exit (equal for normal patterns) */
  from: Biome;
  to: Biome;
  /** special role in the grammar (transitions/intro) */
  role?: 'intro' | 'transition' | 'surge' | 'normal';
  build: (ctx: PatternCtx) => ChunkData;
}

export interface Chunk extends ChunkData {
  id: number;
  seq: number;
  biome: Biome;
  /** biome at the exit (differs on transitions) */
  toBiome: Biome;
  mode: Mode;
  patternId: string;
  length: number;
  zStart: number;
  tier: number;
  mirrored: boolean;
  tide: TidePhase;
  /** tide counter 1..12 for this chunk */
  tideStep: number;
  /** filled by the renderer */
  live?: unknown;
}

/** On foot (run / surf) the runner is in one of three lanes, Subway Surfers style; swimming is free in x and y. */
export const LANES = [-2.5, 0, 2.5] as const;
export const LANE_W = 2.5;
/** on the board: from the left lane, left once more carves you up the wave's face at WAVE_CLIMB m/s; at the lip you
 *  launch, LIP_VY up (3 m over the lip, a second in the air) drifting back over the face at LIP_DRIFT; spin and grab */
export const WAVE_CLIMB = 14, LIP_VY = 11, LIP_DRIFT = 1.5;
/** the jet ski: how fast it steers across (m/s), its speed over running (x), the hop a wake gives you (m/s up) */
export const SKI_LAT = 11, SKI_BOOST = 1.45, WAKE_VY = 5.5;
/** an air spot's climb is timed when it's started this many seconds ahead of the launch (min..max) */
export const AIR_REACH: [number, number] = [0.45, 1.25];
export const laneOf = (x: number) => Math.max(0, Math.min(2, Math.round(x / LANE_W) + 1));

/** Player movement capabilities. Shared by the controller and the generator's fairness validator. */
export const MOVE = {
  laneTime: 0.2,          // s to slide across one lane
  latSpeed: 8.0,          // m/s max lateral
  latAccel: 40.0,         // m/s^2
  jumpTime: 0.85,         // s airborne
  jumpHeight: 1.9,        // m apex (feet): high enough to sail over the coin line
  jumpClear: 1.35,        // m: the tallest obstacle that counts as jumpable (the feet stay above it for ~half the jump)
  pickupY: 0.65,          // m: on foot a coin is caught within this height of the hip (a jump passes over ground coins)
  slideTime: 0.75,        // s
  standHeight: 1.75,
  slideHeight: 0.85,
  radius: 0.38,
  swimVy: 4.5,            // m/s vertical underwater
  swimCeiling: -1.1,      // highest hip height while swimming (keeps the camera submerged)
  swimFloor: 0.9,         // min hip height above the seabed
  roofGap: 1.2,           // hip stays this far under a cave roof
  surgeBoost: 6.0,        // extra m/s during a surge
  surgeTime: 1.6,         // s
  surgeCooldown: 5.0,     // s
  reaction: 0.45,         // s of reaction time the validator reserves after a transition
  airTime: 14,            // s of breath under water; a reef-gate hole (bubbles) or the surface refills it
  airLow: 0.3,            // fraction where the low-air warning starts
};

/** Forward speed as a function of distance run (m). */
export function speedAt(distance: number): number {
  const t = Math.min(1, distance / 2000);
  return 12.5 + 10.5 * (1 - Math.pow(1 - t, 1.5));
}
export function tierAt(distance: number): number {
  return distance < 200 ? 0 : distance < 550 ? 1 : distance < 1000 ? 2 : distance < 1600 ? 3 : 4;
}
