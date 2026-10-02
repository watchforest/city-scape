/**
 * AccompanyState — a companion in a walking group: stays beside/behind the group's
 * leader while they walk and talk. Reads as 'walking' to the UI; chatBubbles shows the
 * conversation because the agent isTalking (groupLeader is set).
 *
 * The group ends when the leader stops being a free walker (see groups.js): the
 * companion is then sent back to walking by dissolveGroup/groupChat, or notices here.
 */

import * as YUKA from 'yuka';
import { GROUP_SPACING } from '@/config.js';
import { leaveGroup } from '../groups.js';

export class AccompanyState extends YUKA.State {
  enter(agent) {
    const leader = agent.groupLeader;
    if (!leader) { agent.stateMachine.changeTo('walking'); return; }

    agent.state = 'walking';
    agent.playRole('walk');
    // Companions alternate sides, a little behind the leader (yuka: +x right, +z forward).
    const slot = Math.max(0, leader.groupFollowers.indexOf(agent));
    const side = slot % 2 === 0 ? 1 : -1;
    const offset = new YUKA.Vector3(side * GROUP_SPACING, 0, -GROUP_SPACING * (0.4 + 0.5 * Math.floor(slot / 2)));
    this._pursuit = new YUKA.OffsetPursuitBehavior(leader, offset);
    agent.steering.add(this._pursuit);
    // Fast enough to catch up when the leader pulls ahead.
    agent.maxSpeed = Math.max(agent._baseSpeed, leader.maxSpeed * 1.3);
  }

  execute(agent) {
    if (agent.stopped) return;
    const leader = agent.groupLeader;
    if (!leader || leader.stopped || !leader.groupFollowers.includes(agent)) {
      agent.stateMachine.changeTo('walking');
    }
  }

  exit(agent) {
    if (this._pursuit) agent.steering.remove(this._pursuit);
    this._pursuit = null;
    agent.maxSpeed = agent._baseSpeed;
    leaveGroup(agent);
  }
}
