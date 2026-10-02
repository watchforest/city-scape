/**
 * SeekSpotState — base for activities that happen at a particular spot: walk to
 * the spot, perform the activity for a while, then go back to walking.
 *
 * Subclasses provide:
 *   stateId           — value of agent.state once the agent has arrived
 *   fallbackState     — state to switch to if no spot is available
 *   acquireSpot(a)    — claim a spot → { x, z, facing } | null
 *   releaseSpot(a)    — release whatever acquireSpot claimed
 *   onArrive(a)       — start the pose/animation (agent is already stopped and facing)
 *   duration(a)       — seconds to stay at the spot
 *
 * While walking to the spot the agent reports state 'walking', so UI that keys on
 * state (sleep Zs, chat partner search) only reacts once it has actually settled.
 * Each agent owns its own state instances, so per-visit data can live on `this`.
 */

import * as YUKA from 'yuka';

const ARRIVE_TOLERANCE = 1.0;

export class SeekSpotState extends YUKA.State {
  enter(agent) {
    this._spot = this.acquireSpot(agent);
    this._arrived = false;
    if (!this._spot) {
      agent.stateMachine.changeTo(this.fallbackState);
      return;
    }
    agent.state = 'walking';
    agent.playRole('walk');
    this._seek = new YUKA.SeekBehavior(new YUKA.Vector3(this._spot.x, 0, this._spot.z));
    agent.steering.add(this._seek);
    this._timer = this.duration(agent);
  }

  execute(agent) {
    if (agent.stopped || !this._spot) return;

    if (!this._arrived) {
      const d = Math.hypot(agent.position.x - this._spot.x, agent.position.z - this._spot.z);
      if (d < ARRIVE_TOLERANCE) {
        this._arrived = true;
        agent.velocity.set(0, 0, 0);
        agent.steering.remove(this._seek);
        agent._facing = this._spot.facing;
        agent.state = this.stateId;
        this.onArrive(agent);
      }
      return;
    }

    this._timer -= agent._lastDelta ?? 0;
    if (this._timer <= 0) agent.stateMachine.changeTo('walking');
  }

  exit(agent) {
    agent._sitOffset = null;
    if (this._seek) agent.steering.remove(this._seek);
    if (this._spot) this.releaseSpot(agent);
    this._seek = null;
    this._spot = null;
    this._arrived = false;
  }
}
