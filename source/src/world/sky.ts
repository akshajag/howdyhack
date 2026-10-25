import * as THREE from 'three';
import { env, ENV_GLSL } from '../core/env';

export const skyParams = {
  uZenith: { value: new THREE.Color('#1f7ae0') },
  uHorizon: { value: new THREE.Color('#bde6f2') },
  uCloud: { value: 0.55 },
};

/** Painterly sky colour for a world direction (shared with water reflections). */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uCloud;
float t12_fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * t12_noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
vec3 t12_sky(vec3 d) {
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
  col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.2, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 8.0) * 0.18 + pow(sd, 90.0) * 0.6);
  // soft painterly cloud bands projected on a dome
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, 0.0);
    float c = t12_fbm(cp * 0.9);
    c = smoothstep(0.52, 0.78, c) * uCloud * smoothstep(0.0, 0.18, d.y);
    vec3 cc = mix(vec3(1.0, 0.97, 0.93), vec3(1.0, 0.86, 0.72), pow(sd, 3.0));
    col = mix(col, cc * 1.15, c);
  }
  return col;
}
`;

export function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1500, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { ...env, ...skyParams },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w; // sit on the far plane
      }`,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = t12_sky(d);
        float sd = dot(d, uSunDir);
        col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 18.0;   // HDR sun disc for bloom
        float cy = cameraPosition.y - uWaterLevel;
        if (cy < 0.0) {
          // seen from below: through the water column above the camera
          float Lw = -cy / max(d.y, 0.03);
          vec3 wcol = t12_waterTint(d, -cy * 0.5);
          col = mix(col * exp(-uAbsorb * Lw), wcol, 1.0 - exp(-uFogDensity * Lw));
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.onBeforeRender = (_r, _s, camera) => mesh.position.copy(camera.position);
  return mesh;
}
