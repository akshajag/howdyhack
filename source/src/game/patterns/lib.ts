import { LANES, MOVE, type Biome, type ChunkData, type Current, type Obstacle, type PatternCtx, type Pearl, type Prop } from '../types';
import { KIT_SOLIDS, KIT_BOXES } from '../kitshapes';

/** Pattern-authoring helpers: ground profiles per biome, obstacle/prop constructors, side dressing. */
export const DECK_Y = 1.6;

// ---------------------------------------------------------------- cheap deterministic value noise (world coordinates)
function h2(x: number, y: number) { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
export function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}
export function fbm(x: number, y: number, oct = 3) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); a *= 0.5; f *= 2.1; } return s; }
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** piecewise-linear profile over x */
export function profile(x: number, pts: [number, number][]) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], smooth(pts[i - 1][0], pts[i][0], x));
  return pts[pts.length - 1][1];
}

// ---------------------------------------------------------------- biome ground (world y) : x lateral, z world
export type GroundFn = (x: number, z: number) => number;
export const GROUND: Record<Biome, GroundFn> = {
  // ocean on the left (-x): swash at x = -14, dry run lane around 0.65 m; dune ridges behind the beach, then green hills
  beach: (x, z) => profile(x, [[-64, -3.6], [-40, -2.2], [-22, -0.6], [-14, 0.0], [-7, 0.45], [0, 0.65], [12, 0.85], [18, 1.7], [26, 3.4], [40, 7.5], [64, 13], [95, 21], [135, 26]])
    + 0.14 * fbm(x * 0.09, z * 0.07) + 0.05 * noise(x * 0.5, z * 0.4) * smooth(-10, 2, x)
    + smooth(11, 18, x) * smooth(36, 24, x) * 0.9 * (0.5 + 0.5 * Math.sin(z * 0.06 + x * 0.35 + 2.5 * noise(x * 0.04, z * 0.025)))
    + smooth(24, 46, x) * 8 * fbm(x * 0.016 + 5.3, z * 0.011),
  // open water under the deck
  pier: (x, z) => -5.5 + 0.8 * fbm(x * 0.06, z * 0.05) + profile(Math.abs(x), [[0, 0], [30, 0], [64, 1.5]]),
  // knee-deep lagoon with sandbars (bumps that can break the surface) and sandy islets at the sides
  // the shallows: the lanes run over a sand flat a hand's depth under the surface (ankle-deep, not waist-deep), with
  // deeper blue pools and sandbars beside it and sandy islets beyond
  lagoon: (x, z) => {
    const ax = Math.abs(x);
    const flat = -0.15 + 0.05 * fbm(x * 0.25, z * 0.2);
    const pools = -1.0 + 0.25 * fbm(x * 0.08 + 3.1, z * 0.06) + 1.3 * Math.max(0, fbm(x * 0.045 + 3.1, z * 0.04) - 0.1);
    return lerp(flat, pools, smooth(5.5, 9.5, ax)) + profile(ax, [[0, 0], [18, 0], [28, 1.4], [40, 0.4], [64, -2.5]]);
  },
  // the canyon floor with rims at the sides where the walls stand
  coral: (x, z) => -11 + 1.6 * fbm(x * 0.05, z * 0.04) + profile(Math.abs(x), [[0, 0], [16, 0.3], [24, 4.5], [34, 7.5], [64, 9.0]]),
  // a narrow sea cave: floor at -9, walls closing in at +-11
  // Shorebreak Point: the beach's own shore moved 32 m inland, so the wave runs over a shallow sandy reef (2 m deep
  // under the crest, ankle deep out on the flats) with patches of reef, and the beach rises beyond the flats (+x)
  surf: (x, z) => GROUND.beach(x - 32, z) - 0.35 * Math.max(0, fbm(x * 0.07 + 7.1, z * 0.05)) * smooth(14, 0, x),
  // Bolivar Channel: 5 m of water across the channel (+-13), shoaling to a sandbar and the beach on the right
  ski: (x, z) => { const sea = profile(x, [[-64, -7], [-24, -5.5], [-10, -5.0], [10, -5.0], [13, -3.5], [15, -0.3]]) + 0.2 * fbm(x * 0.08, z * 0.06); const land = GROUND.beach(x - 30, z); return x < 13 ? sea : x > 16 ? land : sea + (land - sea) * smooth(13, 16, x); },
  // a deep sea cave under a rock roof (GROTTO_ROOF): floor around -18, walls closing in at +-11
  grotto: (x, z) => -18 + 1.0 * fbm(x * 0.08, z * 0.06) + profile(Math.abs(x), [[0, 0], [8, 0.3], [11, 6.0], [18, 13.0], [64, 17.0]]),
};

/** blend two biome grounds along a transition chunk */
export function blendGround(a: GroundFn, b: GroundFn, zStart: number, length: number, shape: (t: number) => number = (t) => smooth(0, 1, t)): ChunkData['ground'] {
  return (x, along) => { const z = zStart - along; const t = shape(along / length); return lerp(a(x, z), b(x, z), t); };
}
export function worldGround(g: GroundFn, zStart: number): ChunkData['ground'] { return (x, along) => g(x, zStart - along); }

// on foot the lanes are what matter (this is only the dressing margin); under water it is the free-swim half width,
// which reaches the visible canyon / cave walls so there is no invisible boundary
/** underside of the grotto's rock roof: the cave is ~8 m tall, well below the brighter canyon */
export const GROTTO_ROOF = -10;

export const WIDTH: Record<Biome, number> = { beach: 4.5, pier: 3.6, lagoon: 5, coral: 14, grotto: 9, surf: 4.5, ski: 7 };

// ---------------------------------------------------------------- constructors
export function empty(width: number, water: ChunkData['water'], ground: ChunkData['ground']): ChunkData {
  return { obstacles: [], props: [], currents: [], pearls: [], gaps: [], events: [], ground, width, water, sides: true };
}
export function box(x: number, y: number, along: number, sx: number, sy: number, sz: number, tag: string, o: Partial<Obstacle> = {}, yaw = 0): Obstacle {
  return { shape: { kind: 'box', x, y, along, sx, sy, sz, yaw }, tag, ...o };
}
export function sphere(x: number, y: number, along: number, r: number, tag: string, o: Partial<Obstacle> = {}): Obstacle {
  return { shape: { kind: 'sphere', x, y, along, r }, tag, ...o };
}
export function prop(kit: string, x: number, y: number, along: number, yaw = 0, scale = 1, o: Partial<Prop> = {}): Prop {
  return { kit, x, y, along, yaw, scale, ...o };
}
export function current(x0: number, x1: number, along0: number, along1: number, vx: number, vAlong: number, vy = 0, o: Partial<Current> = {}): Current {
  return { x0, x1, along0, along1, vx, vy, vAlong, ...o };
}
export function pearls(d: ChunkData, along0: number, along1: number, xAt: (t: number) => number, yAt: (t: number) => number, spacing = 3, value = 10, risky = false) {
  const n = Math.max(1, Math.floor((along1 - along0) / spacing));
  for (let i = 0; i <= n; i++) { const t = i / n; const p: Pearl = { x: xAt(t), y: yAt(t), along: along0 + (along1 - along0) * t, value, risky }; d.pearls.push(p); }
}

/** mirror helper for gameplay elements */
export const M = (ctx: PatternCtx) => (x: number) => (ctx.mirrored ? -x : x);

