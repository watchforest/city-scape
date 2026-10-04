/**
 * SittingOnBenchState — claims a nearby unoccupied bench, walks to it, sits
 * (Sitting-1), and releases the seat on exit. Falls back to resting on the grass
 * if no seat is available nearby.
 */

import { SeekSpotState } from './SeekSpotState.js';
import { claimNearestSeat, releaseSeat } from '@/world/benchRegistry.js';
import { REST_MIN, REST_MAX } from '@/config.js';

// Visual-only placement of the seated figure relative to the bench.
// Stand-To-Sit ends in a floor-sitting pose: the lowest part of the body (the bottom) is ≈ 0.2 below the character's
// origin, with the legs stretched out forward. Lifting the mesh by seatTop + SEAT_CONTACT puts that point on the seat
// top (a hair sunk in, so there is no gap). Measured with the skinned vertices of the seated pose.
const SEAT_CONTACT = 0.17;
const SIT_FORWARD  = 0.2;

export class SittingOnBenchState extends SeekSpotState {
  stateId = 'sitting';
  fallbackState = 'resting';
  transitions = true; // sit down (Stand-To-Sit) → Sitting-1; stand up in reverse

  acquireSpot(agent) {
    const seat = claimNearestSeat(agent.uuid, agent.position.x, agent.position.z);
    return seat && { ...seat, facing: seat.facingAngle };
  }

  releaseSpot() { releaseSeat(this._spot.benchId); }

  onArrive(agent) {
    // The mesh is lifted onto the seat in step with the sit-down animation.
    // Standing `standOff` in front of the seat: the sit-down moves the mesh back onto it as well as up.
    agent.sitDown({ up: this._spot.seatTop + SEAT_CONTACT, forward: SIT_FORWARD - this._spot.standOff });
  }

  onSettled(agent) { agent.settleSeated(); }

  duration(agent) { return REST_MIN + agent.rand() * (REST_MAX - REST_MIN); }
}
