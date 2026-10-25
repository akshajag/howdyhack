import { laneOf, type ChunkData, type Pattern, type PatternCtx } from '../types';
import { GROUND, WIDTH, empty, worldGround, fallenPalm, dressSides, prop, lane, rowGap, firstRow, aggieStart, laneJump, laneBlocker, laneSlide, volleyNet, laneLog, laneCoins, jumpArc, slideCoins } from './lib';

/** Sunbreaker Beach: three lanes on the sand. Lane obstacles are jumpable (rocks, log piles, cannons, barrels, chests,
 *  crates), slide-unders (an upside-down boat on posts, the volleyball net, a palm propped on rocks) or blockers you
 *  have to dodge (crate piles, tiki heads, rock stacks). */
function base(ctx: PatternCtx) { return empty(WIDTH.beach, 'none', worldGround(GROUND.beach, ctx.zStart)); }
const other = (ctx: PatternCtx, l: number) => (l + ctx.rng.int(1, 2)) % 3;
/** where the first row may stand: past the reaction reserve plus a lane change at this chunk's speed */

type Kind = 'free' | 'jump' | 'slide' | 'block';
/** fill one lane of a row and return nothing; coins are laid separately */
function fill(d: ChunkData, ctx: PatternCtx, kind: Kind, l: number, a: number) {
  const x = lane(ctx, l);
  if (kind === 'jump') laneJump(d, ctx, x, a);
  else if (kind === 'slide') laneSlide(d, ctx, x, a);
  else if (kind === 'block') laneBlocker(d, ctx, x, a);
}
/** coins through a passable lane of the row: an arc over a jump, a low line under a slide, a line through a free lane */
function rowCoins(d: ChunkData, ctx: PatternCtx, kind: Kind, l: number, a: number, value = 10) {
  const x = lane(ctx, l);
  if (kind === 'jump') jumpArc(d, ctx, x, a, value + 5);
  else if (kind === 'slide') slideCoins(d, x, a, value + 5);
  else if (kind === 'free') laneCoins(d, x, a - 6, a + 2, 2.5, value);
}
/** a Subway-Surfers row: up to two blockers (none at tier 0 most of the time), the other lanes free / jump / slide */
function rowKinds(ctx: PatternCtx): Kind[] {
  const r = ctx.rng;
  const nBlock = ctx.tier === 0 ? (r.chance(0.4) ? 1 : 0) : r.chance(Math.min(0.85, 0.4 + 0.1 * ctx.tier + ctx.difficulty * 0.2)) ? 2 : 1;
  const kinds: Kind[] = ['free', 'free', 'free'];
  const order = r.shuffle([0, 1, 2]);
  // fewer free lanes as it gets harder: every passable lane asks for something
  const others: Kind[] = ctx.tier >= 2 ? ['jump', 'jump', 'slide', 'slide', 'free'] : ['free', 'jump', 'jump', 'slide'];
  for (let i = 0; i < 3; i++) kinds[order[i]] = i < nBlock ? 'block' : r.pick(others);
  // never a row of only free lanes and blockers at tier >= 1 without something to do
  if (ctx.tier >= 1 && !kinds.some((k) => k === 'jump' || k === 'slide')) kinds[order[2]] = r.chance(0.5) ? 'jump' : 'slide';
  return kinds;
}

