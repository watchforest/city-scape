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
import { registerCircle, registerEllipse, isOccupied } from './obstacleRegistry.js';
import { registerBench } from './benchRegistry.js';
import { InstanceBatch } from '@/utils/InstanceBatch.js';
import { getTerrainHeight } from './terrain.js';
import { TERRAIN_MAX_HEIGHT } from '@/config.js';

const TREE_DENSITY   = 180;  // trees for the reference-size park; scaled by park area

const MAX_TRIES = 80;
const EDGE_INSET = 4; // trees keep this far in from the park edge so crowns don't overhang the frame

const BENCH_SIDE_CLEAR  = 3.0;  // metres beyond path edge (added to half-width), capped
const LAMP_SIDE_CLEAR   = 3.0;
const BENCH_SPACING     = 40;   // arc-length metres between benches
const LAMP_SPACING      = 28;   // arc-length metres between lamps

// ── Instancing limits ─────────────────────────────────────────────────────────

const MAX_CONE_TREES   = 300;
const MAX_ROUND_TREES  = 300;
const MAX_PINE_LAYER0  = 300;
const MAX_PINE_LAYER1  = 300;
const MAX_BENCHES      = 200;
const MAX_LAMPS        = 200;

// ── Materials (shared across all instances of each type) ──────────────────────

const MAT_TRUNK_DARK  = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
const MAT_TRUNK_MED   = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
const MAT_CROWN_CONE  = new THREE.MeshLambertMaterial({ color: 0x2d6a2d });
const MAT_CROWN_ROUND = new THREE.MeshLambertMaterial({ color: 0x3a7a3a });
const MAT_PINE_L0     = new THREE.MeshLambertMaterial({ color: 0x2d6a2d });
const MAT_PINE_L1     = new THREE.MeshLambertMaterial({ color: 0x246024 });
const MAT_PLANK       = new THREE.MeshLambertMaterial({ color: 0x8B5e3c });
const MAT_LEG         = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
const MAT_POLE        = new THREE.MeshLambertMaterial({ color: 0x333333 });
// MeshStandardMaterial so we can drive emissiveIntensity from dayCycle
const MAT_LAMP_HEAD   = new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: new THREE.Color(0xffd97a), emissiveIntensity: 0 });

// Radial gradient texture for ground halo — generated once via canvas
function _makeHaloTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0,   'rgba(255, 220, 100, 0.45)');
  grad.addColorStop(0.4, 'rgba(255, 200,  60, 0.15)');
  grad.addColorStop(1,   'rgba(255, 180,   0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

const MAT_LAMP_HALO = new THREE.MeshBasicMaterial({
  map: _makeHaloTexture(),
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  opacity: 0,
});

// ── Geometry (unit / canonical — scale applied per-instance via Matrix4) ──────

// Cone tree
const GEO_CONE_TRUNK  = new THREE.CylinderGeometry(0.25, 0.4, 1, 5);
const GEO_CONE_CROWN  = new THREE.ConeGeometry(1, 1.6, 7);

// Round tree
const GEO_ROUND_TRUNK = new THREE.CylinderGeometry(0.2, 0.35, 1, 5);
const GEO_ROUND_CROWN = new THREE.SphereGeometry(1, 8, 6);

// Layered pine (unit trunk + unit cone layer reused for both layers)
const GEO_PINE_TRUNK  = new THREE.CylinderGeometry(0.2, 0.35, 1, 5);
const GEO_PINE_LAYER  = new THREE.ConeGeometry(1, 1.2, 6);

// Bench parts
const GEO_BENCH_SEAT  = new THREE.BoxGeometry(3.5, 0.22, 1);
const GEO_BENCH_BACK  = new THREE.BoxGeometry(3.5, 0.8, 0.18);
const GEO_BENCH_LEG   = new THREE.BoxGeometry(0.22, 1.1, 1);

// Lamppost parts
const GEO_LAMP_POLE   = new THREE.CylinderGeometry(0.15, 0.2, 8, 6);
const GEO_LAMP_HEAD   = new THREE.SphereGeometry(0.5, 6, 5);
const GEO_LAMP_HALO   = new THREE.PlaneGeometry(28, 28); // ground light pool

// ── Tree instance helpers ─────────────────────────────────────────────────────

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
  batches.crown.add(_compose(x, crownCY, z, ry, crownR, crownR * 1.6, crownR));
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
  batches.crown.add(_compose(x, crownCY, z, ry, crownR, crownR, crownR));
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
  batches.layer0.add(_compose(x, y0, z, ry, r0, h0, r0));

  const r1 = r0 * 0.75;
  const h1 = r1 * 1.2;
  const y1 = gy + (trunkH + h0 * 0.55) + h1 * 0.4;
  batches.layer1.add(_compose(x, y1, z, ry, r1, h1, r1));
}

