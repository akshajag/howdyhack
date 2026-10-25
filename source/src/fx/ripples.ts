import * as THREE from 'three';

/**
 * Rings spreading on the water: where you land in the shallows or on the board, where you dive in or come up, where
 * a pelican hits the water. A small pool of flat rings that widen and fade.
 */
const N = 16;

export class Ripples {
  readonly group = new THREE.Group();
  private rings: { mesh: THREE.Mesh; t: number; life: number; size: number }[] = [];
  private next = 0;

  constructor() {
    const geo = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < N; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false; mesh.renderOrder = 12;
      this.group.add(mesh);
      this.rings.push({ mesh, t: 1, life: 1, size: 1 });
    }
  }

  /** a ring at (x, y, z) that grows to `size` m across over `life` s; `rings` one inside the other */
  spawn(x: number, y: number, z: number, size = 2, life = 0.9, rings = 2) {
    for (let k = 0; k < rings; k++) {
      const r = this.rings[this.next++ % N];
      r.mesh.position.set(x, y + 0.03, z);
      r.t = -k * 0.18; r.life = life; r.size = size * (1 - k * 0.3);
      r.mesh.visible = false;
    }
  }

  update(dt: number) {
    for (const r of this.rings) {
      if (r.t >= r.life) { r.mesh.visible = false; continue; }
      r.t += dt;
      if (r.t < 0) continue;
      const u = Math.min(1, r.t / r.life), s = r.size * (0.15 + 0.85 * (1 - (1 - u) * (1 - u))) / 2;
      r.mesh.visible = true;
      r.mesh.scale.set(s, 1, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - u) * (1 - u);
    }
  }
}
