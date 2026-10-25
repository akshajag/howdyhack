import type { InputState } from './input';

/**
 * Webcam controller, two ways to play (MediaPipe Tasks Vision). Mirrored preview; every distance is measured in a unit
 * taken from your own body at calibration (x corrected for the frame's aspect), so it feels the same near or far from
 * the camera and the same across and up / down.
 *
 * BODY (default, MediaPipe Pose Landmarker): you are the runner. Stand back (or sit) with your head and shoulders in
 * the picture; the unit is your shoulder width.
 *  - on land: lean or step left / right to pick a lane (hysteresis); hop (or bob up from a chair) to jump; duck to
 *    slide; both hands up over your head for a surge. Raising your arms lifts your shoulders, so jump / slide are held
 *    off while a wrist is above the shoulders
 *  - under water: your body is where you swim (lean across the canyon, rise up / crouch down)
 *  Why: whole-body motion is the most readable control for a runner (the Kinect-era runners), a hop and a duck map
 *  one-to-one onto jump and slide, the torso is a big, stable target for the tracker (no fingers to lose), and it still
 *  works seated, where lean and duck are small and natural.
 *
 * HEAD (the same Pose Landmarker; the nose is the tracked point, the unit your head's width): shadowboxing.
 *  - on land: a quick slip (or turn) of the head left / right steps one lane that way. Lanes are relative, like the
 *    keyboard's taps: bringing your head back to the middle does nothing. A slip counts only if it starts near rest and
 *    ends well out to that side, and that side re-arms only once your head is back near rest, so the return (even a
 *    fast one that overshoots a little) never fires the other way. Twice left from the left lane goes up the wave
 *  - bob up = jump, duck (or nod down) = slide, the same flick rules as the body; both hands up = surge
 *  - under water: your head is where you swim, measured from where it rested as you went under (the rest follows you
 *    on land, so your posture then is the middle of the canyon) and never re-centred while you're under
 *  Why: quick, small, and seated at a laptop; position zones would make you hold your head off-centre for a whole lane,
 *  relative slips don't (a lane is a punch, not a pose).
 *
 * HAND (MediaPipe Hand Landmarker): the unit is the palm length (wrist to the middle knuckle).
 *  - on land: left / centre / right zones pick the lane (hysteresis). Jump / slide: a quick flick up / down (mostly
 *    vertical), or a slow raise / drop well away from rest. Rest is a slow baseline that follows an arm that sinks
 *    or rises over a run. After a jump the slide is locked out for a moment (the hand coming back down mustn't slam you
 *    out of the air), and the other way round; neither fires just after a lane change or after the hand comes back
 *  - under water: the hand is where you swim to (position control: across the canyon and up / down)
 *  - closed fist (edge, debounced) = surge
 *
 * Inference runs in a Web Worker on transferred ImageBitmaps (new frames only, capped at ~30 Hz); falls back to the
 * main thread if workers / OffscreenCanvas are unavailable. Losing you keeps the lane / course; a long loss pauses.
 * Tuned from mid-air input guidance (Meta hand-gesture design, Ultraleap XR guidelines, the One Euro filter paper,
 * elbow-anchored interaction).
 */
