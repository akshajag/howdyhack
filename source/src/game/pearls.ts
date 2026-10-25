import { pointClearance } from './collide';
import { MOVE, LANES, type ChunkData, type Mode, type Pearl, type Prop } from './types';

/**
 * Coins never sit inside anything. After a pattern is built, every coin is tested against the obstacles' collision
 * shapes and against the visual bounds of solid props. A blocked coin is lifted just over the blocker when that is
 * still reachable (a jump on land, the swim ceiling under water), otherwise slid sideways to the nearest clear spot,
 * otherwise dropped. Props with openings (arches, windows, ribs, nets, low beams, raised palms) are represented by
 * their obstacle boxes only, so coins threading the holes stay put.
 */
const COIN = 0.32;                       // coin radius
const PAD = COIN + 0.22;                 // required clearance from a surface

/** local-space bounds (three.js axes, metres, before scale) of props treated as solid blobs */
const BOUNDS: Record<string, [number, number, number, number, number, number]> = {
  Rock_Boulder: [-1.11, 0, -0.86, 1.11, 1.31, 0.86], Rock_Slab: [-1.56, 0, -1.36, 1.56, 0.99, 1.36], Rock_Pillar: [-0.84, 0, -0.76, 0.84, 2.77, 0.76],
  SRC_mk_rock_1: [-1.61, 0, -1.49, 1.61, 2.26, 1.49], SRC_mk_rock_2: [-1.52, 0, -1.24, 1.52, 1.90, 1.24], SRC_mk_rock_3: [-1.71, 0, -1.74, 1.71, 2.32, 1.74],
  Sea_Mine: [-0.95, -12.8, -0.95, 0.95, 0.95, 0.95], Net_Wall: [-5.04, -6.11, -0.3, 5.04, 0.2, 0.3],
  Beach_Boulder_Big: [-1.42, 0, -1.39, 1.42, 2.33, 1.39], Reef_Rock_Low: [-1.47, 0, -1.29, 1.47, 1.23, 1.29],
  Coral_Brain: [-0.83, 0, -0.84, 0.83, 0.83, 0.83], Coral_Branch: [-0.77, 0, -0.67, 0.77, 0.88, 0.68], Coral_Fan: [-0.85, 0, -0.05, 0.85, 1.31, 0.05],
  Coral_Table: [-0.88, 0, -0.89, 0.88, 0.94, 0.89], Coral_Tube: [-0.43, 0, -0.57, 0.43, 1.31, 0.57], Coral_Tower: [-1.32, 0, -1.38, 1.32, 4.93, 1.38],
  Barrel: [-0.39, 0, -0.38, 0.39, 0.9, 0.38], Crate: [-0.49, 0, -0.49, 0.49, 0.9, 0.49], Anemone: [-0.2, 0, -0.22, 0.2, 0.6, 0.22], Anchor: [-0.82, 0, -1.0, 0.82, 0.2, 1.0],
  Jellyfish: [-0.49, -1.86, -0.7, 0.49, 0.44, 0.7], Glow_Coral: [-0.7, 0, -0.65, 0.7, 1.21, 0.65],
  Fallen_Palm: [-4.5, 0, -3.07, 4.5, 1.03, 3.07], Beam_Jump: [-3.53, 0, -0.49, 3.53, 0.75, 0.49], Ship_Mast_Fallen: [-5.99, 0, -2.5, 5.99, 1.5, 2.5],
  Boat_Research: [-5.5, 0, -1.8, 5.5, 6.65, 1.8],
  K_Rock_SandA: [-0.7, 0, -0.6, 0.7, 0.88, 0.6], K_Rock_SandC: [-0.64, 0, -0.64, 0.64, 0.9, 0.64], K_Rock_C: [-0.72, 0, -0.72, 0.72, 0.9, 0.72],
  K_Log: [-1.21, 0, -0.4, 1.21, 0.59, 0.4], K_Barrel: [-0.49, 0, -0.49, 0.49, 0.9, 0.49], K_Crate: [-0.6, 0, -0.73, 0.6, 0.85, 0.73], K_Crate_Bottles: [-0.46, 0, -0.56, 0.46, 0.9, 0.56],
  K_Palm_Fallen: [-3.1, 0, -0.74, 3.1, 0.85, 0.74], K_Rocks_Big: [-3.5, 0, -3.77, 3.5, 5.94, 3.77], K_Rocks_BigA: [-4.6, 0, -3.95, 4.6, 5.22, 3.95],
  K_Rowboat: [-1.38, 0, -1.19, 1.38, 0.85, 1.19], K_Chest: [-0.51, 0, -0.53, 0.51, 1.08, 0.53], Chest_Base: [-0.52, 0, -0.49, 0.52, 0.72, 0.49], Chest_Lid: [-0.5, 0, -0.02, 0.5, 0.47, 0.94],
  K_Cannon: [-0.8, 0, -1.1, 0.8, 1.2, 1.1], K_LogPile: [-1.18, 0, -1.05, 1.18, 1.15, 1.05], K_LogBig: [-1.2, 0, -0.66, 1.2, 1.0, 0.66], K_Barrels: [-1.2, 0, -0.64, 1.2, 1.08, 0.64],
  K_Tiki: [-0.98, 0, -0.75, 0.98, 2.7, 0.75], K_CrateStack: [-1.19, 0, -0.73, 1.19, 2.56, 0.73],
  // only the solid parts of the slide-unders: coins below them stay where they are
  K_BoatRack: [-1.19, 1.2, -0.71, 1.19, 2.05, 0.71], K_VolleyNet: [-4.84, 1.2, -0.1, 4.84, 2.66, 0.1],
  Driftwood_00: [0.03, -0.01, -0.70, 2.97, 0.43, 0.15], Driftwood_01: [0.03, -0.02, -0.72, 5.63, 0.43, 0.16], Driftwood_02: [0.03, -0.01, -0.69, 2.63, 0.43, 0.15],
  Driftwood_03: [0.03, -0.02, -0.72, 5.03, 0.43, 0.16], Driftwood_04: [0.03, -0.01, -0.71, 4.26, 0.43, 0.16], Driftwood_05: [0.03, -0.01, -0.70, 3.83, 0.43, 0.16],
  Driftwood_06: [0.03, -0.01, -0.71, 4.85, 0.43, 0.16],
};

