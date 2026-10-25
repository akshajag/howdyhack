import * as THREE from 'three';
import { patchMaterial } from '../core/env';


const RIM = /* glsl */ `
  {
    // backlit rim: silhouettes glow when looking toward the sun (ABZÛ-style separation)
    vec3 vdir = normalize(vT12World - cameraPosition);
    vec3 wn = inverseTransformDirection(normal, viewMatrix);
    float rim = pow(1.0 - clamp(dot(wn, -vdir), 0.0, 1.0), 3.0);
    float toward = pow(max(dot(vdir, uSunDirWater), 0.0), 2.0);
    float under = step(vT12World.y, uWaterLevel);
    t12Col += mix(uFogShallow, uSunColor, 0.5) * rim * (0.12 + 0.55 * toward) * under;
  }`;

/** Reusable, environment-aware materials. One per surface family keeps programs and draw state small. */
function sandTexture(url: string, srgb: boolean) {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createMaterials() {
  // Poly Haven "Sand 01" (Rob Tuytel, CC0): its grain and ripples as a luminance + normal detail over our painted
  // ground colours, so the palette stays ours. Two scales break up the tiling; it fades out by ~45 m.
  const sand = { uSandMap: { value: sandTexture('runner/textures/sand_01_diff_1k.jpg', true) }, uSandNor: { value: sandTexture('runner/textures/sand_01_nor_gl_1k.jpg', false) } };
  const terrain = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), {
    uniforms: sand,
    fragmentHeader: /* glsl */ `uniform sampler2D uSandMap; uniform sampler2D uSandNor;`,
    albedoHook: /* glsl */ `
      {
        vec2 suv = vT12World.xz / 1.5;
        float near = smoothstep(48.0, 10.0, length(vT12World - cameraPosition));
        float sandy = smoothstep(0.03, -0.01, diffuseColor.g - diffuseColor.r);      // not on the grassy hills
        const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
        float d1 = dot(texture2D(uSandMap, suv).rgb, LUM) / max(dot(texture2D(uSandMap, suv, 10.0).rgb, LUM), 1e-3);
        float d2 = dot(texture2D(uSandMap, suv * 0.27 + 0.31).rgb, LUM) / max(dot(texture2D(uSandMap, suv * 0.27 + 0.31, 10.0).rgb, LUM), 1e-3);
        diffuseColor.rgb *= mix(1.0, d1 * 0.65 + d2 * 0.35, near * mix(0.35, 1.0, sandy));
      }`,
    normalHook: /* glsl */ `
      {
        vec2 suv = vT12World.xz / 1.5;
        vec3 tn = texture2D(uSandNor, suv).xyz * 2.0 - 1.0;
        float near = smoothstep(32.0, 6.0, length(vT12World - cameraPosition));
        vec3 wn = inverseTransformDirection(normal, viewMatrix);
        // the ground is close to level: tangent +x, bitangent +z (uv follows world xz)
        wn = normalize(wn + vec3(tn.x, 0.0, tn.y) * 0.55 * near);
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
      }`,
    // painterly sand ripples, stronger in the shallows
    colorHook: /* glsl */ `
      float rip = sin(dot(vT12World.xz, vec2(0.9, 0.42)) * 3.1 + t12_noise(vT12World.xz * 0.35) * 5.0);
      float sandy = smoothstep(0.85, 1.0, inverseTransformDirection(normal, viewMatrix).y) * smoothstep(1.0, -2.0, vT12World.y);
      t12Col *= 1.0 + rip * 0.045 * sandy;
      // dry sand: fine grain + wind ripples + soft dapple so the beach never reads as a flat white sheet
      float dry = smoothstep(-0.2, 0.3, vT12World.y - uWaterLevel) * smoothstep(90.0, 20.0, length(vT12World - cameraPosition));
      float grain = t12_noise(vT12World.xz * 9.0) * 0.5 + t12_noise(vT12World.xz * 23.0) * 0.5;
      float wind = sin(dot(vT12World.xz, vec2(0.35, 1.0)) * 2.6 + t12_noise(vT12World.xz * 0.2) * 6.0);
      float dapple = t12_noise(vT12World.xz * 0.08 + 3.0);
      // dry sand sits under the bloom threshold and keeps its warmth (a lit flat surface otherwise clips to white)
      float dryAll = smoothstep(-0.2, 0.3, vT12World.y - uWaterLevel);
      t12Col *= (1.0 - 0.1 * dryAll) * vec3(1.0, 0.98, 0.93);
      t12Col *= 1.0 - dry * (0.1 * (grain - 0.5) + 0.05 * wind + 0.07 * (dapple - 0.5));`,
  });

  const rock = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }), { colorHook: RIM });
  const arch = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), { fogScale: 0.92, colorHook: RIM });
  const landmark = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), { fogScale: 0.5, colorHook: RIM });
  const coral = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }), {
    // soft corals and fans breathe with the surge and lean away from the diver
    deform: /* glsl */ `
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float h = max(position.y, 0.0);
        float ph = uTime * 0.85 + ip.x * 0.37 + ip.z * 0.23;
        vec2 sw = vec2(sin(ph), cos(ph * 0.8 + 1.3)) * 0.03 * h * h;
        vec3 away = ip - uPlayerPos;
        sw += normalize(away.xz + 1e-4) * smoothstep(4.5, 0.5, length(away)) * 0.1 * h;
        transformed.xz += sw;
      }`,
    // soft wrap light so corals stay luminous in shadow (stylised subsurface)
    colorHook: /* glsl */ `t12Col += diffuseColor.rgb * uSunColor * 0.1;` + RIM,
  });
  const structure = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide }), { caustics: true });
  const palm = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }), {
    deform: /* glsl */ `
      {
        float h = max(position.y - 5.5, 0.0);
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        // (the wind freshens with the tide counter: a lazy sway when calm, a lean and a shiver near the 12th)
        float w = 0.6 + 1.6 * uWind;
        transformed.x += (sin(uTime * (1.3 + uWind) + ip.x * 0.3) * 0.06 + uWind * 0.05) * h * w;
        transformed.z += cos(uTime * (1.1 + uWind) + ip.z * 0.3) * h * 0.05 * w + sin(uTime * 7.0 + ip.x) * h * 0.012 * uWind;
      }`,
    vertexHeader: `uniform float uWind;`,
  });
  // a flag (K_Flag: its pole at the -x edge, the cloth above 1.6 m): the cloth ripples, harder as the wind freshens
  const flag = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), {
    vertexHeader: `uniform float uWind;`,
    deform: /* glsl */ `
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float u = clamp((position.x + 0.82) / 1.76, 0.0, 1.0) * step(1.6, position.y);
        float ph = position.x * 3.2 - uTime * (5.0 + 5.0 * uWind) + ip.x * 0.7 + ip.z * 0.3;
        transformed.z += sin(ph) * u * (0.07 + 0.2 * uWind);
        transformed.y -= u * u * (0.35 * (1.0 - uWind));
      }`,
  });
  const glow = patchMaterial(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), {
    caustics: false,
    fogScale: 0.3,
    colorHook: /* glsl */ `t12Col *= 5.0 + 1.2 * sin(uTime * 1.7 + vT12World.y * 0.6);`,
  });
  const diver = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
  return { terrain, rock, arch, landmark, coral, structure, palm, glow, diver, flag };
}

