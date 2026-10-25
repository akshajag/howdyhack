import * as THREE from 'three';
import { env, ENV_GLSL } from '../core/env';

/**
 * Coloured puffs, blended normally (the Streams motes are additive light, so they can't be sand or ink): sand kicked
 * up on landing and off the seabed, an octopus' ink, the shield's shards, drops shaken off the runner's head. One ring
 * buffer, one draw call. Each puff grows, drifts with drag and a little gravity (or buoyancy), and fades.
 */
const CAP = 900;

export interface PuffStyle { color: THREE.ColorRepresentation; size: number; grow: number; life: number; gravity: number; drag: number; alpha: number }
export const PUFF = {
  sand: { color: '#d8bd8a', size: 0.22, grow: 1.6, life: 0.7, gravity: 3.5, drag: 3.2, alpha: 0.55 },
  silt: { color: '#cdbf9a', size: 0.3, grow: 1.8, life: 1.6, gravity: -0.15, drag: 2.2, alpha: 0.45 },
  ink: { color: '#141822', size: 0.45, grow: 3.2, life: 2.6, gravity: -0.05, drag: 1.6, alpha: 0.85 },
  shard: { color: '#9ff3ff', size: 0.09, grow: 0.2, life: 0.55, gravity: 6, drag: 1.2, alpha: 0.9 },
  drop: { color: '#e9fbff', size: 0.06, grow: 0.1, life: 0.5, gravity: 9, drag: 0.5, alpha: 0.85 },
} satisfies Record<string, PuffStyle>;

export class Dust {
  readonly points: THREE.Points;
  private pos = new Float32Array(CAP * 3);
  private vel = new Float32Array(CAP * 3);
  private col = new Float32Array(CAP * 3);
  private age = new Float32Array(CAP);         // 0..1 (1 = gone)
  private rate = new Float32Array(CAP);        // 1 / life
  private size = new Float32Array(CAP);
  private grow = new Float32Array(CAP);
  private grav = new Float32Array(CAP);
  private drag = new Float32Array(CAP);
  private alpha = new Float32Array(CAP);
  private head = 0;
  private tmp = new THREE.Color();

  constructor() {
    this.age.fill(1);
    for (let i = 0; i < CAP; i++) this.pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aGrow', new THREE.BufferAttribute(this.grow, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { ...env, uPixelRatio: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uPixelRatio;
        attribute vec3 aCol; attribute float aAge; attribute float aSize; attribute float aGrow; attribute float aAlpha;
        varying vec3 vCol; varying float vA; varying vec3 vW;
        void main() {
          vec4 mv = viewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          vCol = aCol; vW = position;
          vA = aAge < 1.0 ? aAlpha * (1.0 - aAge) * smoothstep(0.0, 0.08, aAge + 0.02) * smoothstep(0.3, 1.2, d) : 0.0;
          gl_PointSize = aSize * (1.0 + aGrow * aAge) * 900.0 * uPixelRatio / max(d, 0.5);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        varying vec3 vCol; varying float vA; varying vec3 vW;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.15, r) * vA;
          if (a < 0.01) discard;
          // lit a little by the sun, tinted by the water when under it
          vec3 c = vCol * (0.75 + 0.35 * uSunColor);
          if (vW.y < uWaterLevel) c = mix(c, uFogShallow, 0.25);
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 21;
  }

  setPixelRatio(r: number) { (this.points.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = r; }

  /** one puff at (x, y, z) moving at (vx, vy, vz) */
  emit(s: PuffStyle, x: number, y: number, z: number, vx: number, vy: number, vz: number, scale = 1) {
    const i = this.head++ % CAP, k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.tmp.set(s.color).convertSRGBToLinear();
    const shade = 0.9 + Math.random() * 0.2;
    this.col[k] = this.tmp.r * shade; this.col[k + 1] = this.tmp.g * shade; this.col[k + 2] = this.tmp.b * shade;
    this.age[i] = 0; this.rate[i] = 1 / (s.life * (0.75 + Math.random() * 0.5));
    this.size[i] = s.size * scale * (0.7 + Math.random() * 0.6); this.grow[i] = s.grow;
    this.grav[i] = s.gravity; this.drag[i] = s.drag; this.alpha[i] = s.alpha;
  }

  /** n puffs thrown out round (x, y, z): `speed` sideways, `up` upward */
  burst(s: PuffStyle, x: number, y: number, z: number, n: number, speed: number, up = 0, scale = 1) {
    for (let j = 0; j < n; j++) {
      const a = Math.random() * Math.PI * 2, r = speed * (0.35 + Math.random() * 0.65);
      this.emit(s, x + Math.cos(a) * 0.1, y, z + Math.sin(a) * 0.1, Math.cos(a) * r, up * (0.5 + Math.random() * 0.7), Math.sin(a) * r, scale);
    }
  }

  update(dt: number) {
    const p = this.pos, v = this.vel;
    for (let i = 0; i < CAP; i++) {
      if (this.age[i] >= 1) continue;
      const k = i * 3, d = Math.exp(-this.drag[i] * dt);
      v[k] *= d; v[k + 2] *= d; v[k + 1] = v[k + 1] * d - this.grav[i] * dt;
      p[k] += v[k] * dt; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt;
      this.age[i] = Math.min(1, this.age[i] + this.rate[i] * dt);
      if (this.age[i] >= 1) p[k + 1] = -999;
    }
    const g = this.points.geometry;
    for (const n of ['position', 'aCol', 'aAge', 'aSize', 'aGrow', 'aAlpha']) (g.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
}
