import * as THREE from 'three';
import { env } from './env';

/**
 * Per-zone atmosphere (ABZÛ stores fog colour/opacity per space). Each zone is a sphere of influence with a preset;
 * the shared env uniforms are blended from the base look toward the zone preset by camera distance, so every patched
 * material, the god rays, particles and post pick it up with no extra cost. Reusable for every zone of the ocean.
 */
export interface AtmosPreset {
  fogDensity: number;
  fogShallow: THREE.Color;
  fogDeep: THREE.Color;
  fogDepthScale: number;
  scatter: number;
  absorb: THREE.Vector3;
  lightAbsorb: number;
  fogCurve: THREE.Vector4;
  caustics: number;
  poolGain: number;
  rays: number;
  /** hemisphere (ambient) intensity and colours */
  ambient: number;
  sky: THREE.Color;
  ground: THREE.Color;
}

export interface AtmosZone { name: string; pos: THREE.Vector3; radius: number; blend: number; preset: AtmosPreset }

export function snapshotPreset(rays: number, hemi: THREE.HemisphereLight): AtmosPreset {
  return {
    ambient: hemi.intensity, sky: hemi.color.clone(), ground: hemi.groundColor.clone(),
    fogDensity: env.uFogDensity.value, fogShallow: env.uFogShallow.value.clone(), fogDeep: env.uFogDeep.value.clone(),
    fogDepthScale: env.uFogDepthScale.value, scatter: env.uScatter.value, absorb: env.uAbsorb.value.clone(),
    lightAbsorb: env.uLightAbsorb.value, fogCurve: env.uFogCurve.value.clone(), caustics: env.uCausticStrength.value,
    poolGain: env.uPoolGain.value, rays,
  };
}

/** Reef garden: sunlit turquoise up top, deep cobalt in the distance, long silhouette range, warm light kept. */
export const REEF_GARDEN: AtmosPreset = {
  fogDensity: 0.0105,
  fogShallow: new THREE.Color('#13aac6'),
  fogDeep: new THREE.Color('#06246a'),
  fogDepthScale: 0.065,
  scatter: 0.7,
  absorb: new THREE.Vector3(0.013, 0.0052, 0.0036),         // stylised: warm coral survives ~30 m of view
  lightAbsorb: 0.16,
  fogCurve: new THREE.Vector4(30, 0.4, 250, 1),
  caustics: 0.5,
  poolGain: 1.0,
  rays: 0.4,
  ambient: 0.62,
  sky: new THREE.Color('#8fd2ee'),
  ground: new THREE.Color('#6a5a7a'),
};

export class AtmosZones {
  zones: AtmosZone[] = [];
  /** 0..1 influence of the strongest zone this frame (for audio/other systems). */
  weight = 0;
  active: AtmosZone | null = null;

  constructor(private base: AtmosPreset, private setRays: (v: number) => void, private hemi?: THREE.HemisphereLight) {}

  add(z: AtmosZone) { this.zones.push(z); }

  private cur: AtmosPreset | null = null;

  /** Zones blend in insertion order (later = higher priority), so a small zone inside a big one fades smoothly. */
  update(cam: THREE.Vector3) {
    const c = this.cur ??= cloneP(this.base);
    copyP(c, this.base);
    let wMax = 0; this.active = null;
    for (const z of this.zones) {
      const d = cam.distanceTo(z.pos);
      const k = 1 - THREE.MathUtils.smoothstep(d, z.radius, z.radius + z.blend);
      if (k <= 0) continue;
      lerpP(c, z.preset, k);
      if (k >= wMax) { wMax = k; this.active = z; }
    }
    this.weight = wMax;
    env.uFogDensity.value = c.fogDensity;
    env.uFogShallow.value.copy(c.fogShallow);
    env.uFogDeep.value.copy(c.fogDeep);
    env.uFogDepthScale.value = c.fogDepthScale;
    env.uScatter.value = c.scatter;
    env.uAbsorb.value.copy(c.absorb);
    env.uLightAbsorb.value = c.lightAbsorb;
    env.uFogCurve.value.copy(c.fogCurve);
    env.uCausticStrength.value = c.caustics;
    env.uPoolGain.value = c.poolGain;
    this.setRays(c.rays);
    if (this.hemi) {
      this.hemi.intensity = c.ambient;
      this.hemi.color.copy(c.sky);
      this.hemi.groundColor.copy(c.ground);
    }
  }
}

/** Headland passage (the sea-arch hole): a darker, quieter slot so the reef beyond reads as a burst of light. */
export const PASSAGE: AtmosPreset = {
  fogDensity: 0.016,
  fogShallow: new THREE.Color('#0d6f86'),
  fogDeep: new THREE.Color('#06204f'),
  fogDepthScale: 0.06,
  scatter: 0.35,
  absorb: new THREE.Vector3(0.03, 0.012, 0.008),
  lightAbsorb: 0.3,
  fogCurve: new THREE.Vector4(16, 0.42, 160, 1),
  caustics: 0.22,
  poolGain: 0.0,
  rays: 0.14,
  ambient: 0.34,
  sky: new THREE.Color('#5aa6c4'),
  ground: new THREE.Color('#3a3550'),
};

function cloneP(p: AtmosPreset): AtmosPreset {
  return { ...p, fogShallow: p.fogShallow.clone(), fogDeep: p.fogDeep.clone(), absorb: p.absorb.clone(), fogCurve: p.fogCurve.clone(), sky: p.sky.clone(), ground: p.ground.clone() };
}
function copyP(d: AtmosPreset, s: AtmosPreset) {
  d.fogDensity = s.fogDensity; d.fogShallow.copy(s.fogShallow); d.fogDeep.copy(s.fogDeep); d.fogDepthScale = s.fogDepthScale;
  d.scatter = s.scatter; d.absorb.copy(s.absorb); d.lightAbsorb = s.lightAbsorb; d.fogCurve.copy(s.fogCurve); d.caustics = s.caustics;
  d.poolGain = s.poolGain; d.rays = s.rays; d.ambient = s.ambient; d.sky.copy(s.sky); d.ground.copy(s.ground);
}
function lerpP(d: AtmosPreset, s: AtmosPreset, k: number) {
  const L = (a: number, b: number) => a + (b - a) * k;
  d.fogDensity = L(d.fogDensity, s.fogDensity); d.fogShallow.lerp(s.fogShallow, k); d.fogDeep.lerp(s.fogDeep, k);
  d.fogDepthScale = L(d.fogDepthScale, s.fogDepthScale); d.scatter = L(d.scatter, s.scatter); d.absorb.lerp(s.absorb, k);
  d.lightAbsorb = L(d.lightAbsorb, s.lightAbsorb); d.fogCurve.lerp(s.fogCurve, k); d.caustics = L(d.caustics, s.caustics);
  d.poolGain = L(d.poolGain, s.poolGain); d.rays = L(d.rays, s.rays); d.ambient = L(d.ambient, s.ambient);
  d.sky.lerp(s.sky, k); d.ground.lerp(s.ground, k);
}
