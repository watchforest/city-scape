/**
 * ChattingState — agent stops, faces its chat partner, and holds for a
 * fixed duration. chatBubbles.js independently spawns speech-bubble
 * fragments from agent.person.quotes (or the shared pool) while
 * agent.state === 'chatting' — no coordination between the two chatting
 * agents' quotes is needed.
 *
 * Duration/partner are passed via agent._pendingChat, set immediately
 * before calling stateMachine.changeTo('chatting') — yuka's StateMachine
 * registers one singleton instance per state id, so per-invocation args
 * can't flow through changeTo() itself.
 */

import * as YUKA from 'yuka';

export class ChattingState extends YUKA.State {
  enter(agent) {
    const { duration, partner } = agent._pendingChat ?? {};
    agent._pendingChat = null;

    agent.state = 'chatting';
    agent.chattingWith = partner ?? null;
    agent.velocity.set(0, 0, 0);
    agent.playRole('idle');
    this._timer = duration ?? 5;
  }

  execute(agent) {
    if (agent.stopped) return;

    const p = agent.chattingWith;
    if (p) agent._facing = Math.atan2(p.position.x - agent.position.x, p.position.z - agent.position.z);

    this._timer -= agent._lastDelta ?? 0;
    if (this._timer <= 0) {
      agent.stateMachine.changeTo('walking');
    }
  }

  exit(agent) {
    agent.chattingWith = null;
  }
}
