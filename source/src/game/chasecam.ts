import * as THREE from 'three';
import type { Runner } from './runner';

/**
 * Third-person chase camera: sits behind and above the runner, leads the look-at forward so upcoming obstacles fill
 * the frame, banks slightly with lateral speed, dips below the surface when the runner swims, and offers shake /
 * FOV kicks for impacts, near misses and the 12th Tide.
 */
export class ChaseCam {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private shakeAmt = 0;
  private fovKick = 0;
  private roll = 0;
  private under = 0;
  private takeoffY = 0;
  /** external override blend (cinematics / title attract) */
  override: { pos: THREE.Vector3; look: THREE.Vector3; w: number } | null = null;
  baseFov = 62;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  shake(a: number) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  kick(deg: number) { this.fovKick = Math.max(this.fovKick, deg); }

  snap(r: Runner) {
    this.pos.set(r.pos.x * 0.6, r.hipY + 2.6, r.pos.z + 6.5);
    this.look.set(r.pos.x, r.hipY + 0.6, r.pos.z - 8);
    this.camera.position.copy(this.pos); this.camera.lookAt(this.look);
  }

  update(dt: number, t: number, r: Runner, waterY: number, intensity = 0, ceilY = Infinity) {
    const swim = r.mode === 'swim';
    this.under += ((swim ? 1 : 0) - this.under) * (1 - Math.exp(-dt / 0.45));
    const u = this.under;
    const speedK = THREE.MathUtils.clamp((r.speed - 11) / 12, 0, 1);
    // rig geometry per mode
    const back = THREE.MathUtils.lerp(6.4 + speedK * 1.2, 6.0 + speedK * 1.0, u);
    const up = THREE.MathUtils.lerp(2.7, 1.3, u);
    const ahead = THREE.MathUtils.lerp(9, 7, u);
    const lookUp = THREE.MathUtils.lerp(0.7, 0.2, u);
    // a jump lifts the camera by only part of its height, so the big jump reads as a jump instead of a camera bob
    // (measured from the take-off height; dropping below it, e.g. into a gap, is followed fully)
    if (!r.airborne || r.mode === 'swim') this.takeoffY = r.pos.y;
    const dy = r.pos.y - this.takeoffY;
    const hip = r.airborne && r.mode !== 'swim' ? this.takeoffY + 0.95 + (dy > 0 ? dy * 0.35 : dy) : r.hipY;
    const wantPos = new THREE.Vector3(r.pos.x * 0.55 + r.lean * 0.3, hip + up, r.pos.z + back);
    const wantLook = new THREE.Vector3(r.pos.x * 0.85, hip + lookUp + (swim ? r.vy * 0.15 : Math.min(0, r.vy) * 0.05), r.pos.z - ahead);
    // keep the camera on the runner's side of the waterline, except for a short dip when crossing
    if (swim) wantPos.y = Math.min(wantPos.y, waterY - 0.55, ceilY - 0.6);        // (and under a cave roof)
    else if (r.pos.y > waterY - 2.3) wantPos.y = Math.max(wantPos.y, waterY + 0.95);
    // forward motion is immediate (the runner never waits for the camera); height and lateral are smoothed
    this.pos.z = wantPos.z;
    this.pos.x += (wantPos.x - this.pos.x) * (1 - Math.exp(-dt / 0.2));
    this.pos.y += (wantPos.y - this.pos.y) * (1 - Math.exp(-dt / (r.airborne ? 0.22 : 0.16)));
    this.look.lerp(wantLook, 1 - Math.exp(-dt / 0.12));
    this.look.z = wantLook.z;

    const cam = this.camera;
    if (this.override && this.override.w > 0) {
      cam.position.lerpVectors(this.pos, this.override.pos, this.override.w);
      const lk = this.look.clone().lerp(this.override.look, this.override.w);
      cam.lookAt(lk);
    } else {
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
    }
    // bank with lateral velocity
    const rollT = -r.lean * 0.05 - (swim ? r.lean * 0.05 : 0);
    this.roll += (rollT - this.roll) * (1 - Math.exp(-dt / 0.2));
    cam.rotateZ(this.roll);
    // shake
    if (this.shakeAmt > 0.002 || intensity > 0) {
      const a = this.shakeAmt + intensity * 0.06, tt = t * 43;
      cam.position.x += Math.sin(tt * 1.3) * a; cam.position.y += Math.sin(tt * 1.7 + 1) * a * 0.7; cam.position.z += Math.sin(tt * 1.1 + 2) * a * 0.5;
      this.shakeAmt *= Math.exp(-dt * 6);
    }
    // fov: speed + surge + kicks
    this.fovKick *= Math.exp(-dt * 3.5);
    const fovGoal = this.baseFov + 7 * speedK + (r.surgeT > 0 ? 9 : 0) + this.fovKick + intensity * 4;
    cam.fov += (fovGoal - cam.fov) * (1 - Math.exp(-dt / 0.25));
    cam.updateProjectionMatrix();
  }
}
