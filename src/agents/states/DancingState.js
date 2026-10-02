/**
 * DancingState — a dance (a 'dance' gathering, see gatherings.js): the agent dances at its
 * spot on the ring, using the dance the group agreed on, facing the centre. The
 * GatheringManager starts everyone together, adds joiners, and ends the dance for everyone
 * at once (or immediately if fewer than two dancers remain) — nobody dances alone.
 */

import * as YUKA from 'yuka';

export class DancingState extends YUKA.State {
  enter(agent) {
    agent.state = 'dancing';
    agent.velocity.set(0, 0, 0);
    const g = agent.gathering;
    agent.playRole('dance', g?.clip ? { clip: g.clip } : {});
  }

  execute(agent) {
    if (agent.stopped) return;
    const g = agent.gathering;
    if (!g) { agent.stateMachine.changeTo('walking'); return; }
    agent.turnTowards(g.center.x, g.center.z, agent._lastDelta ?? 0);
  }

  exit() {}
}
