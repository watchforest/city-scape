/**
 * WalkingState — idle strolling along the path ribbon network, or a directed
 * walk toward a chosen attraction when agent.walkingToAttraction is set.
 *
 * Rebuilds a yuka.Path each time a new stroll/route starts and drives the
 * vehicle along it via FollowPathBehavior. On arrival, either starts a new
 * random stroll (idle wandering) or hands off to the arrival callback
 * (directed walk to an attraction).
 *
 * A stroller may also take nearby walkers along as companions (groups.js): they walk and
 * talk together for the rest of the stroll, and at its end the group usually stops for a chat.
 */

import * as YUKA from 'yuka';
import { buildStrollWaypoints, buildRouteWaypoints } from '../waypoints.js';
import { selectNextBehaviour } from '../idleSelection.js';
import { formGroup, findCompanions, dissolveGroup, groupChat } from '../groups.js';
import { isFreeWalker } from '../crowd.js';
import { GROUP_WALK_CHANCE, GROUP_CHAT_AFTER } from '@/config.js';

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
    if (sprinting) dissolveGroup(agent); // an errand to a landmark: go alone
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

      // End of a group stroll: usually stop and talk together, otherwise go separate ways.
      if (agent.groupFollowers.length) {
        if (rand() < GROUP_CHAT_AFTER && groupChat(agent, rand)) return;
        dissolveGroup(agent);
      }

      const behaviour = selectNextBehaviour(agent, this._getAllAgents(), rand, agent.night);
      if (behaviour.kind === 'chatting') {
        agent._pendingChat = { duration: behaviour.duration, partner: behaviour.partner };
        agent.stateMachine.changeTo('chatting');
        return;
      }
      if (behaviour.kind !== 'walking') {
        if (behaviour.kind === 'dancing') agent._danceJoin = behaviour.join ?? null;
        agent.stateMachine.changeTo(behaviour.kind); // sitting | sittingGround | resting | dancing
        return;
      }
      this._startStroll(agent);
    }
  }

  exit(agent) {
    agent.steering.remove(this._follow);
    dissolveGroup(agent); // leaving the walking state ends any group this agent was leading
  }

  _atGoal(agent) {
    const wps = this._follow.path._waypoints;
    const goal = wps[wps.length - 1];
    return !goal || Math.hypot(goal.x - agent.position.x, goal.z - agent.position.z) < GOAL_REACHED_DIST;
  }

  _startStroll(agent) {
    const pos = { u: agent.position.x, v: agent.position.z };
    const attraction = agent.walkingToAttraction;
    const rand = agent.rand ?? Math.random;

    const wps = attraction
      ? buildRouteWaypoints(pos, attraction, this._navGraph, this._pathSegments)
      : buildStrollWaypoints(pos, this._pathSegments, rand, this._lastNodeId);

    this._follow.path.clear();
    if (wps.length === 0) {
      // No path data reachable from here — hold position briefly then retry.
      this._follow.path.add(new YUKA.Vector3(pos.u, 0, pos.v));
      this._follow.path.add(new YUKA.Vector3(pos.u, 0, pos.v));
    } else {
      for (const wp of wps) this._follow.path.add(new YUKA.Vector3(wp.u, 0, wp.v));
    }

    // Sometimes take nearby walkers along for the stroll.
    if (!attraction && agent.groupFollowers.length === 0 && isFreeWalker(agent) && rand() < GROUP_WALK_CHANCE) {
      const companions = findCompanions(agent, this._getAllAgents());
      if (companions.length) formGroup(agent, companions);
    }
  }
}
