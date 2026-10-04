/**
 * SeekSpotState — base for activities that happen at a particular spot: walk to
 * the spot, settle in, stay for a while, then leave and go back to walking.
 *
 * Phases: approach → settle → stay → leave
 *   approach  walking to the spot
 *   settle    arrival: onArrive() starts the pose; for sit states this is the sit-down
 *             animation, and onSettled() runs once it has finished
 *   stay      doing the activity until the timer runs out
 *   leave     (sit states only) the stand-up animation, then back to walking
 *
 * Subclasses provide:
 *   stateId           — value of agent.state once the agent has arrived
 *   fallbackState     — state to switch to if no spot is available
 *   acquireSpot(a)    — claim a spot → { x, z, facing } | null
 *   releaseSpot(a)    — release whatever acquireSpot claimed
 *   onArrive(a)       — start the pose/animation (agent is already stopped and facing)
 *   duration(a)       — seconds to stay at the spot
 * and optionally:
 *   transitions       — true to wait for sit-down / stand-up animations (default false)
 *   onSettled(a)      — called when the settle phase ends and the stay timer starts
 *   onLeave(a)        — called when the stay is over and the agent is about to stand up (sit states only)
 *   snapToSpot        — true to ease the agent exactly onto the spot while it settles (default false)
 *
 * While walking to the spot the agent reports state 'walking', so UI that keys on
 * state (sleep Zs, chat partner search) only reacts once it has actually settled.
 * Each agent owns its own state instances, so per-visit data can live on `this`.
 */

import * as YUKA from 'yuka';

const ARRIVE_TOLERANCE = 1.0;

export class SeekSpotState extends YUKA.State {
  transitions = false;
  onSettled() {}

  enter(agent) {
    this._spot = this.acquireSpot(agent);
    this._phase = 'approach';
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

    switch (this._phase) {
      case 'approach': {
        const d = Math.hypot(agent.position.x - this._spot.x, agent.position.z - this._spot.z);
        if (d < ARRIVE_TOLERANCE) {
          agent.velocity.set(0, 0, 0);
          agent.steering.remove(this._seek);
          agent._facing = this._spot.facing;
          agent.state = this.stateId;
          this._phase = 'settle';
          this.onArrive(agent);
        }
        break;
      }
      case 'settle':
        this._glideToSpot(agent);
        if (!this.transitions || agent.clipFinished()) {
          this.onSettled(agent);
          this._phase = 'stay';
        }
        break;
      case 'stay':
        this._glideToSpot(agent);
        this._timer -= agent._lastDelta ?? 0;
        if (this._timer <= 0) {
          if (this.transitions) {
            this.onLeave?.(agent);
            agent.standUp();
            this._phase = 'leave';
          } else {
            agent.stateMachine.changeTo('walking');
          }
        }
        break;
      case 'leave':
        if (agent.clipFinished()) agent.stateMachine.changeTo('walking');
        break;
    }
  }

  /**
   * Arriving counts as being within ARRIVE_TOLERANCE of the spot, so the agent stops up to a unit short or to the side.
   * For spots that need to be exact (a bench seat) it eases onto the spot while it settles instead.
   */
  _glideToSpot(agent) {
    if (!this.snapToSpot || !this._spot) return;
    const k = 1 - Math.exp(-8 * (agent._lastDelta ?? 0.016));
    agent.position.x += (this._spot.x - agent.position.x) * k;
    agent.position.z += (this._spot.z - agent.position.z) * k;
  }

  exit(agent) {
    agent.clearSit();
    if (this._seek) agent.steering.remove(this._seek);
    if (this._spot) this.releaseSpot(agent);
    this._seek = null;
    this._spot = null;
    this._phase = 'approach';
  }
}
