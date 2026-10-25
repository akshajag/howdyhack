import type { ChunkData, Pattern, PatternCtx, Biome } from '../types';
import { rowGap, firstRow } from './lib';
import { GROUND, GROTTO_ROOF, WIDTH, DECK_Y, empty, blendGround, worldGround, current, pearls, dressSides, prop, lerp, smooth, jelly, barrel, box, M, rock, lane, laneRock, laneCoins, jumpArc, reefGate, cargo, kitSolids, mine, mineTop, chain } from './lib';

/**
 * Transition chunks join biomes with physically sensible ramps, and the 12th Tide surge chunks flood whatever biome
 * the player is in (the tide manager raises the sea level while they are active).
 */
const T = (id: string, from: Biome, to: Biome, mode: Pattern['mode'], length: number, build: Pattern['build'], tiers: [number, number] = [0, 4]): Pattern =>
  ({ id, biome: from, mode, length, weight: 1, tiers, role: 'transition', from, to, build });

/** forward speed of the 12th Tide's rip current under water (m/s, on top of the swim speed) */
const RIP = 7;
/** The 12th Tide under water: the rip carries you through reef gates. Each gate seals the canyon (there is no quiet
 *  edge to hide on), each hole is within easy reach of the last, wreckage tumbles across the line between them, and
 *  the coins only follow that line; on a twin gate the harder (higher) hole carries the pink risky coins and a
 *  jellyfish. The holes keep their pulls but not their jets: the rip is fast enough. */
function ripGates(d: ChunkData, ctx: PatternCtx, first: number, length: number, hazard: 'cargo' | 'rock') {
  const r = ctx.rng, m = M(ctx);
  const LV = ['Reef_Gate_Low', 'Reef_Gate_Mid', 'Reef_Gate_High'] as const;
  const spacing = Math.max(30, (ctx.speed + RIP) * 1.5) * ctx.spacing;
  let cx = r.range(-1.5, 1.5), level = 1;
  const line: { x: number; y: number; along: number }[] = [];
  for (let a = first; a <= length - 14; a += spacing) {
    const n0 = d.rings?.length ?? 0;
    const twin = line.length > 0 && r.chance(0.4);
    reefGate(d, twin ? 'Reef_Gate_Twin' : LV[level], m(cx), a, r.chance(0.5), undefined, 'pull');
    const rings = d.rings!.slice(n0);
    if (twin) {
      const hi = rings.reduce((p, q) => (q.y > p.y ? q : p));
      pearls(d, a - 9, a + 2, () => hi.x, () => hi.y, 2.6, 25, true);
      line.push(rings.find((q) => q !== hi) ?? hi);
    } else line.push(rings[0]);
    cx = Math.max(-3, Math.min(3, cx + r.range(-2.5, 2.5)));
    level = Math.max(0, Math.min(2, level + r.int(-1, 1)));
  }
  for (let i = 0; i + 1 < line.length; i++) {
    // the hazard sits a third of the way along, so there is time to line up with the next hole after dodging it
    const A = line[i], B = line[i + 1], mid = A.along + (B.along - A.along) * 0.35;
    const lx = A.x + (B.x - A.x) * 0.35, ly = A.y + (B.y - A.y) * 0.35;
    // cargo tumbling in the rip just under the line (rise over it), or a rock pillar beside it
    if (hazard === 'cargo') cargo(d, ctx, lx + r.range(-1, 1), ly - 1.6, mid, 1.8, 3);
    else rock(d, ctx, lx + r.sign() * r.range(0.8, 1.6), mid, 'medium', true);
    pearls(d, A.along + 4, B.along - 11, (t) => A.x + (B.x - A.x) * t, (t) => A.y + (B.y - A.y) * t, 3, 15);
  }
}

/** coral-canyon dressing for a chunk that is partly land: anything that would stand above the water is dropped */
function underwaterDressing(d: ChunkData, ctx: PatternCtx, length: number) {
  const n0 = d.props.length;
  dressSides(d, ctx, 'coral', length);
  d.props = d.props.filter((p, i) => i < n0 || d.ground(p.x, p.along) < -1.2);
}

