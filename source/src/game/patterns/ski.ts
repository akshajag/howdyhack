import type { ChunkData, Pattern, PatternCtx } from '../types';
import { GROUND, WIDTH, DECK_Y, empty, worldGround, blendGround, prop, box, current, lerp, smooth, dressSides, laneCoins, pearls } from './lib';

/**
 * Bolivar Channel: the jet ski run. Open water between the beach and the shipping channel, no lanes: you steer freely
 * across a 14 m channel (A / D held, or where your hand / body is), about half as fast again as on foot. In the water:
 * mooring buoys and channel markers to weave round, floating logs to hop, fishing lines strung between moored boats to
 * duck under, boat wakes that throw you into a little air, and floating ramps for a big one (a backflip, with coins
 * through the arc). You get on at a rental dock (off the beach or the end of the pier) and get off by beaching the ski
 * on a sandbar (back to the beach) or ditching it over the reef (a dive). The 12th Tide here is a storm of wakes.
 * Fairness: the ski validator (validate.ts) slices the channel along the chunk and keeps the stretches you can reach by
 * steering; hops and ducks don't count as blocks.
 */
const L = 150;
const W = WIDTH.ski;                                 // half the channel (m)

const RAMP_LEN = 4.5, RAMP_RISE = 1.3, RAMP_LOW = 0.22;
function base(ctx: PatternCtx): ChunkData {
  const d = empty(W, 'deep', worldGround(GROUND.ski, ctx.zStart));
  const ramps: { x: number; a: number }[] = [];
  (d as ChunkData & { ramps: typeof ramps }).ramps = ramps;
  // the water is the floor (coins settle on it), and a ramp's planks where there is one: you ride up it
  d.floor = (x, a) => { for (const r of ramps) if (Math.abs(x - r.x) <= 2 && a >= r.a - 0.2 && a <= r.a + RAMP_LEN + 0.1) return RAMP_LOW + RAMP_RISE * Math.min(1, Math.max(0, (a - r.a) / RAMP_LEN)); return 0; };
  return d;
}

