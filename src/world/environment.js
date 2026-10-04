/**
 * Park environment: trees, benches, lampposts, lake.
 *
 * Benches and lampposts sample arc-length-evenly along path curves,
 * offset sideways by a fixed distance, and oriented perpendicular to the path.
 * Trees fill the remaining area.
 *
 * Trees, benches, and lampposts are rendered via THREE.InstancedMesh through
 * the InstanceBatch helper so draw-calls scale with object-type count, not
 * object count.
 */

import * as THREE from 'three';
import { REED_COLOR } from '@/config.js';
import { shorePoint, getLakeFootprint } from './lake.js';
import { getParkBounds, getParkHalf, getParkAreaScale } from './parkBounds.js';
import { registerCircle, registerEllipse, registerSolid, isOccupied } from './obstacleRegistry.js';
import { registerBench } from './benchRegistry.js';
import { isOnPath } from '@/paths/pathTexture.js';
import { addContactShade } from './groundShade.js';
import { planPitch, buildPitch, scatterBushes, scatterFlowers, scatterMushrooms, scatterLogs } from './scatter.js';
import { InstanceBatch, VariantBatch } from '@/utils/InstanceBatch.js';
import { getTerrainHeight } from './terrain.js';
import {
  TERRAIN_MAX_HEIGHT, DECOR_TREE_FAMILIES, DECOR_TREE_SCALE, DECOR_TREE_DENSITY, DECOR_ROCK_SCATTER,
  DECOR_TREE_SIZE_BIAS, DECOR_GROVE_SIZE, DECOR_TREE_SQUASH, DECOR_ROCK_SCALE_BIG, DECOR_ROCK_SCALE_SMALL,
  DECOR_GROVES_PER_REF_PARK, DECOR_CONIFER_GROVE_SHARE, DECOR_GROVE_VARIANTS, DECOR_STRAY_CHANCE,
  DECOR_BUSH_DENSITY, DECOR_MUSHROOM_GROUPS, DECOR_LOG_COUNT,
} from '@/config.js';

const TREE_DENSITY   = 180;  // trees for the reference-size park; scaled by park area

const MAX_TRIES = 80;
const EDGE_INSET = 4; // trees keep this far in from the park edge so crowns don't overhang the frame

const BENCH_SCALE       = 1.4;  // benches are scaled up so a seated character fits them (seat top ≈ 1.7)
const BENCH_SIDE_CLEAR  = 1.5;  // metres from the path edge to the bench centre (added to half-width); the seat's front edge sits ~0.8 from the path
const BENCH_PLAZA_GAP   = 2.5;  // distance from a plaza disc's edge to its benches
const BENCH_FOOTPRINT   = 2.4;  // obstacle radius registered per bench (half its scaled length ≈ 2.45)
// The decor-model bench is 6.1 long (half = 3.05, baked by splitDecor.mjs), so it needs a bigger footprint.
// (benchRegistry's BENCH_APPROACH_SLACK must stay above this.)
const DECOR_BENCH_FOOTPRINT    = 3.2;
const DECOR_BENCH_SEAT_TOP     = 1.0; // seat height of the baked bench (0.63 × the 1.59 bake scale)
const DECOR_BENCH_STAND_OFF    = 1.7; // agents stop this far in front of its centre (seat front edge at ≈ 1.0), then sit back onto it
// Two seats along the 6.1-long bench, from its middle. A seated figure is ≈ 3.1 wide with its arms, so at ±1.45 its outer arm
// reached the bench's end; closer together they sit clear of the ends (and the inner arms just touch).
const DECOR_BENCH_SEATS        = [-1.1, 1.1];
const DECOR_BENCH_SHADE_RADIUS = 4;   // contact shadow around it
const DECOR_BENCH_BIN_OFFSET   = 3.9; // a bin stands this far from the bench centre, just past its end
const BENCH_PATH_GAP    = 1.0;  // a bench's centre must be at least this far outside any path surface
const BENCH_PAINT_GAP   = 0.5;  // … and this far from anything painted as path/plaza on the ground (isOnPath)
const LAMP_SIDE_CLEAR   = 3.0;
const BENCH_SPACING     = 40;   // arc-length metres between benches
const LAMP_SPACING      = 28;   // arc-length metres between lamps

// ── Instancing limits ─────────────────────────────────────────────────────────

const MAX_CONE_TREES   = 300;
const MAX_ROUND_TREES  = 300;
const MAX_PINE_LAYER0  = 300;
const MAX_PINE_LAYER1  = 300;
const MAX_BIRCHES      = 200;
const MAX_BUSHES       = 900;
const MAX_FLOWERS      = 4000;
const MAX_BENCHES      = 200;
const MAX_LAMPS        = 200;

// ── Materials (shared across all instances of each type) ──────────────────────

const MAT_TRUNK_DARK  = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
const MAT_TRUNK_MED   = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
// Foliage materials use vertexColors for the baked darker-underneath gradient (_shadeByHeight)
const MAT_CROWN_CONE  = new THREE.MeshLambertMaterial({ color: 0x2d6a2d, vertexColors: true });
const MAT_CROWN_ROUND = new THREE.MeshLambertMaterial({ color: 0x3a7a3a, vertexColors: true });
const MAT_TRUNK_BIRCH = new THREE.MeshLambertMaterial({ color: 0xd8d4c8 });
const MAT_CROWN_BIRCH = new THREE.MeshLambertMaterial({ color: 0x6fa83e, vertexColors: true });
const MAT_BUSH        = new THREE.MeshLambertMaterial({ color: 0x356b2c, vertexColors: true });
const MAT_FLOWER      = new THREE.MeshLambertMaterial({ color: 0xffffff });
const MAT_PINE_L0     = new THREE.MeshLambertMaterial({ color: 0x2d6a2d, vertexColors: true });
const MAT_PINE_L1     = new THREE.MeshLambertMaterial({ color: 0x246024, vertexColors: true });
const MAT_PLANK       = new THREE.MeshLambertMaterial({ color: 0x8B5e3c });
const MAT_LEG         = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
const MAT_BIN         = new THREE.MeshLambertMaterial({ color: 0x2f6b55, vertexColors: true });
const MAT_POLE        =new THREE.MeshLambertMaterial({ color: 0x333333 });
// MeshStandardMaterial so we can drive emissiveIntensity from dayCycle
const MAT_LAMP_HEAD   = new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: new THREE.Color(0xffd97a), emissiveIntensity: 0 });

