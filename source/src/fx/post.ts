import * as THREE from 'three';

/**
 * Minimal HDR post pipeline written for this project:
 *   scene -> HalfFloat target (optional MSAA)
 *   bloom: prefilter (threshold) -> 5-level downsample chain -> tent upsample
 *   final: bloom add, exposure, ACES fit, grade, vignette, underwater wobble, waterline split, sRGB
 */
export const postParams = {
  exposure: 1.0,
  bloomStrength: 0.55,
  bloomThreshold: 1.0,
  bloomRadius: 0.85,
  saturation: 1.12,
  contrast: 1.06,
  vignette: 0.32,
  bloomEnabled: true,
};

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function fsMaterial(frag: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

export class Post {
  private scene: THREE.WebGLRenderTarget;
  private mips: THREE.WebGLRenderTarget[] = [];
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private prefilter: THREE.ShaderMaterial;
  private down: THREE.ShaderMaterial;
  private up: THREE.ShaderMaterial;
  private final: THREE.ShaderMaterial;
  private samples: number;
  readonly levels = 5;

  constructor(private renderer: THREE.WebGLRenderer, samples: number) {
    this.samples = samples;
    this.scene = this.makeTarget(1, 1, samples, true);
    for (let i = 0; i < this.levels; i++) this.mips.push(this.makeTarget(1, 1, 0, false));
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.prefilter = fsMaterial(/* glsl */ `
      uniform sampler2D tSrc; uniform float uThreshold; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
               + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        c *= 0.25;
        float br = max(c.r, max(c.g, c.b));
        float knee = uThreshold * 0.5;
        float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
        soft = soft * soft / (4.0 * knee + 1e-4);
        float w = max(soft, br - uThreshold) / max(br, 1e-4);
        gl_FragColor = vec4(min(c * w, vec3(40.0)), 1.0);
      }`, { tSrc: { value: null }, uThreshold: { value: 1 }, uTexel: { value: new THREE.Vector2() } });

    this.down = fsMaterial(/* glsl */ `
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(c / 8.0, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });

    this.up = fsMaterial(/* glsl */ `
      uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
      void main() {
        vec2 o = uTexel * uRadius;
        vec3 c = texture2D(tSrc, vUv + vec2(-o.x, 0.0)).rgb * 2.0 + texture2D(tSrc, vUv + vec2(o.x, 0.0)).rgb * 2.0;
        c += texture2D(tSrc, vUv + vec2(0.0, -o.y)).rgb * 2.0 + texture2D(tSrc, vUv + vec2(0.0, o.y)).rgb * 2.0;
        c += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb;
        c += texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb;
        gl_FragColor = vec4(c / 12.0, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });
    this.up.blending = THREE.AdditiveBlending;
    this.up.transparent = true;

    this.final = fsMaterial(/* glsl */ `
      uniform sampler2D tScene; uniform sampler2D tBloom;
      uniform float uBloom; uniform float uExposure; uniform float uSat; uniform float uContrast; uniform float uVignette;
      uniform float uUnder; uniform float uTime; uniform float uNearSurface;
      uniform mat4 uInvViewProj; uniform float uWaterY; uniform vec2 uRes;
      varying vec2 vUv;
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      float h12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() {
        // per-pixel: is the near-plane point of this pixel below the waves? (waterline split)
        float sub = uUnder;
        float line = 0.0;
        if (uNearSurface > 0.0) {
          vec4 nw = uInvViewProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
          nw /= nw.w;
          float wy = uWaterY + 0.05 * sin(nw.x * 2.5 + uTime * 2.0) + 0.03 * sin(nw.z * 3.1 - uTime * 1.6);
          float dy = nw.y - wy;
          sub = mix(uUnder, smoothstep(0.004, -0.004, dy), uNearSurface);
          line = smoothstep(0.012, 0.0, abs(dy)) * uNearSurface;
        }
        vec2 uv = vUv;
        uv += sub * vec2(sin(uv.y * 22.0 + uTime * 1.3), cos(uv.x * 18.0 + uTime * 1.1)) * 0.0016;
        vec3 c = texture2D(tScene, uv).rgb;
        c += texture2D(tBloom, uv).rgb * uBloom;
        c *= uExposure;
        c = aces(c);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat + sub * 0.05);
        c = (c - 0.5) * (uContrast - sub * 0.04) + 0.5;
        // underwater grade: lift shadows toward teal, keep highlights clean
        c = mix(c, c * vec3(0.92, 1.02, 1.04) + vec3(0.0, 0.015, 0.03) * (1.0 - l), sub);
        vec2 q = vUv - 0.5;
        float vig = 1.0 - dot(q, q) * (uVignette + sub * 0.25) * 2.2;
        c *= vig;
        c = mix(c, c * 0.55 + vec3(0.75, 0.9, 1.0) * 0.35, line);
        c = toSRGB(clamp(c, 0.0, 1.0));
        c += (h12(vUv * uRes + fract(uTime)) - 0.5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
      }`, {
      tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.5 }, uExposure: { value: 1 }, uSat: { value: 1 },
      uContrast: { value: 1 }, uVignette: { value: 0.3 }, uUnder: { value: 0 }, uTime: { value: 0 }, uNearSurface: { value: 0 },
      uInvViewProj: { value: new THREE.Matrix4() }, uWaterY: { value: 0 }, uRes: { value: new THREE.Vector2() },
    });
  }

  private makeTarget(w: number, h: number, samples: number, depth: boolean) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples, depthBuffer: depth,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
  }

  setSamples(samples: number) {
    if (samples === this.samples) return;
    this.samples = samples;
    const { width, height } = this.scene;
    this.scene.dispose();
    this.scene = this.makeTarget(width, height, samples, true);
  }

  setSize(w: number, h: number) {
    this.scene.setSize(w, h);
    let mw = Math.max(1, w >> 1), mh = Math.max(1, h >> 1);
    for (const m of this.mips) { m.setSize(mw, mh); mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); }
    (this.final.uniforms.uRes.value as THREE.Vector2).set(w, h);
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null, clear = true) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    if (clear) this.renderer.clear();
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, info: { under: number; nearSurface: number; waterY: number; time: number }) {
    const r = this.renderer;
    r.setRenderTarget(this.scene);
    r.clear();
    r.render(scene, camera);

    const bloomOn = postParams.bloomEnabled && postParams.bloomStrength > 0.001;
    if (bloomOn) {
      const pf = this.prefilter.uniforms;
      pf.tSrc.value = this.scene.texture;
      pf.uThreshold.value = postParams.bloomThreshold;
      (pf.uTexel.value as THREE.Vector2).set(1 / this.scene.width, 1 / this.scene.height);
      this.pass(this.prefilter, this.mips[0]);
      for (let i = 1; i < this.levels; i++) {
        this.down.uniforms.tSrc.value = this.mips[i - 1].texture;
        (this.down.uniforms.uTexel.value as THREE.Vector2).set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height);
        this.pass(this.down, this.mips[i]);
      }
      for (let i = this.levels - 1; i > 0; i--) {
        this.up.uniforms.tSrc.value = this.mips[i].texture;
        (this.up.uniforms.uTexel.value as THREE.Vector2).set(1 / this.mips[i].width, 1 / this.mips[i].height);
        this.up.uniforms.uRadius.value = postParams.bloomRadius * 1.5;
        this.pass(this.up, this.mips[i - 1], false);
      }
    }

    const f = this.final.uniforms;
    f.tScene.value = this.scene.texture;
    f.tBloom.value = this.mips[0].texture;
    f.uBloom.value = bloomOn ? postParams.bloomStrength : 0;
    f.uExposure.value = postParams.exposure;
    f.uSat.value = postParams.saturation;
    f.uContrast.value = postParams.contrast;
    f.uVignette.value = postParams.vignette;
    f.uUnder.value = info.under;
    f.uNearSurface.value = info.nearSurface;
    f.uWaterY.value = info.waterY;
    f.uTime.value = info.time;
    (f.uInvViewProj.value as THREE.Matrix4).multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    this.pass(this.final, null);
  }
}
