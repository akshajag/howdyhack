import type { Wave } from './types';

/**
 * Shorebreak Point's wave: one shape shared by the board physics, the renderer, the patterns and the validator.
 *
 * Across the course (x) the wave is: flat sea far out (-x) -> its back rising to the crest -> the face falling, steep
 * at the top and easing out at the bottom, to its foot -> a little foam and the flats -> the shore (+x). You ride the
 * face between the lip and the flats: high is near the crest (slow, close to the lip, where the airs are), low is the
 * foot (fast after the drop, but the flats drag). Chunk ends all meet the standard wave (H_BASE, CREST, FOOT), so
 * patterns join seamlessly.
 */
export const H_BASE = 6.2;          // crest height above the sea (m)
export const CREST = -11.5;         // x of the crest at chunk joins (the lanes run on the wash to the right of the face)
export const FOOT = -4;             // x of the foot of the face at chunk joins
/** you can't ride closer to the lip than this (fast up into it launches you instead) */
export const LIP_PAD = 0.4;
/** how far past the foot you can ride out onto the flats */
export const FLATS = 4.5;
const BACK = 20;                    // length of the wave's back slope behind the crest
const FOOT_H = 0.07;                // the foot is a little above the sea (a bank of foam)
const FLAT_LEN = 7;

const smooth01 = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };

/** water height above the sea level at (x, along) on this wave */
export function waveY(w: Wave, x: number, along: number): number {
  const H = w.h(along);
  if (H < 0.02) return 0;
  const xc = w.crest(along), xf = w.foot(along);
  if (x <= xc) return H * (1 - smooth01((xc - x) / BACK));
  if (x >= xf) return H * FOOT_H * (1 - smooth01((x - xf) / FLAT_LEN));
  const s = (xf - x) / (xf - xc);                          // 0 at the foot .. 1 at the crest
  return H * (FOOT_H + (1 - FOOT_H) * Math.pow(s, 2.0));
}

/** where you can ride at this along: from just under the lip out to the flats */
export function rideRange(w: Wave, along: number): [number, number] {
  return [w.crest(along) + LIP_PAD, w.foot(along) + FLATS];
}

/** 0 at the foot .. 1 at the crest (beyond the foot: negative) */
export function faceT(w: Wave, x: number, along: number) {
  const xc = w.crest(along), xf = w.foot(along);
  return (xf - x) / (xf - xc);
}

/** the standard wave, with an optional shape inside the chunk that eases back to the standard one at both ends */
export function standardWave(length: number, o: { h?: (a: number) => number; crest?: (a: number) => number; foot?: (a: number) => number } = {}): Wave {
  // weight of the pattern's own shape: 0 at the joins, 1 from 12 m in
  const k = (a: number) => smooth01(Math.min(a, length - a) / 12);
  return {
    h: (a) => H_BASE + (o.h ? (o.h(a) - H_BASE) * k(a) : 0),
    crest: (a) => CREST + (o.crest ? (o.crest(a) - CREST) * k(a) : 0),
    foot: (a) => FOOT + (o.foot ? (o.foot(a) - FOOT) * k(a) : 0),
  };
}

// ---------------------------------------------------------------- the drawn cross-section
/**
 * One row of the wave as a polyline across it (world x, y above the sea), from the sea to the shore: the back slope
 * rising to the crest, the lip rolling forward and down as a fat round tube, its underside curving back into the face
 * under the crest (the throat), the concave face down to the foot, then the flats. The proportions come from two
 * places: the wave-particle theory of breaking (Fournier and Reeves 1986, Gonzato and Le Saec 1999: as the orbits
 * steepen the crest is stretched forward and plunges) and Poly by Google's low-poly "Wave" (poly.pizza/m/6mpwUZqCgzy,
 * CC-BY 3.0), measured: the lip throws out about a third of the width, its tip hanging at ~60 % of the height.
 * `curl` 0..1: 0 is an unbroken swell (a rounded crest, no lip), 1 a full barrel. Each point carries `face` (0 foot ..
 * 1 crest, > 1 back, < 0 flats), `lip` (0 on the body .. 1 at the lip's tip) and `under` (1 on the underside of the
 * lip and the throat, the roof of the tube) for the shader.
 */