export const beachPatterns: Pattern[] = [
  {
    // the first run: one row per move, far apart; the game slows to a near stop at each row until the move is made
    id: 'beach_tutorial', biome: 'beach', mode: 'run', length: 176, weight: 0, tiers: [0, 4], role: 'intro', from: 'beach', to: 'beach',
    build(ctx) {
      const d = base(ctx);
      const L = (i: number) => lane(ctx, i);
      d.tutorial = [];
      // 1. two lanes blocked: change lanes
      laneBlocker(d, ctx, L(1), 40); laneBlocker(d, ctx, L(2), 40);
      d.tutorial.push({ step: 'lane', along: 40, lane: laneOf(L(0)) });
      laneCoins(d, L(0), 26, 37, 2.5);
      // 2. a log across every lane: jump
      for (let l = 0; l < 3; l++) laneLog(d, ctx, L(l), 78);
      d.tutorial.push({ step: 'jump', along: 78 });
      jumpArc(d, ctx, L(0), 78);
      // 3. the volleyball net: slide
      volleyNet(d, ctx, 116);
      d.tutorial.push({ step: 'slide', along: 116 });
      slideCoins(d, L(0), 116);
      // 4. both sides blocked: back to the middle
      laneBlocker(d, ctx, L(0), 154); laneBlocker(d, ctx, L(2), 154);
      d.tutorial.push({ step: 'lane', along: 154, lane: laneOf(L(1)) });
      laneCoins(d, L(1), 158, 172, 2.5);
      dressSides(d, ctx, 'beach', 176);
      aggieStart(d);
      return d;
    },
  },
  {
    id: 'beach_intro', biome: 'beach', mode: 'run', length: 60, weight: 0, tiers: [0, 4], role: 'intro', from: 'beach', to: 'beach',
    build(ctx) {
      const d = base(ctx);
      d.events.push({ kind: 'zone', along: 2, label: 'SUNBREAKER BEACH', sub: 'Switch lanes with your hand or A / D' });
      laneJump(d, ctx, lane(ctx, 0), 38);
      laneCoins(d, lane(ctx, 1), 10, 52);
      dressSides(d, ctx, 'beach', 60);
      aggieStart(d);
      return d;
    },
  },
  {
    id: 'beach_open', biome: 'beach', mode: 'run', length: 68, weight: 3, tiers: [0, 4], from: 'beach', to: 'beach',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng;
      // single obstacles: jump them or step around; from tier 1 some are slide-unders or blockers
      const n = 5 + Math.min(2, ctx.tier);
      let a = firstRow(ctx);
      for (let i = 0; i < n && a < 64; i++) {
        const l = r.int(0, 2);
        const k: Kind = ctx.tier >= 1 && r.chance(0.35) ? (r.chance(0.5) ? 'block' : 'slide') : 'jump';
        fill(d, ctx, k, l, a);
        if (ctx.tier >= 1 && r.chance(0.3 + 0.12 * ctx.tier + ctx.difficulty * 0.2)) fill(d, ctx, 'jump', other(ctx, l), a);
        laneCoins(d, lane(ctx, other(ctx, l)), a - 7, a + 2, 3);
        a += rowGap(ctx) + r.range(0, ctx.tier >= 2 ? 0.6 : 1.5);
      }
      dressSides(d, ctx, 'beach', 68);
      return d;
    },
  },
  {
    id: 'beach_mixed', biome: 'beach', mode: 'run', length: 80, weight: 4, tiers: [0, 4], from: 'beach', to: 'beach',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng;
      // rows mixing jumps, slides and blockers; the coins pick one passable lane per row
      let a = firstRow(ctx);
      while (a < 74) {
        const kinds = rowKinds(ctx);
        for (let l = 0; l < 3; l++) fill(d, ctx, kinds[l], l, a);
        const ok = [0, 1, 2].filter((l) => kinds[l] !== 'block');
        const cl = r.pick(ok);
        rowCoins(d, ctx, kinds[cl], cl, a);
        a += rowGap(ctx, ctx.tier >= 3 ? 1.1 : 1.25) + r.range(0, ctx.tier >= 2 ? 0.8 : 2);
      }
      dressSides(d, ctx, 'beach', 80);
      return d;
    },
  },
  {
    id: 'beach_wall', biome: 'beach', mode: 'run', length: 80, weight: 3, tiers: [1, 4], from: 'beach', to: 'beach',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng;
      // walls: two lanes closed by a run of blockers (like a parked train), the open lane has a jump or a slide inside
      let a = firstRow(ctx), open = r.int(0, 2);
      while (a < 70) {
        const len = r.int(2, 3), step = 3.4;
        for (let k = 0; k < len; k++) for (let l = 0; l < 3; l++) if (l !== open) fill(d, ctx, 'block', l, a + k * step);
        const mid = a + ((len - 1) * step) / 2;
        const inside: Kind = r.chance(0.5) ? 'jump' : 'slide';
        fill(d, ctx, inside, open, mid);
        rowCoins(d, ctx, inside, open, mid, 15);
        laneCoins(d, lane(ctx, open), a - 8, a - 3, 2.5);
        open = open === 1 ? (r.chance(0.5) ? 0 : 2) : r.chance(0.6) ? 1 : 2 - open;
        a += (len - 1) * step + rowGap(ctx, 1.35);
      }
      dressSides(d, ctx, 'beach', 80);
      return d;
    },
  },
  {
    id: 'beach_slalom', biome: 'beach', mode: 'run', length: 76, weight: 3, tiers: [1, 4], from: 'beach', to: 'beach',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng;
      // obstacles in two lanes per row; the open lane moves each row (change lanes, or jump / slide where you can)
      let free = r.int(0, 2), a = firstRow(ctx);
      while (a < 70) {
        for (let l = 0; l < 3; l++) if (l !== free) fill(d, ctx, ctx.tier >= 2 && r.chance(0.45) ? 'block' : r.chance(0.3) ? 'slide' : 'jump', l, a);
        laneCoins(d, lane(ctx, free), a - 5, a + 2, 2.5);
        free = free === 1 ? (r.chance(0.5) ? 0 : 2) : 1;
        a += rowGap(ctx, 1.15 - ctx.difficulty * 0.15);
      }
      dressSides(d, ctx, 'beach', 76);
      return d;
    },
  },
  {
    id: 'beach_palms', biome: 'beach', mode: 'run', length: 72, weight: 3, tiers: [1, 4], from: 'beach', to: 'beach',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng;
      // across all three lanes: a fallen palm (jump), a palm propped on rocks or a volleyball net (slide)
      let a = firstRow(ctx), last = -1;
      while (a < 66) {
        let k = r.int(0, 2);
        if (k === last) k = (k + 1) % 3;
        if (k === 0) fallenPalm(d, ctx, 0, a, false, 8.4);
        else if (k === 1) fallenPalm(d, ctx, 0, a, true, 8.4);
        else volleyNet(d, ctx, a);
        const cl = lane(ctx, r.int(0, 2));
        if (k === 0) jumpArc(d, ctx, cl, a); else slideCoins(d, cl, a);
        last = k;
        a += rowGap(ctx, 1.25);
      }
      dressSides(d, ctx, 'beach', 72);
      return d;
    },
  },
  {
    id: 'beach_open_safe', biome: 'beach', mode: 'run', length: 40, weight: 1, tiers: [0, 1], from: 'beach', to: 'beach',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng;
      const l1 = r.int(0, 2), l2 = other(ctx, l1);
      laneCoins(d, lane(ctx, l1), 6, 20); laneCoins(d, lane(ctx, l2), 24, 36);
      dressSides(d, ctx, 'beach', 40);
      return d;
    },
  },
  {
    id: 'beach_rows', biome: 'beach', mode: 'run', length: 74, weight: 2, tiers: [2, 4], from: 'beach', to: 'beach',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng;
      // a beached research boat is scenery (off the lanes); rows of jumpable obstacles across every lane, the risky
      // lane carries the pink coin arcs
      d.props.push(prop('Boat_Research', ctx.mirrored ? -12 : 12, d.ground(12, 30) + 0.2, 30, (ctx.mirrored ? -1 : 1) * 0.4, 0.8, { roll: 0.2 }));
      const risky = r.int(0, 2);
      const gap = rowGap(ctx, 1.4);
      let a = firstRow(ctx);
      while (a < 68) {
        for (let l = 0; l < 3; l++) laneJump(d, ctx, lane(ctx, l), a);
        jumpArc(d, ctx, lane(ctx, risky), a, 20, true);
        a += gap;
      }
      const x = lane(ctx, risky);
      d.riskyLine = { x0: x - 1.2, x1: x + 1.2, along0: 10, along1: 70, bonus: 180 };
      dressSides(d, ctx, 'beach', 74);
      return d;
    },
  },
];