// ── Bench instance helper ─────────────────────────────────────────────────────

/**
 * Add all four bench part instances for a single bench placement.
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
    new THREE.Vector3(1, 1, 1)
  );

  // Each part: local position → transform by benchRoot
  const _localPart = (lx, ly, lz) => {
    const localM = new THREE.Matrix4().compose(
      new THREE.Vector3(lx, ly, lz),
      new THREE.Quaternion(), // no extra rotation on parts
      new THREE.Vector3(1, 1, 1)
    );
    return new THREE.Matrix4().multiplyMatrices(benchRoot, localM);
  };

  batches.seat.add(_localPart(0, 1.1, 0));
  batches.back.add(_localPart(0, 1.6, -0.42));
  batches.leftLeg.add(_localPart(-1.4, 0.55, 0));
  batches.rightLeg.add(_localPart(1.4, 0.55, 0));
}

// ── Lamppost instance helper ──────────────────────────────────────────────────

/**
 * Add a lamppost at world position (x, z).
 * No PointLights — illumination is faked via emissive head + additive halo plane.
 */
function addLamppost(batches, x, z) {
  const gy = getTerrainHeight(x, z);
  batches.pole.add(_compose(x, gy + 4,   z, 0, 1, 1, 1));
  batches.head.add(_compose(x, gy + 8.5, z, 0, 1, 1, 1));
  _pos.set(x, gy + 0.15, z);
  _rot.set(-Math.PI / 2, 0, 0);
  _scl.set(1, 1, 1);
  _quat.setFromEuler(_rot);
  _mat.compose(_pos, _quat, _scl);
  batches.halo.add(_mat.clone());
}

// ── Arc-length path sampling ──────────────────────────────────────────────────

/**
 * Sample positions every `spacing` world-units along all bezier curves.
 * Returns { x, z, facingAngle } where facingAngle points TOWARD the path.
 *
 * side: +1 = right side of travel direction, -1 = left
 * clearance: metres beyond the path edge (offset = halfWidth + clearance)
 */
function _sampleAlongPaths(pathSegments, spacing, side, clearance) {
  const results = [];

  for (const { pts } of pathSegments) {
    let carry = 0;

    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i].u ?? pts[i].x ?? 0, az = pts[i].v ?? pts[i].y ?? 0;
      const bx = pts[i-1].u ?? pts[i-1].x ?? 0, bz = pts[i-1].v ?? pts[i-1].y ?? 0;
      const dx  = ax - bx;
      const dy  = az - bz;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) continue;

      carry += len;

      while (carry >= spacing) {
        carry -= spacing;
        const t  = (len - carry) / len;
        const cx = bx + dx * t;
        const cy = bz + dy * t;

        // Offset = half path width + clearance. Width defaults to 8 (single path).
        const offset = 4 + clearance;

        // Tangent + perpendicular
        const tx = dx / len, ty = dy / len;
        const px = -ty * side, py = tx * side;

        const wx = cx + px * offset;
        const wz = cy + py * offset;

        // Three.js rotation.y=a maps local +Z to world (sin(a), 0, cos(a)).
        // Inward direction (toward path centreline):
        //   side=+1: perp was (-ty, tx), inward is (ty, -tx)  → atan2(ty, -tx)
        //   side=-1: perp was (+ty,-tx), inward is (-ty,  tx) → atan2(-ty, tx)
        const facingAngle = side > 0
          ? Math.atan2(ty, -tx)
          : Math.atan2(-ty, tx);

        results.push({ x: wx, z: wz, facingAngle });
      }
    }
  }
  return results;
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