// ---------------------------------------------------------------- lanes (on foot). Every land obstacle fits inside one
// lane (or spans the whole row) and is low enough to jump (top <= MOVE.jumpClear), high enough to slide under
// (bottom >= 1.0 m), or a tagged blocker you have to change lanes around.
/** lane centre x for lane 0 / 1 / 2, mirrored with the pattern */
export const lane = (ctx: PatternCtx, i: number) => LANES[ctx.mirrored ? 2 - i : i];
/** distance between consecutive rows: never less than a full jump plus a moment to react (no back-to-back obstacles) */
/** where a chunk's first row of obstacles goes: far enough in that it's never right after the last row of the chunk
 *  before (that one ends 3 m+ before its chunk's end; the validator checks the join) */
export const firstRow = (ctx: PatternCtx) => Math.max(12, ctx.speed * 0.9 + 3) * ctx.spacing;
export const rowGap = (ctx: PatternCtx, factor = 1) => Math.max(10, ctx.speed * Math.max(0.95 * factor, MOVE.jumpTime + 0.4)) * ctx.spacing;
interface Piece { kit: string; scale: number; box: [number, number, number]; tag: string; name: string; yaw: 'any' | 'flip' | 'front'; sy?: number }
/** lane obstacles (Kenney kits). `box` is the collision box (w, h, depth), a little inside the visible mesh */
const PIECES = {
  // jump (top <= ~1.2 m)
  rockA: { kit: 'K_Rock_SandA', scale: 1.3, box: [1.55, 1.06, 1.55], tag: 'rock', name: 'HIT THE ROCKS', yaw: 'any' },
  rockC: { kit: 'K_Rock_SandC', scale: 1.3, box: [1.5, 1.08, 1.5], tag: 'rock', name: 'HIT THE ROCKS', yaw: 'any' },
  rockK: { kit: 'K_Rock_C', scale: 1.3, box: [1.6, 1.08, 1.6], tag: 'rock', name: 'HIT THE ROCKS', yaw: 'any' },
  logPile: { kit: 'K_LogPile', scale: 1, box: [2.2, 1.08, 1.9], tag: 'wood', name: 'TRIPPED ON THE LOG PILE', yaw: 'flip' },
  logBig: { kit: 'K_LogBig', scale: 1, box: [2.25, 0.95, 1.15], tag: 'wood', name: 'TRIPPED ON A LOG', yaw: 'flip' },
  cannon: { kit: 'K_Cannon', scale: 1, box: [1.45, 1.1, 2.0], tag: 'metal', name: 'HIT A CANNON', yaw: 'front' },
  barrels: { kit: 'K_Barrels', scale: 1, box: [2.25, 1.02, 1.15], tag: 'barrel', name: 'HIT THE BARRELS', yaw: 'flip' },
  chest: { kit: 'Chest_Base', scale: 1.15, box: [1.1, 1.18, 1.1], tag: 'wood', name: 'HIT A TREASURE CHEST', yaw: 'front' },
  crate: { kit: 'K_Crate', scale: 1.3, box: [1.45, 1.05, 1.75], tag: 'wood', name: 'HIT A CRATE', yaw: 'flip' },
  // (the pennant on its stick pokes up past the box: thin, and a jump clears it anyway)
  castle: { kit: 'Sandcastle', scale: 1.15, box: [1.3, 1.02, 1.3], tag: 'sand', name: 'FLATTENED A SANDCASTLE', yaw: 'any' },
  // blockers (too tall to jump, nothing to slide under: change lanes)
  crateStack: { kit: 'K_CrateStack', scale: 1, box: [2.25, 2.5, 1.4], tag: 'blocker', name: 'RAN INTO THE CARGO', yaw: 'flip' },
  tiki: { kit: 'K_Tiki', scale: 1, box: [1.8, 2.65, 1.4], tag: 'blocker', name: 'RAN INTO A TIKI', yaw: 'front' },
  rockStack: { kit: 'K_Rocks_Big', scale: 0.32, sy: 1.31, box: [2.1, 2.45, 2.2], tag: 'blocker', name: 'RAN INTO THE ROCKS', yaw: 'flip' },
} satisfies Record<string, Piece>;
type PieceId = keyof typeof PIECES;
const JUMP_SETS: Record<'beach' | 'pier' | 'lagoon', PieceId[]> = {
  // (cannons come up more often: they fire, see critters.ts)
  beach: ['rockA', 'rockC', 'rockK', 'logPile', 'logBig', 'cannon', 'cannon', 'cannon', 'barrels', 'chest', 'crate', 'castle', 'castle'],
  pier: ['barrels', 'crate', 'chest', 'cannon', 'cannon'],
  lagoon: ['rockA', 'rockK', 'logBig', 'barrels'],
};
const BLOCK_SETS: Record<'beach' | 'pier' | 'lagoon', PieceId[]> = { beach: ['crateStack', 'tiki', 'rockStack'], pier: ['crateStack'], lagoon: ['rockStack', 'tiki'] };
export type LaneSet = keyof typeof JUMP_SETS;

function placePiece(d: ChunkData, ctx: PatternCtx, id: PieceId, x: number, along: number, surface?: number) {
  const p: Piece = PIECES[id];
  const y = (surface ?? d.ground(x, along)) - 0.04;
  const yaw = p.yaw === 'any' ? ctx.rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) : p.yaw === 'flip' ? ctx.rng.pick([0, Math.PI]) : 0;
  if (p.kit === 'Chest_Base') closedChest(d, x, y, along, yaw, p.scale);
  else d.props.push(prop(p.kit, x, y, along, yaw, p.scale, p.sy ? { sy: p.sy } : {}));
  d.obstacles.push(box(x, y, along, p.box[0], p.box[1], p.box[2], p.tag, { name: p.name }));
}
/** a closed treasure chest: the base, and its lid on the hinge at the back top edge (0.6 up, 0.45 back at scale 1) */
export function closedChest(d: ChunkData, x: number, y: number, along: number, yaw: number, s: number) {
  d.props.push(prop('Chest_Base', x, y, along, yaw, s));
  d.props.push(prop('Chest_Lid', x - 0.45 * s * Math.sin(yaw), y + 0.6 * s, along + 0.45 * s * Math.cos(yaw), yaw, s));
}
/** a jumpable obstacle in one lane, picked from the set for the biome (pass `surface` on a deck) */
export function laneJump(d: ChunkData, ctx: PatternCtx, x: number, along: number, set: LaneSet = 'beach', surface?: number) {
  placePiece(d, ctx, ctx.rng.pick(JUMP_SETS[set]), x, along, surface);
}
/** a blocker in one lane: crate pile, tiki head or rock stack. Coins never go in its lane. */
export function laneBlocker(d: ChunkData, ctx: PatternCtx, x: number, along: number, set: LaneSet = 'beach', surface?: number) {
  placePiece(d, ctx, ctx.rng.pick(BLOCK_SETS[set]), x, along, surface);
}
/** slide under, one lane: an upside-down rowboat on two posts (the posts stand at the lane edges, outside the slider) */
export function laneSlide(d: ChunkData, ctx: PatternCtx, x: number, along: number, surface?: number) {
  const y = (surface ?? d.ground(x, along)) - 0.03;
  d.props.push(prop('K_BoatRack', x, y, along, ctx.rng.pick([0, Math.PI]), 1));
  d.obstacles.push(box(x, y + 1.2, along, 2.3, 0.85, 1.35, 'wood', { name: 'HIT THE BOAT' }));
}
/** slide under, all three lanes: a beach volleyball net (posts outside the lanes) */
export function volleyNet(d: ChunkData, ctx: PatternCtx, along: number) {
  const y = d.ground(0, along) - 0.03;
  d.props.push(prop('K_VolleyNet', 0, y, along, 0, 1));
  d.obstacles.push(box(0, y + 1.2, along, 9.4, 1.3, 0.3, 'net', { name: 'CAUGHT IN THE VOLLEYBALL NET' }));
  // a ball or two left lying by the posts (dressing only; its own random stream, so the course is unchanged)
  const r = ctx.rng.fork(`volley${along}`);
  for (let i = 0, n = r.int(1, 2); i < n; i++) { const x = r.sign() * r.range(5.6, 7), a = along + r.range(-2, 2); d.props.push(prop('Volleyball', x, d.ground(x, a), a, r.range(0, 6.28), 1)); }
}
/** a jumpable rock that fits one lane (Kenney Pirate Kit rocks at 1.3x: ~1.8 m wide, 1.15 m tall) */
export function laneRock(d: ChunkData, ctx: PatternCtx, x: number, along: number) {
  placePiece(d, ctx, ctx.rng.pick(['rockA', 'rockC', 'rockK'] as const), x, along);
}
/** a rock in the lagoon shallows: as tall as a jump allows (~1.07 m) so it breaks the knee-deep water and stays
 *  readable at high tide */
