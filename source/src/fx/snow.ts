import * as THREE from 'three';
import { env, ENV_GLSL } from '../core/env';
import { mulberry } from '../systems/fish';

/** Suspended particles ("marine snow") wrapped in a box that travels with the camera. */
export function createMarineSnow(count: number): THREE.Points {
  const r = mulberry(5);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = r() * 40; pos[i * 3 + 1] = r() * 40; pos[i * 3 + 2] = r() * 40;
    seed[i] = r();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...env, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSeed;
      varying float vA;
      varying vec3 vW;
      void main() {
        vec3 drift = vec3(sin(uTime * 0.11 + aSeed * 30.0) * 0.6, -0.08 - aSeed * 0.05, 0.15) * uTime;
        vec3 p = mod(position + drift - cameraPosition + 20.0, 40.0) - 20.0 + cameraPosition;
        p.y += sin(uTime * 0.7 + aSeed * 12.0) * 0.15;
        vW = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        vA = smoothstep(19.0, 8.0, d) * smoothstep(0.4, 1.5, d) * (0.4 + 0.6 * aSeed);
        gl_PointSize = (0.05 + aSeed * 0.07) * 600.0 * uPixelRatio / max(d, 0.5);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      varying float vA;
      varying vec3 vW;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r) * vA;
        float under = smoothstep(0.1, -0.4, vW.y - uWaterLevel) * smoothstep(0.4, -0.4, cameraPosition.y - uWaterLevel);
        vec3 c = mix(uFogShallow, vec3(1.0, 0.96, 0.86), 0.7) * 0.55 * (1.0 + 4.0 * t12_pools(vW));
        gl_FragColor = vec4(c * a * under, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 21;
  return pts;
}
