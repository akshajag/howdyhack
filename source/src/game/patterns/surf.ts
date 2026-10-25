import { MOVE, LIP_VY, LIP_DRIFT, AIR_REACH, type ChunkData, type Pattern, type PatternCtx, type Wave } from '../types';
import { GROUND, WIDTH, DECK_Y, empty, worldGround, blendGround, prop, box, current, lerp, smooth, dressSides, lane, rowGap, firstRow, laneCoins, jumpArc, slideCoins, surfAt } from './lib';
import { standardWave, waveY, H_BASE, CREST, FOOT, LIP_PAD } from '../wave';

/**
 * Shorebreak Point: the beach's three lanes, jump and slide, but on a surfboard over the water. The lanes run on the
 * wash at the foot of a breaking wave that towers on the left (sea side) and peels along with you; the shore is on the
 * right. Obstacles float in the lanes: logs, barrels and crates and small reef rocks to ollie, big reef rocks, buoys and
 * pier legs to go round, nets strung between floats to tuck under, patches of whitewater that slow you. Rip currents
 * shove you a lane over. The water's surface (the wave's foot and the wash over the sand) is the floor.
 */
const L_OPEN = 160, L_SLALOM = 170, L_PIER = 170, L_RIP = 140;
/** reef rock, dark and wet (the beach's boulders tinted) */
const WET_ROCK: [number, number, number] = [0.5, 0.5, 0.52];

function base(ctx: PatternCtx, wave: Wave): ChunkData {
  const d = empty(WIDTH.surf, 'deep', worldGround(GROUND.surf, ctx.zStart));
  d.wave = wave;
  d.floor = (x, a) => Math.max(d.ground(x, a), waveY(wave, x, a));
  return d;
}
/** slope of the water across x (for the tilt of floating things) */
const tilt = (d: ChunkData, x: number, a: number) => Math.atan((surfAt(d, x + 0.25, a) - surfAt(d, x - 0.25, a)) / 0.5);

// ---------------------------------------------------------------- floating obstacles (collision a little inside the mesh)
/** a log floating across the lane: ollie it */
function floatLog(d: ChunkData, ctx: PatternCtx, x: number, a: number) {
  const s = surfAt(d, x, a), y = s - 0.28, yaw = ctx.rng.range(-0.3, 0.3);
  d.props.push(prop('K_Log', x, y, a, yaw, 1, { roll: tilt(d, x, a) }));
  d.obstacles.push(box(x, y, a, 2.25, 0.62, 0.7, 'wood', { name: 'TRIPPED ON A LOG' }, yaw));
}
/** a crate or barrel floating low: ollie it */
function flotsam(d: ChunkData, ctx: PatternCtx, x: number, a: number) {
  const s = surfAt(d, x, a), crate = ctx.rng.chance(0.5), y = s - (crate ? 0.42 : 0.5), yaw = ctx.rng.range(0, 6.28);
  d.props.push(prop(crate ? 'K_Crate' : 'K_Barrel', x, y, a, yaw, 1, { roll: tilt(d, x, a) }));
  d.obstacles.push(box(x, y, a, crate ? 1.1 : 0.9, crate ? 0.8 : 0.85, crate ? 1.1 : 0.9, 'wood', { name: 'HIT THE FLOTSAM' }, yaw));
}
/** a small reef rock breaking the surface: ollie it */
function smallRock(d: ChunkData, ctx: PatternCtx, x: number, a: number) {
  const r = ctx.rng, s = surfAt(d, x, a), sc = r.range(0.5, 0.62), y = s - 0.22, yaw = r.range(0, 6.28);
  d.props.push(prop('Rock_Boulder', x, y, a, yaw, sc, { tint: WET_ROCK }));
  d.props.push(prop('Foam_Ring', x, s + 0.03, a, yaw, sc * 0.75));
  d.obstacles.push(box(x, y, a, 2.22 * sc * 0.8, 1.31 * sc * 0.85, 1.72 * sc * 0.8, 'rock', { name: 'CLIPPED A REEF ROCK' }, yaw));
}
/** a big reef rock standing well out of the water (3 m and more: no jumping it): change lanes */
/** a sea stack standing out of the wash, 3 m and more (Quaternius' rocks made over as wet sea rock, see
 *  build_seastacks.py): change lanes. Its footprint stays inside the lane: one that spilled into the next would wall
 *  the row. Box: the stack's footprint (x across, z along) and height, a little inside the mesh */