export function laneReef(d: ChunkData, ctx: PatternCtx, x: number, along: number) {
  const y = d.ground(x, along) - 0.04;
  const kit = ctx.rng.pick(['K_Rock_SandA', 'K_Rock_C']);
  d.props.push(prop(kit, x, y, along, ctx.rng.range(0, 6.28), 1.2));
  d.obstacles.push(box(x, y, along, 1.55, 1.04, 1.55, 'rock'));
}
/** a big driftwood log lying across one lane (Kenney Nature Kit) */
export function laneLog(d: ChunkData, ctx: PatternCtx, x: number, along: number) {
  placePiece(d, ctx, 'logBig', x, along);
}
/** obstacles that match a kit's real silhouette (arches, windows, ribs): one box per solid rectangle, holes stay open */
export function kitSolids(d: ChunkData, kit: string, x: number, y: number, along: number, scale: number, tag: string, group: string, flip = false, name?: string) {
  const k = KIT_SOLIDS[kit];
  if (!k) return;
  const f = flip ? -1 : 1;                                     // flip = the prop turned by pi (mirrors x and depth)
  const zc = (k.z0 + k.z1) / 2, sz = (k.z1 - k.z0) * scale;
  for (const [x0, y0, x1, y1] of k.rects) {
    d.obstacles.push(box(x + f * ((x0 + x1) / 2) * scale, y + y0 * scale, along - f * zc * scale, (x1 - x0) * scale, (y1 - y0) * scale, sz, tag, { group, name }));
  }
}
/** obstacles that follow an irregular kit in 3D (a tilted mast over a torn sail): the boxes tools/kitshapes.mjs voxelised
 *  from the mesh, so the hitbox is exactly the shape you see */
export function kitBoxes(d: ChunkData, kit: string, x: number, y: number, along: number, scale: number, tag: string, group: string, flip = false, name?: string) {
  const f = flip ? -1 : 1;
  for (const [x0, y0, z0, x1, y1, z1] of KIT_BOXES[kit] ?? []) {
    d.obstacles.push(box(x + f * ((x0 + x1) / 2) * scale, y + y0 * scale, along - f * ((z0 + z1) / 2) * scale, (x1 - x0) * scale, (y1 - y0) * scale, (z1 - z0) * scale, tag, { group, name }));
  }
}

// ---------------------------------------------------------------- reef gates (underwater)
/** hole centre x, height above the wall base and radius for each gate (must match blender/runner/build_gates.py) */
export const GATE_HOLES = {
  Reef_Gate_Mid: [[0, 5.6, 2.2]], Reef_Gate_Low: [[0, 3.4, 2.2]], Reef_Gate_High: [[0, 7.8, 2.2]], Reef_Gate_Twin: [[-4.5, 3.4, 1.9], [4.5, 7.4, 1.9]],
} as const satisfies Record<string, readonly (readonly [number, number, number])[]>;
export type GateKit = keyof typeof GATE_HOLES;
let gateId = 0;
/** a reef wall across the whole swim space (46 m wide, its top above the surface) with one or two holes: the only
 *  way on is through a hole. A glowing ring frames each hole, threading one scores, and coins lead in. */
export function reefGate(d: ChunkData, kit: GateKit, cx: number, along: number, flip = false, tint?: [number, number, number], stream: 'jet' | 'pull' = 'jet') {
  const base = d.ground(cx, along) - 2.0;                      // buried in the seabed
  d.props.push(prop(kit, cx, base, along, flip ? Math.PI : 0, 1, { tint }));
  kitSolids(d, kit, cx, base, along, 1, 'rock', `gate${gateId++}`, flip, 'HIT THE REEF WALL');
  (d.rings ??= []);
  for (const [hx, hy, r] of GATE_HOLES[kit]) {
    const x = cx + (flip ? -hx : hx), y = base + hy;
    d.props.push(prop('Gate_Ring', x, y, along - 1.5, 0, r));
    d.rings.push({ x, y, along, r });
    pearls(d, along - 10, along + 3, () => x, () => y, 2.6, 15);
    gateStream(d, x, y, along, r, stream === 'jet');
  }
}
/** the water rushes through a gate's hole: a visible slipstream that speeds you through it, and gentle pulls toward the
 *  hole on the approach (so lining up forgives a little drift) */
function gateStream(d: ChunkData, x: number, y: number, along: number, r: number, jet = true) {
  // the jet only catches you when you're lined up with the hole (a wider one rushed a slightly-off swimmer into the
  // rock); the pulls before it do the lining up
  const w = r * 0.75;
  if (jet) d.currents.push(current(x - w, x + w, along - 6, along + 7, 0, 5.5, 0, { y0: y - w, y1: y + w, jet: true }));
  const a0 = along - 14, a1 = along - 3, pull = 2.2, reach = 4.5;
  d.currents.push(current(x - reach, x - 0.6, a0, a1, pull, 0, 0, { y0: y - reach, y1: y + reach, visible: false }));
  d.currents.push(current(x + 0.6, x + reach, a0, a1, -pull, 0, 0, { y0: y - reach, y1: y + reach, visible: false }));
  d.currents.push(current(x - reach, x + reach, a0, a1, 0, 0, pull * 0.8, { y0: y - reach, y1: y - 0.6, visible: false }));
  d.currents.push(current(x - reach, x + reach, a0, a1, 0, 0, -pull * 0.8, { y0: y + 0.6, y1: y + reach, visible: false }));
}
/** gates every `spacing` metres from a0 to a1; each hole stays within easy reach of the last one: at most 4 m to the
 *  side and one height step (low / middle / high; a twin gate offers both) */
export function gateRun(d: ChunkData, ctx: PatternCtx, a0: number, a1: number, tint?: [number, number, number]) {
  const r = ctx.rng, m = M(ctx);
  const spacing = Math.max(22, ctx.speed * (1.6 - 0.04 * ctx.tier));
  const LEVEL: Record<GateKit, number> = { Reef_Gate_Low: 0, Reef_Gate_Mid: 1, Reef_Gate_High: 2, Reef_Gate_Twin: -1 };
  let cx = r.range(-1.5, 1.5), level = 1, twin = false;
  for (let a = a0; a <= a1; a += spacing + r.range(0, 4)) {
    // after a twin gate both of its holes must lead on (whichever one you picked): the next gate is the middle height,
    // halfway between them, near the twin's centre
    const options = twin ? ['Reef_Gate_Mid' as const] : (Object.keys(LEVEL) as GateKit[]).filter((k) => LEVEL[k] < 0 || Math.abs(LEVEL[k] - level) <= 1);
    const kit = r.pick(options);
    level = LEVEL[kit]; twin = level < 0;
    reefGate(d, kit, m(cx), a, r.chance(0.5), tint);
    cx = Math.max(-4, Math.min(4, cx + (twin ? r.range(-1, 1) : r.range(-4, 4))));
  }
}

