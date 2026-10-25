import * as THREE from 'three';
import { env, ENV_GLSL } from '../core/env';
import { SKY_GLSL, skyParams } from './sky';
import { waterParams } from './water';
import { section, waveY, SECTION_N, type SectionPt } from '../game/wave';
import type { Chunk } from '../game/types';

/**
 * Shorebreak Point's wave, drawn. Per surf chunk one surface is lofted through the wave's cross-section every metre
 * (wave.ts `section`): the back, the crest, a fat lip rolling over, its underside, the face, the flats. Every vertex
 * carries two positions, the breaking wave and the unbroken swell it comes from, and the vertex shader blends them by
 * how far ahead of the rider the row is: far ahead it's a rounded shoulder, it stands up and throws its lip as you
 * come to it (the wave peels with you), and behind the break (uPeelZ) it collapses into a heaped bank of whitewater.
 * The look follows the stylised surf games (Surf World Series above all): a tall translucent face that the sun shines
 * through, brightest just under the lip, a thick white froth along the lip's leading edge with spray coming off it,
 * foam streamers falling down the face, foam at the foot and lace on the flats. Foam shapes with noise trails after
 * achrefelouafi/WaterThreeJS and the thin wave lines after thaslle/stylized-water (both MIT, ideas only).
 */
const ALONG_STEP = 1.0;
/** the unbroken swell ahead: this share of the breaking wave's height, no lip */
const SHOULDER_H = 0.72;
const UNIFORMS = { uPeelZ: { value: 1e9 }, uSurfFoam: { value: 1 } };

export class SurfWaves {
  readonly group = new THREE.Group();
  private material: THREE.ShaderMaterial;
  private meshes = new Map<number, THREE.Mesh[]>();
  /** per chunk, the curl amount per row (the lip grows into a barrel over ~10 m) */
  private curls = new Map<number, Float32Array>();