/** a mooring buoy: go round it */
function buoy(d: ChunkData, ctx: PatternCtx, x: number, a: number) {
  d.props.push(prop('Prop_Buoy', x, 0, a, ctx.rng.range(0, 6.28), 1.3, { roll: 0.08 }));
  d.props.push(prop('Foam_Ring', x, 0.03, a, 0, 0.5));
  d.obstacles.push(box(x, -0.3, a, 1.0, 3.0, 1.0, 'blocker', { name: 'HIT A BUOY' }));
}
/** a channel marker post: go round it */
function marker(d: ChunkData, ctx: PatternCtx, x: number, a: number) {
  d.props.push(prop('Pier_Post', x, -0.6, a, ctx.rng.range(0, 6.28), 1.6));
  d.props.push(prop('Foam_Ring', x, 0.03, a, 0, 0.35));
  d.obstacles.push(box(x, -0.6, a, 0.7, 2.6, 0.7, 'blocker', { name: 'HIT A CHANNEL MARKER' }));
}
/** a floating log lying across your way: hop it */
function log(d: ChunkData, ctx: PatternCtx, x: number, a: number) {
  const yaw = ctx.rng.range(-0.25, 0.25);
  d.props.push(prop('K_Log', x, -0.28, a, yaw, 1.2));                    // (the model's length runs across already)
  d.obstacles.push(box(x, -0.28, a, 2.6, 0.62, 0.8, 'wood', { name: 'HIT A LOG' }, yaw));
}
/** a fishing line strung between two moored boats, 1.2 m over the water: duck under it (the boats block the ends) */
function line(d: ChunkData, ctx: PatternCtx, cx: number, a: number) {
  const span = 6;
  for (const s of [-1, 1]) {
    const bx = cx + s * (span / 2 + 1.3);
    d.props.push(prop('K_Rowboat', bx, -0.1, a, Math.PI / 2 + ctx.rng.range(-0.2, 0.2), 1));
    d.obstacles.push(box(bx, -0.3, a, 1.4, 1.1, 2.6, 'blocker', { name: 'HIT A BOAT' }));
  }
  d.props.push(prop('Beam_Low', cx, -0.05, a, 0, span / 2.6, { sy: 0.5 }));
  d.obstacles.push(box(cx, 1.15, a, span, 0.4, 0.4, 'line', { name: 'CAUGHT A FISHING LINE' }));
}
/** a boat's wake across the whole channel: a soft ridge that throws you up for a moment (no harm) */
function wake(d: ChunkData, a: number) {
  for (let x = -W - 1; x <= W + 1; x += 1.6) d.props.push(prop('Foam_Ring', x, 0.05, a + Math.sin(x * 0.7) * 0.3, x * 3, 0.8));
  d.obstacles.push(box(0, -0.4, a, 2 * W + 3, 0.7, 1.6, 'wake', { name: 'WAKE', lethal: false, nearMiss: false }));
}
/** a floating ramp: you ride up its planks and fly off the lip into a big air with a backflip; coins through the arc */
function ramp(d: ChunkData, ctx: PatternCtx, x: number, a: number) {
  (d as ChunkData & { ramps: { x: number; a: number }[] }).ramps.push({ x, a });
  d.props.push(prop('Ski_Ramp', x, -0.1, a + 0.5, 0, 1));
  // the launch: a soft box just past the lip, at the height you leave it
  d.obstacles.push(box(x, RAMP_LOW + RAMP_RISE - 0.3, a + RAMP_LEN + 0.5, 4.0, 1.6, 0.8, 'ramp', { name: 'RAMP', lethal: false, nearMiss: false }));
  const G = 2 * 1.9 / Math.pow(0.85 / 2, 2), vy = 10.45, v = ctx.speed * 1.45, y0 = RAMP_LOW + RAMP_RISE + 0.95;
  for (let t = 0.12; t < 1.3; t += 0.11) { const y = y0 + vy * t - 0.5 * G * t * t; if (y < 1.3) break; d.pearls.push({ x, y, along: a + RAMP_LEN + 0.6 + v * t, value: 20, risky: true }); }
}