// ---------------------------------------------------------------- obstacle families (shape + prop in one call)
const DRIFT_LEN: Record<string, number> = { Driftwood_00: 2.95, Driftwood_01: 5.6, Driftwood_02: 2.6, Driftwood_03: 5.0, Driftwood_04: 4.23, Driftwood_05: 3.8, Driftwood_06: 4.82 };
/** a driftwood log lying across the lane (jump over). The GLB pivot is at one end along +x. */
export function driftwood(d: ChunkData, ctx: PatternCtx, cx: number, along: number, yaw = 0, variant?: string) {
  const kit = variant ?? ctx.rng.pick(['Driftwood_01', 'Driftwood_03', 'Driftwood_04', 'Driftwood_06']);
  const L = DRIFT_LEN[kit] ?? 4;
  const y = d.ground(cx, along);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  d.props.push(prop(kit, cx - c * L / 2, y - 0.02, along + s * L / 2, yaw, 1));
  d.obstacles.push(box(cx, y, along, L, 0.45, 0.85, 'wood', {}, yaw));
}
export function rock(d: ChunkData, ctx: PatternCtx, cx: number, along: number, size: 'small' | 'medium' | 'big' = 'medium', under = false) {
  const y = d.ground(cx, along) - 0.05;
  const yaw = ctx.rng.range(0, Math.PI * 2);
  if (size === 'small') { d.props.push(prop('Rock_Boulder', cx, y, along, yaw, ctx.rng.range(0.9, 1.2))); d.obstacles.push(sphere(cx, y + 0.6, along, 0.95, 'rock')); }
  else if (size === 'medium' && under) {
    // a rock pillar: the box follows the pillar's real footprint (1.68 x 2.77 x 1.53 m at scale 1), a little inside it
    const s = ctx.rng.range(0.9, 1.15);
    d.props.push(prop('Rock_Pillar', cx, y, along, yaw, s));
    d.obstacles.push(box(cx, y, along, 1.55 * s, 2.7 * s, 1.4 * s, 'rock', { name: 'HIT A ROCK PILLAR' }, yaw));
  }
  else if (size === 'medium') { d.props.push(prop(ctx.rng.pick(['SRC_mk_rock_1', 'SRC_mk_rock_2', 'SRC_mk_rock_3']), cx, y, along, yaw, ctx.rng.range(0.9, 1.15))); d.obstacles.push(box(cx, y, along, 2.4, 1.9, 2.2, 'rock', {}, yaw)); }
  else { d.props.push(prop('Beach_Boulder_Big', cx, y, along, yaw, ctx.rng.range(0.95, 1.2))); d.obstacles.push(box(cx, y, along, 2.9, 2.2, 2.6, 'rock', {}, yaw)); }
}
/** a fallen palm across all three lanes (Kenney palm, laid down): low = jump, propped on rocks = slide under.
 *  The crown lies beyond an outer lane; `flip` puts it on the other side. */
export function fallenPalm(d: ChunkData, ctx: PatternCtx, cx: number, along: number, raised: boolean, _span = 8.4) {
  const y = d.ground(cx, along);
  const yaw = ctx.rng.chance(0.5) ? 0 : Math.PI;
  if (raised) {
    d.props.push(prop('K_Palm_Raised', cx, y, along, yaw, 1));
    d.obstacles.push(box(cx, y + 1.39, along, 8.4, 0.74, 0.8, 'wood', { name: 'HIT THE PALM TRUNK' }));
  } else {
    d.props.push(prop('K_Palm_Fallen', cx, y, along, yaw, 1));
    d.obstacles.push(box(cx, y, along, 8.4, 0.83, 0.8, 'wood', { name: 'TRIPPED ON A PALM' }));
  }
}
export function barrel(d: ChunkData, ctx: PatternCtx, cx: number, along: number, y: number) {
  d.props.push(prop('K_Barrel', cx, y, along, ctx.rng.range(0, 6.28), 1));
  d.obstacles.push(box(cx, y, along, 0.9, 0.9, 0.9, 'barrel'));
}
export function crate(d: ChunkData, ctx: PatternCtx, cx: number, along: number, y: number) {
  d.props.push(prop(ctx.rng.chance(0.3) ? 'K_Crate_Bottles' : 'K_Crate', cx, y, along, ctx.rng.pick([0, Math.PI]) + ctx.rng.range(-0.15, 0.15), 1));
  d.obstacles.push(box(cx, y, along, 1.15, 0.88, 1.4, 'wood'));
}
export function beamLow(d: ChunkData, cx: number, along: number, y: number, span = 7) {
  d.props.push(prop('Beam_Low', cx, y, along, 0, span / 7));
  d.obstacles.push(box(cx, y + 1.25, along, span, 0.35, 0.35, 'wood'));
}
export function beamJump(d: ChunkData, cx: number, along: number, y: number, span = 7) {
  d.props.push(prop('Beam_Jump', cx, y, along, 0, span / 7));
  d.obstacles.push(box(cx, y, along, span, 0.55, 0.55, 'wood'));
}
export function netHang(d: ChunkData, cx: number, along: number, y: number, span = 7) {
  d.props.push(prop('Net_Hang', cx, y, along, 0, span / 7));
  d.obstacles.push(box(cx, y + 1.3, along, span, 1.3, 0.5, 'net'));
}
/** pillar-coral towers come in a few soft colours (the model is a neutral ramp the tint colours) */
const TOWER_TINTS: [number, number, number][] = [[0.78, 0.6, 1], [1, 0.55, 0.68], [0.4, 0.88, 0.82], [1, 0.88, 0.45]];
/** a mix of coral tower sizes: mostly short and medium, now and then a tall one */
export function towerScale(ctx: PatternCtx) {
  const k = ctx.rng.next();
  return k < 0.4 ? ctx.rng.range(0.7, 0.95) : k < 0.8 ? ctx.rng.range(1.0, 1.2) : ctx.rng.range(1.25, 1.45);
}
export function coralTower(d: ChunkData, ctx: PatternCtx, cx: number, along: number, scale = 1) {
  const y = d.ground(cx, along) - 0.1;
  d.props.push(prop('Coral_Tower', cx, y, along, ctx.rng.range(0, 6.28), scale, { tint: ctx.rng.pick(TOWER_TINTS) }));
  d.obstacles.push(box(cx, y, along, 1.5 * scale, 4.5 * scale, 1.5 * scale, 'coral'));
}
/** footprint (half width, height) of each coral kit at scale 1, for hitboxes that match the drawn coral */
const CORAL_SIZE: Record<string, [number, number]> = { Coral_Brain: [0.83, 0.83], Coral_Table: [0.88, 0.94], Coral_Branch: [0.72, 0.88], Coral_Tube: [0.5, 1.31] };
let clusterId = 0;
export function coralCluster(d: ChunkData, ctx: PatternCtx, cx: number, along: number, r = 1.6) {
  const kits = Object.keys(CORAL_SIZE);
  const group = `coral${clusterId++}`;
  for (let i = 0; i < 4; i++) {
    const a = ctx.rng.range(0, 6.28), rr = ctx.rng.range(0, r * 0.7);
    const kit = ctx.rng.pick(kits), sc = ctx.rng.range(1.6, 2.6);
    const x = cx + Math.cos(a) * rr, al = along + Math.sin(a) * rr, y = d.ground(x, al) - 0.05;
    d.props.push(prop(kit, x, y, al, ctx.rng.range(0, 6.28), sc, { tint: coralTint(ctx) }));
    // one box per coral, just inside what is drawn (the old single sphere stood up to 1.6 m clear of the coral)
    const [hw, h] = CORAL_SIZE[kit];
    d.obstacles.push(box(x, y, al, hw * 1.6 * sc, h * 0.92 * sc, hw * 1.6 * sc, 'coral', { group, name: 'HIT THE CORAL' }));
  }
}
export function rockPillar(d: ChunkData, ctx: PatternCtx, cx: number, along: number, height = 5, r = 1.1) {
  const y = d.ground(cx, along) - 0.4;
  d.props.push(prop('Rock_Pillar', cx, y, along, ctx.rng.range(0, 6.28), 1, { pitch: 0 }));
  // the pillar kit is 2.8 m tall: stretch it vertically via scale encoded in a tall box; the renderer scales by sy/2.77
  d.props[d.props.length - 1].scale = r / 0.84;
  (d.props[d.props.length - 1] as Prop & { sy?: number }).sy = height / 2.77;
  d.obstacles.push(box(cx, y, along, r * 1.8, height, r * 1.8, 'rock'));
}
export function jelly(d: ChunkData, ctx: PatternCtx, cx: number, y: number, along: number) {
  d.props.push(prop('Jellyfish', cx, y, along, ctx.rng.range(0, 6.28), ctx.rng.range(0.9, 1.3), { tint: [1, 0.85 + ctx.rng.range(0, 0.15), 1] }));
  d.obstacles.push(sphere(cx, y, along, 0.75, 'jelly', { bob: { amp: 0.6, freq: ctx.rng.range(0.4, 0.7), phase: ctx.rng.range(0, 6.28) } }));
}
/** the highest a mine may sit here. A low mine's spike tips stay 2.2 m below the highest you can swim (the surface, or
 *  a cave roof): room to go over it. A high one (in a row, away from its dips) may come up to 0.5 m under that */
