/**
 * SittingOnBenchState — claims a nearby unoccupied bench, walks to it, sits
 * (Sitting-1), and releases the seat on exit. Falls back to resting on the grass
 * if no seat is available nearby.
 */

import { SeekSpotState } from './SeekSpotState.js';
import { claimNearestSeat, releaseSeat } from '@/world/benchRegistry.js';
import { REST_MIN, REST_MAX } from '@/config.js';

// Visual-only placement of the seated figure relative to the bench.
const SIT_UP      = 0.8;
const SIT_FORWARD = 0.2;

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
    agent.sitDown({ up: SIT_UP, forward: SIT_FORWARD });
  }

  onSettled(agent) { agent.settleSeated(); }

  duration(agent) { return REST_MIN + agent.rand() * (REST_MAX - REST_MIN); }
}
