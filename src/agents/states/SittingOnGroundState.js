/**
 * SittingOnGroundState — walks to a patch of grass beside a path and sits down on
 * it (Stand-To-Sit, played once and held). Falls back to resting if no spot is free.
 */

import { SeekSpotState } from './SeekSpotState.js';
import { claimGrassSpot, releaseGrassSpot } from '../grassSpots.js';
import { REST_MIN, REST_MAX } from '@/config.js';

export class SittingOnGroundState extends SeekSpotState {
  stateId = 'sittingGround';
  fallbackState = 'resting';

  constructor({ pathSegments } = {}) {
    super();
    this._pathSegments = pathSegments ?? [];
  }

  acquireSpot(agent) {
    return claimGrassSpot(agent.uuid, agent.position, this._pathSegments, agent.rand);
  }

  releaseSpot(agent) { releaseGrassSpot(agent.uuid); }

  onArrive(agent) { agent.playRole('sitGround'); }

  duration(agent) { return REST_MIN + agent.rand() * (REST_MAX - REST_MIN); }
}