export function mineTop(d: ChunkData, x: number, along: number, high = false) {
  const top = d.ceiling ? Math.min(MOVE.swimCeiling, d.ceiling(x, along) - MOVE.roofGap) : MOVE.swimCeiling;
  return top - 0.95 - (high ? 0.5 : 2.2);
}
/** an old sea mine moored on its chain (the model's chain runs on into the seabed, so it fits any height); the
 *  hitbox is a sphere inside the spikes, and it sways a little on the chain */
export function mine(d: ChunkData, ctx: PatternCtx, cx: number, y: number, along: number, high = false) {
  y = Math.min(y, mineTop(d, cx, along, high));
  d.props.push(prop('Sea_Mine', cx, y, along, ctx.rng.range(0, 6.28), 1));
  d.obstacles.push(sphere(cx, y, along, 0.8, 'mine', { name: 'HIT A SEA MINE', bob: { amp: 0.15, freq: ctx.rng.range(0.25, 0.4), phase: ctx.rng.range(0, 6.28) } }));
}
/** a fishing net, 10 m x 6 m at scale 1, with its floats along the top at `topY`: hanging from the surface, or standing
 *  up from the seabed (bottom rope buried). Collision is the net panel itself. */
export function netWall(d: ChunkData, cx: number, topY: number, along: number, scale = 1) {
  d.props.push(prop('Net_Wall', cx, topY, along, 0, scale));
  d.obstacles.push(box(cx, topY - 6 * scale, along, 10 * scale, 6 * scale, 0.35, 'net', { name: 'CAUGHT IN A NET' }));
}
/** a row of mines across the canyon on a staggered lattice, seabed up, with clear openings round `holes` ((x, y)
 *  pairs) and some random gaps. Most of the row reaches up near the surface, but one or two dips 5-7 m wide stay low
 *  (room to go over the top there), so it's never a wall of tall mines all the way across. Returns the dips' centres */
export function mineRow(d: ChunkData, ctx: PatternCtx, along: number, holes: [number, number][], x0 = -13, x1 = 13) {
  const r = ctx.rng, dx = Math.max(2.4, 2.9 - 0.4 * ctx.difficulty), dy = 2.4, fill = Math.min(0.86, 0.52 + 0.085 * ctx.tier);
  const open = 2.9 - 0.1 * ctx.tier;                               // radius kept clear round each opening
  const dips: [number, number][] = [];
  for (let k = 0, n = r.chance(0.5) ? 2 : 1; k < n; k++) { const c = r.range(x0 + 3, x1 - 3), w = r.range(5, 7) - ctx.tier * 0.3; dips.push([c - w / 2, c + w / 2]); }
  for (let j = 0; j < 7; j++) {
    let any = false;
    for (let x = x0 + (j % 2 ? dx / 2 : 0); x <= x1; x += dx) {
      const high = !dips.some(([a, b]) => x > a - 0.95 && x < b + 0.95);
      const y = d.ground(x, along) + 1.3 + j * dy + r.range(-0.25, 0.25);
      if (y > mineTop(d, x, along, high)) continue;
      any = true;
      if (holes.some(([hx, hy]) => Math.hypot(x - hx, y - hy) < open) || !r.chance(fill)) continue;
      mine(d, ctx, high ? x + r.range(-0.3, 0.3) : x, y, along + r.range(-1.2, 1.2), high);
    }
    if (!any) break;
  }
  return dips.map(([a, b]) => (a + b) / 2);
}
/** a chain hanging from `topY`, `len` long. `lit`: drawn unlit in a dim rust, so it still reads in the dark grotto */
/** the start of the course: the Aggie research station on the dune side (facing the lanes), its HOWDY! sign beside
 *  the lanes, a Reveille-inspired collie sitting by the station steps and a research buoy just offshore. Dressing where
 *  they stand is cleared */
export function aggieStart(d: ChunkData) {
  const SX = 11.4, SA = 26;
  d.props = d.props.filter((p) => !(p.x > 5.4 && p.x < 17 && Math.abs(p.along - SA) < 6.5) && !(p.x > 3.8 && p.x < 7.8 && Math.abs(p.along - 12) < 2.5)
    && !((p.kit === 'K_VolleyNet' || p.kit === 'Volleyball') && p.x > 5 && Math.abs(p.along - SA) < 13));
  d.props.push(prop('Research_Station', SX, d.ground(SX - 3.6, SA) - 0.6, SA, -Math.PI / 2, 1));
  d.props.push(prop('Howdy_Sign', 5.8, d.ground(5.8, 12) - 0.05, 12, 0.12, 1));
  d.props.push(prop('Collie_Body', 6.5, d.ground(6.5, SA + 0.5), SA + 0.5, -Math.PI / 2 + 0.5, 1));
  if (d.ground(-25, 34) < -0.6) d.props.push(prop('Research_Buoy_A', -25, 0, 34, 0.4, 1));
}
export function chain(d: ChunkData, cx: number, along: number, topY: number, len = 6, lit = false) {
  d.props.push(prop(lit ? 'Chain_Glow' : 'Chain_Hang', cx, topY, along, 0, len / 6, lit ? { tint: [0.62, 0.42, 0.3] } : {}));
  d.obstacles.push(box(cx, topY - len, along, 0.5, len, 0.5, 'chain'));
}
/** spilled cargo (Kenney barrels and crates) in a loose cluster around (cx, y): every piece is its own hitbox */
let cargoId = 0;
export function cargo(d: ChunkData, ctx: PatternCtx, cx: number, y: number, along: number, spread = 3, n = 4) {
  const r = ctx.rng, group = `cargo${cargoId++}`;
  const KITS = [['K_Barrel', 0.98, 0.9, 0.98], ['K_Crate', 1.19, 0.85, 1.45], ['K_Crate_Bottles', 0.92, 0.9, 1.12]] as const;
  for (let i = 0; i < n; i++) {
    const [kit, w, h, dep] = r.pick(KITS);
    const x = cx + r.range(-spread, spread), yy = y + r.range(0, 0.5), a = along + r.range(-1, 1);
    d.props.push(prop(kit, x, yy, a, r.pick([0, Math.PI]), 1));
    d.obstacles.push(box(x, yy, a, w * 0.9, h * 0.92, dep * 0.9, 'wood', { group, name: 'HIT THE CARGO' }));
  }
}
export function coralTint(ctx: PatternCtx): [number, number, number] {
  // (no orange: it read as a stray colour under water)
  return ctx.rng.pick([[1, 0.4, 0.55], [0.75, 0.5, 1], [1, 0.85, 0.3], [0.3, 0.9, 0.85], [1, 0.7, 0.75]] as [number, number, number][]);
}

