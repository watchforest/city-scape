/**
 * WalkingState — idle strolling along the path ribbon network, or a directed
 * walk toward a chosen attraction when agent.walkingToAttraction is set.
 *
 * Rebuilds a yuka.Path each time a new stroll/route starts and drives the
 * vehicle along it via FollowPathBehavior. On arrival, either starts a new
 * random stroll (idle wandering) or hands off to the arrival callback
 * (directed walk to an attraction).
 */

import * as YUKA from 'yuka';
import { buildStrollWaypoints, buildRouteWaypoints } from '../waypoints.js';
import { selectNextBehaviour } from '../idleSelection.js';

const ARRIVE_TOLERANCE = 1.5;
// yuka reports a path finished as soon as the *last* waypoint becomes the target,
// i.e. up to one waypoint-spacing early; only treat the walk as over once the
// agent is actually this close to that last waypoint.
const GOAL_REACHED_DIST = 3;

export class WalkingState extends YUKA.State {
  constructor({ navGraph, pathSegments, onArrivedAtAttraction, getAllAgents } = {}) {
    super();
    this._navGraph     = navGraph;
    this._pathSegments = pathSegments ?? [];
    this._onArrived    = onArrivedAtAttraction;
    this._getAllAgents = getAllAgents ?? (() => []);
    this._follow       = new YUKA.FollowPathBehavior();
    this._follow.nextWaypointDistance = 8;
    this._follow._arrive.tolerance    = ARRIVE_TOLERANCE;
    this._lastNodeId    = null;
  }

  enter(agent) {
    agent.state = 'walking';
    const sprinting = !!agent.walkingToAttraction;
    agent.playRole(sprinting ? 'run' : 'walk');
    agent.maxSpeed = sprinting ? agent._sprintSpeed : agent._baseSpeed;
    agent.steering.add(this._follow);
    this._startStroll(agent);
  }

  execute(agent) {
    if (agent.stopped) return;

    if (this._follow.path.finished() && this._atGoal(agent)) {
      if (agent.walkingToAttraction) {
        const attraction = agent.walkingToAttraction;
        agent.walkingToAttraction = null;
        if (this._onArrived) this._onArrived(agent, attraction);
        return;
      }

      const behaviour = selectNextBehaviour(agent, this._getAllAgents(), agent.rand ?? Math.random);
      if (behaviour.kind === 'chatting') {
        agent._pendingChat = { duration: behaviour.duration, partner: behaviour.partner };
        agent.stateMachine.changeTo('chatting');
        return;
      }
      if (behaviour.kind !== 'walking') {
        agent.stateMachine.changeTo(behaviour.kind); // sitting | sittingGround | resting | dancing
        return;
      }
      this._startStroll(agent);
    }
  }

  exit(agent) {
    agent.steering.remove(this._follow);
  }

  _atGoal(agent) {
    const wps = this._follow.path._waypoints;
    const goal = wps[wps.length - 1];
    return !goal || Math.hypot(goal.x - agent.position.x, goal.z - agent.position.z) < GOAL_REACHED_DIST;
  }

  _startStroll(agent) {
    const pos = { u: agent.position.x, v: agent.position.z };
    const attraction = agent.walkingToAttraction;

    const wps = attraction
      ? buildRouteWaypoints(pos, attraction, this._navGraph, this._pathSegments)
      : buildStrollWaypoints(pos, this._pathSegments, agent.rand ?? Math.random, this._lastNodeId);

    this._follow.path.clear();
    if (wps.length === 0) {
      // No path data reachable from here — hold position briefly then retry.
      this._follow.path.add(new YUKA.Vector3(pos.u, 0, pos.v));
      this._follow.path.add(new YUKA.Vector3(pos.u, 0, pos.v));
      return;
    }
    for (const wp of wps) this._follow.path.add(new YUKA.Vector3(wp.u, 0, wp.v));
  }
}
