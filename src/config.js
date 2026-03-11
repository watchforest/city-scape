// Central configuration — tweak here, not scattered across modules.

export const SEED = Number(new URLSearchParams(location.search).get('seed') ?? 42);

export const FRUSTUM_SIZE = 120;
export const CAM_DIST     = 400;
export const ISO_ELEVATION = Math.atan(1 / Math.sqrt(2)); // 35.264°

export const VORONOI_BOUNDS = [-200, -200, 200, 200];

export const CLUSTER_PALETTES = {
  ml:     { primary: 0x00aaff, accent: 0x66ddff },
  hci:    { primary: 0xff4400, accent: 0xff9966 },
  fab:    { primary: 0x00ff88, accent: 0x88ffcc },
  urb:    { primary: 0xffcc00, accent: 0xffee88 },
  bridge: { primary: 0xaa44ff, accent: 0xcc99ff },
};

export const GRID_COLOR     = 0x111111;
export const ROAD_COLOR     = 0x223344;
export const NETWORK_COLOR  = 0x00ffcc; // default network edge color

// People agent settings
export const AGENT_COUNT = 30;
export const AGENT_SPEED = 12; // world units per second

// Building placement
export const BUILDINGS_PER_DISTRICT_MIN = 3;
export const BUILDINGS_PER_DISTRICT_MAX = 6;
export const TOWER_HEIGHTS = [38, 42, 50, 35, 47, 44, 36, 45, 40, 48, 43];

// Hardcoded district positions (used until CSV force-layout is wired up)
export const DEFAULT_DISTRICTS = [
  { x: -100, y: -80,  cluster: 'ml',     id: 'ml-0' },
  { x: -60,  y: -110, cluster: 'ml',     id: 'ml-1' },
  { x: -120, y: -30,  cluster: 'ml',     id: 'ml-2' },
  { x:  90,  y: -80,  cluster: 'hci',    id: 'hci-0' },
  { x:  60,  y: -120, cluster: 'hci',    id: 'hci-1' },
  { x:  130, y: -40,  cluster: 'hci',    id: 'hci-2' },
  { x: -90,  y:  90,  cluster: 'fab',    id: 'fab-0' },
  { x: -50,  y:  120, cluster: 'fab',    id: 'fab-1' },
  { x:  80,  y:  80,  cluster: 'urb',    id: 'urb-0' },
  { x:  110, y:  120, cluster: 'urb',    id: 'urb-1' },
  { x:  0,   y:  0,   cluster: 'bridge', id: 'bridge-0' },
];
