/**
 * Conversation bubbles above talking agents.
 *
 * DOM elements projected onto the screen each frame (like the landmark labels), so the text is crisp at any size and
 * follows the UI theme through the --ui-* CSS variables (day and night). A bubble shows the speaker's first name above
 * the quote and has a tail pointing at their head. It pops in from the tail, floats up a little and fades out.
 *
 * Size: normally a steady size on screen, but never bigger than CHAT_BUBBLE_MAX_PERSON_RATIO × the speaker's own
 * on-screen height, so zoomed out it shrinks along with the person instead of towering over them, and when it would be
 * too small to read (below CHAT_BUBBLE_MIN_SCALE) it is not shown at all.
 *
 * A conversation is a running 'chat' gathering (agents/gatherings.js). Its members take
 * turns: one bubble at a time per conversation, a short silence between speakers, and the
 * current speaker is recorded in gathering.speaker so the others turn to face them. A
 * bubble also waits if another one is still visible close by, so they never cover each other.
 *
 * What is said: a person's own quotes (the `quotes` column of people.csv, separated by `;`) mixed with the shared
 * pool (quotes.json). Someone with quotes of their own says one about half the time (CHAT_OWN_QUOTE_SHARE) and
 * never repeats the line they just said.
 */

import * as THREE from 'three';
import {
  CHAT_BUBBLE_GAP, CHAT_BUBBLE_CLEARANCE, CHAT_OWN_QUOTE_SHARE,
  CHAT_BUBBLE_MAX_PERSON_RATIO, CHAT_BUBBLE_MIN_SCALE,
} from '@/config.js';

const LIFETIME    = 4.5;   // seconds a bubble lives
const HEAD_HEIGHT = 4.4;   // world units above the agent's feet that the tail points at (the top of the head)
const RISE_PX     = 18;    // pixels (at full size) the bubble floats up over its life
const POP_TIME    = 0.22;  // seconds of the pop-in
const TAIL_PX     = 9;     // how far the tail tip sticks out below the bubble body

let _cam    = null;
let _quotes = [];
let _layer  = null;

// Active bubbles: { el, age, agent, anchor (world, head height), w, h, owner: the conversation (gathering) it belongs to }
const _bubbles = [];

const _v = new THREE.Vector3();
const _foot = new THREE.Vector3();

const CSS = `
  .chat-bubble {
    position: absolute; left: 0; top: 0; width: max-content; max-width: 250px;
    padding: 8px 13px 9px; border-radius: 14px;
    background: var(--ui-bg, rgba(255,248,230,0.97)); color: var(--ui-text, #2d1a00);
    border: 1.5px solid var(--ui-border, #c8a850);
    box-shadow: 0 3px 10px rgba(0,0,0,0.28);
    font: 500 14px/19px system-ui, -apple-system, "Segoe UI", sans-serif;
    transform-origin: 50% calc(100% + ${TAIL_PX}px);   /* scale about the tail tip */
    will-change: transform, opacity; opacity: 0;
  }
  .chat-bubble .who {
    font: 700 10.5px/15px system-ui, -apple-system, "Segoe UI", sans-serif;
    letter-spacing: 0.06em; text-transform: uppercase; color: var(--ui-accent, #8B6914);
  }
  .chat-bubble::after {                                 /* the tail */
    content: ''; position: absolute; left: 50%; bottom: -7.5px; width: 12px; height: 12px;
    background: inherit; border: inherit; border-top: none; border-left: none;
    border-radius: 0 0 3px 0; transform: translateX(-50%) rotate(45deg);
  }
`;