export const skiPatterns: Pattern[] = [
  {
    // 1. Open Channel: buoys and markers to weave, logs to hop
    id: 'ski_open', biome: 'ski', mode: 'ski', length: L, weight: 3, tiers: [0, 4], from: 'ski', to: 'ski',
    build(ctx) {
      const r = ctx.rng; const d = base(ctx);
      d.events.push({ kind: 'zone', along: 2, label: 'BOLIVAR CHANNEL', sub: 'steer freely: hold A / D, or lean' });
      const gap = Math.max(16, ctx.speed * 1.45 * 0.8 * ctx.spacing);
      for (let a = 24; a < L - 14; a += gap) {
        const n = r.chance(0.4 + 0.1 * ctx.tier) ? 2 : 1;
        const xs = n === 2 ? [r.range(-5.5, -1.5), r.range(1.5, 5.5)] : [r.range(-4.5, 4.5)];
        for (const x of xs) { if (r.chance(0.55)) buoy(d, ctx, x, a); else if (r.chance(0.5)) marker(d, ctx, x, a); else log(d, ctx, x, a); }
      }
      laneCoins(d, r.range(-3, 3), 8, 40, 3);
      pearls(d, 50, L - 10, (t) => Math.sin(t * 7) * 4, () => 1.0, 3, 10);
      dressSides(d, ctx, 'ski', L);
      return d;
    },
  },
  {
    // 2. Wakes: boats criss-crossing, their wakes across the channel and lines strung between them
    id: 'ski_wakes', biome: 'ski', mode: 'ski', length: L, weight: 3, tiers: [1, 4], from: 'ski', to: 'ski',
    build(ctx) {
      const r = ctx.rng; const d = base(ctx);
      const gap = Math.max(20, ctx.speed * 1.45 * 0.95 * ctx.spacing);
      let k = 0;
      for (let a = 26; a < L - 14; a += gap, k++) {
        if (k % 3 === 2) { line(d, ctx, r.range(-2.5, 2.5), a); }
        else { wake(d, a); if (r.chance(0.5)) buoy(d, ctx, r.sign() * r.range(2, 5.5), a + gap * 0.5); }
      }
      // a boat going by in the distance
      d.props.push(prop('Boat_Research', 24, -0.3, r.range(40, 100), 0.3, 0.9));
      pearls(d, 10, L - 10, (t) => Math.sin(t * 5) * 3.5, () => 1.0, 3, 10);
      dressSides(d, ctx, 'ski', L);
      return d;
    },
  },
  {
    // 3. Ramps: floating ramps for big air, buoys in between
    id: 'ski_ramps', biome: 'ski', mode: 'ski', length: L, weight: 2, tiers: [1, 4], from: 'ski', to: 'ski',
    build(ctx) {
      const r = ctx.rng; const d = base(ctx);
      const gap = Math.max(34, ctx.speed * 1.45 * 1.4 * ctx.spacing);
      for (let a = 26; a < L - 30; a += gap) {
        const x = r.range(-3.5, 3.5);
        ramp(d, ctx, x, a);
        if (r.chance(0.6)) buoy(d, ctx, x + (x > 0 ? -1 : 1) * r.range(5, 6.5), a + gap * 0.5);
      }
      d.riskyLine = { x0: -1, x1: 1, along0: 10, along1: L - 10, bonus: 150 };
      dressSides(d, ctx, 'ski', L);
      return d;
    },
  },
  {
    id: 'ski_calm', biome: 'ski', mode: 'ski', length: 90, weight: 1, tiers: [0, 1], from: 'ski', to: 'ski',
    build(ctx) { const d = base(ctx); pearls(d, 8, 80, (t) => Math.sin(t * 6) * 3, () => 1.0, 3, 10); dressSides(d, ctx, 'ski', 90); return d; },
  },
];

const T = (id: string, from: Pattern['biome'], to: Pattern['biome'], mode: Pattern['mode'], length: number, build: Pattern['build']): Pattern =>
  ({ id, biome: from, mode, length, weight: 1, tiers: [0, 4], role: 'transition', from, to, build });

/** a floating dock: a plank walkway over the water on posts, rails along it; `skiAt`: a ski tied up at that along */
function dock(d: ChunkData, a0: number, a1: number, y: number, skiAt: number | null = a1 + 1.6) {
  for (let a = a0; a < a1; a += 4) { d.props.push(prop('Pier_Deck', 0, y, a, 0, 1)); d.props.push(prop('Pier_Rail_4m', -4.1, y, a, 0, 1), prop('Pier_Rail_4m', 4.1, y, a, 0, 1)); }
  for (const a of [a0 + 0.5, a1 - 0.5]) for (const x of [-3.9, 3.9]) d.props.push(prop('Pier_Post', x, -1.2, a, 0, 1.3));
  if (skiAt !== null) d.props.push(prop('Jet_Ski', 0, 0, skiAt, 0, 1));
  d.props.push(prop('K_Flag', 3.6, y - 0.1, a0 + 2, Math.PI / 2, 0.8, { tint: [0.31, 0, 0] }));
}

