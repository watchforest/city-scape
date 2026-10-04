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
import { getLake, WATER_Y } from './lake.js';
import { getParkHalf, getParkAreaScale } from './parkBounds.js';
import { BIRD_COUNT, BIRD_SCALE, DUCK_COUNT } from '@/config.js';

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
  for (let i = 0; i < DUCK_COUNT; i++) {
    const mesh = _buildDuck();
    scene.add(mesh);
    _ducks.push({
      mesh,
      // Each duck drifts around its own ellipse inside the lake (well off the banks).
      ax: lake.rx * (0.15 + 0.3 * rand()), az: lake.rz * (0.15 + 0.3 * rand()),
      ox: (rand() - 0.5) * lake.rx * 0.25, oz: (rand() - 0.5) * lake.rz * 0.25,
      angle: rand() * Math.PI * 2,
      speed: (0.05 + rand() * 0.05) * (rand() < 0.5 ? 1 : -1),
      bob: rand() * Math.PI * 2,
    });
  }
}

// ── Per-frame ─────────────────────────────────────────────────────────────────

/** @param {number} dt seconds  @param {number} daylight 0 (night) … 1 (day) */
export function updateWildlife(dt, daylight) {
  const lake = getLake();
  for (const d of _ducks) {
    d.angle += d.speed * dt;
    d.bob += dt * 2;
    const x = lake.x + d.ox + Math.cos(d.angle) * d.ax;
    const z = lake.z + d.oz + Math.sin(d.angle) * d.az;
    // Face the direction of travel (tangent of the ellipse).
    const tx = -Math.sin(d.angle) * d.ax * Math.sign(d.speed);
    const tz =  Math.cos(d.angle) * d.az * Math.sign(d.speed);
    d.mesh.position.set(x, WATER_Y + 0.08 + Math.sin(d.bob) * 0.04, z);
    d.mesh.rotation.y = Math.atan2(tx, tz);
    d.mesh.rotation.z = Math.sin(d.bob * 0.7) * 0.04;
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