const STACKS = [
  { kit: 'Sea_Stack_A', box: [2.3 * 0.8, 3.21, 2.24 * 0.8] },
  { kit: 'Sea_Stack_B', box: [2.12 * 0.8, 3.4, 1.66 * 0.8] },
] as const;
function bigRock(d: ChunkData, ctx: PatternCtx, x: number, a: number) {
  const r = ctx.rng, st = r.pick([...STACKS]), s = surfAt(d, x, a), sc = r.range(0.95, 1.06), y = s - 0.35;
  const yaw = r.pick([0, Math.PI]) + r.range(-0.2, 0.2);
  d.props.push(prop(st.kit, x, y, a, yaw, sc));
  d.props.push(prop('Foam_Ring', x, s + 0.03, a, yaw, sc * 1.1));
  d.obstacles.push(box(x, y, a, st.box[0] * sc, st.box[1] * sc, st.box[2] * sc, 'blocker', { name: 'HIT A SEA STACK' }, yaw));
}
/** a big mooring buoy in the lane (3 m tall): change lanes */
function buoy(d: ChunkData, ctx: PatternCtx, x: number, a: number) {
  const s = surfAt(d, x, a);
  d.props.push(prop('Prop_Buoy', x, s, a, ctx.rng.range(0, 6.28), 1.3, { roll: tilt(d, x, a) * 0.6 }));
  d.props.push(prop('Foam_Ring', x, s + 0.03, a, 0, 0.5));
  d.obstacles.push(box(x, s - 0.3, a, 1.0, 3.0, 1.0, 'blocker', { name: 'HIT A BUOY' }));
}
/** a tall net hanging from 1.3 m over the water up to `top` (a jump tops out at 1.9 m, so only a tuck gets under): the
 *  Net_Hang mesh, whose net hangs from 1.3 m to its top at 2.63 m, stretched upward to fit (its posts go on down under
 *  the water) */
const NET_FOOT = 1.3, NET_MESH_TOP = 2.63;
function tallNet(d: ChunkData, x: number, a: number, span: number, top: number) {
  const s = surfAt(d, x, a), v = (top - NET_FOOT) / (NET_MESH_TOP - NET_FOOT), scale = span / 7;
  d.props.push(prop('Net_Hang', x, s + NET_FOOT - NET_FOOT * v, a, 0, scale, { sy: v / scale }));
  d.obstacles.push(box(x, s + NET_FOOT, a, span, top - NET_FOOT, 0.5, 'net', { name: 'CAUGHT IN A NET' }));
}
/** a fishing net strung across all three lanes between two floats, from 1.3 m up to 4.2 m: tuck under it */
function netRow(d: ChunkData, ctx: PatternCtx, a: number) {
  tallNet(d, 0, a, 7.4, 4.2);
  for (const x of [-4.4, 4.4]) { d.props.push(prop('Prop_Buoy', x, surfAt(d, x, a), a, ctx.rng.range(0, 6.28), 1)); d.props.push(prop('Foam_Ring', x, surfAt(d, x, a) + 0.03, a, 0, 0.4)); }
}
/** Air spots. Anywhere the wave stands tall you can go up it (from the left lane, left once more: you carve up the face
 *  and launch off the lip, see Runner.launch). At an air spot the wave swells taller and an arc of pink coins hangs over
 *  the lip on the path of a launch from `a0`: up off the lip, over the top, back down toward the face, at the chunk's
 *  speed. Pink coins in the left lane lead up to it; going up anywhere near where they end, the climb is timed to leave
 *  the lip where the arc starts (Runner, AIR_REACH). The left lane is kept clear from the lead-in to the landing
 *  (`airClear`) */
