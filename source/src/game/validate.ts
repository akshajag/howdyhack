import { MOVE, LANES, SKI_LAT, SKI_BOOST, type ChunkData, type Mode, type Shape } from './types';

/**
 * Fairness validator. Slices the chunk along the direction of travel and asks: is there a route a player with our
 * movement capabilities can take? On foot each lane slice is free / needs-jump / needs-slide / blocked, actions must
 * be spaced far enough apart to be performed in sequence, and the route must exist from every entry lane.
 * Underwater the search is free in (x, y).
 * Conservative on purpose: it uses the top speed of the tier and a reaction reserve after the entrance.
 */
export interface Validation { ok: boolean; reason?: string; freeFraction: number; exit?: SwimExit; lanes?: LaneExit; ski?: SkiExit }
/** on the jet ski: the stretches across the channel (x intervals) you can be in at the end of a chunk */
export type SkiExit = [number, number][];
/** on foot: per lane, the last jump / slide of a chunk and how far before its end it started (the next chunk keeps
 *  clear of it) */
export type LaneExit = ({ kind: 1 | 2; since: number } | null)[];
/** where a swimmer can be at the end of an under-water chunk (world x, y of the reachable cells); the next chunk is
 *  checked starting from there, so a low hole at the end of one can't lead into a wall whose only gap is high */
export interface SwimExit { x: number[]; y: number[]; /** metres into the next chunk still inside a blind window */ blind?: number }
/** you can't see past a reef wall: for this long after threading a hole you're assumed to keep straight on (seeing
 *  what was behind the wall, then reacting) before you steer */
const BLIND_S = 0.45;
/** routes under water are checked at this share of the real side / up-down swim speed: room for reaction and
 *  imperfect steering, not a frame-perfect line */
const SWIM_SLACK = 0.8;

const DZ = 1.0;
const DX = 0.5;
const DY = 0.5;
type Cell = 0 | 1 | 2 | 3; // free, jump, slide, blocked

function shapeAlongRange(s: Shape): [number, number] {
  if (s.kind === 'sphere') return [s.along - s.r, s.along + s.r];
  const yaw = s.yaw ?? 0, c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
  const ext = (s.sx * sn + s.sz * c) / 2;
  return [s.along - ext, s.along + ext];
}
function shapeYRange(s: Shape): [number, number] { return s.kind === 'sphere' ? [s.y - s.r, s.y + s.r] : [s.y, s.y + s.sy]; }

/** does the (x, along) column intersect the obstacle footprint (expanded by the player radius)? */
function covers(s: Shape, x: number, along: number, pad: number) {
  if (s.kind === 'sphere') return Math.hypot(x - s.x, along - s.along) < s.r + pad;
  const yaw = s.yaw ?? 0;
  const dx = x - s.x, dz = along - s.along;
  const lx = dx * Math.cos(yaw) + dz * Math.sin(yaw), lz = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
  return Math.abs(lx) < s.sx / 2 + pad && Math.abs(lz) < s.sz / 2 + pad;
}

