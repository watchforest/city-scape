// Central configuration — tweak here, not scattered across modules.

export const SEED = Number(new URLSearchParams(location.search).get('seed') ?? 42);

export const FRUSTUM_SIZE = 260;
export const CAM_DIST     = 400;
export const ISO_ELEVATION = Math.atan(1 / Math.sqrt(2)); // 35.264°

export const PARK_BOUNDS = [-270, -270, 270, 270];

export const CLUSTER_PALETTES = {
  ml:     { primary: 0x00aaff, accent: 0x66ddff },
  hci:    { primary: 0xff4400, accent: 0xff9966 },
  fab:    { primary: 0x00ff88, accent: 0x88ffcc },
  urb:    { primary: 0xffcc00, accent: 0xffee88 },
  bridge: { primary: 0xaa44ff, accent: 0xcc99ff },
};

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
export const AGENT_COUNT = 30;
export const AGENT_SPEED        = 12; // world units per second
export const AGENT_SPRINT_SPEED = 36; // world units per second (walking to project)

// Agent behaviour timers (seconds)
export const CHAT_MIN    = 5;
export const CHAT_MAX    = 15;
export const REST_MIN    = 5;
export const REST_MAX    = 20;
export const STRETCH_MIN = 3;
export const STRETCH_MAX = 5;

// Behaviour selection probabilities
export const PROB_WALK    = 0.50;
export const PROB_CHAT    = 0.15;
export const PROB_REST    = 0.25;
export const PROB_STRETCH = 0.10;
