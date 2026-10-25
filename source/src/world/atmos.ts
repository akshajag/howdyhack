import * as THREE from 'three';
import { env } from '../core/env';
import { skyParams } from './sky';
import { rayParams } from '../fx/godrays';
import { waterParams } from './water';
import type { Biome } from '../game/types';

/**
 * Atmosphere per biome (fog colours, absorption, caustics, sunbeams, ambient) blended by the chunk the runner is in,
 * plus a tide overlay that darkens the sky and thickens the water as the 12th Tide approaches, lightning flashes in the
 * storm, and the sun breaking out bright and warm after it (`clearing`).
 */
interface Preset { washAlpha: number; depthRate: number; fogDensity: number; fogShallow: THREE.Color; fogDeep: THREE.Color; fogDepthScale: number; scatter: number; absorb: THREE.Vector3; lightAbsorb: number; caustics: number; rays: number; ambient: number; sky: THREE.Color; ground: THREE.Color; horizon: THREE.Color; zenith: THREE.Color; cloud: number }
const P = (o: Partial<Preset>): Preset => ({
  washAlpha: 0.26, depthRate: 0.2, fogDensity: 0.0135, fogShallow: new THREE.Color('#169fc2'), fogDeep: new THREE.Color('#082a74'), fogDepthScale: 0.06, scatter: 0.65, absorb: new THREE.Vector3(0.05, 0.016, 0.01), lightAbsorb: 0.3,
  caustics: 0.62, rays: 0.32, ambient: 0.95, sky: new THREE.Color('#9fd6f5'), ground: new THREE.Color('#e0c49a'), horizon: new THREE.Color('#bde6f2'), zenith: new THREE.Color('#1f7ae0'), cloud: 0.55, ...o,
});
const PRESETS: Record<Biome, Preset> = {
  beach: P({ fogDensity: 0.02, fogShallow: new THREE.Color('#2fd4c6'), fogDeep: new THREE.Color('#0a6aa8'), ambient: 1.0 }),
  pier: P({ fogDensity: 0.018, fogShallow: new THREE.Color('#1fb9c4'), fogDeep: new THREE.Color('#0a4c90') }),
  lagoon: P({ fogDensity: 0.016, fogShallow: new THREE.Color('#38dccb'), fogDeep: new THREE.Color('#0c6cab'), caustics: 0.75, ambient: 1.05 }),
  coral: P({ fogDensity: 0.0105, fogShallow: new THREE.Color('#13aac6'), fogDeep: new THREE.Color('#06246a'), fogDepthScale: 0.065, scatter: 0.7, absorb: new THREE.Vector3(0.013, 0.0052, 0.0036), lightAbsorb: 0.16, caustics: 0.5, rays: 0.42, ambient: 0.62, sky: new THREE.Color('#8fd2ee'), ground: new THREE.Color('#6a5a7a') }),
  // Shorebreak Point: bright, clear shallows over sand
  surf: P({ washAlpha: 0.96, depthRate: 0.8, fogDensity: 0.016, fogShallow: new THREE.Color('#36dccd'), fogDeep: new THREE.Color('#0b72ae'), caustics: 0.8, ambient: 1.05 }),
  ski: P({ washAlpha: 0.88, depthRate: 0.6, fogDensity: 0.016, fogShallow: new THREE.Color('#2fcfc8'), fogDeep: new THREE.Color('#0b6aa8'), caustics: 0.7, ambient: 1.05 }),
  grotto: P({ fogDensity: 0.02, fogShallow: new THREE.Color('#0c6d86'), fogDeep: new THREE.Color('#061a44'), fogDepthScale: 0.06, scatter: 0.3, absorb: new THREE.Vector3(0.03, 0.012, 0.008), lightAbsorb: 0.3, caustics: 0.2, rays: 0.12, ambient: 0.36, sky: new THREE.Color('#5aa6c4'), ground: new THREE.Color('#3a3550') }),
};
const STORM = { horizon: new THREE.Color('#6f8d9b'), zenith: new THREE.Color('#1f3f63'), cloud: 0.72, sun: 0.7 };
const FLASH = new THREE.Color('#e8f0ff');

