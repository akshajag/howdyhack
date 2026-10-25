# Asset and code credits

Everything not listed here is original to this project: the game code and shaders, the procedural audio, the Blender build scripts and the kit pieces they produce (reef kit in `game/public/models`, most of the cove kit in `game/public/cove/models`, 61 of the 107 runner-kit pieces in `game/public/runner/models` (including the reef gates, their rings, the volleyball net and the volleyballs, the grotto's cave mouth and roof, the sea mine, the fishing net, the crab and the shark, the wildlife: gulls, dolphin, sea turtle, sailboat, the Aggie details: research station, HOWDY! sign, research buoys, the sitting collie, the runner's dive pack, the treasure chest, and Shorebreak Point's surfboard, Aggie Surf Club shack, lifeguard tower, foam rings and distant surfers), the surfing wave itself (drawn in code, `game/src/world/surfwave.ts`), and the `Runner_Character`).

Detailed provenance notes, including items that were evaluated and rejected, are in [docs/ASSETS_AND_LICENSES.md](docs/ASSETS_AND_LICENSES.md).

## Software

| Package | Version | Licence | Shipped? |
|---|---|---|---|
| [three](https://threejs.org) (incl. `GLTFLoader`) | 0.186.1 | MIT, © 2010-2026 three.js authors | yes (bundled) |
| [lil-gui](https://lil-gui.georgealways.com) | 0.21.0 | MIT | yes (debug panel) |
| [@mediapipe/tasks-vision](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) | 1.0.1 | Apache-2.0 | loaded from jsDelivr at runtime, not bundled; the hand model (`hand_landmarker.task`) is downloaded from Google's storage |
| vite 7.3.7, typescript 5.9.3, @types/three, puppeteer-core 24 | | MIT / Apache-2.0 | build and test tools only |
| Blender 5.2 + glTF exporter | | GPL (the exported meshes are ours) | authoring tool only |

The surf wave's shader borrows two ideas, not code: noise-trail foam shapes from [achrefelouafi/WaterThreeJS](https://github.com/achrefelouafi/WaterThreeJS) (MIT) and thin bright wave lines from [thaslle/stylized-water](https://github.com/thaslle/stylized-water) (MIT). No code was copied from the repositories studied while designing the game (listed in `docs/research-notes.md` and `docs/tide/TIDE_RUN.md`).

## 3D models imported from libraries

All imports were brought in through the Blender MCP (Poly Haven, Sketchfab, Poly Pizza), then merged to one mesh, decimated, re-pivoted to the base centre, scaled to real size and had their textures baked into vertex colours, so no third-party texture images ship.

### The runner (`game/public/runner/models/Runner_Beach.glb`)

"Beach Character" by **Quaternius**, [poly.pizza/m/DojKLcO34E](https://poly.pizza/m/DojKLcO34E), **CC0 1.0**. Rig and the Idle, Run, Roll, Hit (HitRecieve), Death and Wave clips are Quaternius' own animation. Changes: the board shorts recoloured maroon, the tank top taken off (shirtless), unused clips removed, and clips added on the same rig by this project: **Jump** and a front-crawl **Swim** (`blender/runner/author_q_clips.py`), and the board stance **Surf** and the air **SurfGrab** (`blender/runner/author_surf_clips.py`). Played with three.js' `AnimationMixer` (MIT). The earlier procedural `Runner_Character.glb` is no longer used.

### Reveille, the running collie (`game/public/runner/models/Reveille.glb`)

"Husky" by **Quaternius**, [poly.pizza/m/wcWiuEqwzq](https://poly.pizza/m/wcWiuEqwzq), **CC0 1.0**. Rig and the Gallop, Gallop_Jump, Walk, Idle and Idle_2 clips are Quaternius' own animation. Changes (`blender/runner/build_reveille.py`): recoloured sable and white with a darker saddle, a white ruff, blaze and tail tip painted in, the ear tips folded, brown eyes, a maroon collar with a gold tag, her blanket (a shell skinned like the body under it), unused clips removed. The blanket's picture is drawn at load time by `game/src/game/pet.ts`. Source file and notes: `assets_vendor/polypizza/husky_wcWiuEqwzq/`.

"Rock Large" and "Rock" by **Quaternius**, [poly.pizza/m/d2VWOdthtR](https://poly.pizza/m/d2VWOdthtR) and [poly.pizza/m/R2UjZAX3By](https://poly.pizza/m/R2UjZAX3By), **Public Domain (CC0 1.0)**: the sea stacks standing in the wash at Shorebreak Point (`Sea_Stack_A`, `Sea_Stack_B`). Changes (`blender/runner/build_seastacks.py`): merged to one mesh each, sized to stand ~3.3 m with a footprint that fits a lane, and repainted face by face as wet sea rock (a dark wet base with weed, grey-brown strata, a pale weathered top flecked with bird droppings). Source files and notes: `assets_vendor/polypizza/rock_*/`.

"Tentacle" (Enemy Tentacle) by **Quaternius**, [poly.pizza/m/BR1vpIvvvv](https://poly.pizza/m/BR1vpIvvvv), **Public Domain (CC0 1.0)**: the Kraken's tentacles (`Kraken_Tentacle`). Changes (`blender/runner/build_kraken.py`): baked out of its armature in the rest pose, straightened to unit length, repainted crimson with pale suckers; bent along a curve in the game's vertex shader. The Kraken's head and eyes are ours, modelled after the low-poly octopuses on Poly Pizza. Source file and notes: `assets_vendor/polypizza/tentacle_BR1vpIvvvv/`.

### Runner kit (`game/public/runner/models`)

| Piece | Source | Author | Licence |
|---|---|---|---|
| `Anchor` | [poly.pizza/m/ejWQny9Gcz](https://poly.pizza/m/ejWQny9Gcz) | Quaternius | CC0 1.0 |
| `Chest` | [poly.pizza/m/AngpV0HxD8](https://poly.pizza/m/AngpV0HxD8) | Quaternius | CC0 1.0 |
| `Cannon` | [polyhaven.com/a/cannon_01](https://polyhaven.com/a/cannon_01) | James Ray Cock, Yann Kervran | CC0 1.0 |
| `Jellyfish` | [poly.pizza/m/5PxIqPamrag](https://poly.pizza/m/5PxIqPamrag) | Poly by Google | **CC-BY 3.0** |
| `Starfish` | [poly.pizza/m/6H-0K9IEr56](https://poly.pizza/m/6H-0K9IEr56) | Poly by Google | **CC-BY 3.0** |
| `Shell_A` ("Seashell") | [poly.pizza/m/5ovn4mnRejL](https://poly.pizza/m/5ovn4mnRejL) | Poly by Google | **CC-BY 3.0** |
| `Shell_B` ("seashell") | [poly.pizza/m/2BU9U8dOkh-](https://poly.pizza/m/2BU9U8dOkh-) | Dario Demi (D911C) | **CC-BY 3.0** |
| `Anemone` ("Sea anemone") | [poly.pizza/m/5mWGVL6VgMd](https://poly.pizza/m/5mWGVL6VgMd) | Poly by Google | **CC-BY 3.0** |
| `Ship_Wheel` | [sketchfab.com/3d-models/ff5cf353988d48bb8303f452096736f9](https://sketchfab.com/3d-models/ff5cf353988d48bb8303f452096736f9) | Hero.Craft | **CC-BY 4.0** |
| (shape reference only, not shipped) Shorebreak Point's wave profile: measured from "Wave" and rebuilt in code (`game/src/game/wave.ts`) | [poly.pizza/m/6mpwUZqCgzy](https://poly.pizza/m/6mpwUZqCgzy) | Poly by Google | **CC-BY 3.0** |
| `Runner_Hat` (the runner's straw hat, from "Fedora": brim widened, crown lowered, repainted straw with a maroon band, `blender/runner/build_hat.py`) | [poly.pizza/m/8TpZrCG3aRf](https://poly.pizza/m/8TpZrCG3aRf) | Poly by Google | **CC-BY 3.0** |

### Kenney kits (`game/public/runner/models/K_*.glb`: beach obstacles and dressing)

Downloaded from kenney.nl and converted by `blender/runner/import_kenney.py`: the palette texture / flat materials baked into vertex colours, recoloured to the game's palette (brown wood instead of Kenney's orange-red, yellow-green foliage, grey-tan beach stone, limestone tower), resized to metres and re-pivoted. `K_Palm_Fallen` and `K_Palm_Raised` are composites built from a Kenney palm (laid down, trunk thinned so it can be jumped) and Kenney rocks. Download links and the exact source files are in `assets_vendor/kenney/*/SOURCE.txt`.

| Pieces | Source | Author | Licence |
|---|---|---|---|
| `K_Rock_SandA/SandC/C`, `K_Rocks_Big/BigA`, `K_Barrel`, `K_Crate`, `K_Crate_Bottles`, `K_Chest`, `K_Cannon`, `K_Palm_Bend/Straight/Small`, `K_Grass`, `K_Rowboat`, `K_Hut`, `K_Watchtower`, `K_Flag`, `K_Shipwreck`, composites `K_Palm_Fallen`, `K_Palm_Raised`, `K_Barrels`, `K_CrateStack`, `K_BoatRack` (the boat rack's posts are ours) | [Pirate Kit 2.1](https://kenney.nl/assets/pirate-kit) | Kenney | CC0 1.0 |
| `K_Log`, `K_LogBig`, `K_LogPile`, `K_Tiki` (statue head), `K_Bush`, `K_Bush_Large`, `K_Grass_Tall`, `K_Flowers`, `K_Flowers_Red`, `K_Canoe`, `K_Campfire`, `K_Fence` | [Nature Kit 2.1](https://kenney.nl/assets/nature-kit) | Kenney | CC0 1.0 |

`K_VolleyNet`, `Reef_Gate_Mid/Low/High/Twin` and `Gate_Ring` are ours (`import_kenney.py`, `build_gates.py`). `Pelican_Body`, `Pelican_Wing`, `Sanderling`, `Octopus` and `Sandcastle` are ours (`build_shorelife.py`); garden eels, footprints, rain, ripples, the rainbow and the wave wipe are drawn in code.

### Textures

| Texture | Source | Author | Licence |
|---|---|---|---|
| `runner/textures/sand_01_*` (beach ground detail: grain and normal, tinted by our ground colours) | [polyhaven.com/a/sand_01](https://polyhaven.com/a/sand_01) | Rob Tuytel / Poly Haven | CC0 1.0 |

Research for the beach rebuild (no code or assets taken): Blender beach-building guides (CG Cookie's beach-scene series) and the OpenGameArt listing of the Kenney Pirate Kit.

### Cove kit (`game/public/cove/models`, earlier beach dressing; the files still ship)

| Piece | Source | Author | Licence |
|---|---|---|---|
| `SRC_coastal_cliff_01/02`, `SRC_rock_face_01/02` | [polyhaven.com](https://polyhaven.com/a/coastal_cliff_01) | Rob Tuytel, Rico Cilliers / Poly Haven | CC0 1.0 (geometry only, decimated and re-shaded) |
| `SRC_palm` | [poly.pizza/m/nr1B5DbICA](https://poly.pizza/m/nr1B5DbICA) | Quaternius | CC0 1.0 |
| `SRC_mk_rock_1/2/3`, `SRC_mk_bush`, `SRC_mk_grass_wispy` | [Stylized Nature MegaKit](https://quaternius.itch.io/stylized-nature-megakit) (Standard) | Quaternius | CC0 1.0 (textures recoloured through our ramps) |
| `SRC_palm_old/curve/young` | [opengameart.org/content/exotic-palms-lowpoly-style](https://opengameart.org/content/exotic-palms-lowpoly-style) | FabinhoSC | CC0 |
| Headland terrain detail | USGS 3D Elevation Program DEM (Nā Pali coast) | U.S. Geological Survey | US public domain |

## Credit lines shown in the game (Settings → Credits)

- "Jellyfish", "Starfish", "Seashell" and "Sea anemone" by Poly by Google (poly.pizza), CC-BY 3.0
- "seashell" by Dario Demi (D911C) (poly.pizza), CC-BY 3.0
- "Ship wheel" by Hero.Craft (sketchfab.com), CC-BY 4.0
- "Fedora" by Poly by Google (poly.pizza), CC-BY 3.0 (the runner's straw hat) · "Wave" by Poly by Google (poly.pizza), CC-BY 3.0 (the surf wave's shape)
- Beach props, palms, rocks, boats and plants from the Pirate Kit and Nature Kit by Kenney (kenney.nl, CC0); sand texture by Rob Tuytel (Poly Haven, CC0)
- Runner ("Beach Character" with its animations), Reveille ("Husky" with its animations), Anchor, Chest, palm, nature kit, the Shorebreak sea stacks and the Kraken's tentacle by Quaternius (CC0); Cannon by James Ray Cock and Yann Kervran, cliffs by Rob Tuytel and Rico Cilliers (Poly Haven, CC0); palms by FabinhoSC (OpenGameArt, CC0)
- Three.js (MIT) · MediaPipe Tasks Vision (Apache-2.0)

## Trademarks

Maroon `#500000` and white are used as colours throughout. One exception, at the request of the team for this Texas A&M student hackathon: Reveille's blanket carries a hand-drawn "ATM" monogram in the style of the university's and her name, as on the real Reveille's blanket (drawn in code, `capeTexture()` in `game/src/game/pet.ts`, no image files copied). Texas A&M's marks belong to the university; the monogram should be checked with A&M's licensing office, or swapped for plain text in that one function, before the game is used anywhere outside the hackathon.