export const transitionPatterns: Pattern[] = [
  // beach -> pier: a boardwalk ramp climbs onto the deck
  T('t_beach_pier', 'beach', 'pier', 'run', 40, (ctx) => {
    const d = empty(WIDTH.pier + 1, 'none', blendGround(GROUND.beach, GROUND.pier, ctx.zStart, 40, (t) => smooth(0.45, 1, t)));
    const g0 = GROUND.beach(0, ctx.zStart);
    const rampY = (along: number) => lerp(g0, DECK_Y, smooth(8, 22, along));
    // the ramp is walkable from the sand (along < 8 falls back to the beach ground); the deck starts at 8 m
    d.floor = (x, along) => (Math.abs(x) > 4.4 || along < 8 ? null : rampY(along));
    for (let a = 10; a < 40; a += 4) { const t = smooth(8, 22, a); d.props.push(prop('Pier_Deck', 0, rampY(a), a, 0, 1, { pitch: -(DECK_Y - g0) / 14 * (t < 1 ? 1 : 0) })); }
    for (let a = 10; a < 40; a += 4) { d.props.push(prop('Pier_Rail_4m', -4.1, rampY(a), a, 0, 1)); d.props.push(prop('Pier_Rail_4m', 4.1, rampY(a), a, 0, 1)); }
    d.props.push(prop('Pier_Post', -4.6, g0, 8, 0, 1)); d.props.push(prop('Pier_Post', 4.6, g0, 8, 0, 1));
    pearls(d, 4, 36, () => 0, (t) => (rampY(4 + 32 * t) > g0 ? rampY(4 + 32 * t) : d.ground(0, 4 + 32 * t)) + 1, 3, 10);
    return d;
  }),
  // pier -> coral: the deck ends over open sea; run off the end and dive (no fall: the deck is over)
  T('t_pier_dive', 'pier', 'coral', 'surf', 48, (ctx) => {
    const d = empty(WIDTH.coral, 'deep', blendGround(GROUND.pier, GROUND.coral, ctx.zStart, 48, (t) => smooth(0.25, 0.75, t)));
    d.floor = (x, along) => (along < 14 && Math.abs(x) <= 4.2 ? DECK_Y : null);
    d.deckEnd = 14;
    for (let a = 2; a < 14; a += 4) d.props.push(prop(a > 8 ? 'Pier_Deck_Broken' : 'Pier_Deck', 0, DECK_Y, a, 0, 1));
    d.props.push(prop('Pier_Post', -3.8, DECK_Y, 12, 0, 1)); d.props.push(prop('Pier_Post', 3.8, DECK_Y, 12, 0, 1));
    d.events.push({ kind: 'zone', along: 8, label: 'END OF THE PIER', sub: '' });
    d.currents.push(current(-10, 10, 18, 42, 0, 3, -2.4, { visible: false }));
    pearls(d, 4, 13, () => 0, () => DECK_Y + 1.0, 3, 10);
    pearls(d, 22, 44, () => 0, (t) => -2.5 - 3 * t, 2.8, 15);
    dressSides(d, ctx, 'coral', 48);
    return d;
  }),
  // beach -> coral: run down the shore into the sea; the floor drops away and the current pulls you under
  T('t_beach_dive', 'beach', 'coral', 'surf', 56, (ctx) => {
    const d = empty(WIDTH.coral, 'deep', blendGround(GROUND.beach, GROUND.coral, ctx.zStart, 56, (t) => smooth(0.2, 0.7, t)));
    d.currents.push(current(-10, 10, 14, 44, 0, 3.5, -2.6, { visible: false }));
    pearls(d, 4, 50, () => 0, (t) => Math.max(d.ground(0, 4 + 46 * t) + 1.0, Math.min(1.0, -1 - 8 * smooth(0.25, 0.7, t))), 2.5, 15);
    dressSides(d, ctx, 'beach', 12);
    underwaterDressing(d, ctx, 56);
    return d;
  }),
  // coral -> beach: a tidal surge lifts you up the slope; you surface and run up the sand
  T('t_surface_beach', 'coral', 'beach', 'swim', 64, (ctx) => {
    const d = empty(WIDTH.coral, 'deep', blendGround(GROUND.coral, GROUND.beach, ctx.zStart, 64, (t) => smooth(0.15, 0.75, t)));
    d.events.push({ kind: 'surgeExit', along: 6, label: 'TIDAL SURGE', sub: 'Ride it up' });
    d.currents.push(current(-10, 10, 4, 50, 0, 5, 2.2, { y0: -14, y1: 1 }));
    // a drift toward the middle on the way up, so you come ashore near the centre lane
    d.currents.push(current(-14, -2, 20, 50, 1.6, 0, 0, { visible: false })); d.currents.push(current(2, 14, 20, 50, -1.6, 0, 0, { visible: false }));
    for (let a = 18; a < 38; a += 10) jelly(d, ctx, M(ctx)(ctx.rng.range(-5, 5)), -4 + ctx.rng.range(-1.5, 1.5), a);
    pearls(d, 6, 60, () => 0, (t) => Math.min(d.ground(0, 6 + 54 * t) + 3.5, Math.max(d.ground(0, 6 + 54 * t) + 1.0, -1.6)), 3, 15);
    underwaterDressing(d, ctx, 64);
    const n1 = d.props.length;
    dressSides(d, ctx, 'beach', 64);
    d.props = d.props.filter((p, i) => i < n1 || p.kit.startsWith('Island_Far') || d.ground(p.x, p.along) > -0.3);   // beach dressing only on land
    return d;
  }),
  // coral -> grotto: the canyon floor slopes away into the dark; swim down the slope (a down-current helps) to the cave
  // mouth, a rock wall with one wide arch, and in under the roof
  T('t_cave_mouth', 'coral', 'grotto', 'swim', 68, (ctx) => {
    const d = empty(WIDTH.coral, 'deep', blendGround(GROUND.coral, GROUND.grotto, ctx.zStart, 68, (t) => smooth(0.12, 0.6, t)));
    const MOUTH = 44;
    d.ceiling = (_x, along) => (along >= MOUTH - 1 ? GROTTO_ROOF : Infinity);
    d.currents.push(current(-12, 12, 8, MOUTH - 4, 0, 1.0, -2.2, { y0: -24, y1: 0, visible: false }));
    const base = d.ground(0, MOUTH) - 1.0;
    d.props.push(prop('Cave_Mouth', 0, base, MOUTH, 0, 1));
    kitSolids(d, 'Cave_Mouth', 0, base, MOUTH, 1, 'rock', `mouth${ctx.zStart}`, false, 'HIT THE CAVE WALL');
    // the arch counts as a gate: swimming through it refills your air before the dark (it's the only way in, so the
    // ring is generous enough to cover the whole opening)
    (d.rings ??= []).push({ x: 0, y: base + 4.75, along: MOUTH, r: 8 });
    for (let a = MOUTH + 3; a < 68; a += 21) d.props.push(prop('Cave_Roof', 0, GROTTO_ROOF, a + 10.5, 0, 1));
    d.props.push(prop('Cave_Wall', 11.5, base - 1.5, 62, 0, 1)); d.props.push(prop('Cave_Wall', -11.5, base - 1.5, 62, Math.PI, 1));
    d.props.push(prop('Glow_Coral', -5.5, d.ground(-5.5, MOUTH + 6), MOUTH + 6, 0, 1.3)); d.props.push(prop('Glow_Coral', 5.5, d.ground(5.5, MOUTH + 9), MOUTH + 9, 2, 1.1));
    // coins lead down the slope and through the middle of the arch
    pearls(d, 6, 66, () => 0, (t) => { const a = 6 + 60 * t; return Math.max(d.ground(0, a) + 2.0, lerp(-5, base + 4.5, smooth(0.05, 0.6, t))); }, 3, 12);
    d.events.push({ kind: 'zone', along: 30, label: 'SHIPWRECK GROTTO', sub: '' });
    // mines moored down the slope (clear of the last stretch to the arch)
    for (let a = 10; a < MOUTH - 10; a += ctx.rng.range(4, 6)) for (let k = 0; k < 2; k++) {
      const x = ctx.rng.range(-8, 8), lo = d.ground(x, a) + 1.6;
      mine(d, ctx, x, ctx.rng.range(lo, Math.max(lo, Math.min(mineTop(d, x, a), lo + 7))), a + ctx.rng.range(-1, 1));
    }
    underwaterDressing(d, ctx, MOUTH - 6);
    return d;
  }, [2, 4]),
  // grotto -> coral: out from under the roof and up the slope into the light (an up-current helps)
  T('t_cave_exit', 'grotto', 'coral', 'swim', 60, (ctx) => {
    const d = empty(WIDTH.coral, 'deep', blendGround(GROUND.grotto, GROUND.coral, ctx.zStart, 60, (t) => smooth(0.25, 0.8, t)));
    d.ceiling = (_x, along) => (along < 20 ? GROTTO_ROOF : Infinity);
    d.props.push(prop('Cave_Roof', 0, GROTTO_ROOF, 10.5, 0, 1));
    d.props.push(prop('Cave_Wall', 11.5, -20.5, 10, 0, 1)); d.props.push(prop('Cave_Wall', -11.5, -20.5, 10, Math.PI, 1));
    d.currents.push(current(-12, 12, 18, 52, 0, 1.0, 2.0, { y0: -24, y1: 0, visible: false }));
    d.events.push({ kind: 'zone', along: 26, label: 'BACK TO THE LIGHT', sub: '' });
    // chains hanging from the last of the roof
    for (const x of [-6, -2, 2.5, 6.5]) chain(d, x + ctx.rng.range(-1, 1), ctx.rng.range(6, 17), GROTTO_ROOF, ctx.rng.range(3.5, 5.5), true);
    pearls(d, 6, 56, () => 0, (t) => Math.max(d.ground(0, 6 + 50 * t) + 2.5, lerp(-14, -5, smooth(0.25, 0.85, t))), 3, 12);
    underwaterDressing(d, ctx, 60);
    return d;
  }, [2, 4]),
];