const SPOTS = new WeakMap<ChunkData, number[]>();
/** the wave a pattern rides, swelled a fifth taller round each air spot (peaking under the top of the arc) */
function airWave(L: number, spots: number[], speed: number, o: { crest?: (a: number) => number } = {}): Wave {
  const swell = (a: number) => spots.reduce((m, s) => Math.max(m, Math.exp(-(((a - s - 0.5 * speed) / 13) ** 2))), 0);
  return standardWave(L, { h: (a) => H_BASE * (1 + 0.2 * swell(a)), crest: o.crest });
}
function airSpots(d: ChunkData, ctx: PatternCtx, spots: number[]) {
  SPOTS.set(d, spots);
  d.airAt = spots;
  const w = d.wave!, G = (2 * MOVE.jumpHeight) / Math.pow(MOVE.jumpTime / 2, 2);
  for (const a0 of spots) {
    // the launch: from the face just under the lip (where the climb's x lands, see Runner) at the arc's start
    const x0 = w.crest(a0) + LIP_PAD + 0.15, hip0 = waveY(w, x0, a0) + 0.95;
    for (let t = 0.1; t <= 1.15; t += 0.115) {
      const x = x0 + LIP_DRIFT * t, y = hip0 + LIP_VY * t - 0.5 * G * t * t, a = a0 + ctx.speed * t;
      if (y < waveY(w, x, a) + 1.2) break;                         // (down near the face: the rest of the fall is the landing)
      d.pearls.push({ x, y, along: a, value: 25, risky: true });
    }
    // the lead-in: ends in the middle of the stretch where going up times the launch onto the arc
    const press = a0 - ctx.speed * (AIR_REACH[0] + AIR_REACH[1]) / 2;
    laneCoins(d, -2.5, press - 16, press, 2.5, 15, true);
  }
}
/** is the left lane (x = -2.5, the wave's side whatever the mirroring) kept clear here round an air spot? */
function airClear(d: ChunkData, a: number) { return !!SPOTS.get(d)?.some((s) => a > s - 36 && a < s + 50); }
/** a patch of churning whitewater in a lane: no wipeout, but it saps your speed */
function whitewater(d: ChunkData, ctx: PatternCtx, x: number, a: number) {
  const s = surfAt(d, x, a), sc = ctx.rng.range(1.0, 1.4);
  d.props.push(prop('Foam_Ring', x, s + 0.04, a, ctx.rng.range(0, 6.28), sc), prop('Foam_Ring', x, s + 0.05, a, ctx.rng.range(0, 6.28), sc * 0.55));
  d.obstacles.push(box(x, s - 0.3, a, 2.2 * sc, 0.6, 2.2 * sc, 'foam', { name: 'WHITEWATER', lethal: false, nearMiss: false }));
}
/** a pier across the wash: its deck 7 m up on legs. The legs of the middle deck stand in the middle lane (change lanes
 *  round them); a net hangs from the deck across the outer lanes (tuck under it) */
const PIER_Y = 7;
function pierAcross(d: ChunkData, ctx: PatternCtx, a: number) {
  (d.noAir ??= []).push([a - 31, a + 3]);                         // (a launch from here would fly into the deck)
  const sy = (PIER_Y + 0.5) / 6;                                  // (Pier_Deck's legs are 6 m: stretched to the water)
  for (const c of [-28, -20, -12, -4, 4, 12, 20, 28]) {
    d.props.push(prop('Pier_Deck', c, PIER_Y, a, 0, 1, { sy }));
    for (const ra of [a - 2, a + 2]) d.props.push(prop('Pier_Rail_4m', c - 2, PIER_Y, ra, Math.PI / 2, 1), prop('Pier_Rail_4m', c + 2, PIER_Y, ra, Math.PI / 2, 1));
    for (const lx of [c - 2.9, c + 2.9]) if (Math.abs(lx) < 16) for (const la of [a - 1.3, a + 1.3]) d.props.push(prop('Foam_Ring', lx, surfAt(d, lx, la) + 0.03, la, lx * 7, 0.3));
  }
  // the legs at x = +-1.1 both stand in the middle lane: one blocker there
  d.obstacles.push(box(0, surfAt(d, 0, a) - 0.5, a, 2.6, PIER_Y + 0.5, 3.0, 'blocker', { name: 'HIT A PIER LEG' }));
  // a net hangs from the deck over each outer lane
  for (const l of [0, 2]) tallNet(d, lane(ctx, l), a, 3.0, PIER_Y);   // (up to the deck)
}