// ── Geometry (unit / canonical — scale applied per-instance via Matrix4) ──────

/**
 * Bake a vertical brightness gradient into a geometry's vertex colours (darker underneath,
 * lighter on top), so foliage reads as a lit volume rather than a flat green blob. The
 * material must have `vertexColors: true`; per-instance leaf tints still multiply on top.
 */
function _shadeByHeight(geo, bottom, top) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / (max.y - min.y);
    const k = bottom + (top - bottom) * (t * t * (3 - 2 * t));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// Cone tree
const GEO_CONE_TRUNK  = new THREE.CylinderGeometry(0.25, 0.4, 1, 5);
const GEO_CONE_CROWN  = _shadeByHeight(new THREE.ConeGeometry(1, 1.6, 7), 0.55, 1.1);

// Round tree
const GEO_ROUND_TRUNK = new THREE.CylinderGeometry(0.2, 0.35, 1, 5);
const GEO_ROUND_CROWN = _shadeByHeight(new THREE.SphereGeometry(1, 8, 6), 0.55, 1.15);

// Birch (thin trunk), bushes and flowers
const GEO_BIRCH_TRUNK = new THREE.CylinderGeometry(0.14, 0.22, 1, 5);
const GEO_BUSH        = _shadeByHeight(new THREE.SphereGeometry(1, 7, 5), 0.6, 1.15);
const GEO_FLOWER      = new THREE.SphereGeometry(1, 5, 4);

// Layered pine (unit trunk + unit cone layer reused for both layers)
const GEO_PINE_TRUNK  = new THREE.CylinderGeometry(0.2, 0.35, 1, 5);
const GEO_PINE_LAYER  = _shadeByHeight(new THREE.ConeGeometry(1, 1.2, 6), 0.6, 1.1);

// Bench parts
const GEO_BENCH_SEAT  = new THREE.BoxGeometry(3.5, 0.22, 1);
const GEO_BENCH_BACK  = new THREE.BoxGeometry(3.5, 0.8, 0.18);
const GEO_BENCH_LEG   = new THREE.BoxGeometry(0.22, 1.1, 1);

// Litter bin: a tapered drum with a lid
const GEO_BIN         = _shadeByHeight(new THREE.CylinderGeometry(0.38, 0.3, 1, 8), 0.7, 1.1);

// Lamppost parts
const GEO_LAMP_POLE   = new THREE.CylinderGeometry(0.15, 0.2, 8, 6);
const GEO_LAMP_HEAD   = new THREE.SphereGeometry(0.5, 6, 5);

// ── Tree instance helpers ─────────────────────────────────────────────────────

const FLOWER_COLORS = [0xf2f2f2, 0xf5d142, 0xe0508a, 0xb07be0, 0xf08a3c].map(c => new THREE.Color(c));

/**
 * Per-instance leaf tint (multiplies the crown material): lighter or darker, and shifted
 * towards yellow by `warm` (0–1) so the park isn't one flat green.
 */
function _leafTint(rand, warm) {
  const l = 0.78 + rand() * 0.5;
  const y = rand() * warm;                       // yellow shift: more red, less blue
  return new THREE.Color(l * (1 + y * 0.45), l * (1 + y * 0.1), l * (1 - y * 0.35));
}

// Reusable scratch objects to avoid per-instance allocation in tight loops.
const _pos  = new THREE.Vector3();
const _rot  = new THREE.Euler();
const _scl  = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _mat  = new THREE.Matrix4();

/**
 * Build a Matrix4 from separate position/rotation/scale components without
 * allocating new objects (uses module-level scratch vars).
 */
function _compose(px, py, pz, ry, sx, sy, sz) {
  _pos.set(px, py, pz);
  _rot.set(0, ry, 0);
  _scl.set(sx, sy, sz);
  _quat.setFromEuler(_rot);
  _mat.compose(_pos, _quat, _scl);
  // Return a copy so callers can store it.
  return _mat.clone();
}

/**
 * Place a cone tree instance into the provided InstanceBatch pair.
 * @param {{ trunk: InstanceBatch, crown: InstanceBatch }} batches
 * @param {number} x
 * @param {number} z
 * @param {number} ry   World-space Y rotation (radians)
 * @param {Function} rand
 */
function addConeTree(batches, x, z, ry, rand) {
  const gy     = getTerrainHeight(x, z);
  const trunkH = 2 + rand() * 3;          // 2–5
  const crownR = 2.5 + rand() * 1.5;      // 2.5–4

  batches.trunk.add(_compose(x, gy + trunkH / 2, z, ry, 1, trunkH, 1));

  const crownCY = gy + trunkH + crownR * 0.7;
  addContactShade(x, z, crownR * 1.5, 0.45);
  batches.crown.add(_compose(x, crownCY, z, ry, crownR, crownR * 1.6, crownR), _leafTint(rand, 0));
}

/**
 * Place a round tree instance into the provided InstanceBatch pair.
 */
function addRoundTree(batches, x, z, ry, rand) {
  const gy     = getTerrainHeight(x, z);
  const trunkH = 1.5 + rand() * 2;        // 1.5–3.5
  const crownR = 3 + rand() * 2;          // 3–5

  batches.trunk.add(_compose(x, gy + trunkH / 2, z, ry, 1, trunkH, 1));

  const crownCY = gy + trunkH + crownR * 0.75;
  addContactShade(x, z, crownR * 1.5, 0.5);
  batches.crown.add(_compose(x, crownCY, z, ry, crownR, crownR, crownR), _leafTint(rand, 0.3));
}

