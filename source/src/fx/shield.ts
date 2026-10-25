import * as THREE from 'three';
import type { Runner } from '../game/runner';

/**
 * The shield made visible: a faint soap-bubble around the runner while the shield is up (bright at the rim, a slow
 * iridescent swirl, almost clear in the middle so it never hides the character). It pops when a hit uses the shield
 * and re-forms when the 12th Tide restores it.
 */
export class ShieldBubble {
  readonly mesh: THREE.Mesh;
  private u = { uTime: { value: 0 }, uAlpha: { value: 0 }, uPop: { value: 0 } };
  private shown = 0;          // 0..1 grow-in
  private popT = -1;          // >= 0 while popping
  private want = true;

  constructor() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: this.u,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uPop;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          vec3 p = position;
          p += normal * (0.025 * sin(uTime * 3.0 + position.y * 6.0) + 0.02 * sin(uTime * 2.3 + position.x * 7.0));   // wobble
          vec4 w = modelMatrix * vec4(p, 1.0);
          vP = position;
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uAlpha; uniform float uPop;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float rim = pow(f, 2.6);
          // iridescent swirl: hue drifts with position and time
          float h = vP.y * 1.3 + atan(vP.z, vP.x) * 0.5 + uTime * 0.35;
          vec3 irid = 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
          vec3 col = mix(vec3(0.55, 0.98, 1.0), irid, 0.35) * (rim * 1.6 + 0.06);
          // a soft travelling glint
          float glint = smoothstep(0.92, 1.0, sin(vP.y * 3.0 - uTime * 2.2) * 0.5 + 0.5) * rim;
          col += vec3(1.0, 0.95, 0.8) * glint * 0.8;
          gl_FragColor = vec4(col * uAlpha * (1.0 + uPop * 2.0), 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
  }

  /** the shield was used up by a hit */
  pop() { if (this.shown > 0.05) this.popT = 0; this.want = false; }
  /** the shield is back (new run, or a survived 12th Tide). `instant` skips the grow-in. */
  restore(instant = false) { this.want = true; this.popT = -1; if (instant) this.shown = 1; }

  update(dt: number, t: number, r: Runner, visible: boolean) {
    this.u.uTime.value = t;
    const on = this.want && r.shield > 0 && r.alive && visible;
    let scale = 1, alpha = 1;
    if (this.popT >= 0) {
      this.popT += dt;
      const k = this.popT / 0.28;
      scale = 1 + 0.6 * k; alpha = Math.max(0, 1 - k); this.u.uPop.value = Math.max(0, 1 - k);
      if (k >= 1) { this.popT = -1; this.shown = 0; }
    } else {
      this.shown += ((on ? 1 : 0) - this.shown) * (1 - Math.exp(-dt * 6));
      scale = 0.6 + 0.4 * this.shown; alpha = this.shown; this.u.uPop.value = 0;
    }
    this.mesh.visible = alpha > 0.01;
    const swim = r.mode === 'swim';
    const cy = swim ? r.pos.y : r.pos.y + (r.sliding > 0 ? 0.55 : 0.95);
    this.mesh.position.set(r.pos.x, cy, r.pos.z);
    // tall ellipsoid around a standing runner, long and low around a swimmer / slider
    const breathe = 1 + 0.025 * Math.sin(t * 2.4);
    if (swim) this.mesh.scale.set(0.85, 0.75, 1.25).multiplyScalar(scale * breathe);
    else if (r.sliding > 0) this.mesh.scale.set(0.9, 0.7, 1.0).multiplyScalar(scale * breathe);
    else this.mesh.scale.set(0.82, 1.08, 0.82).multiplyScalar(scale * breathe);
    this.u.uAlpha.value = alpha * 0.85;
  }
}
