/**
 * Behaviour selection for park agents.
 *
 * States: 'walking' | 'chatting' | 'resting' | 'stretching'
 */

import {
  PROB_WALK, PROB_CHAT, PROB_REST,
  CHAT_MIN, CHAT_MAX, REST_MIN, REST_MAX, STRETCH_MIN, STRETCH_MAX,
} from '@/config.js';

/**
 * Select the next behaviour for an agent.
 *
 * @param {object}   agent
 * @param {object[]} allAgents — full agent list for finding nearby idle
 * @param {function} rand
 * @returns {{ state, duration?, partner? }}
 */
export function selectNextBehaviour(agent, allAgents, rand) {
  const roll = rand();

  if (roll < PROB_WALK) {
    return { state: 'walking' };
  }

  if (roll < PROB_WALK + PROB_CHAT) {
    const nearby = findNearby(agent, allAgents, 15).filter(
      a => a !== agent && (a.state === 'idle' || a.state === 'chatting' || a.state === 'resting')
    );
    if (nearby.length > 0) {
      const partner  = nearby[Math.floor(rand() * nearby.length)];
      const duration = CHAT_MIN + rand() * (CHAT_MAX - CHAT_MIN);
      return { state: 'chatting', duration, partner };
    }
    // No partner available — fall back to resting
  }

  if (roll < PROB_WALK + PROB_CHAT + PROB_REST) {
    const duration = REST_MIN + rand() * (REST_MAX - REST_MIN);
    return { state: 'resting', duration };
  }

  // Stretching
  const duration = STRETCH_MIN + rand() * (STRETCH_MAX - STRETCH_MIN);
  return { state: 'stretching', duration };
}

/**
 * Find agents within radius of the given agent.
 */
export function findNearby(agent, allAgents, radius) {
  const r2 = radius * radius;
  const px = agent.mesh.position.x;
  const pz = agent.mesh.position.z;
  return allAgents.filter(a => {
    if (a === agent) return false;
    const dx = a.mesh.position.x - px;
    const dz = a.mesh.position.z - pz;
    return dx * dx + dz * dz < r2;
  });
}
