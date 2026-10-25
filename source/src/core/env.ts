import * as THREE from 'three';

/**
 * Shared environment state. Every patched material references these uniform objects,
 * so changing a value here updates the whole world (fog, sun, caustics, absorption...).
 */
export const env = {
  uTime: { value: 0 },
  uWaterLevel: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, // world, pointing toward the sun
  uSunDirWater: { value: new THREE.Vector3(0, 1, 0) }, // refracted into the water
  uSunColor: { value: new THREE.Color(1, 0.93, 0.8) },
  // underwater fog / colour
  uFogDensity: { value: 0.0135 },
  uFogShallow: { value: new THREE.Color('#169fc2') },
  uFogDeep: { value: new THREE.Color('#082a74') },
  uFogDepthScale: { value: 0.06 },
  uScatter: { value: 0.65 },
  uAbsorb: { value: new THREE.Vector3(0.05, 0.016, 0.01) },
  uLightAbsorb: { value: 0.3 },
  // air haze
  uHazeColor: { value: new THREE.Color('#bfe6f2') },
  uHazeDensity: { value: 0.0016 },
  // ABZÛ-style tuned fog opacity curve: x transition distance, y plateau opacity (silhouette range),
  // z far distance, w = how much of the curve (vs plain exponential fog) is used (0 = off)
  uFogCurve: { value: new THREE.Vector4(24, 0.55, 240, 0) },
  // localised sun pools where hero shafts land: xyz landing point, w = radius (strength in uPoolStrength)
  uPools: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -999, 0, 0)) },
  uPoolStrength: { value: new Array(8).fill(0) as number[] },
  uPoolGain: { value: 0 },
  // caustics
  uCausticStrength: { value: 0.62 },
  uCausticScale: { value: 0.5 },
  uCausticSpeed: { value: 0.55 },
  // kelp / plant push-away from the player
  uPlayerPos: { value: new THREE.Vector3(0, -5, 0) },
  // weather: wind 0..1 (palms, dune grass, flags; it freshens with the tide counter) and the storm 0..1 (whitecaps,
  // a longer swash up the sand) as the 12th Tide nears
  uWind: { value: 0.3 },
  uStorm: { value: 0 },
  // heightmap for depth-aware water shading
  uHeightTex: { value: null as THREE.Texture | null },
  uHeightBounds: { value: new THREE.Vector4(-150, 150, -170, 130) }, // bx0, bx1, by0, by1
};

export type EnvUniforms = typeof env;

export function setSun(elevationDeg: number, azimuthDeg: number) {
  const e = THREE.MathUtils.degToRad(elevationDeg);
  const a = THREE.MathUtils.degToRad(azimuthDeg);
  const d = new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
  env.uSunDir.value.copy(d);
  // Snell refraction (air n=1 -> water n=1.333) of the incoming light direction
  const horiz = Math.hypot(d.x, d.z);
  const sinW = Math.min(horiz / 1.333, 0.999);
  const cosW = Math.sqrt(1 - sinW * sinW);
  const hx = horiz > 1e-5 ? d.x / horiz : 0;
  const hz = horiz > 1e-5 ? d.z / horiz : 0;
  env.uSunDirWater.value.set(hx * sinW, cosW, hz * sinW).normalize();
}

/**
 * The swash: each wave runs a thin sheet of foam up the sand and slides back. Every stretch of beach (by z) has its own
 * phase, so the line ripples along the shore. Returns how high above the sea the front is now (m); the CPU copy below
 * (swashFront) matches, so the sanderlings chase the same line the sand shows and the sea erases footprints under it.
 */
