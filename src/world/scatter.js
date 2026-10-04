/**
 * Scattered decor from the model packs: bushes, flowers, mushrooms and fallen logs, plus the football pitch (goal, ball and
 * a mown square in front of it).
 *
 * Everything here uses decor-model variants (world/decor.js); callers fall back to the old procedural shapes when a
 * category is empty. Spawners take `randomClear(rand, margin)` (a random free spot) from environment.js rather than
 * importing it, to keep the dependency one-way.
 */

import * as THREE from 'three';
import { VariantBatch } from '@/utils/InstanceBatch.js';
import { getTerrainHeight } from './terrain.js';
import { getParkHalf } from './parkBounds.js';
import { isOccupied, registerCircle, registerSolid } from './obstacleRegistry.js';
import { addContactShade } from './groundShade.js';
import { PITCH_SIDE, PITCH_BALL_DISTANCE } from '@/config.js';

const PITCH_LEVEL = 1.2;       // a pitch spot whose ground varies by less than this (height range over the square) counts as level
const PITCH_MAX_UNEVEN = 2.5;  // … and one that varies by more than this is no pitch at all

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

/** Matrix for an instance at (x, y, z), turned `ry` about Y, scaled (sx, sy, sz). */
function place(x, y, z, ry, sx, sy = sx, sz = sx) {
  _p.set(x, y, z);
  _q.setFromEuler(_e.set(0, ry, 0));
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s).clone();
}

/** A gentle per-instance tint: brighter or darker, optionally shifted towards yellow by `warm` (0–1). */
function tint(rand, warm = 0.2) {
  const l = 0.85 + rand() * 0.3, y = rand() * warm;
  return new THREE.Color(l * (1 + y * 0.4), l * (1 + y * 0.1), l * (1 - y * 0.3));
}

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

// ── Bushes ────────────────────────────────────────────────────────────────────

/** @returns {VariantBatch[]} the batches to finalise */
export function scatterBushes(rand, variants, { count, randomClear }) {
  const batches = new Map(variants.map(v => [v.id, new VariantBatch(v, count)]));
  for (let i = 0; i < count; i++) {
    const pos = randomClear(rand, 3.5);
    if (!pos) continue;
    const v = pick(variants, rand);
    const s = 0.85 + rand() * 0.9;
    const wide = s * (0.9 + rand() * 0.25), tall = s * (0.9 + rand() * 0.3);
    batches.get(v.id).add(place(pos.x, getTerrainHeight(pos.x, pos.z) - 0.05, pos.z, rand() * Math.PI * 2, wide, tall, wide), tint(rand));
    addContactShade(pos.x, pos.z, 1.8 * s, 0.32);
    registerCircle(pos.x, pos.z, 1.3 * s); // trees, rocks and the like keep off it
    registerSolid(pos.x, pos.z, 0.8 * s);  // people walk round it
  }
  return [...batches.values()];
}

// ── Flowers ───────────────────────────────────────────────────────────────────

/**
 * Flower patches: either one patch model (a ready-made clump) or a loose cluster of single flowers.
 * @returns {{ batches: VariantBatch[], spots: {x, z}[] }}  the batches to finalise, and where the flowers are (butterflies like them)
 */
export function scatterFlowers(rand, singles, patches, { count, randomClear }) {
  const all = [...singles, ...patches];
  const batches = new Map(all.map(v => [v.id, new VariantBatch(v, count * 10)]));
  for (const b of batches.values()) b.setCastShadow(false); // too small to matter, and a lot of shadow-pass work

  const spots = [];
  for (let i = 0; i < count; i++) {
    const pos = randomClear(rand, 3);
    if (!pos) continue;
    spots.push(pos);
    if (patches.length && (!singles.length || rand() < 0.4)) {
      const v = pick(patches, rand), s = 0.9 + rand() * 0.9;
      batches.get(v.id).add(place(pos.x, getTerrainHeight(pos.x, pos.z) - 0.02, pos.z, rand() * Math.PI * 2, s), tint(rand, 0.1));
    } else {
      // A cluster of one or two kinds, scattered round the spot.
      const kinds = [pick(singles, rand), pick(singles, rand)];
      const n = 4 + Math.floor(rand() * 6);
      for (let j = 0; j < n; j++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 2.6;
        const fx = pos.x + Math.cos(a) * d, fz = pos.z + Math.sin(a) * d;
        if (isOccupied(fx, fz, 0.3)) continue;
        const s = 0.8 + rand() * 0.7;
        batches.get(kinds[j % 2].id).add(place(fx, getTerrainHeight(fx, fz) - 0.02, fz, rand() * Math.PI * 2, s), tint(rand, 0.1));
      }
    }
  }
  return { batches: [...batches.values()], spots };
}

// ── Mushrooms ─────────────────────────────────────────────────────────────────

/** Little groups at the foot of trees. `trees` is [{ x, z, r }] (r = crown radius). */
export function scatterMushrooms(rand, variants, trees, { count }) {
  const batches = new Map(variants.map(v => [v.id, new VariantBatch(v, count * 5)]));
  for (const b of batches.values()) b.setCastShadow(false);
  if (!trees.length) return [...batches.values()];
  for (let i = 0; i < count; i++) {
    const t = pick(trees, rand);
    const a0 = rand() * Math.PI * 2, d0 = 1.4 + rand() * 1.6;
    const cx = t.x + Math.cos(a0) * d0, cz = t.z + Math.sin(a0) * d0;
    const n = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const x = cx + (rand() - 0.5) * 1.6, z = cz + (rand() - 0.5) * 1.6;
      if (isOccupied(x, z, 0.2, true)) continue; // (the trunk's own circle is in the registry, so it stays clear of that)
      const s = 0.7 + rand() * 0.7;
      batches.get(pick(variants, rand).id).add(place(x, getTerrainHeight(x, z) - 0.03, z, rand() * Math.PI * 2, s), tint(rand, 0.05));
    }
  }
  return [...batches.values()];
}

