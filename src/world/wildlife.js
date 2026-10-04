/**
 * Wildlife: birds circling high above the park by day, and a few ducks paddling on the lake.
 *
 * Birds are the animated decor models (src/world/decor.js: skinned, one flap clip each), cloned per bird
 * with SkeletonUtils; there are none if the models didn't load. They fly slow circles, banking into the
 * turn, and roost (disappear) at dusk. Ducks are tiny hand-built groups that drift on slow ellipses
 * inside the lake.
 */

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getLake, WATER_Y, setWaterRipple, setWaterTrail, TRAIL_EVERY } from './lake.js';
import { getTerrainHeight } from './terrain.js';
import { getParkHalf, getParkAreaScale } from './parkBounds.js';
import { BIRD_COUNT, BIRD_SCALE, DUCK_COUNT, BUTTERFLY_COUNT, BUTTERFLY_SCALE } from '@/config.js';

const _birds = [];
const _ducks = [];

const _q = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);

// ── Birds ─────────────────────────────────────────────────────────────────────

/**
 * @param {THREE.Scene} scene
 * @param {Function} rand
 * @param {{ scene: THREE.Object3D, animations: THREE.AnimationClip[] }[]} variants  the decor bird models
 */
export function buildBirds(scene, rand, variants = []) {
  if (!variants.length) return;
  const count = Math.round(BIRD_COUNT * Math.max(1, getParkAreaScale()));
  const half = getParkHalf();

  for (let i = 0; i < count; i++) {
    const v = variants[i % variants.length];
    const model = cloneSkinned(v.scene);
    model.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } }); // skinned bounds are stale
    const group = new THREE.Group();
    group.add(model);
    group.scale.setScalar(BIRD_SCALE[0] + rand() * (BIRD_SCALE[1] - BIRD_SCALE[0]));
    group.visible = false;
    scene.add(group);

    // Flap loop, each bird at its own phase and a slightly different speed.
    const mixer = new THREE.AnimationMixer(model);
    if (v.animations.length) {
      const action = mixer.clipAction(v.animations[0]);
      action.time = rand() * v.animations[0].duration;
      action.timeScale = 0.85 + rand() * 0.35;
      action.play();
    }

    // Birds in the same group of three share a circling centre.
    const flock = Math.floor(i / 3);
    _birds.push({
      group, mixer,
      cx: (((flock * 5 + 1) * 9301 % 1000) / 1000 * 2 - 1) * half * 0.5,
      cz: (((flock * 7 + 3) * 4231 % 1000) / 1000 * 2 - 1) * half * 0.5,
      radius: half * (0.25 + 0.2 * rand()),
      height: 55 + rand() * 25,
      speed: (0.07 + rand() * 0.05) * (rand() < 0.5 ? 1 : -1) * (flock % 2 ? 1 : -1),
      angle: rand() * Math.PI * 2,
      bob: rand() * Math.PI * 2,
      time: 0,
    });
  }
}

// ── Butterflies ───────────────────────────────────────────────────────────────

const _butterflies = [];

/**
 * Butterflies flutter about the flower patches by day: each loops round a flower spot for a while, then drifts to another.
 * @param {{ x: number, z: number }[]} flowerSpots
 */
