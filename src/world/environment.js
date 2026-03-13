/**
 * Park environment: trees, benches, lampposts, lake.
 *
 * Benches and lampposts sample arc-length-evenly along path curves,
 * offset sideways by a fixed distance, and oriented perpendicular to the path.
 * Trees fill the remaining area.
 */

import * as THREE from 'three';
import { PARK_BOUNDS, LAKE_COLOR, REED_COLOR } from '@/config.js';
import { registerEllipse, isOccupied } from './obstacleRegistry.js';

const TREE_COUNT     = 180;
const BENCH_COUNT    = 40;
const LAMPPOST_COUNT = 35;

const PARK_HALF = (PARK_BOUNDS[2] - PARK_BOUNDS[0]) / 2; // derived from config
const MAX_TRIES = 80;

const BENCH_SIDE_DIST   = 4.0; // metres off path centreline
const LAMP_SIDE_DIST    = 3.5;
const BENCH_SPACING     = 22;  // arc-length metres between benches
const LAMP_SPACING      = 18;  // arc-length metres between lamps

// ── Shapes ────────────────────────────────────────────────────────────────────

function makeConeTree(rand) {
  const group  = new THREE.Group();
  const trunkH = 2 + rand() * 3;
  const crownR = 2.5 + rand() * 1.5;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.4, trunkH, 5),
    new THREE.MeshLambertMaterial({ color: 0x5c3a1e })
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(crownR, crownR * 1.6, Math.floor(6 + rand() * 3)),
    new THREE.MeshLambertMaterial({ color: 0x2d6a2d })
  );
  crown.position.y = trunkH + crownR * 0.7;
  crown.castShadow = true;
  group.add(crown);

  return group;
}

function makeRoundTree(rand) {
  const group  = new THREE.Group();
  const trunkH = 1.5 + rand() * 2;
  const crownR = 3 + rand() * 2;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.35, trunkH, 5),
    new THREE.MeshLambertMaterial({ color: 0x5c3a1e })
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(crownR, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x3a7a3a })
  );
  crown.position.y = trunkH + crownR * 0.75;
  crown.castShadow = true;
  group.add(crown);

  return group;
}

function makeLayeredPine(rand) {
  const group  = new THREE.Group();
  const trunkH = 1 + rand() * 2;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.35, trunkH, 5),
    new THREE.MeshLambertMaterial({ color: 0x5c3a1e })
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  const layerCount = 2 + Math.floor(rand() * 2); // 2 or 3 layers
  const colors = [0x2d6a2d, 0x246024];
  let y = trunkH;
  for (let i = 0; i < layerCount; i++) {
    const r = (2.5 + rand() * 1.5) * (1 - i * 0.25);
    const h = r * 1.2;
    const layer = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 6),
      new THREE.MeshLambertMaterial({ color: colors[i % 2] })
    );
    layer.position.y = y + h * 0.4;
    layer.castShadow = true;
    group.add(layer);
    y += h * 0.55;
  }

  return group;
}

function makeTree(rand) {
  const pick = rand();
  if (pick < 0.33)      return makeConeTree(rand);
  else if (pick < 0.66) return makeRoundTree(rand);
  else                  return makeLayeredPine(rand);
}

function makeBench() {
  const group    = new THREE.Group();
  const plankMat = new THREE.MeshLambertMaterial({ color: 0x8B5e3c });
  const legMat   = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });

  const seat = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.22, 1), plankMat);
  seat.position.y = 1.1;
  seat.castShadow = true;
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.8, 0.18), plankMat);
  back.position.set(0, 1.6, -0.42);
  back.castShadow = true;
  group.add(back);

  for (const lx of [-1.4, 1.4]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 1), legMat);
    leg.position.set(lx, 0.55, 0);
    leg.castShadow = true;
    group.add(leg);
  }
  return group;
}

function makeLamppost() {
  const group = new THREE.Group();

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x333333 })
  );
  pole.position.y = 4;
  pole.castShadow = true;
  group.add(pole);

  const headMat = new THREE.MeshLambertMaterial({ color: 0xffffaa });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5), headMat);
  head.position.y = 8.5;
  head.castShadow = true;
  group.add(head);

  const light = new THREE.PointLight(0xffd97a, 0, 28, 1.4);
  light.position.y = 8.5;
  group.add(light);

  group.userData.lampLight   = light;
  group.userData.lampHeadMat = headMat;

  return group;
}

// ── Arc-length path sampling ──────────────────────────────────────────────────

/**
 * Sample positions every `spacing` world-units along all bezier curves.
 * Returns { x, z, facingAngle } where facingAngle points TOWARD the path
 * from the offset side (so benches face in).
 *
 * side: +1 = right side of travel direction, -1 = left
 * offset: perpendicular distance from centreline
 */
