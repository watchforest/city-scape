/**
 * Small helpers for reasoning about the crowd: who is near whom, and where a set of
 * agents is centred. Used by behaviour selection, dancing and walking groups.
 */

/**
 * Agents within `radius` of `agent` (excluding `agent`) that satisfy `pred`.
 * @param {AgentEntity}   agent
 * @param {AgentEntity[]} all
 * @param {number}        radius
 * @param {(a: AgentEntity) => boolean} [pred]
 */
export function nearby(agent, all, radius, pred = () => true) {
  const r2 = radius * radius;
  return all.filter(a => a !== agent && pred(a) && a.position.squaredDistanceTo(agent.position) < r2);
}

/** Mean world (x, z) of a non-empty list of agents. */
export function centroid(agents) {
  let x = 0, z = 0;
  for (const a of agents) { x += a.position.x; z += a.position.z; }
  return { x: x / agents.length, z: z / agents.length };
}

/**
 * True for an agent that is simply out walking: not on an errand to a landmark, not
 * paused by the UI, not in a group, and actually in the walking state (not on its way
 * to a bench or a patch of grass, which also reads 'walking').
 */
export function isFreeWalker(a) {
  return a.state === 'walking'
    && !a.stopped
    && !a.walkingToAttraction
    && a.groupLeader === null
    && a.groupFollowers.length === 0
    && a.stateMachine.currentState === a.stateMachine.states.get('walking');
}