export const SWASH_T = 6.5;
const SWASH_UP = 0.3;                    // share of the cycle the uprush takes (the backwash is slower)
export function swashReach(z: number, t: number, storm = 0) {
  const n = Math.floor(t / SWASH_T + swashPhase(z));
  return (0.26 + 0.1 * Math.sin(n * 1.7 + z * 0.011)) * (1 + 0.7 * storm);
}
function swashPhase(z: number) { return Math.sin(z * 0.045) * 0.35 + Math.sin(z * 0.013 + 1.7) * 0.25; }
export function swashFront(z: number, t: number, storm = 0) {
  const ph = t / SWASH_T + swashPhase(z), u = ph - Math.floor(ph);
  const e = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
  return swashReach(z, t, storm) * (u < SWASH_UP ? e(u / SWASH_UP) : 1 - e((u - SWASH_UP) / (1 - SWASH_UP)));
}
const SWASH_GLSL = /* glsl */ `
float t12_swashPhase(float z) { return sin(z * 0.045) * 0.35 + sin(z * 0.013 + 1.7) * 0.25; }
float t12_swashReach(float z, float t) {
  float n = floor(t / ${SWASH_T.toFixed(2)} + t12_swashPhase(z));
  return (0.26 + 0.1 * sin(n * 1.7 + z * 0.011)) * (1.0 + 0.7 * uStorm);
}
float t12_swashFront(float z, float t) {
  float ph = t / ${SWASH_T.toFixed(2)} + t12_swashPhase(z), u = fract(ph);
  return t12_swashReach(z, t) * (u < ${SWASH_UP.toFixed(2)} ? smoothstep(0.0, ${SWASH_UP.toFixed(2)}, u) : 1.0 - smoothstep(${SWASH_UP.toFixed(2)}, 1.0, u));
}`;

/** GLSL shared by every environment-aware shader. */
export const ENV_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWaterLevel;
uniform float uWind;
uniform float uStorm;
uniform vec3 uSunDir;
uniform vec3 uSunDirWater;
uniform vec3 uSunColor;
uniform float uFogDensity;
uniform vec3 uFogShallow;
uniform vec3 uFogDeep;
uniform float uFogDepthScale;
uniform float uScatter;
uniform vec3 uAbsorb;
uniform float uLightAbsorb;
uniform vec3 uHazeColor;
uniform float uHazeDensity;
uniform float uCausticStrength;
uniform float uCausticScale;
uniform float uCausticSpeed;
uniform vec4 uFogCurve;
uniform vec4 uPools[8];
uniform float uPoolStrength[8];
uniform float uPoolGain;

float t12_hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 t12_hash2(vec2 p) { float n = t12_hash(p); return vec2(n, t12_hash(p + n + 17.17)); }
float t12_noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(t12_hash(i), t12_hash(i + vec2(1, 0)), u.x), mix(t12_hash(i + vec2(0, 1)), t12_hash(i + vec2(1, 1)), u.x), u.y);
}
${SWASH_GLSL}

// Animated Voronoi edge network: bright where two moving cells meet.
float t12_cellEdge(vec2 p, float t) {
  vec2 i = floor(p); vec2 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = t12_hash2(i + g);
    o = 0.5 + 0.42 * sin(t + 6.2831 * o);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return d2 - d1;
}

float t12_caustics(vec2 xz) {
  float t = uTime * uCausticSpeed;
  vec2 p = xz * uCausticScale;
  // domain warp bends the cell edges into the curved filaments of real caustics
  p += 0.7 * vec2(t12_noise(p * 1.1 + t * 0.3), t12_noise(p * 1.1 + 5.2 - t * 0.25)) - 0.35;
  // soft, wide filaments (thin bright webs read as harsh over the large sand areas)
  float a = 1.0 - smoothstep(0.0, 0.24, t12_cellEdge(p, t));
  float b = 1.0 - smoothstep(0.0, 0.34, t12_cellEdge(p * 0.8 + 7.3, t * 0.8));
  return a * (0.3 + 0.55 * b);
}

// Colour of the water volume seen along view dir vd at a given depth.
vec3 t12_waterTint(vec3 vd, float depth) {
  vec3 base = mix(uFogDeep, uFogShallow, exp(-depth * uFogDepthScale));
  base *= 0.55 + 0.62 * clamp(vd.y * 0.5 + 0.5, 0.0, 1.0);
  float s = pow(max(dot(vd, uSunDirWater), 0.0), 5.0);
  base += uSunColor * s * uScatter * exp(-depth * 0.035) * mix(uFogShallow, vec3(1.0), 0.4);
  return base;
}

