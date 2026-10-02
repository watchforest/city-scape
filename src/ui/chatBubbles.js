/**
 * Floating conversation fragment bubbles above talking agents.
 *
 * Works like sleepZs — world-space THREE.Sprite that rises and fades. Each uses a freshly
 * rendered canvas texture so any quote string can be displayed without a texture atlas.
 *
 * A conversation is a running 'chat' gathering (agents/gatherings.js). Its members take
 * turns: one bubble at a time per conversation, a short silence between speakers, and the
 * current speaker is recorded in gathering.speaker so the others turn to face them. A
 * bubble also waits if another one is still visible close by, so they never cover each other.
 */

import * as THREE from 'three';
import { CHAT_BUBBLE_GAP, CHAT_BUBBLE_CLEARANCE } from '@/config.js';

const LIFETIME        = 4.0;   // seconds a fragment lives
const RISE_HEIGHT     = 5;     // world units risen over lifetime
const HEIGHT_START    = 7;     // world units above agent origin
const MAX_LINE_CHARS  = 28;    // wrap text beyond this width

let _scene  = null;
let _quotes = [];

// Active fragments: { sprite, age, startY, owner: the conversation (gathering) it belongs to }
const _particles   = [];

export function initChatBubbles(scene, quotes) {
  _scene  = scene;
  _quotes = quotes;
}

// ── Texture builder ───────────────────────────────────────────────────────────

function _wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = line.length === 0 ? word : line + ' ' + word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function _makeFragmentTexture(text) {
  const FONT      = '500 15px system-ui, sans-serif';
  const PADDING   = 14;
  const LINE_H    = 20;
  const BUBBLE_R  = 10;

  // Measure
  const offscreen = document.createElement('canvas');
  offscreen.width = 1; offscreen.height = 1;
  const mctx = offscreen.getContext('2d');
  mctx.font = FONT;

  const lines    = _wrapText(text, MAX_LINE_CHARS);
  const maxWidth = Math.max(...lines.map(l => mctx.measureText(l).width));

  const W = Math.ceil(maxWidth + PADDING * 2);
  const H = Math.ceil(lines.length * LINE_H + PADDING * 2);

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H + 8; // +8 for tail
  const ctx = canvas.getContext('2d');

  // Bubble background
  ctx.fillStyle    = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle  = 'rgba(0,0,0,0.12)';
  ctx.lineWidth    = 1;

  ctx.beginPath();
  ctx.moveTo(BUBBLE_R, 0);
  ctx.lineTo(W - BUBBLE_R, 0);
  ctx.quadraticCurveTo(W, 0, W, BUBBLE_R);
  ctx.lineTo(W, H - BUBBLE_R);
  ctx.quadraticCurveTo(W, H, W - BUBBLE_R, H);
  ctx.lineTo(W / 2 + 8, H);
  ctx.lineTo(W / 2, H + 8); // tail point
  ctx.lineTo(W / 2 - 8, H);
  ctx.lineTo(BUBBLE_R, H);
  ctx.quadraticCurveTo(0, H, 0, H - BUBBLE_R);
  ctx.lineTo(0, BUBBLE_R);
  ctx.quadraticCurveTo(0, 0, BUBBLE_R, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Text
  ctx.font      = FONT;
  ctx.fillStyle = '#222';
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], PADDING, PADDING + i * LINE_H);
  }

  const tex = new THREE.CanvasTexture(canvas);
  // Preserve pixel ratio for the sprite scale
  tex.userData.aspect = canvas.width / canvas.height;
  return tex;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call each frame.
 * @param {object[]} agents
 * @param {number}   dt
 */
export function updateChatBubbles(agents, dt) {
  if (!_scene) return;

  // The conversations running right now.
  const conversations = new Set();
  for (const agent of agents) {
    if (agent.isTalking && !agent.stopped) conversations.add(agent.gathering);
  }

  for (const g of conversations) {
    // One speaker at a time: wait until this conversation's last bubble is gone, then a pause.
    if (_particles.some(p => p.owner === g)) { g._silence = CHAT_BUBBLE_GAP; continue; }
    g._silence = (g._silence ?? CHAT_BUBBLE_GAP) - dt;
    if (g._silence > 0) continue;

    const speakers = g.members.filter(m => m.isTalking && !m.stopped);
    if (speakers.length < 2) continue;
    g._turn = ((g._turn ?? -1) + 1) % speakers.length;     // take turns round the group
    const speaker = speakers[g._turn];

    // Don't start on top of another conversation's bubble that is still visible nearby: retry
    // this speaker next frame.
    const sp = speaker.mesh.position;
    if (_particles.some(p => Math.hypot(p.sprite.position.x - sp.x, p.sprite.position.z - sp.z) < CHAT_BUBBLE_CLEARANCE)) {
      g._turn -= 1;
      continue;
    }

    g.speaker = speaker;
    _spawnFragment(speaker, g);
  }

  // Update existing particles
  for (let i = _particles.length - 1; i >= 0; i--) {
    const p = _particles[i];
    p.age += dt;
    const t = Math.min(p.age / LIFETIME, 1);

    p.sprite.position.y = p.startY + t * RISE_HEIGHT;

    // Fade: quick in, hold, fade out at end
    const fade = t < 0.1 ? t / 0.1 : t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    p.sprite.material.opacity = fade * 0.95;

    if (p.age >= LIFETIME) {
      _scene.remove(p.sprite);
      p.sprite.material.map.dispose();
      p.sprite.material.dispose();
      _particles.splice(i, 1);
    }
  }
}

function _personQuotes(agent) {
  const raw = agent.person?.quotes;
  if (!raw) return [];
  return raw.split(';').map(s => s.trim()).filter(Boolean);
}

function _pickQuote(agent) {
  // Own quotes first, falling back to the shared ambient pool.
  const own = _personQuotes(agent);
  const pool = own.length > 0 ? own : _quotes;
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function _spawnFragment(agent, owner) {
  const quote = _pickQuote(agent);
  if (!quote) return;
  const tex = _makeFragmentTexture(quote);

  const mat = new THREE.SpriteMaterial({
    map:         tex,
    transparent: true,
    opacity:     0,
    depthWrite:  false,
  });

  const sprite = new THREE.Sprite(mat);
  // Scale to keep aspect ratio; base height ~6 world units
  const baseH = 6;
  sprite.scale.set(baseH * tex.userData.aspect, baseH, 1);

  const ap = agent.mesh.position;
  sprite.position.set(ap.x, ap.y + HEIGHT_START, ap.z);

  _scene.add(sprite);
  _particles.push({ sprite, age: 0, startY: sprite.position.y, owner });
}
