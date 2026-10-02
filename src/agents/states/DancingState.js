/**
 * DancingState — agent stops where it is and dances (one of Dancing-1..3) for a
 * while, then walks on.
 */

import * as YUKA from 'yuka';
import { DANCE_MIN, DANCE_MAX } from '@/config.js';

export class DancingState extends YUKA.State {
  enter(agent) {
    agent.state = 'dancing';
    agent.velocity.set(0, 0, 0);
    agent.playRole('dance');
    this._timer = DANCE_MIN + agent.rand() * (DANCE_MAX - DANCE_MIN);
  }

  execute(agent) {
    if (agent.stopped) return;
    this._timer -= agent._lastDelta ?? 0;
    if (this._timer <= 0) agent.stateMachine.changeTo('walking');
  }

  exit() {}
}