/** Slender birch: pale trunk, tall narrow crown in a light fresh green (sometimes turning yellow). */
function addBirch(batches, x, z, ry, rand) {
  const gy     = getTerrainHeight(x, z);
  const trunkH = 3 + rand() * 2.5;        // 3–5.5
  const crownR = 2 + rand() * 1.2;        // 2–3.2

  batches.trunk.add(_compose(x, gy + trunkH / 2, z, ry, 0.8, trunkH, 0.8));
  const crownCY = gy + trunkH + crownR * 0.9;
  addContactShade(x, z, crownR * 1.5, 0.35);
  batches.crown.add(_compose(x, crownCY, z, ry, crownR, crownR * 1.5, crownR), _leafTint(rand, 0.6));
}

/** A low bush: one to three squashed blobs. */
function addBush(batch, x, z, rand) {
  const n = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const bx = x + (rand() - 0.5) * 2.2, bz = z + (rand() - 0.5) * 2.2;
    const r  = 0.9 + rand() * 0.9;
    addContactShade(bx, bz, r * 1.7, 0.3);
    batch.add(_compose(bx, getTerrainHeight(bx, bz) + r * 0.45, bz, rand() * Math.PI * 2, r, r * 0.7, r), _leafTint(rand, 0.2));
  }
}

/** A patch of small flowers in one colour family. */
function addFlowerPatch(batch, x, z, rand) {
  const colour = FLOWER_COLORS[Math.floor(rand() * FLOWER_COLORS.length)];
  const n = 9 + Math.floor(rand() * 10);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 2.8;
    const fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
    if (isOccupied(fx, fz, 0.3)) continue;
    const s = 0.4 + rand() * 0.3; // big enough to read from the default camera
    batch.add(_compose(fx, getTerrainHeight(fx, fz) + s * 0.8, fz, 0, s, s, s),
      colour.clone().multiplyScalar(0.85 + rand() * 0.3));
  }
}

/**
 * Place a layered pine into the provided InstanceBatch set (trunk, layer0, layer1).
 * Layer 1 may be skipped for trees that only have 2 cone layers — we always
 * generate 2 layers (never the optional 3rd from the original) to match the
 * two InstanceBatch slots available.
 */
function addLayeredPine(batches, x, z, ry, rand) {
  const gy     = getTerrainHeight(x, z);
  const trunkH = 1 + rand() * 2;          // 1–3

  batches.trunk.add(_compose(x, gy + trunkH / 2, z, ry, 1, trunkH, 1));

  const r0 = (2.5 + rand() * 1.5);        // 2.5–4
  const h0 = r0 * 1.2;
  const y0 = gy + trunkH + h0 * 0.4;
  const tint = _leafTint(rand, 0);
  addContactShade(x, z, r0 * 1.5, 0.5);
  batches.layer0.add(_compose(x, y0, z, ry, r0, h0, r0), tint);

  const r1 = r0 * 0.75;
  const h1 = r1 * 1.2;
  const y1 = gy + (trunkH + h0 * 0.55) + h1 * 0.4;
  batches.layer1.add(_compose(x, y1, z, ry, r1, h1, r1), tint);
}

// ── Bench instance helper ─────────────────────────────────────────────────────

// ── Decor-model instances (src/world/decor.js) ────────────────────────────────

/**
 * Split the loaded tree variants into groves (see DECOR_TREE_FAMILIES). Returns a function that,
 * given a position, says what to plant there: a variant from the grove's own palette (with the odd
 * stray) and the grove's size factor.
 */
function _makeGroves(variants, rand) {
  const byFamily = {};
  for (const [family, ids] of Object.entries(DECOR_TREE_FAMILIES)) byFamily[family] = variants.filter(v => ids.includes(v.id));
  const living = ['conifer', 'broadleaf'].filter(f => byFamily[f].length);
  // Unlisted variants (e.g. models added later) count as broadleaf rather than being dropped.
  const listed = new Set(Object.values(DECOR_TREE_FAMILIES).flat());
  byFamily.broadleaf.push(...variants.filter(v => !listed.has(v.id)));
  if (!living.length) return () => ({ variant: variants[Math.floor(rand() * variants.length)], age: 1 });

  const half = getParkHalf();
  const groves = Array.from({ length: Math.max(3, Math.round(DECOR_GROVES_PER_REF_PARK * getParkAreaScale())) }, () => {
    const family = living.length === 1 ? living[0] : (rand() < DECOR_CONIFER_GROVE_SHARE ? 'conifer' : 'broadleaf');
    const palette = [...byFamily[family]].sort(() => rand() - 0.5).slice(0, DECOR_GROVE_VARIANTS);
    const age = DECOR_GROVE_SIZE[0] + rand() * (DECOR_GROVE_SIZE[1] - DECOR_GROVE_SIZE[0]);
    return { x: (rand() * 2 - 1) * half, z: (rand() * 2 - 1) * half, family, palette, age };
  });

  // Returns { variant, age } for a position: age is the size factor of the grove it falls in.
  return (x, z) => {
    let g = groves[0], best = Infinity;
    for (const c of groves) {
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < best) { best = d; g = c; }
    }
    if (living.length > 1 && rand() < DECOR_STRAY_CHANCE) {
      const other = byFamily[g.family === 'conifer' ? 'broadleaf' : 'conifer'];
      return { variant: other[Math.floor(rand() * other.length)], age: g.age };
    }
    return { variant: g.palette[Math.floor(rand() * g.palette.length)], age: g.age };
  };
}

