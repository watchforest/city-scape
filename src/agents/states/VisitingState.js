/**
 * VisitingState — a walker goes over to someone who is sitting (on a bench or on the grass), stands in front of them and
 * chats. The sitter stays put, so there is no meeting spot: it is a "seated" conversation (gatherings.js `createSeated`),
 * run by the chat bubbles like any other, and it lasts until the visitor leaves or the sitter gets up.
 *
 * The person to visit is `agent.visitTarget`, set by WalkingState from idleSelection's pick. While the visit is on, the
 * sitter carries `visitor` (so nobody else joins the visit) and is kept seated long enough for the whole chat.
 * Same phases as SeekSpotState (approach → settle → stay → leave); a visitor does not sit, so it just walks off again.
 */

import { SeekSpotState } from './SeekSpotState.js';
import { isOccupied, isWalkClear } from '@/world/obstacleRegistry.js';
import { VISIT_DISTANCE, VISIT_MIN, VISIT_EXTRA } from '@/config.js';

/** Can this agent be visited right now? Seated (settled) on a bench or the grass, not already talking, not visited. */
export function isVisitable(a, { ignoreVisitor = false } = {}) {
  if (a.gathering || (a.visitor && !ignoreVisitor) || a.stopped) return false;
  if (a.state !== 'sitting' && a.state !== 'sittingGround') return false; // (people resting on the grass are asleep: Zzz)
  const s = a.stateMachine.currentState;
  return s?._phase === 'stay' && (a.state !== 'sitting' || a._seatSettled);
}

export class VisitingState extends SeekSpotState {
  stateId = 'visiting';
  fallbackState = 'walking';

  acquireSpot(agent) {
    const target = agent.visitTarget;
    agent.visitTarget = null;
    if (!target || !isVisitable(target)) return null;

    // In front of the sitter (the way they face), a little to a side if that is blocked.
    const f = target._facing ?? 0;
    for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
      const a = f + off;
      const x = target.position.x + Math.sin(a) * VISIT_DISTANCE, z = target.position.z + Math.cos(a) * VISIT_DISTANCE;
      if (isOccupied(x, z, 0.5, true)) continue;
      if (!isWalkClear(agent.position.x, agent.position.z, x, z)) continue;
      this._target = target;
      target.visitor = agent;
      return { x, z, facing: Math.atan2(target.position.x - x, target.position.z - z) };
    }
    return null;
  }

  releaseSpot() {
    if (this._target?.visitor) this._target.visitor = null;
  }

  onArrive(agent) {
    agent.playRole('idle');
  }

  onSettled(agent) {
    const target = this._target;
    if (!target || !isVisitable(target, { ignoreVisitor: true }) || !agent.gatherings?.createSeated(agent, target)) {
      this._timer = 0; // they got up (or started talking to someone else) while we walked over: nothing to say
      return;
    }
    this._timer = VISIT_MIN + agent.rand() * VISIT_EXTRA;
    const theirs = target.stateMachine.currentState;
    if (theirs && theirs._timer !== undefined) theirs._timer = Math.max(theirs._timer, this._timer + 2);
  }

  execute(agent) {
    super.execute(agent);
    if (this._phase !== 'stay' || !this._spot) return;
    const t = this._target;
    // The chat is over for us when the sitter has got up (that ends the conversation).
    if (!agent.gathering) this._timer = Math.min(this._timer, 0);
    else if (t) agent.turnTowards(t.position.x, t.position.z, agent._lastDelta ?? 0.016);
  }

  duration() { return VISIT_MIN; }

  exit(agent) {
    agent.gatherings?.endSeated(agent);
    this._target = null;
    super.exit(agent);
  }
}
