import type { HandTracker, ControlMode } from '../game/hand';
import { HAND_SETTINGS } from '../game/hand';

/**
 * Menu shell: title, control choice, webcam setup + calibration, how to play, settings, pause, game over.
 * Pure DOM, no framework. Every button does something real; the game shell wires the callbacks.
 */
export type Screen = 'none' | 'title' | 'setup' | 'howto' | 'settings' | 'pause' | 'over' | 'handlost';

export type PlayerKind = 'runner' | 'reveille';
export interface Settings { volume: number; muted: boolean; sensitivity: number; quality: 'auto' | 'low' | 'medium' | 'high'; seed: string; mirror: boolean; control: ControlMode; character: PlayerKind }

export class Menus {
  readonly root: HTMLElement;
  screen: Screen = 'none';
  settings: Settings = { volume: 0.8, muted: false, sensitivity: 1, quality: 'auto', seed: '', mirror: true, control: 'body', character: 'runner' };
  /** the camera control mode changed (body / hand) */
  onControl: ((m: ControlMode) => void) | null = null;
  onPlay: ((withCamera: boolean) => void) | null = null;
  /** replay the first-run tutorial */
  onTutorial: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onMenu: (() => void) | null = null;
  onSettings: ((s: Settings) => void) | null = null;
  onStartCamera: (() => Promise<boolean>) | null = null;
  /** the camera setup screen opened (the game shell switches to its setup state so the screen updates every frame) */
  onSetupOpen: (() => void) | null = null;
  onRecalibrate: (() => void) | null = null;
  onClick: (() => void) | null = null;
  private hand: HandTracker | null = null;
  private preview: HTMLCanvasElement;
  private previewTimer = 0;

