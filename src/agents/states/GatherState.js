/**
 * GatherState — an agent invited to a gathering (agent.gathering, see gatherings.js)
 * walks to its own spot on the meeting ring, stops, faces the centre and waits there
 * until the others have arrived. The GatheringManager then switches everyone into the
 * activity (ChattingState / DancingState) at the same moment.
 *
 * Reads as 'walking' to the UI while it is on its way.
 */

import * as YUKA from 'yuka';

const ARRIVE_TOLERANCE = 1.0;

export class GatherState extends YUKA.State {
  enter(agent) {
    const g = agent.gathering;
    const spot = g?.spots.get(agent);
    if (!spot) { agent.stateMachine.changeTo('walking'); return; }

    this._spot = spot;
    agent.state = 'walking';
    agent.maxSpeed = agent._baseSpeed;
    agent.playRole('walk');
    this._seek = new YUKA.SeekBehavior(new YUKA.Vector3(spot.x, 0, spot.z));
    agent.steering.add(this._seek);
  }

  execute(agent) {
    if (agent.stopped || !this._spot || agent.gatherArrived) return;

    const d = Math.hypot(agent.position.x - this._spot.x, agent.position.z - this._spot.z);
    if (d < ARRIVE_TOLERANCE) {
      agent.velocity.set(0, 0, 0);
      agent.steering.remove(this._seek);
      this._seek = null;
      agent.facePoint(agent.gathering.center.x, agent.gathering.center.z);
      agent.playRole('idle');
      agent.gatherArrived = true;
    }
  }

  exit(agent) {
    if (this._seek) agent.steering.remove(this._seek);
    this._seek = null;
    this._spot = null;
  }
}