/** A decor tree: the given variant at a random size (grove age × skewed roll), spin and with a small tint. */
function addDecorTree(batches, { variant: v, age }, x, z, rand) {
  const roll = DECOR_TREE_SCALE[0] + Math.pow(rand(), DECOR_TREE_SIZE_BIAS) * (DECOR_TREE_SCALE[1] - DECOR_TREE_SCALE[0]);
  const s = roll * age;
  const squash = 1 + (rand() * 2 - 1) * DECOR_TREE_SQUASH; // taller-thinner or shorter-wider
  const crownR = Math.max(v.size[0], v.size[2]) / 2 * s;
  const l = 0.85 + rand() * 0.3, warm = rand() * 0.25;
  addContactShade(x, z, crownR * 1.5, 0.5);
  registerCircle(x, z, 1.2 * s); // trunk: keeps bushes, rocks and grass out of it
  registerSolid(x, z, 0.45 * s);  // … and people walk round it
  const spot = { x, z, r: crownR };
  batches.get(v.id).add(
    _compose(x, getTerrainHeight(x, z) - 0.15 * s, z, rand() * Math.PI * 2, s / Math.sqrt(squash), s * squash, s / Math.sqrt(squash)),
    new THREE.Color(l * (1 + warm * 0.4), l * (1 + warm * 0.1), l * (1 - warm * 0.3)),
  );
  return spot;
}

let _benchCount = 0;

/**
 * Add all four bench part instances (plus a bin beside every second one) for a single bench placement.
 * @param {{ seat: InstanceBatch, back: InstanceBatch, leftLeg: InstanceBatch, rightLeg: InstanceBatch }} batches
 * @param {number} x
 * @param {number} z
 * @param {number} facingAngle  rotation.y for the bench group
 */
function addBench(batches, x, z, facingAngle) {
  const gy = getTerrainHeight(x, z);
  const benchRootQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facingAngle, 0));
  const benchRoot  = new THREE.Matrix4().compose(
    new THREE.Vector3(x, gy, z),
    benchRootQ,
    new THREE.Vector3(BENCH_SCALE, BENCH_SCALE, BENCH_SCALE) // scales the parts' offsets and sizes too
  );

  // Decor-model bench: already at its final size, one instance per part (seat, back, legs).
  if (batches.model) {
    const placed = new THREE.Matrix4().compose(new THREE.Vector3(x, gy, z), benchRootQ, new THREE.Vector3(1, 1, 1));
    for (const b of batches.model) b.add(placed);
    addContactShade(x, z, DECOR_BENCH_SHADE_RADIUS, 0.3);
    if (_benchCount++ % 2 === 0) {
      const binAt = new THREE.Matrix4().multiplyMatrices(benchRoot, new THREE.Matrix4().makeTranslation(DECOR_BENCH_BIN_OFFSET / BENCH_SCALE, 0.5, 0.15));
      batches.bin.add(binAt);
    }
    return;
  }

  // Each part: local position → transform by benchRoot
  const _localPart = (lx, ly, lz) => {
    const localM = new THREE.Matrix4().compose(
      new THREE.Vector3(lx, ly, lz),
      new THREE.Quaternion(), // no extra rotation on parts
      new THREE.Vector3(1, 1, 1)
    );
    return new THREE.Matrix4().multiplyMatrices(benchRoot, localM);
  };

  addContactShade(x, z, 3.2, 0.3);
  if (_benchCount++ % 2 === 0) batches.bin.add(_localPart(2.3, 0.5, 0.15)); // a bin beside every second bench
  batches.seat.add(_localPart(0, 1.1, 0));
  batches.back.add(_localPart(0, 1.6, -0.42));
  batches.leftLeg.add(_localPart(-1.4, 0.55, 0));
  batches.rightLeg.add(_localPart(1.4, 0.55, 0));
}

// ── Lamppost instance helper ──────────────────────────────────────────────────

/**
 * Add a lamppost at world position (x, z).
 * No PointLights — the light on the ground and plants is a baked texture (lampLight.js), fed with these positions.
 */
function addLamppost(batches, x, z) {
  const gy = getTerrainHeight(x, z);
  if (batches.model) {
    for (const b of batches.model) b.add(_compose(x, gy, z, 0, 1, 1, 1)); // pole and lantern glass, already at final size
  } else {
    batches.pole.add(_compose(x, gy + 4,   z, 0, 1, 1, 1));
    batches.head.add(_compose(x, gy + 8.5, z, 0, 1, 1, 1));
  }
}

// ── Arc-length path sampling ──────────────────────────────────────────────────

// Offset = half the path's actual width here + clearance: merged ribbons are much wider than the default 8, so a fixed
// half-width would put props inside the path (and they'd be rejected). Width defaults to 8 (single path).
const PROP_STEP = 2; // metres between the points props are tried at

/** Points every `step` along all paths: { x, z, tx, tz (unit tangent), hw (half width) }. */
function _pathSamples(pathSegments, step) {
  const out = [];
  for (const { pts } of pathSegments) {
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i].u ?? pts[i].x ?? 0, az = pts[i].v ?? pts[i].y ?? 0;
      const bx = pts[i - 1].u ?? pts[i - 1].x ?? 0, bz = pts[i - 1].v ?? pts[i - 1].y ?? 0;
      const dx = ax - bx, dz = az - bz, len = Math.hypot(dx, dz);
      if (len < 0.001) continue;
      carry += len;
      while (carry >= step) {
        carry -= step;
        const t = (len - carry) / len;
        out.push({ x: bx + dx * t, z: bz + dz * t, tx: dx / len, tz: dz / len, hw: (pts[i].width ?? 8) / 2 });
      }
    }
  }
  return out;
}

/** Points every `step` round a plaza's rim, going clockwise, so the right-hand side (+1) is the outside. */
function _plazaSamples({ cx, cz, edgeR }, step) {
  const n = Math.max(8, Math.round(2 * Math.PI * edgeR / step));
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = edgeR - BENCH_PLAZA_GAP; // the plaza disc itself
    out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, tx: Math.sin(a), tz: -Math.cos(a), hw: 1 });
  }
  return out;
}

/**
 * Place props along `samples` (see _pathSamples): at each sample whose nearest earlier prop is ≥ `spacing` away, try the
 * given sides × offsets (from the path edge) until `accept(x, z, facingAngle)` says yes, then `place` it. `placed` holds
 * the sample points of the props so far, so the spacing also holds between different paths.
 */
