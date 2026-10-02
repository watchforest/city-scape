/**
 * SittingOnBenchState — claims a nearby unoccupied bench, walks to it, sits,
 * and releases the seat on exit. Falls back to RestingOnGrassState if no
 * seat is available nearby when the state is entered.
 */

import * as YUKA from 'yuka';
import { claimNearestSeat, releaseSeat } from '@/world/benchRegistry.js';
import { REST_MIN, REST_MAX } from '@/config.js';

const ARRIVE_TOLERANCE = 1.0;
// Seated pose stand-in: seat top is ~1.2 above ground; backrest at z=-0.42.
const SIT_UP      = 0.8;
const SIT_FORWARD = 0.2;

export class SittingOnBenchState extends YUKA.State {
  enter(agent) {
    const seat = claimNearestSeat(agent.uuid, agent.position.x, agent.position.z);
    if (!seat) {
      // No seat nearby — rest on grass instead.
      agent.stateMachine.changeTo('resting');
      return;
    }
    this._seat = seat;
    agent.state = 'sitting';
    agent._playClip?.('walking'); // walk to the seat, switch to idle once seated

    this._seek = new YUKA.SeekBehavior(new YUKA.Vector3(seat.x, 0, seat.z));
    agent.steering.add(this._seek);
    this._sat = false;
    this._timer = REST_MIN + (agent.rand ?? Math.random)() * (REST_MAX - REST_MIN);
  }

  execute(agent) {
    if (agent.stopped) return;
    if (!this._seat) return; // bailed out to resting in enter()

    if (!this._sat) {
      const d = Math.hypot(agent.position.x - this._seat.x, agent.position.z - this._seat.z);
      if (d < ARRIVE_TOLERANCE) {
        this._sat = true;
        agent.velocity.set(0, 0, 0);
        agent.steering.remove(this._seek);
        agent._facing = this._seat.facingAngle;
        agent._sitOffset = { up: SIT_UP, forward: SIT_FORWARD };
        agent._playClip?.('idle');
      }
      return;
    }

    this._timer -= agent._lastDelta ?? 0;
    if (this._timer <= 0) {
      agent.stateMachine.changeTo('walking');
    }
  }

  exit(agent) {
    agent._sitOffset = null;
    if (this._seat) releaseSeat(this._seat.benchId);
    if (this._seek) agent.steering.remove(this._seek);
    this._seat = null;
    this._sat = false;
  }
}
