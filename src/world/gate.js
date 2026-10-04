/**
 * The gate — a stone-and-timber arch halfway along the entrance path. Between the two stone pillars hangs the sign,
 * a green board with the text (site.json → gateText; see data/loader.js) framed by a wooden plank above and one below,
 * under a timber lintel. Built from boxes; the board is a canvas texture, the text as large as the board allows (broken
 * over two lines when that makes it bigger). The arch faces out along the path: the sign reads from outside (the
 * camera's side) and from inside as well.
 */

import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';
import { registerCircle, registerSolid } from './obstacleRegistry.js';
import { addContactShade } from './groundShade.js';
import { applyLampLight } from './lampLight.js';

const GAP        = 30;    // clear width between the pillars (the path is 8 wide)
const PILLAR_W   = 3.6;
const PILLAR_H   = 24;
const PANEL_H    = 9.5;   // the sign board, between the pillars, hanging from the lintel
const PANEL_D    = 1.4;
const PLANK_H    = 1.4;   // the wooden plank under the board …
const LINTEL_H   = 1.9;   // … and the timber lintel over it, resting on the pillars
const LINTEL_D   = 3.4;
const FLOOD_DISTANCE = 9;   // the floodlights stand this far in front of the sign

/** Sign texture: cream lettering on dark green, as big as fits (two lines if that is bigger). */
function _signTexture(text, aspect) {
  const w = 2048, h = Math.round(w / aspect);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#1f3a2a'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#d9c58a'; g.lineWidth = 14; g.strokeRect(24, 24, w - 48, h - 48);
  g.strokeStyle = 'rgba(217,197,138,0.5)'; g.lineWidth = 4; g.strokeRect(48, 48, w - 96, h - 96);
  g.fillStyle = '#fbf3d8'; g.textAlign = 'center'; g.textBaseline = 'middle';

  const family = '800 SIZEpx Georgia, "Times New Roman", serif';
  const fit = (lines) => {                               // the largest font that fits the lines in the board
    const maxW = w - 220, maxH = h - 190;
    let size = Math.floor(maxH / (lines.length * 1.18));
    for (; size > 20; size -= 4) {
      g.font = family.replace('SIZE', size);
      if (lines.every(l => g.measureText(l).width <= maxW)) break;
    }
    return size;
  };
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  let lines = [words.join(' ')], size = fit(lines);
  if (words.length > 2) {
    // The split that makes the two lines most even.
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      g.font = family.replace('SIZE', 100);
      const diff = Math.abs(g.measureText(a).width - g.measureText(b).width);
      if (!best || diff < best.diff) best = { lines: [a, b], diff };
    }
    const two = fit(best.lines);
    if (two > size * 1.2) { lines = best.lines; size = two; }
  }
  g.font = family.replace('SIZE', size);
  const lh = size * 1.18, y0 = h / 2 - (lines.length - 1) * lh / 2 + size * 0.04;
  lines.forEach((l, i) => g.fillText(l, w / 2, y0 + i * lh));

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * @param {THREE.Scene} scene
 * @param {{ mid: {u, v}, dir: {u, v} } | null} plan  from planGatePath: the arch stands at `mid`, the path runs along `dir`
 * @param {string} text
 * @returns {{ x: number, z: number }[]} the lamp positions at the pillars (for the lamp light map)
 */
export function buildGate(scene, plan, text) {
  if (!plan) return [];
  const { mid, dir } = plan;                           // it stands halfway along the path
  const yaw = Math.atan2(-dir.u, -dir.v);              // local +Z = outwards, away from the park
  const group = new THREE.Group();
  group.position.set(mid.u, 0, mid.v);
  group.rotation.y = yaw;

  const stone = new THREE.MeshLambertMaterial({ color: 0x9a948a, flatShading: true });
  const wood  = new THREE.MeshLambertMaterial({ color: 0x5a3b22, flatShading: true });
  const sign  = new THREE.MeshLambertMaterial({ map: _signTexture(text, GAP / PANEL_H) });
  const plain = new THREE.MeshLambertMaterial({ color: 0x1f3a2a });
  for (const m of [stone, wood, sign, plain]) applyLampLight(m, 1);
  // Box faces: +x, −x, +y, −y, +z (outside), −z (inside)
  const panelMats = [plain, plain, plain, plain, sign, sign];

  const pillarX = GAP / 2 + PILLAR_W / 2;
  const lamps = [];
  const feet = [-1, 1].map(side => getTerrainHeight(mid.u + Math.cos(yaw) * pillarX * side, mid.v - Math.sin(yaw) * pillarX * side));
  const top = Math.min(...feet) - 0.4 + PILLAR_H;      // pillars stand on the lower ground; the higher one sinks in

  [-1, 1].forEach((side, i) => {
    const wx = mid.u + Math.cos(yaw) * pillarX * side, wz = mid.v - Math.sin(yaw) * pillarX * side;
    const foot = feet[i] - 0.4;
    const h = top - foot;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(PILLAR_W, h, PILLAR_W), stone);
    pillar.position.set(side * pillarX, foot + h / 2, 0);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(PILLAR_W * 1.35, 1.2, PILLAR_W * 1.35), stone);
    plinth.position.set(side * pillarX, foot + 0.6, 0);
    const capital = new THREE.Mesh(new THREE.BoxGeometry(PILLAR_W * 1.25, 0.8, PILLAR_W * 1.25), stone);
    capital.position.set(side * pillarX, top - 0.4, 0);
    for (const m of [pillar, plinth, capital]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
    registerCircle(wx, wz, 3);
    registerSolid(wx, wz, PILLAR_W * 0.7);
    addContactShade(wx, wz, 4.5, 0.4);
    lamps.push({ x: wx + Math.cos(yaw) * side * 5, z: wz - Math.sin(yaw) * side * 5 });  // a lantern just outside each pillar
  });

  // Lintel on top, the board hanging under it, a plank under the board; the board and plank fit between the pillars.
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(GAP + PILLAR_W * 2 + 1.6, LINTEL_H, LINTEL_D), wood);
  lintel.position.set(0, top + LINTEL_H / 2, 0);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(GAP + 0.6, PANEL_H, PANEL_D), panelMats);
  panel.position.set(0, top - PANEL_H / 2, 0);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(GAP + 0.6, PLANK_H, PANEL_D + 0.6), wood);
  plank.position.set(0, top - PANEL_H - PLANK_H / 2, 0);
  for (const m of [lintel, panel, plank]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }

  addFloodlights(group, mid, yaw, top, lamps);
  registerCircle(mid.u, mid.v, GAP / 2 + 3);           // no bench or tree in the doorway
  scene.add(group);
  return lamps;
}