// ---------------------------------------------------------------- side dressing (visual only, outside the playable width)
export function dressSides(d: ChunkData, ctx: PatternCtx, biome: Biome, length: number) {
  const r = ctx.rng.fork('sides');
  const W = d.width + 1.5;
  const place = (kit: string, x: number, along: number, scale: number, yaw = r.range(0, 6.28), tint?: [number, number, number], dy = 0) => d.props.push(prop(kit, x, d.ground(x, along) + dy, along, yaw, scale, { tint }));
  // distant islands on the horizon whenever a chunk crosses a 320 m mark (above-water biomes only)
  if (biome !== 'coral' && biome !== 'grotto' && Math.floor(-ctx.zStart / 320) !== Math.floor(-(ctx.zStart - length) / 320)) {
    const side = biome === 'beach' ? -1 : r.sign();
    d.props.push(prop(r.pick(['Island_Far_A', 'Island_Far_B']), side * r.range(650, 1100), -2, length + r.range(600, 1100), r.range(0, 6.28), r.range(0.8, 1.4)));
  }
  // big pieces sit on the lowest ground under their footprint (sunk a little) so nothing hangs over a slope
  const low = (x: number, a: number, rad: number) => Math.min(d.ground(x, a), d.ground(x + rad, a), d.ground(x - rad, a), d.ground(x, a + rad), d.ground(x, a - rad));
  const plant = (kit: string, x: number, a: number, scale: number, rad: number, sink = 0.15, yaw = r.range(0, 6.28)) => d.props.push(prop(kit, x, low(x, a, rad * scale) - sink, a, yaw, scale));
  if (biome === 'beach') {
    // Kenney Pirate + Nature kits (CC0). Land rises to the right (+x): dry sand, a dune fence, palm groves on the dune
    // ridges, then grassy hills; the sea is on the left.
    const palm = () => r.pick(['K_Palm_Bend', 'K_Palm_Bend', 'K_Palm_Straight', 'K_Palm_Small']);
    // dune fence along the foot of the dunes, in runs with gaps, following the ground
    for (let a = r.range(0, 4); a < length - 1.5; a += 2.35) {
      if (noise(ctx.zStart * 0.01 + a * 0.08, 3.3) < -0.25) continue;
      const x = 11.2 + 0.6 * noise(a * 0.05, ctx.zStart * 0.01);
      d.props.push(prop('K_Fence', x, d.ground(x, a) - 0.05, a, Math.PI / 2 + r.range(-0.08, 0.08), 1));
    }
    // palm groves: clusters of 2-4 leaning palms on the dunes, bushes and tall grass at their feet
    for (let a = r.range(0, 8); a < length; a += r.range(10, 17)) {
      const cx = r.range(14, 24), n = r.int(2, 4);
      for (let i = 0; i < n; i++) plant(palm(), cx + r.range(-3, 3), Math.min(length - 1, a + r.range(-3, 3)), r.range(0.68, 0.95), 0.5);
      for (let i = 0; i < 3; i++) plant(r.pick(['K_Bush', 'K_Bush_Large', 'K_Grass_Tall']), cx + r.range(-4, 4), Math.min(length - 1, a + r.range(-4, 4)), r.range(0.8, 1.3), 0.6, 0.1);
    }
    // a lone palm close to the run now and then (the classic leaning-over-the-sand silhouette)
    if (r.chance(0.4)) plant('K_Palm_Bend', r.range(8.5, 10.5), r.range(4, length - 4), r.range(0.75, 0.9), 0.4, 0.15, r.range(2.2, 4.0));
    // dune grass and flowers
    for (let a = r.range(0, 2); a < length; a += r.range(1.2, 2.4)) plant(r.pick(['K_Grass', 'K_Grass', 'K_Grass_Tall', 'Veg_SeaOats', 'Veg_DuneGrass']), r.range(W + 2.5, 28), a, r.range(0.8, 1.4), 0.3, 0.05);
    for (let a = r.range(0, 6); a < length; a += r.range(4, 9)) { const x = r.range(16, 34), k = r.pick(['K_Flowers', 'K_Flowers_Red']); for (let i = 0; i < 3; i++) plant(k, x + r.range(-1.2, 1.2), Math.min(length - 0.5, a + r.range(-1.2, 1.2)), r.range(0.8, 1.2), 0.2, 0.03); }
    // the hills: scattered palms, bushes and rock outcrops half sunk into the slope
    for (let a = r.range(0, 10); a < length; a += r.range(8, 15)) plant(palm(), r.range(26, 60), a, r.range(0.75, 1.05), 0.5, 0.2);
    for (let a = r.range(0, 6); a < length; a += r.range(4, 8)) plant(r.pick(['K_Bush', 'K_Bush_Large']), r.range(24, 70), a, r.range(1.0, 2.0), 0.8, 0.15);
    for (let a = r.range(0, 20); a < length; a += r.range(18, 34)) plant(r.pick(['K_Rocks_BigA', 'K_Rocks_Big']), r.range(34, 80), a, r.range(1.0, 2.2), 3.5, 1.2);
    // shells and starfish on the sand
    for (let a = r.range(0, 10); a < length; a += r.range(6, 14)) if (r.chance(0.6)) place(r.pick(['Shell_A', 'Shell_B', 'Starfish']), r.range(-W, W), a, 1, r.range(0, 6.28), undefined, 0.02);
    // a volleyball left on the dry sand beside the run now and then
    for (let a = r.range(8, 40); a < length - 2; a += r.range(30, 60)) if (r.chance(0.5)) place('Volleyball', r.range(W - 0.5, 9.5), a, 1);
    // one set piece per chunk at most: a beach shelter with a campfire and crates, or a lookout tower with a flag
    const sp = r.next();
    if (sp < 0.3) {
      const a = r.range(10, length - 10), x = r.range(15, 18);
      plant('K_Hut', x, a, 1, 2.2, 0.2, r.range(-0.3, 0.3));
      plant('K_Campfire', x - 3.6, a + r.range(-1, 1), 1, 0.6, 0.05);
      plant(r.pick(['K_Crate', 'K_Crate_Bottles', 'K_Barrel']), x + 0.8, a + 2.8, 1, 0.6, 0.05);
      plant('K_Barrel', x + 1.8, a - 2.6, 1, 0.5, 0.05);
      if (r.chance(0.4)) { const cx = x - 1.2, ca = a - 2.4; closedChest(d, cx, low(cx, ca, 0.5) - 0.05, ca, r.range(2.5, 3.8), 1); }
    } else if (sp < 0.5) {
      const a = r.range(10, length - 10), x = r.range(15, 18);
      plant('K_Watchtower', x, a, 1, 2.4, 0.2, r.range(0, 6.28));
      plant('K_Flag', x - 1.2, a + 3.2, 1, 0.4, 0.1, Math.PI / 2);
    } else if (sp < 0.7 && length > 30) {
      // a volleyball court on the dry sand, its net along the beach, balls lying about; the palms and grass cleared
      const a = r.range(12, length - 12), x = r.range(15.5, 17.5);
      d.props = d.props.filter((p) => !(Math.abs(p.x - x) < 4.2 && Math.abs(p.along - a) < 6.5 && /^(K_Palm|K_Bush|K_Grass|K_Flowers|Veg_)/.test(p.kit)));
      place('K_VolleyNet', x, a, 1, Math.PI / 2 + r.range(-0.06, 0.06), undefined, -0.05);
      for (let i = 0, n = r.int(2, 3); i < n; i++) place('Volleyball', x + r.sign() * r.range(1.2, 3.8), a + r.range(-4.5, 4.5), 1);
    }
    // boats pulled up on the wet sand, rocks in the surf
    if (r.chance(0.35)) plant(r.pick(['K_Rowboat', 'K_Canoe']), -r.range(8.5, 11), r.range(4, length - 4), 1, 1.2, 0.08, r.range(-0.5, 0.5) + (r.chance(0.5) ? 0 : Math.PI));
    for (let a = r.range(0, 12); a < length; a += r.range(9, 18)) {
      // rounded boulders, half sunk (Kenney's flat-topped basalt stacks read as piles of crates from the beach)
      if (r.chance(0.35)) plant('Beach_Boulder_Big', -r.range(18, 34), a, r.range(0.9, 1.5), 1.4, 0.6);
      else plant(r.pick(['Rock_Boulder', 'SRC_mk_rock_1', 'SRC_mk_rock_2', 'SRC_mk_rock_3']), -r.range(14, 30), a, r.range(0.8, 1.6), 0.8, 0.35);
    }
    // a wreck offshore every few hundred metres, settled on the sea floor
    if (Math.floor(-ctx.zStart / 260) !== Math.floor(-(ctx.zStart - length) / 260)) d.props.push(prop('K_Shipwreck', -r.range(48, 62), d.ground(-55, length / 2) - 1.2, length / 2, r.range(0.4, 1.2), r.range(1.0, 1.3)));
    // now and then a research buoy offshore
    for (let a = r.range(10, 60); a < length; a += r.range(70, 110)) { const x = -r.range(26, 36); if (d.ground(x, a) < -0.8) place(r.pick(['Research_Buoy_A', 'Research_Buoy_B']), x, a, 1, r.range(0, 6.28), undefined, -d.ground(x, a)); }
    if (r.chance(0.2)) place('Prop_Umbrella', r.range(8, 10), r.range(4, length - 4), 1, 0, [r.pick([1, 0.5, 0.3]), r.pick([0.5, 0.8, 1]), 1]);
  } else if (biome === 'surf' || biome === 'ski') {
    // Shorebreak Point (and the channel): the beach is the shore on the right (the waterline near x = 18, the beach's own ground moved 32 m
    // inland), the wave in the middle, open sea and reef on the left
    const palm = () => r.pick(['K_Palm_Bend', 'K_Palm_Bend', 'K_Palm_Straight', 'K_Palm_Small']);
    for (let a = r.range(0, 8); a < length; a += r.range(10, 17)) {
      const cx = r.range(42, 54), n = r.int(2, 4);
      for (let i = 0; i < n; i++) plant(palm(), cx + r.range(-3, 3), Math.min(length - 1, a + r.range(-3, 3)), r.range(0.7, 0.95), 0.5);
      plant(r.pick(['K_Bush', 'K_Bush_Large', 'K_Grass_Tall']), cx + r.range(-4, 4), Math.min(length - 1, a + r.range(-3, 3)), r.range(0.8, 1.3), 0.6, 0.1);
    }
    for (let a = r.range(0, 2); a < length; a += r.range(1.5, 3)) plant(r.pick(['K_Grass', 'K_Grass_Tall', 'Veg_SeaOats', 'Veg_DuneGrass']), r.range(36, 60), a, r.range(0.8, 1.4), 0.3, 0.05);
    // beach life on the sand: umbrellas, flags in a row, volleyballs, a lifeguard tower with its flag, a rental hut with
    // a rack of boards
    for (let a = r.range(4, 20); a < length - 3; a += r.range(16, 30)) place('Prop_Umbrella', r.range(22, 30), a, 1, r.range(0, 6.28), [r.pick([1, 0.5, 0.3]), r.pick([0.5, 0.8, 1]), 1]);
    for (let a = r.range(6, 30); a < length - 3; a += r.range(35, 60)) place('Volleyball', r.range(21, 28), a, 1, r.range(0, 6.28));
    const sp = r.next();
    // the rack: boards standing on their tails, leaning back a little, in a row of colours
    const rack = (x: number, a: number) => {
      const tints: [number, number, number][] = [[1, 1, 1], [0.55, 0.85, 1], [1, 0.75, 0.4], [1, 1, 1], [0.6, 1, 0.7], [1, 0.55, 0.6]];
      for (let i = 0; i < 6; i++) { const ba = a - 2.2 + i * 0.75; d.props.push(prop('Runner_Board', x, d.ground(x, ba) + 0.95, ba, Math.PI / 2, 1, { pitch: -Math.PI / 2 + 0.22, tint: tints[i] })); }
    };
    if (sp < 0.3) {
      // the lifeguard tower facing the break, its flags in a row beside it
      const a = r.range(15, length - 15), x = r.range(24, 27);
      plant('Lifeguard_Tower', x, a, 1, 2.4, 0.1, -Math.PI / 2);
      const flags: [number, number, number][] = [[1, 0.35, 0.3], [1, 0.85, 0.3], [0.55, 0.15, 0.2], [0.3, 0.8, 0.8]];
      for (let i = 0; i < 4; i++) d.props.push(prop('K_Flag', x - 1, d.ground(x - 1, a + 6 + i * 3.5) - 0.1, a + 6 + i * 3.5, Math.PI / 2, 0.8, { tint: flags[i] }));
    } else if (sp < 0.6) {
      // the Aggie Surf Club, its rack of boards beside it
      const a = r.range(15, length - 15), x = r.range(27, 30);
      plant('Aggie_Surf_Club', x, a, 1, 2.5, 0.25, -Math.PI / 2);
      rack(x - 1, a + 5.5);
    } else if (sp < 0.85) {
      const a = r.range(15, length - 15), x = r.range(28, 31);
      plant('K_Hut', x, a, 1, 2.2, 0.2, -Math.PI / 2 + r.range(-0.2, 0.2));
      rack(x - 3.6, a);
    }
    // offshore: research buoys riding the swell, reef breaking the surface further out
    for (let a = r.range(10, 50); a < length; a += r.range(60, 100)) { const x = -r.range(24, 34); if (d.ground(x, a) < -0.8) place(r.pick(['Research_Buoy_A', 'Research_Buoy_B']), x, a, 1, r.range(0, 6.28), undefined, -d.ground(x, a)); }
    for (let a = r.range(0, 20); a < length; a += r.range(18, 34)) plant(r.pick(['Reef_Rock_Low', 'Beach_Boulder_Big']), -r.range(32, 60), a, r.range(0.9, 1.6), 1.4, 0.5);
    // the shallow reef under the wave, seen through the water
    for (let a = r.range(0, 6); a < length; a += r.range(5, 10)) place(r.pick(['Coral_Table', 'Coral_Brain', 'Plant_SeaGrass', 'Plant_SeaGrass']), r.range(-18, 14), a, r.range(0.8, 1.5), r.range(0, 6.28), coralTint(ctx));
    if (biome === 'ski') {
      // the channel: boats under way out to the left, afloat (no wreck here: a half-sunk hull read as a bug)
      for (let a = r.range(10, 40); a < length - 10; a += r.range(45, 70)) d.props.push(prop(r.pick(['Boat_Research', 'K_Rowboat', 'K_Rowboat']), -r.range(22, 40), -0.25, a, r.range(0, 6.28), r.range(0.9, 1.1)));
    } else if (Math.floor(-ctx.zStart / 260) !== Math.floor(-(ctx.zStart - length) / 260)) d.props.push(prop('K_Shipwreck', -r.range(70, 90), d.ground(-80, length / 2) - 1.2, length / 2, r.range(0.4, 1.2), r.range(1.0, 1.3)));
  } else if (biome === 'pier') {
    for (let a = 2; a < length; a += 4) { place('Pier_Rail_4m', -4.1, a, 1, 0, undefined, DECK_Y - d.ground(-4.1, a)); place('Pier_Rail_4m', 4.1, a, 1, 0, undefined, DECK_Y - d.ground(4.1, a)); }
    for (let a = r.range(4, 12); a < length; a += r.range(12, 20)) place('Pier_Lantern', r.sign() * 3.6, a, 1, 0, undefined, DECK_Y - d.ground(3.6, a));
    // buoys off the pier: plain floats, and maroon-and-white ocean-monitoring buoys (waterline at the sea surface)
    for (let a = r.range(0, 10); a < length; a += r.range(14, 30)) {
      const x = r.sign() * r.range(10, 22);
      if (r.chance(0.5)) place(r.pick(['Research_Buoy_A', 'Research_Buoy_B']), x, a, 1, r.range(0, 6.28), undefined, -d.ground(x, a));
      else place('Prop_Buoy', x, a, 1, 0, undefined, -d.ground(10, a) + 0.1);
    }
  } else if (biome === 'lagoon') {
    for (let a = r.range(0, 6); a < length; a += r.range(5, 11)) { const x = r.sign() * r.range(W + 4, 30); plant(r.pick(['K_Rock_SandA', 'K_Rock_C', 'K_Rocks_Big', 'Reef_Rock_Low']), x, a, r.range(0.6, 1.4), 1.5, 0.3); }
    // (decoration stays out of the lanes: in ankle-deep water it would stand up like an obstacle you can't hit)
    for (let a = r.range(0, 4); a < length; a += r.range(1.2, 2.5)) place('Plant_SeaGrass', r.sign() * r.range(W + 1, 28), a, r.range(1.0, 1.8));
    for (let a = r.range(0, 8); a < length; a += r.range(6, 12)) place(r.pick(['Coral_Table', 'Coral_Brain']), r.sign() * r.range(W + 2, 26), a, r.range(1.2, 2.0), r.range(0, 6.28), coralTint(ctx));
    // palms on the sandy islets at the sides (the ground rises above the water around |x| = 28)
    for (let a = r.range(4, 20); a < length; a += r.range(14, 30)) { const x = r.sign() * r.range(25, 31); plant(r.pick(['K_Palm_Bend', 'K_Palm_Small']), x, a, r.range(0.9, 1.15), 0.5); plant('K_Bush', x + r.range(-2, 2), a + r.range(-2, 2), r.range(0.8, 1.2), 0.5, 0.1); }
  } else if (biome === 'coral') {
    // canyon walls stand on the canyon floor (base 3.5 m under it) so their tops stay just below the surface
    for (let a = 0; a < length; a += 20) { const gy = Math.min(d.ground(0, a + 10), -11) - 3.5; d.props.push(prop('Canyon_Wall', 22 + r.range(-2, 2), gy, a + 10, 0, r.range(0.95, 1.1))); d.props.push(prop('Canyon_Wall', -22 + r.range(-2, 2), gy, a + 10, Math.PI, r.range(0.95, 1.1))); }
    for (let a = r.range(0, 4); a < length; a += r.range(1.8, 3.5)) { const x = r.sign() * r.range(W + 1, 24); const k = r.pick(['Coral_Brain', 'Coral_Table', 'Coral_Branch', 'Coral_Fan', 'Coral_Tube']); place(k, x, a, k === 'Coral_Fan' ? r.range(1.1, 1.8) : r.range(1.5, 3.0), r.range(0, 6.28), coralTint(ctx)); }
    for (let a = r.range(0, 6); a < length; a += r.range(4, 9)) place('Plant_Kelp', r.sign() * r.range(W + 2, 22), a, r.range(0.6, 1.1));
    for (let a = r.range(0, 5); a < length; a += r.range(2, 5)) place('Plant_SeaGrass', r.range(-20, 20), a, r.range(1.4, 2.4));
    // anemones are decoration: kept small and teal so they never read as the (pale pink, floating) jellyfish hazards
    for (let a = r.range(0, 10); a < length; a += r.range(8, 16)) place('Anemone', r.sign() * r.range(W + 1.5, 20), a, r.range(0.7, 1.0), r.range(0, 6.28), [0.45, 1.0, 0.8]);
    for (let a = r.range(5, 20); a < length; a += r.range(16, 30)) place(r.pick(['Reef_Stack_02', 'Reef_Stack_04', 'Reef_Stack_06']), r.sign() * r.range(30, 40), a, r.range(0.5, 0.8));
  } else if (biome === 'grotto') {
    // a sea cave: walls rise from the cave floor and the roof arches just break the surface
    for (let a = 0; a < length; a += 20) { const gy = Math.min(d.ground(0, a + 10), -16) - 2.5; d.props.push(prop('Cave_Wall', 11.5, gy, a + 10, 0, 1)); d.props.push(prop('Cave_Wall', -11.5, gy, a + 10, Math.PI, 1)); }
    // the roof: rock slabs with stalactites, end to end
    for (let a = 0; a < length; a += 21) d.props.push(prop('Cave_Roof', 0, GROTTO_ROOF, a + 10.5, r.pick([0, Math.PI]), 1));
    for (let a = r.range(0, 6); a < length; a += r.range(4, 9)) place('Glow_Coral', r.sign() * r.range(W, 10.5), a, r.range(0.8, 1.5));
    for (let a = r.range(0, 8); a < length; a += r.range(6, 12)) place(r.pick(['Rock_Boulder', 'Rock_Slab']), r.sign() * r.range(W + 0.5, 10), a, r.range(0.8, 1.4), r.range(0, 6.28), [0.55, 0.6, 0.72]);
    for (let a = r.range(0, 10); a < length; a += r.range(8, 20)) place('Barrel', r.sign() * r.range(W, 9.5), a, 1, r.range(0, 6.28), [0.6, 0.6, 0.65]);
  }
}

