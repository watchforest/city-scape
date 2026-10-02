/**
 * DancingState — dancing is a group activity.
 *
 * Starter: stands ready where it is (only chosen when free walkers are around, see
 *          idleSelection.js), invites them, and starts dancing as soon as the first one
 *          arrives. It picks the moves; everyone copies them.
 * Joiner:  (agent._danceJoin = { center, clip }) walks to a spot on a ring around the group
 *          and dances right away, facing the group's centre.
 * Nobody dances alone: a starter that waits too long gives up, and a dancer whose company
 * has all gone stops after a few seconds.
 */

import { SeekSpotState } from './SeekSpotState.js';
import { isOccupied, isWalkClear } from '@/world/obstacleRegistry.js';
import {
  DANCE_MIN, DANCE_MAX, DANCE_RING_RADIUS, DANCE_GATHER_RADIUS, DANCE_JOIN_CHANCE, DANCE_ALONE_GRACE,
} from '@/config.js';
import { nearby, isFreeWalker } from '../crowd.js';

const MAX_RECRUITS = 3;
const START_WHEN_PARTNER_WITHIN = 14; // the starter begins once a dancer is this close
const LEFT_ALONE_GRACE = 3;           // seconds a dancer keeps going after its company has all gone

export class DancingState extends SeekSpotState {
  stateId = 'dancing';
  fallbackState = 'walking';

  acquireSpot(agent) {
    this._join = agent._danceJoin ?? null;
    agent._danceJoin = null;

    // Starter: right here.
    if (!this._join) return { x: agent.position.x, z: agent.position.z, facing: agent._facing ?? 0 };

    // Joiner: a free spot on a ring around the group.
    const { center } = this._join;
    const [rMin, rMax] = DANCE_RING_RADIUS;
    for (let i = 0; i < 10; i++) {
      const a = agent.rand() * Math.PI * 2;
      const r = rMin + agent.rand() * (rMax - rMin);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (isOccupied(x, z, 1.0, true)) continue;
      if (!isWalkClear(agent.position.x, agent.position.z, x, z)) continue;
      return { x, z, facing: Math.atan2(center.x - x, center.z - z) };
    }
    return null;
  }

  releaseSpot() {}

  onArrive(agent) {
    this._recruits = [];
    this._aloneFor = 0;
    this._waited = 0;
    this._hadCompany = false;
    if (this._join) {
      // Joiner: straight into the group's dance.
      this._started = true;
      agent.playRole('dance', this._join.clip ? { clip: this._join.clip } : {});
    } else {
      // Starter: pick the moves, invite people, and wait for the first to turn up.
      this._started = false;
      this._clip = agent._clipFor('dance');
      agent.playRole('idle');
      this._recruit(agent);
    }
  }

  duration(agent) { return DANCE_MIN + agent.rand() * (DANCE_MAX - DANCE_MIN); }

  execute(agent) {
    super.execute(agent);
    if (this._phase !== 'stay' || agent.stopped) return;
    const dt = agent._lastDelta ?? 0;

    const dancers = nearby(agent, agent._getAllAgents(), DANCE_GATHER_RADIUS, a => a.state === 'dancing');

    // The starter begins once a partner is close (or, as a fallback, after waiting a while).
    if (!this._started) {
      this._waited += dt;
      const partnerHere = dancers.some(d => d.position.squaredDistanceTo(agent.position) < START_WHEN_PARTNER_WITHIN ** 2);
      if (partnerHere || this._waited > 10) {
        this._started = true;
        agent.playRole('dance', this._clip ? { clip: this._clip } : {});
      }
    }

    // Company: other dancers nearby, or invitees still on their way over.
    const onTheirWay = this._recruits.some(r => r.stateMachine.currentState === r.stateMachine.states.get('dancing'));
    const hasCompany = dancers.length > 0 || onTheirWay;
    if (hasCompany) { this._hadCompany = true; this._aloneFor = 0; } else { this._aloneFor += dt; }

    // Left on their own: give up quickly if the others have gone; a starter that never got
    // anyone waits longer (invitees can be a long walk away).
    const grace = this._hadCompany ? LEFT_ALONE_GRACE : DANCE_ALONE_GRACE;
    if (this._aloneFor > grace) agent.stateMachine.changeTo('walking');
  }

  /**
   * The starter invites nearby free walkers, nearest first. Each accepts with DANCE_JOIN_CHANCE,
   * but the nearest always does, so a dance never starts without at least one partner.
   */
  _recruit(agent) {
    const here = { x: agent.position.x, z: agent.position.z };
    const candidates = nearby(agent, agent._getAllAgents(), DANCE_GATHER_RADIUS, isFreeWalker)
      .sort((a, b) => a.position.squaredDistanceTo(agent.position) - b.position.squaredDistanceTo(agent.position));
    for (const [i, other] of candidates.entries()) {
      if (this._recruits.length >= MAX_RECRUITS) break;
      if (i > 0 && agent.rand() > DANCE_JOIN_CHANCE) continue;
      other._danceJoin = { center: here, clip: this._clip };
      other.stateMachine.changeTo('dancing');
      this._recruits.push(other);
    }
  }
}
