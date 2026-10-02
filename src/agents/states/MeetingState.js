/**
 * MeetingState — two walkers pass close to each other, stop, face one another and wave
 * (Waving-both-arms or Waving). Afterwards the pair usually just carries on; sometimes the
 * one who started it stays to talk, and they step together and chat (a 'chat' gathering).
 *
 * Set agent._meetPartner (and agent._meetInitiator on one of the two) before changing to
 * this state; AgentController does that when it spots a meeting.
 */

import * as YUKA from 'yuka';
import { MEET_WAVE_DURATION, MEET_CHAT_CHANCE, CHAT_MIN, CHAT_MAX } from '@/config.js';

export class MeetingState extends YUKA.State {
  enter(agent) {
    this._partner = agent._meetPartner ?? null;
    this._initiator = !!agent._meetInitiator;
    agent._meetPartner = null;
    agent._meetInitiator = false;

    agent.state = 'meeting';
    agent.velocity.set(0, 0, 0);
    if (this._partner) agent.facePoint(this._partner.position.x, this._partner.position.z);
    agent.playRole(agent.rand() < 0.6 ? 'greetBoth' : 'greet');
    // The initiator ends the meeting for both of them; the other only has a safety timeout
    // in case the initiator was interrupted (e.g. clicked).
    const base = MEET_WAVE_DURATION * (0.85 + agent.rand() * 0.3);
    this._timer = this._initiator ? base : base * 2.5;
  }

  execute(agent) {
    if (agent.stopped) return;
    const p = this._partner;
    if (p) agent.facePoint(p.position.x, p.position.z);

    this._timer -= agent._lastDelta ?? 0;
    if (this._timer > 0) return;

    // The initiator decides whether the two stay and talk (stepping closer, then standing still
    // to chat) or just carry on separately.
    const partnerHere = !!p && p.state === 'meeting' && !p.stopped;
    if (this._initiator && partnerHere && agent.rand() < MEET_CHAT_CHANCE) {
      const duration = CHAT_MIN + agent.rand() * (CHAT_MAX - CHAT_MIN);
      if (agent.gatherings.create('chat', agent, [p], duration)) return; // both are now gathering
    }
    if (this._initiator && partnerHere) p.stateMachine.changeTo('walking');
    agent.stateMachine.changeTo('walking');
  }

  exit(agent) {
    this._partner = null;
  }
}
