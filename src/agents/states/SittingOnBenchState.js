/**
 * SittingOnBenchState — claims a seat on a nearby bench (each bench has two, and people prefer a bench that already has
 * someone on it), walks to its stand point, sits down (Stand-To-Sit → Sitting-1) and releases the seat on exit. Falls
 * back to resting on the grass if no seat is available nearby.
 *
 * Two people sitting side by side start talking once both have settled: a "seated" chat gathering (gatherings.js), run by
 * the same chat bubbles as any conversation. It ends when either of them gets up.
 */

import { SeekSpotState } from './SeekSpotState.js';
import { claimNearestSeat, releaseSeat, seatNeighbour } from '@/world/benchRegistry.js';
import { REST_MIN, REST_MAX, SEATED_CHAT_MIN, SEATED_CHAT_EXTRA, BENCH_WAIT_EXTRA } from '@/config.js';

// Visual-only placement of the seated figure relative to the bench.
// Stand-To-Sit ends in a floor-sitting pose: the lowest part of the body (the bottom) is ≈ 0.2 below the character's
// origin, with the legs stretched out forward. Lifting the mesh by seatTop + SEAT_CONTACT puts that point on the seat
// top (a hair sunk in, so there is no gap). Measured with the skinned vertices of the seated pose.
const SEAT_CONTACT = 0.17;
const SIT_FORWARD  = 0.85; // (0.2 put the back through the backrest)

export class SittingOnBenchState extends SeekSpotState {
  stateId = 'sitting';
  fallbackState = 'resting';
  transitions = true; // sit down (Stand-To-Sit) → Sitting-1; stand up in reverse
  snapToSpot = true;  // exactly on the seat's stand point (not up to a unit off), so two sitters keep their places

  acquireSpot(agent) {
    const seat = claimNearestSeat(agent, agent.position.x, agent.position.z);
    if (!seat) return null;

    // Taking the seat beside someone: they wait for us rather than getting up just before we arrive.
    const neighbour = seatNeighbour(seat.benchId, seat.seatIdx);
    const theirs = neighbour?.stateMachine.states.get('sitting');
    if (theirs && (theirs._phase === 'stay' || theirs._phase === 'settle')) {
      const walk = Math.hypot(seat.x - agent.position.x, seat.z - agent.position.z) / Math.max(1, agent.maxSpeed);
      theirs._timer = Math.max(theirs._timer, walk + BENCH_WAIT_EXTRA);
    }
    return { ...seat, facing: seat.facingAngle };
  }

  releaseSpot() { releaseSeat(this._spot.benchId, this._spot.seatIdx); }

  onArrive(agent) {
    // The mesh is lifted onto the seat in step with the sit-down animation.
    // Standing `standOff` in front of the seat: the sit-down moves the mesh back onto it as well as up.
    agent.sitDown({ up: this._spot.seatTop + SEAT_CONTACT, forward: SIT_FORWARD - this._spot.standOff });
  }

  onSettled(agent) {
    agent.settleSeated();
    agent._seatSettled = true;

    // Settled beside someone who has settled too: they talk, and stay a bit longer for it.
    const neighbour = seatNeighbour(this._spot.benchId, this._spot.seatIdx);
    if (neighbour?._seatSettled && agent.gatherings?.createSeated(agent, neighbour)) {
      const stay = SEATED_CHAT_MIN + agent.rand() * SEATED_CHAT_EXTRA;
      this._timer = Math.max(this._timer, stay);
      const theirs = neighbour.stateMachine.states.get('sitting');
      theirs._timer = Math.max(theirs._timer, stay);
    }
  }

  onLeave(agent) {
    agent._seatSettled = false;
    agent.gatherings?.endSeated(agent); // the conversation is over for both as soon as one gets up
  }

  exit(agent) {
    agent._seatSettled = false;
    agent.gatherings?.endSeated(agent); // (also if something interrupted the sit)
    super.exit(agent);
  }

  duration(agent) { return REST_MIN + agent.rand() * (REST_MAX - REST_MIN); }
}
