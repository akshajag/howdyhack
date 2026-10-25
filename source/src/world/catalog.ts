import type { KitDef } from './pool';

/**
 * Kit catalogue: every renderable piece the patterns can reference, where it lives and which material family it uses.
 * `runner/` pieces come from blender/runner_kit.blend; `models/` from the reef slice; `cove/models/` from Sea Aggie Cove.
 * A missing runner GLB falls back to a stand-in so no obstacle is ever invisible.
 */
const K = (url: string, family: string, capacity = 256, shadow = true): KitDef => ({ url, family, capacity, shadow });

export const CATALOG: Record<string, KitDef> = {
  // ---- reef slice kit (ours)
  Rock_Boulder: K('models/Rock_Boulder.glb', 'rock', 512), Rock_Slab: K('models/Rock_Slab.glb', 'rock', 256), Rock_Pillar: K('models/Rock_Pillar.glb', 'rock', 256),
  Coral_Branch: K('models/Coral_Branch.glb', 'coral', 1024), Coral_Fan: K('models/Coral_Fan.glb', 'coral', 512), Coral_Brain: K('models/Coral_Brain.glb', 'coral', 1024),
  Coral_Table: K('models/Coral_Table.glb', 'coral', 1024), Coral_Tube: K('models/Coral_Tube.glb', 'coral', 512),
  Plant_Kelp: K('models/Plant_Kelp.glb', 'kelp', 512, false), Plant_SeaGrass: K('models/Plant_SeaGrass.glb', 'seagrass', 2048, false),
  Palm: K('models/Palm.glb', 'palm', 128), Prop_Buoy: K('models/Prop_Buoy.glb', 'structure', 64), Prop_Kayak: K('models/Prop_Kayak.glb', 'structure', 32), Prop_Umbrella: K('models/Prop_Umbrella.glb', 'structure', 32),
  Pier_Section: K('models/Pier_Section.glb', 'structure', 64), Pier_Platform: K('models/Pier_Platform.glb', 'structure', 16),
  Arch_Hero: K('models/Arch_Hero.glb', 'arch', 8),
  // ---- Sea Aggie Cove kit (ours + restyled CC0 imports)
  Driftwood_00: K('cove/models/Driftwood_00.glb', 'wood', 128), Driftwood_01: K('cove/models/Driftwood_01.glb', 'wood', 128), Driftwood_02: K('cove/models/Driftwood_02.glb', 'wood', 128),
  Driftwood_03: K('cove/models/Driftwood_03.glb', 'wood', 128), Driftwood_04: K('cove/models/Driftwood_04.glb', 'wood', 128), Driftwood_05: K('cove/models/Driftwood_05.glb', 'wood', 128), Driftwood_06: K('cove/models/Driftwood_06.glb', 'wood', 128),
  SRC_palm: K('cove/models/SRC_palm.glb', 'palm', 128), SRC_palm_old: K('cove/models/SRC_palm_old.glb', 'palmTex', 128), SRC_palm_curve: K('cove/models/SRC_palm_curve.glb', 'palmTex', 128), SRC_palm_young: K('cove/models/SRC_palm_young.glb', 'palmTex', 128),
  SRC_mk_rock_1: K('cove/models/SRC_mk_rock_1.glb', 'rock', 256), SRC_mk_rock_2: K('cove/models/SRC_mk_rock_2.glb', 'rock', 256), SRC_mk_rock_3: K('cove/models/SRC_mk_rock_3.glb', 'rock', 256),
  SRC_mk_bush: K('cove/models/SRC_mk_bush.glb', 'foliage', 256, false), SRC_mk_grass_wispy: K('cove/models/SRC_mk_grass_wispy.glb', 'grassTex', 1024, false),
  Veg_SeaOats: K('cove/models/Veg_SeaOats.glb', 'grass', 1024, false), Veg_DuneGrass: K('cove/models/Veg_DuneGrass.glb', 'grass', 1024, false),
  SRC_coastal_cliff_01: K('cove/models/SRC_coastal_cliff_01.glb', 'rock', 16), SRC_coastal_cliff_02: K('cove/models/SRC_coastal_cliff_02.glb', 'rock', 32),
  Reef_Stack_02: K('cove/models/Reef_Stack_02.glb', 'rock', 16), Reef_Stack_04: K('cove/models/Reef_Stack_04.glb', 'rock', 16), Reef_Stack_06: K('cove/models/Reef_Stack_06.glb', 'rock', 16),
  Boat_Research: K('cove/models/Boat_Research.glb', 'structure', 8),
  // ---- runner kit (new; blender/runner_kit.blend)
  Pier_Deck: K('runner/models/Pier_Deck.glb', 'wood', 128), Pier_Deck_Broken: K('runner/models/Pier_Deck_Broken.glb', 'wood', 64), Pier_Rail_4m: K('runner/models/Pier_Rail_4m.glb', 'wood', 256, false),
  Pier_Post: K('runner/models/Pier_Post.glb', 'wood', 64), Barrel: K('runner/models/Barrel.glb', 'wood', 128), Crate: K('runner/models/Crate.glb', 'wood', 64),
  Beam_Low: K('runner/models/Beam_Low.glb', 'wood', 64), Net_Hang: K('runner/models/Net_Hang.glb', 'wood', 64), Beam_Jump: K('runner/models/Beam_Jump.glb', 'wood', 64), Pier_Lantern: K('runner/models/Pier_Lantern.glb', 'glowprop', 64),
  Fallen_Palm: K('runner/models/Fallen_Palm.glb', 'wood', 64), Fallen_Palm_Raised: K('runner/models/Fallen_Palm_Raised.glb', 'wood', 64), Beach_Boulder_Big: K('runner/models/Beach_Boulder_Big.glb', 'rock', 64),
  Shell_A: K('runner/models/Shell_A.glb', 'structure', 128, false), Shell_B: K('runner/models/Shell_B.glb', 'structure', 128, false), Starfish: K('runner/models/Starfish.glb', 'structure', 128, false),
  Island_Far_A: K('runner/models/Island_Far_A.glb', 'island', 8, false), Island_Far_B: K('runner/models/Island_Far_B.glb', 'island', 8, false), Dune_Backdrop: K('runner/models/Dune_Backdrop.glb', 'terrain', 32, false),
  Coral_Tower: K('runner/models/Coral_Tower.glb', 'coral', 128),
  Canyon_Wall: K('runner/models/Canyon_Wall.glb', 'rock', 48), Anemone: K('runner/models/Anemone.glb', 'coral', 256, false), Jellyfish: K('runner/models/Jellyfish.glb', 'jelly', 256, false), Reef_Rock_Low: K('runner/models/Reef_Rock_Low.glb', 'rock', 128),
  // the Shipwreck Grotto
  Sea_Mine: K('runner/models/Sea_Mine.glb', 'structure', 640), Net_Wall: K('runner/models/Net_Wall.glb', 'structure', 96, false),
  // Aggie details (ours, blender/runner/build_aggie.py)
  Research_Station: K('runner/models/Research_Station.glb', 'structure', 2), Howdy_Sign: K('runner/models/Howdy_Sign.glb', 'structure', 2),
  Research_Buoy_A: K('runner/models/Research_Buoy_A.glb', 'structure', 24), Research_Buoy_B: K('runner/models/Research_Buoy_B.glb', 'structure', 24),
  Collie_Body: K('runner/models/Collie_Body.glb', 'structure', 2),
  Volleyball: K('runner/models/Volleyball.glb', 'structure', 32), Sandcastle: K('runner/models/Sandcastle.glb', 'structure', 32),
  Jet_Ski: K('runner/models/Jet_Ski.glb', 'structure', 16), Ski_Ramp: K('runner/models/Ski_Ramp.glb', 'wood', 16),
  Sea_Stack_A: K('runner/models/Sea_Stack_A.glb', 'rock', 48), Sea_Stack_B: K('runner/models/Sea_Stack_B.glb', 'rock', 48),
  Runner_Board: K('runner/models/Runner_Board.glb', 'structure', 48),
  Aggie_Surf_Club: K('runner/models/Aggie_Surf_Club.glb', 'structure', 4), Lifeguard_Tower: K('runner/models/Lifeguard_Tower.glb', 'structure', 4),
  Foam_Ring: K('runner/models/Foam_Ring.glb', 'structure', 256, false),
  // a closed treasure chest whose lid opens when you jump it (chunks.ts animates the lid on its hinge)
  Chest_Base: K('runner/models/Chest_Base.glb', 'structure', 48), Chest_Lid: K('runner/models/Chest_Lid.glb', 'structure', 48),
  // the same chain drawn unlit (its rust colour as is), for the dark grotto where a lit chain disappears
  Chain_Glow: K('runner/models/Chain_Hang.glb', 'glow', 128, false),
  Cave_Roof: K('runner/models/Cave_Roof.glb', 'rock', 24), Cave_Mouth: K('runner/models/Cave_Mouth.glb', 'rock', 6), Cave_Wall: K('runner/models/Cave_Wall.glb', 'rock', 48), Cave_Arch: K('runner/models/Cave_Arch.glb', 'rock', 32), Ship_Hull_Half: K('runner/models/Ship_Hull_Half.glb', 'wood', 16), Ship_Rib: K('runner/models/Ship_Rib.glb', 'wood', 64), Chain_Hang: K('runner/models/Chain_Hang.glb', 'structure', 128), Glow_Coral: K('runner/models/Glow_Coral.glb', 'glow', 256, false), Anchor: K('runner/models/Anchor.glb', 'structure', 32),
  // ---- Kenney Pirate Kit + Nature Kit (CC0), restyled in blender/runner/import_kenney.py
  K_Rock_SandA: K('runner/models/K_Rock_SandA.glb', 'rock', 128), K_Rock_SandC: K('runner/models/K_Rock_SandC.glb', 'rock', 128), K_Rock_C: K('runner/models/K_Rock_C.glb', 'rock', 128),
  K_Log: K('runner/models/K_Log.glb', 'wood', 128), K_Barrel: K('runner/models/K_Barrel.glb', 'wood', 128), K_Crate: K('runner/models/K_Crate.glb', 'wood', 64),
  K_Palm_Fallen: K('runner/models/K_Palm_Fallen.glb', 'wood', 32), K_Palm_Raised: K('runner/models/K_Palm_Raised.glb', 'wood', 32),
  K_Palm_Bend: K('runner/models/K_Palm_Bend.glb', 'palm', 160), K_Palm_Straight: K('runner/models/K_Palm_Straight.glb', 'palm', 160), K_Palm_Small: K('runner/models/K_Palm_Small.glb', 'palm', 160),
  K_Bush: K('runner/models/K_Bush.glb', 'grass', 400, false), K_Bush_Large: K('runner/models/K_Bush_Large.glb', 'grass', 300, false),
  K_Grass: K('runner/models/K_Grass.glb', 'grass', 900, false), K_Grass_Tall: K('runner/models/K_Grass_Tall.glb', 'grass', 900, false),
  K_Flowers: K('runner/models/K_Flowers.glb', 'grass', 500, false), K_Flowers_Red: K('runner/models/K_Flowers_Red.glb', 'grass', 500, false),
  K_Rowboat: K('runner/models/K_Rowboat.glb', 'wood', 24), K_Canoe: K('runner/models/K_Canoe.glb', 'wood', 24), K_Hut: K('runner/models/K_Hut.glb', 'wood', 32),
  K_Watchtower: K('runner/models/K_Watchtower.glb', 'wood', 16), K_Campfire: K('runner/models/K_Campfire.glb', 'wood', 24), K_Chest: K('runner/models/K_Chest.glb', 'wood', 24),
  K_Crate_Bottles: K('runner/models/K_Crate_Bottles.glb', 'wood', 24), K_Flag: K('runner/models/K_Flag.glb', 'flag', 24), K_Shipwreck: K('runner/models/K_Shipwreck.glb', 'wood', 8),
  K_Cannon: K('runner/models/K_Cannon.glb', 'wood', 48), K_LogPile: K('runner/models/K_LogPile.glb', 'wood', 48), K_LogBig: K('runner/models/K_LogBig.glb', 'wood', 64),
  K_Barrels: K('runner/models/K_Barrels.glb', 'wood', 64), K_Tiki: K('runner/models/K_Tiki.glb', 'rock', 48), K_CrateStack: K('runner/models/K_CrateStack.glb', 'wood', 48),
  K_BoatRack: K('runner/models/K_BoatRack.glb', 'wood', 48), K_VolleyNet: K('runner/models/K_VolleyNet.glb', 'wood', 24),
  K_Rocks_Big: K('runner/models/K_Rocks_Big.glb', 'rock', 96),
  // reef gates (ours, blender/runner/build_gates.py): full-width low-poly walls with holes for the underwater biomes
  Reef_Gate_Mid: K('runner/models/Reef_Gate_Mid.glb', 'rock', 8), Reef_Gate_Low: K('runner/models/Reef_Gate_Low.glb', 'rock', 8), Reef_Gate_High: K('runner/models/Reef_Gate_High.glb', 'rock', 8),
  Reef_Gate_Twin: K('runner/models/Reef_Gate_Twin.glb', 'rock', 8), Gate_Ring: K('runner/models/Gate_Ring.glb', 'glow', 32, false), K_Rocks_BigA: K('runner/models/K_Rocks_BigA.glb', 'rock', 48), K_Fence: K('runner/models/K_Fence.glb', 'wood', 200, false),
};