export function buildButterflies(scene, rand, variants = [], flowerSpots = []) {
  if (!variants.length || !flowerSpots.length) return;
  const count = Math.round(BUTTERFLY_COUNT * Math.max(1, getParkAreaScale()));
  for (let i = 0; i < count; i++) {
    const v = variants[i % variants.length];
    const model = cloneSkinned(v.scene);
    model.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
    // Tint each one differently (materials are shared by the clone, so give it its own).
    const hue = rand();
    model.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.color?.offsetHSL(hue, 0.25, 0.05);
    });
    const group = new THREE.Group();
    group.add(model);
    group.scale.setScalar(BUTTERFLY_SCALE[0] + rand() * (BUTTERFLY_SCALE[1] - BUTTERFLY_SCALE[0]));
    group.visible = false;
    scene.add(group);

    const mixer = new THREE.AnimationMixer(model);
    if (v.animations.length) {
      const action = mixer.clipAction(v.animations[0]);
      action.time = rand() * v.animations[0].duration;
      action.timeScale = 1.2 + rand() * 0.8;
      action.play();
    }
    const spot = flowerSpots[Math.floor(rand() * flowerSpots.length)];
    _butterflies.push({
      group, mixer, spots: flowerSpots, spot, next: null, t: rand() * 100, stay: 8 + rand() * 12,
      x: spot.x, z: spot.z, y: 2, heading: rand() * Math.PI * 2,
      orbit: 3 + rand() * 4, fa: 0.5 + rand() * 0.4, fb: 0.7 + rand() * 0.5, ph: rand() * 6.28,
    });
  }
}

function _updateButterfly(b, dt) {
  b.mixer.update(dt);
  b.t += dt;
  b.stay -= dt;
  if (b.stay < 0 && !b.next) {
    b.next = b.spots[Math.floor(Math.random() * b.spots.length)];
  }
  // Wander round the current spot, or head for the next one.
  const tx = (b.next ?? b.spot).x + Math.sin(b.t * b.fa + b.ph) * b.orbit;
  const tz = (b.next ?? b.spot).z + Math.cos(b.t * b.fb + b.ph) * b.orbit;
  const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz) || 1;
  const speed = Math.min(b.next ? 6 : 3.2, d * 1.5 + 0.5);
  b.x += (dx / d) * speed * dt;
  b.z += (dz / d) * speed * dt;
  if (b.next && Math.hypot(b.next.x - b.x, b.next.z - b.z) < b.orbit + 3) {
    b.spot = b.next; b.next = null; b.stay = 8 + Math.random() * 12;
  }
  const want = Math.atan2(dx, dz);
  let da = want - b.heading;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  b.heading += da * Math.min(1, dt * 3);
  b.y = getTerrainHeight(b.x, b.z) + 2.2 + Math.sin(b.t * 1.7 + b.ph) * 0.9 + Math.sin(b.t * 4.3) * 0.2;
  b.group.position.set(b.x, b.y, b.z);
  b.group.rotation.set(Math.sin(b.t * 2.1) * 0.15, b.heading, Math.sin(b.t * 1.3 + b.ph) * 0.2);
}

// ── Ducks ─────────────────────────────────────────────────────────────────────

const DUCK_BODY = new THREE.MeshLambertMaterial({ color: 0xc9b99a });
const DUCK_HEAD = new THREE.MeshLambertMaterial({ color: 0x2f6b4a });
const DUCK_BILL = new THREE.MeshLambertMaterial({ color: 0xe0a82e });

function _buildDuck() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), DUCK_BODY);
  body.scale.set(1, 0.65, 1.5);
  g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 5), DUCK_BODY);
  tail.rotation.x = -Math.PI / 2 - 0.5;
  tail.position.set(0, 0.28, -0.95);
  g.add(tail);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), DUCK_HEAD);
  head.position.set(0, 0.62, 0.7);
  g.add(head);
  const bill = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.3), DUCK_BILL);
  bill.position.set(0, 0.57, 1.05);
  g.add(bill);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(1.3);
  return g;
}

export function buildDucks(scene, rand) {
  const lake = getLake();
  if (!lake) return;
  _duckRand = rand;
  for (let i = 0; i < DUCK_COUNT; i++) {
    const mesh = _buildDuck();
    scene.add(mesh);
    // Start somewhere deep, not on top of another duck.
    let p = null;
    for (let tries = 0; tries < 40 && !p; tries++) {
      const c = _randomDeepPoint(lake);
      if (c && _ducks.every(o => Math.hypot(o.x - c.x, o.z - c.z) > DUCK_APART * 1.5)) p = c;
    }
    p ??= { x: lake.x, z: lake.z };
    _ducks.push({
      mesh, x: p.x, z: p.z, heading: rand() * Math.PI * 2, speed: 0, target: null,
      idle: rand() * 4, wake: 0, trailT: 0, bob: rand() * Math.PI * 2, cruise: DUCK_SPEED * (0.8 + rand() * 0.4),
    });
  }
}