type Kind = 'free' | 'jump' | 'slide' | 'block';
function jumpPiece(d: ChunkData, ctx: PatternCtx, x: number, a: number) {
  const k = ctx.rng.next();
  if (k < 0.45) floatLog(d, ctx, x, a); else if (k < 0.8) flotsam(d, ctx, x, a); else smallRock(d, ctx, x, a);
}
function blockPiece(d: ChunkData, ctx: PatternCtx, x: number, a: number) { if (ctx.rng.chance(0.65)) bigRock(d, ctx, x, a); else buoy(d, ctx, x, a); }
/** a row like the beach's: up to two lanes blocked, the others free / jump; or a net across the whole row */
function row(d: ChunkData, ctx: PatternCtx, a: number, blockers: number) {
  const r = ctx.rng;
  const kinds: Kind[] = ['free', 'free', 'free'];
  const order = r.shuffle([0, 1, 2]);
  for (let i = 0; i < 3; i++) kinds[order[i]] = i < blockers ? 'block' : r.chance(0.55 + 0.1 * ctx.tier) ? 'jump' : 'free';
  if (!kinds.includes('free') && !kinds.includes('jump')) kinds[order[2]] = 'jump';
  for (let l = 0; l < 3; l++) {
    const x = lane(ctx, l);
    if (x < -2 && airClear(d, a)) kinds[l] = 'free';
    if (kinds[l] === 'jump') { jumpPiece(d, ctx, x, a); if (r.chance(0.5)) jumpArc(d, ctx, x, a); }
    else if (kinds[l] === 'block') blockPiece(d, ctx, x, a);
    else if (r.chance(0.5)) laneCoins(d, x, a - 5, a + 3, 2.5);
  }
}

