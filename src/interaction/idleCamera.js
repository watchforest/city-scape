/**
 * Idle camera — a screensaver tour. When nobody has touched anything for a while (or the Tour button / `I` key is pressed)
 * the camera either turns slowly round the diorama or jumps to a random person and follows them for a while, then goes on
 * to the next, mixing the two. The Follow button opens a list instead: a random person after another, or one person in
 * particular, who is then followed for good. Any input (mouse, wheel, touch, keys) ends it and flies the camera back to
 * the view the page opened with.
 *
 * It only drives existing pieces: OrbitControls' auto-rotate for the turn, and CameraController.follow / goHome.
 */

import { IDLE_CAMERA } from '@/config.js';
import { applyNameColor } from '@/ui/agentColors.js';

const rangeRand = ([a, b]) => a + Math.random() * (b - a);

/**
 * @param {object} o
 * @param {import('./cameraController.js').CameraController} o.camController
 * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} o.controls
 * @param {() => object[]} o.getAgents
 * @param {() => ({ contain: number, comfort: number })} o.followFrame  framing for following a person
 * @param {number} o.followHeight  height above the feet the camera looks at
 * @param {{ target: THREE.Vector3, dist: number, dir: THREE.Vector3 }} o.orbitView  the view to turn round the diorama from: centred on the middle of the park
 */
