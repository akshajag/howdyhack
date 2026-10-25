import type * as THREE from 'three';

export class Hud {
  private el = document.getElementById('hud')!;
  private frames = 0;
  private acc = 0;
  fps = 0;
  ms = 0;
  private worst = 0;

  tick(dtMs: number) {
    this.frames++;
    this.acc += dtMs;
    this.worst = Math.max(this.worst, dtMs);
    if (this.acc >= 500) {
      this.ms = this.acc / this.frames;
      this.fps = 1000 / this.ms;
      this.frames = 0;
      this.acc = 0;
    }
  }

  render(r: THREE.WebGLRenderer, extra: Record<string, string | number>) {
    if (this.frames !== 0) return; // refresh twice a second
    const i = r.info.render;
    const lines = [
      `${this.fps.toFixed(0).padStart(3)} fps  ${this.ms.toFixed(1)} ms  (worst ${this.worst.toFixed(0)})`,
      `draws ${i.calls}  tris ${(i.triangles / 1000).toFixed(0)}k`,
      ...Object.entries(extra).map(([k, v]) => `${k} ${v}`),
    ];
    this.worst = 0;
    this.el.textContent = lines.join('\n');
  }
}
