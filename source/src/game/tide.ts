import { env } from '../core/env';
import type { Chunk, TidePhase } from './types';
import { SURGE_LEVEL } from './patterns/transitions';

/**
 * Tide manager: tracks the 1..12 counter from the chunk the runner is in, raises the sea level for the rising tide and
 * floods the land during the 12th Tide surge, and exposes an intensity 0..1 the camera, audio and sky react to.
 */
export class TideManager {
  step = 1;
  phase: TidePhase = 'calm';
  /** 0..1 build-up toward the surge, 1 during it */
  intensity = 0;
  /** true while the surge chunks are active */
  surging = false;
  private levelTarget = 0;
  level = 0;
  private surgeChunks = 0;
  onSurgeStart: (() => void) | null = null;
  onSurgeEnd: (() => void) | null = null;
  onWarning: ((stepsLeft: number) => void) | null = null;
  private warned = new Set<number>();
  private landSurge = false;

  reset() { this.step = 1; this.phase = 'calm'; this.intensity = 0; this.surging = false; this.levelTarget = 0; this.level = 0; env.uWaterLevel.value = 0; this.surgeChunks = 0; this.warned.clear(); }

  /** called when the runner enters a chunk */
  enter(chunk: Chunk) {
    this.step = chunk.tideStep;
    this.phase = chunk.tide;
    if (chunk.tide === 'surge') {
      this.landSurge = chunk.mode !== 'swim' && chunk.biome !== 'surf' && chunk.biome !== 'ski';
      if (!this.surging) { this.surging = true; this.surgeChunks = 0; this.onSurgeStart?.(); }
      this.surgeChunks++;
    } else if (this.surging) {
      this.surging = false; this.onSurgeEnd?.();
    }
    if (chunk.tide === 'rising' && !this.warned.has(this.step)) { this.warned.add(this.step); this.onWarning?.(12 - this.step); }
    if (chunk.tide === 'calm' && this.step <= 2) this.warned.clear();
    // water level: calm 0, rising creeps up, land surges flood the course by 1.3 m
    this.levelTarget = this.surging ? (this.landSurge ? SURGE_LEVEL : 0.0) : this.phase === 'rising' ? 0.12 * (this.step - 8) : 0;
  }

  update(dt: number) {
    const rate = this.surging ? 2.0 : 0.25;          // the surge floods in fast so nothing it carries hangs in the air
    this.level += (this.levelTarget - this.level) * (1 - Math.exp(-dt * rate));
    env.uWaterLevel.value = this.level;
    const target = this.surging ? 1 : this.phase === 'rising' ? (this.step - 8) / 4 * 0.6 : 0;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-dt * 1.2));
  }

  /** label for the HUD counter */
  get label() { return this.surging ? 'THE 12TH TIDE' : this.phase === 'rising' ? 'RISING TIDE' : 'CALM TIDE'; }
}