function _placeProps(samples, placed, spacing, sides, offsets, accept, place) {
  const s2 = spacing * spacing;
  for (const s of samples) {
    if (placed.some(p => (p.x - s.x) ** 2 + (p.z - s.z) ** 2 < s2)) continue;
    let done = false;
    for (const side of sides) {
      for (const off of offsets) {
        // Perpendicular on `side`; the inward direction (back towards the path) is its opposite, and rotation.y = a faces (sin a, cos a).
        const px = -s.tz * side, pz = s.tx * side;
        const x = s.x + px * (s.hw + off), z = s.z + pz * (s.hw + off);
        const facing = Math.atan2(-px, -pz);
        if (!accept(x, z, facing)) continue;
        place(x, z, facing);
        placed.push({ x: s.x, z: s.z, px: x, pz: z });
        done = true;
        break;
      }
      if (done) break;
    }
  }
}

/**
 * True if (x, z) is at least `gap` outside every path ribbon, using each ribbon sample's
 * actual width (pathSegments' pts carry `.width`; default 8).
 */
function _clearOfPaths(x, z, pathSegments, gap) {
  for (const { pts } of pathSegments) {
    for (const p of pts) {
      const px = p.u ?? p.x ?? 0, pz = p.v ?? p.y ?? 0;
      const reach = (p.width ?? 8) / 2 + gap;
      if ((x - px) ** 2 + (z - pz) ** 2 < reach * reach) return false;
    }
  }
  return true;
}

// ── Random clear placement ────────────────────────────────────────────────────

function _randomClear(rand, margin = 4) {
  for (let i = 0; i < MAX_TRIES; i++) {
    const half = getParkHalf() - EDGE_INSET;
    const x = (rand() * 2 - 1) * half;
    const z = (rand() * 2 - 1) * half;
    if (!isOccupied(x, z, margin)) return { x, z };
  }
  return null;
}

// ── Lake builder ──────────────────────────────────────────────────────────────

const LAKE_RX = 40;
const LAKE_RZ = 26;

/**
 * Find the lake position without building any geometry. Call this before
 * bakePathMask so the lake area can be included in the mask.
 *
 * The lake should sit well inland: among spots that clear every project node and
 * every route between nodes (where paths will run), prefer the one furthest from
 * the park edge. Constraints are relaxed tier by tier on small or crowded parks.
 *
 * @param {ProjectNode[]} projectNodes
 * @param {number[][]}    routeSegments — [ax, az, bx, bz] straight lines between connected nodes
 * @returns {{ x, z, rx, rz } | null}
 */
