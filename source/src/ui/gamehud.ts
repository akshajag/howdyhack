import type { Scoring, ScoreEvent } from '../game/scoring';
import type { Runner } from '../game/runner';
import type { TideManager } from '../game/tide';
import type { HandTracker } from '../game/hand';
import { MOVE } from '../game/types';

/** In-run HUD: score / best / multiplier / distance, tide counter, surge + shield, hand status, event feed, zone titles. */
export class GameHud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private zoneT = 0;
  private preview: HTMLCanvasElement;
  private lastMultShown = 1;
  private lastAir = 1;
  private tier = 0;
  private flying = 0;

  constructor() {
    const r = document.createElement('div');
    r.id = 'hud-run';
    r.innerHTML = `
      <div class="h-score"><span>SCORE</span><b class="h-scorev">0</b><i class="h-best">BEST 0</i><em class="h-pop"></em></div>
      <div class="h-mult"><b class="h-multv">×1.0</b><span>combo</span></div>
      <div class="h-dist"><b class="h-distv">0</b><span>m</span><em class="h-biome">Sunbreaker Beach</em></div>
      <div class="h-tide"><div class="h-tidelabel">CALM TIDE</div><div class="h-pips">${Array.from({ length: 12 }, (_, i) => `<i class="${i === 11 ? 'last' : ''}"></i>`).join('')}</div><div class="h-tidesub">tide <b class="h-tidestep">1</b> / 12</div></div>
      <div class="h-air"><b>O₂</b><i class="h-airbar"><u></u></i></div>
      <div class="h-abil"><div class="h-surge"><i></i><span>SURGE</span></div><div class="h-shield"><em>◈</em><span>SHIELD</span></div></div>
      <div class="h-hand"><canvas class="h-preview" width="176" height="132"></canvas><div class="h-handstate"></div></div>
      <div class="h-zone"><div class="z-title"></div></div>
      <div class="h-banner"><div class="b-title"></div></div>
      <div class="h-hint"></div>
      <div class="h-coach"><div class="c-title"></div><div class="c-sub"></div></div>
      <div class="h-lanes"><b class="up">▲</b><i></i><i></i><i></i><em></em><b class="dn">▼</b><u></u></div>
      <div class="h-flash"></div>
      <div class="h-vignette"></div>`;
    document.body.appendChild(r);
    this.root = r;
    for (const k of ['coach', 'lanes', 'air', 'airbar', 'scorev', 'best', 'multv', 'mult', 'distv', 'biome', 'tidelabel', 'pips', 'tidestep', 'surge', 'shield', 'hand', 'handstate', 'pop', 'zone', 'banner', 'hint', 'flash', 'tide', 'vignette'])
      this.el[k] = r.querySelector(`.h-${k}`) as HTMLElement;
    this.preview = r.querySelector('.h-preview') as HTMLCanvasElement;
  }

  show(v: boolean) { this.root.classList.toggle('show', v); }

  /** gameplay events: no text in the play area, just a small "+points" beside the score, the combo pop and a soft
   *  edge flash */
  event(e: ScoreEvent) {
    if (e.points) this.scorePop(e.points, e.kind === 'trick' ? e.text : '');             // (a trick says what it was)
    const cls = e.kind === 'tide' || e.kind === 'risky' ? 'gold' : e.kind === 'near' || e.kind === 'trick' ? 'white' : e.kind === 'surge' ? 'aqua' : '';
    if (cls) this.flash(cls);
    if (e.kind === 'near' || e.kind === 'risky' || e.kind === 'ride' || e.kind === 'tide' || e.kind === 'ring' || e.kind === 'trick') this.pop(this.el.mult);
  }
  /** a coin you just took flies up into the score (from where it was on screen, in px) */
  coinFly(x: number, y: number, risky: boolean) {
    if (this.flying >= 14 || !this.root.classList.contains('show')) return;
    const box = this.el.scorev.getBoundingClientRect(), tx = box.left + box.width * 0.5, ty = box.top + box.height * 0.5;
    const c = document.createElement('i');
    c.className = risky ? 'fly-coin risky' : 'fly-coin';
    c.style.left = `${x}px`; c.style.top = `${y}px`;
    this.root.appendChild(c);
    this.flying++;
    // (a little arc: up and over to the counter)
    const dx = tx - x, dy = ty - y, ox = (Math.random() - 0.5) * 60;
    const a = c.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.45 + ox}px), calc(-50% + ${dy * 0.35 - 40}px)) scale(0.9)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.45)`, opacity: 0.6 },
    ], { duration: 520, easing: 'cubic-bezier(.4,.1,.6,1)' });
    a.onfinish = () => { c.remove(); this.flying--; const s = this.el.scorev.parentElement!; s.classList.remove('gain'); void s.offsetWidth; s.classList.add('gain'); };
  }
  scorePop(points: number, label = '') {
    const p = this.el.pop;
    p.textContent = label ? `${label}  +${points.toLocaleString()}` : `+${points.toLocaleString()}`;
    p.classList.remove('go'); void p.offsetWidth; p.classList.add('go');
  }
  /** a one-line hint at the bottom (controls on the first run) */
  hint(text: string, hold = 5) {
    const h = this.el.hint;
    h.textContent = text; h.classList.add('show');
    setTimeout(() => h.classList.remove('show'), hold * 1000);
  }
  flash(cls: string) { const f = this.el.flash; f.className = `h-flash ${cls}`; void f.offsetWidth; f.classList.add('go'); }
  private pop(el: HTMLElement) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

  /** tutorial prompt (big, centre); `nice` shows the success state */
  coach(title: string | null, sub = '', nice = false) {
    const c = this.el.coach;
    if (!title) { c.classList.remove('show', 'nice'); return; }
    (c.querySelector('.c-title') as HTMLElement).textContent = title;
    (c.querySelector('.c-sub') as HTMLElement).textContent = sub;
    c.classList.add('show'); c.classList.toggle('nice', nice);
  }
  /** the biome name, one small line, when the biome changes */
  zone(title: string) {
    const z = this.el.zone;
    (z.querySelector('.z-title') as HTMLElement).textContent = title;
    z.classList.remove('show'); void z.offsetWidth; z.classList.add('show');
    this.zoneT = 2.2;
  }
  /** one big title for the big moments only (the 12th Tide arriving / survived) */
  banner(title: string, hold = 2.2) {
    const b = this.el.banner;
    (b.querySelector('.b-title') as HTMLElement).textContent = title;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), hold * 1000);
  }

  update(dt: number, s: Scoring, r: Runner, tide: TideManager, hand: HandTracker | null, biomeName: string, near: number) {
    if (this.zoneT > 0) { this.zoneT -= dt; if (this.zoneT <= 0) this.el.zone.classList.remove('show'); }
    this.el.scorev.textContent = s.score.toLocaleString();
    this.el.best.textContent = `BEST ${Math.max(s.best, s.score).toLocaleString()}`;
    this.el.multv.textContent = `×${s.mult.toFixed(1)}`;
    // each combo tier (×2, ×3, ×5, ×8) arrives with a bigger pop and a shake; it drops back quietly
    const tier = s.mult >= 8 ? 4 : s.mult >= 5 ? 3 : s.mult >= 3 ? 2 : s.mult >= 2 ? 1 : 0;
    if (tier !== this.tier) {
      this.el.mult.dataset.tier = String(tier);
      if (tier > this.tier) { const m = this.el.mult; m.classList.remove('tierup'); void m.offsetWidth; m.classList.add('tierup'); }
      this.tier = tier;
    }
    this.el.mult.style.setProperty('--m', String(Math.min(1, (s.mult - 1) / 7)));
    if (Math.floor(s.mult * 2) !== Math.floor(this.lastMultShown * 2) && s.mult > this.lastMultShown) this.pop(this.el.mult);
    this.lastMultShown = s.mult;
    this.el.distv.textContent = Math.floor(s.distance).toLocaleString();
    this.el.biome.textContent = biomeName;
    this.el.tidelabel.textContent = tide.label;
    this.el.tidestep.textContent = String(tide.step);
    this.el.tide.className = `h-tide ${tide.phase}`;
    this.el.pips.querySelectorAll('i').forEach((p, i) => p.classList.toggle('on', i < tide.step));
    const surgeFrac = r.surgeCd > 0 ? 1 - r.surgeCd / (MOVE.surgeCooldown + MOVE.surgeTime) : 1;
    this.el.surge.style.setProperty('--f', String(surgeFrac));
    this.el.surge.classList.toggle('ready', r.surgeCd <= 0);
    this.el.surge.classList.toggle('active', r.surgeT > 0);
    this.el.shield.classList.toggle('on', r.shield > 0);
    // air: only under water; pulses when low, flashes when a gate refills it
    this.el.air.classList.toggle('on', r.mode === 'swim');
    this.el.air.classList.toggle('low', r.mode === 'swim' && r.air < MOVE.airLow);
    this.el.air.style.setProperty('--a', String(r.air));
    if (r.air > this.lastAir + 0.1) { const a = this.el.air; a.classList.add('refill'); setTimeout(() => a.classList.remove('refill'), 450); }
    this.lastAir = r.air;
    this.root.style.setProperty('--near', String(near));
    this.root.classList.toggle('invuln', r.invuln > 0);
    // hand mode on foot: which lane the hand is picking, and where the hand points (so the player sees the zones)
    const showLanes = !!hand && hand.status === 'tracking' && r.mode !== 'swim';
    this.el.lanes.classList.toggle('on', showLanes);
    if (showLanes && hand) {
      this.el.lanes.querySelectorAll('i').forEach((p, i) => p.classList.toggle('on', i === r.lane));
      // the cursor crosses into a side slot exactly where the hand crosses the lane threshold
      const k = Math.max(-2.8, Math.min(2.8, hand.stick.x / hand.laneEnter));
      (this.el.lanes.querySelector('em') as HTMLElement).style.left = `${50 + k * 16.7}%`;
      // the jump / slide arrow lights when that gesture registers; the dot shows tracking quality
      const age = hand.gestureAge;
      this.el.lanes.querySelector('.up')!.classList.toggle('fire', hand.gesture?.kind === 'jump' && age < 0.35);
      this.el.lanes.querySelector('.dn')!.classList.toggle('fire', hand.gesture?.kind === 'slide' && age < 0.35);
      (this.el.lanes.querySelector('u') as HTMLElement).className = hand.inferenceMs < 45 ? 'good' : hand.inferenceMs < 90 ? 'ok' : 'slow';
    }
    if (hand && hand.status !== 'off') {
      this.el.hand.style.display = '';
      hand.drawPreview(this.preview);
      const body = hand.mode !== 'hand';
      const msg: Record<string, string> = { loading: 'starting camera…', calibrating: 'hold still to calibrate', tracking: hand.fist ? (body ? 'HANDS UP · surge' : 'FIST · surge') : 'tracking', lost: hand.mode === 'head' ? 'lost you — face the camera' : body ? 'lost you — step back into view' : 'hand lost — show your hand', error: `camera: ${hand.error}`, off: '' };
      this.el.handstate.textContent = msg[hand.status];
      this.el.hand.className = `h-hand ${hand.status}`;
    } else this.el.hand.style.display = 'none';
  }
}
