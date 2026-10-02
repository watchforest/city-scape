/**
 * Gatherings — chatting and dancing are done together, standing in one place.
 *
 * An initiator invites nearby free walkers; everyone walks to their own spot on a ring
 * around a meeting point (GatherState). Nothing starts until the members have actually
 * arrived: then the activity begins for all of them at once (ChattingState / DancingState),
 * and it ends for all of them together. If fewer than two make it, the gathering is
 * cancelled; if it drops below two while running, it ends. Agents merely standing nearby
 * are never part of it.
 *
 * Agents carry:  gathering (the object, or null), gatherArrived, gatherPhase
 *                ('assembling' | 'activity').
 * Gathering:     { id, kind: 'chat' | 'dance', center, radius, members[], spots: Map,
 *                  stage: 'assembling' | 'active', t, elapsed, duration, clip, speaker }
 *
 * The manager is ticked from AgentController.update().
 */

import { isOccupied, isWalkClear } from '@/world/obstacleRegistry.js';
import { centroid } from './crowd.js';
import {
  GATHER_MAX_SIZE, GATHER_TIMEOUT, GATHER_CHAT_RADIUS, GATHER_DANCE_RADIUS, DANCE_JOIN_RADIUS,
} from '@/config.js';

const MAX_DANCERS = 5;   // joiners may grow a dance beyond the initial group, up to this
const TWO_PI = Math.PI * 2;

export class GatheringManager {
  constructor(rand = Math.random) {
    this._list = [];
    this._nextId = 1;
    this._rand = rand;
  }

  setRand(rand) { this._rand = rand; }

  get all() { return this._list; }

  /**
   * Start a gathering: `initiator` and `partners` converge on a meeting point.
   * @param {'chat' | 'dance'} kind
   * @param {AgentEntity}      initiator
   * @param {AgentEntity[]}    partners
   * @param {number}           duration — seconds the activity lasts once it starts
   * @returns the gathering, or null if no valid meeting point/spots were found for two or more
   */
  create(kind, initiator, partners, duration) {
    const people = [initiator, ...partners.filter(p => p !== initiator)].slice(0, GATHER_MAX_SIZE);
    if (people.length < 2) return null;
    const radius = kind === 'dance' ? GATHER_DANCE_RADIUS : GATHER_CHAT_RADIUS;

    // Meeting point: the group's centroid, or the nearest free spot to it.
    const c = centroid(people);
    const center = this._freeSpotNear(c.x, c.z, radius + 1.5);
    if (!center) return null;

    // Ring spots, evenly spread. Slot 0 is the initiator's own side; the rest are handed out in
    // the order the others are around the ring, so people don't cross paths on the way in.
    const angleOf = a => Math.atan2(a.position.z - center.z, a.position.x - center.x);
    const base = angleOf(initiator);
    const order = [initiator, ...people.filter(p => p !== initiator)
      .sort((a, b) => ((angleOf(a) - base + TWO_PI) % TWO_PI) - ((angleOf(b) - base + TWO_PI) % TWO_PI))];

    const members = [];
    const spots = new Map();
    order.forEach((agent, k) => {
      const ang = base + (k * TWO_PI) / order.length;
      const spot = { x: center.x + Math.cos(ang) * radius, z: center.z + Math.sin(ang) * radius, angle: ang };
      if (isOccupied(spot.x, spot.z, 1.0, true)) return;                         // a tree, lamp, the lake…
      if (!isWalkClear(agent.position.x, agent.position.z, spot.x, spot.z)) return; // can't walk straight there
      members.push(agent);
      spots.set(agent, spot);
    });
    if (members.length < 2 || !members.includes(initiator)) return null;

    const g = {
      id: this._nextId++, kind, center, radius, members, spots,
      stage: 'assembling', active: false, t: 0, elapsed: 0, duration,
      clip: kind === 'dance' ? initiator._clipFor('dance') : null,
      speaker: null,
    };
    this._list.push(g);
    for (const a of members) {
      a.gathering = g;
      a.gatherArrived = false;
      a.gatherPhase = 'assembling';
      a.stateMachine.changeTo('gathering');
    }
    return g;
  }

