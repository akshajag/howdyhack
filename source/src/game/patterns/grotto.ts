import { MOVE, type KrakenAttack, type Pattern, type PatternCtx } from '../types';
import { GROUND, GROTTO_ROOF, WIDTH, empty, worldGround, current, pearls, M, dressSides, prop, chain, kitSolids, reefGate, mineRow } from './lib';

/** Shipwreck Grotto: a deep sea cave under a rock roof, reached down a slope from the canyon; dark, but every hazard
 *  keeps a glowing edge. Each area has one kind of obstacle (the wreck's ribs, chains, or mines) and a reef gate across
 *  the cave (the way on, and the air). */
const CAVE: [number, number, number] = [0.5, 0.55, 0.7];
function base(ctx: PatternCtx) { const d = empty(WIDTH.grotto, 'deep', worldGround(GROUND.grotto, ctx.zStart)); d.ceiling = () => GROTTO_ROOF; return d; }


/** a hull rib to swim through; collision is the rib's real silhouette */
let ribId = 0;
function rib(d: ReturnType<typeof base>, cx: number, along: number, scale = 1) {
  const g = d.ground(cx, along) - 0.2;
  d.props.push(prop('Ship_Rib', cx, g, along, 0, scale));
  kitSolids(d, 'Ship_Rib', cx, g, along, scale, 'wood', `rib${ribId++}`, false, 'HIT THE WRECK');
}

