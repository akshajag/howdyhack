/**
 * Procedural sound for The 12th Tide (WebAudio, no samples: every sound is synthesised here, so there is nothing to
 * license). Underwater ambience (filtered-noise rumble + hiss, bubbles, distant whale song), surf above water,
 * soft ring chimes, and a musical swell for environmental reveals. Starts on the first user gesture.
 */
export class OceanAudio {
  protected ctx: AudioContext | null = null;
  protected master!: GainNode;
  protected underBus!: GainNode;
  protected airBus!: GainNode;
  protected musicBus!: GainNode;
  protected sfxBus!: GainNode;
  private muffle!: BiquadFilterNode;
  protected reverb!: ConvolverNode;
  private rumbleF!: BiquadFilterNode;
  protected noise!: AudioBuffer;
  private nextBubble = 0;
  private nextWhale = 25;
  protected muted = false;
  protected under = 1;
  enabled = true;

  /** Call once; audio starts on the first key/pointer gesture (browser autoplay policy). */
  armOnGesture() {
    const start = () => { this.start(); removeEventListener('keydown', start); removeEventListener('pointerdown', start); };
    addEventListener('keydown', start); addEventListener('pointerdown', start);
    addEventListener('keydown', (e) => { if (e.code === 'KeyM') this.toggleMute(); });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.2);
  }

  protected start() {
    if (this.ctx || !this.enabled) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, ctx.currentTime, 1.5);
    this.master.connect(comp).connect(ctx.destination);
    // everything heard "through water" passes a low-pass that opens above the surface
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 1800;
    this.muffle.connect(this.master);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.impulse(4.2, 2.6);
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.muffle);
    this.underBus = ctx.createGain(); this.underBus.connect(this.muffle);
    this.airBus = ctx.createGain(); this.airBus.gain.value = 0; this.airBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.9; this.musicBus.connect(this.muffle); this.musicBus.connect(this.reverb);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.8; this.sfxBus.connect(this.muffle); this.sfxBus.connect(this.reverb);
    this.noise = this.pinkNoise(6);

    // underwater bed: deep rumble with a slow breathing filter + a faint hiss
    const rumble = this.loop(); this.rumbleF = ctx.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 340; this.rumbleF.Q.value = 0.6;
    const rg = ctx.createGain(); rg.gain.value = 0.42;
    rumble.connect(this.rumbleF).connect(rg).connect(this.underBus);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06; const lg = ctx.createGain(); lg.gain.value = 120;
    lfo.connect(lg).connect(this.rumbleF.frequency); lfo.start();
    const hiss = this.loop(); const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 1100; hf.Q.value = 0.8;
    const hg = ctx.createGain(); hg.gain.value = 0.035;
    hiss.connect(hf).connect(hg).connect(this.underBus);
    // above water: surf swells + air
    const surf = this.loop(); const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 700; sf.Q.value = 0.4;
    const sg = ctx.createGain(); sg.gain.value = 0.1;
    const swell = ctx.createOscillator(); swell.frequency.value = 1 / 7.5; const swg = ctx.createGain(); swg.gain.value = 0.06;
    swell.connect(swg).connect(sg.gain); swell.start();
    surf.connect(sf).connect(sg).connect(this.airBus);
    this.setUnder(this.under, true);
  }

  /** u: 1 fully underwater .. 0 above water. */
  setUnder(u: number, now = false) {
    this.under = u;
    if (!this.ctx) return;
    const t = this.ctx.currentTime, tc = now ? 0.01 : 0.25;
    this.underBus.gain.setTargetAtTime(0.2 + 0.8 * u, t, tc);
    this.airBus.gain.setTargetAtTime(1 - u, t, tc);
    this.muffle.frequency.setTargetAtTime(1800 + (1 - u) * 14000, t, tc);
  }

  /** Per frame: bubbles follow the diver's effort; occasional distant whale song in open water. */
  update(dt: number, effort: number, depth: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (this.under > 0.5 && t > this.nextBubble) {
      this.bubble(0.4 + 0.6 * Math.random());
      this.nextBubble = t + (effort > 0.5 ? 0.25 + Math.random() * 0.6 : 1.5 + Math.random() * 3.5);
    }
    if (this.under > 0.5 && depth > 8 && t > this.nextWhale) {
      this.whale();
      this.nextWhale = t + 45 + Math.random() * 40;
    }
    this.rumbleF.Q.value = 0.6 + Math.min(depth, 40) * 0.01;
    void dt;
  }

  bubble(size: number) {
    const ctx = this.ctx!; const t = ctx.currentTime;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const f0 = 380 + Math.random() * 700 / size;
      const st = t + i * (0.03 + Math.random() * 0.06);
      o.frequency.setValueAtTime(f0, st); o.frequency.exponentialRampToValueAtTime(f0 * 2.1, st + 0.07);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.045 * size, st + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0005, st + 0.11);
      o.connect(g).connect(this.sfxBus); o.start(st); o.stop(st + 0.13);
    }
  }

  private whale() {
    const ctx = this.ctx!; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    const base = 110 + Math.random() * 60;
    o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 1.6, t + 1.6);
    o.frequency.linearRampToValueAtTime(base * 0.8, t + 4.2);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = 3;
    vib.connect(vg).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 1.2); g.gain.linearRampToValueAtTime(0, t + 4.5);
    o.connect(f).connect(g); g.connect(this.reverb); g.connect(this.underBus);
    o.start(t); vib.start(t); o.stop(t + 4.6); vib.stop(t + 4.6);
  }

  /** Near miss: a quick filtered-noise whoosh (brighter when closer). */
  whoosh(k = 0.5) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(1800 + 2200 * k, t + 0.18); f.frequency.exponentialRampToValueAtTime(400, t + 0.45);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18 + 0.2 * k, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
    src.connect(f).connect(g).connect(this.sfxBus); src.start(t, Math.random() * 4); src.stop(t + 0.55);
  }

  /** Crash: low thump + gritty noise. */
  thud(k = 1) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.45 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(this.sfxBus); o.start(t); o.stop(t + 0.42);
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.25 * k, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(f).connect(g2).connect(this.sfxBus); src.start(t, Math.random() * 4); src.stop(t + 0.3);
  }

  /** Banked: rising arpeggio, longer for bigger banks. */
  bank(size: number) {
    const n = 3 + Math.min(5, Math.floor(Math.log10(Math.max(10, size))));
    for (let i = 0; i < n; i++) setTimeout(() => this.chime(i * 2), i * 70);
  }

  /** Belly flop: a flat slap. */
  slap() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random() * 4); src.stop(t + 0.2);
  }

  /** Soft glass chime for collecting a ring; rises through a pentatonic scale as the run progresses. */
  chime(index: number, final = false) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
    const f = 587.33 * Math.pow(2, scale[index % scale.length] / 12);   // from D5
    for (const [mult, amp, dec] of [[1, 0.09, 1.8], [2.01, 0.03, 0.9], [3.0, 0.015, 0.5]] as const) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mult;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0003, t + dec * (final ? 2.2 : 1));
      o.connect(g).connect(this.sfxBus); o.start(t); o.stop(t + dec * (final ? 2.2 : 1) + 0.05);
    }
    if (final) this.swell([62, 66, 69, 74, 78], 9, 0.8);
  }

  /** Reveal music: a slow pad progression (D add9 -> Bm11 -> Gmaj7#11 -> A sus) with a shimmer arpeggio. */
  revealSwell() {
    const P: number[][] = [[50, 57, 62, 64, 66], [47, 54, 59, 62, 64], [43, 50, 55, 59, 61], [45, 52, 57, 59, 64]];
    P.forEach((ch, i) => this.swell(ch, 6.0, 0.65, i * 3.6));
    const ctx = this.ctx; if (!ctx) return;
    const arp = [74, 78, 81, 86, 83, 81, 78, 76, 79, 83, 86, 88];
    arp.forEach((m, i) => this.bell(m, 1.2 + i * 0.9, 0.022));
  }

  protected bell(midi: number, delay: number, amp: number) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0002, t + 2.6);
    o.connect(g).connect(this.musicBus); o.start(t); o.stop(t + 2.7);
  }

  protected swell(chord: number[], dur: number, amp: number, delay = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.5;
    f.frequency.setValueAtTime(380, t); f.frequency.linearRampToValueAtTime(2200, t + dur * 0.55); f.frequency.linearRampToValueAtTime(700, t + dur * 1.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06 * amp, t + dur * 0.45); g.gain.linearRampToValueAtTime(0.0, t + dur * 1.25);
    f.connect(g).connect(this.musicBus);
    for (const m of chord) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = 440 * Math.pow(2, (m - 69) / 12); o.detune.value = det;
        const og = ctx.createGain(); og.gain.value = 0.22;
        o.connect(og).connect(f); o.start(t); o.stop(t + dur * 1.3);
      }
    }
  }

  private loop() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    src.start(0, Math.random() * 5);
    return src;
  }

  private pinkNoise(seconds: number) {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {                              // Paul Kellet's pink filter
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    // crossfade the loop seam
    const fade = Math.floor(ctx.sampleRate * 0.25);
    for (let i = 0; i < fade; i++) { const k = i / fade; d[n - fade + i] = d[n - fade + i] * (1 - k) + d[i] * k; }
    return buf;
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }
}