/** The 12th Tide: three chunks. Land biomes flood (sea level +1.3 m); water biomes become a rip. */
const S = (id: string, from: Biome, to: Biome, mode: Pattern['mode'], length: number, build: Pattern['build']): Pattern =>
  ({ id, biome: from, mode, length, weight: 1, tiers: [0, 4], role: 'surge', from, to, build });

/** sea level during a land surge (the tide manager raises the water to this) */
export const SURGE_LEVEL = 1.3;
/** the lanes rise to a sandbar under the surge so the flood is shin-deep: rocks and barrels stay visible above
 *  the water and floating logs ride the surface at jump height */
const FLOOD_FLOOR = 0.85;
function floodGround(from: Biome, ctx: PatternCtx, length: number, flatten: (t: number) => number) {
  const g = GROUND[from];
  return (x: number, along: number) => { const z = ctx.zStart - along; const base = g(x, z); const t = flatten(along / length); const lane = smooth(14, 6, Math.abs(x)); return lerp(base, FLOOD_FLOOR, t * lane); };
}
/** a log floating on the surge's surface across one lane (jump it) */
function floatLog(d: ReturnType<typeof empty>, x: number, along: number) {
  const y = SURGE_LEVEL - 0.2;
  d.props.push(prop('K_Log', x, y, along, 0, 1));
  d.obstacles.push(box(x, y, along, 2.3, 0.57, 0.78, 'wood'));
}