export function validateChunk(d: ChunkData, mode: Mode, length: number, speed: number, entry: SwimExit | null = null, laneEntry: LaneExit | null = null, skiEntry: SkiExit | null = null): Validation {
  if (mode === 'ski') return validateSki(d, length, speed, skiEntry);
  const nz = Math.ceil(length / DZ) + 1;
  const W = d.width;
  const nx = Math.floor((2 * W) / DX) + 1;
  const xAt = (i: number) => -W + i * DX;
  const lethal = d.obstacles.filter((o) => o.lethal !== false);
  const jumpDist = speed * MOVE.jumpTime;
  const slideDist = speed * MOVE.slideTime;
  const reserve = Math.ceil((speed * MOVE.reaction) / DZ);

  if (mode !== 'swim') {
    // ---------------- on foot: three lanes, each slice free / jump / slide / blocked per lane
    const NL = LANES.length;
    const grid: Cell[][] = [];
    let freeCells = 0, total = 0;
    for (let s = 0; s < nz; s++) {
      const along = Math.min(length, s * DZ);
      const row: Cell[] = new Array(NL).fill(0);
      for (let l = 0; l < NL; l++) {
        const x = LANES[l];
        // the standing surface is the deck where there is one, else the ground; deep water under a run chunk is a hole
        const deck = d.floor ? d.floor(x, along) : null;
        const ground = d.ground(x, along);
        const feet = deck ?? ground;
        if (deck === null && mode === 'run' && -ground > 2.2) {
          // over a gap or off the deck: jumpable if the hole is short enough in the along direction
          const gap = d.gaps.find((g) => along >= g.along0 && along <= g.along1 && x >= g.x0 && x <= g.x1);
          row[l] = gap && gap.along1 - gap.along0 <= jumpDist * 0.6 ? 1 : 3;
          continue;
        }
        let cell: Cell = 0;
        for (const o of lethal) {
          const sh = o.shape;
          const [a0, a1] = shapeAlongRange(sh);
          if (along < a0 - MOVE.radius || along > a1 + MOVE.radius) continue;
          if (!covers(sh, x, along, MOVE.radius)) continue;
          const [y0, y1] = shapeYRange(sh);
          const bottom = y0 - feet, top = y1 - feet;
          if (bottom >= MOVE.standHeight + 0.05) continue;                                // overhead, clears standing
          const jumpable = top <= MOVE.jumpClear && a1 - a0 <= jumpDist * 0.55 && bottom < 0.4;
          const slideable = bottom >= MOVE.slideHeight + 0.15 && a1 - a0 <= slideDist * 0.7;
          const need: Cell = jumpable ? 1 : slideable ? 2 : 3;
          cell = Math.max(cell, need) as Cell;
          if (cell === 3) break;
          if (cell === 1 && need === 2 || cell === 2 && need === 1) { cell = 3; break; }   // jump AND slide at once: impossible
        }
        row[l] = cell;
        total++; if (cell === 0) freeCells++;
      }
      grid.push(row);
    }
    // never two obstacles back to back in a lane: after a jump (slide) starts, nothing else may start in that lane until
    // a jump (slide) length plus 0.25 s later (you land or stand up, then have a moment), not another jump or slide and
    // not a blocker you'd have to dodge straight after landing. A layout that breaks this is invalid (re-rolled). The
    // previous chunk's last jump / slide counts too (laneEntry), so it holds across the join
    const needJ = Math.ceil((jumpDist + speed * 0.25) / DZ), needS = Math.ceil((slideDist + speed * 0.25) / DZ);
    const lanesOut: LaneExit = [];
    for (let l = 0; l < NL; l++) {
      const prior = laneEntry?.[l] ?? null;
      let lastKind: Cell = prior ? prior.kind : 0, lastStart = prior ? -Math.round(prior.since / DZ) : -999, lastEnd = lastStart, prev: Cell = 0;
      for (let s = 0; s < nz; s++) {
        const c = grid[s][l], starts = c !== 0 && c !== prev;
        prev = c;
        if (c === 0) continue;
        const same = c === lastKind && s - lastEnd <= 1;                                   // still the same obstacle
        if (starts && !same && (lastKind === 1 || lastKind === 2) && s - lastStart < (lastKind === 1 ? needJ : needS))
          return { ok: false, reason: `lanes: back to back in lane ${l} at along ${(s * DZ).toFixed(0)} m`, freeFraction: 0 };
        if (c === 1 || c === 2) { if (!same) lastStart = s; lastKind = c; lastEnd = s; }
        else { lastKind = 3; lastEnd = s; }
      }
      lanesOut.push(lastKind === 1 || lastKind === 2 ? { kind: lastKind, since: (nz - 1 - lastStart) * DZ } : null);
    }
    // reachability from EVERY entry lane (the player can arrive in any of them). A lane change takes ~laneTime and
    // needs both lanes clear for its whole length.
    const kChange = Math.max(1, Math.ceil((speed * MOVE.laneTime * 1.25) / DZ));
    const clearRun = (l: number, s0: number, s1: number) => { for (let q = Math.max(0, s0); q <= s1; q++) if (grid[q][l] !== 0) return false; return true; };
    for (let start = 0; start < NL; start++) {
      const reachAt: boolean[][] = [new Array(NL).fill(false)];
      reachAt[0][start] = grid[0][start] !== 3;
      for (let s = 1; s < nz; s++) {
        const next = new Array(NL).fill(false);
        for (let l = 0; l < NL; l++) {
          if (grid[s][l] === 3 || (s < reserve && grid[s][l] !== 0)) continue;           // reaction reserve: no actions at the entrance
          if (reachAt[s - 1][l]) next[l] = true;
        }
        if (s >= kChange) {
          for (let l = 0; l < NL; l++) {
            if (!reachAt[s - kChange][l] || !clearRun(l, s - kChange, s)) continue;
            for (const adj of [l - 1, l + 1]) if (adj >= 0 && adj < NL && clearRun(adj, s - kChange, s)) next[adj] = true;
          }
        }
        reachAt.push(next);
        if (!next.some(Boolean)) return { ok: false, reason: `lanes: no route from lane ${start} at along ${(s * DZ).toFixed(0)} m`, freeFraction: freeCells / Math.max(1, total) };
      }
    }
    return { ok: true, freeFraction: freeCells / Math.max(1, total), lanes: lanesOut };
  }

  // ---------------- underwater: 2D (x, y) search
  // reach per slice is fractional and accumulated (rounding it up to a cell per metre assumed 0.5 m of side or vertical
  // movement per metre travelled, about three times the real vertical speed at the rip's pace), and the forward speed
  // includes any current every route has to ride: one running along most of the canyon (the 12th Tide's rip) or a gate
  // hole's slipstream. Either leaves less time to steer
  const wideBoost = (along: number) => d.currents.reduce((m, c) => (along >= c.along0 && along <= c.along1 && (c.jet || c.x1 - c.x0 >= W * 1.2) ? Math.max(m, c.vAlong) : m), 0);
  // the previous chunk's exit, keyed by grid cell (every chunk's grid lines up: widths and Y0 are multiples of the cell)
  // blind windows after each reef wall (and any carried over from the last chunk's final gate)
  // (measured at the speed you come out of the hole: the slipstream, and in a rip the rip, carry you further)
  const gates = [...new Set((d.rings ?? []).map((g) => g.along))].map((g) => ({ g, len: (speed + wideBoost(g + 1)) * BLIND_S }));
  const blindAt = (along: number) => along < (entry?.blind ?? 0) || gates.some(({ g, len }) => along > g && along <= g + len);
  const entryKeys = entry ? new Set(entry.x.map((x, k) => `${Math.round(x / DX)}:${Math.round(entry.y[k] / DY)}`)) : null;
  const fromEntry = (x: number, y: number) => {
    if (!entryKeys) return true;
    const i = Math.round(x / DX), j = Math.round(y / DY);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (entryKeys.has(`${i + a}:${j + b}`)) return true;
    return false;
  };
  let accLat = 0, accV = 0;
  const yMin = (x: number, along: number) => d.ground(x, along) + MOVE.swimFloor;
  const yMax = MOVE.swimCeiling;
  // under a cave roof the top of the swim space is the roof (less the swimmer's clearance)
  const yTop = (x: number, along: number) => (d.ceiling ? Math.min(yMax, d.ceiling(x, along) - MOVE.roofGap) : yMax);
  const Y0 = -24;
  const ny = Math.floor((yMax - Y0) / DY) + 1;                   // absolute y grid from -24 up to the ceiling
  const yAt = (j: number) => Y0 + j * DY;
  // obstacle ranges are computed once; per slice only the obstacles spanning it are kept, per column only those whose
  // footprint covers it, so the per-cell test is just a height-range comparison
  const solids = lethal.map((o) => { const [a0, a1] = shapeAlongRange(o.shape); const [y0, y1] = shapeYRange(o.shape); const pad = o.bob ? o.bob.amp : 0; return { o, a0, a1, y0: y0 - pad, y1: y1 + pad }; });
  const blocked = (y: number, col: typeof solids) => {
    for (const c of col) if (y + 0.5 > c.y0 && y - 0.5 < c.y1) return true;
    return false;
  };
  let reach: boolean[][] = [];
  let freeCells = 0, total = 0;
  for (let s = 0; s < nz; s++) {
    const along = Math.min(length, s * DZ);
    const v = speed + wideBoost(along);
    const blind = blindAt(along);
    const rl = blind ? 0 : (MOVE.latSpeed * SWIM_SLACK * DZ) / v / DX, rv = blind ? 0 : (MOVE.swimVy * SWIM_SLACK * DZ) / v / DY;
    const kLat = Math.floor(accLat + rl) - Math.floor(accLat), kV = Math.floor(accV + rv) - Math.floor(accV);
    accLat += rl; accV += rv;
    const slice = solids.filter((c) => along >= c.a0 - MOVE.radius && along <= c.a1 + MOVE.radius);
    const cur: boolean[][] = [];
    let any = false;
    for (let i = 0; i < nx; i++) {
      const x = xAt(i);
      const here = slice.filter((c) => covers(c.o.shape, x, along, MOVE.radius));
      const col: boolean[] = new Array(ny).fill(false);
      let lo = yMin(x, along);
      const top = yTop(x, along);
      // seabed rising to the surface (surge exit): the player surfaces and surfs; always keep one cell at the ceiling
      lo = Math.min(lo, top - DY);
      for (let j = 0; j < ny; j++) {
        const y = yAt(j);
        if (y < lo || y > top) continue;
        total++;
        const b = blocked(y, here);
        if (!b) freeCells++;
        if (b) continue;
        if (s === 0) { if (fromEntry(x, y)) { col[j] = true; any = true; } continue; }
        // the lowest open cell also takes anyone below it: where the seabed rises, it pushes the swimmer up (the
        // swimmer can't go under it), so climbing as fast as the ground isn't needed
        const vLo = y - DY < lo ? -j : -kV;
        for (let k = -kLat; k <= kLat && !col[j]; k++) {
          const ii = i + k; if (ii < 0 || ii >= nx) continue;
          for (let v = vLo; v <= kV; v++) { const jj = j + v; if (jj >= 0 && jj < ny && reach[ii][jj]) { col[j] = true; any = true; break; } }
        }
      }
      cur.push(col);
    }
    reach = cur;
    if (!any) return { ok: false, reason: s === 0 ? 'swim: no way in from the last chunk' : `swim: no route at along ${along.toFixed(0)} m`, freeFraction: freeCells / Math.max(1, total) };
  }
  const exit: SwimExit = { x: [], y: [], blind: Math.max(0, ...gates.map(({ g, len }) => g + len - length)) };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (reach[i][j]) { exit.x.push(xAt(i)); exit.y.push(yAt(j)); }
  return { ok: true, freeFraction: freeCells / Math.max(1, total), exit };
}