interface Blob { p: Prop; b: [number, number, number, number, number, number]; c: number; s: number; sy: number; bob: number }

function blobsOf(d: ChunkData): Blob[] {
  const out: Blob[] = [];
  for (const p of d.props) {
    const b = BOUNDS[p.kit];
    if (!b) continue;
    // props far outside the lane can't touch a coin
    const reach = Math.max(Math.abs(b[0]), Math.abs(b[3]), Math.abs(b[2]), Math.abs(b[5])) * p.scale + PAD;
    if (Math.abs(p.x) - reach > d.width + 1) continue;
    const bob = p.kit === 'Jellyfish' ? 0.65 : 0;
    out.push({ p, b, c: Math.cos(p.yaw), s: Math.sin(p.yaw), sy: p.scale * (p.sy ?? 1), bob });
  }
  return out;
}

/** signed distance from a point to a prop's oriented bounds (approximate outside, exact sign) */
function blobClearance(x: number, y: number, along: number, o: Blob): number {
  // world -> prop local. Prop world z = zStart - along, yaw about +y: local x =  c*dx - s*dz', with dz' = -(along - p.along)
  const dx = x - o.p.x, dzw = -(along - o.p.along);
  const lx = (o.c * dx - o.s * dzw) / o.p.scale, lz = (o.s * dx + o.c * dzw) / o.p.scale;
  const ly = (y - o.p.y) / o.sy;
  const [x0, y0, z0, x1, y1, z1] = o.b;
  const ex = Math.max(x0 - lx, lx - x1, 0) * o.p.scale;
  const ey = Math.max(y0 - ly - o.bob / o.sy, ly - y1 - o.bob / o.sy, 0) * o.sy;
  const ez = Math.max(z0 - lz, lz - z1, 0) * o.p.scale;
  const out = Math.hypot(ex, ey, ez);
  if (out > 0) return out;
  // inside: distance to the nearest face (negative)
  return -Math.min((lx - x0), (x1 - lx), (lz - z0), (z1 - lz)) * o.p.scale;
}

