/**
 * AgentController — yuka-based orchestrator (replaces the old force-math
 * AgentController + AgentStateMachine + AgentLocomotion trio).
 *
 * Owns a yuka.EntityManager holding one AgentEntity per person. Movement and
 * behaviour are driven by each entity's own yuka.StateMachine; this class
 * only handles UI-triggered interactions (greet / walk-to-project / dismiss)
 * and forwards the per-frame tick.
 *
 * Public API (unchanged from the pre-yuka version, so main.js/picker.js/
 * speechBubble.js/overlay.js need no changes):
 *   getAgents() → agent[]
 *   getMeshes() → THREE.Mesh[]
 *   greetAgent(agent)
 *   walkToProject(agent, attraction)
 *   resumeAgent(agent)
 *   update(dt)
 *   setCamera(camera)
 *   setRand(rand)
 *   setDismissCallback(fn)
 */

import * as YUKA from 'yuka';
import { AgentEntity } from './AgentEntity.js';

const GREETING_DURATION = 2.5;

export class AgentController {
  constructor(scene, navGraph, personNodes, attractions, assetLibrary, pathSegments, onArrival) {
    this._camera    = null;
    this._onDismiss = null;
    this._onArrival = onArrival;
    this._rand      = Math.random;
    this._entityManager = new YUKA.EntityManager();
    this._agents = [];
    this._pendingArrival = null;

    if (navGraph.nodes.length < 2) return;

    for (const person of personNodes) {
      const agent = new AgentEntity(scene, person, assetLibrary, {
        navGraph,
        pathSegments,
        rand: () => this._rand(),
        onArrivedAtAttraction: (a, attraction) => this._onAgentArrived(a, attraction),
        getAllAgents: () => this._agents,
      });
      this._entityManager.add(agent);
      this._agents.push(agent);
    }
  }

  setCamera(camera)      { this._camera = camera; }
  setRand(rand)          { this._rand = rand; }
  setDismissCallback(fn) { this._onDismiss = fn; }

  getMeshes() { return this._agents.map(a => a.mesh); }
  getAgents() { return this._agents; }

  greetAgent(agent) {
    agent.stopped = true;
    agent.state   = 'greeting';
    agent.velocity.set(0, 0, 0);
    if (this._camera) agent.facePoint(this._camera.position.x, this._camera.position.z);
    agent._playClip?.('greeting');
    agent._greetTimer = GREETING_DURATION;
    agent._greetIsArrival = false;
  }

  /**
   * Walk agent to an attraction (uses attraction.displayU/V as goal).
   * @param {AgentEntity} agent
   * @param {AttractionInstance} attraction
   */
  walkToProject(agent, attraction) {
    agent.stopped = false;
    agent.state   = 'walking';
    agent.chattingWith = null;
    agent.walkingToAttraction = attraction;
    agent.stateMachine.changeTo('walking');
  }

  resumeAgent(agent) {
    agent.stopped = false;
    agent.chattingWith = null;
    agent.walkingToAttraction = null;
    agent.maxSpeed = agent._baseSpeed;
    agent.stateMachine.changeTo('walking');
  }

  _onAgentArrived(agent, attraction) {
    agent.stopped = true;
    agent.state   = 'greeting';
    agent.velocity.set(0, 0, 0);
    agent._playClip?.('greeting');
    if (this._camera) agent.facePoint(this._camera.position.x, this._camera.position.z);
    agent._greetTimer = GREETING_DURATION;
    agent._greetIsArrival = true;
    this._pendingArrival = { agent, attraction };
  }

  update(dt) {
    // Greeting countdown is UI-driven (not a yuka state) since it depends on
    // the camera and dismiss/arrival callbacks owned by this controller.
    // The speech bubble UI normally dismisses the greeting explicitly (via
    // resumeAgent, triggered by its close button); this timer is a fallback
    // so an agent doesn't stand frozen forever if that never happens.
    for (const agent of this._agents) {
      if (agent.stopped && agent.state === 'greeting') {
        agent._greetTimer -= dt;
        if (agent._greetTimer <= 0) {
          if (agent._greetIsArrival) {
            agent._greetIsArrival = false;
            const pending = this._pendingArrival;
            this._pendingArrival = null;
            if (this._onArrival && pending) this._onArrival(pending.agent, pending.attraction);
          } else {
            // Settle into a quiet idle pose rather than standing frozen
            // indefinitely; still stopped/greeting until the UI dismisses it.
            agent._playClip?.('idle');
          }
        }
      }
    }

    this._entityManager.update(dt);
  }
}
