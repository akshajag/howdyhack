/** Seeded RNG (mulberry32) plus the helpers the generator needs. Deterministic for a given seed string/number. */
export class Rng {
  private s: number;
  constructor(seed: number | string) {
    this.s = typeof seed === 'number' ? seed | 0 : hashString(seed);
  }
  /** 0 <= x < 1 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p: number) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** weighted pick: items with weight <= 0 are never chosen */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T | null {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return null;
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, weight(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  /** approximately gaussian in [-1, 1] */
  gauss() { return (this.next() + this.next() + this.next() - 1.5) / 1.5; }
  fork(salt: number | string) { return new Rng(hashString(`${this.s}:${salt}`)); }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

/** A human-friendly seed for sharing runs: 6 base-32 chars. */
export function randomSeed(): string {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
