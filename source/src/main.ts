import * as THREE from 'three';
import { env, setSun, patchMaterial } from './core/env';
import { setProgressHandler } from './core/assets';
import { createSky } from './world/sky';
import { createWater, waveHeight, waterParams } from './world/water';
import { createMaterials, createSwayMaterial, createFamilyMaterials } from './world/materials';
import { GodRays } from './fx/godrays';
import { createMarineSnow } from './fx/snow';
import { Post, postParams } from './fx/post';
import { AdaptiveQuality, LEVELS, type QualityLevel } from './systems/quality';
import { Hud } from './ui/hud';
import { GameAudio } from './systems/gameaudio';
import { ChunkManager } from './game/chunks';
import { CourseGenerator, CAMERA_SPACING } from './game/generator';
import { isDemoSeed, DEMO_COURSE, DEMO_PACE } from './game/demo';
import { Runner } from './game/runner';
import { Character } from './game/character';
import { Pet } from './game/pet';
import { DogCharacter } from './game/dogchar';
import { HUMAN_BODY, DOG_BODY } from './game/runner';
import { Wake } from './fx/wake';
import { waveY, lipTip } from './game/wave';
import { ChaseCam } from './game/chasecam';
import { TideManager } from './game/tide';
import { Scoring } from './game/scoring';
import { Keyboard, SimInput, emptyInput } from './game/input';
import { HandTracker, HAND_SETTINGS } from './game/hand';
import { Menus } from './ui/menus';
import { GameHud } from './ui/gamehud';
import { Atmosphere } from './world/atmos';
import { ShieldBubble } from './fx/shield';
import { Critters } from './game/critters';
import { Wildlife } from './game/wildlife';
import { Fauna } from './world/fauna';
import { ShoreLife } from './game/shorelife';
import { ReefLife } from './game/reeflife';
import { Kraken } from './game/kraken';
import { Dust, PUFF } from './fx/dust';
import { Ripples } from './fx/ripples';
import { Rainbow } from './fx/rainbow';
import { Rain } from './fx/rain';
import { WaveWipe } from './ui/wipe';
import { randomSeed } from './core/rng';
import { noise, smooth } from './game/patterns/lib';
import type { GroundPaint } from './world/ground';
import type { Biome, Chunk } from './game/types';

/**
 * The 12th Tide: game shell. Owns the renderer, the world systems and the state machine
 * (title -> setup -> playing <-> paused / handlost -> dead -> title / playing).
 */
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const loadbar = document.getElementById('loadbar')!;
setProgressHandler((f) => (loadbar.style.width = `${Math.round(f * 100)}%`));
if (params.get('clean') === '1') document.body.classList.add('clean');
if (params.get('debug') === '1') document.body.classList.add('debug');

type State = 'title' | 'setup' | 'playing' | 'paused' | 'handlost' | 'dead';
const BIOME_NAME: Record<Biome, string> = { beach: 'Sunbreaker Beach', pier: 'Broken Pier', lagoon: 'Tidal Lagoon', coral: 'Coral Canyon', grotto: 'Shipwreck Grotto', surf: 'Shorebreak Point', ski: 'Bolivar Channel' };

// ---------------------------------------------------------------- renderer, scene, lights
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
const SUN_I = 2.05;
const sun = new THREE.DirectionalLight(new THREE.Color('#ffe8c8'), SUN_I);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 220;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(new THREE.Color('#9fd6f5'), new THREE.Color('#e0c49a'), 0.95);
scene.add(hemi);
setSun(46, -38);                 // afternoon sun from the sea side, slightly ahead-left so beams rake across the lane
env.uSunColor.value.copy(sun.color);
env.uHazeDensity.value = 0.0009;

// ---------------------------------------------------------------- ground paint
const C = {
  dry: new THREE.Color('#D8BD8A'), dryHi: new THREE.Color('#E6D1A4'), wet: new THREE.Color('#B89C72'), sub: new THREE.Color('#D0C095'), deep: new THREE.Color('#A89F80'),
  grass: new THREE.Color('#9DB06A'), grassDark: new THREE.Color('#6F8C45'), reef: new THREE.Color('#DCD0AC'), reefDark: new THREE.Color('#8F9280'), rim: new THREE.Color('#8E9AA8'), cave: new THREE.Color('#4A5262'), caveGlow: new THREE.Color('#2f7f86'), pierBed: new THREE.Color('#C4BA98'),
};
const tmpA = new THREE.Color(), tmpB = new THREE.Color(), tmpG = new THREE.Color();
function biomeColor(b: Biome, x: number, z: number, h: number, out: THREE.Color) {
  const n = noise(x * 0.35, z * 0.35), n2 = noise(x * 1.3 + 7, z * 1.3);
  if (b === 'beach' || b === 'surf' || b === 'ski') {
    if (h > 0.2) {
      out.copy(C.dry).lerp(C.dryHi, smooth(0.2, 3.5, h));
      // sand gives way to grass over the dunes; the hills are green, darker in the hollows and higher up
      const g = smooth(2.6, 4.6, h + n * 1.4);
      if (g > 0) out.lerp(tmpG.copy(C.grass).lerp(C.grassDark, smooth(-0.2, 0.6, n2 + n * 0.5) * 0.7 + smooth(8, 20, h) * 0.3), g);
    }
    else if (h > -0.5) out.copy(C.wet).lerp(C.dry, smooth(-0.5, 0.2, h));
    else out.copy(C.sub).lerp(C.deep, smooth(-0.5, -6, h));
    out.offsetHSL(0, 0, n2 * 0.012);
  } else if (b === 'pier') { out.copy(C.pierBed).lerp(C.deep, smooth(-2, -8, h)); }
  else if (b === 'lagoon') { if (h > -0.05) out.copy(C.dry); else out.copy(C.sub).lerp(C.wet, smooth(-0.05, -1.2, h)); out.offsetHSL(0, 0, n2 * 0.015); }
  else if (b === 'coral') { out.copy(C.reef); if (n > 0.35) out.lerp(C.reefDark, smooth(0.35, 0.7, n)); if (Math.abs(x) > 20) out.lerp(C.rim, smooth(20, 26, Math.abs(x))); out.offsetHSL(0, 0, n2 * 0.02); }
  else { out.copy(C.cave); if (n > 0.55) out.lerp(C.caveGlow, smooth(0.55, 0.85, n) * 0.7); if (Math.abs(x) > 9) out.lerp(C.rim, smooth(9, 13, Math.abs(x)) * 0.6); }
}
const paintFor = (chunk: Chunk): GroundPaint => (x, along, h, out) => {
  const z = chunk.zStart - along;
  biomeColor(chunk.biome, x, z, h, tmpA);
  if (chunk.toBiome !== chunk.biome) { biomeColor(chunk.toBiome, x, z, h, tmpB); tmpA.lerp(tmpB, smooth(0.25, 0.85, along / chunk.length)); }
  out.copy(tmpA);
};