export const skiTransitions: Pattern[] = [
  // beach -> channel: the sand runs down to a rental dock; along it and onto the ski
  T('t_beach_ski', 'beach', 'ski', 'surf', 72, (ctx) => {
    const L2 = 72, MOUNT = 26;
    const d = empty(WIDTH.beach, 'deep', blendGround(GROUND.beach, GROUND.ski, ctx.zStart, L2, (t) => smooth(0.12, 0.42, t)));
    d.floor = (x, a) => (a >= 8 && a < MOUNT ? (Math.abs(x) <= 4.2 ? 0.9 : null) : a >= MOUNT ? 0 : null);
    d.ski = { mount: MOUNT };
    dock(d, 8, MOUNT, 0.9);
    laneCoins(d, 0, 10, MOUNT - 3, 3);
    pearls(d, MOUNT + 8, L2 - 4, () => 0, () => 1.0, 3, 10);
    d.events.push({ kind: 'zone', along: 2, label: 'JET SKI RENTAL', sub: '' });
    dressSides(d, ctx, 'ski', L2);
    return d;
  }),
  // pier -> channel: the deck slopes down to the water, the ski waits at the bottom
  T('t_pier_ski', 'pier', 'ski', 'surf', 72, (ctx) => {
    const L2 = 72, RAMP0 = 10, RAMP1 = 22, MOUNT = 24;
    const d = empty(WIDTH.pier + 1, 'deep', blendGround(GROUND.pier, GROUND.ski, ctx.zStart, L2, (t) => smooth(0.25, 0.7, t)));
    const deckY = (a: number) => lerp(DECK_Y, 0.85, smooth(RAMP0, RAMP1, a));
    d.floor = (x, a) => (a < MOUNT ? (Math.abs(x) <= 4.2 ? deckY(a) : null) : 0);
    d.ski = { mount: MOUNT };
    for (let a = 2; a < MOUNT; a += 4) {
      const pitch = a > RAMP0 - 2 && a < RAMP1 ? -Math.atan((DECK_Y - 0.85) / (RAMP1 - RAMP0)) : 0;
      d.props.push(prop('Pier_Deck', 0, deckY(a), a, 0, 1, { pitch }));
      d.props.push(prop('Pier_Rail_4m', -4.1, deckY(a), a, 0, 1, { pitch }), prop('Pier_Rail_4m', 4.1, deckY(a), a, 0, 1, { pitch }));
    }
    d.props.push(prop('Jet_Ski', 0, 0, MOUNT + 1.6, 0, 1));
    laneCoins(d, 0, 4, MOUNT - 2, 3);
    pearls(d, MOUNT + 8, L2 - 4, () => 0, () => 1.0, 3, 10);
    d.events.push({ kind: 'zone', along: 2, label: 'JET SKI RENTAL', sub: '' });
    dressSides(d, ctx, 'pier', MOUNT);
    return d;
  }),
  // channel -> beach: a dock at the shore. Pull up, hop off onto it (the ski is left tied up), run along it and down
  // onto the sand
  T('t_ski_beach', 'ski', 'beach', 'ski', 80, (ctx) => {
    const L2 = 80, LAND = 34, DOCK1 = 54, DY = 0.85, RAMP = 6;
    // the sand is there by the dock's end; its last planks slope down to meet it, so you run straight off onto the beach
    const d = empty(W, 'shallow', blendGround(GROUND.ski, GROUND.beach, ctx.zStart, L2, (t) => smooth(0.28, 0.62, t)));
    const sandY = (x: number) => d.ground(x, DOCK1 + 0.5);
    const deckY = (x: number, a: number) => (a < DOCK1 - RAMP ? DY : lerp(DY, sandY(x) + 0.03, (a - (DOCK1 - RAMP)) / RAMP));
    d.floor = (x, a) => (a < LAND ? 0 : a < DOCK1 ? (Math.abs(x) <= 4.2 ? deckY(x, a) : null) : null);
    d.ski = { land: LAND };
    dock(d, LAND, DOCK1 - RAMP, DY, null);
    const pitch = Math.atan((DY - sandY(0) - 0.03) / RAMP);
    d.props.push(prop('Pier_Deck', 0, deckY(0, DOCK1 - RAMP + 2), DOCK1 - RAMP + 2, 0, 1, { pitch }));
    d.props.push(prop('Pier_Deck', 0, deckY(0, DOCK1 - 2), DOCK1 - 2, 0, 1, { pitch }));
    d.props.push(prop('K_Flag', -3.6, sandY(-3.6), DOCK1 + 3, Math.PI / 2, 0.8, { tint: [0.31, 0, 0] }), prop('Prop_Umbrella', 6, sandY(6), DOCK1 + 8, 0.4, 1, { tint: [0.31, 0, 0] }));
    d.events.push({ kind: 'zone', along: DOCK1 + 2, label: 'BACK ON THE SAND', sub: '' });
    d.props.push(prop('Jet_Ski', 5.4, 0, LAND + 2, 0.25, 1));                 // (yours, tied up alongside)
    pearls(d, 6, LAND - 6, (t) => Math.sin(t * 4) * 2, () => 1.0, 3, 10);
    laneCoins(d, 0, LAND + 4, DOCK1 - 2, 3);
    laneCoins(d, 0, DOCK1 + 4, L2 - 2, 3);
    d.events.push({ kind: 'zone', along: LAND - 14, label: 'THE DOCK', sub: 'pull up and hop off' });
    dressSides(d, ctx, 'beach', L2);
    return d;
  }),
  // channel -> reef: a dock out over the reef. Hop off onto it, run to its end and dive
  T('t_ski_dive', 'ski', 'coral', 'ski', 76, (ctx) => {
    const L2 = 76, LAND = 32, DOCK1 = 50, DY = 0.85;
    const d = empty(W, 'deep', blendGround(GROUND.ski, GROUND.coral, ctx.zStart, L2, (t) => smooth(0.3, 0.9, t)));
    d.floor = (x, a) => (a < LAND ? 0 : a < DOCK1 ? (Math.abs(x) <= 4.2 ? DY : null) : null);
    d.deckEnd = DOCK1;
    d.ski = { land: LAND };
    dock(d, LAND, DOCK1, DY, null);
    d.props.push(prop('Jet_Ski', 5.4, 0, LAND + 2, 0.25, 1));
    d.currents.push(current(-14, 14, DOCK1 + 2, L2, 0, 2.5, -1.6, { visible: false }));
    pearls(d, 6, LAND - 6, (t) => Math.sin(t * 4) * 2, () => 1.0, 3, 10);
    laneCoins(d, 0, LAND + 4, DOCK1 - 2, 3);
    for (let a = DOCK1 + 5; a < L2 - 2; a += 3) d.pearls.push({ x: 0, y: -1.5 - (a - DOCK1) * 0.15, along: a, value: 15 });
    d.events.push({ kind: 'zone', along: LAND - 14, label: 'THE DOCK', sub: 'pull up, hop off, dive off the end' });
    const n0 = d.props.length;
    dressSides(d, ctx, 'coral', L2);
    d.props = d.props.filter((p, i) => i < n0 || d.ground(p.x, p.along) < -2.5);
    return d;
  }),
];