export const surfPatterns: Pattern[] = [
  {
    // 1. Open Break: floating logs, flotsam and buoys in the lanes, a net to tuck under now and then
    id: 'surf_open_break', biome: 'surf', mode: 'board', length: L_OPEN, weight: 3, tiers: [0, 4], from: 'surf', to: 'surf',
    build(ctx) {
      const r = ctx.rng, ph = r.range(0, 6.28);
      const spots = [r.range(44, 58)]; if (r.chance(0.5)) spots.push(spots[0] + r.range(54, 62));
      const d = base(ctx, airWave(L_OPEN, spots, ctx.speed, { crest: (a) => CREST + 1.1 * Math.sin(a * 0.045 + ph) }));
      airSpots(d, ctx, spots);
      for (let a = firstRow(ctx); a < L_OPEN - 10; a += rowGap(ctx, 1.1)) {
        if (r.chance(0.25) && !airClear(d, a)) { netRow(d, ctx, a); slideCoins(d, lane(ctx, r.int(0, 2)), a); }
        else row(d, ctx, a, ctx.tier === 0 ? (r.chance(0.3) ? 1 : 0) : r.chance(0.35 + 0.1 * ctx.tier) ? 2 : 1);
        if (ctx.tier >= 1 && r.chance(0.3)) whitewater(d, ctx, lane(ctx, r.int(0, 2)), a + rowGap(ctx, 1.1) * 0.5);
      }
      dressSides(d, ctx, 'surf', L_OPEN);
      return d;
    },
  },
  {
    // 2. Reef Slalom: rows of reef rock with one or two lanes blocked, small rocks to ollie in the others
    id: 'surf_reef_slalom', biome: 'surf', mode: 'board', length: L_SLALOM, weight: 3, tiers: [1, 4], from: 'surf', to: 'surf',
    build(ctx) {
      const r = ctx.rng;
      const spots = [r.range(56, 100)];
      const d = base(ctx, airWave(L_SLALOM, spots, ctx.speed, { crest: (a) => CREST + 0.6 * Math.sin(a * 0.05) }));
      airSpots(d, ctx, spots);
      for (let a = firstRow(ctx); a < L_SLALOM - 10; a += rowGap(ctx, 1.1)) {
        const blocked = new Set([r.int(0, 2)]);
        if (r.chance(0.4 + 0.12 * ctx.tier)) blocked.add((([...blocked][0]) + r.int(1, 2)) % 3);
        for (let l = 0; l < 3; l++) {
          const x = lane(ctx, l);
          if (x < -2 && airClear(d, a)) continue;
          if (blocked.has(l)) bigRock(d, ctx, x, a);
          else if (r.chance(0.45 + 0.1 * ctx.tier)) { smallRock(d, ctx, x, a); jumpArc(d, ctx, x, a); }
          else laneCoins(d, x, a - 5, a + 3, 2.5);
        }
      }
      dressSides(d, ctx, 'surf', L_SLALOM);
      return d;
    },
  },
  {
    // 3. Pier Break: under piers that run out across the wash (legs in the middle lane, nets hanging over the outer
    // ones), flotsam drifting between them
    id: 'surf_pier_break', biome: 'surf', mode: 'board', length: L_PIER, weight: 2, tiers: [1, 4], from: 'surf', to: 'surf',
    build(ctx) {
      const r = ctx.rng;
      // (one pier while it's easy, early on and in the demo; two later)
      const piers = ctx.difficulty < 0.5 && ctx.tier <= 1 ? [r.range(70, 84)] : [r.range(44, 54), r.range(116, 126)];
      const spots = piers.length === 2 ? [piers[0] + 22] : [piers[0] - 52];           // (the air spot between the piers, or well before the one)
      const d = base(ctx, airWave(L_PIER, spots, ctx.speed, { crest: (a) => CREST + 0.5 * Math.sin(a * 0.04) }));
      airSpots(d, ctx, spots);
      for (const a of piers) { pierAcross(d, ctx, a); slideCoins(d, lane(ctx, r.pick([0, 2])), a); }
      const segs: [number, number][] = piers.length === 2 ? [[piers[0] + rowGap(ctx, 1.1), piers[1] - rowGap(ctx, 1.1)]] : [[firstRow(ctx), piers[0] - rowGap(ctx, 1.1)], [piers[0] + rowGap(ctx, 1.1), L_PIER - 12]];
      for (const [a0, a1] of segs) for (let a = a0; a < a1; a += rowGap(ctx, 1.1)) row(d, ctx, a, r.chance(0.5) ? 1 : 0);
      dressSides(d, ctx, 'surf', L_PIER);
      return d;
    },
  },
  {
    // 4. Rip Channel: cross-currents shove you a lane over, toward a rock waiting downstream
    id: 'surf_rip', biome: 'surf', mode: 'board', length: L_RIP, weight: 1, tiers: [1, 4], from: 'surf', to: 'surf',
    build(ctx) {
      const r = ctx.rng;
      const d = base(ctx, standardWave(L_RIP, { h: (a) => H_BASE * (0.92 + 0.08 * Math.sin(a * 0.3)) }));
      d.events.push({ kind: 'zone', along: 2, label: 'RIP CHANNEL', sub: '' });
      let dir = r.sign();
      for (let a = firstRow(ctx); a < L_RIP - 22; a += rowGap(ctx, 1.5)) {
        const v = dir * (2.6 + 1.2 * ctx.difficulty);
        d.currents.push(current(-10, 10, a - 8, a - 1, v, 0));
        const tx = v > 0 ? 2.5 : -2.5;                                  // the lane the current pushes you into
        bigRock(d, ctx, tx, a + 4); jumpArc(d, ctx, 0, a + 4, 15, false);
        laneCoins(d, 0, a - 8, a + 8, 3);
        dir = -dir;
      }
      dressSides(d, ctx, 'surf', L_RIP);
      return d;
    },
  },
  {
    id: 'surf_calm', biome: 'surf', mode: 'board', length: 110, weight: 1, tiers: [0, 1], from: 'surf', to: 'surf',
    build(ctx) {
      const d = base(ctx, standardWave(110));
      laneCoins(d, lane(ctx, ctx.rng.int(0, 2)), 8, 100, 3);
      dressSides(d, ctx, 'surf', 110);
      return d;
    },
  },
];