  constructor() {
    this.material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: true,
      uniforms: { ...env, ...skyParams, ...waterParams, ...UNIFORMS },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPeelZ;
        uniform vec3 uPlayerPos;
        attribute vec3 aSwell;      // the same vertex on the unbroken swell (no lip)
        attribute float aFace;      // 0 at the foot .. 1 at the crest (> 1 the back, < 0 the flats)
        attribute float aLip;       // 0 on the body .. 1 at the lip's tip
        attribute float aUnder;     // 1 under the lip (the roof of the tube)
        varying vec3 vW;
        varying vec3 vN;
        varying float vFace;
        varying float vLip;
        varying float vUnder;
        varying float vBroken;
        varying float vStand;
        void main() {
          // the wave stands up and throws its lip as you reach it: a shoulder 80 m ahead, breaking from 25 m out
          float ahead = uPlayerPos.z - position.z;
          float stand = smoothstep(80.0, 25.0, ahead);
          vec3 p = mix(aSwell, position, stand);
          // behind the break it has gone over: the lip comes down and the face heaps up into churning whitewater
          float behind = p.z - uPeelZ;
          float broken = smoothstep(0.0, 10.0, behind);
          float pitch = smoothstep(-6.0, 0.0, behind) * (1.0 - smoothstep(0.0, 8.0, behind));
          p.x += pitch * (0.6 * aLip + 0.5 * smoothstep(0.7, 1.0, min(aFace, 1.0)));
          p.y -= pitch * aLip * 1.5;
          if (broken > 0.0 && p.y > -0.2) {
            float heap = 1.6 + 0.5 * sin(p.z * 0.9 + uTime * 3.0) + 0.3 * sin(p.x * 1.7 - uTime * 2.2);
            float ff = clamp(aFace, -0.3, 1.0);
            float pile = heap * (1.0 - abs(ff - 0.45) * 1.3);
            p.y = mix(p.y, max(pile, 0.05), broken);
            p.x += broken * 1.5 * (1.0 - ff);                   // the whitewater runs on toward the shore
          }
          p.y += 0.05 * sin(uTime * 1.3 + p.z * 0.21) * step(0.0, p.y);
          vBroken = broken; vStand = stand;
          vFace = aFace; vLip = aLip; vUnder = aUnder;
          vN = normal;
          vW = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        ${SKY_GLSL}
        uniform vec3 uWaterShallow;
        uniform vec3 uWaterDeep;
        uniform float uSurfFoam;
        varying vec3 vW;
        varying vec3 vN;
        varying float vFace;
        varying float vLip;
        varying float vUnder;
        varying float vBroken;
        varying float vStand;
        void main() {
          vec3 toFrag = vW - cameraPosition;
          float dist = length(toFrag);
          vec3 vd = toFrag / dist;
          vec3 N = normalize(vN);
          if (dot(N, -vd) < 0.0) N = -N;
          // fine ripples drawing up the face
          float e = 0.15;
          vec2 q = vec2(vW.x * 1.3 - uTime * 2.2 + vW.y * 1.1, vW.z * 0.5);
          float r0 = t12_noise(q), rx = t12_noise(q + vec2(e, 0.0)), rz = t12_noise(q + vec2(0.0, e));
          N = normalize(N + vec3((rx - r0) / e * 0.06, 0.0, (rz - r0) / e * 0.04));
          float face = clamp(vFace, 0.0, 1.0);
          float hgt = clamp(vW.y / 4.6, 0.0, 1.0);
          // the body: deep at the foot, teal up the face, bright green-blue where the water is thin near the lip and
          // the sun comes through it (seen against the sun it glows)
          vec3 deep = uWaterDeep * 0.95;
          vec3 teal = mix(uWaterDeep, uWaterShallow, 0.55);
          vec3 glow = uWaterShallow * 1.15 + vec3(0.1, 0.22, 0.05);
          vec3 body = mix(deep, teal, smoothstep(0.0, 0.45, face));
          float thinness = smoothstep(0.55, 1.0, face) * 0.7 + smoothstep(0.3, 1.0, vLip) * 0.6 + vUnder * 0.5;
          float backlit = 0.35 + 0.65 * max(dot(-uSunDir, vd), 0.0);
          body = mix(body, glow, clamp(thinness, 0.0, 1.0) * (0.45 + 0.55 * backlit));
          body = mix(body, deep * 0.85, smoothstep(1.05, 1.7, vFace));                                      // the back
          // inside the tube it's dim
          body *= 1.0 - 0.3 * vUnder * (1.0 - backlit * 0.5);
          float sunL = max(dot(N, uSunDir), 0.0);
          body *= 0.72 + 0.4 * sunL;
          // the sky in the face, a glint of sun
          float cosV = max(dot(-vd, N), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
          vec3 R = reflect(vd, N); R.y = abs(R.y);
          vec3 col = mix(body, t12_sky(R) * 0.95, fres * 0.55 * (1.0 - 0.7 * max(vLip, vUnder)));
          col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 240.0) * 3.5;
          // ---- foam
          float n1 = t12_noise(vec2(vW.x * 1.4 - uTime * 1.0, vW.z * 0.4 + uTime * 0.1));
          float n2 = t12_noise(vW.xz * vec2(2.8, 1.0) + uTime * vec2(-0.6, 0.3));
          float blob = n1 * 0.6 + n2 * 0.4;
          // the froth along the lip's leading edge: thick on the nose, feathering back over the roll
          float nose = smoothstep(0.72, 1.0, vLip);
          float froth = step(0.56 - 0.3 * nose, blob) * smoothstep(0.5, 0.8, vLip) * (1.0 - vUnder * 0.7);
          froth = max(froth, step(0.28, blob) * smoothstep(0.9, 1.0, vLip) * (1.0 - vUnder * 0.5));
          // streamers of foam falling down the face from the lip (in strands along the wave, drawn down over time)
          float strand = t12_noise(vec2(vW.z * 0.9, 3.0));
          float fall = t12_noise(vec2(vW.z * 1.7, vW.y * 0.55 + uTime * 1.6));
          float streamer = step(0.62, strand) * step(0.5, fall) * smoothstep(0.25, 0.6, face) * (1.0 - vUnder) * step(vFace, 1.0) * vStand;
          // the crest line on the unbroken swell ahead (no lip yet)
          float crestLine = step(0.45, blob) * smoothstep(0.9, 0.98, face) * step(vFace, 1.0) * (1.0 - vStand) * (1.0 - vLip);
          // the foot: a broken line, blobs below it, sparse lace drifting out on the flats
          float footLine = (1.0 - smoothstep(0.0, 0.05, abs(vFace - 0.03))) * step(0.25, blob + 0.25);
          float footBlob = step(0.6, blob) * step(-0.25, vFace) * step(vFace, 0.12);
          float lace = step(0.72, t12_noise(vW.xz * vec2(0.9, 0.45) + uTime * vec2(0.25, 0.1))) * smoothstep(-0.12, -0.45, vFace);
          // whitewater behind the break
          float white = vBroken * step(0.2, blob + 0.4);
          float foam = clamp(max(max(froth, streamer), max(max(crestLine, footLine), max(max(footBlob, lace), white))) * uSurfFoam, 0.0, 1.0);
          vec3 foamCol = vec3(0.96, 0.99, 1.0) * (0.78 + 0.25 * sunL);
          col = mix(col, foamCol, foam);
          // (past the foot the wave mesh fades away: the wash is the sea's own water, one surface, not two)
          float alpha = mix(0.9, 0.98, smoothstep(0.0, 0.4, face)) * (1.0 - smoothstep(-0.02, -0.35, vFace));
          alpha = mix(alpha, 0.72, clamp(thinness - 0.6, 0.0, 1.0) * 0.6);
          alpha = max(alpha, foam * (1.0 - smoothstep(-0.3, -0.9, vFace)));
          float aFog = 1.0 - exp(-uHazeDensity * dist);
          col = mix(col, t12_hazeTint(vd), aFog);
          if (alpha < 0.03) discard;                 // (the faded flats must not write depth: that hid the sea under them and showed the sand)
          gl_FragColor = vec4(col, alpha);
        }`,
    });
  }

  /** build the wave for a surf chunk as it spawns */
  build(c: Chunk) {
    const w = c.wave;
    if (!w || this.meshes.has(c.id)) return;
    const rows = Math.ceil(c.length / ALONG_STEP) + 1;
    // curl per row: a rolling lip on a standard wave, more on a bigger one, a full barrel inside a tube (eased in and
    // out over ~10 m so the lip grows rather than jumps)
    const curl = new Float32Array(rows);
    const inTube = new Float32Array(rows);
    for (let j = 0; j < rows; j++) { const a = Math.min(c.length, j * ALONG_STEP); inTube[j] = w.tube && w.tube(a) ? 1 : 0; }
    for (let j = 0; j < rows; j++) {
      const a = Math.min(c.length, j * ALONG_STEP), H = w.h(a);
      let t = 0;
      for (let k = -10; k <= 10; k++) { const jj = Math.min(rows - 1, Math.max(0, j + k)); t = Math.max(t, inTube[jj] * (1 - Math.abs(k) / 11)); }
      const base = 0.45 + 0.3 * Math.max(0, Math.min(1, (H - 4.2) / 1.6));
      curl[j] = base + (1 - base) * t;
    }
    this.curls.set(c.id, curl);
    const out: THREE.Mesh[] = [this.loft(c, rows, curl)];
    if (w.tube) { const t = this.curtain(c, rows, curl); if (t) out.push(t); }
    for (const m of out) this.group.add(m);
    this.meshes.set(c.id, out);
  }

  release(c: Chunk) {
    const ms = this.meshes.get(c.id);
    if (!ms) return;
    for (const m of ms) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes.delete(c.id); this.curls.delete(c.id);
  }

  clear() { for (const id of [...this.meshes.keys()]) { const ms = this.meshes.get(id)!; for (const m of ms) { this.group.remove(m); m.geometry.dispose(); } this.meshes.delete(id); this.curls.delete(id); } }

  update(peelZ: number, foam = 1) { UNIFORMS.uPeelZ.value = peelZ; UNIFORMS.uSurfFoam.value = foam; }

  /** the curl amount at a chunk-local along (for spray off the lip) */
  curlAt(c: Chunk, along: number) { const k = this.curls.get(c.id); return k ? k[Math.min(k.length - 1, Math.max(0, Math.round(along / ALONG_STEP)))] : 0.3; }

  private mesh(rows: number, cols: number, pos: Float32Array, swell: Float32Array, face: Float32Array, lip: Float32Array, under: Float32Array) {
    const idx: number[] = [];
    for (let j = 0; j + 1 < rows; j++) for (let i = 0; i + 1 < cols; i++) {
      const a = j * cols + i, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSwell', new THREE.BufferAttribute(swell, 3));
    g.setAttribute('aFace', new THREE.BufferAttribute(face, 1));
    g.setAttribute('aLip', new THREE.BufferAttribute(lip, 1));
    g.setAttribute('aUnder', new THREE.BufferAttribute(under, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.material);
    m.frustumCulled = false; m.renderOrder = 9;
    return m;
  }

  /** the wave: the cross-section lofted along the chunk, with the unbroken swell it stands up from beside it */
  private loft(c: Chunk, rows: number, curl: Float32Array) {
    const w = c.wave!, cols = SECTION_N;
    const n = rows * cols;
    const pos = new Float32Array(n * 3), swell = new Float32Array(n * 3), face = new Float32Array(n), lip = new Float32Array(n), under = new Float32Array(n);
    const sec: SectionPt[] = [], sw: SectionPt[] = [];
    for (let j = 0; j < rows; j++) {
      const a = Math.min(c.length, j * ALONG_STEP), z = c.zStart - a;
      section(w, a, curl[j], sec);
      section(w, a, 0, sw, SHOULDER_H);
      for (let i = 0; i < cols; i++) {
        const p = sec[i], q = sw[i], k = j * cols + i;
        pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = z;
        swell[k * 3] = q.x; swell[k * 3 + 1] = q.y; swell[k * 3 + 2] = z;
        face[k] = p.face; lip[k] = p.lip; under[k] = p.under;
      }
    }
    return this.mesh(rows, cols, pos, swell, face, lip, under);
  }

  /** the curtain of a barrel: from the lip's tip down onto the face where the tube's opening ends */
  private curtain(c: Chunk, rows: number, curl: Float32Array) {
    const w = c.wave!, N = 10;
    const js: number[] = [];
    for (let j = 0; j < rows; j++) if (w.tube!(Math.min(c.length, j * ALONG_STEP))) js.push(j);
    if (js.length < 2) return null;
    const n = js.length * (N + 1);
    const pos = new Float32Array(n * 3), swell = new Float32Array(n * 3), face = new Float32Array(n), lip = new Float32Array(n), under = new Float32Array(n);
    const T0 = Math.min(c.length, js[0] * ALONG_STEP), CO = w.closeout ?? Math.min(c.length, js[js.length - 1] * ALONG_STEP);
    const sec: SectionPt[] = [];
    js.forEach((j, r) => {
      const a = Math.min(c.length, j * ALONG_STEP), t = w.tube!(a)!, z = c.zStart - a;
      section(w, a, curl[j], sec);
      const tip = sec.reduce((p, q) => (q.lip >= p.lip ? q : p));
      // grows in at the start, collapses onto the face at the closeout
      const open = Math.min(1, (a - T0) / 8) * (1 - Math.max(0, Math.min(1, (a - (CO - 12)) / 12)));
      const lx = t.lo + 0.4, ly = waveY(w, lx, a) + 0.05;
      const ex = lx + (tip.x - lx) * (1 - open), ey = ly + (tip.y - ly) * (1 - open) * 0.6;
      for (let s = 0; s <= N; s++) {
        const u = s / N, k = r * (N + 1) + s;
        const x = tip.x + (ex - tip.x) * u, y = tip.y + (ey - tip.y) * (u * u * 0.6 + u * 0.4);
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        swell[k * 3] = x; swell[k * 3 + 1] = y; swell[k * 3 + 2] = z;
        face[k] = 0.95; lip[k] = 1 - u * 0.6; under[k] = 0.6;
      }
    });
    return this.mesh(js.length, N + 1, pos, swell, face, lip, under);
  }
}
