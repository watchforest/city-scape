/**
 * Idle behaviour selection — decides what a walking agent does when it
 * finishes its current stroll: keep walking, stop to chat with a nearby
 * idle agent, or go idle (sit on a bench if one's free, else rest on grass).
 */

import { PROB_WALK, PROB_CHAT, CHAT_MIN, CHAT_MAX } from '@/config.js';

const CHAT_SEARCH_RADIUS = 15;

/**
 * @param {AgentEntity}   agent
 * @param {AgentEntity[]} allAgents
 * @param {function}      rand
 * @returns {{ kind: 'walking' } | { kind: 'chatting', duration, partner } | { kind: 'idle' }}
 */
export function selectNextBehaviour(agent, allAgents, rand) {
  const roll = rand();

  if (roll < PROB_WALK) return { kind: 'walking' };

  if (roll < PROB_WALK + PROB_CHAT) {
    const partner = findChatPartner(agent, allAgents);
    if (partner) {
      const duration = CHAT_MIN + rand() * (CHAT_MAX - CHAT_MIN);
      return { kind: 'chatting', duration, partner };
    }
    // No partner nearby — fall through to idle rather than force a walk/chat
    // collision like the old (buggy) probability-threshold design did.
  }

  return { kind: 'idle' };
}

function findChatPartner(agent, allAgents) {
  const r2 = CHAT_SEARCH_RADIUS * CHAT_SEARCH_RADIUS;
  const candidates = allAgents.filter(a =>
    a !== agent &&
    !a.stopped &&
    (a.state === 'resting' || a.state === 'sitting') &&
    a.position.squaredDistanceTo(agent.position) < r2
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
