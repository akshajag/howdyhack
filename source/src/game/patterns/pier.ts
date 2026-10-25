import type { Pattern, PatternCtx, ChunkData } from '../types';
import { GROUND, WIDTH, DECK_Y, empty, worldGround, beamLow, beamJump, netHang, dressSides, prop, lane, rowGap, firstRow, laneCoins, jumpArc, slideCoins, laneJump, laneBlocker } from './lib';

/** Broken Pier: three lanes on an 8 m deck; gaps span the deck (jump), beams and nets span the row (jump / slide),
 *  barrels, crates, chests and cannons sit in single lanes (jump or step around), cargo piles block a lane. */
function base(ctx: PatternCtx): ChunkData {
  const d = empty(WIDTH.pier, 'deep', worldGround(GROUND.pier, ctx.zStart));
  d.floor = (x, along) => {
    if (Math.abs(x) > 4.2) return null;
    for (const g of d.gaps) if (along >= g.along0 && along <= g.along1 && x >= g.x0 && x <= g.x1) return null;
    return DECK_Y;
  };
  return d;
}
/** lay deck pieces, skipping those under full-width gaps */
function deck(d: ChunkData, ctx: PatternCtx, length: number) {
  for (let a = 2; a < length; a += 4) {
    const g = d.gaps.find((g) => a > g.along0 - 1 && a < g.along1 + 1);
    if (g && g.x0 <= -4 && g.x1 >= 4) continue;
    d.props.push(prop(g || ctx.rng.chance(0.25) ? 'Pier_Deck_Broken' : 'Pier_Deck', 0, DECK_Y, a, 0, 1));
  }
}
const Y = DECK_Y;
/** where the first row may stand: past the reaction reserve plus a lane change at this chunk's speed */

export const pierPatterns: Pattern[] = [
  {
    id: 'pier_walkway', biome: 'pier', mode: 'run', length: 76, weight: 3, tiers: [0, 4], from: 'pier', to: 'pier',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng;
      // missing deck across all lanes: timed jumps with wide landing zones
      const n = 3 + Math.min(2, ctx.tier);
      let a = firstRow(ctx);
      for (let i = 0; i < n && a < 68; i++) {
        const w = 2.6 + ctx.difficulty * 1.6;
        d.gaps.push({ along0: a, along1: a + w, x0: -5, x1: 5 });
        jumpArc(d, ctx, lane(ctx, r.int(0, 2)), a + w / 2);
        a += w + rowGap(ctx, 1.15) + r.range(0, 3);
      }
      deck(d, ctx, 76);
      d.events.push({ kind: 'zone', along: 1, label: 'BROKEN PIER', sub: 'Jump the gaps' });
      dressSides(d, ctx, 'pier', 76);
      return d;
    },
  },
  {
    id: 'pier_gauntlet', biome: 'pier', mode: 'run', length: 80, weight: 3, tiers: [1, 4], from: 'pier', to: 'pier',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng;
      // cargo in lanes (jump it, or dodge a cargo pile), beams across the deck to jump, low beams to slide under
      let a = firstRow(ctx), last = -1;
      while (a < 72) {
        let kind = r.int(0, 2);
        if (kind === last && r.chance(0.6)) kind = (kind + 1) % 3;
        if (kind === 0) {
          const blocked = new Set([r.int(0, 2)]);
          if (r.chance(0.4 + ctx.difficulty * 0.4)) blocked.add((([...blocked][0]) + r.int(1, 2)) % 3);
          let i = 0;
          for (const l of blocked) { if (i++ === 0 && ctx.tier >= 1 && r.chance(0.45 + 0.1 * ctx.tier)) laneBlocker(d, ctx, lane(ctx, l), a, 'pier', Y); else laneJump(d, ctx, lane(ctx, l), a, 'pier', Y); }
          const free = [0, 1, 2].find((l) => !blocked.has(l))!;
          laneCoins(d, lane(ctx, free), a - 5, a + 2, 2.5);
        } else if (kind === 1) { beamLow(d, 0, a, Y, 8.4); slideCoins(d, lane(ctx, r.int(0, 2)), a); }
        else { beamJump(d, 0, a, Y, 8.4); jumpArc(d, ctx, lane(ctx, r.int(0, 2)), a); }
        last = kind;
        a += rowGap(ctx, 1.15);
      }
      deck(d, ctx, 80);
      dressSides(d, ctx, 'pier', 80);
      return d;
    },
  },
  {
    id: 'pier_nets', biome: 'pier', mode: 'run', length: 72, weight: 2, tiers: [2, 4], from: 'pier', to: 'pier',
    build(ctx) {
      const d = base(ctx); const r = ctx.rng;
      // slide under the nets, jump the gaps
      let a = firstRow(ctx), slideNext = true;
      while (a < 66) {
        if (slideNext) { netHang(d, 0, a, Y, 8.4); slideCoins(d, lane(ctx, r.int(0, 2)), a); }
        else { d.gaps.push({ along0: a, along1: a + 3.0, x0: -5, x1: 5 }); jumpArc(d, ctx, lane(ctx, r.int(0, 2)), a + 1.5); }
        slideNext = !slideNext;
        a += rowGap(ctx, 1.2) + r.range(0, 2);
      }
      deck(d, ctx, 72);
      dressSides(d, ctx, 'pier', 72);
      return d;
    },
  },
  {
    id: 'pier_calm', biome: 'pier', mode: 'run', length: 32, weight: 1, tiers: [0, 1], from: 'pier', to: 'pier',
    build(ctx) { const d = base(ctx); deck(d, ctx, 32); laneCoins(d, lane(ctx, ctx.rng.int(0, 2)), 4, 28); dressSides(d, ctx, 'pier', 32); return d; },
  },
];