export function findLakePosition(projectNodes, routeSegments = []) {
  const STEP = 10;
  // Footprint of the lake plus its banks (≈ 1.5 radii; see lake.js)
  const EXT_X = LAKE_RX * 1.5, EXT_Z = LAKE_RZ * 1.5;
  // [min distance to a node, min distance to a route, min slack to the park edge]
  const TIERS = [[75, 62, 25], [60, 48, 12], [50, 0, 0]];

  const nodes = projectNodes.map(p => [p.layoutU ?? 0, p.layoutV ?? 0]);
  const half = getParkHalf();

  const segDist = (px, pz, [ax, az, bx, bz]) => {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  };

  // Evaluate every grid spot once.
  const spots = [];
  for (let gx = -half; gx <= half; gx += STEP) {
    for (let gz = -half; gz <= half; gz += STEP) {
      const slack = Math.min(half - Math.abs(gx) - EXT_X, half - Math.abs(gz) - EXT_Z);
      if (slack < 0) continue;
      let nodeD = Infinity, routeD = Infinity;
      for (const [ox, oz] of nodes) nodeD = Math.min(nodeD, Math.hypot(gx - ox, gz - oz));
      for (const seg of routeSegments) routeD = Math.min(routeD, segDist(gx, gz, seg));
      spots.push({ gx, gz, slack, nodeD, routeD });
    }
  }

  for (const [nodeMin, routeMin, slackMin] of TIERS) {
    let best = null, bestScore = -Infinity;
    for (const s of spots) {
      if (s.nodeD < nodeMin || s.routeD < routeMin || s.slack < slackMin) continue;
      // Prefer inland (large slack to the edge); clearance from paths is a mild bonus.
      const score = Math.min(s.slack, 90) + 0.4 * Math.min(s.nodeD, 100);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (best) return { x: best.gx, z: best.gz, rx: LAKE_RX, rz: LAKE_RZ };
  }
  return null;
}

/**
 * Reeds along the waterline and the lake's obstacle footprint. The basin and the
 * water surface themselves live in lake.js (terrain dip + water shader).
 */
function buildLake(scene, lakePos, rand) {
  if (!lakePos) return null;

  const REED_COUNT = 34;
  const reedMat = new THREE.MeshLambertMaterial({ color: REED_COLOR });

  for (let i = 0; i < REED_COUNT; i++) {
    const angle = (i / REED_COUNT) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const pt    = shorePoint(angle, -0.06 + rand() * 0.10); // a little outside … a little inside the waterline
    const h     = 1.5 + rand() * 2;
    const reed  = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, h, 4), reedMat);
    reed.position.set(pt.x, getTerrainHeight(pt.x, pt.z) + h / 2 - 0.1, pt.z);
    reed.rotation.z = (rand() - 0.5) * 0.12;
    reed.castShadow = true;
    scene.add(reed);
  }

  // Keep trees, grass and props off the water and its sandy banks.
  const fp = getLakeFootprint();
  registerEllipse(fp.x, fp.z, fp.rx, fp.rz);
  return lakePos;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildEnvironment(scene, projectNodes, pathGraph, rand, pathSegments, plazaRadius, lakePos, decor = null) {
  const segs = pathSegments ?? [];
  // Instancing caps grow with the park (never below the reference-size caps).
  const cap = n => Math.ceil(n * Math.max(1, getParkAreaScale()));

  // ── Lake first so all subsequent placement can exclude it ───────────────
  buildLake(scene, lakePos, rand);

  // ── InstanceBatch sets ──────────────────────────────────────────────────

  // Trees — 3 types × 2 parts each
  const coneBatches = {
    trunk: new InstanceBatch(GEO_CONE_TRUNK,  MAT_TRUNK_DARK,  cap(MAX_CONE_TREES)),
    crown: new InstanceBatch(GEO_CONE_CROWN,  MAT_CROWN_CONE,  cap(MAX_CONE_TREES)),
  };
  const roundBatches = {
    trunk: new InstanceBatch(GEO_ROUND_TRUNK, MAT_TRUNK_MED,   cap(MAX_ROUND_TREES)),
    crown: new InstanceBatch(GEO_ROUND_CROWN, MAT_CROWN_ROUND, cap(MAX_ROUND_TREES)),
  };
  const pineBatches = {
    trunk:  new InstanceBatch(GEO_PINE_TRUNK, MAT_TRUNK_MED,   cap(MAX_ROUND_TREES)),
    layer0: new InstanceBatch(GEO_PINE_LAYER, MAT_PINE_L0,     cap(MAX_PINE_LAYER0)),
    layer1: new InstanceBatch(GEO_PINE_LAYER, MAT_PINE_L1,     cap(MAX_PINE_LAYER1)),
  };

  const birchBatches = {
    trunk: new InstanceBatch(GEO_BIRCH_TRUNK, MAT_TRUNK_BIRCH, cap(MAX_BIRCHES)),
    crown: new InstanceBatch(GEO_ROUND_CROWN, MAT_CROWN_BIRCH, cap(MAX_BIRCHES)),
  };
  const bushBatch   = new InstanceBatch(GEO_BUSH,   MAT_BUSH,   cap(MAX_BUSHES));
  const flowerBatch = new InstanceBatch(GEO_FLOWER, MAT_FLOWER, cap(MAX_FLOWERS));
  flowerBatch.getMesh().castShadow = false; // too small to matter, and a lot of shadow-pass work

  // Benches: the decor model (one batch per part: seat, back, legs) or the four procedural parts, plus bins.
  const benchModel = decor?.bench?.[0] ?? null;
  const benchFootprint = benchModel ? DECOR_BENCH_FOOTPRINT : BENCH_FOOTPRINT;
  const benchSeat = benchModel ? [DECOR_BENCH_SEAT_TOP, DECOR_BENCH_STAND_OFF, DECOR_BENCH_SEATS] : []; // → registerBench(seatTop, standOff, seatOffsets)
  const benchBatches = {
    ...(benchModel
      ? { model: benchModel.parts.map(p => new InstanceBatch(p.geometry, p.material, cap(MAX_BENCHES))) }
      : {
        seat:     new InstanceBatch(GEO_BENCH_SEAT, MAT_PLANK, cap(MAX_BENCHES)),
        back:     new InstanceBatch(GEO_BENCH_BACK, MAT_PLANK, cap(MAX_BENCHES)),
        leftLeg:  new InstanceBatch(GEO_BENCH_LEG,  MAT_LEG,   cap(MAX_BENCHES)),
        rightLeg: new InstanceBatch(GEO_BENCH_LEG,  MAT_LEG,   cap(MAX_BENCHES)),
      }),
    bin: new InstanceBatch(GEO_BIN, MAT_BIN, cap(MAX_BENCHES)),
  };

  // Lampposts: the decor model (pole + lantern; the glass takes the emissive lamp material that DayCycle
  // drives) or the procedural pole + head, plus the ground halo. No PointLights.
  const lampModel = decor?.lamp?.[0] ?? null;
  const lampBatches = {
    ...(lampModel
      ? {
        model: lampModel.parts.map(p => new InstanceBatch(
          p.geometry, /vidro|glass/i.test(p.materialName) ? MAT_LAMP_HEAD : p.material, cap(MAX_LAMPS))),
      }
      : {
        pole: new InstanceBatch(GEO_LAMP_POLE, MAT_POLE,      cap(MAX_LAMPS)),
        head: new InstanceBatch(GEO_LAMP_HEAD, MAT_LAMP_HEAD, cap(MAX_LAMPS)),
      }),
  };

  // ── Lampposts and benches, spread over every path and plaza ─────────────
  // Walk along each path (and round each plaza) in small steps; a prop goes in wherever the nearest one of its kind is
  // at least `spacing` away *and* a spot beside the path is free — trying either side and a few distances out. A spot
  // that is blocked (tree, rock, another path) just delays the prop to the next step, so no stretch is left bare.
  const lampSpots = [], benchSpots = [];
  const plazas = (plazaRadius ? projectNodes : [])
    .filter(p => plazaRadius.get(p.id))
    .map(p => ({ cx: p.layoutU, cz: p.layoutV, edgeR: plazaRadius.get(p.id) + BENCH_PLAZA_GAP }));
  const pathSamples = _pathSamples(segs, PROP_STEP);
  const plazaSamples = plazas.flatMap(pl => _plazaSamples(pl, PROP_STEP));

  const acceptLamp = (x, z) => !isOccupied(x, z, 2) && !isOnPath(x, z, 1);
  const lampSides = [-1, 1], lampOffsets = [LAMP_SIDE_CLEAR, LAMP_SIDE_CLEAR + 1.5, LAMP_SIDE_CLEAR + 3];
  for (const samples of [pathSamples, plazaSamples]) {
    _placeProps(samples, lampSpots, LAMP_SPACING, lampSides, lampOffsets, acceptLamp, (x, z) => {
      addLamppost(lampBatches, x, z);
      registerCircle(x, z, 1.0);
      registerSolid(x, z, 0.4);
    });
  }

  // Check against the real path widths, not the 2-unit-cell path grid: that grid reaches ~2 units past the path edge,
  // which would push benches away from it.
  const acceptBench = (x, z) => !isOccupied(x, z, benchFootprint - 0.4, true) && _clearOfPaths(x, z, segs, BENCH_PATH_GAP) && !isOnPath(x, z, BENCH_PAINT_GAP);
  const benchSides = [1, -1], benchOffsets = [BENCH_SIDE_CLEAR, BENCH_SIDE_CLEAR + 1.5, BENCH_SIDE_CLEAR + 3];
  for (const samples of [pathSamples, plazaSamples]) {
    _placeProps(samples, benchSpots, BENCH_SPACING, benchSides, benchOffsets, acceptBench, (x, z, facingAngle) => {
      addBench(benchBatches, x, z, facingAngle);
      registerCircle(x, z, benchFootprint);
      registerBench(x, z, facingAngle, ...benchSeat);
      // Walkers go round it: three small circles along its length (small enough to leave the seat's stand point free).
      const ax = Math.cos(facingAngle), az = -Math.sin(facingAngle), half = benchFootprint * 0.6;
      for (const k of [-1, 0, 1]) registerSolid(x + ax * half * k, z + az * half * k, 0.6);
    });
  }

  // ── The football pitch: goal, ball and a mown square (planned before the trees, so they keep off it) ──
  const pitch = decor?.goal?.length ? planPitch(rand) : null;
  if (pitch) buildPitch(scene, decor, pitch);

  // ── Trees (random, avoiding all registry obstacles) ──────────────────────
  // Decor-model trees when they loaded; otherwise the procedural cone / round / pine / birch trees.
  const decorTrees = decor?.tree ?? [];
  const treeSpots = []; // { x, z, r } of the decor trees (mushrooms grow at their feet)
  const treeCount = Math.round(TREE_DENSITY * (decorTrees.length ? DECOR_TREE_DENSITY : 1) * getParkAreaScale());
  const pickTree = decorTrees.length ? _makeGroves(decorTrees, rand) : null;
  const decorTreeBatches = new Map(decorTrees.map(v => [v.id, new VariantBatch(v, treeCount)]));
  for (let i = 0; i < treeCount; i++) {
    const pos = _randomClear(rand, decorTrees.length ? 6 : 4);
    if (!pos) continue;
    if (decorTrees.length) { treeSpots.push(addDecorTree(decorTreeBatches, pickTree(pos.x, pos.z), pos.x, pos.z, rand)); continue; }
    const ry   = rand() * Math.PI * 2;
    const pick = rand();
    if (pick < 0.25)      addConeTree(coneBatches,   pos.x, pos.z, ry, rand);
    else if (pick < 0.52) addRoundTree(roundBatches,  pos.x, pos.z, ry, rand);
    else if (pick < 0.75) addLayeredPine(pineBatches,  pos.x, pos.z, ry, rand);
    else                  addBirch(birchBatches,      pos.x, pos.z, ry, rand);
  }

  // ── Undergrowth: bushes and flower patches (small, so they don't block anyone) ──
  // From the decor models when they loaded, else the procedural blobs.
  const area = getParkAreaScale();
  const scattered = []; // decor batches to finalise
  const flowerSpots = [];
  if (decor?.bush?.length) {
    scattered.push(...scatterBushes(rand, decor.bush, { count: Math.round(TREE_DENSITY * DECOR_BUSH_DENSITY * area), randomClear: _randomClear }));
  } else {
    const bushCount = Math.round(TREE_DENSITY * 1.6 * area);
    for (let i = 0; i < bushCount; i++) {
      const pos = _randomClear(rand, 3);
      if (pos) addBush(bushBatch, pos.x, pos.z, rand);
    }
  }
  const flowerPatches = Math.round(TREE_DENSITY * 0.5 * area);
  if (decor?.flower?.length || decor?.flowerpatch?.length) {
    const f = scatterFlowers(rand, decor.flower, decor.flowerpatch, { count: flowerPatches, randomClear: _randomClear });
    scattered.push(...f.batches);
    flowerSpots.push(...f.spots);
  } else {
    for (let i = 0; i < flowerPatches; i++) {
      const pos = _randomClear(rand, 3);
      if (pos) { addFlowerPatch(flowerBatch, pos.x, pos.z, rand); flowerSpots.push(pos); }
    }
  }
  if (decor?.mushroom?.length) scattered.push(...scatterMushrooms(rand, decor.mushroom, treeSpots, { count: Math.round(DECOR_MUSHROOM_GROUPS * area) }));
  if (decor?.log?.length) scattered.push(...scatterLogs(rand, decor.log, { count: Math.round(DECOR_LOG_COUNT * area), randomClear: _randomClear }));

  // ── Rocks (boulder groups on steep slopes, loose rocks on flat ground) ─────
  _buildRocks(scene, rand, decor?.rock ?? []);

  // ── Finalize all InstanceBatches (set count + add to scene) ─────────────
  for (const b of Object.values(coneBatches))  b.finalize(scene);
  for (const b of Object.values(roundBatches)) b.finalize(scene);
  for (const b of Object.values(pineBatches))  b.finalize(scene);
  for (const b of Object.values(birchBatches)) b.finalize(scene);
  for (const b of decorTreeBatches.values())   b.finalize(scene);
  // (rock batches finalise themselves inside _buildRocks)
  for (const b of scattered)                   b.finalize(scene);
  bushBatch.finalize(scene);
  flowerBatch.finalize(scene);
  for (const b of Object.values(benchBatches).flat()) b.finalize(scene);
  for (const b of Object.values(lampBatches).flat())  b.finalize(scene);

  // Lamp materials so dayCycle can drive emissive + halo opacity; the pitch (the ground paints the mown square);
  // and where the flowers are (butterflies visit them).
  return {
    lampHeadMat: MAT_LAMP_HEAD, pitch, flowerSpots,
    lamps: lampSpots.map(p => ({ x: p.px, z: p.pz })), benches: benchSpots.map(p => ({ x: p.px, z: p.pz })),
    pathSamples, plazas,
  };
}

