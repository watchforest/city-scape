/**
 * Behaviour selection — decides what a walking agent does when it finishes its
 * current stroll: keep walking, go and talk with someone, or go idle (sit on a bench, sit
 * on the grass, rest on the grass, or dance).
 *
 * The result's `kind` is the state id to switch to, except 'walking' (keep strolling).
 * Chatting and dancing are done *together*: the result carries the people to invite
 * (`partners`) or a dance to join (`join`), and WalkingState turns that into a gathering
 * (gatherings.js) in which everyone walks to a meeting spot and stands there before it starts.
 * Activities that need a spot (bench / grass) fall back inside their own state when none
 * is free: bench → resting → walking.
 *
 * What an agent picks is shaped by:
 *   - IDLE_WEIGHTS, times the agent's own taste (agent.idleBias)
 *   - the time of day (NIGHT_WEIGHT_BOOST): more sitting and resting at night, more dancing by day
 *   - company: dancing is only on the table if someone free could be invited to it, gets
 *     likelier the more there are, and an agent near a running dance usually joins it
 */

import {
  PROB_WALK, PROB_CHAT, ADMIRE_AT_PLAZA, VISIT_CHANCE, VISIT_RADIUS, IDLE_WEIGHTS, NIGHT_WEIGHT_BOOST, CHAT_SEEK_RADIUS, GATHER_MAX_SIZE, GATHER_JOIN_CHANCE,
  DANCE_GATHER_RADIUS, DANCE_START_CROWD, DANCE_CROWD_BOOST, DANCE_JOIN_CHANCE, BENCH_SOCIAL_RADIUS, BENCH_SOCIAL_BOOST, BENCH_JOIN_CHANCE,
} from '@/config.js';
import { nearby, isFreeWalker } from './crowd.js';
import { isVisitable } from './states/VisitingState.js';
import { plazaAt } from './plazas.js';
import { lonelySitterNear } from '@/world/benchRegistry.js';

/**
 * @param {AgentEntity}   agent
 * @param {AgentEntity[]} allAgents
 * @param {function}      rand
 * @param {number}        night — 0 (day) … 1 (night)
 * @returns {{ kind: 'walking' | 'sitting' | 'sittingGround' | 'resting' }
 *         | { kind: 'chatting', partners: AgentEntity[] }
 *         | { kind: 'dancing', partners?: AgentEntity[], join?: object }}
 */
export function selectNextBehaviour(agent, allAgents, rand, night = 0) {
  // Someone is sitting alone on a bench not too far off: sometimes go and keep them company.
  if (lonelySitterNear(agent.position.x, agent.position.z, BENCH_SOCIAL_RADIUS) && rand() < BENCH_JOIN_CHANCE) return { kind: 'sitting' };

  // Someone is sitting close by: sometimes go over and talk to them (they stay seated).
  if (rand() < VISIT_CHANCE) {
    const sitters = nearby(agent, allAgents, VISIT_RADIUS, isVisitable)
      .sort((a, b) => a.position.squaredDistanceTo(agent.position) - b.position.squaredDistanceTo(agent.position));
    if (sitters.length) return { kind: 'visiting', target: sitters[0] };
  }

  // Standing at a plaza: stop and admire its landmark now and then.
  if (plazaAt(agent.position.x, agent.position.z, 8) && rand() < ADMIRE_AT_PLAZA) return { kind: 'admiring' };

  const roll = rand();

  if (roll < PROB_WALK) return { kind: 'walking' };

  if (roll < PROB_WALK + PROB_CHAT) {
    const partners = pickPartners(agent, allAgents, CHAT_SEEK_RADIUS, rand);
    if (partners.length) return { kind: 'chatting', partners };
    // Nobody free to talk to — fall through to an idle activity.
  }

  return pickIdleActivity(agent, allAgents, rand, night);
}

const IDLE_KINDS = { bench: 'sitting', ground: 'sittingGround', rest: 'resting', dance: 'dancing', admire: 'admiring' };

/**
 * Free walkers near `agent` to invite, nearest first: the nearest always comes, each further
 * one with GATHER_JOIN_CHANCE, up to the group size limit.
 */
function pickPartners(agent, allAgents, radius, rand) {
  const candidates = nearby(agent, allAgents, radius, isFreeWalker)
    .sort((a, b) => a.position.squaredDistanceTo(agent.position) - b.position.squaredDistanceTo(agent.position));
  const partners = [];
  for (const [i, c] of candidates.entries()) {
    if (partners.length >= GATHER_MAX_SIZE - 1) break;
    if (i === 0 || rand() < GATHER_JOIN_CHANCE) partners.push(c);
  }
  return partners;
}

function pickIdleActivity(agent, allAgents, rand, night) {
  // A dance is running close by: usually join it.
  const dance = agent.gatherings.findDanceToJoin(agent);
  if (dance && rand() < DANCE_JOIN_CHANCE) return { kind: 'dancing', join: dance };

  // Otherwise weigh the activities. Dancing needs someone free who could actually be invited
  // (people sitting on benches or standing in a conversation don't count); the more there are,
  // the more tempting it is.
  const invitable = nearby(agent, allAgents, DANCE_GATHER_RADIUS, isFreeWalker).length;
  const weights = {};
  for (const [key, base] of Object.entries(IDLE_WEIGHTS)) {
    weights[key] = base * (agent.idleBias?.[key] ?? 1) * Math.max(0, 1 + (NIGHT_WEIGHT_BOOST[key] ?? 0) * night);
  }
  // Someone is sitting alone on a bench nearby: joining them is tempting.
  if (lonelySitterNear(agent.position.x, agent.position.z, BENCH_SOCIAL_RADIUS)) weights.bench *= BENCH_SOCIAL_BOOST;
  weights.dance = invitable >= DANCE_START_CROWD
    ? weights.dance * (1 + DANCE_CROWD_BOOST * (invitable - DANCE_START_CROWD))
    : 0;

  const entries = Object.entries(weights);
  let pick = rand() * entries.reduce((sum, [, w]) => sum + w, 0);
  let key = entries[entries.length - 1][0];
  for (const [k, w] of entries) {
    if ((pick -= w) < 0) { key = k; break; }
  }

  if (key === 'dance') return { kind: 'dancing', partners: pickPartners(agent, allAgents, DANCE_GATHER_RADIUS, rand) };
  return { kind: IDLE_KINDS[key] };
}