export function buildEnvironment(scene, projectNodes, pathGraph, rand, pathSegments, plazaRadius, lakePos) {
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

  // Benches — 4 parts
  const benchBatches = {
    seat:     new InstanceBatch(GEO_BENCH_SEAT, MAT_PLANK, cap(MAX_BENCHES)),
    back:     new InstanceBatch(GEO_BENCH_BACK, MAT_PLANK, cap(MAX_BENCHES)),
    leftLeg:  new InstanceBatch(GEO_BENCH_LEG,  MAT_LEG,   cap(MAX_BENCHES)),
    rightLeg: new InstanceBatch(GEO_BENCH_LEG,  MAT_LEG,   cap(MAX_BENCHES)),
  };

  // Lampposts — pole + head + ground halo (no PointLights)
  const lampBatches = {
    pole: new InstanceBatch(GEO_LAMP_POLE, MAT_POLE,      cap(MAX_LAMPS)),
    head: new InstanceBatch(GEO_LAMP_HEAD, MAT_LAMP_HEAD, cap(MAX_LAMPS)),
    halo: new InstanceBatch(GEO_LAMP_HALO, MAT_LAMP_HALO, cap(MAX_LAMPS)),
  };

  // ── Benches (right side of path) ────────────────────────────────────────
  const benchPoints = _sampleAlongPaths(segs, BENCH_SPACING, 1, BENCH_SIDE_CLEAR);
  for (const { x, z, facingAngle } of benchPoints) {
    if (isOccupied(x, z, 2)) continue;
    addBench(benchBatches, x, z, facingAngle);
    registerCircle(x, z, 1.5);
    registerBench(x, z, facingAngle);
  }

  // ── Lampposts (left side of path) ───────────────────────────────────────
  const lampPoints = _sampleAlongPaths(segs, LAMP_SPACING, -1, LAMP_SIDE_CLEAR);
  for (const { x, z } of lampPoints) {
    if (isOccupied(x, z, 2)) continue;
    addLamppost(lampBatches, x, z);
    registerCircle(x, z, 1.0);
  }

  // ── Props around plaza circumferences ───────────────────────────────────
  if (plazaRadius) {
    for (const p of projectNodes) {
      const r = plazaRadius.get(p.id);
      if (!r) continue;
      const cx = p.layoutU, cz = p.layoutV;
      const edgeR = r + 5; // just outside the plaza disc edge
      const circumference = 2 * Math.PI * edgeR;
      const lampCount  = Math.max(2, Math.floor(circumference / LAMP_SPACING));
      const benchCount = Math.max(1, Math.floor(circumference / BENCH_SPACING));

      for (let i = 0; i < lampCount; i++) {
        const angle = (i / lampCount) * Math.PI * 2;
        const x = cx + Math.cos(angle) * edgeR;
        const z = cz + Math.sin(angle) * edgeR;
        if (isOccupied(x, z, 2)) continue;
        addLamppost(lampBatches, x, z);
        registerCircle(x, z, 1.0);
      }
      for (let i = 0; i < benchCount; i++) {
        const angle = (i / benchCount) * Math.PI * 2 + Math.PI / benchCount; // offset from lamps
        const x = cx + Math.cos(angle) * edgeR;
        const z = cz + Math.sin(angle) * edgeR;
        if (isOccupied(x, z, 2)) continue;
        const facingAngle = Math.atan2(cx - x, cz - z); // face toward plaza centre
        addBench(benchBatches, x, z, facingAngle);
        registerCircle(x, z, 1.5);
        registerBench(x, z, facingAngle);
      }
    }
  }

  // ── Trees (random, avoiding all registry obstacles) ──────────────────────
  const treeCount = Math.round(TREE_DENSITY * getParkAreaScale());
  for (let i = 0; i < treeCount; i++) {
    const pos = _randomClear(rand, 4);
    if (!pos) continue;
    const ry   = rand() * Math.PI * 2;
    const pick = rand();
    if (pick < 0.33)      addConeTree(coneBatches,   pos.x, pos.z, ry, rand);
    else if (pick < 0.66) addRoundTree(roundBatches,  pos.x, pos.z, ry, rand);
    else                  addLayeredPine(pineBatches,  pos.x, pos.z, ry, rand);
  }

  // ── Rock outcroppings on steep slopes ───────────────────────────────────
  _buildRocks(scene, rand);

  // ── Finalize all InstanceBatches (set count + add to scene) ─────────────
  for (const b of Object.values(coneBatches))  b.finalize(scene);
  for (const b of Object.values(roundBatches)) b.finalize(scene);
  for (const b of Object.values(pineBatches))  b.finalize(scene);
  for (const b of Object.values(benchBatches)) b.finalize(scene);
  for (const b of Object.values(lampBatches))  b.finalize(scene);

  // Return lamp materials so dayCycle can drive emissive + halo opacity
  return { lampHeadMat: MAT_LAMP_HEAD, lampHaloMat: MAT_LAMP_HALO };
}

// ── Rock outcroppings ─────────────────────────────────────────────────────────

const ROCK_COLORS = [0x7a7060, 0x6a6258, 0x857a6e, 0x908880];

function _buildRocks(scene, rand) {
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