  constructor() {
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('t12.settings') ?? '{}')); } catch { /* */ }
    const r = document.createElement('div');
    r.id = 'menus';
    r.innerHTML = `
      <section class="scr s-title">
        <div class="t-brand"><div class="t-kicker">RUN · SURF · SWIM</div><h1>THE 12<sup>TH</sup> TIDE</h1><div class="t-sub">A coastal endless runner. Every twelfth tide, the ocean comes for you.</div></div>
        <div class="t-btns">
          <button class="primary b-play-cam">▶ Play with the camera</button>
          <button class="b-play-key">Play with keyboard</button>
          <div class="row"><button class="b-howto">How to play</button><button class="b-settings">Settings</button></div>
          <div class="seg who"><button class="b-who-runner">Play as the runner</button><button class="b-who-reveille" title="Reveille, the First Lady of Aggieland: beach, pier and surf (she doesn't dive)">Play as Reveille</button></div>
          <button class="b-demo" title="A set course that shows the whole game in about two minutes (seed DEMO)">Demo course: off</button>
        </div>
        <div class="t-foot"><span class="t-best"></span><span class="t-hint">Space / Enter starts with the keyboard</span></div>
      </section>
      <section class="scr s-setup">
        <div class="panel">
          <div class="p-kicker">CAMERA</div><h2 class="setup-title">You are the controller</h2>
          <div class="seg"><button class="b-mode-body">Body</button><button class="b-mode-head">Head</button><button class="b-mode-hand">Hand</button></div>
          <div class="setup-grid">
            <div class="cam-col"><canvas class="setup-preview" width="320" height="240"></canvas><div class="cam-state">requesting camera…</div></div>
            <div class="how-col">
              <ul class="how how-body">
                <li><b>Step back</b> until your head and shoulders are in the picture (standing or sitting). Stand still for a second: that's your rest spot.</li>
                <li><b>Lean or step left / right</b> to pick a lane.</li>
                <li><b>Hop</b> (or bob up in your chair) to jump, <b>duck</b> to slide.</li>
                <li><b>Both hands up</b> for a short surge of speed. Under water, <b>your body is where you swim</b>: lean across, rise up, crouch down.</li>
              </ul>
              <ul class="how how-head">
                <li><b>Sit or stand facing the camera</b>, face near the middle of the picture. Hold still for a second: that's your rest spot.</li>
                <li><b>Slip your head left / right</b> (a quick shadowboxing move, or a quick turn) to step one lane that way. Coming back to the middle does nothing.</li>
                <li><b>Bob up</b> to jump, <b>duck</b> (or nod down) to slide.</li>
                <li><b>Both hands up</b> for a surge. Under water, <b>your head is where you swim</b>: wherever your head rests as you dive is the middle, then the swimmer follows your head.</li>
              </ul>
              <ul class="how how-hand">
                <li><b>Rest your elbow</b> on the desk or an armrest, open hand at chin height, palm to the camera. Hold still for a second: that's your rest spot.</li>
                <li><b>Move your hand left, centre or right</b> to pick a lane.</li>
                <li><b>Flick up</b> to jump, <b>flick down</b> to slide (or raise / lower it slowly and further).</li>
                <li><b>Close your fist</b> for a short surge of speed. Under water, <b>your hand is where you swim</b>.</li>
              </ul>
              <label class="slider">Sensitivity <input type="range" class="i-sens" min="0.6" max="1.8" step="0.05"><span class="v-sens"></span></label>
            </div>
          </div>
          <div class="p-btns"><button class="primary b-setup-go" disabled>Start when calibrated</button><button class="b-recal">Recalibrate</button><button class="b-setup-key">Use keyboard instead</button><button class="b-back">Back</button></div>
        </div>
      </section>
      <section class="scr s-howto">
        <div class="panel">
          <div class="p-kicker">HOW TO PLAY</div><h2>Survive the coast. Beat your best.</h2>
          <div class="cols">
            <div><h3>Camera: body</h3><table><tr><td>Switch lanes</td><td>lean or step left / right</td></tr><tr><td>Jump</td><td>hop (or bob up)</td></tr><tr><td>Slide</td><td>duck</td></tr><tr><td>Swim</td><td>your body is where you swim</td></tr><tr><td>Surge</td><td>both hands up</td></tr></table>
              <h3>Camera: head</h3><table><tr><td>Switch lanes</td><td>slip your head left / right (one lane each)</td></tr><tr><td>Jump / slide</td><td>bob up / duck</td></tr><tr><td>Swim</td><td>your head is where you swim</td></tr><tr><td>Surge</td><td>both hands up</td></tr></table>
              <h3>Camera: hand</h3><table><tr><td>Switch lanes</td><td>hand left / centre / right</td></tr><tr><td>Jump / slide</td><td>flick up / down</td></tr><tr><td>Swim</td><td>your hand is where you swim</td></tr><tr><td>Surge</td><td>close fist</td></tr></table></div>
            <div><h3>Keyboard</h3><table><tr><td>Switch lanes</td><td>tap A / D or ← →</td></tr><tr><td>Steer (under water)</td><td>hold A / D</td></tr><tr><td>Steer (jet ski)</td><td>hold A / D (Space hop, S duck)</td></tr><tr><td>Jump</td><td>Space or W / ↑</td></tr><tr><td>Slide</td><td>S / ↓</td></tr><tr><td>Swim up / down</td><td>W / S (under water)</td></tr><tr><td>Surge</td><td>Shift</td></tr><tr><td>Pause</td><td>Esc</td></tr><tr><td>Restart</td><td>R</td></tr></table></div>
          </div>
          <ul class="tips">
            <li><b>Near misses</b> pay. Skim an obstacle without touching it to raise your combo.</li>
            <li>On foot there are <b>three lanes</b>. Every rock, log, barrel and sandcastle can be jumped; beams, nets and raised palms are slid under. Under water you swim freely.</li><li><b>Currents</b> are drifting streaks. Sideways ones carry you a lane over; forward ones are fast lanes worth more.</li>
            <li><b>Shorebreak Point</b>: on the board it plays like the beach. Three lanes along the foot of the wave, ollie (jump) the logs, flotsam and small rocks, go round the sea stacks, buoys and pier legs, tuck (slide) under the nets. Rip currents shove you a lane over. From the left lane, go left once more (step or move your hand far left) to carve up the wave and launch off the lip: you throw a backflip and a 360 on your own (slowed down at the top); tap A / D to add a spin, Space to grab. Pink coins in the left lane lead to coins hanging in the air over the lip.</li>
            <li><b>Bolivar Channel</b> (the jet ski): no lanes. Hold A / D to steer anywhere across the channel (or you ride where your hand or body is), Space hops the logs, S ducks the fishing lines, go round the buoys and markers; a boat's wake tosses you up, a floating ramp throws a backflip. Beach it on the sandbar or ditch it over the reef.</li>
            <li><b>Play as Reveille</b> (title screen): the collie runs the land course, beach, pier and Shorebreak Point, with no diving (collies don't); she's lower, so some of what you'd slide under she runs under.</li>
            <li><b>The Kraken</b> lives at the back of the Shipwreck Grotto. Each tentacle shows where it will land first (the red glow): a slam takes one side of the cave, a sweep one depth, a pincer leaves only the middle, a grab closes on where you are, so keep moving. Get past it for a big bonus.</li>
            <li><b>Pink pearls</b> mark the risky line: faster, tighter, worth more.</li>
            <li>The <b>tide counter</b> climbs with every section. On the <b>12th</b>, a surge floods the coast. Survive it for a big bonus and a fresh shield.</li>
            <li>You start with <b>one shield</b>. The second hit ends the run.</li>
          </ul>
          <div class="p-btns"><button class="primary b-tutorial">Play the tutorial</button><button class="b-back">Back</button></div>
        </div>
      </section>
      <section class="scr s-settings">
        <div class="panel">
          <div class="p-kicker">SETTINGS</div><h2>Settings</h2>
          <label class="slider">Sound volume <input type="range" class="i-vol" min="0" max="1" step="0.05"><span class="v-vol"></span></label>
          <label class="check"><input type="checkbox" class="i-mute"> Mute (M)</label>
          <label class="select">Camera control <select class="i-control"><option value="body">Body: lean, hop, duck</option><option value="head">Head: slip, bob, duck</option><option value="hand">Hand: move, flick, fist</option></select></label>
          <label class="slider">Camera sensitivity <input type="range" class="i-sens2" min="0.6" max="1.8" step="0.05"><span class="v-sens2"></span></label>
          <label class="select">Graphics quality <select class="i-quality"><option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label class="text">Course seed <input type="text" class="i-seed" placeholder="random each run" maxlength="16"><span class="hint">Same seed, same course. Leave empty for a new one every run. DEMO: the demo course.</span></label>
          <details class="credits"><summary>Credits</summary>
            <p>Design, code, shaders, Blender kits and all audio are original to The 12th Tide.</p>
            <p>Runner: “Beach Character” and its animations by Quaternius (poly.pizza, CC0); jump and swim clips by The 12th Tide. Straw hat from “Fedora” by Poly by Google (poly.pizza), CC-BY 3.0. The surf wave's shape after “Wave” by Poly by Google (poly.pizza), CC-BY 3.0.</p>
            <p>Reveille: “Husky” and its animations by Quaternius (poly.pizza, CC0), made over as a collie by The 12th Tide.</p>
            <p>Shorebreak Point's sea stacks: “Rock Large” and “Rock” by Quaternius (poly.pizza, CC0), repainted as wet sea rock by The 12th Tide. The Kraken's tentacles: “Tentacle” by Quaternius (poly.pizza, CC0), bent in the game's shader; its head is ours.</p>
            <p>Beach: props, palms, rocks, boats and plants from the Pirate Kit and Nature Kit by Kenney (kenney.nl, CC0) · sand texture “Sand 01” by Rob Tuytel (Poly Haven, CC0).</p>
            <p>Models: “Jellyfish”, “Starfish”, “Seashell”, “Sea anemone” by Poly by Google (poly.pizza), CC-BY 3.0 · “seashell” by Dario Demi (D911C) (poly.pizza), CC-BY 3.0 · “Ship wheel” by Hero.Craft (sketchfab.com), CC-BY 4.0 · Anchor, Chest, palm and nature kit by Quaternius (CC0) · Cannon by James Ray Cock and Yann Kervran, coastal cliffs by Rob Tuytel and Rico Cilliers (Poly Haven, CC0) · palms by FabinhoSC (OpenGameArt, CC0).</p>
            <p>Libraries: Three.js (MIT, © three.js authors) · lil-gui (MIT) · MediaPipe Tasks Vision (Apache-2.0).</p>
          </details>
          <div class="p-btns"><button class="primary b-tutorial">Play the tutorial</button><button class="b-back">Back</button></div>
        </div>
      </section>
      <section class="scr s-pause">
        <div class="panel small"><div class="p-kicker">PAUSED</div><h2>Take a breath</h2>
          <div class="p-btns col"><button class="primary b-resume">Resume (Esc)</button><button class="b-restart">Restart (R)</button><button class="b-menu">Main menu</button></div></div>
      </section>
      <section class="scr s-handlost">
        <div class="panel small"><div class="p-kicker lost-kicker">HAND NOT FOUND</div><h2 class="lost-title">Show your hand to continue</h2><p class="lost-text">The run is paused until the camera sees your open palm again.</p>
          <div class="p-btns col"><button class="b-setup-key2">Switch to keyboard</button><button class="b-menu">Main menu</button></div></div>
      </section>
      <section class="scr s-over">
        <div class="panel">
          <div class="p-kicker o-kicker">WASHED OUT</div><div class="o-score">0</div><div class="o-best"></div>
          <div class="o-grid"></div>
          <div class="p-btns"><button class="primary b-restart">Run again (R)</button><button class="b-menu">Main menu</button></div>
        </div>
      </section>`;
    document.body.appendChild(r);
    this.root = r;
    this.preview = r.querySelector('.setup-preview') as HTMLCanvasElement;
    const q = (s: string) => r.querySelector(s) as HTMLElement;
    const on = (sel: string, fn: () => void) => r.querySelectorAll(sel).forEach((b) => ((b as HTMLElement).onclick = () => { this.onClick?.(); fn(); }));
    on('.b-play-cam', () => this.beginSetup());
    on('.b-play-key', () => this.onPlay?.(false));
    on('.b-howto', () => this.show('howto'));
    on('.b-tutorial', () => this.onTutorial?.());
    // the demo course: a toggle for the seed DEMO (the same as typing it in Settings)
    on('.b-demo', () => { this.settings.seed = this.demo ? '' : 'DEMO'; (q('.i-seed') as HTMLInputElement).value = this.settings.seed; this.apply(); });
    on('.b-settings', () => this.show('settings'));
    on('.b-back', () => this.show('title'));
    on('.b-setup-go', () => this.onPlay?.(true));
    on('.b-setup-key', () => this.onPlay?.(false));
    on('.b-setup-key2', () => this.onPlay?.(false));
    on('.b-recal', () => this.onRecalibrate?.());
    on('.b-mode-body', () => this.setControl('body'));
    on('.b-mode-hand', () => this.setControl('hand'));
    on('.b-mode-head', () => this.setControl('head'));
    on('.b-who-runner', () => { this.settings.character = 'runner'; this.apply(); });
    on('.b-who-reveille', () => { this.settings.character = 'reveille'; this.apply(); });
    on('.b-resume', () => this.onResume?.());
    on('.b-restart', () => this.onRestart?.());
    on('.b-menu', () => this.onMenu?.());
    const s = this.settings;
    const bindRange = (sel: string, vsel: string, key: 'volume' | 'sensitivity', fmt: (v: number) => string) => {
      const i = q(sel) as HTMLInputElement, v = q(vsel);
      i.value = String(s[key]); v.textContent = fmt(s[key]);
      i.oninput = () => { s[key] = +i.value; v.textContent = fmt(s[key]); this.apply(); };
    };
    bindRange('.i-vol', '.v-vol', 'volume', (v) => `${Math.round(v * 100)}%`);
    bindRange('.i-sens', '.v-sens', 'sensitivity', (v) => `${v.toFixed(2)}×`);
    bindRange('.i-sens2', '.v-sens2', 'sensitivity', (v) => `${v.toFixed(2)}×`);
    const mute = q('.i-mute') as HTMLInputElement; mute.checked = s.muted; mute.onchange = () => { s.muted = mute.checked; this.apply(); };
    const ctl = q('.i-control') as HTMLSelectElement; ctl.value = s.control; ctl.onchange = () => this.setControl(ctl.value as ControlMode);
    const qual = q('.i-quality') as HTMLSelectElement; qual.value = s.quality; qual.onchange = () => { s.quality = qual.value as Settings['quality']; this.apply(); };
    const seed = q('.i-seed') as HTMLInputElement; seed.value = s.seed; seed.oninput = () => { s.seed = seed.value.trim(); this.apply(); };
    this.apply(false);
  }

  /** body, head or hand: the setup screen, the lost screen and the settings follow; the camera restarts with the new model */
  setControl(m: ControlMode) {
    const changed = m !== this.settings.control;
    this.settings.control = m;
    this.apply(false);
    if (changed) this.onControl?.(m);
    if (changed && this.screen === 'setup') void this.beginSetup();
  }

  private apply(notify = true) {
    HAND_SETTINGS.sensitivity = this.settings.sensitivity;
    const c = this.settings.control, body = c === 'body', head = c === 'head', r = this.root;
    (r.querySelector('.i-control') as HTMLSelectElement).value = c;
    for (const m of ['body', 'head', 'hand'] as const) {
      r.querySelector(`.b-mode-${m}`)!.classList.toggle('on', c === m);
      (r.querySelector(`.how-${m}`) as HTMLElement).style.display = c === m ? '' : 'none';
    }
    (r.querySelector('.setup-title') as HTMLElement).textContent = body ? 'You are the controller' : head ? 'Your head is the controller' : 'Your hand is the controller';
    (r.querySelector('.lost-kicker') as HTMLElement).textContent = body || head ? 'OUT OF VIEW' : 'HAND NOT FOUND';
    (r.querySelector('.lost-title') as HTMLElement).textContent = body ? 'Step back into the picture' : head ? 'Face the camera to continue' : 'Show your hand to continue';
    (r.querySelector('.lost-text') as HTMLElement).textContent = body ? 'The run is paused until the camera sees your head and shoulders again.' : head ? 'The run is paused until the camera sees your face again.' : 'The run is paused until the camera sees your open palm again.';
    try { localStorage.setItem('t12.settings', JSON.stringify(this.settings)); } catch { /* */ }
    r.querySelector('.b-who-runner')!.classList.toggle('on', this.settings.character === 'runner');
    r.querySelector('.b-who-reveille')!.classList.toggle('on', this.settings.character === 'reveille');
    const demoBtn = r.querySelector('.b-demo') as HTMLElement;
    demoBtn.classList.toggle('on', this.demo); demoBtn.textContent = this.demo ? 'Demo course: on' : 'Demo course: off';
    (this.root.querySelector('.i-sens') as HTMLInputElement).value = String(this.settings.sensitivity);
    (this.root.querySelector('.i-sens2') as HTMLInputElement).value = String(this.settings.sensitivity);
    (this.root.querySelector('.v-sens') as HTMLElement).textContent = `${this.settings.sensitivity.toFixed(2)}×`;
    (this.root.querySelector('.v-sens2') as HTMLElement).textContent = `${this.settings.sensitivity.toFixed(2)}×`;
    if (notify) this.onSettings?.(this.settings);
  }

  /** the demo course is set (seed DEMO) */
  get demo() { return this.settings.seed.trim().toUpperCase() === 'DEMO'; }

  setMuted(m: boolean) { this.settings.muted = m; (this.root.querySelector('.i-mute') as HTMLInputElement).checked = m; this.apply(false); }

  show(s: Screen) {
    this.screen = s;
    this.root.querySelectorAll('.scr').forEach((e) => e.classList.remove('show'));
    if (s !== 'none') this.root.querySelector(`.s-${s}`)?.classList.add('show');
    this.root.classList.toggle('show', s !== 'none');
  }

  setBest(score: number, dist: number) { (this.root.querySelector('.t-best') as HTMLElement).textContent = score > 0 ? `Personal best ${score.toLocaleString()} · ${Math.round(dist)} m` : 'No runs yet. The tide is waiting.'; }

  attachHand(h: HandTracker) { this.hand = h; }

  private async beginSetup() {
    this.show('setup');
    this.onSetupOpen?.();
    const state = this.root.querySelector('.cam-state') as HTMLElement;
    const go = this.root.querySelector('.b-setup-go') as HTMLButtonElement;
    go.disabled = true;
    state.textContent = 'requesting camera… (allow access in the browser prompt)';
    const ok = await this.onStartCamera?.();
    if (!ok) { state.textContent = `camera unavailable: ${this.hand?.error ?? 'permission denied'}. You can still play with the keyboard.`; return; }
  }

  /** per frame while the setup screen is open */
  updateSetup(dt: number) {
    if (this.screen !== 'setup' || !this.hand) return;
    this.previewTimer += dt;
    const h = this.hand;
    h.drawPreview(this.preview);
    const state = this.root.querySelector('.cam-state') as HTMLElement;
    const go = this.root.querySelector('.b-setup-go') as HTMLButtonElement;
    const body = h.mode === 'body', head = h.mode === 'head';
    const msg: Record<string, string> = {
      off: '', loading: `loading ${body ? 'body' : head ? 'head' : 'hand'} tracking… (first time downloads the model)`,
      calibrating: h.hint || (body ? (h.raw ? 'found you. stand still…' : 'step back so your head and shoulders are in the picture')
        : head ? (h.raw ? 'found you. hold your head still…' : 'face the camera, face near the middle of the picture')
          : (h.raw ? 'hand found. hold it still…' : 'rest your elbow and show your open hand to the camera')),
      tracking: `calibrated · ${h.usingWorker ? 'worker' : 'main thread'} · ${h.inferenceMs.toFixed(0)} ms`, lost: body ? 'lost you. step back into the picture' : head ? 'lost you. face the camera' : 'hand lost. show your palm', error: `camera error: ${h.error}`,
    };
    state.textContent = msg[h.status];
    const ready = h.status === 'tracking' || h.status === 'lost';
    go.disabled = !ready;
    go.textContent = ready ? 'Start the run' : 'Start when calibrated';
  }

  gameOver(s: { score: number; best: number; newBest: boolean; distance: number; maxMult: number; nearMisses: number; pearls: number; tides: number; risky: number; cause: string }) {
    const r = this.root;
    (r.querySelector('.o-kicker') as HTMLElement).textContent = s.cause;
    (r.querySelector('.o-score') as HTMLElement).textContent = s.score.toLocaleString();
    const b = r.querySelector('.o-best') as HTMLElement;
    b.textContent = s.newBest ? 'NEW PERSONAL BEST' : `Personal best ${s.best.toLocaleString()}`;
    b.classList.toggle('new', s.newBest);
    (r.querySelector('.o-grid') as HTMLElement).innerHTML = [
      ['Distance', `${Math.round(s.distance).toLocaleString()} m`], ['Best combo', `×${s.maxMult.toFixed(1)}`], ['Near misses', `${s.nearMisses}`],
      ['Pearls', `${s.pearls}`], ['Risky lines', `${s.risky}`], ['12th Tides survived', `${s.tides}`],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    this.show('over');
  }
}
