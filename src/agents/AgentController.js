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
 *   setArrivalDoneCallback(fn)  — called when an agent has finished waving at a landmark and walks on
 */

import * as YUKA from 'yuka';
import { AgentEntity } from './AgentEntity.js';
import { isFreeWalker } from './crowd.js';
import { GatheringManager } from './gatherings.js';
import { setLandmarks, resolveCollisions } from './collision.js';
import { setPlazas } from './plazas.js';
import { ARRIVAL_WAVE_DURATION, MEET_RADIUS, MEET_CHANCE_PER_S, MEET_COOLDOWN } from '@/config.js';

const GREETING_DURATION = 2.5;
const MEET_CHECK_INTERVAL = 0.25; // seconds between looks for two walkers who have bumped into each other

export class AgentController {
  constructor(scene, navGraph, personNodes, attractions, assetLibrary, pathSegments, onArrival) {
    this._camera    = null;
    this._onDismiss = null;
    this._onArrival = onArrival;
    this._rand      = Math.random;
    this._entityManager = new YUKA.EntityManager();
    this._agents = [];
    this._onArrivalDone = null;
    this._getNight  = () => 0;   // 0 (day) … 1 (night); see setNightFactor
    this._meetTimer = 0;
    this._gatherings = new GatheringManager(() => this._rand()); // chats and dances (gatherings.js)
    setLandmarks(attractions);
    setPlazas(attractions);

    if (navGraph.nodes.length < 1) return; // (a single landmark has no paths: people just hang about it)

    // There is no procedural fallback: every agent needs a character model.
    if (assetLibrary.resolve('person:default').type !== 'gltf') {
      console.error('[agents] person:default (character.glb) failed to load — no agents will spawn');
      return;
    }

    for (const person of personNodes) {
      const agent = new AgentEntity(scene, person, assetLibrary, {
        navGraph,
        pathSegments,
        rand: () => this._rand(),
        onArrivedAtAttraction: (a, attraction) => this._onAgentArrived(a, attraction),
        getAllAgents: () => this._agents,
        getNight: () => this._getNight(),
        gatherings: this._gatherings,
      });
      this._entityManager.add(agent);
      this._agents.push(agent);
    }
  }

  setCamera(camera)      { this._camera = camera; }
  setRand(rand)          { this._rand = rand; }
  setDismissCallback(fn) { this._onDismiss = fn; }
  setArrivalDoneCallback(fn) { this._onArrivalDone = fn; }
  /** @param {() => number} fn — time of day as 0 (day) … 1 (night); biases what agents do */
  setNightFactor(fn) { this._getNight = fn; }

  getMeshes() { return this._agents.map(a => a.mesh); }
  getAgents() { return this._agents; }

  greetAgent(agent) {
    agent.stopped = true;
    agent.state   = 'greeting';
    agent.velocity.set(0, 0, 0);
    agent.clearSit(); // stand up from a bench to wave
    if (this._camera) agent.facePoint(this._camera.position.x, this._camera.position.z);
    agent.playRole('greet');
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
    agent.walkingToAttraction = attraction;
    agent.stateMachine.changeTo('walking');
  }

  resumeAgent(agent) {
    agent.stopped = false;
    agent.walkingToAttraction = null;
    agent.maxSpeed = agent._baseSpeed;
    agent.stateMachine.changeTo('walking');
  }

  /**
   * An agent led the user to a landmark: select the landmark right away (the agent
   * waves at the camera meanwhile), then walk on after the wave.
   */
  _onAgentArrived(agent, attraction) {
    agent.stopped = true;
    agent.state   = 'greeting';
    agent.velocity.set(0, 0, 0);
    agent.playRole(this._rand() < 0.5 ? 'greetBoth' : 'greet'); // vary the wave
    if (this._camera) agent.facePoint(this._camera.position.x, this._camera.position.z);
    agent._greetTimer = ARRIVAL_WAVE_DURATION;
    agent._greetIsArrival = true;
    if (this._onArrival) this._onArrival(agent, attraction);
  }

  update(dt) {
    // Greeting countdown is UI-driven (not a yuka state) since it depends on the
    // camera and arrival callbacks owned by this controller.
    //  - Arrival at a landmark: wave for ARRIVAL_WAVE_DURATION, then walk on.
    //  - Clicked agent: wave, then settle into idle and wait; the speech bubble UI
    //    dismisses it explicitly (via resumeAgent, triggered by its close button).
    for (const agent of this._agents) {
      if (agent.stopped && agent.state === 'greeting') {
        agent._greetTimer -= dt;
        if (agent._greetTimer <= 0) {
          if (agent._greetIsArrival) {
            agent._greetIsArrival = false;
            this.resumeAgent(agent);
            if (this._onArrivalDone) this._onArrivalDone(agent);
          } else {
            // Settle into a quiet idle pose rather than standing frozen.
            agent.playRole('idle');
          }
        }
      }
    }

    this._checkMeetings(dt);
    this._gatherings.update(dt);
    resolveCollisions(this._agents);
    this._entityManager.update(dt);
  }

  /**
   * Two walkers who pass close to each other may stop and wave (MeetingState) — and then
   * sometimes carry on together as a group. Checked a few times a second.
   */
  _checkMeetings(dt) {
    this._meetTimer += dt;
    if (this._meetTimer < MEET_CHECK_INTERVAL) return;
    const step = this._meetTimer;
    this._meetTimer = 0;

    const walkers = this._agents.filter(a => a.meetCooldown <= 0 && isFreeWalker(a));
    const r2 = MEET_RADIUS * MEET_RADIUS;
    const chance = MEET_CHANCE_PER_S * step;

    for (let i = 0; i < walkers.length; i++) {
      const a = walkers[i];
      if (!isFreeWalker(a)) continue; // already pulled into a meeting this pass
      for (let j = i + 1; j < walkers.length; j++) {
        const b = walkers[j];
        if (!isFreeWalker(b)) continue;
        if (a.position.squaredDistanceTo(b.position) > r2) continue;
        if (this._rand() > chance) continue;
        this._startMeeting(a, b);
        break;
      }
    }
  }

  _startMeeting(a, b) {
    a._meetPartner = b;  b._meetPartner = a;
    a._meetInitiator = true;
    a.meetCooldown = MEET_COOLDOWN * (0.8 + this._rand() * 0.4);
    b.meetCooldown = MEET_COOLDOWN * (0.8 + this._rand() * 0.4);
    a.stateMachine.changeTo('meeting');
    b.stateMachine.changeTo('meeting');
  }
}
