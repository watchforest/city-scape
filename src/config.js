// Central configuration — tweak here, not scattered across modules.

export const SEED = Number(new URLSearchParams(location.search).get('seed') ?? 42);

export const CAM_DIST     = 400;   // for the reference-size park; scaled with the park
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
export const LAKE_COLOR        = 0x3a8fc1;  // semi-transparent lake
export const REED_COLOR        = 0x2d5a27;  // lake reeds
export const CLOUD_COLOR       = 0xffffff;  // cloud blobs

// People agent settings
export const AGENT_SPEED        = 12; // world units per second
export const AGENT_SPRINT_SPEED = 36; // world units per second (walking to project)

// Agent behaviour timers (seconds)
export const CHAT_MIN = 5;
export const CHAT_MAX = 15;
export const REST_MIN = 5;
export const REST_MAX = 20;

// Behaviour selection probabilities — states: walking | chatting | idle
// (idle then resolves to sitting-on-bench if a seat is free, else resting-on-grass).
export const PROB_WALK = 0.75;
export const PROB_CHAT = 0.10;
// Remainder (1 - PROB_WALK - PROB_CHAT) goes idle.

// Terrain
export const TERRAIN_MAX_HEIGHT  = 10;   // maximum hill height in world units
export const TERRAIN_SCALE       = 10.0;  // noise frequency (higher = more hills, smaller)
export const TERRAIN_MESA_STEPS  = 4;    // number of quantization steps (0 = smooth, 4 = mesa-like)
export const TERRAIN_MESA_BLEND  = 0.55; // 0 = fully smooth, 1 = fully stepped

// Steering behaviour constants
export const AGENT_ARRIVE_RADIUS  = 10;  // slow-down zone (world units)
export const AGENT_SEP_RADIUS     = 8;   // separation distance
export const AGENT_SEP_STRENGTH   = 20;  // separation force magnitude
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
