/**
 * Always-on project name labels floating over the landmarks, toggled with a key (L).
 *
 * One small DOM tag per landmark, projected to the screen every frame. While they are on, the cursor hover label
 * (hoverLabel.js) is switched off, since it would only repeat the name. The setting is remembered between visits.
 */

import * as THREE from 'three';
import { setHoverLabelEnabled } from './hoverLabel.js';

const STORAGE_KEY = 'city-scape:landmark-labels';
const LIFT = 3; // world units above the top of the landmark

let _cam = null;
let _renderer = null;
let _labels = []; // { el, pos: Vector3, name }
let _visible = false;
let _container = null;
const _v = new THREE.Vector3();

/**
 * @param {THREE.PerspectiveCamera} cam
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ group: THREE.Object3D, instance: { name: string, displayU: number, displayV: number } }[]} attractionMeshes
 */
export function initLandmarkLabels(cam, renderer, attractionMeshes) {
  _cam = cam;
  _renderer = renderer;

  _container = document.createElement('div');
  _container.style.cssText = 'position: fixed; inset: 0; z-index: 15; pointer-events: none; overflow: hidden; display: none;';
  document.body.appendChild(_container);

  _labels = attractionMeshes.map(({ group, instance }) => {
    const top = new THREE.Box3().setFromObject(group).max.y; // landmark roof (world y)
    const el = document.createElement('div');
    el.textContent = instance.name;
    el.style.cssText = `
      position: absolute; left: 0; top: 0; white-space: nowrap; will-change: transform;
      transition: opacity 0.15s;
      padding: 3px 9px; border-radius: 6px;
      font: 600 12px/1.3 system-ui, sans-serif;
      background: var(--ui-bg, rgba(255,248,230,0.95)); color: var(--ui-text, #2d1a00);
      border: 1px solid var(--ui-border, #c8a850); box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    `;
    _container.appendChild(el);
    return { el, pos: new THREE.Vector3(instance.displayU, top + LIFT, instance.displayV) };
  });

  let saved = false;
  try { saved = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage blocked: start off */ }
  setLandmarkLabels(saved);
}

export function setLandmarkLabels(on) {
  _visible = on;
  if (_container) _container.style.display = on ? 'block' : 'none';
  setHoverLabelEnabled(!on);
  try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* storage blocked: fine */ }
}

export function toggleLandmarkLabels() {
  setLandmarkLabels(!_visible);
  return _visible;
}

const GAP = 4; // px of clear space kept between two visible labels
const _shown = []; // screen rectangles of the labels kept visible this frame (reused)

/**
 * Call every frame (cheap: one projection per landmark, and nothing at all while the labels are off).
 * Where labels would overlap on screen, the one nearest the camera wins and the farther ones are hidden.
 */
export function updateLandmarkLabels() {
  if (!_visible) return;
  const w = _renderer.domElement.clientWidth, h = _renderer.domElement.clientHeight;

  // Project everything first, then decide in order of distance from the camera.
  const onScreen = [];
  for (const l of _labels) {
    _v.copy(l.pos).project(_cam);
    if (_v.z > -1 && _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1) {
      l.sx = ((_v.x + 1) / 2) * w;
      l.sy = ((1 - _v.y) / 2) * h;
      l.dist = l.pos.distanceToSquared(_cam.position);
      onScreen.push(l);
    } else if (l.shown !== 'off') {
      l.el.style.display = 'none';
      l.shown = 'off';
    }
  }
  onScreen.sort((a, b) => a.dist - b.dist);

  _shown.length = 0;
  onScreen.forEach((l, rank) => {
    if (l.shown === 'off' || l.shown === undefined) { l.el.style.display = 'block'; l.shown = 'on'; }
    if (!l.w) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; } // measured once, when it first appears
    // Anchored at the bottom centre of the tag.
    const x0 = l.sx - l.w / 2 - GAP, x1 = l.sx + l.w / 2 + GAP, y0 = l.sy - l.h - GAP, y1 = l.sy + GAP;
    const blocked = _shown.some(r => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]);
    if (!blocked) _shown.push([x0, y0, x1, y1]);
    l.el.style.opacity = blocked ? '0' : '1';
    l.el.style.zIndex = String(onScreen.length - rank); // nearer on top
    l.el.style.transform = `translate(${l.sx}px, ${l.sy}px) translate(-50%, -100%)`;
  });
}