export const grottoPatterns: Pattern[] = [
  {
    id: 'grotto_tunnel', biome: 'grotto', mode: 'swim', length: 60, weight: 3, tiers: [2, 4], from: 'grotto', to: 'grotto',
    build(ctx) {
      const d = base(ctx); const m = M(ctx); const r = ctx.rng;
      d.events.push({ kind: 'zone', along: 1, label: 'SHIPWRECK GROTTO', sub: 'Thread the wreck' });
      const spacing = Math.max(ctx.speed * 1.3, 16 - ctx.difficulty * 3) * ctx.spacing;
      let side = r.sign();
      let i = 0;
      for (let a = 14; a < 54; a += spacing) {
        if (i++ === 1) { reefGate(d, r.pick(['Reef_Gate_Mid', 'Reef_Gate_Low', 'Reef_Gate_Twin'] as const), m(side * r.range(0, 2)), a, r.chance(0.5), CAVE); side = -side; continue; }
        rib(d, m(side * r.range(0.5, 1.8)), a, r.range(0.9, 1.1));
        side = -side;
      }
      const g0 = d.ground(0, 30);
      d.props.push(prop('Ship_Hull_Half', 12, g0 - 0.5, 30, 0, 1));
      d.props.push(prop('Anchor', m(-4), g0, 48, r.range(0, 6.28), 1));
      pearls(d, 6, 56, () => 0, (t) => d.ground(0, 6 + 50 * t) + 3.2, 3, 12);
      dressSides(d, ctx, 'grotto', 60);
      return d;
    },
  },
  {
    id: 'grotto_escape', biome: 'grotto', mode: 'swim', length: 64, weight: 3, tiers: [2, 4], from: 'grotto', to: 'grotto',
    build(ctx) {
      const d = base(ctx); const m = M(ctx); const r = ctx.rng;
      // curtains of chains hanging from the roof to just above the floor, a wide gap in each and room to thread between
      // the chains (light rust, so they stand out in the dark), a current drifting you across into them
      let a = 10, dir = r.sign();
      while (a < 46) {
        const gapX = m(dir * r.range(0.5, 3.5));
        for (let x = -7.8; x <= 7.8; x += 2.6) if (Math.abs(m(x) - gapX) > 2.4) chain(d, m(x) + r.range(-0.2, 0.2), a + r.range(-0.6, 0.6), GROTTO_ROOF, GROTTO_ROOF - (d.ground(m(x), a) + 1.0), true);
        d.currents.push(current(-7, 7, a - 10, a - 2, m(-dir * (1.5 + ctx.difficulty * 1.0)), 0, 0, { y0: -22, y1: GROTTO_ROOF }));
        dir = -dir; a += (14 - ctx.difficulty * 3) * ctx.spacing;
      }
      pearls(d, 6, 46, (t) => m(Math.sin(t * 8) * 2), (t) => d.ground(0, 6 + 40 * t) + 4, 3, 12);
      reefGate(d, r.pick(['Reef_Gate_Mid', 'Reef_Gate_High'] as const), m(r.range(-1.5, 1.5)), 58, false, CAVE);
      dressSides(d, ctx, 'grotto', 64);
      return d;
    },
  },
  {
    id: 'grotto_minefield', biome: 'grotto', mode: 'swim', length: 62, weight: 2, tiers: [2, 4], from: 'grotto', to: 'grotto',
    build(ctx) {
      const d = base(ctx); const m = M(ctx); const r = ctx.rng;
      // the wreck's mines, still moored in the dark: rows across the cave, mostly up near the roof but dipping low
      // somewhere (swim over there: coins), and for pink pearls a gap low in each row to thread
      const gap = Math.max(14, ctx.speed * (1.0 - 0.03 * ctx.tier)) * ctx.spacing;
      let hx = r.range(-3, 3);
      for (let a = 10; a < 44; a += gap) {
        const hy = d.ground(m(hx), a) + 1.4;
        const dip = mineRow(d, ctx, a, [[m(hx), hy]], -9.5, 9.5)[0];
        pearls(d, a - 4, a + 2, () => dip, () => GROTTO_ROOF - MOVE.roofGap - 0.6, 2.5, 10);
        pearls(d, a - 5, a + 1, () => m(hx), () => hy, 2.5, 25, true);
        hx = Math.max(-5, Math.min(5, hx + r.sign() * r.range(2, 4.5)));
      }
      reefGate(d, r.pick(['Reef_Gate_Mid', 'Reef_Gate_Low'] as const), m(r.range(-1.5, 1.5)), 56, r.chance(0.5), CAVE);
      dressSides(d, ctx, 'grotto', 62);
      return d;
    },
  },
  {
    // the Kraken's chamber: a long open stretch of cave with nothing in it but the boss (game/kraken.ts runs the
    // attacks from `d.kraken`); a reef gate at the end is the way out
    id: 'grotto_kraken', biome: 'grotto', mode: 'swim', length: 210, weight: 2, tiers: [2, 4], from: 'grotto', to: 'grotto',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng; const L = 210;
      d.events.push({ kind: 'zone', along: 2, label: 'THE KRAKEN', sub: 'it strikes where the glow shows: be somewhere else' });
      const attacks: KrakenAttack[] = [];
      const kinds: KrakenAttack['kind'][] = ['slam', 'sweep', 'grab', 'pincer', 'wall', 'sweep', 'slam', 'grab', 'wall', 'pincer'];
      const gap = Math.max(14, ctx.speed * 1.15 * ctx.spacing);
      let k = r.int(0, 1);
      for (let a = 36; a < L - 34; a += gap, k++) {
        const kind = kinds[k % kinds.length];
        attacks.push({ along: a, kind, side: r.sign(), high: r.chance(0.5) });
      }
      d.kraken = { attacks, warn: 1.2 * ctx.spacing, escape: L - 26 };
      // coins down the middle of the chamber (the attacks leave the middle open more often than not)
      pearls(d, 8, L - 36, (t) => M(ctx)(Math.sin(t * 6) * 2), (t) => -14.2 + Math.cos(t * 5) * 1.5, 3, 12);
      // the wreck's bones along the walls, and ink-dark water
      for (let a = 10; a < L - 10; a += r.range(18, 30)) d.props.push(prop('Ship_Rib', r.sign() * 9.5, d.ground(9.5, a) - 1.5, a, r.range(-0.3, 0.3), r.range(0.9, 1.2)));
      const g0 = d.ground(0, L - 60);
      d.props.push(prop('Anchor', M(ctx)(5), g0, L - 60, r.range(0, 6.28), 1.2));
      reefGate(d, r.pick(['Reef_Gate_Mid', 'Reef_Gate_Low'] as const), M(ctx)(r.range(-1.5, 1.5)), L - 8, false, CAVE);
      dressSides(d, ctx, 'grotto', L);
      return d;
    },
  },
  {
    id: 'grotto_calm', biome: 'grotto', mode: 'swim', length: 40, weight: 1, tiers: [2, 4], from: 'grotto', to: 'grotto',
    build(ctx) { const d = base(ctx); pearls(d, 6, 34, () => 0, (t) => d.ground(0, 6 + 28 * t) + 3.5, 3, 12); dressSides(d, ctx, 'grotto', 40); return d; },
  },
];