// ── Floodlights ───────────────────────────────────────────────────────────────
// Two projectors stand on the ground in front of the sign and shine up at it. After dark: their lenses glow, a faint
// beam of light runs from each to the board, and the lower part of the board is washed with warm light (a gradient plane
// just in front of it) — all faked, no real lights; `updateGate(night)` fades it in with the day cycle.

const _glow = { lens: null, beams: [], wash: null };   // what updateGate drives

/** Vertical fade as an alpha map: `bottom` and `top` are the grey levels (0–255) at the bottom and top of the object's v. */
function _fadeMap(bottom, top) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);     // canvas top = v 1
  grad.addColorStop(0, `rgb(${top},${top},${top})`);
  grad.addColorStop(1, `rgb(${bottom},${bottom},${bottom})`);
  g.fillStyle = grad; g.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
}

function addFloodlights(group, mid, yaw, top, lamps) {
  const toWorld = (x, z) => ({ x: mid.u + Math.cos(yaw) * x + Math.sin(yaw) * z, z: mid.v - Math.sin(yaw) * x + Math.cos(yaw) * z });
  const metal = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
  const lens = new THREE.MeshLambertMaterial({ color: 0x555044, emissive: new THREE.Color(1.0, 0.82, 0.5), emissiveIntensity: 0 });
  for (const m of [metal, lens]) applyLampLight(m, 0.6);
  _glow.lens = lens;

  const aimAt = new THREE.Vector3(0, top - PANEL_H * 0.55, PANEL_D / 2);       // the middle of the board
  for (const side of [-1, 1]) {
    const lx = side * GAP * 0.4, lz = FLOOD_DISTANCE;     // well off to the sides of the path
    const w = toWorld(lx, lz);
    const gy = getTerrainHeight(w.x, w.z);
    const pos = new THREE.Vector3(lx, gy + 0.5, lz);

    // The projector: a squat box on a base, tilted to point at the board.
    const dir = aimAt.clone().sub(pos).normalize();
    const head = new THREE.Group();
    head.position.copy(pos).add(new THREE.Vector3(0, 0.9, 0));
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);        // its front (−z) faces the board
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 1.8), metal);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 0.12), lens);
    glass.position.set(0, 0, -0.95);
    head.add(body, glass);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.6), metal);
    base.position.set(lx, gy + 0.2, lz);
    for (const m of [body, base]) { m.castShadow = true; m.receiveShadow = true; }
    group.add(head, base);
    registerSolid(w.x, w.z, 1.1);
    lamps.push({ x: w.x, z: w.z });                                              // lights up the ground round it

    // The beam: a soft cone from the lens to the board, brightest at the lens.
    const from = head.position.clone().addScaledVector(dir, 1.0), to = aimAt.clone();
    const len = from.distanceTo(to);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, alphaMap: _fadeMap(255, 70),
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(GAP * 0.2, 0.5, len, 20, 1, true), beamMat);
    beam.position.copy(from).add(to).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    beam.renderOrder = 6;
    group.add(beam);
    _glow.beams.push(beamMat);
  }

  // The wash on the board: warm light climbing the sign from the bottom.
  const washMat = new THREE.MeshBasicMaterial({
    color: 0xffd08a, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, alphaMap: _fadeMap(255, 20),
  });
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(GAP, PANEL_H), washMat);
  wash.position.set(0, top - PANEL_H / 2, PANEL_D / 2 + 0.04);
  wash.renderOrder = 7;
  group.add(wash);
  _glow.wash = washMat;
}

/** Fade the floodlights with the night (0 = day … 1 = night): glowing lenses, faint beams, the board washed with light. */
export function updateGate(night) {
  if (!_glow.lens) return;
  _glow.lens.emissiveIntensity = night * 2.2;
  for (const b of _glow.beams) b.opacity = night * 0.065;
  _glow.wash.opacity = night * 0.42;
}
