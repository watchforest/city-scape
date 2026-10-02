/**
 * RestingOnGrassState — agent stops off-path and plays an idle animation.
 * Used when going idle but no bench seat is available nearby.
 */

import * as YUKA from 'yuka';
import { REST_MIN, REST_MAX } from '@/config.js';

export class RestingOnGrassState extends YUKA.State {
  enter(agent) {
    agent.state = 'resting';
    agent.velocity.set(0, 0, 0);
    agent._playClip?.('idle');
    this._timer = REST_MIN + (agent.rand ?? Math.random)() * (REST_MAX - REST_MIN);
  }

  execute(agent) {
    if (agent.stopped) return;
    this._timer -= agent._lastDelta ?? 0;
    if (this._timer <= 0) {
      agent.stateMachine.changeTo('walking');
    }
  }

  exit() {}
}
