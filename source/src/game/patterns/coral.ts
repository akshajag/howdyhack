import type { Pattern, PatternCtx } from '../types';
import { GROUND, WIDTH, empty, worldGround, current, pearls, M, dressSides, coralTower, coralCluster, towerScale, jelly, gateRun, reefGate, mine, mineRow, netWall } from './lib';

/** Coral Canyon: free 3D swimming between y = seabed + 0.9 and the ceiling at -1.1. Each area has one kind of obstacle
 *  (coral, jellyfish, mines, nets or sharks) and ends at a reef gate (a wall across the whole canyon with a hole or two,
 *  the only way on, and the only place under water to get air), so hugging the canyon side never skips a section. */
function base(ctx: PatternCtx) { return empty(WIDTH.coral, 'deep', worldGround(GROUND.coral, ctx.zStart)); }
const midY = (d: ReturnType<typeof base>, x: number, a: number) => (d.ground(x, a) + 0.9 - 1.1) / 2;
const anyGate = (ctx: PatternCtx) => ctx.rng.pick(['Reef_Gate_Mid', 'Reef_Gate_Low', 'Reef_Gate_High'] as const);

export const coralPatterns: Pattern[] = [
  {
    id: 'coral_passage', biome: 'coral', mode: 'swim', length: 64, weight: 3, tiers: [0, 4], from: 'coral', to: 'coral',
    build(ctx) {
      const d = base(ctx); const m = M(ctx); const r = ctx.rng;
      d.events.push({ kind: 'zone', along: 1, label: 'CORAL CANYON', sub: 'Swim up and down: raise or lower your hand (W / S).' });
      // a coral forest: towers of different heights and wide clusters, two or three to each slice, so you weave
      // round some and over others
      for (let a = 9; a < 44; a += (r.range(6, 8.5) - ctx.difficulty * 1.5) * ctx.spacing) {
        const n = 2 + (r.chance(0.3 + 0.1 * ctx.tier) ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const x = m(-10 + (20 * (i + r.range(0.15, 0.85))) / n);
          if (r.chance(0.65)) coralTower(d, ctx, x, a + r.range(-1.5, 1.5), towerScale(ctx));
          else coralCluster(d, ctx, x, a + r.range(-1.5, 1.5), r.range(1.8, 2.6));
        }
      }
      pearls(d, 6, 40, (t) => m(Math.sin(t * 5) * 4), (t) => midY(d, 0, 6 + 34 * t) + Math.cos(t * 4) * 2.5, 3, 10);
      reefGate(d, anyGate(ctx), m(r.range(-2, 2)), 54);
      dressSides(d, ctx, 'coral', 64);
      return d;
    },
  },
  {
    id: 'coral_arches', biome: 'coral', mode: 'swim', length: 68, weight: 3, tiers: [1, 4], from: 'coral', to: 'coral',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng;
      // a run of reef gates to thread (high, low, middle or a choice of two holes), with a moored mine near the middle of
      // the straight line from each hole to the next (swim round it). None near the holes, where the slipstream pulls you.
      gateRun(d, ctx, 26, 64);
      const rings = [...(d.rings ?? [])].sort((p, q) => p.along - q.along);
      for (let i = 0; i + 1 < rings.length; i++) {
        const g1 = rings[i], g2 = rings[i + 1];
        if (g2.along - g1.along < 6) continue;                            // (a twin gate's two rings)
        const t = r.range(0.42, 0.58);
        mine(d, ctx, g1.x + (g2.x - g1.x) * t + r.range(-1.2, 1.2), g1.y + (g2.y - g1.y) * t + r.range(-1, 1), g1.along + (g2.along - g1.along) * t);
      }
      dressSides(d, ctx, 'coral', 68);
      return d;
    },
  },
  {
    id: 'coral_current_canyon', biome: 'coral', mode: 'swim', length: 72, weight: 3, tiers: [2, 4], from: 'coral', to: 'coral',
    build(ctx) {
      const d = base(ctx); const m = M(ctx); const r = ctx.rng;
      // lateral currents sweeping you toward coral towers downstream; a fast forward current in the middle (risky)
      let a = 8, dir = r.sign();
      while (a < 50) {
        const len = r.range(10, 14);
        d.currents.push(current(-7, 7, a, a + len, m(dir * (2.5 + ctx.difficulty * 2)), 0, 0, { y0: -12, y1: -1 }));
        coralTower(d, ctx, m(dir * r.range(2.5, 4.5)), a + len + 4, towerScale(ctx));
        coralTower(d, ctx, m(dir * r.range(7, 10)), a + len + r.range(1, 6), towerScale(ctx));
        a += len + 10 * ctx.spacing; dir = -dir;
      }
      d.currents.push(current(m(-1.5), m(1.5), 4, 68, 0, 4 + ctx.difficulty * 2, 0, { y0: -8, y1: -4 }));
      d.riskyLine = { x0: m(-1.5), x1: m(1.5), along0: 4, along1: 68, bonus: 160 };
      pearls(d, 6, 56, () => 0, () => -6, 3, 20, true);
      reefGate(d, 'Reef_Gate_Mid', 0, 66);
      dressSides(d, ctx, 'coral', 72);
      return d;
    },
  },
  {
    id: 'coral_jellies', biome: 'coral', mode: 'swim', length: 56, weight: 2, tiers: [2, 4], from: 'coral', to: 'coral',
    build(ctx) {
      const d = base(ctx); const m = M(ctx); const r = ctx.rng;
      // a drifting curtain of jellyfish across the whole canyon with one clear gap; a reef gate closes the chunk
      for (let a = 12; a < 40; a += (12 - ctx.difficulty * 3) * ctx.spacing) {
        const holeX = m(r.range(-5, 5)), holeY = r.range(-8, -3);
        for (let i = 0; i < 16; i++) {
          const x = m(-13 + (26 * (i + r.range(0.1, 0.9))) / 16), y = r.range(-9.5, -2);
          if (Math.hypot(x - holeX, y - holeY) < 3.2) continue;
          jelly(d, ctx, x, y, a + r.range(-2, 2));
        }
        pearls(d, a - 6, a + 4, () => holeX, () => holeY, 2.5, 15);
      }
      reefGate(d, r.pick(['Reef_Gate_Mid', 'Reef_Gate_Twin'] as const), m(r.range(-2, 2)), 52, r.chance(0.5));
      dressSides(d, ctx, 'coral', 56);
      return d;
    },
  },
  {
    id: 'coral_minefield', biome: 'coral', mode: 'swim', length: 66, weight: 3, tiers: [1, 4], from: 'coral', to: 'coral',
    build(ctx) {
      const d = base(ctx); const m = M(ctx); const r = ctx.rng;
      d.events.push({ kind: 'zone', along: 1, label: 'MINEFIELD', sub: '' });
      // rows of moored mines across the canyon, most of each row reaching up near the surface: go over where it dips
      // (coins), or for pink pearls weave through the gap in each row, each a step across and up or down from the last
      const gap = Math.max(14, ctx.speed * (1.0 - 0.03 * ctx.tier)) * ctx.spacing;
      let hx = r.range(-4, 4), hy = r.range(-8.5, -6);
      for (let a = 10; a < 50; a += gap) {
        const holes: [number, number][] = [[m(hx), hy]];
        if (r.chance(0.6 - 0.1 * ctx.tier)) holes.push([m(r.range(-9, 9)), r.range(-8.5, -6)]);
        const dip = mineRow(d, ctx, a, holes)[0];
        pearls(d, a - 4, a + 2, () => dip, () => -2.2, 2.5, 10);
        pearls(d, a - 5, a + 1, () => m(hx), () => hy, 2.5, 25, true);
        hx = Math.max(-8, Math.min(8, hx + r.sign() * r.range(2.5, 5.5)));
        hy = Math.max(-8.5, Math.min(-6, hy + r.sign() * r.range(1, 2.5)));
      }
      reefGate(d, anyGate(ctx), m(r.range(-2, 2)), 60);
      dressSides(d, ctx, 'coral', 66);
      return d;
    },
  },
  {
    id: 'coral_nets', biome: 'coral', mode: 'swim', length: 70, weight: 3, tiers: [1, 4], from: 'coral', to: 'coral',
    build(ctx) {
      const d = base(ctx); const m = M(ctx); const r = ctx.rng;
      d.events.push({ kind: 'zone', along: 1, label: 'FISHING NETS', sub: '' });
      // fishing nets right across the canyon: hanging from their floats at the surface (go under) or standing up from the
      // seabed (go over), alternating, so every row is a dive or a climb
      const gap = Math.max(18, ctx.speed * (1.35 - 0.03 * ctx.tier)) * ctx.spacing;
      let hang = r.chance(0.5);
      // (the first row well clear of the last gate: over a second of swimming, so a dive or climb from wherever the
      // chunk before left you fits even late in a run)
      for (let a = Math.max(16, ctx.speed * 1.15) * ctx.spacing; a < 52; a += gap) {
        const s = r.range(1.05, 1.15), off = r.range(-0.6, 0.6);          // three nets side by side reach past the +-14.4 m swim limit
        let topStand = -Infinity;
        for (const k of [-1, 0, 1]) {
          const x = m(off + k * 10 * s);
          // hanging: the floats ride the surface. Standing: 2.4 m of it buried. Either way the change from one row's gap to
          // the next is a ~2 m dive or climb
          if (hang) netWall(d, x, 0.05, a, s);
          else { const top = Math.max(d.ground(x - 5 * s, a), d.ground(x, a), d.ground(x + 5 * s, a)) + 6 * s - 2.4; topStand = Math.max(topStand, top); netWall(d, x, top, a, s); }
        }
        const gy = hang ? (0.05 - 6 * s + d.ground(0, a) + 0.9) / 2 : (topStand - 1.1) / 2;
        pearls(d, a - 6, a + 3, () => m(0), () => gy, 2.5, 15);
        hang = !hang;
      }
      reefGate(d, r.pick(['Reef_Gate_Mid', 'Reef_Gate_Twin'] as const), m(r.range(-2, 2)), 64, r.chance(0.5));
      dressSides(d, ctx, 'coral', 70);
      return d;
    },
  },
  {
    id: 'coral_sharks', biome: 'coral', mode: 'swim', length: 78, weight: 2, tiers: [1, 4], from: 'coral', to: 'coral',
    build(ctx) {
      const d = base(ctx); const m = M(ctx); const r = ctx.rng;
      d.events.push({ kind: 'zone', along: 1, label: 'SHARK WATERS', sub: '' });
      // open water: sharks (spawned at run time in this pattern only, see critters.ts) cross the canyon at your depth
      // after a two-note warning; swim up or down out of the way. Nothing else here, then a reef gate
      pearls(d, 6, 60, (t) => m(Math.sin(t * 4) * 3), (t) => midY(d, 0, 6 + 54 * t) + Math.sin(t * 6) * 2, 3, 10);
      reefGate(d, anyGate(ctx), m(r.range(-2, 2)), 72);
      dressSides(d, ctx, 'coral', 78);
      return d;
    },
  },
  {
    id: 'coral_calm', biome: 'coral', mode: 'swim', length: 44, weight: 1, tiers: [0, 1], from: 'coral', to: 'coral',
    build(ctx) { const d = base(ctx); pearls(d, 6, 38, (t) => Math.sin(t * 6) * 3, (t) => midY(d, 0, 6 + 32 * t), 3, 10); dressSides(d, ctx, 'coral', 44); return d; },
  },
];
