/**
 * A layer of always-on name tags floating over things in the 3D scene (landmarks, people), toggled with a key.
 *
 * One small DOM tag per thing, projected to the screen every frame (nothing at all while the layer is off). Where two
 * tags would overlap on screen the one nearest the camera is kept and the farther one hidden. Tags can be clicked.
 * The on/off setting is remembered between visits, and `onToggle(on)` lets the owner switch the cursor hover label off
 * while the tags say the same thing.
 */

import * as THREE from 'three';

const GAP = 4; // px of clear space kept between two visible tags

const TAG_CSS = `
  position: absolute; left: 0; top: 0; white-space: nowrap; will-change: transform;
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; cursor: pointer; pointer-events: auto;
  transition: opacity 0.15s;
  padding: 3px 9px; border-radius: 6px;
  font: 600 12px/1.3 system-ui, sans-serif;
  background: var(--ui-bg, rgba(255,248,230,0.95)); color: var(--ui-text, #2d1a00);
  border: 1px solid var(--ui-border, #c8a850); box-shadow: 0 2px 8px rgba(0,0,0,0.25);`;

/**
 * @param {object} o
 * @param {THREE.Camera} o.cam
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {string} o.storageKey  localStorage key for the on/off setting
 * @param {(on: boolean) => void} [o.onToggle]
 * @param {number} [o.zIndex]
 */
export function createLabelLayer({ cam, renderer, storageKey, onToggle = () => {}, zIndex = 15 }) {
  const container = document.createElement('div');
  container.style.cssText = `position: fixed; inset: 0; z-index: ${zIndex}; pointer-events: none; overflow: hidden; display: none;`;
  document.body.appendChild(container);

  const tags = [];                 // { el, getPos(out), ... }
  let visible = false;
  const v = new THREE.Vector3();
  const shown = [];                // screen rectangles kept this frame (reused)

  /**
   * Add a tag.
   * @param {string} text
   * @param {(out: THREE.Vector3) => void} getPos  writes the world position the tag is anchored at (bottom centre)
   * @param {() => void} [onClick]
   * @param {(el: HTMLElement) => void} [style]  extra styling (e.g. a name colour)
   */
  function add(text, getPos, onClick, style) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = TAG_CSS;
    if (onClick) el.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    style?.(el);
    container.appendChild(el);
    tags.push({ el, getPos, shown: undefined, w: 0, h: 0 });
  }

  function set(on) {
    visible = on;
    container.style.display = on ? 'block' : 'none';
    onToggle(on);
    try { localStorage.setItem(storageKey, on ? '1' : '0'); } catch { /* storage blocked: fine */ }
  }

  function init() {
    let saved = false;
    try { saved = localStorage.getItem(storageKey) === '1'; } catch { /* storage blocked: start off */ }
    set(saved);
  }

  /** Call every frame. */
  function update() {
    if (!visible) return;
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    const onScreen = [];
    for (const t of tags) {
      t.getPos(v);
      const wx = v.x, wy = v.y, wz = v.z;
      v.project(cam);
      if (v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) {
        t.sx = ((v.x + 1) / 2) * w;
        t.sy = ((1 - v.y) / 2) * h;
        t.dist = (wx - cam.position.x) ** 2 + (wy - cam.position.y) ** 2 + (wz - cam.position.z) ** 2;
        onScreen.push(t);
      } else if (t.shown !== 'off') {
        t.el.style.display = 'none';
        t.shown = 'off';
      }
    }
    onScreen.sort((a, b) => a.dist - b.dist);

    shown.length = 0;
    onScreen.forEach((t, rank) => {
      if (t.shown === 'off' || t.shown === undefined) { t.el.style.display = 'block'; t.shown = 'on'; }
      if (!t.w) { t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; } // measured once, when it first appears
      const x0 = t.sx - t.w / 2 - GAP, x1 = t.sx + t.w / 2 + GAP, y0 = t.sy - t.h - GAP, y1 = t.sy + GAP;
      const blocked = shown.some(r => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]);
      if (!blocked) shown.push([x0, y0, x1, y1]);
      t.el.style.opacity = blocked ? '0' : '1';
      t.el.style.pointerEvents = blocked ? 'none' : 'auto';   // a hidden tag must not catch clicks
      t.el.style.zIndex = String(onScreen.length - rank);     // nearer on top
      t.el.style.transform = `translate(${t.sx}px, ${t.sy}px) translate(-50%, -100%)`;
    });
  }

  return { add, set, toggle() { set(!visible); return visible; }, init, update, get visible() { return visible; } };
}