export interface SectionPt { x: number; y: number; face: number; lip: number; under: number }
const BACK_N = 7, LIP_N = 12, UNDER_N = 8, FACE_N = 18, FLAT_N = 5;
/** number of points in every section (rows must match to make a grid) */
export const SECTION_N = BACK_N + 1 + LIP_N + UNDER_N + FACE_N + FLAT_N;

const bez = (p0: number, p1: number, p2: number, p3: number, t: number) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };

/** where the lip's tip is at this along (for spray) */
export function lipTip(w: Wave, along: number, curl: number): { x: number; y: number; dx: number } {
  const H = w.h(along), xc = w.crest(along), L = w.foot(along) - xc;
  const dx = L * (0.06 + 0.4 * curl);
  const y = Math.max(H * (0.95 - 0.36 * curl), waveY(w, xc + dx, along) + 1.5 + 1.1 * curl);
  return { x: xc + dx, y, dx };
}

export function section(w: Wave, along: number, curl: number, out: SectionPt[] = [], hScale = 1): SectionPt[] {
  const H0 = w.h(along), H = H0 * hScale, xc = w.crest(along), xf = w.foot(along), L = xf - xc;
  const yAt = (x: number) => waveY(w, x, along) * hScale;
  out.length = 0;
  const put = (x: number, y: number, face: number, lip: number, under = 0) => out.push({ x, y, face, lip, under });
  if (H < 0.05) {
    for (let i = 0; i < SECTION_N; i++) put(xc - BACK + (i / (SECTION_N - 1)) * (BACK + L + FLAT_LEN), -0.06, 1 - i / (SECTION_N - 1), 0);
    return out;
  }
  // the back: an under-sea edge, then the slope up (denser near the crest)
  put(xc - BACK, -0.4, 2.5, 0);
  for (let i = 1; i < BACK_N; i++) { const s = Math.pow(i / (BACK_N - 1), 0.6); const x = xc - BACK * (1 - s); put(x, yAt(x), 1 + (1 - s), 0); }
  put(xc, H, 1, 0);
  // the lip: a fat roll from the crest out and over to a round nose at the tip
  const tip = lipTip(w, along, curl);
  const T = { x: tip.x, y: Math.min(H - 0.05, tip.y * hScale) };
  const thick = H * (0.1 + 0.16 * curl);                                        // the roll's thickness at the nose
  const p1 = { x: xc + tip.dx * 0.35, y: H + 0.1 + 0.3 * curl * H * 0.25 }, p2 = { x: T.x + 0.25 * thick + tip.dx * 0.08, y: T.y + thick * 1.1 };
  for (let i = 1; i <= LIP_N; i++) { const t = i / LIP_N; put(bez(xc, p1.x, p2.x, T.x + 0.1 * thick, t), bez(H, p1.y, p2.y, T.y, t), 1, t); }
  // round the nose and come back along the underside into the throat under the crest
  const ax = xc + 0.35 + 0.3 * curl, ay = yAt(ax);
  const u1 = { x: T.x - thick * 0.9, y: T.y - thick * 0.35 }, u2 = { x: ax + tip.dx * 0.45, y: ay - 0.02 * H };
  for (let i = 1; i <= UNDER_N; i++) { const t = i / UNDER_N; put(bez(T.x + 0.1 * thick, u1.x, u2.x, ax, t), bez(T.y, u1.y, u2.y, ay, t), 1, 1 - t, 1); }
  // the face, from under the lip down to the foot (denser up top, where it's steep)
  for (let i = 1; i <= FACE_N; i++) { const s = Math.pow(i / FACE_N, 1.35); const x = ax + (xf - ax) * s; put(x, yAt(x), 1 - (x - xc) / L, 0, i <= 3 ? 1 - i / 4 : 0); }
  // the flats, dipping under the sea at the end
  for (let i = 1; i <= FLAT_N; i++) { const s = i / FLAT_N; const x = xf + (FLAT_LEN + 1.5) * s; put(x, i === FLAT_N ? -0.35 : yAt(x), -s * 1.2, 0); }
  return out;
}
