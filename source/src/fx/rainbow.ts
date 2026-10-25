import * as THREE from 'three';

/**
 * A rainbow arc: red outside to violet inside, soft-edged, light added to whatever is behind it, always turned to face
 * the camera. Two uses: a small faint bow in the spray when you launch off the lip, and a big one across the sky when
 * the sun breaks out after you survive the 12th Tide.
 */
export class Rainbow {
  readonly mesh: THREE.Mesh;
  private t = -1;
  private hold = 0; private fadeIn = 0; private fadeOut = 0; private peak = 0;
  /** world anchor (the arc's centre); `sky` keeps it a fixed distance ahead of the camera instead */
  private anchor = new THREE.Vector3();
  private uniforms = { uOpacity: { value: 0 } };

  constructor(private sky: boolean) {
    const geo = new THREE.RingGeometry(0.86, 1, 96, 1, 0, Math.PI);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec2 vP;
        vec3 spectrum(float u) {                 // 0 violet (inside) .. 1 red (outside)
          vec3 c = vec3(
            smoothstep(0.45, 0.8, u) + 0.35 * smoothstep(0.12, 0.0, u),
            smoothstep(0.15, 0.45, u) * smoothstep(0.98, 0.62, u),
            smoothstep(0.5, 0.15, u));
          return c;
        }
        void main() {
          float r = length(vP), u = clamp((r - 0.86) / 0.14, 0.0, 1.0);
          float edge = smoothstep(0.0, 0.18, u) * smoothstep(1.0, 0.8, u);
          float ends = smoothstep(0.0, 0.35, vP.y / r);           // fades into the mist where the arc meets the horizon
          gl_FragColor = vec4(spectrum(u) * edge * ends * uOpacity, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.mesh.renderOrder = sky ? -1 : 23;
  }

  /** show it for `hold` s at `peak` opacity (fading in and out); `at`, `radius` for the spray bow */
  show(peak: number, fadeIn: number, hold: number, fadeOut: number, at?: THREE.Vector3, radius = 3) {
    this.peak = peak; this.fadeIn = fadeIn; this.hold = hold; this.fadeOut = fadeOut; this.t = 0;
    if (at) { this.anchor.copy(at); this.mesh.scale.setScalar(radius); }
  }
  hide() { this.t = -1; this.mesh.visible = false; }

  update(dt: number, camera: THREE.Camera) {
    if (this.t < 0) return;
    this.t += dt;
    const { fadeIn, hold, fadeOut } = this, t = this.t;
    const k = t < fadeIn ? t / fadeIn : t < fadeIn + hold ? 1 : 1 - (t - fadeIn - hold) / fadeOut;
    if (k <= 0 && t > fadeIn) { this.hide(); return; }
    this.uniforms.uOpacity.value = this.peak * Math.max(0, k);
    this.mesh.visible = true;
    if (this.sky) {
      // far ahead and a little to the land side, its centre just under the horizon so a tall arc stands over the course
      const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize();
      const side = new THREE.Vector3(-f.z, 0, f.x);
      this.mesh.position.copy(camera.position).addScaledVector(f, 900).addScaledVector(side, 160).setY(-120);
      this.mesh.scale.setScalar(520);
    } else this.mesh.position.copy(this.anchor);
    this.mesh.quaternion.copy(camera.quaternion);
  }
}