async function build() {
  const M = createMaterials();
  const familyMat = createFamilyMaterials(M);
  const kelp = createSwayMaterial(10, 0.16, 0.55), seagrass = createSwayMaterial(1.0, 0.28, 0.9), dune = createSwayMaterial(1.4, 0.2, 0.8, true);
  const jelly = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.78, roughness: 0.3, emissive: new THREE.Color('#ff9fd0'), emissiveIntensity: 0.35, side: THREE.DoubleSide, depthWrite: false }), { caustics: false, fogScale: 0.9 });
  const island = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), { caustics: false, fogScale: 1 });
  const materialFor = (family: string, kit: string, gltf: THREE.Material | null): THREE.Material => {
    switch (family) {
      case 'rock': return M.rock; case 'arch': return M.arch; case 'coral': return M.coral; case 'kelp': return kelp; case 'seagrass': return seagrass; case 'grass': return dune;
      case 'palm': return M.palm; case 'glow': return M.glow; case 'flag': return M.flag; case 'jelly': return jelly; case 'island': return island; case 'terrain': return M.terrain;
      case 'grassTex': case 'foliage': case 'palmTex': return familyMat(family, gltf, kit);
      default: return M.structure;
    }
  };

  scene.add(createSky());
  const water = createWater();
  scene.add(water);
  const chunks = new ChunkManager(materialFor, M.terrain, paintFor);
  await chunks.load();
  scene.add(chunks.group);
  const rays = new GodRays(70); scene.add(rays.mesh);
  const snow = createMarineSnow(2600); scene.add(snow);
  const shield = new ShieldBubble(); scene.add(shield.mesh);
  const critters = new Critters(M.structure); await critters.load(); scene.add(critters.group);
  const wildlife = new Wildlife(M.structure, chunks.streams); await wildlife.load(); scene.add(wildlife.group);

  const fauna = new Fauna(chunks); await fauna.load(); scene.add(fauna.group);
  const dust = new Dust(); scene.add(dust.points);
  const ripples = new Ripples(); scene.add(ripples.group);
  const shore = new ShoreLife(M.structure, chunks.streams, dust, ripples); await shore.load(); scene.add(shore.group);
  const reef = new ReefLife(M.structure, dust); await reef.load(); scene.add(reef.group);
  const kraken = new Kraken(dust); await kraken.load(); scene.add(kraken.group);
  const rain = new Rain(); scene.add(rain.mesh);
  const sprayBow = new Rainbow(false), skyBow = new Rainbow(true); scene.add(sprayBow.mesh, skyBow.mesh);
  const wipe = new WaveWipe();

  // ---------------------------------------------------------------- game objects
  const runner = new Runner();
  // the player: the runner, or Reveille (the land-only option), with the other one as the companion
  const runnerChar = new Character(); scene.add(runnerChar.root);
  const dogChar = new DogCharacter(); scene.add(dogChar.root);
  const petDog = new Pet(); scene.add(petDog.root);
  let character: Character | DogCharacter = runnerChar;
  let pet: Pet = petDog;
  let dogMode = false;
  const pickCharacter = () => {
    dogMode = menus.settings.character === 'reveille';
    character = dogMode ? dogChar : runnerChar; pet = petDog;                     // (as Reveille she runs alone)
    runnerChar.root.visible = !dogMode; dogChar.root.visible = dogMode;
    petDog.reset();
    runner.frame = { ...(dogMode ? DOG_BODY : HUMAN_BODY) };
  };
  const wake = new Wake(); scene.add(wake.mesh);
  const cam = new ChaseCam(camera);
  const tide = new TideManager();
  const scoring = new Scoring();
  const audio = new GameAudio();
  // (a gull diving at you: Reveille sees it too)
  critters.onGull = () => { audio.gull(); setTimeout(() => pet.alert(), 350); }; critters.onShark = () => audio.shark();
  critters.onCannon = (x, y, z) => { audio.cannon(); chunks.streams.burst(x, y, z, 26, 3.2, 1.6); };
  wildlife.onFlutter = () => audio.flutter(); wildlife.onSquawk = () => audio.gull(); wildlife.onSplash = (k) => audio.splash(k);
  petDog.onBark = () => audio.bark();
  shore.onFlutter = () => audio.flutter(12); shore.onSplash = (k) => audio.splash(k);
  const keyboard = new Keyboard();
  const sim = new SimInput(); let simActive = false;
  const hand = new HandTracker();
  const menus = new Menus();
  const hud = new GameHud();
  const atmos = new Atmosphere(hemi, sun, SUN_I);
  const devHud = new Hud();
  chunks.waterY = () => tide.level;
  if (!params.has('shot') && params.get('mute') !== '1') audio.armOnGesture();
  if (params.get('audio') === '1') (audio as unknown as { start: () => void }).start();      // tests: start without a gesture

  // ---------------------------------------------------------------- quality / post / resize
  const post = new Post(renderer, 4);
  let level: QualityLevel = LEVELS[2];
  const resize = () => {
    const base = Math.min(devicePixelRatio, 1.5);
    renderer.setPixelRatio(base * level.renderScale);
    renderer.setSize(innerWidth, innerHeight, false);
    const v = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.setSize(v.x, v.y);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    (snow.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = renderer.getPixelRatio();
    chunks.streams.setPixelRatio(renderer.getPixelRatio());
    dust.setPixelRatio(renderer.getPixelRatio());
  };
  const quality = new AdaptiveQuality((l) => {
    const shadowsChanged = l.shadows !== level.shadows;
    level = l;
    sun.castShadow = l.shadows;
    if (sun.shadow.mapSize.x !== l.shadowSize) { sun.shadow.mapSize.set(l.shadowSize, l.shadowSize); sun.shadow.map?.dispose(); sun.shadow.map = null as never; }
    if (shadowsChanged) scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    post.setSamples(l.msaa);
    postParams.bloomEnabled = l.bloom;
    rays.setCount(l.rays);
    snow.geometry.setDrawRange(0, Math.floor(2600 * l.snow));
    fauna.setActiveFraction(l.fish);
    resize();
  });
  const applyQualitySetting = (q: string) => {
    if (q === 'auto') { quality.auto = true; quality.set(2); }
    else { quality.auto = false; quality.set(Math.max(0, LEVELS.findIndex((l) => l.name.toLowerCase() === q))); }
  };
  const qp = params.get('quality');
  applyQualitySetting(qp ? qp.toLowerCase() : menus.settings.quality);
  addEventListener('resize', resize);

  // ---------------------------------------------------------------- state machine
  let state: State = 'title';
  let handActive = false;
  let seed = '';
  let deathCause = 'WASHED OUT';
  let hintShown = false;
  let lastBiome: string | null = null;
  let strideT = 0;
  let gameT = 0; let bubbleT = 0;
  let riding = false;
  let nearGlow = 0;
  // the feel of the big moments: a freeze-frame on a hit, slow motion at the top of a launch off the lip
  let slow = 1, hitStop = 0, apexT = 0, prevVy = 0;
  let shakeDropsT = 0, siltT = 0, pawDist = 0, lightningT = 0, demoShieldT = 0;
  const lastPaw = new THREE.Vector3(), tmpV = new THREE.Vector3();
  const underwater = () => runner.mode === 'swim';

  const applySettings = () => {
    if (state === 'title') pickCharacter();
    audio.setVolume(menus.settings.volume); audio.setMuted(menus.settings.muted);
    if (!qp) applyQualitySetting(menus.settings.quality);
  };
  menus.onSettings = applySettings;
  menus.onClick = () => audio.click();
  menus.attachHand(hand);
  hand.mode = menus.settings.control;
  if (params.get('who') === 'reveille' || params.get('who') === 'runner') menus.settings.character = params.get('who') as 'reveille' | 'runner';   // (tests)
  menus.onControl = (m) => hand.setMode(m);
  menus.onStartCamera = () => hand.start();
  // the title's camera button opens setup inside the menus: without this the setup screen never updated (stuck on
  // 'requesting camera', start button disabled) even though the camera was already tracking
  menus.onSetupOpen = () => { state = 'setup'; };
  menus.onRecalibrate = () => hand.recalibrate();
  menus.setBest(scoring.best, scoring.bestDistance);

  const previewSeed = () => (params.get('seed') ?? menus.settings.seed) || randomSeed();

  function loadCourse(s: string, withTutorial = false, spacing = 1) {
    seed = s;
    // (seed DEMO: the set demo course, see demo.ts; as Reveille the course keeps to the land)
    const demo = isDemoSeed(seed);
    runner.pace = demo ? DEMO_PACE : 1;
    chunks.reset(new CourseGenerator(seed, false, withTutorial, spacing, demo ? 'demo' : null, dogMode, demo ? DEMO_PACE : 1));
    runner.reset(-2);
    tide.reset();
    character.update(0, 0, runner);
    chunks.update(runner.pos.z, true);
    if (dogMode) chunks.releaseCollie();                            // (she's the player: not sitting on the steps)
  }

  function toTitle() {
    state = 'title';
    pickCharacter();
    pet.reset();
    loadCourse(previewSeed());
    menus.show('title'); hud.show(false);
    menus.setBest(scoring.best, scoring.bestDistance);
    audio.setIntensity(0);
    hand.simulated = false;
  }

  /** A run starts behind the wave: it washes in over the screen first, the run is set up while the screen is covered
   *  (which also hides the moment it takes to build the course), and the wave washes out to reveal it. A second press
   *  while it's washing in is ignored. `instant`: no wave (the test tools' handle). */
  let starting = false;
  const WIPE_MS = 900;
  function startRun(withCamera: boolean, forceTutorial = false, instant = false) {
    if (starting) return;
    handActive = withCamera && hand.status !== 'off' && hand.status !== 'error';
    if (withCamera && !handActive) { menus.show('setup'); state = 'setup'; return; }
    if (!withCamera && hand.status !== 'off') hand.stop();
    if (instant) { beginRun(forceTutorial); return; }
    starting = true;
    if (state === 'playing') state = 'paused';            // (a restart mid-run: everything holds still under the wave)
    wipe.wash(WIPE_MS, () => { starting = false; beginRun(forceTutorial); });
  }
  function beginRun(forceTutorial: boolean) {
    pickCharacter();
    tutorial = forceTutorial || (!tutorialSeen() && !isDemoSeed(previewSeed()));
    tutorI = 0; tutorShown = -1; tutorNice = 0; timeScale = 1; hud.coach(null);
    critters.reset(); wildlife.reset(); pet.reset(); wake.reset(); shore.reset(); reef.reset(); kraken.reset();
    sprayBow.hide(); skyBow.hide(); rain.amount = 0; slow = 1; hitStop = 0; apexT = 0;
    // (with a camera the obstacles get a little more room: a lean, slip or flick takes longer than a key press)
    loadCourse(previewSeed(), tutorial, handActive ? CAMERA_SPACING : 1);
    scoring.reset();
    lastBiome = null;
    shield.restore(true);
    state = 'playing';
    gameT = 0; strideT = 0;
    menus.show('none'); hud.show(true);
    cam.snap(runner);
    if (!hintShown && !tutorial) {
      hintShown = true;
      hud.hint(!handActive ? 'A / D lanes   ·   Space jump   ·   S slide   ·   Shift surge'
        : hand.mode === 'head' ? 'slip your head left · right: one lane each   ·   bob up to jump   ·   duck to slide   ·   both hands up to surge'
        : hand.mode === 'body' ? 'lean or step left · right for a lane   ·   hop to jump   ·   duck to slide   ·   both hands up to surge'
          : 'hand left · centre · right picks a lane   ·   raise to jump   ·   drop to slide   ·   fist to surge');
    }
    audio.setIntensity(0.1);
  }

  // ---------------------------------------------------------------- first-run tutorial
  // One row per move (change lanes, jump, slide, back to the middle). Each prompt appears ~24 m before its row; if the
  // move hasn't been made, the game slows to a near stop at the row and waits. Hits don't count while learning.
  const TUTOR_KEY = 't12_tutorial_done';
  // ?tutorial=0 skips it (tests, demos)
  const tutorialSeen = () => { if (params.get('tutorial') === '0') return true; try { return localStorage.getItem(TUTOR_KEY) === '1'; } catch { return false; } };
  let tutorial = false, tutorI = 0, tutorShown = -1, tutorNice = 0, timeScale = 1;
  const tutorDid = { jump: false, slide: false };
  function tutorPrompt(step: 'lane' | 'jump' | 'slide', laneIdx = 1): [string, string] {
    const body = hand.mode === 'body', head = hand.mode === 'head';
    if (step === 'jump') return handActive ? [body ? 'HOP!' : head ? 'BOB UP!' : 'RAISE YOUR HAND', body ? 'jump (or bob up) to clear the log' : head ? 'a quick head bob up clears the log' : 'to jump the log'] : ['PRESS SPACE', 'to jump the log   (or W / ↑)'];
    if (step === 'slide') return handActive ? [body || head ? 'DUCK!' : 'DROP YOUR HAND', 'to slide under the net'] : ['PRESS S', 'to slide under the net   (or ↓)'];
    const left = laneIdx < runner.lane;
    if (handActive && head) return [left ? 'SLIP LEFT' : 'SLIP RIGHT', `a quick head move ${left ? 'left' : 'right'}: one lane   (coming back does nothing)`];
    if (handActive && body) return [laneIdx === 1 ? 'BACK TO THE MIDDLE' : left ? 'LEAN LEFT' : 'LEAN RIGHT', laneIdx === 1 ? 'stand up straight in the middle' : 'or step left / right into the open lane'];
    if (handActive) return [left ? 'MOVE YOUR HAND LEFT' : 'MOVE YOUR HAND RIGHT', laneIdx === 1 ? 'back to the middle lane' : 'into the open lane'];
    return [left ? 'PRESS A' : 'PRESS D', `${left ? '(or ←)' : '(or →)'}   ${laneIdx === 1 ? 'back to the middle lane' : 'into the open lane'}`];
  }
  function updateTutorial(dt: number) {
    const ch = chunks.chunks.find((c) => c.tutorial);
    const steps = ch?.tutorial;
    if (!ch || !steps || tutorI >= steps.length) { endTutorial(); return; }
    runner.invuln = Math.max(runner.invuln, 0.3);
    const st = steps[tutorI];
    const dist = runner.pos.z - (ch.zStart - st.along);
    if (tutorNice > 0) { tutorNice -= dt; if (tutorNice <= 0) hud.coach(null); }
    if (dist < 24 && tutorShown !== tutorI) {
      tutorShown = tutorI; tutorDid.jump = tutorDid.slide = false;
      if (st.step === 'lane' && runner.lane === st.lane) { tutorI++; return; }          // already there
      const [t, sub] = tutorPrompt(st.step, st.lane); hud.coach(t, sub); tutorNice = 0;
    }
    let want = 1;
    if (tutorShown === tutorI) {
      const done = st.step === 'lane' ? runner.lane === st.lane : st.step === 'jump' ? tutorDid.jump : tutorDid.slide;
      if (done) { hud.coach('NICE!', '', true); tutorNice = 0.8; tutorI++; }
      else if (dist < -1.5) { hud.coach(null); tutorI++; }                                // went past it
      else { if (st.step === 'lane') { const [t, sub] = tutorPrompt(st.step, st.lane); hud.coach(t, sub); } if (dist < 10) want = 0.06; }
    }
    timeScale += (want - timeScale) * (1 - Math.exp(-dt / (want < 1 ? 0.15 : 0.08)));
  }
  function endTutorial() {
    if (!tutorial) return;
    tutorial = false; timeScale = 1;
    try { localStorage.setItem(TUTOR_KEY, '1'); } catch { /* storage blocked: it will show again next time */ }
    hud.coach("YOU'RE READY!", 'grab coins · thread the reef gates · survive the 12th Tide', true);
    setTimeout(() => hud.coach(null), 2200);
  }
  menus.onTutorial = () => startRun(hand.status === 'tracking' || hand.status === 'lost', true);

  function die(cause: string) {
    if (state !== 'playing') return;
    state = 'dead'; deathCause = cause;
    audio.hit(true); audio.gameOver(); cam.shake(0.5);
    hud.flash('red');
    setTimeout(() => { if (state === 'dead') wipe.wash(1300); }, 450);
    const newBest = scoring.finish();
    setTimeout(() => {
      if (state !== 'dead') return;
      menus.gameOver({ score: scoring.score, best: scoring.best, newBest, distance: scoring.distance, maxMult: scoring.stats.maxMult, nearMisses: scoring.stats.nearMisses, pearls: scoring.stats.pearls, tides: scoring.stats.tides, risky: scoring.stats.risky, cause });
      hud.show(false);
    }, 1100);
  }

  function pause(kind: 'paused' | 'handlost') { if (state !== 'playing') return; state = kind; menus.show(kind === 'paused' ? 'pause' : 'handlost'); audio.setUnder(0.5); }
  function resume() { if (state !== 'paused' && state !== 'handlost') return; state = 'playing'; menus.show('none'); }

  menus.onPlay = (cam) => startRun(cam);
  menus.onResume = resume;
  menus.onRestart = () => startRun(handActive);
  menus.onMenu = () => toTitle();

  // ---------------------------------------------------------------- world event wiring
  scoring.onEvent = (e) => { hud.event(e); if (e.kind === 'ride') audio.combo(Math.floor(scoring.mult)); };
  chunks.onEnter = (c) => {
    tide.enter(c);
    atmos.setBiome(c.biome);
    // the biome name, once, when it changes (the first beach needs no title)
    if (state === 'playing' && lastBiome !== null && c.biome !== lastBiome) hud.zone(BIOME_NAME[c.biome].toUpperCase());
    lastBiome = c.biome;
  };
  chunks.onEvent = (_c, e) => {
    if (state !== 'playing') return;
    // (the lagoon's entry wave stays out of the way while the 12th Tide's own wave is still sweeping past)
    if (e.kind === 'surgeExit') audio.waveBuild();
  };
  // the rising tide shows on the tide counter (it pulses); no banner, and no horn (its two low chords read as a
  // warning beep before the 12th Tide)
  tide.onSurgeStart = () => { if (state !== 'playing') return; hud.banner('THE 12TH TIDE'); audio.tideBreak(); cam.shake(0.35); cam.kick(6); atmos.lightning(); lightningT = 3 + Math.random() * 3; };
  tide.onSurgeEnd = () => {
    if (state !== 'playing') return;
    scoring.tideSurvived(); audio.tideSurvived(); runner.shield = Math.max(runner.shield, 1); shield.restore(); hud.banner('TIDE SURVIVED');
    // the storm's over: the sun breaks out and a rainbow stands over the coast
    atmos.clearing(); skyBow.show(0.5, 5, 16, 9);
  };

  let peelSprayT = 0;
  /** the wave breaks this far behind you at Shorebreak Point */
  const PEEL_BEHIND = 22;
  /** the jet ski's controls, said once when you get on */
  function skiHint() {
    if (!handActive) return 'hold A / D to steer   ·   Space hop   ·   S duck   ·   hit a ramp for a flip';
    if (hand.mode === 'hand') return 'your hand is where you ride: move it across   ·   raise to hop   ·   drop to duck   ·   hit a ramp for a flip';
    return 'lean or step: you ride where you are   ·   hop to hop   ·   duck to duck   ·   hit a ramp for a flip';
  }
  /** the board's controls, said once when you pick it up */
  function boardHint() {
    if (!handActive) return 'A / D lanes   ·   Space ollie   ·   S tuck   ·   from the left lane, A again: up the wave and off the lip (in the air A / D spin, Space grab)';
    if (hand.mode === 'head') return 'slip your head left · right: one lane each   ·   bob up to ollie   ·   duck to tuck   ·   from the left lane, slip left again: up the wave and off the lip (slip to spin)';
    return hand.mode === 'body' ? 'lean or step left · right for a lane   ·   hop to ollie   ·   duck to tuck   ·   step far left: up the wave and off the lip (lean to spin)'
      : 'hand left · centre · right picks a lane   ·   raise to ollie   ·   drop to tuck   ·   hand far left: up the wave and off the lip (hand to a side spins)';
  }

  function handleRunnerEvents() {
    for (const e of runner.events) {
      switch (e.kind) {
        case 'jump': audio.jump(); tutorDid.jump = true; break;
        case 'land':
          audio.land(e.surf);
          if (e.surf) { chunks.streams.burst(runner.pos.x, runner.pos.y, runner.pos.z, 14, 2.5, 2); ripples.spawn(runner.pos.x, runner.pos.y, runner.pos.z, 2.2, 0.8, 2); }
          else if (chunks.floorAt(runner.pos.x, runner.pos.z) === null) dust.burst(PUFF.sand, runner.pos.x, runner.pos.y + 0.05, runner.pos.z + 0.2, 9, 1.8, 0.9);
          break;
        case 'slide': tutorDid.slide = true; audio.slide(); chunks.streams.burst(runner.pos.x, runner.pos.y + 0.1, runner.pos.z + 0.5, 8, 1.5, 1); break;
        case 'surge': audio.surge(); scoring.surge(); cam.kick(9); if (dogMode) audio.bark(); break;
        case 'near':
          scoring.nearMiss(e.closeness); audio.whoosh(e.closeness); cam.kick(3 + 5 * e.closeness); nearGlow = 1;
          if (runner.mode !== 'swim') character.glance(Math.sign(e.ob.shape.x - runner.pos.x) || 1);
          if (e.closeness > 0.55 && runner.mode !== 'swim') character.hatPop((e.closeness - 0.55) * 1.6);
          break;
        case 'pearl': {
          scoring.pearl(e.value, e.risky); audio.coin();
          tmpV.set(runner.pos.x, runner.hipY + 0.2, runner.pos.z).project(camera);
          if (tmpV.z < 1) hud.coinFly((tmpV.x * 0.5 + 0.5) * innerWidth, (-tmpV.y * 0.5 + 0.5) * innerHeight, e.risky);
          break;
        }
        case 'bump': audio.thud(0.35); cam.shake(0.18); break;
        case 'swept': audio.splash(0.5); chunks.streams.burst(runner.pos.x, tide.level, runner.pos.z, 10, 2, 1.5); break;
        case 'risky': scoring.risky(e.bonus); audio.combo(Math.floor(scoring.mult)); break;
        case 'airLow': audio.airLow(); break;
        case 'airOut': audio.airLow(); hud.flash('red'); break;
        case 'ring': scoring.ring(e.streak); audio.airRefill(); chunks.streams.burst(runner.pos.x, runner.hipY, runner.pos.z, 16, 2.2, 1.5); break;
        case 'dive': audio.splash(1.2); chunks.streams.burst(runner.pos.x, tide.level, runner.pos.z, 30, 4, 3); ripples.spawn(runner.pos.x, tide.level, runner.pos.z, 3.4, 1.2, 3); cam.kick(6); cam.shake(0.12); hud.flash('white'); break;
        case 'surface':
          audio.splash(0.8); chunks.streams.burst(runner.pos.x, tide.level, runner.pos.z, 20, 3, 3); ripples.spawn(runner.pos.x, tide.level, runner.pos.z, 2.6, 1, 2);
          character.shakeHead(); shakeDropsT = 0.5;
          break;
        case 'fall': audio.splash(1); break;
        // ---- on the board
        case 'mount': chunks.takeBoard(runner.pos.x, runner.pos.z); audio.splash(0.7); ripples.spawn(runner.pos.x, runner.pos.y, runner.pos.z, 2.4, 0.9, 2); chunks.streams.burst(runner.pos.x, runner.pos.y + 0.2, runner.pos.z, 18, 2.5, 2); hud.hint(boardHint(), 7); break;
        case 'release': audio.splash(1); break;
        case 'skiMount': audio.engineStart(); ripples.spawn(runner.pos.x, tide.level, runner.pos.z, 2.4, 0.9, 2); hud.hint(skiHint(), 7); break;
        case 'skiOff': audio.splash(0.9); ripples.spawn(runner.pos.x, tide.level, runner.pos.z, 2.6, 1, 2); break;
        case 'wakeHop': audio.splash(0.45); chunks.streams.burst(runner.pos.x, tide.level + 0.1, runner.pos.z + 0.5, 16, 2.6, 2.2); ripples.spawn(runner.pos.x, tide.level, runner.pos.z, 2, 0.7, 1); break;
        case 'launch':
          audio.whoosh(0.9); cam.kick(7); chunks.streams.burst(runner.pos.x, runner.pos.y + 0.2, runner.pos.z + 0.5, 26, 3.2, 3.5);
          character.hatPop(1);
          // a faint bow in the spray thrown off the lip
          sprayBow.show(0.32, 0.25, 0.5, 0.9, tmpV.set(runner.pos.x - 1.2, runner.pos.y + 0.6, runner.pos.z - 3.5), 2.6);
          break;
        case 'trick': if (e.clean) { scoring.trick(e.name, e.points); audio.trick(); cam.kick(4); } else { audio.thud(0.4); cam.shake(0.2); } break;
        case 'spray': chunks.streams.burst(runner.pos.x - Math.sign(runner.vx) * 0.45, runner.pos.y + 0.15, runner.pos.z + 0.5, Math.round(4 + 7 * e.k), 1.6 + 2.6 * e.k, 2.4); audio.spray(e.k); break;
        case 'hit':
          scoring.hit(e.fatal);
          hitStop = e.fatal ? 0.13 : 0.08;
          if (e.fatal) die(e.ob ? e.ob.name ?? ({ rock: 'HIT THE ROCKS', wood: 'HIT THE WRECKAGE', coral: 'HIT THE CORAL', jelly: 'STUNG', net: 'CAUGHT IN THE NET', barrel: 'HIT A BARREL', chain: 'HIT THE CHAINS' } as Record<string, string>)[e.ob.tag] ?? 'WASHED OUT' : 'FELL THROUGH THE PIER');
          if (e.ob?.tag === 'sand') dust.burst(PUFF.sand, runner.pos.x, runner.pos.y + 0.5, runner.pos.z - 0.4, 22, 3, 2.2, 1.6);   // (through a sandcastle)
          if (!e.fatal) {
            audio.hit(false); cam.shake(0.45); hud.flash('red'); shield.pop(); chunks.streams.burst(runner.pos.x, runner.hipY, runner.pos.z, 26, 3.5, 1.5);
            dust.burst(PUFF.shard, runner.pos.x, runner.hipY, runner.pos.z, 28, 5, 2.4);            // the shield shatters
          }
          break;
      }
    }
    runner.events.length = 0;
  }

  // ---------------------------------------------------------------- keyboard shell
  addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') document.body.classList.toggle('debug');
    if (e.code === 'KeyH') document.body.classList.toggle('clean');
    if (e.code === 'KeyM') { audio.toggleMute(); menus.setMuted(audio.isMuted); }
    if (state === 'title' && (e.code === 'Enter' || e.code === 'Space') && menus.screen === 'title') startRun(false);
    else if (state === 'setup' && e.code === 'Escape') toTitle();
    else if (state === 'playing' && e.code === 'Escape') pause('paused');
    else if (state === 'paused' && e.code === 'Escape') resume();
    else if ((state === 'playing' || state === 'paused' || state === 'dead') && e.code === 'KeyR') startRun(handActive);
    else if (state === 'dead' && e.code === 'Enter') startRun(handActive);
  });
  // switching tabs or windows mid-run pauses instead of letting the run play on unseen
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause('paused'); });

  // ---------------------------------------------------------------- frame loop
  const t0 = performance.now();
  let last = performance.now();
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pendingQ: WebGLQuery[] = [];
  let lastGpuMs = -1;
  const orbit = new THREE.Vector3(), orbitLook = new THREE.Vector3();

  const frame = () => {
    const now = performance.now();
    const dtMs = now - last; last = now;
    const dt = Math.min(dtMs / 1000, 0.1);
    // hit-stop (a frozen beat on a hit) and slow motion at the top of a launch; the camera keeps real time
    hitStop = Math.max(0, hitStop - dt); apexT = Math.max(0, apexT - dt);
    const slowWant = state !== 'playing' ? 1 : hitStop > 0 ? 0 : apexT > 0 ? 0.35 : 1;
    slow = slowWant < slow ? slowWant : slow + (slowWant - slow) * (1 - Math.exp(-dt / 0.12));
    const playDt = state === 'playing' ? dt * timeScale * slow : dt;        // the tutorial's slow motion
    const t = (now - t0) / 1000;
    env.uTime.value = t;
    renderer.info.reset();

    // ---- input
    const inp = emptyInput();
    const uw = underwater();
    if (state === 'playing' || state === 'handlost' || state === 'setup') {
      const onSkiNow = runner.mode === 'ski';
      if (hand.status !== 'off') hand.update(t, inp, uw, onSkiNow);
      if (state === 'playing') keyboard.apply(inp, uw, onSkiNow);
      if (simActive) sim.apply(inp);
    } else if (hand.status !== 'off') hand.update(t, emptyInput(), false);
    // back from a lost hand only once it's tracked steadily for a moment (one stray detection isn't enough)
    if (state === 'handlost' && hand.status === 'tracking' && hand.steadyFor >= HAND_SETTINGS.resumeAfter) resume();
    if (state === 'playing' && handActive && hand.lostLong) pause('handlost');

    // ---- simulation
    if (state === 'playing') {
      gameT += dt;
      const zBefore = runner.pos.z;
      if (tutorial) updateTutorial(dt);
      const simDt = dt * timeScale * slow;
      runner.update(simDt, inp, chunks, tide.level, t);
      if (runner.bigAir && runner.airborne && prevVy > 4 && runner.vy <= 4) apexT = 1.0;      // (into the top of the arc: slow through the flip)
      prevVy = runner.vy;
      critters.update(simDt, runner, chunks, !tutorial && !tide.surging);
      kraken.update(simDt, runner, chunks);
      for (const e of kraken.events) {
        switch (e.kind) {
          case 'wake': audio.krakenRumble(); cam.shake(0.3); hud.flash('white'); break;
          case 'heart': audio.heartbeat(); break;
          case 'strike': audio.krakenSlam(); cam.shake(0.28); cam.kick(4); chunks.streams.burst(e.x, e.y + 0.4, e.z, 14, 2.5, 1.5); break;
          case 'escaped': scoring.kraken(); audio.tideSurvived(); hud.banner('ESCAPED THE KRAKEN'); break;
        }
      }
      kraken.events.length = 0;
      const dz = zBefore - runner.pos.z;
      handleRunnerEvents();
      if (!runner.alive && state === 'playing') die(deathCause);
      chunks.update(runner.pos.z);
      // jumped a treasure chest: it flies open, a shower of sparkle, a chime and a bonus
      for (const at of chunks.openChests(runner.pos)) { audio.treasure(); scoring.treasure(); chunks.streams.burst(at.x, at.y + 0.3, at.z, 22, 2.6, 3.2); }
      // bubbles stream up inside the gate holes ahead: that is where the air is
      bubbleT += dt;
      if (bubbleT > 0.12 && runner.mode === 'swim') {
        bubbleT = 0;
        for (const ch of chunks.chunks) for (const g of ch.rings ?? []) {
          const z = ch.zStart - g.along, ahead = runner.pos.z - z;
          const r = Math.min(g.r, 2.2);                              // (the cave mouth's big ring: from mid-opening, not the sand)
          if (ahead > 4 && ahead < 50) chunks.streams.burst(g.x + (Math.random() - 0.5) * r, g.y - r * 0.7, z, 2, 0.35, 1.6);
        }
      }
      riding = runner.curVel.length() > 1.2 && (runner.curVel.z > 0.8 || Math.abs(runner.curVel.x) > 1.5 && Math.sign(runner.vx) === Math.sign(runner.curVel.x));
      scoring.update(simDt, dz, riding, tide.surging);
      // footsteps follow the stride
      if (runner.mode !== 'swim' && !runner.airborne && runner.sliding <= 0) {
        strideT += dt * runner.speed / 2.3;
        if (strideT >= 1) {
          strideT -= 1; audio.footstep(runner.mode === 'surf');
          if (runner.mode === 'surf') chunks.streams.burst(runner.pos.x, tide.level + 0.05, runner.pos.z, 3, 1.2, 1.2);
          else if (runner.mode === 'run') shore.step(runner, chunks, tide.level, 2.3, dogMode);
        }
      }
      if (runner.surgeT > 0 && Math.random() < 0.5) chunks.streams.mote(runner.pos.x + (Math.random() - 0.5) * 0.6, runner.hipY + (Math.random() - 0.5) * 0.8, runner.pos.z + 0.6, 0, 0, 6, 0.5);
      if (runner.mode === 'swim' && Math.random() < 0.15) chunks.streams.mote(runner.pos.x, runner.hipY + 0.3, runner.pos.z + 0.3, 0, 1.2, 1.5, 0.8);
      // skimming the seabed kicks up a trail of sand
      siltT -= simDt;
      if (runner.mode === 'swim' && siltT <= 0) {
        const g = chunks.groundAt(runner.pos.x, runner.pos.z);
        if (runner.hipY - g < 1.2 && runner.speed > 3) { siltT = 0.06; dust.emit(PUFF.silt, runner.pos.x + (Math.random() - 0.5) * 0.6, g + 0.15, runner.pos.z + 0.6, (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.4, 1.2); }
      }
      // water shaken out of his hair as he surfaces
      if (shakeDropsT > 0) {
        shakeDropsT -= dt;
        character.headPos(tmpV);
        for (let i = 0; i < 2; i++) { const a = Math.random() * Math.PI * 2; dust.emit(PUFF.drop, tmpV.x, tmpV.y + 0.05, tmpV.z, Math.cos(a) * 2.6, 1 + Math.random() * 1.5, Math.sin(a) * 2.6); }
      }
      // Reveille's paw prints
      if (pet.pawsDown && !dogMode) {
        pawDist += Math.hypot(pet.position.x - lastPaw.x, pet.position.z - lastPaw.z);
        if (pawDist > 0.6 && pawDist < 5) { shore.paw(pet.position.x, pet.position.z, pet.heading, chunks, tide.level, !dogMode); pawDist = 0; }
        else if (pawDist >= 5) pawDist = 0;
      } else pawDist = 0;
      lastPaw.copy(pet.position);
      if (hand.simulated === false && handActive && hand.status === 'calibrating') { /* keep running; a recalibration mid-run still works */ }
    }
    if (state !== 'title') tide.update(playDt);
    chunks.animate(t, dt);
    fauna.update(t, dt, runner.pos);
    // Shorebreak Point: the wave breaks behind you (spray where it pitches), and the sound follows how close it is
    const onBoard = runner.mode === 'board';
    const peelZ = runner.pos.z + PEEL_BEHIND;                       // where the wave is breaking, behind you
    chunks.waves.update(onBoard ? peelZ : runner.pos.z + 40, tide.surging ? 1.3 : 1);
    if (onBoard && state === 'playing') {
      peelSprayT -= dt;
      const pc = chunks.chunkAt(peelZ);
      if (peelSprayT <= 0 && pc?.wave) {
        peelSprayT = 0.06;
        const a = pc.zStart - peelZ, h = pc.wave.h(a);
        if (h > 1.5) chunks.streams.burst(pc.wave.crest(a) + 1.5 + Math.random() * 2, h * (0.6 + 0.4 * Math.random()), peelZ + Math.random() * 3, 3, 2.2, 2.5);
        // and spray blowing off the lip's tip ahead of you
        const z = runner.pos.z - 4 - Math.random() * 40, lc = chunks.chunkAt(z);
        if (lc?.wave) {
          const la = lc.zStart - z;
          if (lc.wave.h(la) > 2) {
            const near = Math.min(1, Math.max(0, (90 - (runner.pos.z - z)) / 60));            // (the lip forms as you reach it)
            const tip = lipTip(lc.wave, la, chunks.waves.curlAt(lc, la) * near);
            for (let i = 0; i < 3; i++) chunks.streams.mote(tip.x + 0.3 + Math.random() * 0.6, tip.y - 0.2 + Math.random() * 0.4, z + Math.random() * 2, 2 + Math.random() * 2.5, -0.3 - Math.random() * 2, 0.5, 0.6 + Math.random() * 0.5);
          }
        }
      }
    }
    audio.surf(state === 'playing' && onBoard ? 0.5 : 0);
    const onSki = runner.mode === 'ski';
    audio.engine(state === 'playing' && onSki ? THREE.MathUtils.clamp(runner.speed / 30, 0.3, 1) * (runner.airborne ? 1.25 : 1) : 0);
    wake.update(state === 'playing' || state === 'dead' ? dt * timeScale : 0, runner, (onBoard || onSki) && state === 'playing');
    wildlife.update(state === 'playing' ? dt * timeScale * slow : state === 'title' ? dt : 0, runner, chunks, tide.level);
    const lifeDt = state === 'playing' ? dt * timeScale * slow : state === 'title' ? dt : 0;
    shore.update(lifeDt, runner, chunks, tide.level, tide.surging, tide.step);
    reef.update(lifeDt, runner, chunks, tide.level);
    dust.update(dt * slow); ripples.update(dt * slow);
    // weather follows the tide counter: the wind freshens and the sea gets up toward the 12th, which brings rain and
    // lightning; after it, the sun breaks out
    const storm = tide.intensity;
    env.uWind.value = 0.25 + 0.75 * storm; env.uStorm.value = storm;
    waterParams.uWaveAmp.value = 0.28 * (1 + 0.8 * storm);
    rain.amount = tide.surging ? 1 : tide.phase === 'rising' && tide.step >= 11 ? 0.3 : 0;
    if (tide.surging && state === 'playing') {
      lightningT -= dt;
      if (lightningT <= 0) { lightningT = 4 + Math.random() * 6; atmos.lightning(); setTimeout(() => audio.thunder(), 300 + Math.random() * 900); }
    }
    // the demo course is forgiving: a shield you've used comes back after a few seconds (two hits close together still
    // end the run), so a demo gets all the way to the 12th Tide
    if (state === 'playing' && runner.alive && runner.shield <= 0 && isDemoSeed(seed) && (chunks.chunkAt(runner.pos.z)?.seq ?? Infinity) < DEMO_COURSE.length) {
      demoShieldT += dt;
      if (demoShieldT > 6) { demoShieldT = 0; runner.shield = 1; shield.restore(); hud.flash('aqua'); }
    } else demoShieldT = 0;
    atmos.tide = tide.intensity * 0.85;
    atmos.update(dt);

    // ---- character + camera
    if (state === 'title') {
      const pose = params.get('pose');
      if (pose) {
        // dev: inspect a pose from the side (?pose=swim&view=side|front|top)
        character.debugPose(pose, t, runner);
        const v = params.get('view') ?? 'side';
        const o = v === 'front' ? [0, 1.2, -4.5] : v === 'top' ? [0.01, 5, 0] : [4.5, 1.2, 0];
        orbit.set(runner.pos.x + o[0], runner.pos.y + o[1], runner.pos.z + o[2]);
        orbitLook.set(runner.pos.x, runner.pos.y + 1.0, runner.pos.z);
      } else {
        character.update(dt, t, runner, true);
        // slow orbit around the runner on the start line, looking down the beach
        const a = 0.9 + Math.sin(t * 0.1) * 0.7;
        orbit.set(Math.sin(a) * 7.5 + runner.pos.x, 2.6 + Math.sin(t * 0.3) * 0.3, runner.pos.z + Math.cos(a) * 7.5);
        orbitLook.set(runner.pos.x - 1, runner.pos.y + 1.0, runner.pos.z - 6);
      }
      cam.override = { pos: orbit, look: orbitLook, w: 1 };
      cam.update(0, t, runner, tide.level, 0);
    } else {
      cam.override = null;
      if (state === 'playing' || state === 'dead') { character.update(playDt, t, runner); if (!dogMode) pet.update(playDt, runner, chunks, state === 'playing'); }
      cam.update(dt, t, runner, tide.level, tide.surging ? 1 : 0, Math.min(chunks.ceilingAt(runner.pos.x, runner.pos.z), chunks.ceilingAt(runner.pos.x, runner.pos.z + 6)));
    }
    if (state === 'setup') menus.updateSetup(dt);
    env.uPlayerPos.value.set(runner.pos.x, runner.hipY, runner.pos.z);
    shield.update(dt, t, runner, state === 'playing' || state === 'paused' || state === 'handlost');

    // ---- shadow box follows the runner
    const texel = 80 / sun.shadow.mapSize.x;
    sun.target.position.set(Math.round(runner.pos.x / texel) * texel, Math.min(runner.pos.y, 0), Math.round((runner.pos.z - 10) / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(env.uSunDir.value, 120);
    rays.update(camera);

    // ---- audio & hud
    const surf = waveHeight(camera.position.x, camera.position.z, t);
    const dy = camera.position.y - surf;
    const under = THREE.MathUtils.smoothstep(-dy, -0.05, 0.05);
    const nearSurface = 1 - THREE.MathUtils.smoothstep(Math.abs(dy), 0.3, 1.2);
    // (muffled for the slow-motion beat at the top of a launch)
    audio.setUnder(Math.max(under, apexT > 0 ? 0.5 : 0));
    rain.update(dt, camera, env.uWind.value, under > 0.5 || chunks.ceilingAt(camera.position.x, camera.position.z) < Infinity);
    sprayBow.update(dt, camera); skyBow.update(dt, camera);
    audio.update(dt, state === 'playing' ? Math.min(runner.speed / 16, 1) + (runner.surgeT > 0 ? 0.5 : 0) : 0, -camera.position.y);
    audio.setIntensity(state === 'playing' ? Math.max(0.1, tide.intensity, Math.min(0.6, (scoring.mult - 1) / 10), kraken.presence * 0.75) : 0.05);
    audio.music(dt);
    nearGlow *= Math.exp(-dt * 3);
    if (state === 'playing' || state === 'paused' || state === 'handlost') {
      const c = chunks.chunkAt(runner.pos.z);
      const bname = c ? BIOME_NAME[(c.zStart - runner.pos.z) > c.length * 0.5 ? c.toBiome : c.biome] : '';
      hud.update(dt, scoring, runner, tide, handActive ? hand : null, bname, nearGlow);
    }

    // ---- render
    let q: WebGLQuery | null = null;
    if (timerExt && pendingQ.length < 3) { q = gl.createQuery()!; gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q); }
    post.render(scene, camera, { under, nearSurface, waterY: surf, time: t });
    if (q && timerExt) { gl.endQuery(timerExt.TIME_ELAPSED_EXT); pendingQ.push(q); }
    if (timerExt && pendingQ.length && gl.getQueryParameter(pendingQ[0], gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(timerExt.GPU_DISJOINT_EXT)) {
      lastGpuMs = gl.getQueryParameter(pendingQ[0], gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(pendingQ.shift()!);
    }
    devHud.tick(dtMs);
    quality.sample(Math.max(dtMs, lastGpuMs));
    devHud.render(renderer, { quality: `${LEVELS[quality.level].name}${quality.auto ? ' (auto)' : ''}`, gpu: lastGpuMs >= 0 ? `${lastGpuMs.toFixed(1)} ms` : 'n/a', state, mode: runner.mode, z: runner.pos.z.toFixed(0), chunk: chunks.chunkAt(runner.pos.z)?.patternId ?? '-', pools: `${chunks.kits.stats().used}/${chunks.kits.stats().cap}`, hand: `${hand.status} ${hand.inferenceMs.toFixed(0)}ms` });
    keyboard.endFrame();
    requestAnimationFrame(frame);
  };

  // ---------------------------------------------------------------- boot
  toTitle();
  if (params.get('autostart') === '1') startRun(false);
  cam.snap(runner);
  const loading = document.getElementById('loading')!;
  loading.classList.add('done');
  setTimeout(() => { loading.style.display = 'none'; }, 900);
  (window as unknown as { __game: unknown }).__game = {
    runner, chunks, scoring, tide, cam, hand, audio, menus, hud, camera, renderer, get character() { return character; }, get pet() { return pet; }, waveY, THREE, post, postParams, scene, sun, hemi, env, atmos,
    get state() { return state; }, get seed() { return seed; }, startRun: (cam: boolean, tut = false) => startRun(cam, tut, true), toTitle, pause, resume, get gpuMs() { return lastGpuMs; },
    sim, setSim(on: boolean) { simActive = on; }, generator: CourseGenerator, critters, wildlife, shore, reef, dust, ripples, rain, skyBow, sprayBow, wipe, kraken,
  };
  (window as unknown as { __ready: boolean }).__ready = true;
  requestAnimationFrame(frame);
}

build().catch((e) => {
  console.error(e);
  document.querySelector('#loading .sub')!.textContent = `Failed to load: ${e.message}`;
});