// ── Rock outcroppings ─────────────────────────────────────────────────────────

const ROCK_COLORS = [0x7a7060, 0x6a6258, 0x857a6e, 0x908880];
const BIG_ROCK_WIDTH = 2.2; // decor rocks at least this wide count as boulders; the rest are small rocks and pebbles

/**
 * Boulder groups on steep slopes plus loose rocks scattered over flat ground, from the decor rock
 * models (one InstancedMesh per variant). Falls back to the procedural boulders if none loaded.
 */
function _buildRocks(scene, rand, variants) {
  if (!variants.length) { _buildProceduralRocks(scene, rand); return; }

  const big   = variants.filter(v => Math.max(v.size[0], v.size[2]) >= BIG_ROCK_WIDTH);
  const small = variants.filter(v => !big.includes(v));
  const batches = new Map(variants.map(v => [v.id, new VariantBatch(v, 1200)]));

  const logUniform = ([lo, hi]) => lo * Math.pow(hi / lo, rand()); // many small, fewer big
  const place = (v, x, z, scale) => {
    const r = Math.max(v.size[0], v.size[2]) / 2 * scale;
    const l = 0.85 + rand() * 0.3;
    addContactShade(x, z, r * 1.6, 0.4);
    registerSolid(x, z, r * 0.8);
    // Sunk a little into the ground so a rock on a slope doesn't hover on its downhill side; each rock
    // is also stretched a little differently in width, depth and height.
    batches.get(v.id).add(
      _compose(x, getTerrainHeight(x, z) - v.size[1] * scale * 0.12, z, rand() * Math.PI * 2,
        scale * (0.85 + rand() * 0.35), scale * (0.8 + rand() * 0.4), scale * (0.85 + rand() * 0.35)),
      new THREE.Color(l, l, l * 0.97),
    );
  };

  // Boulder groups on steep slopes: one or two big rocks with a few small ones around them.
  const PROBE = 4;
  const COUNT = Math.round(120 * getParkAreaScale());
  const HALF  = getParkHalf() - 6;
  let groups = 0;
  for (let attempt = 0; attempt < COUNT * 6 && groups < COUNT; attempt++) {
    const x = (rand() * 2 - 1) * HALF, z = (rand() * 2 - 1) * HALF;
    const h  = getTerrainHeight(x, z);
    const slope = Math.max(Math.abs(h - getTerrainHeight(x + PROBE, z)), Math.abs(h - getTerrainHeight(x, z + PROBE))) / PROBE;
    if (slope < 0.35 || h < TERRAIN_MAX_HEIGHT * 0.2 || isOccupied(x, z, 5)) continue;

    const bigCount = 1 + Math.floor(rand() * 2);
    for (let b = 0; b < bigCount && big.length; b++) {
      place(big[Math.floor(rand() * big.length)], x + (rand() - 0.5) * 6, z + (rand() - 0.5) * 6, logUniform(DECOR_ROCK_SCALE_BIG));
    }
    const smallCount = 1 + Math.floor(rand() * 3);
    for (let b = 0; b < smallCount && small.length; b++) {
      place(small[Math.floor(rand() * small.length)], x + (rand() - 0.5) * 10, z + (rand() - 0.5) * 10, logUniform(DECOR_ROCK_SCALE_SMALL));
    }
    registerCircle(x, z, 4);
    groups++;
  }

  // Loose rocks on flat ground, mostly small, now and then a boulder.
  const scatter = Math.round(DECOR_ROCK_SCATTER * getParkAreaScale());
  for (let i = 0; i < scatter; i++) {
    const pos = _randomClear(rand, 3);
    if (!pos) continue;
    const useBig = big.length && rand() < 0.15;
    const pool = useBig || !small.length ? big : small;
    const v = pool[Math.floor(rand() * pool.length)];
    place(v, pos.x, pos.z, logUniform(useBig ? DECOR_ROCK_SCALE_BIG : DECOR_ROCK_SCALE_SMALL));
    registerCircle(pos.x, pos.z, 1.5);
  }

  for (const b of batches.values()) b.finalize(scene);
}