  /** The running dance nearest to `agent` within `radius`, if it has room for one more. */
  findDanceToJoin(agent, radius = DANCE_JOIN_RADIUS) {
    let best = null, bestD = radius * radius;
    for (const g of this._list) {
      if (g.kind !== 'dance' || !g.active || g.members.length >= MAX_DANCERS) continue;
      if (g.members.filter(a => a.gatherPhase === 'activity').length < 2) continue;
      const d = (g.center.x - agent.position.x) ** 2 + (g.center.z - agent.position.z) ** 2;
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  }

  /** Join a running dance: walk to a free spot on its ring and dance there. */
  join(g, agent) {
    if (!g.active || g.kind !== 'dance' || g.members.length >= MAX_DANCERS) return false;
    // Try several spots on the ring; take the valid one furthest from the others.
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 12; i++) {
      const ang = this._rand() * TWO_PI;
      const x = g.center.x + Math.cos(ang) * g.radius, z = g.center.z + Math.sin(ang) * g.radius;
      if (isOccupied(x, z, 1.0, true) || !isWalkClear(agent.position.x, agent.position.z, x, z)) continue;
      let nearest = Infinity;
      for (const s of g.spots.values()) nearest = Math.min(nearest, Math.hypot(s.x - x, s.z - z));
      if (nearest > bestScore) { bestScore = nearest; best = { x, z, angle: ang }; }
    }
    if (!best) return false;
    g.members.push(agent);
    g.spots.set(agent, best);
    agent.gathering = g;
    agent.gatherArrived = false;
    agent.gatherPhase = 'assembling';
    agent.stateMachine.changeTo('gathering');
    return true;
  }

  /** Tick: arrivals → start, timeouts, interrupted members, and ending together. */
  update(dt) {
    for (const g of [...this._list]) {
      g.t += dt;

      // Members who were taken away (clicked, sent on an errand, …) leave quietly.
      for (const a of [...g.members]) {
        if (a.gathering !== g) this._detach(g, a, false);
        else if (a.stopped || !this._inGatheringState(a)) this._detach(g, a, false);
      }

      if (g.stage === 'assembling') {
        if (g.members.length < 2) { this._end(g); continue; }
        if (g.members.every(a => a.gatherArrived)) { this._start(g); continue; }
        if (g.t > GATHER_TIMEOUT) {
          // Drop whoever hasn't made it; carry on if at least two are there.
          for (const a of g.members.filter(m => !m.gatherArrived)) this._detach(g, a, true);
          if (g.members.length >= 2) this._start(g); else this._end(g);
        }
        continue;
      }

      // Active. Joiners start dancing as they arrive.
      for (const a of g.members) if (a.gatherArrived && a.gatherPhase !== 'activity') this._startMember(g, a);
      g.elapsed += dt;
      const present = g.members.filter(a => a.gatherPhase === 'activity').length;
      if (present < 2 || g.elapsed > g.duration) this._end(g);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  _inGatheringState(a) {
    const s = a.stateMachine.currentState, st = a.stateMachine.states;
    return s === st.get('gathering') || s === st.get('chatting') || s === st.get('dancing');
  }

  _start(g) {
    g.stage = 'active';
    g.active = true;
    g.elapsed = 0;
    for (const a of g.members) this._startMember(g, a);
  }

  _startMember(g, a) {
    a.gatherPhase = 'activity';
    a.stateMachine.changeTo(g.kind === 'chat' ? 'chatting' : 'dancing');
  }

  /** Take one agent out of the gathering; `redirect` sends it back to walking. */
  _detach(g, a, redirect) {
    g.members = g.members.filter(m => m !== a);
    g.spots.delete(a);
    if (g.speaker === a) g.speaker = null;
    if (a.gathering === g) {
      a.gathering = null;
      a.gatherArrived = false;
      a.gatherPhase = null;
      if (redirect && !a.stopped) a.stateMachine.changeTo('walking');
    }
  }

  /** End the gathering for everyone still in it. */
  _end(g) {
    for (const a of [...g.members]) this._detach(g, a, true);
    this._list = this._list.filter(x => x !== g);
  }

  /** (x, z) if free, else the nearest free spot on a widening ring around it. */
  _freeSpotNear(x, z, clear) {
    if (!isOccupied(x, z, clear, true)) return { x, z };
    for (let r = 3; r <= 12; r += 3) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TWO_PI;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!isOccupied(px, pz, clear, true)) return { x: px, z: pz };
      }
    }
    return null;
  }
}
