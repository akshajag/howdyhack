import * as THREE from 'three';
import { env, ENV_GLSL } from '../core/env';

/**
 * Portal cards (ABZÛ, GDC 2017): large soft camera-facing glows placed *behind* hero silhouettes so the shapes in
 * front read crisply against a luminous haze instead of dissolving uniformly into blue fog. Depth-tested, so the rock
 * in front occludes them; they fade out when the camera gets close so the card never reads as a flat object.
 */
export class PortalCards {
  readonly mesh: THREE.InstancedMesh;
  readonly uniforms = { uPortalGain: { value: 1 } };

  constructor(cards: { pos: number[]; size: number; strength: number }[]) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(cards.length * 2);
    cards.forEach((c, i) => { data[i * 2] = c.size; data[i * 2 + 1] = c.strength; });
    geo.setAttribute('aCard', new THREE.InstancedBufferAttribute(data, 2));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      uniforms: { ...env, ...this.uniforms },
      vertexShader: /* glsl */ `
        attribute vec2 aCard;
        varying vec2 vUv; varying vec3 vC; varying float vS;
        void main() {
          vec3 c = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 p = c + (right * position.x + up * position.y * 0.62) * aCard.x;
          vUv = uv; vC = c; vS = aCard.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        uniform float uPortalGain;
        varying vec2 vUv; varying vec3 vC; varying float vS;
        void main() {
          vec2 q = (vUv - 0.5) * 2.0;
          float r2 = dot(q, q);
          float a = exp(-r2 * 3.2) * (1.0 - smoothstep(0.75, 1.0, r2));
          float d = length(vC - cameraPosition);
          a *= smoothstep(22.0, 70.0, d);                                   // never seen up close
          a *= smoothstep(0.4, -0.6, cameraPosition.y - uWaterLevel);       // underwater only
          vec3 vd = normalize(vC - cameraPosition);
          vec3 glow = mix(uFogShallow, vec3(0.7, 1.0, 1.0), 0.22) * (1.0 + 0.45 * clamp(vd.y + 0.3, 0.0, 1.0));
          glow += uSunColor * 0.25 * pow(max(dot(vd, uSunDirWater), 0.0), 2.0);
          gl_FragColor = vec4(glow, a * vS * 0.42 * uPortalGain);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cards.length);
    const m = new THREE.Matrix4();
    cards.forEach((c, i) => { m.makeTranslation(c.pos[0], c.pos[1], c.pos[2]); this.mesh.setMatrixAt(i, m); });
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }
}

/**
 * Hero sun shafts: art-directed beams that land on specific spots (arch crown, lip, terraces). Each shaft is three
 * axis-billboarded quads around the beam axis for a volumetric read; anchors are recomputed from the refracted sun
 * so the beam always hits its landing point. Landing points also feed env.uPools (warm light on the surfaces).
 */
export class HeroShafts {
  readonly mesh: THREE.InstancedMesh;
  readonly uniforms = { uShaftGain: { value: 1 } };
  private specs: { pos: THREE.Vector3; radius: number; strength: number }[];
  private readonly per = 3;

  constructor(shafts: { pos: number[]; radius: number; strength: number }[]) {
    this.specs = shafts.slice(0, 8).map((s) => ({ pos: new THREE.Vector3(...(s.pos as [number, number, number])), radius: s.radius, strength: s.strength }));
    const n = this.specs.length * this.per;
    const geo = new THREE.PlaneGeometry(1, 1, 1, 12);
    geo.translate(0, -0.5, 0);
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const s = this.specs[Math.floor(i / this.per)], k = i % this.per;
      a[i * 4] = s.radius * (k === 0 ? 1.0 : 0.62);       // width
      a[i * 4 + 1] = s.strength * (k === 0 ? 1.0 : 0.55);
      a[i * 4 + 2] = Math.random();                          // seed
      a[i * 4 + 3] = k;                                     // sub-quad index (offset around the axis)
    }
    geo.setAttribute('aShaft', new THREE.InstancedBufferAttribute(a, 4));
    const len = new Float32Array(n);
    geo.setAttribute('aLen', new THREE.InstancedBufferAttribute(len, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { ...env, ...this.uniforms },
      vertexShader: /* glsl */ `
        uniform vec3 uSunDirWater;
        attribute vec4 aShaft; attribute float aLen;
        varying vec2 vUv; varying vec3 vW; varying vec4 vS;
        void main() {
          vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 axis = -uSunDirWater;
          vec3 c = base + axis * (-position.y) * aLen;
          vec3 toCam = normalize(cameraPosition - c);
          vec3 side = normalize(cross(axis, toCam));
          vec3 fwd = normalize(cross(side, axis));
          float ang = aShaft.w * 2.1;
          c += (side * cos(ang) + fwd * sin(ang)) * aShaft.x * 0.25 * step(0.5, aShaft.w);   // satellite quads offset
          float w = aShaft.x * (0.8 + 0.6 * (-position.y));                                   // widen with depth
          c += side * position.x * w * 2.6;
          vW = c; vUv = vec2(position.x + 0.5, -position.y); vS = aShaft;
          gl_Position = projectionMatrix * viewMatrix * vec4(c, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        uniform float uShaftGain;
        varying vec2 vUv; varying vec3 vW; varying vec4 vS;
        void main() {
          float e = sin(3.14159 * vUv.x); e = e * e;
          e *= 0.65 + 0.35 * t12_noise(vec2(vUv.x * 7.0 + vS.z * 13.0, vUv.y * 1.5));          // streaky, not a slab
          float fall = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y)) * (1.0 - 0.35 * vUv.y);
          float fl = 0.7 + 0.3 * sin(uTime * (0.45 + vS.z) + vS.z * 30.0);
          fl *= 0.75 + 0.25 * t12_noise(vec2(vUv.x * 4.0 + vS.z * 9.0, vUv.y * 2.0 - uTime * 0.12));
          float d = length(vW - cameraPosition);
          float near = smoothstep(1.0, 9.0, d);
          float fog = 1.0 - t12_fogCurve(d) * 0.75;
          float under = smoothstep(0.3, -0.6, cameraPosition.y - uWaterLevel);
          float look = 0.55 + 0.8 * pow(max(dot(normalize(vW - cameraPosition), uSunDirWater), 0.0), 2.0);
          float a = e * fall * fl * near * fog * under * look * vS.y * uShaftGain * 0.17;
          vec3 col = mix(uFogShallow, vec3(1.0, 0.95, 0.82), 0.62) * uSunColor;
          gl_FragColor = vec4(col * a, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 21;
    this.layout();
  }

  /** Recompute anchors from the current refracted sun so each beam lands on its target; publish light pools. */
  layout() {
    const D = env.uSunDirWater.value;                       // points up toward the sun (in water)
    const m = new THREE.Matrix4();
    const lenAttr = this.mesh.geometry.getAttribute('aLen') as THREE.InstancedBufferAttribute;
    this.specs.forEach((s, si) => {
      const depth = -s.pos.y;                              // water surface at y = 0
      const t = depth / Math.max(D.y, 0.2);
      const anchor = s.pos.clone().addScaledVector(D, t);
      anchor.y = 0;
      for (let k = 0; k < this.per; k++) {
        const i = si * this.per + k;
        m.makeTranslation(anchor.x, 0, anchor.z);
        this.mesh.setMatrixAt(i, m);
        lenAttr.setX(i, t * 1.04);
      }
      env.uPools.value[si].set(s.pos.x, s.pos.y, s.pos.z, s.radius * 1.5);
      env.uPoolStrength.value[si] = s.strength;
    });
    lenAttr.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setCount(frac: number) { this.mesh.count = Math.max(this.per, Math.round(this.specs.length * frac) * this.per); }
}
