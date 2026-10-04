/**
 * AdmiringState — walks out onto a plaza, stands on its open ring facing the landmark, and takes it in for a while
 * (idle animation) before strolling on. Falls back to walking if there is no plaza near or no free spot on it.
 */

import { SeekSpotState } from './SeekSpotState.js';
import { plazaNear, plazaPoint } from '../plazas.js';
import { isOccupied, isWalkClear } from '@/world/obstacleRegistry.js';
import { ADMIRE_MIN, ADMIRE_MAX, ADMIRE_RADIUS, ADMIRE_SPACING } from '@/config.js';

const _claims = new Map(); // agent uuid → { x, z }: places on plazas already taken

export class AdmiringState extends SeekSpotState {
  stateId = 'admiring';
  fallbackState = 'walking';

  acquireSpot(agent) {
    const plaza = plazaNear(agent.position.x, agent.position.z, ADMIRE_RADIUS);
    if (!plaza) return null;
    // Look from the side we come from, give or take: a spot on the ring, free, not beside another admirer, reachable.
    const fromAngle = Math.atan2(agent.position.z - plaza.z, agent.position.x - plaza.x);
    for (let i = 0; i < 20; i++) {
      const p = plazaPoint(plaza, agent.rand, fromAngle + (agent.rand() - 0.5) * (i < 10 ? 2.2 : Math.PI * 2));
      if (isOccupied(p.u, p.v, 1.2, true)) continue;
      if ([..._claims.values()].some(c => Math.hypot(c.x - p.u, c.z - p.v) < ADMIRE_SPACING)) continue;
      if (!isWalkClear(agent.position.x, agent.position.z, p.u, p.v)) continue;
      _claims.set(agent.uuid, { x: p.u, z: p.v });
      return { x: p.u, z: p.v, facing: Math.atan2(plaza.lx - p.u, plaza.lz - p.v) };   // facing the landmark
    }
    return null;
  }

  releaseSpot(agent) { _claims.delete(agent.uuid); }

  onArrive(agent) { agent.playRole('idle'); }

  duration(agent) { return ADMIRE_MIN + agent.rand() * (ADMIRE_MAX - ADMIRE_MIN); }
}