export type Materials = ReturnType<typeof createMaterials>;

const SWAY = /* glsl */ `
  {
    vec3 ip = vec3(0.0);
    float s = 1.0;
    #ifdef USE_INSTANCING
      ip = instanceMatrix[3].xyz;
      s = length(instanceMatrix[1].xyz);
    #endif
    float h = position.y;
    float bend = pow(clamp(h / uSwayHeight, 0.0, 1.0), 1.5);
    float ph = uTime * uSwaySpeed + ip.x * 0.21 + ip.z * 0.17;
    vec2 tide = vec2(sin(ph) + 0.4 * sin(ph * 2.3 + 1.7), cos(ph * 0.8) * 0.6 + 0.3 * sin(ph * 1.9)) * uSwayAmp;
    // bend away from the diver
    vec3 tip = ip + vec3(0.0, h * s, 0.0);
    vec3 away = tip - uPlayerPos;
    float push = smoothstep(uSwayHeight * s * 0.35 + 2.5, 0.0, length(away));
    tide += normalize(away.xz + 1e-4) * push * 2.2;
    tide *= 1.0 + uSwayWind * (1.8 * uWind - 0.4);
    tide.x += uSwayWind * uWind * 0.9;
    transformed.xz += tide * bend * uSwayHeight * 0.18 / max(s, 0.2);
    transformed.y -= dot(tide, tide) * bend * 0.08 * uSwayHeight;
  }`;

