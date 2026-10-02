// Central configuration — tweak here, not scattered across modules.

export const SEED = Number(new URLSearchParams(location.search).get('seed') ?? 42);

export const CAM_DIST     = 400;   // for the reference-size park; scaled with the park

// Camera framing distances when a selection is focused (absolute world units, so
// they don't depend on how far out the user was when they clicked). These match
// the old "400 / zoom level" values at the default view.
export const CAM_FRAME_PERSON    = 50;   // click an agent
export const CAM_FRAME_PERSON_FROM_LIST = 115; // pick a team member from the overlay
export const CAM_FRAME_FOLLOW    = 90;   // following a walking agent
export const CAM_FRAME_LANDMARK_PER_RADIUS = 8; // landmark: distance = footprint radius × this …
export const CAM_FRAME_LANDMARK_MIN        = 70; // … but never closer than this
export const ISO_ELEVATION = Math.atan(1 / Math.sqrt(2)); // 35.264°

// The park is sized from the landmark layout at startup (src/world/parkBounds.js).
// REF_HALF is the original fixed half-size; prop densities and camera distance are
// scaled relative to it. MIN_HALF is the smallest the park may shrink to; EDGE_MARGIN
// is the gap kept between the outermost landmark's reach and the park edge.
export const PARK_REF_HALF    = 270;
export const PARK_MIN_HALF    = 140;
export const PARK_EDGE_MARGIN = 20;

export const DEFAULT_PALETTE = { primary: 0x999999, accent: 0xcccccc };

// Park environment colors
export const GRASS_COLOR = 0x4a7c3f;
export const PATH_COLOR  = 0x8B6914;
export const SKY_DAY     = 0x87CEEB;
export const SKY_DAWN    = 0xff7744;
export const SKY_NIGHT   = 0x0a0a1a;

export const GROUND_SIDE_COLOR = 0x5c3a1e;  // diorama box sides
export const GRASS_PATCH_COLOR = 0x3d6b32;  // ground detail patches
// Lake water (src/world/lake.js): colour goes from SHALLOW at the shore to DEEP in the middle
export const LAKE_SHALLOW_COLOR = 0x5cc4bc;
export const LAKE_DEEP_COLOR    = 0x103f6e;
export const LAKE_FOAM_COLOR    = 0xeaf6f3;  // shoreline foam
export const REED_COLOR        = 0x2d5a27;  // lake reeds
export const CLOUD_COLOR       = 0xffffff;  // cloud blobs

// People agent settings
// Uniform scale applied to every character model (no auto-fit)
export const AGENT_SCALE        = 1.5;
export const AGENT_SPEED        = 4.5; // world units per second (walking pace — see AGENT_WALK_TIMESCALE)
export const AGENT_SPRINT_SPEED = 12;  // world units per second (running to a project)
export const AGENT_TURN_RATE    = 10;  // how quickly an agent turns to face its travel direction (1/s; higher = snappier)

// Agent behaviour timers (seconds)
export const CHAT_MIN = 5;
export const CHAT_MAX = 15;
export const REST_MIN = 5;
export const REST_MAX = 20;

// Behaviour selection probabilities, rolled when a stroll ends.
// Walk on, chat with a nearby idle agent, or go idle (remainder).
export const ARRIVAL_WAVE_DURATION = 4;   // wave at a project landmark, then walk on
export const PROB_WALK = 0.65;
export const PROB_CHAT = 0.10;
// When going idle, relative weights of the idle activities:
//   bench  — walk to a free bench and sit (Sitting-1)
//   ground — walk to grass beside a path and sit down on it (Stand-To-Sit)
//   rest   — walk to grass beside a path and rest (Resting-1)
//   dance  — dance on the spot (Dancing-1..3)
// An unavailable choice (no free bench, no grass spot) falls back as noted in idleSelection.js.
export const IDLE_WEIGHTS = { bench: 0.30, ground: 0.20, rest: 0.25, dance: 0.25 };
export const DANCE_MIN = 6;
export const DANCE_MAX = 14;