function _buildProceduralRocks(scene, rand) {
  const PROBE  = 4;    // slope detection step in world units
  const COUNT  = Math.round(120 * getParkAreaScale());  // candidate positions to try
  const HALF   = getParkHalf() - 6;
  const PLACED = [];

  for (let attempt = 0; attempt < COUNT * 6 && PLACED.length < COUNT; attempt++) {
    const x = (rand() * 2 - 1) * HALF;
    const z = (rand() * 2 - 1) * HALF;

    // Measure local slope
    const h  = getTerrainHeight(x, z);
    const hx = getTerrainHeight(x + PROBE, z);
    const hz = getTerrainHeight(x, z + PROBE);
    const slope = Math.max(Math.abs(h - hx), Math.abs(h - hz)) / PROBE;

    // Only place where slope is significant and height is meaningful
    if (slope < 0.35 || h < TERRAIN_MAX_HEIGHT * 0.2) continue;
    if (isOccupied(x, z, 5)) continue;

    // Cluster of 1-4 boulders
    const clusterCount = 1 + Math.floor(rand() * 3);
    for (let b = 0; b < clusterCount; b++) {
      const bx = x + (rand() - 0.5) * 8;
      const bz = z + (rand() - 0.5) * 8;
      const by = getTerrainHeight(bx, bz);

      const rx = 1.2 + rand() * 2.0;
      const ry = 0.7 + rand() * 1.2;
      const rz = 1.0 + rand() * 1.8;

      const geo  = new THREE.SphereGeometry(1, 5, 4);
      const col  = ROCK_COLORS[Math.floor(rand() * ROCK_COLORS.length)];
      const mat  = new THREE.MeshLambertMaterial({ color: col });
      const mesh = new THREE.Mesh(geo, mat);

      mesh.scale.set(rx, ry, rz);
      mesh.position.set(bx, by + ry * 0.4, bz);
      mesh.rotation.y = rand() * Math.PI * 2;
      mesh.rotation.z = (rand() - 0.5) * 0.3;
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }

    registerCircle(x, z, 4);
    PLACED.push({ x, z });
  }
}