// ── Duck behaviour: paddle about on the spot for a while (rings spread from it), then swim to another part of the lake
// (a wake trails behind it, and the rings fade out while it goes), then stop again. Ducks keep apart.

let _duckRand = Math.random;
const DUCK_SPEED = 1.5;      // swimming speed (units/s)
const DUCK_APART = 2.6;      // ducks never get closer than this
const DUCK_DEPTH = 0.7;      // stay where the water is at least this deep (off the banks)

const _deep = (x, z) => getTerrainHeight(x, z) < WATER_Y - DUCK_DEPTH;

function _randomDeepPoint(lake) {
  for (let i = 0; i < 30; i++) {
    const a = _duckRand() * Math.PI * 2, r = Math.sqrt(_duckRand());
    const x = lake.x + Math.cos(a) * r * lake.rx, z = lake.z + Math.sin(a) * r * lake.rz;
    if (_deep(x, z)) return { x, z };
  }
  return null;
}

/** A place to swim to: deep water all the way there, not near another duck's spot. */
function _pickTarget(d, lake) {
  for (let tries = 0; tries < 25; tries++) {
    const c = _randomDeepPoint(lake);
    if (!c) return null;
    const dist = Math.hypot(c.x - d.x, c.z - d.z);
    if (dist < 6) continue;
    let clear = true;
    for (let s = 1.5; s < dist && clear; s += 1.5) clear = _deep(d.x + (c.x - d.x) * s / dist, d.z + (c.z - d.z) * s / dist);
    if (!clear || _ducks.some(o => o !== d && Math.hypot(o.x - c.x, o.z - c.z) < DUCK_APART * 1.5)) continue;
    return c;
  }
  return null;
}

