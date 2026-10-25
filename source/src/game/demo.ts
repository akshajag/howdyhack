/**
 * The demo course (seed DEMO): a set sequence of sections that shows the whole game in about two minutes, gentler than
 * a normal run (tier 1 at most, difficulty capped) so a presenter on the camera gets through it. Each entry is a
 * pattern and the tide count it runs under (9-11 rising, 12 the 12th Tide's surge). After it the course carries on at
 * random from the beach.
 *
 *  beach      Reveille on the station steps, the HOWDY sign, sanderlings and pelicans, sandcastles, cannons and
 *             chests, a volleyball net to slide, crabs from 200 m
 *  pier       the broken pier's gaps, then down a ramp onto a jet ski
 *  channel    Bolivar Channel: free steering, buoys and logs, floating ramps (a flip), beached on a sandbar
 *  beach      back onto the sand, and onto a board at the water's edge
 *  surf       Shorebreak Point: air spots (a backflip off the lip through the coin arc), nets, flotsam, sea stacks
 *  coral      the wave collapses into a rip and you dive: the coral forest (turtles, garden eels, an octopus), reef
 *             gates with mines, the minefield, a jellyfish curtain, the fishing nets, the current canyon
 *  grotto     through the cave mouth into the Shipwreck Grotto (the wreck, glowing plankton), the curtains of chains
 *             with a current drifting you into them, the wreck's mines, then the Kraken's chamber (the boss), and out
 *  coral      the shark waters as the tide starts rising
 *  beach      up the slope onto the sand (Reveille races back to you), gulls diving at your lane,
 *             the storm building (wind, whitecaps, rain on the 11th)
 *  12th Tide  the surge arrives and floods the beach: lightning, rain, sandcastles slumping
 *  after      TIDE SURVIVED: the sun breaks out and a rainbow stands over the coast
 */
export const DEMO_SEED = 'DEMO';
/** the demo speeds up more slowly: the speed curve runs over distance x this (0.6: at the 12th Tide you're going about
 *  as fast as a normal run at 1.7 km, not 2.9) */
export const DEMO_PACE = 0.6;

export const DEMO_COURSE: [pattern: string, tide: number][] = [
  ['beach_intro', 1], ['beach_mixed', 2], ['beach_palms', 2],
  ['t_beach_pier', 3], ['pier_walkway', 3], ['pier_gauntlet', 4], ['t_pier_ski', 4],
  ['ski_open', 4], ['ski_ramps', 5], ['t_ski_beach', 5], ['beach_open_safe', 5], ['t_beach_surf', 5],
  ['surf_open_break', 6], ['surf_pier_break', 6], ['t_surf_dive', 7],
  ['coral_passage', 7], ['coral_arches', 7], ['coral_minefield', 8], ['coral_jellies', 8], ['coral_nets', 8], ['coral_current_canyon', 9],
  ['t_cave_mouth', 9], ['grotto_tunnel', 9], ['grotto_escape', 10], ['grotto_minefield', 10], ['grotto_kraken', 10], ['t_cave_exit', 11],
  ['coral_sharks', 11], ['t_surface_beach', 11], ['beach_wall', 11],
  ['s_arrive_beach', 12], ['s_flood_b', 12],
  ['beach_open', 1],
];

/** the demo course when you play as Reveille (land only): beach, the pier, Shorebreak Point, back up the beach, the
 *  12th Tide's flood */
export const DEMO_COURSE_LAND: [pattern: string, tide: number][] = [
  ['beach_intro', 1], ['beach_open', 1], ['beach_mixed', 2], ['beach_palms', 2],
  ['t_beach_pier', 3], ['pier_walkway', 3], ['pier_gauntlet', 4], ['t_pier_ski', 5],
  ['ski_open', 5], ['ski_ramps', 7], ['t_ski_beach', 8], ['beach_open_safe', 8], ['t_beach_surf', 8],
  ['surf_open_break', 9], ['surf_pier_break', 9], ['t_surf_beach', 10],
  ['beach_wall', 11],
  ['s_arrive_beach', 12], ['s_flood_b', 12],
  ['beach_open', 1],
];

export const isDemoSeed = (seed: string) => seed.trim().toUpperCase() === DEMO_SEED;
