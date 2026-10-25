import { OceanAudio } from './audio';

/**
 * Game sounds on top of the ocean ambience (still 100% synthesised: footsteps, splashes, jumps, slides, surges,
 * hits, coins, tide horn, the 12th Tide breaker, game over, UI ticks, Reveille's bark) plus a layered procedural music
 * bed whose brightness and pulse follow the run's intensity. Above water the shore lives on its own: waves build, break
 * and wash back at their own pace, the wind gusts, gulls call from all around (single cries, the laughing call, pairs
 * answering each other in the distance) and a bell buoy clangs offshore now and then.
 */
export class GameAudio extends OceanAudio {
  private nextChord = 0;
  private chordIdx = 0;
  private intensity = 0;
  private droneGain: GainNode | null = null;
  private nextWave = 1;
  private nextGull = 2;
  private nextBuoy = 12;
  /** the breaking wave's roar on the board (built the first time it's needed) */
  private roar: { g: GainNode; f: BiquadFilterNode } | null = null;
  volume = 0.8;

  protected start() {
    super.start();
    const ctx = this.ctx; if (!ctx || !this.noise) return;
    // wind: airy high noise that gusts on two slow, out-of-step swells
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true; src.start(0, Math.random() * 5);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.35;
    const g = ctx.createGain(); g.gain.value = 0.035;
    for (const [hz, amt] of [[0.05, 0.018], [0.13, 0.01]] as const) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = hz; const lg = ctx.createGain(); lg.gain.value = amt;
      lfo.connect(lg).connect(g.gain); lfo.start();
    }
    const sweep = ctx.createOscillator(); sweep.frequency.value = 0.07; const sg = ctx.createGain(); sg.gain.value = 700;
    sweep.connect(sg).connect(bp.frequency); sweep.start();
    src.connect(hp).connect(bp).connect(g).connect(this.airBus);
  }

  /** per frame: the ocean bed plus the shore's own life when you're above water */
  update(dt: number, effort: number, depth: number) {
    super.update(dt, effort, depth);
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    if (this.under > 0.5) { this.nextWave = Math.max(this.nextWave, t + 1); this.nextGull = Math.max(this.nextGull, t + 2); return; }
    if (t > this.nextWave) { this.wave(0.7 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8); this.nextWave = t + 4.5 + Math.random() * 4.5; }
    if (t > this.nextGull) {
      const r = Math.random(), pan = (Math.random() - 0.5) * 1.6, far = Math.random();
      if (r < 0.3) this.gullLaugh(t, pan, far);
      else if (r < 0.75) { this.gullCall(t, 700 + Math.random() * 250, 0.32 + Math.random() * 0.12, 0.05, pan, far); if (Math.random() < 0.5) this.gullCall(t + 0.45, 650 + Math.random() * 200, 0.3, 0.04, pan, far); }
      else {
        // two gulls answering each other, one near, one far off
        this.gullCall(t, 760, 0.34, 0.045, -0.6, 0.2); this.gullCall(t + 0.8, 690, 0.38, 0.03, 0.7, 0.9); this.gullCall(t + 1.35, 720, 0.3, 0.03, 0.65, 0.9);
      }
      this.nextGull = t + 2.5 + Math.random() * 5;
    }
    if (t > this.nextBuoy) { this.buoyBell(); this.nextBuoy = t + 16 + Math.random() * 14; }
    void dt;
  }

  /** one gull cry, 'kee-ow': a nasal sawtooth through two formants, up then down, with a rasp; far = 0 near .. 1 far */
  private gullCall(at: number, pitch: number, len: number, gain: number, pan: number, far: number) {
    const ctx = this.ctx; if (!ctx) return;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(pitch * 0.72, at);
    o.frequency.exponentialRampToValueAtTime(pitch * 1.18, at + len * 0.22);
    o.frequency.exponentialRampToValueAtTime(pitch * 0.66, at + len);
    const fm = ctx.createOscillator(); fm.frequency.value = 48 + Math.random() * 30; const fmg = ctx.createGain(); fmg.gain.value = pitch * 0.05;
    fm.connect(fmg).connect(o.frequency);
    const mix = ctx.createGain(); mix.gain.value = 1;
    for (const [f, q] of [[2300 + Math.random() * 300, 3], [3500, 5]] as const) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      o.connect(bp).connect(mix);
    }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000 - far * 6000;
    const env = ctx.createGain(); const peak = gain * (1 - far * 0.65);
    env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(peak, at + 0.025);
    env.gain.setValueAtTime(peak, at + len * 0.45); env.gain.exponentialRampToValueAtTime(0.0005, at + len);
    const pn = ctx.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, pan));
    mix.connect(lp).connect(env).connect(pn).connect(this.airBus);
    if (far > 0.5) { const send = ctx.createGain(); send.gain.value = 0.25 * far; env.connect(send).connect(this.reverb); }
    o.start(at); fm.start(at); o.stop(at + len + 0.05); fm.stop(at + len + 0.05);
  }

  /** the herring gull's long call: a drawn-out cry, then a falling run of short 'ha's */
  private gullLaugh(t: number, pan: number, far: number) {
    const p = 680 + Math.random() * 160;
    this.gullCall(t, p, 0.42, 0.05, pan, far);
    const n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.gullCall(t + 0.5 + i * (0.17 + Math.random() * 0.03), p * (1.05 - i * 0.03), 0.13, 0.045, pan, far);
  }

  /** a wave: the swell builds (low roar opening up), breaks, then washes back up the sand as a long fizz */
  private wave(size: number, pan: number) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime, build = 1.1 + Math.random() * 0.6, wash = 2.6 + Math.random() * 1.6;
    const pn = ctx.createStereoPanner(); pn.pan.value = pan; pn.connect(this.airBus);
    const a = ctx.createBufferSource(); a.buffer = this.noise; a.start(t, Math.random() * 3); a.stop(t + build + wash + 0.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(220, t); lp.frequency.exponentialRampToValueAtTime(2600, t + build); lp.frequency.exponentialRampToValueAtTime(500, t + build + wash);
    const ga = ctx.createGain(); ga.gain.setValueAtTime(0.0001, t); ga.gain.exponentialRampToValueAtTime(0.16 * size, t + build);
    ga.gain.exponentialRampToValueAtTime(0.0005, t + build + wash);
    a.connect(lp).connect(ga).connect(pn);
    // the wash: bright fizz of foam running up the beach and draining back
    const b = ctx.createBufferSource(); b.buffer = this.noise; b.start(t + build * 0.9, Math.random() * 3); b.stop(t + build + wash + 0.4);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.6;
    bp.frequency.setValueAtTime(4200, t + build); bp.frequency.linearRampToValueAtTime(2200, t + build + wash);
    const gb = ctx.createGain(); gb.gain.setValueAtTime(0.0001, t + build * 0.9); gb.gain.linearRampToValueAtTime(0.07 * size, t + build + 0.3);
    gb.gain.exponentialRampToValueAtTime(0.0005, t + build + wash + 0.3);
    b.connect(bp).connect(gb).connect(pn);
  }

  /** a bell buoy rocking far offshore: two soft, inharmonic clangs */
  private buoyBell() {
    const ctx = this.ctx; if (!ctx) return;
    const t0 = ctx.currentTime, pan = (Math.random() - 0.5) * 1.2;
    const pn = ctx.createStereoPanner(); pn.pan.value = pan;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    lp.connect(pn); pn.connect(this.airBus); const send = ctx.createGain(); send.gain.value = 0.5; pn.connect(send).connect(this.reverb);
    for (const [dt, k] of [[0, 1], [1.3 + Math.random() * 0.5, 0.7]] as const) {
      const t = t0 + dt;
      for (const [mult, amp, dec] of [[1, 0.03, 3.2], [2.76, 0.014, 1.6], [5.4, 0.007, 0.8]] as const) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 523 * mult;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp * k, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0002, t + dec);
        o.connect(g).connect(lp); o.start(t); o.stop(t + dec + 0.05);
      }
    }
  }

  /** a coin: the same bright two-note blip every time, whatever the coin */
  coin() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const f = 987.8;                                                                       // B5
    for (const [freq, at, dur, amp] of [[f * 0.75, 0, 0.06, 0.05], [f, 0.055, 0.22, 0.06], [f * 2, 0.055, 0.12, 0.012]] as const) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(amp, t + at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0004, t + at + dur);
      o.connect(g).connect(this.sfxBus); o.start(t + at); o.stop(t + at + dur + 0.03);
    }
  }

  // ---------------- on the board
  /** a sheet of spray off the rail in a hard turn */
  /** a clean trick: a bright rising pair */
  trick() { this.tone(988, 0.05, 0.16, 'triangle', 1.5, this.sfxBus); setTimeout(() => this.tone(1480, 0.045, 0.3, 'triangle', 1.25, this.sfxBus), 90); }
  spray(k: number) { this.burst(2800 + 1200 * Math.random(), 0.6, 0.04 + 0.07 * k, 0.16 + 0.1 * k, 'bandpass', this.airBus); }
  /** per frame on the board: the breaking wave's roar behind you (0..1) */
  surf(near: number) {
    const inTube = false;
    const ctx = this.ctx; if (!ctx || !this.noise) return;
    if (!this.roar) {
      if (near <= 0) return;
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true; src.start(0, Math.random() * 4);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800; f.Q.value = 0.5;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.airBus);
      this.roar = { g, f };
    }
    const t = ctx.currentTime;
    this.roar.g.gain.setTargetAtTime(near > 0 ? 0.05 + 0.3 * near + (inTube ? 0.12 : 0) : 0, t, 0.3);
    this.roar.f.frequency.setTargetAtTime(inTube ? 420 : 700 + 2600 * near, t, 0.25);
  }

  /** Reveille: two quick barks, 'wuf-wuf' */
  bark() {
    const ctx = this.ctx; if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const dt of [0, 0.2]) {
      const t = t0 + dt;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(560, t + 0.025); o.frequency.exponentialRampToValueAtTime(240, t + 0.13);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.1;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.15);
      o.connect(f).connect(g).connect(this.airBus); o.start(t); o.stop(t + 0.17);
      this.burstAt(t, 1400, 0.8, 0.05, 0.08);
    }
  }
  private burstAt(t: number, freq: number, q: number, gain: number, dur: number) {
    const ctx = this.ctx; if (!ctx) return;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.airBus); src.start(t, Math.random() * 4); src.stop(t + dur + 0.05);
  }

  setVolume(v: number) { this.volume = v; if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
  get isMuted() { return this.muted; }
  setMuted(m: boolean) { if (m !== this.muted) this.toggleMute(); }

  /** 0 calm .. 1 the 12th tide */
  setIntensity(k: number) { this.intensity = Math.max(0, Math.min(1, k)); }

  private burst(freq: number, q: number, gain: number, dur: number, type: BiquadFilterType = 'bandpass', bus: AudioNode | null = null) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(bus ?? this.sfxBus); src.start(t, Math.random() * 4); src.stop(t + dur + 0.05);
  }
  private tone(freq: number, gain: number, dur: number, type: OscillatorType = 'sine', slide = 1, bus: AudioNode | null = null) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }

  footstep(surf: boolean) {
    if (surf) { this.burst(1800 + Math.random() * 800, 0.7, 0.08, 0.16, 'bandpass', this.airBus); this.burst(500, 0.8, 0.05, 0.08, 'lowpass', this.airBus); }
    else this.burst(700 + Math.random() * 300, 0.9, 0.07, 0.07, 'lowpass', this.airBus);
  }
  jump() { this.tone(260, 0.06, 0.18, 'sine', 1.8, this.airBus); this.burst(1400, 1.0, 0.05, 0.2, 'bandpass', this.airBus); }
  land(surf: boolean) { this.burst(320, 0.9, 0.12, 0.12, 'lowpass', this.airBus); if (surf) this.splash(0.6); }
  slide() { this.burst(900, 0.6, 0.1, 0.45, 'bandpass', this.airBus); }
  /** the jet ski's engine: a hum that follows the throttle (k 0 = off; per frame) */
  private eng: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; lp: BiquadFilterNode } | null = null;
  engine(k: number) {
    const ctx = this.ctx; if (!ctx) return;
    if (!this.eng) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 70;
      const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = 35;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 0.8;
      const gain = ctx.createGain(); gain.gain.value = 0;
      osc.connect(lp); osc2.connect(lp); lp.connect(gain).connect(this.airBus); osc.start(); osc2.start();
      this.eng = { osc, osc2, gain, lp };
    }
    const t = ctx.currentTime, e = this.eng;
    e.gain.gain.setTargetAtTime(k > 0 ? 0.08 + 0.06 * k : 0, t, k > 0 ? 0.08 : 0.3);
    e.osc.frequency.setTargetAtTime(60 + 110 * k, t, 0.12); e.osc2.frequency.setTargetAtTime(30 + 55 * k, t, 0.12);
    e.lp.frequency.setTargetAtTime(400 + 900 * k, t, 0.12);
  }
  /** the engine catching: a cough and a rev */
  engineStart() { this.burst(180, 0.9, 0.3, 0.25, 'lowpass', this.airBus); setTimeout(() => this.burst(240, 0.9, 0.35, 0.35, 'lowpass', this.airBus), 180); }
  /** the Kraken wakes: a long deep rumble out of the dark */
  krakenRumble() { this.burst(48, 0.9, 0.5, 3.2, 'lowpass', this.master); this.tone(36, 0.35, 3.0, 'sine', 0.8, this.master); }
  /** a tentacle lands: a heavy wet slam */
  krakenSlam() { this.burst(90, 0.8, 0.4, 0.7, 'lowpass', this.master); this.burst(500, 0.7, 0.14, 0.25, 'bandpass'); this.tone(44, 0.25, 0.5, 'sine', 0.7, this.master); }
  /** its heartbeat: a soft double thump */
  heartbeat() { this.burst(60, 1.2, 0.2, 0.22, 'lowpass', this.master); setTimeout(() => this.burst(55, 1.2, 0.14, 0.2, 'lowpass', this.master), 150); }
  /** thunder rolling in after a flash: a deep rumble with a crack on top */
  thunder() { this.burst(70 + Math.random() * 30, 0.7, 0.4, 2.4, 'lowpass', this.airBus); this.burst(240, 0.6, 0.14, 1.1, 'lowpass', this.airBus); this.burst(1400, 0.4, 0.05, 0.25, 'bandpass', this.airBus); }
  splash(size = 1) { this.burst(1600 + 800 * Math.random(), 0.5, 0.22 * size, 0.35 + 0.25 * size, 'bandpass', this.airBus); this.burst(400, 0.8, 0.12 * size, 0.2, 'lowpass', this.airBus); }
  surge() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.6;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.5); f.frequency.exponentialRampToValueAtTime(600, t + 1.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    src.connect(f).connect(g).connect(this.sfxBus); src.start(t, Math.random() * 3); src.stop(t + 1.5);
    this.swell([50, 57, 62, 69], 1.6, 0.5);
  }
  hit(fatal: boolean) {
    this.thud(1);
    if (fatal) { this.tone(110, 0.25, 1.6, 'sawtooth', 0.4); this.tone(55, 0.3, 1.8, 'sine', 0.6); }
    else this.burst(2400, 0.8, 0.12, 0.3);
  }
  pearl(i: number) { this.chime(i % 12); }
  /** the combo climbing: one soft, low bell (no beep: it repeats while you ride a current) */
  combo(level: number) { this.bell(55 + Math.min(4, level) * 2, 0, 0.035); }
  tideWarn() {
    this.tone(98, 0.14, 1.4, 'sawtooth', 1.0, this.musicBus); this.tone(147, 0.09, 1.4, 'sawtooth', 1.0, this.musicBus);
    setTimeout(() => { this.tone(110, 0.14, 1.8, 'sawtooth', 1.0, this.musicBus); this.tone(165, 0.09, 1.8, 'sawtooth', 1.0, this.musicBus); }, 700);
  }
  tideBreak() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(200, t); f.frequency.linearRampToValueAtTime(3000, t + 2.2); f.frequency.linearRampToValueAtTime(400, t + 5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.6, t + 2.0); g.gain.exponentialRampToValueAtTime(0.001, t + 5.5);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random() * 2); src.stop(t + 6);
    this.tone(40, 0.5, 3.5, 'sine', 0.7, this.master);
    this.swell([38, 45, 50, 57, 62], 4.5, 1.0, 0.8);
  }
  tideSurvived() { this.bank(5000); this.swell([50, 57, 62, 66, 69], 3.5, 0.9); }
  gameOver() { [74, 69, 62].forEach((m, i) => this.bell(m, i * 0.35, 0.05)); this.tone(55, 0.2, 2.5, 'sine', 0.8, this.musicBus); }
  /** a menu button: a soft, low tap */
  click() { this.tone(330, 0.04, 0.06, 'sine', 0.8, this.master); }
  /** a gull's cry as it dives at you: close, loud and harsh */
  gull() { const t = this.ctx?.currentTime ?? 0; this.gullCall(t, 820, 0.36, 0.09, (Math.random() - 0.5) * 0.4, 0); this.gullCall(t + 0.38, 760, 0.22, 0.07, 0, 0); }
  /** a cannon fires: a low boom with a crack on top */
  cannon() { this.burst(140, 0.8, 0.32, 0.9, 'lowpass'); this.burst(900, 0.6, 0.12, 0.25, 'bandpass'); this.tone(55, 0.2, 0.6, 'sine', 0.6, this.sfxBus); }
  /** a chest flies open: a bright little arpeggio */
  treasure() { [67, 71, 74, 79].forEach((m, i) => this.bell(m, i * 0.07, 0.04)); }
  /** dun-dun: a shark is coming */
  shark() { this.tone(82, 0.22, 0.42, 'sawtooth', 0.98, this.musicBus); this.burst(160, 1.2, 0.08, 0.3, 'lowpass'); setTimeout(() => this.tone(87, 0.24, 0.5, 'sawtooth', 0.98, this.musicBus), 380); }
  /** wingbeats: a few gulls taking off */
  flutter(n = 7) {
    const ctx = this.ctx; if (!ctx) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.065 + Math.random() * 0.03;
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800 + Math.random() * 600; f.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 * (1 - i / (n + 2)), t + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.06);
      src.connect(f).connect(g).connect(this.airBus ?? this.sfxBus); src.start(t, Math.random() * 3); src.stop(t + 0.08);
    }
  }
  /** two falling chimes: breath is running low */
  airLow() { this.bell(64, 0, 0.05); this.bell(59, 0.25, 0.05); }
  /** a gulp of bubbles: air refilled at a gate */
  airRefill() { this.burst(2200, 0.7, 0.07, 0.3, 'bandpass', this.airBus); this.tone(520, 0.03, 0.18, 'sine', 1.6, this.airBus); }
  waveBuild() { this.burst(600, 0.5, 0.25, 1.6, 'lowpass'); this.tone(70, 0.18, 1.8, 'sine', 1.3, this.musicBus); }

  /** per frame: schedule the music bed */
  music(_dt: number) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const k = this.intensity;
    if (t > this.nextChord) {
      const P: number[][] = [[50, 57, 62, 64, 66], [47, 54, 59, 62, 64], [43, 50, 55, 59, 61], [45, 52, 57, 59, 64]];
      const dark: number[][] = [[50, 53, 57, 60, 65], [48, 51, 55, 60, 63], [46, 53, 58, 60, 65], [45, 52, 55, 60, 64]];
      const ch = (k > 0.6 ? dark : P)[this.chordIdx % 4];
      const dur = 6.5 - 2.5 * k;
      this.swell(ch, dur, 0.35 + 0.55 * k);
      this.chordIdx++;
      this.nextChord = t + dur * 0.62;
    }
    // (no pulse arpeggio: a bell pinging every half second read as high-pitched beeping)
    void this.droneGain;
  }
}
