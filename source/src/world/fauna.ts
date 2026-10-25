import * as THREE from 'three';
import { FishSchools, Mantas, type SchoolSpec } from '../systems/fish';
import { loadGeometry } from '../core/assets';
import type { ChunkManager } from '../game/chunks';

/**
 * Fish for a streamed course: schools live in a window around the runner and are leap-frogged ahead when they fall
 * behind, so the reef always feels alive without ever growing. Only shown where the water is deep enough.
 */
export class Fauna {
  readonly group = new THREE.Group();
  private schoolers: FishSchools | null = null;
  private reef: FishSchools | null = null;
  private mantas: Mantas | null = null;
  private anchors: THREE.Vector3[] = [];
  private mantaPaths: { c: THREE.Vector3 }[] = [];

  constructor(private chunks: ChunkManager) {}

  async load() {
    const ground = { sample: (x: number, z: number) => this.chunks.groundAt(x, z) } as unknown as ConstructorParameters<typeof FishSchools>[1];
    const specs: SchoolSpec[] = [];
    for (let i = 0; i < 5; i++) specs.push({ anchor: [0, -6, -60 - i * 70], radius: [10, 1.5, 14], count: 70, speed: 0.06, spread: 2.2, maxSpeed: 4.2 });
    this.schoolers = new FishSchools(await loadGeometry('models/Fish_Schooler.glb'), ground, specs, { bodyLength: 0.37, beat: 9, tints: [new THREE.Color(1, 1, 1), new THREE.Color(0.85, 0.95, 1.0)], scale: [0.85, 1.25], seed: 3 });
    const reefTints = ['#ffd23f', '#ff9d5c', '#5aa9ff', '#ff7aa8', '#b98cff', '#ffe58a'].map((h) => new THREE.Color(h));
    const rspecs: SchoolSpec[] = [];
    for (let i = 0; i < 8; i++) rspecs.push({ anchor: [(i % 2 ? 6 : -6), -7, -40 - i * 45], radius: [4, 0.8, 4], count: 10, speed: 0.09, spread: 1.7, maxSpeed: 1.8 });
    this.reef = new FishSchools(await loadGeometry('models/Fish_Reef.glb'), ground, rspecs, { bodyLength: 0.54, beat: 5, tints: reefTints, scale: [0.8, 1.3], seed: 9 });
    const mp = [{ c: [-14, -5, -120] as [number, number, number], r: 18, w: 0.05, p: 0 }, { c: [16, -7, -260] as [number, number, number], r: 22, w: -0.04, p: 2 }];
    this.mantas = new Mantas(await loadGeometry('models/Manta.glb'), mp);
    this.group.add(this.schoolers.mesh, this.reef.mesh, this.mantas.mesh);
    // expose the anchors so we can move them
    this.anchors = [...(this.schoolers as unknown as { schools: { anchor: THREE.Vector3 }[] }).schools.map((s) => s.anchor), ...(this.reef as unknown as { schools: { anchor: THREE.Vector3 }[] }).schools.map((s) => s.anchor)];
    this.mantaPaths = (this.mantas as unknown as { paths: { c: THREE.Vector3 }[] }).paths;
  }

  setActiveFraction(f: number) { this.schoolers?.setActiveFraction(f); this.reef?.setActiveFraction(Math.max(f, 0.6)); }

  update(t: number, dt: number, player: THREE.Vector3) {
    if (!this.schoolers || !this.reef || !this.mantas) return;
    // leap-frog anchors that fell behind to deep water ahead; with no deep water in reach they wait out at sea
    // (-55 m is past the swash on the beach side) so no school ever sits on dry sand
    const deepSpot = (minDepth: number, out: THREE.Vector3) => {
      for (let i = 0; i < 12; i++) {
        const z = player.z - 140 - Math.random() * 220, x = (Math.random() - 0.5) * 26;
        if (this.chunks.groundAt(x, z) < -minDepth) { out.set(x, 0, z); return true; }
      }
      out.set(-55 - Math.random() * 20, 0, player.z - 120 - Math.random() * 200);
      return false;
    };
    const tmp = new THREE.Vector3();
    for (const a of this.anchors) {
      const g0 = this.chunks.groundAt(a.x, a.z);
      if (a.z > player.z + 40 || (g0 > -3.2 && Math.abs(a.x) < 40)) { deepSpot(4, tmp); a.x = tmp.x; a.z = tmp.z; }
      const g = this.chunks.groundAt(a.x, a.z);
      a.y = Math.max(g + 2.5, -9);
    }
    for (const m of this.mantaPaths) {
      const g0 = this.chunks.groundAt(m.c.x, m.c.z);
      if (m.c.z > player.z + 60 || (g0 > -7 && Math.abs(m.c.x) < 40)) { deepSpot(8, tmp); m.c.x = tmp.x; m.c.z = tmp.z - 60; }
      const g = this.chunks.groundAt(m.c.x, m.c.z);
      (m as { y?: number }).y = g < -8 ? g + 5 : -40;
    }
    this.schoolers.update(t, dt, player);
    this.reef.update(t, dt, player);
    this.mantas.update(t);
  }
}