// ── Fallen logs ───────────────────────────────────────────────────────────────

export function scatterLogs(rand, variants, { count, randomClear }) {
  const batches = new Map(variants.map(v => [v.id, new VariantBatch(v, count)]));
  for (let i = 0; i < count; i++) {
    const pos = randomClear(rand, 4.5);
    if (!pos) continue;
    const v = pick(variants, rand), s = 0.9 + rand() * 0.6;
    const ry = rand() * Math.PI;
    // Lying on slopes: sunk a little so the downhill end isn't in the air.
    batches.get(v.id).add(place(pos.x, getTerrainHeight(pos.x, pos.z) - 0.12 * s, pos.z, ry, s), tint(rand, 0.05));
    addContactShade(pos.x, pos.z, 3.4 * s, 0.35);
    registerCircle(pos.x, pos.z, 3.0 * s);
  }
  return [...batches.values()];
}

// ── The football pitch ────────────────────────────────────────────────────────

/**
 * Pick a clearing for the pitch: a PITCH_SIDE square of open, level ground (off the paths, plazas and lake), with the goal at
 * its back edge looking towards the middle of the park. Reserve it, so trees and bushes keep off, and return where
 * everything goes — or null if there is no room anywhere.
 *
 * Coordinates: "front" is the way the goal faces, (sin yaw, cos yaw); the mown square lies in front of the goal.
 */
export function planPitch(rand) {
  const half = getParkHalf();
  const reach = half - PITCH_SIDE * 0.9;                 // keep the whole square well inside the park
  let best = null;
  // Look outwards from the middle of the park: candidates come from a square that grows with each attempt, and the
  // first level, roomy-enough spot wins. Only if none is level enough does the flattest spot found win instead.
  const ATTEMPTS = 800;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const reachNow = reach * (0.1 + 0.9 * attempt / (ATTEMPTS - 1));
    const x = (rand() * 2 - 1) * reachNow, z = (rand() * 2 - 1) * reachNow;
    const yaw = Math.atan2(-x, -z);                      // looking towards the middle of the park
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);

    // Sample the square plus a strip behind it (where the goal and its net stand).
    let lo = Infinity, hi = -Infinity, clear = true;
    for (let i = -4; i <= 4 && clear; i++) {
      for (let j = -5; j <= 4; j++) {
        const across = (i / 4) * (PITCH_SIDE / 2 + 2), along = (j / 4) * (PITCH_SIDE / 2 + 2);
        const px = x + rx * across + fx * along, pz = z + rz * across + fz * along;
        if (isOccupied(px, pz, 3)) { clear = false; break; }
        const h = getTerrainHeight(px, pz);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
    }
    if (!clear) continue;
    const unevenness = hi - lo;
    if (unevenness > PITCH_MAX_UNEVEN) continue;
    if (!best || unevenness < best.unevenness) best = { x, z, yaw, unevenness };
    if (unevenness < PITCH_LEVEL) break;                 // level enough: take it (the nearest to the middle found so far)
  }
  if (!best) return null;

  const { x, z, yaw } = best;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const back = { x: x - fx * PITCH_SIDE / 2, z: z - fz * PITCH_SIDE / 2 };   // the middle of the back edge: the goal mouth
  const plan = {
    x, z, yaw, side: PITCH_SIDE,
    goalMouth: back,
    ball: { x: back.x + fx * PITCH_BALL_DISTANCE, z: back.z + fz * PITCH_BALL_DISTANCE },
  };

  // Reserve the square (and the goal behind it) so nothing else is planted on it.
  for (let a = -PITCH_SIDE / 2; a <= PITCH_SIDE / 2; a += 7) {
    for (let b = -PITCH_SIDE / 2 - 8; b <= PITCH_SIDE / 2; b += 7) {
      registerCircle(x + Math.cos(yaw) * a + fx * b, z - Math.sin(yaw) * a + fz * b, 7.5);
    }
  }
  return plan;
}

/**
 * Put the goal (its mouth on the back edge of the mown square, facing into it) and the ball in the park.
 * @returns {THREE.Object3D[]} what was added
 */
export function buildPitch(scene, decor, plan) {
  const added = [];
  const goal = decor.goal[0];
  if (goal) {
    const depth = goal.size?.[2] ?? 6;
    const g = new THREE.Group();
    for (const part of goal.parts) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    const fx = Math.sin(plan.yaw), fz = Math.cos(plan.yaw);
    // The model is centred on its footprint with its mouth on the +Z side, half a depth from the origin.
    const ox = plan.goalMouth.x - fx * depth / 2, oz = plan.goalMouth.z - fz * depth / 2;
    g.position.set(ox, getTerrainHeight(plan.goalMouth.x, plan.goalMouth.z), oz);
    g.rotation.y = plan.yaw;
    scene.add(g);
    added.push(g);
    addContactShade(ox + fx * depth * 0.25, oz + fz * depth * 0.25, depth * 0.9, 0.3);
  }

  const ball = decor.ball[0];
  if (ball) {
    const radius = (ball.size?.[1] ?? 1) / 2;
    const g = new THREE.Group();
    for (const part of ball.parts) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.castShadow = true;
      g.add(mesh);
    }
    g.position.set(plan.ball.x, getTerrainHeight(plan.ball.x, plan.ball.z) - 0.05, plan.ball.z);
    scene.add(g);
    added.push(g);
    addContactShade(plan.ball.x, plan.ball.z, radius * 3, 0.4);
  }
  return added;
}
