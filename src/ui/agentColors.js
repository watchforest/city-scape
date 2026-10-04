/**
 * Name colours for people — chat bubbles and name labels use the colour of the character they belong to.
 *
 * When a character model is loaded its main colour is worked out once (`nameColorsFor`): the colour that covers the most
 * triangles of its materials, so a light-orange body wins over a black beanie, glasses and a coffee cup. A grey or white
 * body has no colour to speak of (the default character), so its name is a plain grey. In every case the hue is kept and the
 * lightness is set for reading: dark on the pale day theme, light on the dark night theme.
 *
 * Elements get `applyNameColor(el, agent)`: a class and two custom properties; the stylesheet below picks the day or night
 * one from `<html data-night>` (set by DayCycle together with the other theme variables).
 */

import * as THREE from 'three';

const NEUTRAL_SATURATION = 0.12;   // below this the main colour counts as grey/white/black: its saturation is kept as it is, not boosted
const _cache = new WeakMap();      // model scene → { day, night } | null
const _hsl = {};

/**
 * @param {THREE.Object3D} scene  a loaded character model
 * @returns {{ day: string, night: string } | null}  CSS colours, or null for a neutral character
 */
export function nameColorsFor(scene) {
  if (_cache.has(scene)) return _cache.get(scene);

  // Triangles per colour (colours that differ by less than a few percent share a bucket).
  const area = new Map();
  scene.traverse(o => {
    if (!o.isMesh) return;
    const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    // (a multi-material mesh would need its draw groups; characters here use one material per mesh)
    for (const m of mats) {
      if (!m?.color) continue;
      const hex = m.color.getHex(THREE.SRGBColorSpace) & 0xf8f8f8;
      const e = area.get(hex) ?? { tris: 0, color: m.color };
      e.tris += tris / mats.length;
      area.set(hex, e);
    }
  });
  let main = null;
  for (const e of area.values()) if (!main || e.tris > main.tris) main = e;

  let result = null;
  if (main) {
    // Everyone gets a name colour from their character, a white or grey one included (a dark grey by day, a light grey at
    // night, so they are not all in the theme's accent colour): the hue and saturation are kept, only the lightness is set.
    main.color.getHSL(_hsl, THREE.SRGBColorSpace);
    const h = Math.round(_hsl.h * 360);
    const colourful = _hsl.s >= NEUTRAL_SATURATION;
    const s = colourful ? Math.round(Math.min(1, Math.max(0.55, _hsl.s)) * 100) : Math.round(_hsl.s * 100);
    result = { day: `hsl(${h} ${s}% 28%)`, night: `hsl(${h} ${colourful ? Math.max(s, 70) : s}% 72%)` };
  }
  _cache.set(scene, result);
  return result;
}

let _styled = false;
function _ensureStyle() {
  if (_styled) return;
  _styled = true;
  const s = document.createElement('style');
  s.textContent = `
    .agent-name { --name-c: var(--name-day); }
    html[data-night="1"] .agent-name { --name-c: var(--name-night); }`;
  document.head.appendChild(s);
}

/** Give `el` (a name) the colour of `agent`'s character, if it has one. */
export function applyNameColor(el, agent) {
  const c = agent?.nameColors;
  if (!c) return;
  _ensureStyle();
  el.classList.add('agent-name');
  el.style.color = 'var(--name-c)';       // (inline, to win over the element's own colour rule)
  el.style.setProperty('--name-day', c.day);
  el.style.setProperty('--name-night', c.night);
}