/** Stand-ins used when a runner GLB is missing (e.g. the kit is still being built). Scale factors keep the footprint. */
export const FALLBACK: Record<string, { kit: string; scale?: [number, number, number]; dy?: number }> = {
  Cave_Wall: { kit: 'SRC_coastal_cliff_01', scale: [0.25, 1.6, 0.8] }, Cave_Arch: { kit: 'Arch_Hero', scale: [0.55, 0.55, 0.5] }, Ship_Hull_Half: { kit: 'Boat_Research', scale: [1.2, 1, 3] }, Ship_Rib: { kit: 'Arch_Hero', scale: [0.25, 0.42, 0.1] }, Chain_Hang: { kit: 'Rock_Pillar', scale: [0.2, 2.2, 0.2], dy: -6 }, Glow_Coral: { kit: 'Coral_Branch', scale: [1, 1, 1] }, Anchor: { kit: 'Rock_Pillar', scale: [0.6, 0.7, 0.3] },
  Pier_Deck: { kit: 'Pier_Platform', scale: [0.8, 1, 0.4] }, Pier_Deck_Broken: { kit: 'Pier_Platform', scale: [0.8, 1, 0.4] }, Pier_Rail_4m: { kit: 'Pier_Section', scale: [0.3, 0.1, 1] },
  Pier_Post: { kit: 'Rock_Pillar', scale: [0.3, 0.6, 0.3] }, Barrel: { kit: 'Rock_Boulder', scale: [0.35, 0.7, 0.4] }, Crate: { kit: 'Rock_Boulder', scale: [0.45, 0.7, 0.55] },
  Beam_Low: { kit: 'Driftwood_03', scale: [1.4, 1, 1], dy: 1.25 }, Net_Hang: { kit: 'Driftwood_03', scale: [1.4, 3, 1], dy: 1.3 }, Beam_Jump: { kit: 'Driftwood_03', scale: [1.4, 1.2, 1] }, Pier_Lantern: { kit: 'Rock_Pillar', scale: [0.1, 0.8, 0.1] },
  Fallen_Palm: { kit: 'Driftwood_01', scale: [1.25, 1.4, 1.4] }, Fallen_Palm_Raised: { kit: 'Driftwood_01', scale: [1.25, 1.4, 1.4], dy: 1.3 }, Beach_Boulder_Big: { kit: 'SRC_mk_rock_1', scale: [1.0, 1.0, 1.0] },
  Shell_A: { kit: 'Rock_Boulder', scale: [0.12, 0.1, 0.12] }, Shell_B: { kit: 'Rock_Boulder', scale: [0.1, 0.1, 0.1] }, Starfish: { kit: 'Coral_Table', scale: [0.2, 0.1, 0.2] },
  Island_Far_A: { kit: 'Reef_Stack_02', scale: [14, 5, 14] }, Island_Far_B: { kit: 'Reef_Stack_04', scale: [16, 6, 16] }, Dune_Backdrop: { kit: 'SRC_coastal_cliff_01', scale: [0.4, 0.6, 3.5] },
  Coral_Tower: { kit: 'Coral_Tube', scale: [1.8, 3.4, 1.8] },
  Canyon_Wall: { kit: 'SRC_coastal_cliff_01', scale: [0.25, 1.4, 0.8] }, Anemone: { kit: 'Coral_Tube', scale: [0.5, 0.5, 0.5] }, Jellyfish: { kit: 'Coral_Brain', scale: [0.55, 0.55, 0.55], dy: -0.45 }, Reef_Rock_Low: { kit: 'Rock_Slab', scale: [1, 0.9, 1] },
};

/** Kits whose GLB was authored in world position (cove uniques): recentre to a base pivot on load. */
for (const n of ['Reef_Stack_02', 'Reef_Stack_04', 'Reef_Stack_06', 'Arch_Hero', 'Boat_Research', 'SRC_coastal_cliff_01', 'SRC_coastal_cliff_02']) CATALOG[n].recenter = true;
