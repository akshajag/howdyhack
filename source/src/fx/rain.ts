import * as THREE from 'three';

/**
 * Rain for the 12th Tide: streaks falling through a box that wraps round the camera (the drops stay put in the world as
 * you run through them), slanted by the wind. All on the GPU: each streak's place comes from its seed and the time.
 */
const N = 1400;
const BOX = new THREE.Vector3(26, 16, 34);

export class Rain {
  readonly mesh: THREE.LineSegments;
  private uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uWind: { value: 0 }, uBox: { value: BOX } };
  amount = 0;

  constructor() {
    const seed = new Float32Array(N * 2 * 4), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let e = 0; e < 2; e++) { seed.set(s, (i * 2 + e) * 4); end[i * 2 + e] = e; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; uniform float uAmount; uniform float uWind; uniform vec3 uBox;
        attribute vec4 aSeed; attribute float aEnd;
        varying float vA;
        void main() {
          float fall = 16.0 + 6.0 * aSeed.w;
          vec3 vel = vec3(4.0 + 7.0 * uWind, -fall, 1.5);
          vec3 p = aSeed.xyz * uBox + vel * uTime;
          p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;     // wrapped round the camera
          p -= vel * 0.045 * aEnd;                                     // the streak's tail
          vA = step(aSeed.w, uAmount) * (aEnd < 0.5 ? 0.42 : 0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() { if (vA < 0.01) discard; gl_FragColor = vec4(vec3(0.82, 0.88, 0.93), vA); }`,
    });
    this.mesh = new THREE.LineSegments(g, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 24; this.mesh.visible = false;
  }

  /** `under`: the camera is under the water (or in a cave): no rain there */
  update(dt: number, camera: THREE.Camera, wind: number, under: boolean) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCam.value.copy(camera.position);
    this.uniforms.uAmount.value += ((under ? 0 : this.amount) - this.uniforms.uAmount.value) * (1 - Math.exp(-dt * 1.5));
    this.uniforms.uWind.value = wind;
    this.mesh.visible = this.uniforms.uAmount.value > 0.01;
  }
}