export const HAND_SETTINGS = {
  sensitivity: 1.0,     // higher = less movement needed (divides every distance below, both modes)
  laneEnter: 0.55,      // palm lengths from rest to pick a side lane...
  laneLeave: 0.3,       // ...and back inside this to return to the middle
  swimX: 1.2,           // palm lengths for the full width of the canyon under water
  swimY: 1.0,           // palm lengths for seabed to surface
  flickDist: 0.5,       // palm lengths up / down within flickWindow = jump / slide
  flickWindow: 0.2,     // s
  holdDist: 0.85,       // or just raise / lower the hand this far from rest
  flickEnd: 0.25,       // a flick only counts if it ends this far past rest (the hand returning to rest isn't one)
  rearm: 0.3,           // back within this of rest, and still, re-arms the gesture
  refractory: 0.4,      // s after a jump before a slide can fire, and the other way round
  laneQuiet: 0.15,      // s after a lane change with no jump / slide
  fistIn: 1.1, fistOut: 1.35,   // fingertip reach / palm length: a fist below fistIn (3 frames running), open above fistOut
  lossGrace: 0.35,      // s without a hand before tracking counts as lost (a dropped frame or two is ignored)
  reacquireQuiet: 0.3,  // s of no gestures after the hand comes back (the filters restart)
  lostPauseAfter: 1.5,  // s lost before the run pauses
  resumeAfter: 0.6,     // s of steady tracking before a paused run goes again
};
/** head mode, in head widths (the outer eye corners' span x 1.6); vertical gestures and timings as BODY_SETTINGS */
export const HEAD_SETTINGS = {
  laneEnter: 0.4,       // a slip must end this far to the side of rest...
  slipDist: 0.35,       // ...having moved this far that way within flickWindow
  slipRatio: 1.3,       // and mostly sideways
  rearmX: 0.2,          // a side re-arms once the head is back within this of rest
  swimX: 1.0,           // across the whole canyon under water
  swimY: 0.6,           // seabed to surface
  flickDist: 0.3,       // a bob / duck: this far up / down within flickWindow
  flickEnd: 0.25,
  holdDist: 0.6,
  rearm: 0.15,
  laneQuiet: 0.2,       // s after a slip with no jump / slide (a slip dips the head)
};
/** body mode, in shoulder widths (timings and loss handling are shared with HAND_SETTINGS) */
export const BODY_SETTINGS = {
  laneEnter: 0.42,      // lean / step this far from rest to pick a side lane...
  laneLeave: 0.24,      // ...and back inside this to return to the middle
  swimX: 0.8,           // across the whole canyon under water
  swimY: 0.45,          // seabed to surface (crouch down / rise up)
  flickDist: 0.2,       // a hop or a duck: this far up / down within flickWindow
  flickWindow: 0.25,
  holdDist: 0.38,       // or rise / duck this far and hold
  flickEnd: 0.12,
  rearm: 0.12,
  refractory: 0.45,     // s: landing from a hop must not read as a duck
  laneQuiet: 0.12,
  handsUp: 0.25,        // both wrists this far above the nose = surge
};

export type HandStatus = 'off' | 'loading' | 'calibrating' | 'tracking' | 'lost' | 'error';
export type ControlMode = 'body' | 'hand' | 'head';
type P = [number, number, number, number?];

const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
const MODELS: Record<ControlMode, string> = {
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  body: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  head: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};
/** landmarker options per mode (two hands / bodies, so another person in view never takes over: see pick()) */
const OPTIONS: Record<ControlMode, string> = {
  hand: `numHands: 2, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.5`,
  body: `numPoses: 2, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5`,
  head: `numPoses: 2, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5`,
};
/**
 * Tracking worker source (MediaPipe tasks-vision 1.0.1, Apache-2.0, loaded from the CDN at runtime, not bundled).
 * The page posts ImageBitmaps; the worker answers with landmark sets (with visibility for bodies) and handedness.
 */
const workerSrc = (mode: ControlMode) => `
importScripts('${MP_BASE}/vision_bundle.js');
let landmarker = null, busy = false;
self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    try {
      const files = await Vision.FilesetResolver.forVisionTasks('${MP_BASE}/wasm');
      const make = (delegate) => Vision.${mode === 'hand' ? 'HandLandmarker' : 'PoseLandmarker'}.createFromOptions(files, {
        baseOptions: { modelAssetPath: '${MODELS[mode]}', delegate }, runningMode: 'VIDEO', ${OPTIONS[mode]} });
      try { landmarker = await make('GPU'); } catch (e) { landmarker = await make('CPU'); }
      postMessage({ type: 'ready' });
    } catch (e) { postMessage({ type: 'error', error: String((e && e.message) || e) }); }
  } else if (msg.type === 'frame') {
    const bmp = msg.bitmap;
    if (!landmarker || busy) { bmp.close(); postMessage({ type: 'drop', t: msg.t }); return; }
    busy = true;
    try {
      const res = landmarker.detectForVideo(bmp, msg.t);
      const hands = (res.landmarks || []).map((lm) => lm.map((p) => [p.x, p.y, p.z, p.visibility === undefined ? 1 : p.visibility]));
      const names = (res.handedness || []).map((h) => (h && h[0] ? h[0].categoryName : ''));
      postMessage({ type: 'result', t: msg.t, hands, names });
    } catch (e) { postMessage({ type: 'result', t: msg.t, hands: [], names: [], error: String(e) }); }
    finally { bmp.close(); busy = false; }
  }
};`;

/** pose landmark indices (MediaPipe BlazePose) */
const NOSE = 0, LEYE_OUT = 3, REYE_OUT = 6, LSH = 11, RSH = 12, LEL = 13, REL = 14, LWR = 15, RWR = 16, LHIP = 23, RHIP = 24;
const BONES: [number, number][] = [[LSH, RSH], [LSH, LEL], [LEL, LWR], [RSH, REL], [REL, RWR], [LSH, LHIP], [RSH, RHIP], [LHIP, RHIP]];

type Landmarker = { detectForVideo: (v: HTMLVideoElement, t: number) => { landmarks: { x: number; y: number; z: number; visibility?: number }[][]; handedness?: { score: number; categoryName: string }[][] } };

