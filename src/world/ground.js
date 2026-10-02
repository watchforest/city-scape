import * as THREE from 'three';
import { GRASS_COLOR, GROUND_SIDE_COLOR, TERRAIN_MAX_HEIGHT } from '@/config.js';
import { getTerrainHeight, getGroundVariation } from './terrain.js';
import { getParkHalf } from './parkBounds.js';
import { getLakeBedOffset } from './lake.js';

// Ground color palette — interpolated per vertex based on height + variation noise
// Low/wet: dark moss green → mid grass → high/dry: straw yellow
const COL_LOW  = new THREE.Color(0x3a6b2e); // dark moss
const COL_MID  = new THREE.Color(0x4a7c3f); // base grass
const COL_HIGH = new THREE.Color(0x7a8c4a); // dry hilltop
const COL_VAR  = new THREE.Color(0x6b7a32); // variation patch tint (subtle yellow-green)
const COL_SAND = new THREE.Color(0xb3a169); // lake banks around the waterline
const COL_MUD  = new THREE.Color(0x3f4a38); // lake bed, seen through the shallows

/** 0 at `from`, 1 at `to` (either order), clamped. */
function _ramp(v, from, to) { const t = (v - from) / (to - from); return t < 0 ? 0 : t > 1 ? 1 : t; }

export function buildGround(scene, rand) {
  // ── Terrain grass plane (subdivided so it can deform) ───────────────────────
  const SIZE = getParkHalf() * 2;                // exactly the park, so the grass runs to the frame
  const SEGS = Math.max(40, Math.round(SIZE / 3));   // ~3 units per cell (fine enough for the lake banks)
  const geo  = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;

  // Build vertex colors
  const colors = new Float32Array(pos.count * 3);
  const _col   = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = getTerrainHeight(x, z);
    pos.setY(i, h);

    // Height-based blend: 0 = low, 1 = high
    const heightT = Math.min(h / TERRAIN_MAX_HEIGHT, 1);
    // Variation noise: 0-1 independent patch texture
    const varT    = getGroundVariation(x, z);

    // Base color from height
    if (heightT < 0.5) {
      _col.lerpColors(COL_LOW, COL_MID, heightT * 2);
    } else {
      _col.lerpColors(COL_MID, COL_HIGH, (heightT - 0.5) * 2);
    }

    // Subtle variation tint — only in mid-height areas, driven by patch noise
    const varStrength = (1 - Math.abs(heightT - 0.3) / 0.5) * 0.35;
    if (varT > 0.55 && varStrength > 0) {
      _col.lerp(COL_VAR, varT * varStrength);
    }

    // Lake banks: sand around the waterline, darker mud on the bed below it.
    const lb = getLakeBedOffset(x, z);
    if (lb < -0.001) {
      _col.lerp(COL_SAND, _ramp(lb, 0, -0.25));
      _col.lerp(COL_MUD,  _ramp(lb, -0.5, -1.6));
    }

    colors[i * 3 + 0] = _col.r;
    colors[i * 3 + 1] = _col.g;
    colors[i * 3 + 2] = _col.b;
  }

  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat  = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);

  // ── Diorama box ──────────────────────────────────────────────────────────────
  // Sides and bottom only, plus a thin frame ring around the grass. The top face is
  // deliberately invisible: a solid top sunk 1 unit below ground would poke through
  // the lake bed wherever it dips deeper than that.
  const BOX_DEPTH  = 25 + TERRAIN_MAX_HEIGHT;
  const BOX_SINK   = 1;     // frame ring sits this far below y = 0 so it never z-fights the ground
  const sideMat    = new THREE.MeshLambertMaterial({ color: GROUND_SIDE_COLOR });
  const hiddenMat  = new THREE.MeshBasicMaterial({ visible: false });

  const outer = SIZE + 20;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(outer, BOX_DEPTH, outer),
    [sideMat, sideMat, hiddenMat, sideMat, sideMat, sideMat], // +x, -x, +y (top), -y, +z, -z
  );
  box.position.y = -(BOX_DEPTH / 2) - BOX_SINK;
  box.receiveShadow = true;
  scene.add(box);

  const o = outer / 2, i = SIZE / 2;
  const ringShape = new THREE.Shape();
  ringShape.moveTo(-o, -o); ringShape.lineTo(o, -o); ringShape.lineTo(o, o); ringShape.lineTo(-o, o); ringShape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-i, -i); hole.lineTo(-i, i); hole.lineTo(i, i); hole.lineTo(i, -i); hole.closePath();
  ringShape.holes.push(hole);
  const ring = new THREE.Mesh(new THREE.ShapeGeometry(ringShape), sideMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -BOX_SINK + 0.01;
  ring.receiveShadow = true;
  scene.add(ring);

  return mesh;
}