/** the 12th Tide on the channel: a storm of wakes and loose buoys; the pink line down the middle pays double */
export const skiSurge: Pattern[] = [
  {
    id: 's_ski_storm', biome: 'ski', mode: 'ski', length: 160, weight: 1, tiers: [0, 4], role: 'surge', from: 'ski', to: 'ski',
    build(ctx) {
      const r = ctx.rng, L2 = 160; const d = base(ctx);
      d.events.push({ kind: 'tide12', along: 4 });
      d.currents.push(current(-W, W, 0, L2, 0, 4, 0));
      const gap = Math.max(18, ctx.speed * 1.45 * 0.9 * ctx.spacing);
      let k = 0;
      for (let a = 24; a < L2 - 16; a += gap, k++) {
        if (k % 2 === 0) wake(d, a);
        else { const x = r.sign() * r.range(2.5, 5.5); buoy(d, ctx, x, a); if (r.chance(0.5)) log(d, ctx, -Math.sign(x) * r.range(2, 5), a + 2); }
      }
      pearls(d, 10, L2 - 10, () => 0, () => 1.0, 3, 15, true);
      d.riskyLine = { x0: -1.2, x1: 1.2, along0: 4, along1: L2 - 6, bonus: 200 };
      dressSides(d, ctx, 'ski', L2);
      return d;
    },
  },
];
