/**
 * Abstract input the game consumes. Sources (keyboard, webcam hand, test simulator) write into one InputState every
 * frame; edge-triggered actions (jump, slide, surge) are consumed by the player controller.
 */
export interface InputState {
  /** -1 left .. +1 right: continuous steering under water; on foot the hand's left / centre / right zone picks a lane */
  steer: number;
  /** on foot: one lane step left (-1) or right (+1) this frame (keyboard taps) */
  laneDelta: number;
  /** -1 down .. +1 up (underwater vertical steering) */
  vert: number;
  /** camera under water: where to swim to (-1..1 across the canyon, -1 seabed .. +1 surface); overrides steer / vert */
  aim?: { x: number; y: number };
  jump: boolean;
  slide: boolean;
  slideHeld: boolean;
  surge: boolean;
  present: boolean;
  source: 'keyboard' | 'hand' | 'head' | 'sim' | 'none';
}

export function emptyInput(): InputState { return { steer: 0, laneDelta: 0, vert: 0, jump: false, slide: false, slideHeld: false, surge: false, present: false, source: 'none' }; }

export class Keyboard {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  /** one-shot UI keys read by the game shell */
  readonly events: string[] = [];
  constructor() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code); this.events.push(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  down(code: string) { return this.keys.has(code); }
  /** apply this frame's keyboard state onto the shared input (additively for analog axes) */
  /** `free`: on the jet ski, hold A / D to steer (no lanes), Space hops, S ducks */
  apply(inp: InputState, underwater: boolean, free = false) {
    const L = this.down('KeyA') || this.down('ArrowLeft'), R = this.down('KeyD') || this.down('ArrowRight');
    const U = this.down('KeyW') || this.down('ArrowUp'), D = this.down('KeyS') || this.down('ArrowDown');
    if (free) {
      const steer = (R ? 1 : 0) - (L ? 1 : 0);
      if (steer !== 0) { inp.steer = steer; inp.present = true; inp.source = 'keyboard'; }
      if (this.pressed.has('Space') || this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) inp.jump = true;
      if (this.pressed.has('KeyS') || this.pressed.has('ArrowDown')) inp.slide = true;
      if (D) inp.slideHeld = true;
    } else if (underwater) {
      // swimming: hold to steer, free in x and y
      const steer = (R ? 1 : 0) - (L ? 1 : 0);
      if (steer !== 0) { inp.steer = steer; inp.present = true; inp.source = 'keyboard'; }
      const v = (U ? 1 : 0) - (D ? 1 : 0);
      if (v !== 0) { inp.vert = v; inp.present = true; inp.source = 'keyboard'; }
    } else {
      // on foot: each tap moves one lane
      const tapL = this.pressed.has('KeyA') || this.pressed.has('ArrowLeft'), tapR = this.pressed.has('KeyD') || this.pressed.has('ArrowRight');
      if (tapL !== tapR) { inp.laneDelta = tapL ? -1 : 1; inp.present = true; inp.source = 'keyboard'; }
      if (this.pressed.has('Space') || this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) inp.jump = true;
      if (this.pressed.has('KeyS') || this.pressed.has('ArrowDown')) inp.slide = true;
      if (D) inp.slideHeld = true;
    }
    if (this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight')) inp.surge = true;
    if (L || R || U || D || inp.jump || inp.surge) { inp.present = true; if (inp.source === 'none') inp.source = 'keyboard'; }
  }
  /** call at the end of the frame */
  endFrame() { this.pressed.clear(); this.events.length = 0; }
  takeEvent(code: string) { const i = this.events.indexOf(code); if (i >= 0) { this.events.splice(i, 1); return true; } return false; }
}

/** Scripted input for automated tests: a bot that follows a target lateral position and fires actions on cue. */
export class SimInput {
  steer = 0; vert = 0; queueJump = false; queueSlide = false; queueSurge = false; queueLane = 0;
  apply(inp: InputState) {
    inp.steer = this.steer; inp.vert = this.vert; inp.present = true; inp.source = 'sim';
    if (this.queueLane) { inp.laneDelta = this.queueLane; this.queueLane = 0; }
    if (this.queueJump) { inp.jump = true; this.queueJump = false; }
    if (this.queueSlide) { inp.slide = true; inp.slideHeld = true; this.queueSlide = false; }
    if (this.queueSurge) { inp.surge = true; this.queueSurge = false; }
  }
}
