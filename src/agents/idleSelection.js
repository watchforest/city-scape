/**
 * Behaviour selection — decides what a walking agent does when it finishes its
 * current stroll: keep walking, stop to chat with a nearby idle agent, or go idle
 * (sit on a bench, sit on the grass, rest on the grass, or dance).
 *
 * The result's `kind` is the state id to switch to, except 'walking' (keep strolling).
 * Activities that need a spot (bench / grass) fall back inside their own state when none
 * is free: bench → resting → walking.
 *
 * What an agent picks is shaped by:
 *   - IDLE_WEIGHTS, times the agent's own taste (agent.idleBias)
 *   - the time of day (NIGHT_WEIGHT_BOOST): more sitting and resting at night, more dancing by day
 *   - the crowd: dancing only happens where people are gathered, gets likelier the more there
 *     are, and an agent near people already dancing usually joins them
 */

import {
  PROB_WALK, PROB_CHAT, CHAT_MIN, CHAT_MAX, IDLE_WEIGHTS, NIGHT_WEIGHT_BOOST,
  DANCE_GATHER_RADIUS, DANCE_START_CROWD, DANCE_CROWD_BOOST, DANCE_JOIN_RADIUS, DANCE_JOIN_CHANCE,
} from '@/config.js';
import { nearby, centroid, isFreeWalker } from './crowd.js';

const CHAT_SEARCH_RADIUS = 15;

/**
 * @param {AgentEntity}   agent
 * @param {AgentEntity[]} allAgents
 * @param {function}      rand
 * @param {number}        night — 0 (day) … 1 (night)
 * @returns {{ kind: 'walking' | 'sitting' | 'sittingGround' | 'resting' }
 *         | { kind: 'dancing', join?: { center, clip } }
 *         | { kind: 'chatting', duration, partner }}
 */
export function selectNextBehaviour(agent, allAgents, rand, night = 0) {
  const roll = rand();

  if (roll < PROB_WALK) return { kind: 'walking' };

  if (roll < PROB_WALK + PROB_CHAT) {
    const partner = findChatPartner(agent, allAgents, rand);
    if (partner) {
      const duration = CHAT_MIN + rand() * (CHAT_MAX - CHAT_MIN);
      return { kind: 'chatting', duration, partner };
    }
    // No partner nearby — fall through to an idle activity.
  }

  return pickIdleActivity(agent, allAgents, rand, night);
}

const IDLE_KINDS = { bench: 'sitting', ground: 'sittingGround', rest: 'resting', dance: 'dancing' };

function pickIdleActivity(agent, allAgents, rand, night) {
  // People already dancing close by (not one still waiting for company): usually join them.
  const dancers = nearby(agent, allAgents, DANCE_JOIN_RADIUS, a => a.state === 'dancing' && a.currentRole === 'dance');
  if (dancers.length && rand() < DANCE_JOIN_CHANCE) {
    return { kind: 'dancing', join: { center: centroid(dancers), clip: dancers[0].currentClipName } };
  }

  // Otherwise weigh the activities.
  // Dancing needs company that could actually join: free walkers nearby (not someone asleep on a
  // bench). With none around it is off the table; the more there are, the more tempting it is.
  const crowd = nearby(agent, allAgents, DANCE_GATHER_RADIUS, isFreeWalker).length;
  const weights = {};
  for (const [key, base] of Object.entries(IDLE_WEIGHTS)) {
    weights[key] = base * (agent.idleBias?.[key] ?? 1) * Math.max(0, 1 + (NIGHT_WEIGHT_BOOST[key] ?? 0) * night);
  }
  weights.dance = crowd >= DANCE_START_CROWD
    ? weights.dance * (1 + DANCE_CROWD_BOOST * (crowd - DANCE_START_CROWD))
    : 0;

  const entries = Object.entries(weights);
  let pick = rand() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [key, w] of entries) {
    if ((pick -= w) < 0) return { kind: IDLE_KINDS[key] };
  }
  return { kind: IDLE_KINDS[entries[entries.length - 1][0]] };
}

function findChatPartner(agent, allAgents, rand) {
  const candidates = nearby(agent, allAgents, CHAT_SEARCH_RADIUS, a =>
    !a.stopped
    && a.groupLeader === null
    && (a.state === 'resting' || a.state === 'sitting' || a.state === 'sittingGround'));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rand() * candidates.length)];
}