// ---------------------------------------------------------------- on the jet ski
/** routes on the channel are checked at this share of the real steering speed (reaction, imperfect steering) */
const SKI_SLACK = 0.7;
function shapeXRange(s: Shape): [number, number] {
  if (s.kind === 'sphere') return [s.x - s.r, s.x + s.r];
  const yaw = s.yaw ?? 0, h = (s.sx * Math.abs(Math.cos(yaw)) + s.sz * Math.abs(Math.sin(yaw))) / 2;
  return [s.x - h, s.x + h];
}
function mergeIntervals(v: [number, number][]): [number, number][] {
  const s = v.filter(([a, b]) => b >= a).sort((p, q) => p[0] - q[0]), out: [number, number][] = [];
  for (const [a, b] of s) { const last = out[out.length - 1]; if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}
function subtractIntervals(v: [number, number][], cut: [number, number][]): [number, number][] {
  let cur = v;
  for (const [c0, c1] of cut) {
    const next: [number, number][] = [];
    for (const [a, b] of cur) { if (c1 <= a || c0 >= b) { next.push([a, b]); continue; } if (c0 > a) next.push([a, c0]); if (c1 < b) next.push([c1, b]); }
    cur = next;
  }
  return cur;
}
/**
 * One dimension across the channel, sliced along the chunk: the stretches you can be in grow by how far you can steer
 * in a slice and lose whatever an obstacle blocks there, unless a hop clears it (low on the water and short along the
 * course) or a duck goes under it (its underside above the ducking height). Wakes and ramps aren't blocks. Starts from
 * where the last chunk left you.
 */
function validateSki(d: ChunkData, length: number, speed: number, entry: SkiExit | null): Validation {
  const W = d.width, v = speed * SKI_BOOST;
  const DA = 0.5, reach = (SKI_LAT * SKI_SLACK * DA) / Math.max(1, v), pad = MOVE.radius + 0.1;
  const lethal = d.obstacles.filter((o) => o.lethal !== false).map((o) => {
    const [a0, a1] = shapeAlongRange(o.shape), [x0, x1] = shapeXRange(o.shape), [bottom, top] = shapeYRange(o.shape);
    const hop = top <= 1.15 && a1 - a0 < v * 0.4, duck = bottom >= 1.0;
    return { a0, a1, x0, x1, clear: hop || duck };
  }).filter((o) => !o.clear);
  let cur: [number, number][] = entry && entry.length ? entry.map(([a, b]) => [a, b] as [number, number]) : [[-W, W]];
  let width = 0, n = 0;
  for (let a = 0; a <= length + 1e-6; a += DA) {
    cur = mergeIntervals(cur.map(([x0, x1]) => [Math.max(-W, x0 - reach), Math.min(W, x1 + reach)] as [number, number]));
    const cut: [number, number][] = [];
    for (const o of lethal) if (a >= o.a0 - pad && a <= o.a1 + pad) cut.push([o.x0 - pad, o.x1 + pad]);
    cur = subtractIntervals(cur, cut).filter(([x0, x1]) => x1 - x0 > 0.05);
    if (!cur.length) return { ok: false, reason: `ski: no way along the channel at ${a.toFixed(1)} m`, freeFraction: 0 };
    width += cur.reduce((s, [x0, x1]) => s + x1 - x0, 0) / (2 * W); n++;
  }
  return { ok: true, freeFraction: width / Math.max(1, n), ski: cur };
}