// Grass spots for sitting/resting off the path (src/agents/grassSpots.js)
export const GRASS_SEARCH_RADIUS = 45;  // path samples within this of the agent are candidates
export const GRASS_EDGE_MIN      = 2;   // extra distance beyond the path edge (world units)
export const GRASS_EDGE_MAX      = 7;
export const GRASS_SPOT_SPACING  = 6;   // minimum distance between two claimed spots

// Animation clips in the character GLB, by role (names are case-sensitive).
//   clips    — the clips for this role; if several exist, one is picked at random
//   fallback — used (first one the model has) when none of `clips` exist, so custom
//              character models with fewer clips still animate
//   once     — play once and hold the last frame instead of looping
// Walking clips are played in place (root motion stripped, see assets/rootMotion.js).
// Their playback rate follows the agent's actual speed every frame so the feet
// match the ground (slowing as it slows, stopping as it stops); this clamps the
// rate so a big mismatch can't make the legs look frantic.
export const AGENT_WALK_TIMESCALE = { min: 0.3, max: 2.5 };

export const AGENT_CLIPS = {
  idle:      { clips: ['idle'] },
  walk:      { clips: ['Walking', 'Walking-3'],               fallback: ['walking', 'idle'] }, // picked once per agent
  run:       { clips: ['walking'],                            fallback: ['Walking', 'idle'] }, // sprint to a project
  greet:     { clips: ['Waving'],                             fallback: ['greeting', 'idle'] },
  dance:     { clips: ['Dancing-1', 'Dancing-2', 'Dancing-3'], fallback: ['idle'] },
  sitBench:  { clips: ['Sitting-1'],                          fallback: ['idle'] },
  sitGround: { clips: ['Stand-To-Sit'],                       fallback: ['Sitting-1', 'idle'], once: true },
  rest:      { clips: ['Resting-1'],                          fallback: ['idle'] },
};

// Terrain
export const TERRAIN_MAX_HEIGHT  = 10;   // maximum hill height in world units
export const TERRAIN_SCALE       = 4.0;   // base noise frequency: hill features across a 540-unit span (higher = more, smaller hills)
export const TERRAIN_MESA_STEPS  = 4;    // number of quantization steps (0 = smooth, 4 = mesa-like)
export const TERRAIN_MESA_BLEND  = 0;    // 0 = fully smooth hills, 1 = fully stepped (terraced mesas)

// Steering behaviour constants
export const AGENT_ARRIVE_RADIUS  = 10;  // slow-down zone (world units)
export const AGENT_SEP_RADIUS     = 8;   // separation distance
export const AGENT_SEP_STRENGTH   = 20;  // separation force magnitude
export const TERRAIN_HILL_POWER  = 1.8;   // >1 = broad flat valleys with distinct rises; 1 = evenly rolling
export const AGENT_WANDER_AMP     = 1.5; // wander perpendicular amplitude
export const AGENT_WANDER_FREQ    = 0.3; // wander oscillation frequency
export const AGENT_MAX_FORCE      = 40;  // max steering force per axis


// Custom landmark model sizes (`model_size` column in projects.csv). Applied on
// top of the auto-fit to the landmark footprint; unknown/empty values use 'medium'.
export const MODEL_SIZE_SCALE = { small: 0.6, medium: 1, large: 2 };

// Landmark fit (src/attractions/landmarkFit.js). Models are normalised so the
// geometric mean of their X/Z extents is LANDMARK_TARGET_SIDE (times the
// model_size multiplier); wide models therefore keep their proportions and grow
// their footprint. The longest side and height are clamped to these bounds.
export const LANDMARK_TARGET_SIDE = 20;
export const LANDMARK_MIN_EXTENT  = 8;
export const LANDMARK_MAX_EXTENT  = 90;
export const LANDMARK_MAX_HEIGHT  = 70;
// Space kept between a landmark's bounding circle and the path / plaza edge.
export const LANDMARK_CLEARANCE   = 8;