export class Atmosphere {
  private cur: Preset = P({});
  private target: Preset = PRESETS.beach;
  tide = 0;     // 0..1 storm overlay
  private flashT = 0;
  private clear = 0;
  constructor(private hemi: THREE.HemisphereLight, private sun: THREE.DirectionalLight, private sunBase: number) {}
  setBiome(b: Biome) { this.target = PRESETS[b]; }
  /** a lightning flash lights up the sky and the world for a moment (a double flicker) */
  lightning() { this.flashT = 0.45; }
  /** the storm's over: the sun breaks out, bright and warm, easing back over half a minute */
  clearing() { this.clear = 1; }
  update(dt: number) {
    const k = 1 - Math.exp(-dt / 1.6), c = this.cur, t = this.target;
    const L = (a: number, b: number) => a + (b - a) * k;
    c.fogDensity = L(c.fogDensity, t.fogDensity); c.fogShallow.lerp(t.fogShallow, k); c.fogDeep.lerp(t.fogDeep, k); c.fogDepthScale = L(c.fogDepthScale, t.fogDepthScale);
    c.scatter = L(c.scatter, t.scatter); c.absorb.lerp(t.absorb, k); c.lightAbsorb = L(c.lightAbsorb, t.lightAbsorb); c.caustics = L(c.caustics, t.caustics); c.rays = L(c.rays, t.rays);
    c.ambient = L(c.ambient, t.ambient); c.washAlpha = L(c.washAlpha, t.washAlpha); c.depthRate = L(c.depthRate, t.depthRate);
    waterParams.uShallowAlpha.value = c.washAlpha; waterParams.uDepthRate.value = c.depthRate; c.sky.lerp(t.sky, k); c.ground.lerp(t.ground, k); c.horizon.lerp(t.horizon, k); c.zenith.lerp(t.zenith, k); c.cloud = L(c.cloud, t.cloud);
    const s = this.tide;
    this.flashT = Math.max(0, this.flashT - dt);
    this.clear = Math.max(0, this.clear - dt / 30);
    const fl = this.flashT > 0 ? Math.max(0, Math.sin((this.flashT / 0.45) * Math.PI * 3)) * (this.flashT / 0.45) : 0;
    const cl = Math.sin(Math.min(1, this.clear * 1.15) * Math.PI / 2) * (1 - s);
    env.uFogDensity.value = c.fogDensity * (1 + 0.3 * s); env.uFogShallow.value.copy(c.fogShallow).lerp(new THREE.Color('#2a7a86'), s * 0.5); env.uFogDeep.value.copy(c.fogDeep);
    env.uFogDepthScale.value = c.fogDepthScale; env.uScatter.value = c.scatter * (1 - 0.3 * s); env.uAbsorb.value.copy(c.absorb); env.uLightAbsorb.value = c.lightAbsorb;
    env.uCausticStrength.value = c.caustics * (1 - 0.4 * s); rayParams.uRayStrength.value = c.rays * (1 - 0.5 * s);
    this.hemi.intensity = c.ambient * (1 - 0.25 * s) * (1 + 1.6 * fl + 0.12 * cl); this.hemi.color.copy(c.sky); this.hemi.groundColor.copy(c.ground);
    skyParams.uHorizon.value.copy(c.horizon).lerp(STORM.horizon, s).lerp(FLASH, fl * 0.6); skyParams.uZenith.value.copy(c.zenith).lerp(STORM.zenith, s).lerp(FLASH, fl * 0.35);
    skyParams.uCloud.value = THREE.MathUtils.lerp(c.cloud, STORM.cloud, s) * (1 - 0.45 * cl);
    this.sun.intensity = this.sunBase * THREE.MathUtils.lerp(1, STORM.sun, s) * (1 + 0.18 * cl);
  }
}