vec3 t12_hazeTint(vec3 vd) {
  float s = pow(max(dot(vd, uSunDir), 0.0), 6.0);
  return uHazeColor + uSunColor * s * 0.35;
}

// ABZÛ fog: opacity rises quickly to a plateau (the silhouette range keeps distant shapes readable),
// then climbs to full only at the far distance.
float t12_fogCurve(float d) {
  float T = uFogCurve.x, P = uFogCurve.y, F = uFogCurve.z;
  if (d < T) { float k = 1.0 - d / T; return P * (1.0 - k * k); }
  return P + (1.0 - P) * pow(clamp((d - T) / (F - T), 0.0, 1.0), 1.6);
}

// Light from hero sun shafts landing on surfaces: distance from the slanted shaft axis at this height.
float t12_pools(vec3 w) {
  if (uPoolGain <= 0.0) return 0.0;
  vec3 D = -uSunDirWater;
  float acc = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 pl = uPools[i];
    if (pl.w <= 0.0) continue;
    vec3 s = pl.xyz + D * ((w.y - pl.y) / D.y);
    float r = length(w.xz - s.xz);
    acc += uPoolStrength[i] * (1.0 - smoothstep(pl.w * 0.35, pl.w, r)) * smoothstep(pl.y - 4.0, pl.y - 0.5, w.y);
  }
  return acc * uPoolGain;
}

// Fraction of the camera->fragment segment that lies below the water plane.
float t12_waterFrac(float cy, float py) {
  if (cy < 0.0 && py < 0.0) return 1.0;
  if (cy >= 0.0 && py >= 0.0) return 0.0;
  float t = cy / (cy - py);
  return cy < 0.0 ? t : 1.0 - t;
}

