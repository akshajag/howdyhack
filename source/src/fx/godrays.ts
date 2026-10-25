import * as THREE from 'three';
import { env, ENV_GLSL } from '../core/env';
import { mulberry } from '../systems/fish';

export const rayParams = { uRayStrength: { value: 0.32 }, uRayLength: { value: 38 } };

/**
 * Lightweight volumetric sun shafts: axis-billboarded additive quads hanging from the surface
 * along the refracted sun direction. Recycled around the camera; no extra render passes.
 */
export class GodRays {
  readonly mesh: THREE.InstancedMesh;
  private bases: THREE.Vector2[] = [];
  private rand = mulberry(77);
  private radius = 55;

  constructor(count: number) {
    const geo = new THREE.PlaneGeometry(1, 1, 1, 8);
    geo.translate(0, -0.5, 0); // top edge at the surface
    const seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      seed[i * 2] = this.rand();
      seed[i * 2 + 1] = 0.6 + this.rand() * 2.6;
      this.bases.push(new THREE.Vector2((this.rand() * 2 - 1) * this.radius, (this.rand() * 2 - 1) * this.radius));
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { ...env, ...rayParams },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDirWater;
        uniform float uRayLength;
        uniform float uWaterLevel;
        attribute vec2 aSeed;
        varying vec2 vUv;
        varying vec3 vW;
        varying float vSeed;
        void main() {
          vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          base.y = uWaterLevel;
          vec3 axis = -uSunDirWater;
          float len = uRayLength * (0.7 + 0.6 * fract(aSeed.x * 7.13));
          vec3 c = base + axis * (-position.y) * len;
          vec3 toCam = normalize(cameraPosition - c);
          vec3 side = normalize(cross(axis, toCam));
          float w = aSeed.y * (1.0 + 0.6 * (-position.y));          // shafts widen with depth
          c += side * position.x * w;
          vW = c;
          vUv = vec2(position.x + 0.5, -position.y);
          vSeed = aSeed.x;
          gl_Position = projectionMatrix * viewMatrix * vec4(c, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        uniform float uRayStrength;
        varying vec2 vUv;
        varying vec3 vW;
        varying float vSeed;
        void main() {
          float edge = sin(3.14159 * vUv.x); edge *= edge;
          float fall = (1.0 - vUv.y) * smoothstep(0.0, 0.08, vUv.y);
          float flick = 0.55 + 0.45 * sin(uTime * (0.35 + vSeed * 0.5) + vSeed * 40.0);
          flick *= 0.6 + 0.4 * t12_noise(vec2(vUv.x * 3.0 + vSeed * 9.0, uTime * 0.25));
          float d = length(vW - cameraPosition);
          float near = smoothstep(1.5, 7.0, d);
          float fog = exp(-uFogDensity * d * 1.1);
          float under = smoothstep(0.3, -0.6, cameraPosition.y - uWaterLevel);
          // stronger when looking toward the sun, like real forward scattering
          float look = 0.45 + 0.9 * pow(max(dot(normalize(vW - cameraPosition), uSunDirWater), 0.0), 3.0);
          float a = edge * fall * flick * near * fog * look * under * uRayStrength;
          vec3 col = mix(uFogShallow, vec3(1.0, 0.97, 0.88), 0.55) * uSunColor;
          gl_FragColor = vec4(col * a, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  setCount(n: number) { this.mesh.count = Math.min(n, this.bases.length); }

  update(camera: THREE.Camera) {
    const cx = camera.position.x, cz = camera.position.z;
    const m = new THREE.Matrix4();
    // shafts hang toward -sun, so bias their surface anchors sunward to fill the view below
    const off = env.uSunDirWater.value;
    const ox = off.x * 18, oz = off.z * 18;
    for (let i = 0; i < this.bases.length; i++) {
      const b = this.bases[i];
      let x = b.x, z = b.y;
      // wrap the anchor so it stays within the box around the camera (stable, no popping)
      const R = this.radius * 2;
      x = ((((x - cx - ox) % R) + R * 1.5) % R) - this.radius + cx + ox;
      z = ((((z - cz - oz) % R) + R * 1.5) % R) - this.radius + cz + oz;
      m.makeTranslation(x, 0, z);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