function _sampleAlongPaths(pathSegments, spacing, side, offset) {
  const results = [];
  // Stagger start per segment so furniture isn't all at the same arc position
  let globalOffset = spacing * 0.4;

  for (const { pts } of pathSegments) {
    let carry = globalOffset % spacing;
    globalOffset += spacing * 0.37; // shift phase per segment

    for (let i = 1; i < pts.length; i++) {
      const dx  = pts[i].x - pts[i - 1].x;
      const dy  = pts[i].y - pts[i - 1].y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) continue;

      carry += len;

      while (carry >= spacing) {
        carry -= spacing;
        // Interpolation parameter within this segment
        const t  = (len - carry) / len;
        const cx = pts[i - 1].x + dx * t;
        const cy = pts[i - 1].y + dy * t;

        // Tangent direction (normalised)
        const tx = dx / len, ty = dy / len;

        // Perpendicular: side +1 → left of travel = (-ty, tx)
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
    const x = (rand() * 2 - 1) * PARK_HALF;
    const z = (rand() * 2 - 1) * PARK_HALF;
    if (!isOccupied(x, z, margin)) return { x, z };
  }
  return null;
}

// ── Lake builder ──────────────────────────────────────────────────────────────

function buildLake(scene, projectNodes, pathGraph, rand) {
  const STEP       = 20;
  const MIN_CLEAR  = 50;
  const CENTRE_EXC = 80;

  // Collect obstacle positions
  const obstacles = [];
  for (const p of projectNodes) obstacles.push([p.x, p.y]);
  for (const n of (pathGraph?.nodes ?? [])) obstacles.push([n.x, n.y]);

  // Grid search for best placement
  let bestX = null, bestZ = null, bestDist = -1;
  for (let gx = PARK_BOUNDS[0] + STEP; gx < PARK_BOUNDS[2] - STEP; gx += STEP) {
    for (let gz = PARK_BOUNDS[1] + STEP; gz < PARK_BOUNDS[3] - STEP; gz += STEP) {
      // Skip centre area
      if (gx * gx + gz * gz < CENTRE_EXC * CENTRE_EXC) continue;
      // Skip near bounds (lake half-extents: rx=40, rz=26)
      if (Math.abs(gx) > PARK_HALF - 50 || Math.abs(gz) > PARK_HALF - 36) continue;

      let minDist = Infinity;
      for (const [ox, oz] of obstacles) {
        const d = Math.sqrt((gx - ox) ** 2 + (gz - oz) ** 2);
        if (d < minDist) minDist = d;
      }

      if (minDist > bestDist) {
        bestDist = minDist;
        bestX = gx;
        bestZ = gz;
      }
    }
  }

  if (bestDist < MIN_CLEAR) {
    console.warn('[buildLake] No sufficiently clear area found; skipping lake.');
    return null;
  }

  // Lake oval
  const lakeMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.2, 36),
    new THREE.MeshLambertMaterial({ color: LAKE_COLOR, transparent: true, opacity: 0.75 })
  );
  lakeMesh.scale.set(40, 1, 26);
  lakeMesh.position.set(bestX, 0.05, bestZ);
  lakeMesh.receiveShadow = true;
  scene.add(lakeMesh);

  // Reeds around the ellipse edge
  const REED_COUNT = 28;
  const reedMat = new THREE.MeshLambertMaterial({ color: REED_COLOR });
  const lakeRX = 40; // world X radius = scale.x (cylinder r=1)
  const lakeRZ = 26; // world Z radius = scale.z (cylinder r=1)

  for (let i = 0; i < REED_COUNT; i++) {
    const angle  = (i / REED_COUNT) * Math.PI * 2 + (rand() - 0.5) * 0.3;
    const radFac = 1.0 + rand() * 0.12; // 100–112% — always outside the lake edge
    const rx     = lakeRX * radFac;
    const rz     = lakeRZ * radFac;
    const px     = bestX + Math.cos(angle) * rx;
    const pz     = bestZ + Math.sin(angle) * rz;

    const h    = 1.5 + rand() * 2;
    const reed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.15, h, 4),
      reedMat
    );
    reed.position.set(px, h / 2, pz);
    reed.rotation.z = (rand() - 0.5) * 0.12; // ±0.06 lean
    reed.castShadow = true;
    scene.add(reed);
  }

  registerEllipse(bestX, bestZ, lakeRX, lakeRZ);
  return { x: bestX, z: bestZ, rx: lakeRX, rz: lakeRZ };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildEnvironment(scene, projectNodes, pathGraph, rand, pathSegments) {
  const segs = pathSegments ?? [];

  // ── Lake first so all subsequent placement can exclude it ───────────────
  buildLake(scene, projectNodes, pathGraph, rand);

  // ── Benches (right side of path, skip if inside any obstacle) ────────────
  const benchPoints = _sampleAlongPaths(segs, BENCH_SPACING, 1, BENCH_SIDE_DIST);
  let benchPlaced = 0;
  for (let i = 0; i < benchPoints.length && benchPlaced < BENCH_COUNT; i++) {
    const { x, z, facingAngle } = benchPoints[i];
    if (isOccupied(x, z, 2)) continue;
    const bench = makeBench();
    bench.position.set(x, 0, z);
    bench.rotation.y = facingAngle;
    scene.add(bench);
    benchPlaced++;
  }

  // ── Lampposts (left side of path, skip if inside any obstacle) ────────────
  const lampPoints = _sampleAlongPaths(segs, LAMP_SPACING, -1, LAMP_SIDE_DIST);
  let lampPlaced = 0;
  const lampLights = [];
  for (let i = 0; i < lampPoints.length && lampPlaced < LAMPPOST_COUNT; i++) {
    const { x, z } = lampPoints[i];
    if (isOccupied(x, z, 2)) continue;
    const lamp = makeLamppost();
    lamp.position.set(x, 0, z);
    scene.add(lamp);
    lampLights.push(lamp.userData.lampLight);
    lampPlaced++;
  }

  // ── Trees (random, avoiding all registry obstacles) ────────────────────
  for (let i = 0; i < TREE_COUNT; i++) {
    const pos = _randomClear(rand, 4);
    if (!pos) continue;
    const tree = makeTree(rand);
    tree.position.set(pos.x, 0, pos.z);
    tree.rotation.y = rand() * Math.PI * 2;
    scene.add(tree);
  }

  return { lampLights };
}