const T = (id: string, from: Pattern['biome'], to: Pattern['biome'], mode: Pattern['mode'], length: number, build: Pattern['build']): Pattern =>
  ({ id, biome: from, mode, length, weight: 1, tiers: [0, 4], role: 'transition', from, to, build });

export const surfTransitions: Pattern[] = [
  // beach -> surf: the sand runs down into the shallows where three boards lie at the water's edge, one in each lane.
  // Run onto yours and you're up on it; the swell rises on your left and becomes the wave
  T('t_beach_surf', 'beach', 'surf', 'run', 76, (ctx) => {
    const L = 76, MOUNT = 22;
    const d = empty(WIDTH.beach, 'shallow', blendGround(GROUND.beach, GROUND.surf, ctx.zStart, L, (t) => smooth(0.12, 0.48, t)));
    const w: Wave = { h: (a) => H_BASE * smooth(MOUNT + 6, L, a), crest: () => CREST, foot: () => FOOT };
    d.wave = w; d.board = { mount: MOUNT };
    d.floor = (x, a) => (a >= MOUNT - 2 ? Math.max(d.ground(x, a), waveY(w, x, a)) : null);
    for (const x of [-2.5, 0, 2.5]) d.props.push(prop('Runner_Board', x, Math.max(d.ground(x, MOUNT - 1), 0) + 0.02, MOUNT - 1, 0, 1));
    laneCoins(d, 0, 6, MOUNT - 4, 3);
    laneCoins(d, 0, MOUNT + 8, L - 4, 3);
    d.events.push({ kind: 'zone', along: 2, label: 'SHOREBREAK POINT', sub: '' });
    dressSides(d, ctx, 'surf', L);
    return d;
  }),
  // pier -> surf: the deck slopes down toward the water and ends; run off the end and you land on your board
  T('t_pier_surf', 'pier', 'surf', 'run', 74, (ctx) => {
    const L = 74, RAMP0 = 12, RAMP1 = 24, END = 24;
    const d = empty(WIDTH.pier + 1, 'deep', blendGround(GROUND.pier, GROUND.surf, ctx.zStart, L, (t) => smooth(0.25, 0.7, t)));
    const deckY = (a: number) => lerp(DECK_Y, 0.85, smooth(RAMP0, RAMP1, a));
    const w: Wave = { h: (a) => H_BASE * smooth(END + 4, L, a), crest: () => CREST, foot: () => FOOT };
    d.wave = w; d.board = { mount: END + 0.5 };
    d.floor = (x, a) => (a < END ? (Math.abs(x) <= 4.2 ? deckY(a) : null) : Math.max(d.ground(x, a), waveY(w, x, a)));
    for (let a = 2; a < END; a += 4) {
      const pitch = a > RAMP0 - 2 && a < RAMP1 ? -Math.atan((DECK_Y - 0.85) / (RAMP1 - RAMP0)) : 0;
      d.props.push(prop('Pier_Deck', 0, deckY(a), a, 0, 1, { pitch }));
      d.props.push(prop('Pier_Rail_4m', -4.1, deckY(a), a, 0, 1, { pitch }), prop('Pier_Rail_4m', 4.1, deckY(a), a, 0, 1, { pitch }));
    }
    laneCoins(d, 0, 4, END - 2, 3);
    laneCoins(d, 0, END + 6, L - 4, 3);
    dressSides(d, ctx, 'pier', END);
    return d;
  }),
  // surf -> beach: the wave fades, the wash runs up onto a sandbar; you step off the board and run up the sand
  T('t_surf_beach', 'surf', 'beach', 'board', 72, (ctx) => {
    const L = 72, LAND = 40;
    const d = empty(WIDTH.surf, 'shallow', blendGround(GROUND.surf, GROUND.beach, ctx.zStart, L, (t) => smooth(0.2, 0.62, t)));
    const w: Wave = { h: (a) => H_BASE * (1 - smooth(4, LAND - 6, a)), crest: () => CREST, foot: () => FOOT };
    d.wave = w; d.board = { land: LAND };
    d.floor = (x, a) => (a < LAND ? Math.max(d.ground(x, a), waveY(w, x, a)) : null);
    laneCoins(d, 0, 6, L - 2, 3);
    dressSides(d, ctx, 'beach', L);
    return d;
  }),
  // surf -> coral: the wave runs out of water and collapses; a rip pulls you out past the reef, the board goes, you dive
  T('t_surf_dive', 'surf', 'coral', 'board', 64, (ctx) => {
    const L = 64, DIVE = 42;
    const d = empty(WIDTH.surf, 'deep', blendGround(GROUND.surf, GROUND.coral, ctx.zStart, L, (t) => smooth(0.35, 0.95, t)));
    const w: Wave = { h: (a) => H_BASE * (1 - smooth(6, 34, a)), crest: () => CREST, foot: () => FOOT };
    d.wave = w; d.board = { dive: DIVE };
    d.floor = (x, a) => (a < DIVE ? Math.max(d.ground(x, a), waveY(w, x, a)) : null);
    d.currents.push(current(-14, 14, DIVE, L, 0, 2.5, -1.6, { visible: false }));
    laneCoins(d, 0, 6, DIVE - 2, 3);
    for (let a = DIVE + 3; a < L - 2; a += 3) d.pearls.push({ x: 0, y: -1.5 - (a - DIVE) * 0.15, along: a, value: 15 });
    d.events.push({ kind: 'zone', along: 20, label: 'RIP CURRENT', sub: '' });
    const n0 = d.props.length;
    dressSides(d, ctx, 'coral', L);
    d.props = d.props.filter((p, i) => i < n0 || d.ground(p.x, p.along) < -2.5);
    return d;
  }),
];

