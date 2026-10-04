/**
 * Wildlife: a flock of birds circling high above the park by day, and a few ducks paddling on the lake.
 *
 * Birds are one InstancedMesh (two-triangle "V" wings); the flap runs in the vertex shader from the
 * instance position, so the per-frame JS work is just moving ~a dozen matrices. Ducks are tiny
 * hand-built groups that drift on slow ellipses inside the lake.
 */

import * as THREE from 'three';
import { getLake, WATER_Y } from './lake.js';
import { getParkHalf, getParkAreaScale } from './parkBounds.js';
import { BIRD_COUNT, DUCK_COUNT } from '@/config.js';

const _birds = [];
let _birdMesh = null;
let _birdTime = { value: 0 };
const _ducks = [];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

// ── Birds ─────────────────────────────────────────────────────────────────────

function _birdGeometry() {
  // Body-length along +z, wings out along ±x; the wing tips (x = ±1) get flapped in the shader.
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    -2.6, 0, -0.9,   0, 0, 1.2,   0, 0, -0.9,   // left wing
     2.6, 0, -0.9,   0, 0, -0.9,  0, 0, 1.2,    // right wing
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  return g;
}

export function buildBirds(scene, rand) {
  const count = Math.round(BIRD_COUNT * Math.max(1, getParkAreaScale()));
  const mat = new THREE.MeshBasicMaterial({ color: 0xf4f4ef, side: THREE.DoubleSide }); // pale gulls read against both sky and grass
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.birdTime = _birdTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float birdTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // flap: wing tips (|x| large) move up and down, out of phase per bird
        float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
        transformed.y += abs(position.x) * sin(birdTime * 7.0 + phase) * 0.7;`);
  };
  _birdMesh = new THREE.InstancedMesh(_birdGeometry(), mat, count);
  _birdMesh.frustumCulled = false; // matrices change every frame; the bounding sphere would be stale
  _birdMesh.castShadow = false;
  scene.add(_birdMesh);

  const half = getParkHalf();
  for (let i = 0; i < count; i++) {
    // Small flocks: birds share a circling centre and drift a little apart.
    const flock = Math.floor(i / 4);
    const fr = (flock + 1) * 9301 % 1000 / 1000;
    _birds.push({
      cx: (fr * 2 - 1) * half * 0.5, cz: (((flock * 7 + 3) * 4231 % 1000) / 1000 * 2 - 1) * half * 0.5,
      radius: half * (0.25 + 0.2 * rand()),
      height: 55 + rand() * 25,
      speed: (0.07 + rand() * 0.05) * (rand() < 0.5 ? 1 : -1) * (flock % 2 ? 1 : -1),
      angle: rand() * Math.PI * 2,
      bob: rand() * Math.PI * 2,
      scale: 1.2 + rand() * 0.5,
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

  if (!_birdMesh) return;
  _birdMesh.visible = daylight > 0.25; // birds roost at dusk
  if (!_birdMesh.visible) return;
  _birdTime.value += dt;
  for (let i = 0; i < _birds.length; i++) {
    const b = _birds[i];
    b.angle += b.speed * dt;
    const x = b.cx + Math.cos(b.angle) * b.radius;
    const z = b.cz + Math.sin(b.angle) * b.radius;
    const dir = Math.sign(b.speed);
    const heading = Math.atan2(-Math.sin(b.angle) * dir, Math.cos(b.angle) * dir); // tangent
    _p.set(x, b.height + Math.sin(_birdTime.value * 0.8 + b.bob) * 1.5, z);
    _q.setFromAxisAngle(_up, heading);
    _s.setScalar(b.scale);
    _birdMesh.setMatrixAt(i, _m.compose(_p, _q, _s));
  }
  _birdMesh.instanceMatrix.needsUpdate = true;
}
