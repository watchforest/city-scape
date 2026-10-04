/**
 * WalkingState — idle strolling along the path ribbon network (a random walk that works its way across the whole
 * map, remembered per agent in agent.roam; see buildStrollWaypoints), or a directed
 * walk toward a chosen attraction when agent.walkingToAttraction is set.
 *
 * Rebuilds a yuka.Path each time a new stroll/route starts and drives the
 * vehicle along it via FollowPathBehavior. On arrival, either starts a new
 * random stroll (idle wandering) or hands off to the arrival callback
 * (directed walk to an attraction).
 *
 * When a stroll ends the agent decides what to do next (idleSelection.js). To chat or dance it
 * starts a gathering (gatherings.js): it invites people, everyone walks to a meeting spot, and
 * the activity begins once they are all standing there.
 */

import * as YUKA from 'yuka';
import { buildStrollWaypoints, buildRouteWaypoints, offsetToRight } from '../waypoints.js';
import { PassOncomingBehavior } from '../passing.js';
import { selectNextBehaviour } from '../idleSelection.js';
import { outsideLandmarks } from '../collision.js';
import { CHAT_MIN, CHAT_MAX, DANCE_MIN, DANCE_MAX, AGENT_LANE_OFFSET } from '@/config.js';

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
    this._pass         = new PassOncomingBehavior(); // sidestep to the right for someone coming the other way
  }

  enter(agent) {
    agent.state = 'walking';
    const sprinting = !!agent.walkingToAttraction;
    agent.playRole(sprinting ? 'run' : 'walk');
    agent.maxSpeed = sprinting ? agent._sprintSpeed : agent._baseSpeed;
    agent.steering.add(this._follow);
    agent.steering.add(this._pass);
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

      const rand = agent.rand ?? Math.random;
      const behaviour = selectNextBehaviour(agent, this._getAllAgents(), rand, agent.night);

      if (behaviour.kind === 'chatting') {
        const duration = CHAT_MIN + rand() * (CHAT_MAX - CHAT_MIN);
        if (agent.gatherings.create('chat', agent, behaviour.partners, duration)) return;
        // No valid meeting spot — just keep strolling.
      } else if (behaviour.kind === 'dancing') {
        if (behaviour.join) {
          if (agent.gatherings.join(behaviour.join, agent)) return;
        } else {
          const duration = DANCE_MIN + rand() * (DANCE_MAX - DANCE_MIN);
          if (agent.gatherings.create('dance', agent, behaviour.partners, duration)) return;
        }
        // Couldn't gather anyone — keep strolling.
      } else if (behaviour.kind !== 'walking') {
        agent.stateMachine.changeTo(behaviour.kind); // sitting | sittingGround | resting
        return;
      }
      this._startStroll(agent);
    }
  }

  exit(agent) {
    agent.steering.remove(this._follow);
    agent.steering.remove(this._pass);
  }

  _atGoal(agent) {
    const wps = this._follow.path._waypoints;
    const goal = wps[wps.length - 1];
    return !goal || Math.hypot(goal.x - agent.position.x, goal.z - agent.position.z) < GOAL_REACHED_DIST;
  }

  _startStroll(agent) {
    const pos = { u: agent.position.x, v: agent.position.z };
    const attraction = agent.walkingToAttraction;

    const centreLine = attraction
      ? buildRouteWaypoints(pos, attraction, this._navGraph, this._pathSegments)
      : buildStrollWaypoints(pos, this._pathSegments, agent.rand ?? Math.random, (agent.roam ??= {}), this._navGraph.nodeMap);
    // Walk in this agent's own lane, to the right of the centre line, so oncoming walkers pass on opposite sides.
    agent.laneOffset ??= AGENT_LANE_OFFSET[0] + (agent.rand ?? Math.random)() * (AGENT_LANE_OFFSET[1] - AGENT_LANE_OFFSET[0]);
    const wps = offsetToRight(centreLine, agent.laneOffset, { keepLast: !!attraction });

    this._follow.path.clear();
    if (wps.length === 0) {
      // No path data reachable from here — hold position briefly then retry.
      this._follow.path.add(new YUKA.Vector3(pos.u, 0, pos.v));
      this._follow.path.add(new YUKA.Vector3(pos.u, 0, pos.v));
      return;
    }
    // Waypoints at a plaza centre sit inside the landmark: move them to its edge, on the side
    // the agent comes from, so the agent walks up to it instead of through it.
    let prev = null;
    for (const wp of wps) {
      const out = outsideLandmarks(wp.u, wp.v, prev?.u ?? pos.u, prev?.v ?? pos.v);
      this._follow.path.add(new YUKA.Vector3(out.u, 0, out.v));
      prev = out;
    }
  }
}