function _updateDuck(i, d, dt, lake) {
  d.bob += dt * 2;
  if (d.target) {
    const dx = d.target.x - d.x, dz = d.target.z - d.z, dist = Math.hypot(dx, dz);
    // Steer to the target, away from ducks that are close ahead.
    let sx = dx / (dist || 1), sz = dz / (dist || 1);
    for (const o of _ducks) {
      if (o === d) continue;
      const ox = d.x - o.x, oz = d.z - o.z, od = Math.hypot(ox, oz);
      if (od < DUCK_APART * 2.2 && od > 1e-3) { const w = (1 - od / (DUCK_APART * 2.2)) * 1.8; sx += ox / od * w; sz += oz / od * w; }
    }
    const want = Math.atan2(sx, sz);
    const diff = Math.atan2(Math.sin(want - d.heading), Math.cos(want - d.heading));
    d.heading += Math.sign(diff) * Math.min(Math.abs(diff), 2.0 * dt);
    // Speed up, and slow down for the last few units / when it has to turn hard.
    const goal = d.cruise * Math.min(1, dist / 4) * (Math.abs(diff) > 1.0 ? 0.4 : 1);
    d.speed += (goal - d.speed) * (1 - Math.exp(-2.5 * dt));
    const nx = d.x + Math.sin(d.heading) * d.speed * dt, nz = d.z + Math.cos(d.heading) * d.speed * dt;
    if (_deep(nx, nz)) { d.x = nx; d.z = nz; } else { d.target = null; }   // the bank: give up and stop here
    if (dist < 1.0) d.target = null;
    if (!d.target) d.idle = 2.5 + _duckRand() * 6;
  } else {
    d.speed += (0 - d.speed) * (1 - Math.exp(-3 * dt));
    d.x += Math.sin(d.heading) * d.speed * dt; d.z += Math.cos(d.heading) * d.speed * dt;  // glide to a stop
    d.heading += Math.sin(d.bob * 0.23 + i) * 0.1 * dt;                                   // idly turning on the spot
    d.idle -= dt;
    if (d.idle <= 0) d.target = _pickTarget(d, lake) ?? null, d.idle = d.target ? 0 : 3;
  }

  // Never overlap: push apart (the one that is swimming gives way less, so it does not get stuck).
  for (const o of _ducks) {
    if (o === d) continue;
    const ox = d.x - o.x, oz = d.z - o.z, od = Math.hypot(ox, oz);
    if (od < DUCK_APART && od > 1e-3) {
      const push = (DUCK_APART - od) * 0.5;
      const nx = d.x + ox / od * push, nz = d.z + oz / od * push;
      if (_deep(nx, nz)) { d.x = nx; d.z = nz; }
    }
  }

  // The wake takes over from the still-water rings as it starts to swim, and the other way round.
  const swimming = d.speed > 0.35;
  d.wake += ((swimming ? 1 : 0) - d.wake) * (1 - Math.exp(-dt / 0.45));
  d.trailT += dt;
  if (swimming && d.trailT >= TRAIL_EVERY) {
    d.trailT = 0;
    setWaterTrail(i, d.x - Math.sin(d.heading) * 0.7, d.z - Math.cos(d.heading) * 0.7, Math.min(1, d.speed / 1.0));
  }

  d.mesh.position.set(d.x, WATER_Y + 0.08 + Math.sin(d.bob) * 0.04, d.z);
  d.mesh.rotation.y = d.heading;
  d.mesh.rotation.z = Math.sin(d.bob * 0.7) * 0.04;
  setWaterRipple(i, d.x, d.z, (i * 0.37) % 1, 1 - d.wake);
}

/**
 * Birds and butterflies are hidden at night, and the renderer only compiles shaders for what is visible — so the first
 * time they appear (sunrise) the frame would stall while their shaders build. Show them for one `compile` up front.
 */
export function prewarmWildlife(renderer, scene, camera) {
  const groups = [..._birds, ..._butterflies].map(b => b.group);
  const was = groups.map(g => g.visible);
  groups.forEach(g => { g.visible = true; });
  renderer.compile(scene, camera);
  groups.forEach((g, i) => { g.visible = was[i]; });
}

// ── Per-frame ─────────────────────────────────────────────────────────────────

/** @param {number} dt seconds  @param {number} daylight 0 (night) … 1 (day) */
export function updateWildlife(dt, daylight) {
  const lake = getLake();
  for (let i = 0; i < _ducks.length; i++) _updateDuck(i, _ducks[i], Math.min(dt, 0.1), lake);

  const bright = daylight > 0.45;
  for (const b of _butterflies) {
    b.group.visible = bright;
    if (bright) _updateButterfly(b, dt);
  }

  const day = daylight > 0.25; // birds roost at dusk
  for (const b of _birds) {
    b.group.visible = day;
    if (!day) continue;
    b.mixer.update(dt);
    b.time += dt;
    b.angle += b.speed * dt;
    const dir = Math.sign(b.speed);
    const heading = Math.atan2(-Math.sin(b.angle) * dir, Math.cos(b.angle) * dir); // tangent of the circle
    b.group.position.set(
      b.cx + Math.cos(b.angle) * b.radius,
      b.height + Math.sin(b.time * 0.8 + b.bob) * 1.5,
      b.cz + Math.sin(b.angle) * b.radius,
    );
    // The model flies towards +Z; bank into the turn (circling with dir = +1 turns right).
    _q.setFromAxisAngle(_up, heading);
    _roll.setFromAxisAngle(_fwd, dir * 0.3);
    b.group.quaternion.copy(_q).multiply(_roll);
  }
}