// ---------------------------------------------------------------- lane coins
/** the surface the runner stands on (deck where there is one) */
export const surfAt = (d: ChunkData, x: number, a: number) => (d.floor ? d.floor(x, a) : null) ?? d.ground(x, a);
/** a straight line of coins down one lane at hip height */
export function laneCoins(d: ChunkData, x: number, a0: number, a1: number, spacing = 3, value = 10, risky = false) {
  if (a1 <= a0) return;
  pearls(d, a0, a1, () => x, (t) => surfAt(d, x, a0 + (a1 - a0) * t) + 1.0, spacing, value, risky);
}
/** an arc of coins over a jumpable obstacle at `a`, on the hip's path for a jump centred on it at the chunk's speed */
export function jumpArc(d: ChunkData, ctx: PatternCtx, x: number, a: number, value = 15, risky = false) {
  const half = (ctx.speed * MOVE.jumpTime) / 2;
  for (const u of [-0.75, -0.4, 0, 0.4, 0.75]) {
    const along = a + u * half;
    d.pearls.push({ x, y: surfAt(d, x, along) + 0.95 + MOVE.jumpHeight * (1 - u * u), along, value, risky });
  }
}
/** low coins to collect while sliding under something at `a` */
export function slideCoins(d: ChunkData, x: number, a: number, value = 15) {
  pearls(d, a - 2, a + 2, () => x, () => surfAt(d, x, a) + 0.5, 2, value);
}
