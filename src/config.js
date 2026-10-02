// Central configuration — tweak here, not scattered across modules.

export const SEED = Number(new URLSearchParams(location.search).get('seed') ?? 42);

// Rendering budget. Retina/ProMotion screens would otherwise render 4× the pixels at
// up to 120 fps, which is what makes a laptop run warm. Raise these for quality,
// lower them for a cooler/quieter machine.
export const MAX_PIXEL_RATIO = 1.5;  // cap on devicePixelRatio (1 = crisp-less but cheapest)
export const MAX_FPS         = 60;   // frame cap (a 120 Hz display would otherwise render 120 fps)
export const SHADOW_UPDATE_EVERY = 2; // re-render the shadow map every Nth frame (1 = every frame); only agents move

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
export const AGENT_SPRINT_SPEED = 9;   // world units per second (running to a project)
export const AGENT_TURN_RATE    = 10;  // how quickly an agent turns to face its travel direction (1/s; higher = snappier)

// Walking on slopes (the hills reach ~20° where agents walk): going uphill slows an agent,
// downhill speeds it up a little, and it leans into the slope. Speed multiplier is
// clamp(1 − speedK × slope, min, max) with slope = rise/run along the direction of travel.
export const AGENT_SLOPE = { speedK: 1.4, speedMin: 0.6, speedMax: 1.15, lean: 0.5, maxLean: 0.2 }; // lean in radians per radian of slope

// Per-agent variation so the crowd doesn't move in lockstep.
export const AGENT_SPEED_JITTER = 0.12;        // each agent's walk/run speed is ±12% of the base
export const AGENT_BIAS_RANGE   = [0.5, 1.5];  // each agent's personal multiplier on every idle activity's weight

// Agent behaviour timers (seconds)
export const ARRIVAL_WAVE_DURATION = 4;   // wave at a project landmark, then walk on
export const CHAT_MIN = 12;   // a conversation lasts this long once everyone has arrived
export const CHAT_MAX = 26;
export const REST_MIN = 5;
export const REST_MAX = 20;

// Behaviour selection probabilities, rolled when a stroll ends.
// Walk on, chat with a nearby idle agent, or go idle (remainder).
export const PROB_WALK = 0.65;
export const PROB_CHAT = 0.10;
// When going idle, relative weights of the idle activities:
//   bench  — walk to a free bench and sit (Sitting-1)
//   ground — walk to grass beside a path and sit down on it (Stand-To-Sit)
//   rest   — walk to grass beside a path and rest (Resting-1)
//   dance  — dance on the spot (Dancing-1..3)
// An unavailable choice (no free bench, no grass spot) falls back as noted in idleSelection.js.
export const IDLE_WEIGHTS = { bench: 0.30, ground: 0.20, rest: 0.25, dance: 0.25 };
export const DANCE_MIN = 12;  // a dance lasts this long once the dancers have all arrived
export const DANCE_MAX = 24;

// Gatherings (src/agents/gatherings.js): chatting and dancing are done *together, standing in
// one place*. An initiator invites nearby free walkers; everyone walks to a ring around a
// meeting point; only once they have arrived does the activity start, for everyone at once.
// If fewer than two make it, nothing happens; if the group drops below two, it ends.
export const GATHER_MAX_SIZE      = 3;    // initiator + up to 2 others
export const GATHER_TIMEOUT       = 28;   // seconds to assemble before the stragglers are dropped
export const GATHER_CHAT_RADIUS   = 2.4;  // ring radius for a conversation (people stand close)
export const GATHER_DANCE_RADIUS  = 3.6;  // ring radius for a dance (room to move)
export const GATHER_JOIN_CHANCE   = 0.75; // each extra invitee accepts with this chance (the nearest always does)

// Chatting: who an agent seeks out when it decides to talk.
export const CHAT_SEEK_RADIUS     = 45;   // free walkers within this can be invited
// Conversation bubbles (ui/chatBubbles.js): one speaker at a time per conversation.
export const CHAT_BUBBLE_GAP      = 0.7;  // seconds of silence between two speakers
export const CHAT_BUBBLE_CLEARANCE = 22;  // don't start a bubble within this (horizontal) distance of a visible one

