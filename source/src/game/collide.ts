import type { Shape } from './types';

/**
 * Capsule-vs-primitive tests in chunk-local coordinates (x lateral, y up, along forward).
 * A body is a vertical capsule standing on its feet: bottom sphere centre at y + r, top at y + height - r.
 */
export interface Body { x: number; y: number; along: number; height: number; radius: number }
export interface Contact { depth: number; nx: number; ny: number; nz: number }

const tmp = { x: 0, y: 0, z: 0 };

/** closest point on the shape surface to p; returns signed distance (negative inside) and the push normal */
function sphereVsShape(px: number, py: number, pz: number, s: Shape, bobY: number, out: Contact): number {
  if (s.kind === 'sphere') {
    const dx = px - s.x, dy = py - (s.y + bobY), dz = pz - s.along;
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    out.nx = dx / d; out.ny = dy / d; out.nz = dz / d;
    return d - s.r;
  }
  const yaw = s.yaw ?? 0, c = Math.cos(yaw), sn = Math.sin(yaw);
  const dx = px - s.x, dz = pz - s.along;
  const lx = dx * c + dz * sn, lz = -dx * sn + dz * c;             // into box space
  const ly = py - (s.y + bobY + s.sy / 2);
  const hx = s.sx / 2, hy = s.sy / 2, hz = s.sz / 2;
  const qx = Math.abs(lx) - hx, qy = Math.abs(ly) - hy, qz = Math.abs(lz) - hz;
  let dist: number;
  if (qx > 0 || qy > 0 || qz > 0) {
    // outside: distance to the box and the direction from the closest surface point
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    dist = Math.hypot(ox, oy, oz);
    tmp.x = Math.sign(lx) * ox; tmp.y = Math.sign(ly) * oy; tmp.z = Math.sign(lz) * oz;
  } else {
    // inside: push out through the nearest face
    dist = Math.max(qx, qy, qz);
    tmp.x = 0; tmp.y = 0; tmp.z = 0;
    if (qx >= qy && qx >= qz) tmp.x = Math.sign(lx) || 1; else if (qy >= qz) tmp.y = Math.sign(ly) || 1; else tmp.z = Math.sign(lz) || 1;
  }
  const l = Math.hypot(tmp.x, tmp.y, tmp.z) || 1;
  const nxl = tmp.x / l, nzl = tmp.z / l;
  out.nx = nxl * c - nzl * sn; out.nz = nxl * sn + nzl * c; out.ny = tmp.y / l;   // back to chunk space
  return dist;
}

/** Signed distance from a point to the shape surface (negative inside). */
export function pointClearance(px: number, py: number, pz: number, s: Shape, bobY = 0): number {
  return sphereVsShape(px, py, pz, s, bobY, { depth: 0, nx: 0, ny: 0, nz: 0 });
}

/** Signed clearance between the capsule and the shape (negative = penetration depth). Writes the push normal. */
export function capsuleClearance(b: Body, s: Shape, bobY: number, out: Contact): number {
  const r = b.radius;
  const y0 = b.y + r, y1 = Math.max(y0, b.y + b.height - r);
  const n = 4;
  let best = Infinity;
  const c: Contact = { depth: 0, nx: 0, ny: 0, nz: 0 };
  for (let i = 0; i < n; i++) {
    const y = y0 + (y1 - y0) * (i / (n - 1));
    const d = sphereVsShape(b.x, y, b.along, s, bobY, c) - r;
    if (d < best) { best = d; out.nx = c.nx; out.ny = c.ny; out.nz = c.nz; }
  }
  out.depth = -best;
  return best;
}

/** quick reject: along-extent of a shape (for broad-phase) */
export function alongExtent(s: Shape): number {
  if (s.kind === 'sphere') return s.r;
  const yaw = s.yaw ?? 0;
  return (s.sx * Math.abs(Math.sin(yaw)) + s.sz * Math.abs(Math.cos(yaw))) / 2;
}
export function shapeTop(s: Shape) { return s.kind === 'sphere' ? s.y + s.r : s.y + s.sy; }
export function shapeBottom(s: Shape) { return s.kind === 'sphere' ? s.y - s.r : s.y; }
