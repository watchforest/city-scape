/**
 * Floating "z" sprites in world space above resting/idle agents.
 * Each Z is a THREE.Sprite that rises and fades in world space,
 * so it stays fixed relative to the character regardless of camera movement.
 */

import * as THREE from 'three';

const IDLE_STATES = new Set(['resting']);
const SPAWN_INTERVAL = 1.2; // seconds between Zs per agent
const LIFETIME = 2.0;       // seconds a Z lives
const Z_HEIGHT_START = 6;   // world units above agent origin
const Z_RISE = 3;           // world units risen over lifetime
const Z_SIZE = 1.5;         // sprite size in world units

// Per-agent spawn timer
const _agentTimers = new WeakMap();

// Active Z particles: { sprite, age, startY }
const _particles = [];

let _scene = null;

// Build a canvas texture for "z"
function _makeZTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.font = 'bold 48px system-ui, sans-serif';
  ctx.fillStyle = '#a0c8ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('z', 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

const _zTexture = _makeZTexture();

export function initSleepZs(scene) {
  _scene = scene;
}

/**
 * Call each frame from the animation loop.
 * @param {object[]} agents — from agentManager.getAgents()
 * @param {number}   dt     — delta time in seconds
 */
export function updateSleepZs(agents, dt) {
  if (!_scene) return;

  // Spawn new Zs for idle agents
  for (const agent of agents) {
    if (!IDLE_STATES.has(agent.state) || agent.stopped) {
      _agentTimers.delete(agent);
      continue;
    }

    const elapsed = (_agentTimers.get(agent) ?? SPAWN_INTERVAL) + dt;
    _agentTimers.set(agent, elapsed % SPAWN_INTERVAL);

    if (elapsed >= SPAWN_INTERVAL) {
      _spawnZ(agent);
    }
  }

  // Update existing particles
  for (let i = _particles.length - 1; i >= 0; i--) {
    const p = _particles[i];
    p.age += dt;
    const t = p.age / LIFETIME; // 0 → 1

    // Rise
    p.sprite.position.y = p.startY + t * Z_RISE;

    // Fade out
    p.sprite.material.opacity = Math.max(0, 1 - t * t);

    if (p.age >= LIFETIME) {
      _scene.remove(p.sprite);
      p.sprite.material.dispose();
      _particles.splice(i, 1);
    }
  }
}

function _spawnZ(agent) {
  const jitter = (Math.random() - 0.5) * 1.5;
  const size = Z_SIZE * (0.8 + Math.random() * 0.4);

  const mat = new THREE.SpriteMaterial({
    map: _zTexture,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);

  const ap = agent.mesh.position;
  sprite.position.set(ap.x + jitter, ap.y + Z_HEIGHT_START, ap.z + jitter);

  _scene.add(sprite);
  _particles.push({ sprite, age: 0, startY: sprite.position.y });
}