function surfaceAt(d: ChunkData, x: number, along: number) {
  const f = d.floor ? d.floor(x, along) : null;
  return f ?? d.ground(x, along);
}

function clear(d: ChunkData, blobs: Blob[], x: number, y: number, along: number, mode: Mode): boolean {
  if (mode === 'swim') { if (y < d.ground(x, along) + 0.55) return false; if (d.ceiling && y > d.ceiling(x, along) - MOVE.roofGap + 0.3) return false; }
  else {
    const f = d.floor ? d.floor(x, along) : null;
    if (f !== null && y < f + 0.45) return false;
    if (y < surfaceAt(d, x, along) + 0.45) return false;
  }
  for (const o of d.obstacles) {
    const bob = o.bob ? o.bob.amp : 0;
    if (pointClearance(x, y, along, o.shape, 0) < PAD + bob) return false;
  }
  for (const b of blobs) if (blobClearance(x, y, along, b) < PAD) return false;
  return true;
}

function yRange(d: ChunkData, x: number, along: number, mode: Mode): [number, number] {
  if (mode === 'swim') return [d.ground(x, along) + MOVE.swimFloor, Math.min(MOVE.swimCeiling + 0.5, d.ceiling ? d.ceiling(x, along) - MOVE.roofGap : Infinity)];
  const s = surfaceAt(d, x, along);
  // coins may be lifted over something jumpable (a jump catches them), never onto a blocker's top: those move lanes
  return [s + 0.6, s + 2.4];
}

export interface SettleStats { kept: number; lifted: number; shifted: number; dropped: number }

export function settlePearls(d: ChunkData, mode: Mode): SettleStats {
  const st: SettleStats = { kept: 0, lifted: 0, shifted: 0, dropped: 0 };
  const blobs = blobsOf(d);
  const out: Pearl[] = [];
  for (const p of d.pearls) {
    if (clear(d, blobs, p.x, p.y, p.along, mode)) { out.push(p); st.kept++; continue; }
    const [lo, hi] = yRange(d, p.x, p.along, mode);
    let done = false;
    if (mode === 'swim') {
      // 1) lift over the blocker
      for (let y = Math.max(p.y, lo); y <= hi && !done; y += 0.2) {
        if (clear(d, blobs, p.x, y, p.along, mode)) { out.push({ ...p, y }); st.lifted++; done = true; }
      }
    } else {
      // 1) on foot a coin is only caught near the hip, so it goes where the hip will be: on the apex of a jump over
      //    the obstacle, or at sliding height under it (a blocker fits neither: the coin moves lanes)
      const s = surfaceAt(d, p.x, p.along);
      for (const y of [s + 0.95 + MOVE.jumpHeight * 0.9, s + 0.5]) {
        if (!done && clear(d, blobs, p.x, y, p.along, mode)) { out.push({ ...p, y }); st.lifted++; done = true; }
      }
    }
    // 2) move sideways at a sensible height: to another lane on foot, in 0.5 m steps under water
    const steps = Array.from({ length: 14 }, (_, k) => p.x + Math.ceil((k + 1) / 2) * 0.5 * ((k + 1) % 2 ? 1 : -1));
    const xs = mode === 'swim' ? steps.filter((x) => Math.abs(x) <= d.width - 0.3)
      : [...LANES].filter((x) => Math.abs(x - p.x) > 0.5).sort((a, b) => Math.abs(a - p.x) - Math.abs(b - p.x));
    for (const x of xs) {
      if (done) break;
      const [lo2, hi2] = yRange(d, x, p.along, mode);
      const y = Math.min(hi2, Math.max(lo2, p.y));
      if (clear(d, blobs, x, y, p.along, mode)) { out.push({ ...p, x, y }); st.shifted++; done = true; }
    }
    if (!done) st.dropped++;
  }
  d.pearls = out;
  return st;
}

/** test hook: coins still inside something after settling */
export function pearlViolations(d: ChunkData, mode: Mode): number {
  const blobs = blobsOf(d);
  return d.pearls.filter((p) => !clear(d, blobs, p.x, p.y, p.along, mode)).length;
}