export class HandTracker {
  status: HandStatus = 'off';
  /** body (default), hand or head; change with setMode (the camera restarts with the other model) */
  mode: ControlMode = 'body';
  error = '';
  /** which hand MediaPipe thinks it sees ('Left' / 'Right' in image space) */
  hand = '';
  /** the tracked point in image space (0..1): palm centre, or between the shoulders and the nose */
  raw: { x: number; y: number } | null = null;
  neutral: { x: number; y: number } | null = null;
  private calib: { x: number; y: number }[] = [];
  private calibT = 0;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private mainThread: Landmarker | null = null;
  /** every hand / body seen this frame (the one nearest the last is followed) */
  private hands: P[][] = []; private names: string[] = [];
  private pending = false;
  private lastVideoTime = -1;
  private lastSent = 0;
  private lastSeen = -1;
  private lastT = 0;
  private sx = 0; private sy = 0;          // offset from rest, in units (+ = your right / up)
  // One Euro filters on the tracked point (aspect-corrected frame-height units): steady when still, quick when moving.
  // beta is in those units (a fast hand moves ~1-3 units / s), so it's large; the paper's tuning order: minCutoff for
  // a still hand, then beta until fast moves stop lagging
  private fx = new OneEuro(1.0, 12); private fy = new OneEuro(1.0, 12);
  private palm = 0.14;                     // the unit (palm length or shoulder width) at calibration (frame-height units)
  private calibPalm: number[] = [];
  private hist: { t: number; x: number; y: number }[] = [];   // recent offsets, per camera frame
  private base = 0;                        // slow rest height (units) the gestures are measured from
  private zone = 0;                        // -1 / 0 / 1 lane zone
  // head mode: lanes are relative slips; rest across follows you slowly, only while you're calm near it
  private baseX = 0; private leftArmed = true; private rightArmed = true; private pendLane = 0;
  private laneT = -9; private quietUntil = 0; private noJumpUntil = 0; private noSlideUntil = 0;
  private jumpArmed = true; private slideArmed = true;
  private pendJump = false; private pendSlide = false; private pendSurge = false;
  private fistCount = 0;
  private landmarks: P[] | null = null;
  /** seconds of continuous tracking since you were last lost (the game resumes once it's steady) */
  steadyFor = 0;
  /** the last gesture and when (for the HUD flash) */
  gesture: { kind: 'jump' | 'slide' | 'surge' | 'left' | 'right'; t: number } | null = null;
  /** setup advice while calibrating ('' when fine) */
  hint = '';
  private frameFresh = false;
  /** true after a long tracking loss: the game should pause */
  lostLong = false;
  lostFor = 0;
  /** the surge pose is held: a closed fist (hand) or both hands up (body) */
  fist = false;
  inferenceMs = 0;
  usingWorker = false;
  framesIn = 0; framesDone = 0;
  /** test hook: feed synthetic landmarks instead of the camera */
  simulated = false;

  /** this mode's distances */
  private get S() {
    return this.mode === 'body' ? { ...HAND_SETTINGS, ...BODY_SETTINGS } : this.mode === 'head' ? { ...HAND_SETTINGS, ...BODY_SETTINGS, ...HEAD_SETTINGS } : HAND_SETTINGS;
  }
  /** distance from rest that picks a side lane (in the units of `stick`) */
  get laneEnter() { return this.S.laneEnter; }

  /** switch between body, hand and head control. A running camera stops (start() again to load the other model) */
  setMode(m: ControlMode) {
    if (m === this.mode) return;
    const wasOn = this.status !== 'off' && this.status !== 'error';
    if (wasOn) this.stop();
    this.mode = m;
    this.recalibrate();
  }

