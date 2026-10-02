/**
 * ChattingState — a conversation (a 'chat' gathering, see gatherings.js): the agent stands
 * still at its spot and turns to whoever is speaking (the speaker turns to someone else).
 * chatBubbles.js runs the conversation, one speaker at a time, and records who it is in
 * gathering.speaker. The GatheringManager decides when the conversation ends, for everyone.
 */

import * as YUKA from 'yuka';

export class ChattingState extends YUKA.State {
  enter(agent) {
    agent.state = 'chatting';
    agent.velocity.set(0, 0, 0);
    agent.playRole('idle');
  }

  execute(agent) {
    if (agent.stopped) return;
    const g = agent.gathering;
    if (!g) { agent.stateMachine.changeTo('walking'); return; }

    // Listeners look at the speaker; the speaker looks at one of the listeners.
    let target = (g.speaker && g.speaker !== agent) ? g.speaker : null;
    if (!target) {
      const i = g.members.indexOf(agent);
      target = g.members[(i + 1) % g.members.length];
      if (target === agent) target = null;
    }
    if (target) agent.turnTowards(target.position.x, target.position.z, agent._lastDelta ?? 0);
    else agent.turnTowards(g.center.x, g.center.z, agent._lastDelta ?? 0);
  }

  exit() {}
}
