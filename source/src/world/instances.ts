import * as THREE from 'three';
import { loadGeometry, loadMesh, type Layout } from '../core/assets';

interface KitSet {
  name: string;
  family?: string;
  lod0: THREE.InstancedMesh;
  lod1: THREE.InstancedMesh | null;
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
  centers: THREE.Vector3[];
  radius: number;
}

const tmpV = new THREE.Vector3();

/**
 * Instanced kit renderer. Each kit = up to two InstancedMeshes (LOD0 near, LOD1 far).
 * Instances are re-bucketed by camera distance a few times per second, and culled past the fog.
 */
export class KitInstances {
  readonly group = new THREE.Group();
  private sets: KitSet[] = [];
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  lodDistance = 38;
  cullDistance = 150;
  aboveCull = 420;

  async build(layout: Layout, pick: (kit: string, family: string | undefined, gltf: THREE.Material | null) => { material: THREE.Material; castShadow?: boolean; receiveShadow?: boolean } | null) {
    const jobs = Object.entries(layout.instances).map(async ([kit, rows]) => {
      const info = layout.kits[kit];
      if (!info) return;
      const { geometry: g0, material: gm } = await loadMesh(info.lod0);
      const opt = pick(kit, info.family, gm);
      if (!opt) return;
      const g1 = info.lod1 ? await loadGeometry(info.lod1) : null;
      g0.computeBoundingSphere();
      const n = rows.length;
      const make = (g: THREE.BufferGeometry) => {
        const m = new THREE.InstancedMesh(g, opt.material, n);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        m.castShadow = opt.castShadow ?? true;
        m.receiveShadow = opt.receiveShadow ?? true;
        m.count = 0;
        m.frustumCulled = false;
        this.group.add(m);
        return m;
      };
      const set: KitSet = { name: kit, family: info.family, lod0: make(g0), lod1: g1 ? make(g1) : null, matrices: [], colors: [], centers: [], radius: g0.boundingSphere!.radius };
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      for (const r of rows) {
        p.set(r[0], r[1], r[2]); q.set(r[3], r[4], r[5], r[6]); s.set(r[7], r[8], r[9]);
        set.matrices.push(new THREE.Matrix4().compose(p, q, s));
        set.colors.push(new THREE.Color(r[10], r[11], r[12]));
        set.centers.push(p.clone());
      }
      this.sets.push(set);
    });
    await Promise.all(jobs);
  }

  /** Visit every instance (LOD0 geometry + world matrix) of kits accepted by `filter`. */
  forEachInstance(filter: (kit: string, family: string | undefined) => boolean, cb: (g: THREE.BufferGeometry, m: THREE.Matrix4) => void,
    opts: { preferLod1?: boolean; minScale?: number } = {}) {
    for (const set of this.sets) {
      if (!filter(set.name, set.family)) continue;
      const g = opts.preferLod1 && set.lod1 ? set.lod1.geometry : set.lod0.geometry;
      for (const m of set.matrices) {
        if (opts.minScale && m.getMaxScaleOnAxis() < opts.minScale) continue;
        cb(g, m);
      }
    }
  }

  get totalInstances() { return this.sets.reduce((a, s) => a + s.matrices.length, 0); }

  /** Re-bucket instances into LOD0 / LOD1 / culled. Cheap enough to run every few frames. */
  update(camera: THREE.Camera, force = false) {
    const cam = camera.position;
    if (!force && cam.distanceToSquared(this.lastCam) < 4) return;
    this.lastCam.copy(cam);
    const cull = cam.y > 0.5 ? this.aboveCull : this.cullDistance;
    for (const set of this.sets) {
      let n0 = 0, n1 = 0;
      const lodD = set.lod1 ? this.lodDistance * Math.max(1, set.radius / 1.5) : Infinity;
      const cullD = (set.radius < 3 ? Math.min(cull, 260) : cull) + set.radius * 2;   // small vegetation: near field only
      for (let i = 0; i < set.matrices.length; i++) {
        const d = tmpV.copy(set.centers[i]).sub(cam).length();
        if (d > cullD) continue;
        if (d < lodD || !set.lod1) {
          set.lod0.setMatrixAt(n0, set.matrices[i]); set.lod0.setColorAt(n0, set.colors[i]); n0++;
        } else {
          set.lod1.setMatrixAt(n1, set.matrices[i]); set.lod1.setColorAt(n1, set.colors[i]); n1++;
        }
      }
      set.lod0.count = n0;
      set.lod0.instanceMatrix.needsUpdate = true;
      set.lod0.instanceColor!.needsUpdate = true;
      if (set.lod1) {
        set.lod1.count = n1;
        set.lod1.instanceMatrix.needsUpdate = true;
        set.lod1.instanceColor!.needsUpdate = true;
      }
    }
  }
}