/** The 12th Tide at Shorebreak Point: the wave stands up a third bigger and the wash is full of wreckage: a log, a
 *  crate or a barrel in two lanes of every row (pink pearls through the gap pay double); then it closes out into the
 *  rip (t_surf_dive) */
export const surfSurge: Pattern[] = [
  {
    id: 's_surf_big', biome: 'surf', mode: 'board', length: 170, weight: 1, tiers: [0, 4], role: 'surge', from: 'surf', to: 'surf',
    build(ctx) {
      const r = ctx.rng, L = 170;
      const d = base(ctx, standardWave(L, { h: () => H_BASE * 1.35, crest: (a) => CREST - 1.0 + 0.8 * Math.sin(a * 0.05) }));
      d.events.push({ kind: 'tide12', along: 4 });
      d.currents.push(current(-10, 10, 0, L, 0, 4, 0));
      const riskyL = r.int(0, 2);
      for (let a = firstRow(ctx); a < L - 12; a += rowGap(ctx, 0.95)) {
        const open = r.int(0, 2);
        for (let l = 0; l < 3; l++) { if (l === open) continue; const x = lane(ctx, l); if (r.chance(0.6)) floatLog(d, ctx, x, a); else flotsam(d, ctx, x, a); if (l === riskyL) jumpArc(d, ctx, x, a, 30, true); }
        laneCoins(d, lane(ctx, open), a - 5, a + 2, 2.5, 15);
      }
      const rx = lane(ctx, riskyL);
      d.riskyLine = { x0: rx - 1.2, x1: rx + 1.2, along0: 4, along1: L - 6, bonus: 200 };
      dressSides(d, ctx, 'surf', L);
      return d;
    },
  },
];