// Apply depth light absorption, water fog + absorption, and air haze to a lit colour.
vec3 t12_applyEnvironment(vec3 col, vec3 wpos, vec3 camPos, float fogScale) {
  vec3 toFrag = wpos - camPos;
  float dist = max(length(toFrag), 1e-4);
  vec3 vd = toFrag / dist;
  float cy = camPos.y - uWaterLevel;
  float py = wpos.y - uWaterLevel;
  float wf = t12_waterFrac(cy, py);
  float Lw = dist * wf;
  float La = dist - Lw;
  float fragDepth = max(-py, 0.0);
  // sunlight travelling down to the fragment loses red first
  col *= exp(-uAbsorb * fragDepth * uLightAbsorb);
  float viewDepth = cy < 0.0 ? max(-cy, 0.0) * 0.6 + fragDepth * 0.4 : fragDepth * 0.5;
  vec3 wcol = t12_waterTint(vd, viewDepth);
  float wFog = 1.0 - exp(-uFogDensity * fogScale * Lw);
  wFog = mix(wFog, t12_fogCurve(Lw * fogScale), uFogCurve.w);
  vec3 T = exp(-uAbsorb * Lw * fogScale);
  float aFog = 1.0 - exp(-uHazeDensity * La);
  vec3 hcol = t12_hazeTint(vd);
  if (cy < 0.0) {
    col = mix(col, hcol, aFog);
    col = mix(col * T, wcol, wFog);
  } else {
    col = mix(col * T, wcol, wFog);
    col = mix(col, hcol, aFog);
  }
  return col;
}
`;

const COVER_GLSL = /* glsl */ `
uniform sampler2D uHeightTex;
uniform vec4 uHeightBounds;
float t12_cover(vec3 w, vec3 n) {
  vec2 uv = vec2((w.x - uHeightBounds.x) / (uHeightBounds.y - uHeightBounds.x), (-w.z - uHeightBounds.z) / (uHeightBounds.w - uHeightBounds.z));
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  float h = texture2D(uHeightTex, uv).r;
  float k = smoothstep(w.y + 1.5, w.y + 5.0, h);
  return k * (abs(n.y) < 0.35 ? 0.45 : 1.0);           // steep walls: half (the map can't tell a wall from a roof)
}`;

export interface PatchOptions {
  caustics?: boolean;
  fogScale?: number;
  /** GLSL inserted right after `vec3 transformed = vec3(position);` (object space). */
  deform?: string;
  /** Extra vertex declarations (attributes / uniforms / functions). */
  vertexHeader?: string;
  /** Extra uniforms to bind. */
  uniforms?: Record<string, THREE.IUniform>;
  /** GLSL that may modify `vec3 t12Col` (linear lit colour) before the environment is applied. */
  colorHook?: string;
  /** GLSL that may modify `diffuseColor` (albedo) before lighting, after textures/vertex colours. */
  albedoHook?: string;
  /** GLSL that may modify the view-space `normal` before lighting (after normal maps). */
  normalHook?: string;
  fragmentHeader?: string;
}

/**
 * Inject the shared environment (caustics, absorption, water fog, haze, deformation hooks)
 * into a built-in three.js material via onBeforeCompile.
 */
export function patchMaterial<T extends THREE.Material>(mat: T, opts: PatchOptions = {}): T {
  const fogScale = opts.fogScale ?? 1.0;
  const key = JSON.stringify([opts.caustics ?? true, fogScale, opts.deform ?? '', opts.colorHook ?? '', opts.vertexHeader ?? '', opts.fragmentHeader ?? '', opts.albedoHook ?? '', opts.normalHook ?? '']);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env, opts.uniforms ?? {}, { uFogScale: { value: fogScale } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform vec3 uPlayerPos;\nvarying vec3 vT12World;\n${opts.vertexHeader ?? ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${opts.deform ?? ''}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 t12w = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            t12w = instanceMatrix * t12w;
          #endif
          vT12World = (modelMatrix * t12w).xyz;
        }`,
      );
    const caustic = (opts.caustics ?? true)
      ? `{
          vec3 wn = inverseTransformDirection(normal, viewMatrix);
          // overhang occlusion from the exported heightmap (rock above this point: tunnel, arch crowns, ledges)
          float cover = t12_cover(vT12World, wn);
          reflectedLight.directDiffuse *= 1.0 - 0.78 * cover;
          reflectedLight.directSpecular *= 1.0 - 0.9 * cover;
          reflectedLight.indirectDiffuse *= 1.0 - 0.35 * cover;
          float under = smoothstep(0.2, -0.6, vT12World.y - uWaterLevel);
          float dcam = length(vT12World - cameraPosition);
          float far = smoothstep(16.0, 55.0, dcam);
          // Voronoi caustics are the most expensive per-pixel term: skip them where they can't be seen
          float c = (under > 0.0 && far < 1.0) ? t12_caustics(vT12World.xz + wn.xz * 0.5) : 0.16;
          c = mix(c, 0.16, far);                                                // average far away: no shimmer
          c *= 0.3 + 0.95 * t12_noise(vT12World.xz * 0.07 + uTime * 0.03);      // dappled patches
          c *= under * (cameraPosition.y < uWaterLevel ? 1.0 : 0.55) * (1.0 - cover);
          float facing = clamp(dot(wn, uSunDirWater) * 0.8 + 0.2, 0.0, 1.0);
          float fade = exp(-max(uWaterLevel - vT12World.y, 0.0) * 0.045);
          reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * c * facing * fade * uCausticStrength * 1.25;
          // hero shafts: a warm pool of light where each beam lands (with stronger caustics inside it)
          float pool = t12_pools(vT12World) * under * (1.0 - cover);
          if (pool > 0.0) reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * pool * (0.55 + 1.3 * c) * (0.35 + 0.65 * facing);
        }`
      : '';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ENV_GLSL}\n${COVER_GLSL}\nuniform float uFogScale;\nvarying vec3 vT12World;\n${opts.fragmentHeader ?? ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${opts.albedoHook ?? ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${opts.normalHook ?? ''}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${caustic}`)
      .replace(
        '#include <fog_fragment>',
        `{
          vec3 t12Col = gl_FragColor.rgb;
          ${opts.colorHook ?? ''}
          gl_FragColor.rgb = t12_applyEnvironment(t12Col, vT12World, cameraPosition, uFogScale);
        }`,
      );
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}