  async start(): Promise<boolean> {
    if (this.status !== 'off' && this.status !== 'error') return true;
    this.status = 'loading'; this.error = '';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(window.isSecureContext ? 'this browser has no camera access' : 'the camera only works over https:// or on localhost');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user', frameRate: { ideal: 30 } }, audio: false });
      const v = document.createElement('video');
      v.srcObject = this.stream; v.muted = true; v.playsInline = true;
      await v.play();
      this.video = v;
      await this.initInference();
      this.status = 'calibrating';
      this.recalibrate();
      return true;
    } catch (e) {
      this.status = 'error'; this.error = (e as Error).message ?? String(e);
      this.stop(false);
      return false;
    }
  }

  private async initInference() {
    const mode = this.mode;
    const canWorker = typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
    if (canWorker) {
      try {
        // classic (importScripts) worker from a Blob: MediaPipe's wasm loader needs importScripts, which module workers lack
        const w = new Worker(URL.createObjectURL(new Blob([workerSrc(mode)], { type: 'text/javascript' })));
        await new Promise<void>((res, rej) => {
          const timer = setTimeout(() => rej(new Error('tracking worker timed out')), 45000);
          w.onmessage = (ev) => {
            const m = ev.data;
            if (m.type === 'ready') { clearTimeout(timer); res(); }
            else if (m.type === 'error') { clearTimeout(timer); rej(new Error(m.error)); }
          };
          w.onerror = (e) => { clearTimeout(timer); rej(new Error(e.message || 'worker error')); };
          w.postMessage({ type: 'init' });
        });
        w.onmessage = (ev) => this.onWorkerResult(ev.data);
        this.worker = w; this.usingWorker = true;
        return;
      } catch (e) {
        console.warn('tracking worker unavailable, falling back to the main thread:', (e as Error).message);
      }
    }
    const vision = await import(/* @vite-ignore */ `${MP_BASE}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const base = { baseOptions: { modelAssetPath: MODELS[mode], delegate: 'GPU' }, runningMode: 'VIDEO' };
    this.mainThread = mode !== 'hand'
      ? await vision.PoseLandmarker.createFromOptions(files, { ...base, numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 })
      : await vision.HandLandmarker.createFromOptions(files, { ...base, numHands: 1, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.5 });
  }

  stop(resetStatus = true) {
    this.worker?.terminate(); this.worker = null;
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
    this.video = null; this.mainThread = null; this.pending = false;
    if (resetStatus) this.status = 'off';
  }

  recalibrate() { this.neutral = null; this.calib = []; this.calibPalm = []; this.calibT = 0; this.fx.reset(); this.fy.reset(); this.hist = []; this.base = 0; this.baseX = 0; this.pendLane = 0; this.leftArmed = this.rightArmed = true; if (this.status === 'tracking' || this.status === 'lost') this.status = 'calibrating'; }

  private onWorkerResult(m: { type: string; t: number; hands: P[][]; names: string[] }) {
    if (m.type === 'drop') { this.pending = false; return; }
    if (m.type !== 'result') return;
    this.pending = false;
    this.framesDone++;
    this.inferenceMs = performance.now() - m.t;
    this.hands = m.hands ?? []; this.names = m.names ?? [];
    this.frameFresh = true;
  }

  /** the tracked point of a landmark set (image space, x not aspect-corrected) and its size unit, or null if unusable */
  private measure(lm: P[], asp: number): { x: number; y: number; size: number } | null {
    if (this.mode === 'hand') {
      if (lm.length < 21) return null;
      const idx = [0, 5, 9, 13, 17];
      return { x: idx.reduce((a, i) => a + lm[i][0], 0) / 5, y: idx.reduce((a, i) => a + lm[i][1], 0) / 5,
        size: Math.hypot((lm[9][0] - lm[0][0]) * asp, lm[9][1] - lm[0][1]) || 0.1 };
    }
    if (lm.length < 25) return null;
    if (this.mode === 'head') {
      // the nose, in head widths (the outer eye corners' span x 1.6: a slip or a turn moves the nose, a duck or nod too)
      const nose = lm[NOSE], el = lm[LEYE_OUT], er = lm[REYE_OUT];
      if ((nose[3] ?? 1) < 0.5 || (el[3] ?? 1) < 0.5 || (er[3] ?? 1) < 0.5) return null;
      return { x: nose[0], y: nose[1], size: 1.6 * Math.hypot((el[0] - er[0]) * asp, el[1] - er[1]) || 0.1 };
    }
    const ls = lm[LSH], rs = lm[RSH], nose = lm[NOSE];
    if ((ls[3] ?? 1) < 0.5 || (rs[3] ?? 1) < 0.5) return null;
    const mx = (ls[0] + rs[0]) / 2, my = (ls[1] + rs[1]) / 2;
    // across: halfway between the shoulders' middle and the nose (a lean moves the head further than the shoulders);
    // up / down: the shoulders only (a nod must not jump)
    const x = (nose[3] ?? 1) > 0.5 ? (mx + nose[0]) / 2 : mx;
    return { x, y: my, size: Math.hypot((ls[0] - rs[0]) * asp, ls[1] - rs[1]) || 0.2 };
  }

  /** of the hands / bodies in view, the one nearest the one we were following (another person doesn't take over) */
  private pick(): P[] | null {
    if (!this.hands.length) return null;
    if (this.hands.length === 1 || !this.raw) { this.hand = this.names[0] ?? ''; return this.hands[0]; }
    const at = (lm: P[]) => this.mode === 'hand' ? [lm[9][0], lm[9][1]] : this.mode === 'head' ? [lm[NOSE][0], lm[NOSE][1]] : [(lm[LSH][0] + lm[RSH][0]) / 2, (lm[LSH][1] + lm[RSH][1]) / 2];
    let best = 0, bd = Infinity;
    this.hands.forEach((lm, i) => { const [x, y] = at(lm); const d = Math.hypot(x - this.raw!.x, y - this.raw!.y); if (d < bd) { bd = d; best = i; } });
    this.hand = this.names[best] ?? '';
    return this.hands[best];
  }

  /** pump a camera frame to the worker (new frames only, ~30 Hz max) */
  private pump(now: number) {
    const v = this.video;
    if (!v || v.readyState < 2 || this.simulated) return;
    if (v.currentTime === this.lastVideoTime) return;
    if (this.worker) {
      if (this.pending || now - this.lastSent < 0.03) return;
      this.lastVideoTime = v.currentTime; this.lastSent = now; this.pending = true; this.framesIn++;
      createImageBitmap(v).then((bmp) => this.worker?.postMessage({ type: 'frame', bitmap: bmp, t: performance.now() }, [bmp])).catch(() => { this.pending = false; });
    } else if (this.mainThread) {
      this.lastVideoTime = v.currentTime; this.framesIn++;
      const t0 = performance.now();
      try {
        const res = this.mainThread.detectForVideo(v, t0);
        this.hands = (res.landmarks ?? []).map((lm) => lm.map((p) => [p.x, p.y, p.z, p.visibility ?? 1] as P));
        this.names = (res.handedness ?? []).map((h) => h?.[0]?.categoryName ?? '');
      } catch { this.hands = []; }
      this.inferenceMs = performance.now() - t0; this.framesDone++;
      this.frameFresh = true;
    }
  }

  /** test hook: inject landmarks for this frame (null = nobody in view) */
  feed(landmarks: P[] | null) { this.hands = landmarks ? [landmarks] : []; this.names = ['']; this.frameFresh = true; this.simulated = true; if (this.status === 'off') this.status = 'calibrating'; }

  /** Call once per frame. Writes into inp; returns true when the camera drives the input. `free`: on the jet ski, where
   *  you are across the picture is where you ride (and the jump / duck gestures still work) */
  update(now: number, inp: InputState, underwater: boolean, free = false): boolean {
    const dt = Math.min(0.1, Math.max(0, now - this.lastT)); this.lastT = now;
    if (this.status === 'off' || this.status === 'loading' || this.status === 'error') return false;
    this.pump(now);
    // (head mode reads the same pose as body mode: `pose` is either; `body` is the lean / step zones)
    const S = this.S, body = this.mode === 'body', head = this.mode === 'head', pose = body || head;
    const fresh = this.frameFresh; this.frameFresh = false;
    const lm = fresh ? this.pick() : null;
    const asp = this.video && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 4 / 3;
    const pt = lm ? this.measure(lm, asp) : null;
    if (fresh) this.landmarks = lm;
    if (fresh && lm && pt) {
      // back after a real gap: restart the filters and the gesture history, and hold gestures for a moment (the jump
      // from where you were to where you are must not read as a flick)
      if (this.lastSeen < 0 || now - this.lastSeen > S.lossGrace) { this.fx.reset(); this.fy.reset(); this.hist = []; this.quietUntil = now + S.reacquireQuiet; this.steadyFor = 0; }
      this.steadyFor += this.lastSeen >= 0 ? Math.min(0.1, now - this.lastSeen) : 0;
      this.lastSeen = now; this.lostFor = 0; this.lostLong = false;
      const { x: px, y: py, size } = pt;
      const cx = this.fx.filter(px * asp, now), cy = this.fy.filter(py, now);
      this.raw = { x: cx / asp, y: cy };
      if (!this.neutral) {
        // calibration: ~0.6 s held still, near the middle of the picture, not too near or far
        this.hint = head
          ? (px < 0.25 || px > 0.75 || py < 0.15 || py > 0.75 ? 'move your face to the middle of the picture'
            : size < 0.06 ? 'come a little closer to the camera' : size > 0.5 ? 'move back a little from the camera' : '')
          : body
          ? (lm[NOSE][1] < 0.02 || Math.max(lm[LSH][1], lm[RSH][1]) > 0.95 ? 'step back so your head and shoulders are in the picture'
            : px < 0.25 || px > 0.75 ? 'move to the middle of the picture'
              : size < 0.12 ? 'come a little closer to the camera' : size > 0.7 ? 'move back a little from the camera' : '')
          : (px < 0.22 || px > 0.78 || py < 0.18 || py > 0.78 ? 'move your hand toward the middle of the picture'
            : size < 0.08 ? 'come a little closer to the camera' : size > 0.32 ? 'move back a little from the camera' : '');
        if (this.hint) { this.calib = []; this.calibPalm = []; this.calibT = 0; }
        else {
          this.calib.push({ x: cx, y: cy }); this.calibPalm.push(size); this.calibT += dt;
          const mx = this.calib.reduce((a, c) => a + c.x, 0) / this.calib.length, my = this.calib.reduce((a, c) => a + c.y, 0) / this.calib.length;
          const spread = Math.max(...this.calib.map((c) => Math.hypot(c.x - mx, c.y - my)));
          if (spread > (pose ? 0.15 * size : 0.06)) { this.calib = [{ x: cx, y: cy }]; this.calibPalm = [size]; this.calibT = 0; }
          if (this.calib.length >= 10 && this.calibT >= 0.6) {
            this.neutral = { x: mx, y: my };
            this.palm = [...this.calibPalm].sort((a, b) => a - b)[this.calibPalm.length >> 1];
            this.base = 0; this.hist = []; this.zone = 0; this.baseX = 0; this.pendLane = 0; this.leftArmed = this.rightArmed = true;
          }
        }
        this.status = 'calibrating';
        inp.present = true; inp.source = head ? 'head' : 'hand';
        return true;
      }
      this.status = 'tracking'; this.hint = '';
      const U = this.palm / HAND_SETTINGS.sensitivity;
      // the camera image is not mirrored: moving to YOUR right lowers image x
      const dx = -(cx - this.neutral.x) / U, dy = -(cy - this.neutral.y) / U;
      this.sx = dx; this.sy = dy;
      this.hist.push({ t: now, x: dx, y: dy });
      while (this.hist.length > 2 && now - this.hist[0].t > S.flickWindow + 0.1) this.hist.shift();
      // body: arms over the shoulders lift the shoulders too, so no hop / duck while they're up
      const sh = pose ? Math.min(lm[LSH][1], lm[RSH][1]) : 0;
      const armUp = pose && [LWR, RWR].some((i) => (lm[i][3] ?? 1) > 0.5 && lm[i][1] < sh - 0.1 * size);
      if (!head) {
        // lane zone with hysteresis (a lane change briefly blocks jump / slide)
        const z0 = this.zone;
        if (dx > S.laneEnter) this.zone = 1; else if (dx < -S.laneEnter) this.zone = -1;
        else if ((this.zone === 1 && dx < S.laneLeave) || (this.zone === -1 && dx > -S.laneLeave)) this.zone = 0;
        if (this.zone !== z0) this.laneT = now;
      } else if (!underwater) {
        // slips: quick, mostly sideways, starting near rest (not on the far side: that's a return) and ending well out
        const H = HEAD_SETTINGS;
        const old = this.hist.find((h) => now - h.t <= S.flickWindow) ?? this.hist[0];
        const ddx = dx - old.x, ady = Math.abs(dy - old.y), rel = dx - this.baseX, rel0 = old.x - this.baseX;
        const quiet = now < this.quietUntil || now - this.laneT < 0.18 || armUp;
        for (const dir of [-1, 1]) {
          if (quiet || !(dir < 0 ? this.leftArmed : this.rightArmed)) continue;
          if (dir * ddx > H.slipDist && dir * ddx > H.slipRatio * ady && dir * rel > H.laneEnter && dir * rel0 > -H.rearmX) {
            this.pendLane = dir; this.laneT = now; this.gesture = { kind: dir < 0 ? 'left' : 'right', t: now };
            if (dir < 0) this.leftArmed = false; else this.rightArmed = false;
            break;
          }
        }
        if (rel > -H.rearmX) this.leftArmed = true;
        if (rel < H.rearmX) this.rightArmed = true;
        if (Math.abs(rel) < 0.15 && Math.abs(ddx) < 0.06) this.baseX += (dx - this.baseX) * Math.min(1, dt / 2);
      }
      // gestures, measured per camera frame: a quick flick (mostly vertical) or a slow move well away from rest
      if (!underwater) {
        const old = this.hist.find((h) => now - h.t <= S.flickWindow) ?? this.hist[0];
        const ddy = dy - old.y, ddx = Math.abs(dx - old.x), rel = dy - this.base;
        const quiet = now < this.quietUntil || now - this.laneT < S.laneQuiet || armUp;
        if (!quiet && this.jumpArmed && now > this.noJumpUntil && ((ddy > S.flickDist && ddy > 2 * ddx && rel > S.flickEnd) || rel > S.holdDist)) {
          this.pendJump = true; this.jumpArmed = false; this.noSlideUntil = now + S.refractory; this.gesture = { kind: 'jump', t: now };
        }
        if (!quiet && this.slideArmed && now > this.noSlideUntil && ((-ddy > S.flickDist && -ddy > 2 * ddx && rel < -S.flickEnd) || rel < -S.holdDist)) {
          this.pendSlide = true; this.slideArmed = false; this.noJumpUntil = now + S.refractory; this.gesture = { kind: 'slide', t: now };
        }
        const still = Math.abs(ddy) < (pose ? 0.08 : 0.2);
        if (still && rel < S.rearm) this.jumpArmed = true;
        if (still && rel > -S.rearm) this.slideArmed = true;
        // rest follows a slowly sinking or rising arm / posture, but only while calm and near it
        if (Math.abs(rel) < (pose ? 0.12 : 0.35) && Math.abs(ddy) < (pose ? 0.06 : 0.15) && !armUp) this.base += (dy - this.base) * Math.min(1, dt / 1.5);
      }
      // body: the unit follows you slowly as you drift nearer to or further from the camera
      // (head: only when facing the camera near rest, since a turned head narrows the eye span)
      if (pose && Math.abs(dy - this.base) < 0.15 && (!head || Math.abs(dx - this.baseX) < 0.15) && !armUp) this.palm += (size - this.palm) * Math.min(1, dt / 4);
      // the surge pose: a fist (hand: fingertips curled in, 3 frames running, not mid-flick, when the fingers blur), or
      // both hands up over the head (body, 3 frames running); released when the hand opens / the arms come down
      if (pose) {
        const up = [LWR, RWR].every((i) => (lm[i][3] ?? 1) > 0.5 && lm[i][1] < lm[NOSE][1] - BODY_SETTINGS.handsUp * size);
        const down = [LWR, RWR].some((i) => (lm[i][3] ?? 1) < 0.5 || lm[i][1] > sh);
        this.fistCount = up ? this.fistCount + 1 : 0;
        if (!this.fist && this.fistCount >= 3) { this.fist = true; this.pendSurge = true; this.gesture = { kind: 'surge', t: now }; }
        else if (this.fist && down) this.fist = false;
      } else {
        const tips = [8, 12, 16, 20].reduce((a, i) => a + Math.hypot((lm[i][0] - lm[0][0]) * asp, lm[i][1] - lm[0][1]), 0) / 4 / size;
        const old = this.hist[0], fast = old && now > old.t ? Math.hypot(dx - old.x, dy - old.y) / (now - old.t) > 3 : false;
        this.fistCount = tips < HAND_SETTINGS.fistIn && !fast ? this.fistCount + 1 : 0;
        if (!this.fist && this.fistCount >= 3) { this.fist = true; this.pendSurge = true; this.gesture = { kind: 'surge', t: now }; }
        else if (this.fist && tips > HAND_SETTINGS.fistOut) this.fist = false;
      }
    }
    // tracking loss: after a real gap. On foot you keep your lane, under water your course; a long loss pauses the run
    if (this.lastSeen >= 0 && now - this.lastSeen > S.lossGrace) {
      this.lostFor = now - this.lastSeen; this.steadyFor = 0;
      if (this.lostFor > S.lostPauseAfter) this.lostLong = true;
      this.fist = false; this.fistCount = 0;
      if (this.neutral) this.status = 'lost';
    }
    if (this.status !== 'tracking' && this.status !== 'lost') return false;
    inp.present = true; inp.source = head ? 'head' : 'hand';
    if (underwater) {
      // head: measured from where your head rested when you went under (on land that rest follows you as you settle;
      // under water it holds still, so the swimmer just follows your head, with no re-centring)
      const ox = head ? this.sx - this.baseX : this.sx, oy = head ? this.sy - this.base : this.sy;
      inp.aim = { x: Math.max(-1, Math.min(1, ox / S.swimX)), y: Math.max(-1, Math.min(1, oy / S.swimY)) };
      inp.steer = inp.aim.x; inp.vert = inp.aim.y;
      this.pendJump = this.pendSlide = false;
    } else {
      // (far to the left, twice a lane's lean: -2, up the wave at Shorebreak Point; anywhere else just the left lane).
      // Head: a slip is a step, like a key tap
      if (free) { const x = Math.max(-1, Math.min(1, (this.sx - (head ? this.baseX : 0)) / S.swimX)); inp.steer = x; inp.aim = { x, y: 0 }; }
      else if (head) { inp.steer = 0; if (this.pendLane) inp.laneDelta = this.pendLane; }
      else inp.steer = this.zone === -1 && this.sx < -2 * S.laneEnter ? -2 : this.zone;
      if (this.pendJump) inp.jump = true;
      if (this.pendSlide) inp.slide = true;
      inp.slideHeld = this.status === 'tracking' && this.sy - this.base < -S.holdDist * 0.6;
      this.pendJump = this.pendSlide = false;
    }
    this.pendLane = 0;
    if (this.pendSurge) { inp.surge = true; this.pendSurge = false; }
    return true;
  }

  /** your offset from rest in units (palm lengths / shoulder widths, + = your right / up), for on-screen feedback */
  get stick() { return { x: this.sx, y: this.sy }; }
  /** seconds since the last gesture registered */
  get gestureAge() { return this.gesture ? this.lastT - this.gesture.t : Infinity; }

  /** draw the mirrored preview with rest, the lane edges, the jump / slide lines and the tracked hand or body */
  drawPreview(c: HTMLCanvasElement) {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.save(); g.translate(c.width, 0); g.scale(-1, 1);
    if (this.video && this.video.readyState >= 2) g.drawImage(this.video, 0, 0, c.width, c.height);
    else { g.fillStyle = '#0a1a28'; g.fillRect(0, 0, c.width, c.height); }
    const S = this.S;
    if (this.neutral) {
      // rest, the lane zone edges and the jump / slide lines, in units (x corrected for the frame's aspect)
      const asp = this.video && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 4 / 3;
      const U = this.palm / HAND_SETTINGS.sensitivity, nx = (this.neutral.x / asp) * c.width, ny = this.neutral.y * c.height;
      const ux = (U / asp) * c.width, uy = U * c.height;
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5; g.setLineDash([4, 4]);
      for (const k of [-S.laneEnter, S.laneEnter]) { g.beginPath(); g.moveTo(nx + k * ux, 0); g.lineTo(nx + k * ux, c.height); g.stroke(); }
      g.setLineDash([]);
      g.strokeStyle = 'rgba(255,210,122,.6)';
      for (const k of [S.holdDist, -S.holdDist]) { const y = ny - (this.base + k) * uy; g.beginPath(); g.moveTo(nx - 1.4 * ux, y); g.lineTo(nx + 1.4 * ux, y); g.stroke(); }
      g.strokeStyle = 'rgba(127,247,238,.6)'; g.beginPath(); g.arc(nx, ny - this.base * uy, 5, 0, Math.PI * 2); g.stroke();
    }
    const lm = this.landmarks;
    if (lm && this.status !== 'lost') {
      g.fillStyle = 'rgba(127,247,238,.9)';
      if (this.mode !== 'hand' && lm.length >= 25) {
        // the upper body as a stick figure
        g.strokeStyle = 'rgba(127,247,238,.85)'; g.lineWidth = 3;
        for (const [a, b] of BONES) {
          if ((lm[a][3] ?? 1) < 0.4 || (lm[b][3] ?? 1) < 0.4) continue;
          g.beginPath(); g.moveTo(lm[a][0] * c.width, lm[a][1] * c.height); g.lineTo(lm[b][0] * c.width, lm[b][1] * c.height); g.stroke();
        }
        if ((lm[NOSE][3] ?? 1) > 0.4) { g.beginPath(); g.arc(lm[NOSE][0] * c.width, lm[NOSE][1] * c.height, 0.09 * Math.abs(lm[LSH][0] - lm[RSH][0]) * c.width + 4, 0, Math.PI * 2); g.stroke(); }
        for (const i of [LWR, RWR]) if ((lm[i][3] ?? 1) > 0.4) { g.beginPath(); g.arc(lm[i][0] * c.width, lm[i][1] * c.height, 4, 0, Math.PI * 2); g.fill(); }
      } else for (const p of lm) { g.beginPath(); g.arc(p[0] * c.width, p[1] * c.height, 2, 0, Math.PI * 2); g.fill(); }
    }
    if (this.raw && this.status === 'tracking') {
      g.fillStyle = this.fist ? '#ffb347' : '#7ff7ee';
      g.beginPath(); g.arc(this.raw.x * c.width, this.raw.y * c.height, 7, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    if (this.status === 'lost') { g.fillStyle = 'rgba(255,120,100,.25)'; g.fillRect(0, 0, c.width, c.height); }
  }
}

/** One Euro filter (Casiez, Roussel and Vogel, CHI 2012): a low-pass whose cutoff rises with speed, so a still hand
 *  doesn't jitter and a moving one doesn't lag. Hand-written from the paper's formulas. */
class OneEuro {
  private x: number | null = null; private dx = 0; private t = 0;
  constructor(private minCutoff: number, private beta: number, private dCutoff = 1.0) {}
  reset() { this.x = null; this.dx = 0; }
  private static alpha(cutoff: number, dt: number) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v: number, t: number) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    const d = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}
