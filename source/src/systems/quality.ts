export interface QualityLevel {
  name: string;
  renderScale: number;
  shadows: boolean;
  shadowSize: number;
  msaa: number;
  fish: number;
  rays: number;
  snow: number;
  lodDistance: number;
  cull: number;
  bloom: boolean;
  shafts: number;
}

export const LEVELS: QualityLevel[] = [
  { name: 'Low', renderScale: 0.62, shadows: false, shadowSize: 1024, msaa: 0, fish: 0.4, rays: 28, snow: 0.35, lodDistance: 24, cull: 105, bloom: true, shafts: 0.5 },
  { name: 'Medium', renderScale: 0.8, shadows: true, shadowSize: 1024, msaa: 0, fish: 0.65, rays: 48, snow: 0.6, lodDistance: 30, cull: 125, bloom: true, shafts: 0.75 },
  { name: 'High', renderScale: 1.0, shadows: true, shadowSize: 2048, msaa: 4, fish: 1.0, rays: 70, snow: 1.0, lodDistance: 38, cull: 150, bloom: true, shafts: 1 },
];

/**
 * Adaptive quality: measures frame time in 2 s windows. Drops a level when the average is
 * below ~52 FPS, climbs back after three consecutive windows comfortably above ~68 FPS.
 */
export class AdaptiveQuality {
  auto = true;
  level = 2;
  private acc = 0;
  private frames = 0;
  private goodWindows = 0;
  private cooldown = 0;
  lastAvgMs = 16.7;

  constructor(private apply: (l: QualityLevel) => void) {}

  set(level: number) {
    this.level = Math.max(0, Math.min(LEVELS.length - 1, level));
    this.apply(LEVELS[this.level]);
  }

  sample(dtMs: number) {
    if (dtMs > 250) return; // tab switch / hitch: ignore
    this.acc += dtMs;
    this.frames++;
    if (this.acc < 2000) return;
    const avg = this.acc / this.frames;
    this.lastAvgMs = avg;
    this.acc = 0;
    this.frames = 0;
    if (!this.auto) return;
    if (this.cooldown > 0) { this.cooldown--; return; }
    if (avg > 1000 / 52 && this.level > 0) {
      this.set(this.level - 1);
      this.goodWindows = 0;
      this.cooldown = 1;
    } else if (avg < 1000 / 68 && this.level < LEVELS.length - 1) {
      if (++this.goodWindows >= 3) { this.set(this.level + 1); this.goodWindows = 0; this.cooldown = 1; }
    } else {
      this.goodWindows = 0;
    }
  }
}