export const surgePatterns: Pattern[] = [
  ...(['beach', 'pier'] as Biome[]).flatMap((from) => [
    S(`s_arrive_${from}`, from, 'beach', 'run', 48, (ctx) => {
      const d = empty(8, 'shallow', floodGround(from, ctx, 48, (t) => smooth(from === 'pier' ? 0.02 : 0.2, from === 'pier' ? 0.28 : 0.7, t)));
      if (from === 'pier') d.floor = (x, along) => (Math.abs(x) <= 4.2 && along < 16 ? DECK_Y : null);
      if (from === 'pier') for (let a = 2; a < 16; a += 4) d.props.push(prop('Pier_Deck_Broken', 0, DECK_Y, a, 0, 1));
      d.events.push({ kind: 'tide12', along: 4 });
      d.currents.push(current(-10, 10, 24, 48, 0, 4, 0));
      laneRock(d, ctx, lane(ctx, 2), 36);
      pearls(d, 6, 44, () => 0, (t) => Math.max(d.ground(0, 6 + 38 * t) + 1, 1.3 + 1.0), 3, 15);
      dressSides(d, ctx, from, from === 'pier' ? 16 : 48);
      return d;
    }),
  ]),
  S('s_flood_a', 'beach', 'beach', 'surf', 64, (ctx) => {
    const d = empty(8, 'shallow', floodGround('beach', ctx, 64, (t) => 1 - smooth(0.72, 1.0, t)));     // ramps back down at the end
    const r = ctx.rng;
    d.currents.push(current(-10, 10, 0, 64, 0, 5.5, 0));
    // debris rides the surge in every lane: logs and barrels to jump; the far lane is the risky line (more debris, double coins)
    const riskyL = r.chance(0.5) ? 0 : 2;
    for (let a = firstRow(ctx); a < 50; a += rowGap(ctx, 0.9)) {
      const l = r.chance(0.45) ? riskyL : r.int(0, 2);
      if (r.chance(0.6)) floatLog(d, lane(ctx, l), a); else barrel(d, ctx, lane(ctx, l), a, d.ground(lane(ctx, l), a));
      if (l === riskyL) jumpArc(d, ctx, lane(ctx, l), a, 25, true);
    }
    const rx = lane(ctx, riskyL);
    d.riskyLine = { x0: rx - 1.2, x1: rx + 1.2, along0: 4, along1: 60, bonus: 200 };
    laneCoins(d, rx, 6, 58, 3, 25, true);
    laneCoins(d, lane(ctx, 1), 6, 58, 3, 10);
    dressSides(d, ctx, 'beach', 64);
    return d;
  }),
  S('s_flood_b', 'beach', 'beach', 'surf', 64, (ctx) => {
    const d = empty(8, 'shallow', floodGround('beach', ctx, 64, (t) => 1 - smooth(0.72, 1.0, t)));
    const m = M(ctx); const r = ctx.rng;
    d.currents.push(current(-10, 10, 0, 64, 0, 6, 0));
    let dir = r.sign();
    // cross-currents sweep you a lane over, into the rock waiting there
    for (let a = 8; a < 36; a += 14 * ctx.spacing) {
      const v = m(dir * 3);
      d.currents.push(current(-10, 10, a, a + 8, v, 0));
      const tx = v > 0 ? 2.5 : -2.5;
      laneRock(d, ctx, tx, a + 12); jumpArc(d, ctx, tx, a + 12, 25, true);
      dir = -dir;
    }
    laneCoins(d, 0, 6, 58, 3, 10);
    dressSides(d, ctx, 'beach', 64);
    return d;
  }),
  ...(['coral', 'grotto'] as Biome[]).flatMap((from) => [
    S(`s_rip_${from}`, from, 'coral', 'swim', 100, (ctx) => {
      const d = empty(WIDTH.coral, 'deep', blendGround(GROUND[from], GROUND.coral, ctx.zStart, 100));
      d.events.push({ kind: 'tide12', along: 4 });
      d.currents.push(current(-14, 14, 0, 100, 0, RIP, 0, { y0: -24, y1: 0 }));
      if (from === 'grotto') {
        // the rip sweeps you out from under the grotto's roof and up into the canyon
        d.ceiling = (_x, along) => (along < 18 ? GROTTO_ROOF : Infinity);
        d.props.push(prop('Cave_Roof', 0, GROTTO_ROOF, 7.5, 0, 1));
        d.currents.push(current(-14, 14, 12, 40, 0, 0, 2.0, { y0: -24, y1: 0, visible: false }));
      }
      ripGates(d, ctx, 40, 100, 'cargo');
      dressSides(d, ctx, 'coral', 100);
      return d;
    }),
  ]),
  S('s_rip_b', 'coral', 'coral', 'swim', 100, (ctx) => {
    const d = empty(WIDTH.coral, 'deep', worldGround(GROUND.coral, ctx.zStart));
    const m = M(ctx); const r = ctx.rng;
    d.currents.push(current(-14, 14, 0, 100, 0, RIP, 0, { y0: -14, y1: 0 }));
    // cross-currents shove you off the line between the gates
    let dir = r.sign();
    for (let a = 14; a < 88; a += 18) { d.currents.push(current(-14, 14, a, a + 8, m(dir * 3.0), 0, 0, { y0: -14, y1: 0 })); dir = -dir; }
    ripGates(d, ctx, 26, 100, 'rock');
    dressSides(d, ctx, 'coral', 100);
    return d;
  }),
];
