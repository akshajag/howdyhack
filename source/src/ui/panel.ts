import GUI from 'lil-gui';
import * as THREE from 'three';
import { env, setSun } from '../core/env';
import { postParams } from '../fx/post';
import { rayParams } from '../fx/godrays';
import { waterParams } from '../world/water';
import { skyParams } from '../world/sky';
import { LEVELS, type AdaptiveQuality } from '../systems/quality';

export const sunState = { elevation: 52, azimuth: 18, intensity: 3.2, absorption: 1.0 };
const BASE_ABSORB = new THREE.Vector3(0.05, 0.016, 0.01);

export function applyAbsorption() {
  env.uAbsorb.value.copy(BASE_ABSORB).multiplyScalar(sunState.absorption);
}

/** Art-direction controls. Every slider writes straight into shared uniforms. */
export function createPanel(quality: AdaptiveQuality, sun: THREE.DirectionalLight, views: Record<string, () => void>) {
  const gui = new GUI({ title: 'Shorebreak · Art Direction', width: 290 });
  gui.close();
  const hex = (c: THREE.Color) => ({ get v() { return '#' + c.getHexString(THREE.SRGBColorSpace); }, set v(s: string) { c.set(s); } });

  const fog = gui.addFolder('Water · Fog');
  fog.add(env.uFogDensity, 'value', 0.002, 0.05, 0.001).name('density');
  fog.addColor(hex(env.uFogShallow.value), 'v').name('shallow colour');
  fog.addColor(hex(env.uFogDeep.value), 'v').name('deep colour');
  fog.add(env.uFogDepthScale, 'value', 0.005, 0.2, 0.001).name('depth falloff');
  fog.add(env.uScatter, 'value', 0, 2, 0.01).name('sun scattering');
  fog.add(env.uHazeDensity, 'value', 0, 0.01, 0.0001).name('air haze');
  fog.add(waterParams.uWaveAmp, 'value', 0, 0.8, 0.01).name('wave height');
  fog.addColor(hex(waterParams.uWaterShallow.value), 'v').name('surface shallow');
  fog.addColor(hex(waterParams.uWaterDeep.value), 'v').name('surface deep');

  const abs = gui.addFolder('Colour absorption');
  abs.add(sunState, 'absorption', 0, 3, 0.01).name('strength').onChange(applyAbsorption);
  abs.add(env.uLightAbsorb, 'value', 0, 1.5, 0.01).name('sunlight depth loss');

  const s = gui.addFolder('Sunlight');
  const upd = () => { setSun(sunState.elevation, sunState.azimuth); sun.intensity = sunState.intensity; env.uSunColor.value.copy(sun.color).multiplyScalar(sunState.intensity / 3.2); };
  s.add(sunState, 'elevation', 10, 89, 0.5).onChange(upd);
  s.add(sunState, 'azimuth', -180, 180, 1).onChange(upd);
  s.add(sunState, 'intensity', 0, 8, 0.05).onChange(upd);
  s.add(skyParams.uCloud, 'value', 0, 1, 0.01).name('clouds');

  const c = gui.addFolder('Caustics · Rays');
  c.add(env.uCausticStrength, 'value', 0, 3, 0.01).name('caustic strength');
  c.add(env.uCausticScale, 'value', 0.05, 1.0, 0.01).name('caustic scale');
  c.add(env.uCausticSpeed, 'value', 0, 2, 0.01).name('caustic speed');
  c.add(rayParams.uRayStrength, 'value', 0, 2, 0.01).name('ray strength');
  c.add(rayParams.uRayLength, 'value', 5, 70, 1).name('ray length');

  const p = gui.addFolder('Bloom · Grade');
  p.add(postParams, 'bloomStrength', 0, 2, 0.01).name('bloom');
  p.add(postParams, 'bloomThreshold', 0.2, 4, 0.01).name('bloom threshold');
  p.add(postParams, 'bloomRadius', 0.2, 2, 0.01).name('bloom radius');
  p.add(postParams, 'exposure', 0.3, 2.5, 0.01);
  p.add(postParams, 'saturation', 0, 2, 0.01);
  p.add(postParams, 'contrast', 0.6, 1.6, 0.01);
  p.add(postParams, 'vignette', 0, 1, 0.01);

  const q = gui.addFolder('Quality');
  const qs = { preset: LEVELS[quality.level].name };
  q.add(quality, 'auto').name('adaptive');
  q.add(qs, 'preset', LEVELS.map((l) => l.name)).onChange((v: string) => { quality.auto = false; quality.set(LEVELS.findIndex((l) => l.name === v)); gui.controllersRecursive().forEach((ct) => ct.updateDisplay()); });

  const v = gui.addFolder('Hero views');
  for (const [k, fn] of Object.entries(views)) v.add({ [k]: fn }, k);
  return gui;
}
