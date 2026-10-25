import * as THREE from 'three';
import { env, ENV_GLSL } from '../core/env';
import { SKY_GLSL, skyParams } from './sky';

export const waterParams = {
  uWaveAmp: { value: 0.28 },
  uWaterShallow: { value: new THREE.Color('#2fd4c6') },
  uWaterDeep: { value: new THREE.Color('#0a3f92') },
  uFoam: { value: 1.0 },
  /** how opaque the shallowest water is (0.26: glassy, the sand showing through; the surf and the channel raise it so
   *  the wash is the same turquoise as the wave, one water) */
  uShallowAlpha: { value: 0.26 },
  /** how fast the water goes from the shallow colour to the deep one with depth */
  uDepthRate: { value: 0.2 },
};

const WAVES_GLSL = /* glsl */ `
uniform float uWaveAmp;
// four directional waves; returns height and accumulates the analytic gradient
float t12_waves(vec2 p, float t, out vec2 grad) {
  vec4 dx = vec4(0.82, -0.35, 0.29, -0.71);
  vec4 dz = vec4(0.57, 0.94, -0.96, -0.70);
  vec4 k  = vec4(0.16, 0.23, 0.37, 0.61);
  vec4 a  = vec4(1.0, 0.55, 0.32, 0.18) * uWaveAmp;
  vec4 w  = sqrt(9.81 * k);
  vec4 ph = k * (dx * p.x + dz * p.y) - w * t;
  vec4 s = sin(ph), c = cos(ph);
  grad = vec2(dot(a * k * dx, c), dot(a * k * dz, c));
  return dot(a, s);
}
`;