export function createIdleCamera({ camController, controls, getAgents, followFrame, followHeight, orbitView }) {
  let on = false;          // a tour is running
  let phase = null;        // 'orbit' | 'follow'
  let timer = 0;           // seconds left in this phase
  let lastAgent = null;
  let idleFor = 0;         // seconds since the last input
  let followOnly = false;  // the Follow button: always someone, never the turn round the park
  let fixed = null;        // a person chosen from the Follow list: the camera stays with them until stopped

  // ── The buttons: "Follow" (follow one random person after another) and "Tour" (turn round the park, then people) ──
  const bar = document.createElement('div');
  bar.dataset.tour = '1';
  bar.style.cssText = 'position: fixed; right: 16px; bottom: 14px; z-index: 30; display: flex; gap: 8px;';
  const makeButton = (onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = `
      cursor: pointer; padding: 6px 12px; border-radius: 16px; border: 1px solid var(--ui-border, #c8a850);
      background: var(--ui-bg, rgba(255,248,230,0.95)); color: var(--ui-text, #2d1a00);
      font: 600 12px/1.2 system-ui, sans-serif; opacity: 0.85;`;
    b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    bar.appendChild(b);
    return b;
  };
  const followButton = makeButton(() => { if (on && followOnly) stop(true); else toggleMenu(); });
  const tourButton = makeButton(() => { closeMenu(); toggle(false); });
  document.body.appendChild(bar);
  const paint = () => {
    followButton.textContent = on && followOnly ? '■ Stop following' : '▶ Follow ▴';
    followButton.title = 'Follow somebody: pick a person, or a random one after another (F)';
    tourButton.textContent = on && !followOnly ? '■ Stop tour' : '▶ Tour';
    tourButton.title = 'Camera tour (I)';
  };
  paint();


  // ── The Follow list: a random person (switching every so often) or one in particular (stays with them) ───────
  const menu = document.createElement('div');
  menu.dataset.tour = '1';
  menu.style.cssText = `
    position: fixed; right: 16px; bottom: 52px; z-index: 31; display: none; min-width: 200px; max-height: 50vh; overflow-y: auto;
    padding: 4px; border-radius: 10px; border: 1px solid var(--ui-border, #c8a850);
    background: var(--ui-bg, rgba(255,248,230,0.97)); color: var(--ui-text, #2d1a00);
    box-shadow: 0 4px 16px rgba(0,0,0,0.3); font: 600 12px/1.3 system-ui, sans-serif;`;
  document.body.appendChild(menu);
  const addItem = (text, onPick, style) => {
    const it = document.createElement('div');
    it.textContent = text;
    it.style.cssText = 'padding: 5px 10px; border-radius: 6px; cursor: pointer; white-space: nowrap;';
    it.addEventListener('mouseenter', () => { it.style.background = 'rgba(128,128,128,0.2)'; });
    it.addEventListener('mouseleave', () => { it.style.background = ''; });
    it.addEventListener('click', e => { e.stopPropagation(); closeMenu(); onPick(); });
    style?.(it);
    menu.appendChild(it);
  };
  function openMenu() {
    menu.replaceChildren();
    addItem('🎲  Someone random', () => start(true, null), it => { it.style.borderBottom = '1px solid var(--ui-border, #c8a850)'; it.style.borderRadius = '6px 6px 0 0'; });
    const people = [...getAgents()].sort((a, b) => (a.person?.name ?? '').localeCompare(b.person?.name ?? ''));
    for (const agent of people) addItem(agent.person?.name ?? '?', () => start(true, agent), it => applyNameColor(it, agent));
    menu.style.display = 'block';
  }
  function closeMenu() { menu.style.display = 'none'; }
  function toggleMenu() { if (menu.style.display === 'block') closeMenu(); else openMenu(); }

  // ── Starting and stopping ──────────────────────────────────────────────────
  function startOrbit() {
    phase = 'orbit';
    timer = rangeRand(IDLE_CAMERA.orbitTime);
    controls.autoRotate = false;           // switched on once the camera is back on the overview (update)
    if (camController.mode !== 'free' || !_nearOrbitView()) camController.flyToView(orbitView);
  }

  function startFollow() {
    if (fixed) {                           // a chosen person: stay with them for good
      lastAgent = fixed;
      phase = 'follow';
      timer = Infinity;
      controls.autoRotate = false;
      camController.follow(fixed.mesh, followFrame(), followHeight);
      return;
    }
    let agents = getAgents().filter(a => a !== lastAgent);
    if (!agents.length && followOnly) agents = getAgents();   // (only one person: stay with them)
    if (!agents.length) return startOrbit();
    const agent = agents[Math.floor(Math.random() * agents.length)];
    lastAgent = agent;
    phase = 'follow';
    timer = rangeRand(IDLE_CAMERA.followTime);
    controls.autoRotate = false;
    camController.follow(agent.mesh, followFrame(), followHeight);
  }

  function next() {
    // After a spell of orbiting always visit someone; after following someone, usually someone else.
    if (followOnly || phase === 'orbit' || Math.random() < IDLE_CAMERA.followShare) startFollow(); else startOrbit();
  }

  /**
   * @param {boolean} [onlyFollow]  just follow people (no turn round the park)
   * @param {object|null} [person]  with onlyFollow: this person for good (otherwise a random one, then another)
   */
  function start(onlyFollow = false, person = null) {
    if (on) stop(false);                   // (from a tour straight to following someone)
    on = true;
    followOnly = onlyFollow;
    fixed = onlyFollow ? person : null;
    paint();
    if (followOnly) startFollow(); else startOrbit();
  }

  /** @param {boolean} reset  fly back to the opening view */
  function stop(reset = true) {
    if (!on) return;
    on = false;
    phase = null;
    fixed = null;
    controls.autoRotate = false;
    if (reset) camController.goHome();
    paint();
    idleFor = 0;
  }

  function toggle(onlyFollow = false) { closeMenu(); if (on) stop(true); else start(onlyFollow); }

  // ── Input ends the tour (and restarts the idle clock) ──────────────────────
  const touched = () => { idleFor = 0; closeMenu(); if (on) stop(true); };
  const fromButton = e => !!e.target?.closest?.('[data-tour]');
  window.addEventListener('pointerdown', e => { if (!fromButton(e)) touched(); }, true);
  window.addEventListener('wheel', touched, { passive: true, capture: true });
  window.addEventListener('touchstart', e => { if (!fromButton(e)) touched(); }, { passive: true, capture: true });
  window.addEventListener('pointermove', e => { if (e.buttons) touched(); }, true);   // (just moving the mouse is not input)
  window.addEventListener('keydown', e => {
    if (e.key === 'i' || e.key === 'I') { e.preventDefault(); toggle(false); idleFor = 0; return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggle(true); idleFor = 0; return; }
    touched();
  }, true);

  /** Is the camera already (nearly) on the view to turn round the park from? */
  function _nearOrbitView() {
    const cam = camController._cam;
    const dist = cam.position.distanceTo(controls.target);
    return controls.target.distanceTo(orbitView.target) < 4 && Math.abs(dist - orbitView.dist) < orbitView.dist * 0.04
      && cam.position.clone().sub(controls.target).normalize().dot(orbitView.dir) > 0.995;
  }

  /** Per frame. */
  function update(dt) {
    if (!on) {
      idleFor += dt;
      if (idleFor >= IDLE_CAMERA.delay && camController.mode === 'free' && !document.hidden) start();
      return;
    }
    timer -= dt;
    if (phase === 'orbit') {
      // Once the flight back to the overview is over, turn.
      if (camController.mode === 'free' && !controls.autoRotate) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = IDLE_CAMERA.orbitSpeed;
      }
    } else if (phase === 'follow' && camController.mode !== 'follow') {
      startFollow();                       // something took the camera off the person: pick up again
    }
    if (timer <= 0) next();
  }

  return { update, toggle, start, stop, get running() { return on; } };
}
