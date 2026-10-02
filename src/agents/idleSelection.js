/**
 * Behaviour selection — decides what a walking agent does when it finishes its
 * current stroll: keep walking, stop to chat with a nearby idle agent, or go idle
 * (sit on a bench, sit on the grass, rest on the grass, or dance — weighted by
 * IDLE_WEIGHTS). The result's `kind` is the state id to switch to, except
 * 'walking' (keep strolling). Activities that need a spot (bench / grass) fall back
 * inside their own state when none is free: bench → resting → walking.
 */

import { PROB_WALK, PROB_CHAT, CHAT_MIN, CHAT_MAX, IDLE_WEIGHTS } from '@/config.js';

const CHAT_SEARCH_RADIUS = 15;

/**
 * @param {AgentEntity}   agent
 * @param {AgentEntity[]} allAgents
 * @param {function}      rand
 * @returns {{ kind: 'walking' | 'sitting' | 'sittingGround' | 'resting' | 'dancing' } | { kind: 'chatting', duration, partner }}
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
    // No partner nearby — fall through to an idle activity.
  }

  return { kind: pickIdleActivity(rand) };
}

const IDLE_KINDS = { bench: 'sitting', ground: 'sittingGround', rest: 'resting', dance: 'dancing' };

function pickIdleActivity(rand) {
  const entries = Object.entries(IDLE_WEIGHTS);
  let roll = rand() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [key, w] of entries) {
    if ((roll -= w) < 0) return IDLE_KINDS[key];
  }
  return IDLE_KINDS[entries[entries.length - 1][0]];
}

function findChatPartner(agent, allAgents) {
  const r2 = CHAT_SEARCH_RADIUS * CHAT_SEARCH_RADIUS;
  const candidates = allAgents.filter(a =>
    a !== agent &&
    !a.stopped &&
    (a.state === 'resting' || a.state === 'sitting' || a.state === 'sittingGround') &&
    a.position.squaredDistanceTo(agent.position) < r2
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