/** `wind`: above water, so it bends with the wind (dune grass); kelp and seagrass only feel the swell */
export function createSwayMaterial(height: number, amp: number, speed: number, wind = false) {
  return patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), {
    deform: SWAY,
    vertexHeader: `uniform float uSwayHeight; uniform float uSwayAmp; uniform float uSwaySpeed; uniform float uSwayWind; uniform float uWind;`,
    uniforms: { uSwayHeight: { value: height }, uSwayAmp: { value: amp }, uSwaySpeed: { value: speed }, uSwayWind: { value: wind ? 1 : 0 } },
    // backlit "halo" glow when looking toward the sun through blades
    colorHook: /* glsl */ `
      vec3 vdir = normalize(vT12World - cameraPosition);
      t12Col += diffuseColor.rgb * uSunColor * pow(max(dot(vdir, uSunDirWater), 0.0), 3.0) * 0.55;`,
  });
}

const RAMP_GLSL = /* glsl */ `
uniform vec3 uRamp0; uniform vec3 uRamp1; uniform vec3 uRamp2;
vec3 t12_ramp3(float l) { return l < 0.35 ? mix(uRamp0, uRamp1, smoothstep(0.05, 0.35, l)) : mix(uRamp1, uRamp2, smoothstep(0.35, 0.75, l)); }`;

/**
 * Materials for the Blender cove export, chosen by the asset's `family`.
 * Textured art-pack assets keep their texture but are re-coloured through our coastal ramps (as in Blender).
 */
export function createFamilyMaterials(M: Materials) {
  const cache = new Map<string, THREE.Material>();
  const kelp = createSwayMaterial(10, 0.16, 0.55);
  const seagrass = createSwayMaterial(1.0, 0.28, 0.9);
  const dune = createSwayMaterial(1.4, 0.2, 0.8, true);
  const fixed: Record<string, THREE.Material> = {
    terrain: M.terrain, rock: M.rock, island: M.rock, structure: M.structure, landmark: M.landmark, glow: M.glow,
    arch: M.arch, coral: M.coral, kelp, seagrass, grass: dune, palm: M.palm,
  };
  const RAMPS: Record<string, string[]> = { foliage: ['#66804A', '#93A866', '#C2C88C'], grassTex: ['#9C8B4E', '#CDB874', '#EAD9A0'] };

  return (family: string | undefined, gltf: THREE.Material | null, key: string): THREE.Material => {
    const fam = family ?? 'structure';
    if (fixed[fam]) return fixed[fam];
    const ck = `${fam}:${key}`;
    if (cache.has(ck)) return cache.get(ck)!;
    const src = gltf as THREE.MeshStandardMaterial | null;
    const mat = new THREE.MeshStandardMaterial({
      map: src?.map ?? null, roughness: 0.8, metalness: 0, side: THREE.DoubleSide,
      alphaTest: fam === 'grassTex' || fam === 'foliage' ? 0.4 : 0, transparent: false,
    });
    const ramp = RAMPS[fam];
    const opts: Parameters<typeof patchMaterial>[1] = {};
    if (ramp) {
      opts.fragmentHeader = RAMP_GLSL;
      opts.uniforms = { uRamp0: { value: new THREE.Color(ramp[0]) }, uRamp1: { value: new THREE.Color(ramp[1]) }, uRamp2: { value: new THREE.Color(ramp[2]) } };
      opts.albedoHook = /* glsl */ `diffuseColor.rgb = t12_ramp3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));`;
    }
    if (fam === 'palmTex') {
      opts.deform = /* glsl */ `
        {
          float h = max(position.y - 5.5, 0.0);
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          transformed.x += sin(uTime * 1.3 + ip.x * 0.3) * h * 0.06;
          transformed.z += cos(uTime * 1.1 + ip.z * 0.3) * h * 0.05;
        }`;
    }
    patchMaterial(mat, opts);
    cache.set(ck, mat);
    return mat;
  };
}
