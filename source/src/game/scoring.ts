/**
 * Arcade scoring: distance x multiplier, near misses, pearls, current surfing, risky lines, surviving the 12th Tide.
 * The multiplier climbs with consecutive skilled actions and decays after a few idle seconds; a hit resets it.
 */
export interface ScoreEvent { kind: 'near' | 'pearl' | 'risky' | 'ride' | 'tide' | 'hit' | 'combo' | 'surge' | 'ring' | 'trick'; text: string; sub?: string; value?: number; points?: number }

const MULT_MAX = 8;
const IDLE = 6;

export class Scoring {
  score = 0;
  mult = 1;
  distance = 0;
  best = 0;
  bestDistance = 0;
  stats = { nearMisses: 0, pearls: 0, risky: 0, tides: 0, maxMult: 1, rideMetres: 0, hits: 0 };
  private idle = 0;
  private distAcc = 0;
  private rideAcc = 0;
  onEvent: ((e: ScoreEvent) => void) | null = null;

  constructor() {
    try { this.best = Number(localStorage.getItem('t12.best') ?? 0) || 0; this.bestDistance = Number(localStorage.getItem('t12.bestDist') ?? 0) || 0; } catch { /* private mode */ }
  }

  reset() { this.score = 0; this.mult = 1; this.distance = 0; this.idle = 0; this.distAcc = 0; this.rideAcc = 0; this.stats = { nearMisses: 0, pearls: 0, risky: 0, tides: 0, maxMult: 1, rideMetres: 0, hits: 0 }; }

  private bump(k: number) { this.mult = Math.min(MULT_MAX, this.mult + k); this.stats.maxMult = Math.max(this.stats.maxMult, this.mult); this.idle = 0; }
  private emit(e: ScoreEvent) { this.onEvent?.(e); }
  private add(points: number) { const v = Math.round(points * this.mult); this.score += v; return v; }

  /** per frame: distance points (1 per metre x mult) and multiplier decay. Surge currents pay points but no combo
   *  (everyone rides the surge; the combo is for choices). */
  update(dt: number, dz: number, ridingCurrent: boolean, surging = false) {
    this.distance += dz;
    this.distAcc += dz;
    if (this.distAcc >= 1) { const m = Math.floor(this.distAcc); this.distAcc -= m; this.score += Math.round(m * this.mult); }
    this.idle += dt;
    if (this.idle > IDLE && this.mult > 1) this.mult = Math.max(1, this.mult - dt * 0.5);
    if (ridingCurrent) {
      this.rideAcc += dz; this.stats.rideMetres += dz;
      if (this.rideAcc >= 25) { this.rideAcc = 0; const v = this.add(40); if (!surging) this.bump(0.25); else this.idle = Math.min(this.idle, IDLE * 0.5); this.emit({ kind: 'ride', text: surging ? 'SURGE RIDE' : 'CURRENT RIDE', sub: `+${v}`, value: v, points: v }); }
    } else this.rideAcc = Math.max(0, this.rideAcc - dz * 0.5);
  }

  nearMiss(closeness: number) {
    this.stats.nearMisses++;
    const v = this.add(40 + 60 * closeness);
    this.bump(0.5);
    this.emit({ kind: 'near', text: closeness > 0.7 ? 'RAZOR PASS' : 'NEAR MISS', sub: `+${v}  ×${this.mult.toFixed(1)}`, value: closeness, points: v });
  }
  pearl(value: number, risky: boolean) {
    this.stats.pearls++;
    const v = this.add(value);
    if (risky) this.bump(0.1);
    this.idle = Math.min(this.idle, IDLE * 0.5);
    return v;
  }
  /** out of the Kraken's chamber alive */
  kraken() {
    const v = this.add(500);
    this.bump(1.2);
    this.emit({ kind: 'tide', text: 'ESCAPED THE KRAKEN', sub: `+${v}  ×${this.mult.toFixed(1)}`, value: v, points: v });
    return v;
  }
  /** jumped a treasure chest and it flew open */
  treasure() {
    const v = this.add(120);
    this.bump(0.4);
    this.emit({ kind: 'near', text: 'TREASURE!', sub: `+${v}  ×${this.mult.toFixed(1)}`, value: 1, points: v });
    return v;
  }
  risky(bonus: number) { this.stats.risky++; const v = this.add(bonus); this.bump(1); this.emit({ kind: 'risky', text: 'RISKY LINE', sub: `+${v}  ×${this.mult.toFixed(1)}`, value: v, points: v }); }
  /** threaded a reef gate: worth more for each gate in a row */
  ring(streak: number) {
    const k = Math.min(streak, 5);
    const v = this.add(40 + 20 * k);
    this.bump(0.3 + 0.1 * k);
    this.idle = Math.min(this.idle, IDLE * 0.5);
    this.emit({ kind: 'ring', text: streak > 1 ? `THREADED ×${streak}` : 'THREADED', sub: `+${v}`, value: streak, points: v });
  }
  surge() { this.emit({ kind: 'surge', text: 'SURGE', sub: '' }); }
  /** a clean landing off the top of the wave: the trick's points, and the combo climbs with the size of it */
  trick(name: string, points: number) {
    const v = this.add(points);
    this.bump(0.4 + Math.min(1.2, points / 400));
    this.emit({ kind: 'trick', text: name, sub: `+${v}  ×${this.mult.toFixed(1)}`, value: points, points: v });
  }
  tideSurvived() {
    // the survival bonus scales with the combo but caps at x3 so one event can't dwarf a whole run
    this.stats.tides++;
    const m = Math.min(this.mult, 3);
    const v = Math.round(2000 * m); this.score += v; this.bump(2);
    this.emit({ kind: 'tide', text: '12TH TIDE SURVIVED', sub: `+${v.toLocaleString()}  ×${m.toFixed(1)}`, value: v, points: v });
  }
  hit(fatal: boolean) {
    this.stats.hits++;
    const lost = this.mult;
    this.mult = 1;
    if (!fatal) this.emit({ kind: 'hit', text: 'SHIELD LOST', sub: lost > 1.05 ? `multiplier ×${lost.toFixed(1)} → ×1` : 'one more hit ends the run' });
  }

  /** end of run: persist bests */
  finish() {
    const newBest = this.score > this.best;
    if (newBest) { this.best = this.score; try { localStorage.setItem('t12.best', String(this.score)); } catch { /* */ } }
    if (this.distance > this.bestDistance) { this.bestDistance = this.distance; try { localStorage.setItem('t12.bestDist', String(Math.round(this.distance))); } catch { /* */ } }
    return newBest;
  }
}