/** Radial grid: dense near the camera, sparse to the horizon. Recentred on the camera each frame. */
function radialGrid(rings: number, segs: number, radius: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let r = 1; r <= rings; r++) {
    const rad = radius * Math.pow(r / rings, 2.3);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs, a1 = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function createWater(): THREE.Mesh {
  const geo = radialGrid(140, 192, 2400);
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    uniforms: { ...env, ...skyParams, ...waterParams },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWaterLevel;
      ${WAVES_GLSL}
      varying vec3 vW;
      varying vec2 vGrad;
      varying float vH;
      void main() {
        vec3 wp = position + vec3(cameraPosition.x, 0.0, cameraPosition.z);
        float fade = 1.0 - smoothstep(60.0, 260.0, length(position.xz));
        vec2 g;
        float h = t12_waves(wp.xz, uTime, g);
        wp.y = uWaterLevel + h * fade;
        vGrad = g * fade;
        vH = h / (uWaveAmp * 2.05 + 1e-3) * fade;          // -1 trough .. 1 crest
        vW = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${SKY_GLSL}
      uniform vec3 uWaterShallow;
      uniform vec3 uWaterDeep;
      uniform float uFoam;
      uniform float uShallowAlpha;
      uniform float uDepthRate;
      uniform sampler2D uHeightTex;
      uniform vec4 uHeightBounds;
      varying vec3 vW;
      varying vec2 vGrad;
      varying float vH;

      float terrainAt(vec2 xz) {
        vec2 uv = vec2((xz.x - uHeightBounds.x) / (uHeightBounds.y - uHeightBounds.x),
                       (-xz.y - uHeightBounds.z) / (uHeightBounds.w - uHeightBounds.z));
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return -60.0;
        return texture2D(uHeightTex, uv).r;
      }
      vec2 detailGrad(vec2 p) {
        float e = 0.15;
        float a = t12_noise(p), b = t12_noise(p + vec2(e, 0.0)), c = t12_noise(p + vec2(0.0, e));
        return vec2(b - a, c - a) / e;
      }

      void main() {
        vec3 toFrag = vW - cameraPosition;
        float dist = length(toFrag);
        vec3 vd = toFrag / dist;
        float lod = 1.0 - smoothstep(30.0, 220.0, dist);
        vec2 g = vGrad;
        g += (detailGrad(vW.xz * 0.9 + uTime * vec2(0.18, 0.11)) * 0.05 +
              detailGrad(vW.xz * 2.3 - uTime * vec2(0.13, 0.21)) * 0.025) * lod;
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        bool above = cameraPosition.y > vW.y;
        vec3 col; float alpha;
        if (above) {
          float depth = max(uWaterLevel - terrainAt(vW.xz), 0.0);
          float cosV = max(dot(-vd, N), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
          vec3 R = reflect(vd, N);
          R.y = abs(R.y);
          vec3 refl = t12_sky(R) * 0.9;
          float dd = 1.0 - exp(-depth * uDepthRate);
          vec3 body = mix(uWaterShallow, uWaterDeep, dd);
          body *= 0.85 + 0.25 * max(dot(N, uSunDir), 0.0);
          col = mix(body, refl, fres);
          float spec = pow(max(dot(R, uSunDir), 0.0), 480.0);
          col += uSunColor * spec * 9.0;
          // shoreline foam bands
          float n = t12_noise(vW.xz * 1.3 + uTime * 0.3);
          float shore = smoothstep(0.9, 0.0, depth + (n - 0.5) * 0.5);
          float bands = 0.5 + 0.5 * sin(depth * 9.0 - uTime * 1.6 + n * 3.0);
          float foam = shore * mix(0.55, 1.0, bands) * uFoam;
          col = mix(col, vec3(1.0, 0.99, 0.96), foam * 0.85);
          // whitecaps as the 12th Tide nears: the crests break into patches of white
          float cap = smoothstep(0.35, 0.8, vH + (t12_noise(vW.xz * 0.5 + uTime * 0.15) - 0.5) * 0.6) * uStorm;
          cap *= smoothstep(0.38, 0.72, t12_noise(vW.xz * 1.9 - uTime * vec2(0.5, 0.2))) * (0.4 + 0.6 * lod);
          col = mix(col, vec3(0.95, 0.97, 0.98), cap * 0.8);
          alpha = clamp(mix(uShallowAlpha, 0.93, dd) + fres * 0.75 + foam + cap, 0.0, 1.0);
          // horizon haze
          float aFog = 1.0 - exp(-uHazeDensity * dist);
          col = mix(col, t12_hazeTint(vd), aFog);
          alpha = mix(alpha, 1.0, aFog);
        } else {
          // seen from below: Snell's window + total internal reflection
          vec3 Nb = -N;
          float cosI = max(dot(vd, -Nb), 0.0);
          float window = smoothstep(0.62, 0.70, cosI);
          float camDepth = max(uWaterLevel - cameraPosition.y, 0.0);
          vec3 tir = t12_waterTint(reflect(vd, Nb), camDepth + 6.0) * 0.7;
          tir *= 0.75 + 1.1 * smoothstep(0.03, 0.16, length(g - vGrad * 0.5));      // rippling crest highlights
          vec3 through = t12_sky(normalize(refract(vd, Nb, 1.333)));
          col = mix(tir, through * 1.1, window);
          float ring = smoothstep(0.08, 0.0, abs(cosI - 0.66));
          col += uWaterShallow * ring * 0.35;
          float sun = pow(max(dot(vd, uSunDirWater), 0.0), 60.0);
          col += uSunColor * sun * 6.0;
          alpha = mix(1.0, 0.12, window);
          // rock overhead (sea-arch tunnel, arch crowns breaking the surface): the ceiling is in shadow, not open sky
          float roof = smoothstep(0.6, 2.5, terrainAt(vW.xz));
          col = mix(col, uFogDeep * 0.55 + vec3(0.02, 0.05, 0.06), roof * 0.88);
          alpha = mix(alpha, 1.0, roof);
          float wFog = 1.0 - exp(-uFogDensity * dist);
          wFog = mix(wFog, t12_fogCurve(dist), uFogCurve.w);             // same ABZÛ curve as the world: seamless horizon
          col = mix(col * exp(-uAbsorb * dist * 0.5), t12_waterTint(vd, camDepth * 0.6), wFog);
          alpha = mix(alpha, 1.0, wFog);
        }
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return mesh;
}

/** CPU mirror of the shader waves (for buoys / camera). */
export function waveHeight(x: number, z: number, t: number): number {
  const dx = [0.82, -0.35, 0.29, -0.71], dz = [0.57, 0.94, -0.96, -0.70];
  const k = [0.16, 0.23, 0.37, 0.61], a = [1.0, 0.55, 0.32, 0.18];
  let h = 0;
  for (let i = 0; i < 4; i++) h += a[i] * waterParams.uWaveAmp.value * Math.sin(k[i] * (dx[i] * x + dz[i] * z) - Math.sqrt(9.81 * k[i]) * t);
  return env.uWaterLevel.value + h;
}