// Dancing is a group activity: nobody dances alone.
//   - A dance is only started when at least one free walker is near enough to be invited, and it
//     only *begins* once at least two agents have actually arrived. Agents merely standing around
//     don't count.
//   - The more free walkers around, the more attractive starting one is (weight × (1 + DANCE_CROWD_BOOST per extra)).
//   - An agent finishing a stroll near an ongoing dance usually joins it (DANCE_JOIN_CHANCE).
export const DANCE_GATHER_RADIUS = 45;   // free walkers within this can be invited
export const DANCE_START_CROWD   = 1;    // invitable free walkers needed for a new dance to be considered
export const DANCE_CROWD_BOOST   = 0.6;
export const DANCE_JOIN_RADIUS   = 60;
export const DANCE_JOIN_CHANCE   = 0.7;

// Time of day: at night agents favour sitting and resting, by day dancing. 0 = no effect.
// Applied as weight × (1 + boost × night), night = 0 (day) … 1 (full night).
export const NIGHT_WEIGHT_BOOST = { bench: 0.8, ground: 0.8, rest: 0.8, dance: -0.7 };

// Two walkers who pass close to each other may stop and wave (Waving-both-arms), and then
// sometimes stand and talk.
export const MEET_RADIUS        = 7;
export const MEET_CHANCE_PER_S  = 0.25;  // while two eligible agents are within MEET_RADIUS
export const MEET_COOLDOWN      = 40;    // seconds before an agent can meet again
export const MEET_WAVE_DURATION = 2.8;
export const MEET_CHAT_CHANCE   = 0.5;   // chance the two stay to talk after waving

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

//   groundSpeed — for clips without baked root motion (so none could be measured): the world
//              units/s the clip covers at timeScale 1, so its playback rate can follow speed
//   reverse  — play backwards from the end (used to stand up from a sit)
// Stand-To-Sit ends in the same pose as Sitting-1 (same root height), so a bench sit is
// Stand-To-Sit → Sitting-1, and standing up is Stand-To-Sit in reverse.
export const AGENT_RUN_GROUND_SPEED = 5.5;

export const AGENT_CLIPS = {
  idle:      { clips: ['idle'] },
  walk:      { clips: ['Walking', 'Walking-3'],               fallback: ['walking', 'idle'] }, // picked once per agent
  run:       { clips: ['walking'],                            fallback: ['Walking', 'idle'], groundSpeed: AGENT_RUN_GROUND_SPEED }, // sprint to a project
  greet:     { clips: ['Waving'],                             fallback: ['greeting', 'idle'] },
  greetBoth: { clips: ['Waving-both-arms'],                   fallback: ['Waving', 'greeting', 'idle'] }, // two agents meeting
  dance:     { clips: ['Dancing-1', 'Dancing-2', 'Dancing-3'], fallback: ['idle'] },
  sitBench:  { clips: ['Sitting-1'],                          fallback: ['idle'] },
  sitGround: { clips: ['Stand-To-Sit'],                       fallback: ['Sitting-1', 'idle'], once: true },
  standUp:   { clips: ['Stand-To-Sit'],                       fallback: ['idle'], once: true, reverse: true },
  rest:      { clips: ['Resting-1'],                          fallback: ['idle'] },
};

// Terrain
export const TERRAIN_MAX_HEIGHT  = 10;   // maximum hill height in world units
export const TERRAIN_SCALE       = 4.0;   // base noise frequency: hill features across a 540-unit span (higher = more, smaller hills)
export const TERRAIN_HILL_POWER  = 1.8;   // >1 = broad flat valleys with distinct rises; 1 = evenly rolling
export const TERRAIN_MESA_STEPS  = 4;    // number of quantization steps (0 = smooth, 4 = mesa-like)
export const TERRAIN_MESA_BLEND  = 0;    // 0 = fully smooth hills, 1 = fully stepped (terraced mesas)

// Steering behaviour constants
export const AGENT_ARRIVE_RADIUS  = 10;  // slow-down zone (world units)
export const AGENT_SEP_RADIUS     = 8;   // separation distance
export const AGENT_RADIUS         = 0.9; // agents never get closer than twice this (agents/collision.js)
export const LANDMARK_BLOCK_SCALE = 0.8; // share of a landmark's bounding radius that agents can't enter
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