export function initChatBubbles(quotes, cam) {
  _cam    = cam;
  _quotes = Array.isArray(quotes) ? quotes : [];

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  _layer = document.createElement('div');
  _layer.style.cssText = 'position: fixed; inset: 0; z-index: 14; pointer-events: none; overflow: hidden;';
  document.body.appendChild(_layer);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call each frame.
 * @param {object[]} agents
 * @param {number}   dt
 */
export function updateChatBubbles(agents, dt) {
  if (!_layer) return;

  // The conversations running right now.
  const conversations = new Set();
  for (const agent of agents) {
    if (agent.isTalking && !agent.stopped) conversations.add(agent.gathering);
  }

  for (const g of conversations) {
    // One speaker at a time: wait until this conversation's last bubble is gone, then a pause.
    if (_bubbles.some(b => b.owner === g)) { g._silence = CHAT_BUBBLE_GAP; continue; }
    g._silence = (g._silence ?? CHAT_BUBBLE_GAP) - dt;
    if (g._silence > 0) continue;

    const speakers = g.members.filter(m => m.isTalking && !m.stopped);
    if (speakers.length < 2) continue;
    g._turn = ((g._turn ?? -1) + 1) % speakers.length;     // take turns round the group
    const speaker = speakers[g._turn];

    // Don't start on top of another conversation's bubble that is still visible nearby: retry
    // this speaker next frame.
    const sp = speaker.mesh.position;
    if (_bubbles.some(b => Math.hypot(b.anchor.x - sp.x, b.anchor.z - sp.z) < CHAT_BUBBLE_CLEARANCE)) {
      g._turn -= 1;
      continue;
    }

    g.speaker = speaker;
    _spawnBubble(speaker, g);
  }

  const W = window.innerWidth, H = window.innerHeight;
  for (let i = _bubbles.length - 1; i >= 0; i--) {
    const b = _bubbles[i];
    b.age += dt;
    if (b.age >= LIFETIME) { b.el.remove(); _bubbles.splice(i, 1); continue; }
    const t = b.age / LIFETIME;

    // Where the speaker's head and feet are on the screen.
    const ap = b.agent.mesh.position;
    b.anchor.set(ap.x, ap.y + _headHeight(b.agent), ap.z);
    _v.copy(b.anchor).project(_cam);
    _foot.set(ap.x, ap.y, ap.z).project(_cam);
    const sx = (_v.x + 1) / 2 * W, sy = (1 - _v.y) / 2 * H;
    const personPx = Math.abs((_foot.y - _v.y) / 2 * H);   // the speaker's height on screen

    // Steady size, but no bigger than CHAT_BUBBLE_MAX_PERSON_RATIO × the person; too small to read: hidden.
    const scale = Math.min(1, CHAT_BUBBLE_MAX_PERSON_RATIO * personPx / b.h);
    const visible = _v.z > -1 && _v.z < 1 && sx > -150 && sx < W + 150 && sy > -100 && sy < H + 100 && scale >= CHAT_BUBBLE_MIN_SCALE;

    const fade = t < 0.08 ? t / 0.08 : t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
    const pop = b.age < POP_TIME ? _easeOutBack(b.age / POP_TIME) : 1;
    b.el.style.opacity = visible ? String(fade) : '0';
    if (visible) {
      const rise = RISE_PX * scale * _easeOut(t);
      b.el.style.transform = `translate(${sx}px, ${sy - rise}px) translate(-50%, calc(-100% - ${TAIL_PX}px)) scale(${scale * pop})`;
    }
  }
}

/** Height of the top of the head above the agent's origin: lower when seated (the sit-down animation folds the body). */
const SEATED_DROP = 1.5;
const _headHeight = agent => HEAD_HEIGHT - (agent._sitOffset ? SEATED_DROP * agent._sitBlend : 0);

const _easeOut = t => 1 - (1 - t) * (1 - t);
const _easeOutBack = t => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

function _personQuotes(agent) {
  const raw = agent.person?.quotes;
  if (!raw) return [];
  return raw.split(';').map(s => s.trim()).filter(Boolean);
}

/**
 * A line for this agent: one of their own (people.csv) about half the time, else from the shared pool;
 * never the one they said last.
 */
function _pickQuote(agent) {
  const own = _personQuotes(agent);
  const useOwn = own.length > 0 && (_quotes.length === 0 || Math.random() < CHAT_OWN_QUOTE_SHARE);
  const pool = useOwn ? own : _quotes;
  if (pool.length === 0) return null;
  let quote = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1 && quote === agent._lastQuote) quote = pool[(pool.indexOf(quote) + 1) % pool.length];
  agent._lastQuote = quote;
  return quote;
}

function _spawnBubble(agent, owner) {
  const quote = _pickQuote(agent);
  if (!quote) return;

  const el = document.createElement('div');
  el.className = 'chat-bubble';
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = (agent.person?.name ?? '').split(' ')[0];
  const text = document.createElement('div');
  text.textContent = quote;                      // textContent: quotes are data, never markup
  el.append(who, text);
  _layer.appendChild(el);

  const ap = agent.mesh.position;
  _bubbles.push({
    el, agent, owner, age: 0,
    anchor: new THREE.Vector3(ap.x, ap.y + _headHeight(agent), ap.z),
    h: el.offsetHeight + TAIL_PX,               // measured once; the size doesn't change
  });
}
