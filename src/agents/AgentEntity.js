/**
 * AgentEntity — a yuka.Vehicle subclass representing one park visitor.
 *
 * Wraps the Three.js mesh/mixer/animation-clip plumbing (a skeleton clone of the
 * person's GLB, or of the shared default character) and drives behaviour through
 * a yuka.StateMachine ticked from update(dt) alongside the vehicle's own
 * steering physics.
 *
 * Public fields read by UI code (chatBubbles.js, sleepZs.js, overlay.js,
 * speechBubble.js, picker.js) — kept stable across the yuka rewrite:
 *   mesh              — THREE.Object3D, positioned/rotated each frame from the vehicle
 *   person            — source person-node data (id, name, role, bio, quotes, ...)
 *   state             — string: 'walking' | 'chatting' | 'sitting' (bench) |
 *                       'sittingGround' | 'resting' | 'dancing' | 'greeting'.
 *                       The sit/rest states only report themselves once the agent has
 *                       arrived at its spot; while walking there it reads 'walking' (as it
 *                       does on its way to a gathering). Agents waving at each other read
 *                       'meeting'.
 *   stopped           — true while paused for a UI interaction (greeting/overlay)
 *   gathering         — the chat/dance gathering the agent belongs to, or null
 *   isTalking         — true while in a running conversation
 */

import * as THREE from 'three';
import * as YUKA from 'yuka';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import {
  AGENT_SCALE, AGENT_SPEED, AGENT_SPRINT_SPEED, AGENT_SEP_RADIUS, AGENT_TURN_RATE,
  AGENT_SPEED_JITTER, AGENT_BIAS_RANGE, AGENT_CLIPS, AGENT_WALK_TIMESCALE, AGENT_SLOPE,
} from '@/config.js';
import { stripRootMotion } from '@/assets/rootMotion.js';
import { getTerrainHeight } from '@/world/terrain.js';
import { WalkingState } from './states/WalkingState.js';
import { ChattingState } from './states/ChattingState.js';
import { SittingOnBenchState } from './states/SittingOnBenchState.js';
import { SittingOnGroundState } from './states/SittingOnGroundState.js';
import { RestingOnGrassState } from './states/RestingOnGrassState.js';
import { DancingState } from './states/DancingState.js';
import { GatherState } from './states/GatherState.js';
import { MeetingState } from './states/MeetingState.js';

const SEPARATION_WEIGHT = 2;
// States in which the agent is deliberately standing/lying/sitting still: no separation push.
const STANDING_STATES = new Set(['chatting', 'dancing', 'sitting', 'sittingGround', 'resting', 'meeting']);

export class AgentEntity extends YUKA.Vehicle {
  /** Standing, sitting or lying on purpose: other agents give way instead of pushing. */
  get holdsPosition() { return this.gatherArrived || STANDING_STATES.has(this.state); }

  constructor(scene, person, assetLibrary, { navGraph, pathSegments, rand, onArrivedAtAttraction, getAllAgents, getNight, gatherings } = {}) {
    super();

    this.person       = person;
    this.state        = 'walking';
    this.stopped      = false;
    this.walkingToAttraction = null;
    this.animTime     = 0;
    this.rand         = rand ?? Math.random;

    // Each agent walks a little faster or slower than the base pace, and has its own
    // tastes (a multiplier on every idle activity's weight), so the crowd doesn't look cloned.
    const speedK = 1 + (this.rand() * 2 - 1) * AGENT_SPEED_JITTER;
    this.maxSpeed     = AGENT_SPEED * speedK;
    this._baseSpeed   = AGENT_SPEED * speedK;
    this._sprintSpeed = AGENT_SPRINT_SPEED * speedK;
    const [bLo, bHi] = AGENT_BIAS_RANGE;
    const bias = () => bLo + this.rand() * (bHi - bLo);
    this.idleBias = { bench: bias(), ground: bias(), rest: bias(), dance: bias() };

    // Chatting and dancing happen in gatherings (gatherings.js): the agent walks to a spot,
    // waits for the others, then the activity starts for everyone together.
    this.gatherings     = gatherings ?? null;
    this.gathering      = null;  // the gathering this agent is part of, or null
    this.gatherArrived  = false; // standing at its spot, waiting for the others
    this.gatherPhase    = null;  // 'assembling' | 'activity'
    this.meetCooldown   = 0;     // seconds until this agent may stop to wave at someone again (MeetingState)
    this._getAllAgents  = getAllAgents ?? (() => []);
    this._getNight      = getNight ?? (() => 0);

    // Per-person model from people.csv, else the shared default character.
    let asset = assetLibrary.resolve(`person:${person.id}`);
    if (asset.type !== 'gltf') asset = assetLibrary.resolve('person:default');
    if (asset.type !== 'gltf') throw new Error('AgentEntity: no character model available (person:default failed to load)');

    this.mesh = skeletonClone(asset.scene);
    this.mesh.scale.setScalar(AGENT_SCALE);
    this.mesh.rotation.order = 'YXZ'; // yaw first, then pitch (leaning into slopes) in the agent's own frame
    this._slopeMul = 1; // smoothed speed multiplier from the ground slope
    this._pitch    = 0; // smoothed lean (radians; + = forward)
    this.mesh.castShadow = true;
    this.mesh.traverse(c => { if (c.isMesh) c.castShadow = true; });

    // Play looping clips in place: strip baked-in forward travel (once per asset).
    // Non-looping roles (e.g. Stand-To-Sit) keep their intentional root movement.
    const keepRootMotion = new Set(
      Object.values(AGENT_CLIPS).filter(r => r.once).flatMap(r => [...r.clips, ...(r.fallback ?? [])]),
    );
    stripRootMotion(asset, keepRootMotion);

    this.mixer = new THREE.AnimationMixer(this.mesh);
    this.clips = {};
    this.currentClip = null;
    this.currentRole = null; // the role (idle, walk, dance, …) of the clip now playing
    for (const clip of asset.animations) {
      this.clips[clip.name] = this.mixer.clipAction(clip);
    }
    this._walkClip = null; // chosen on first use so each agent keeps one walking style
    this._groundSpeed = 0; // world units/s the current clip covers per second at timeScale 1 (walk/run)
    this.playRole('idle');

    const spawnU = person.u ?? person.x ?? 0;
    const spawnV = person.v ?? person.y ?? 0;
    this.position.set(spawnU, 0, spawnV);
    this.mesh.position.set(spawnU, getTerrainHeight(spawnU, spawnV), spawnV);
    scene.add(this.mesh);
    this.mesh.userData.agentRef = this;

    // Visual-only offset applied while seated on a bench: raises the mesh onto the seat and
    // nudges it forward of the backrest. It ramps in and out with the sit-down / stand-up
    // animation (see sitDown / standUp), so there is no pop.
    this._sitOffset = null; // { up, forward } | null
    this._sitMode   = 'none'; // 'none' | 'down' | 'seated' | 'up'
    this._sitBlend  = 0;      // 0..1, how much of _sitOffset is applied

    this.setRenderComponent(this.mesh, (entity, renderComponent) => {
      let x = entity.position.x, z = entity.position.z, y = getTerrainHeight(x, z);
      const so = entity._sitOffset;
      if (so) {
        const f = entity._facing ?? 0;
        x += Math.sin(f) * so.forward * entity._sitBlend;
        z += Math.cos(f) * so.forward * entity._sitBlend;
        y += so.up * entity._sitBlend;
      }
      renderComponent.position.set(x, y, z);
      if (entity._facing != null) renderComponent.rotation.y = entity._facing;
      renderComponent.rotation.x = entity._pitch;
    });

    // Separation keeps agents from stacking on top of each other.
    this.updateNeighborhood = true;
    this.neighborhoodRadius = AGENT_SEP_RADIUS;
    this.separation = new YUKA.SeparationBehavior();
    this.separation.weight = SEPARATION_WEIGHT;
    this.steering.add(this.separation);

    this.stateMachine = new YUKA.StateMachine(this);
    this.stateMachine.add('walking', new WalkingState({ navGraph, pathSegments, onArrivedAtAttraction, getAllAgents, getNight }));
    this.stateMachine.add('chatting', new ChattingState());
    this.stateMachine.add('gathering', new GatherState());
    this.stateMachine.add('meeting', new MeetingState());
    this.stateMachine.add('sitting', new SittingOnBenchState());
    this.stateMachine.add('sittingGround', new SittingOnGroundState({ pathSegments }));
    this.stateMachine.add('resting', new RestingOnGrassState({ pathSegments }));
    this.stateMachine.add('dancing', new DancingState());
    this.stateMachine.changeTo('walking');
  }

  /** True while taking part in a running conversation (everyone has arrived and it has started). */
  get isTalking() {
    const g = this.gathering;
    return g !== null && g.kind === 'chat' && g.active && this.gatherPhase === 'activity';
  }

  /** 0 (day) … 1 (night): used to bias what agents do. */
  get night() { return this._getNight(); }

  /** Face a world-space point (u, v) at once — used for greetings and when arriving somewhere. */
  facePoint(u, v) {
    this._facing = Math.atan2(u - this.position.x, v - this.position.z);
  }

  /** Turn smoothly toward a world-space point (call every frame), e.g. to follow a speaker. */
  turnTowards(u, v, delta) {
    const target = Math.atan2(u - this.position.x, v - this.position.z);
    if (this._facing == null) { this._facing = target; return; }
    const diff = Math.atan2(Math.sin(target - this._facing), Math.cos(target - this._facing));
    this._facing += diff * (1 - Math.exp(-AGENT_TURN_RATE * delta));
  }

  /** Name of the clip to play for a role (see AGENT_CLIPS), or null if the model has none. */
  _clipFor(role) {
    const spec = AGENT_CLIPS[role];
    if (!spec) return null;
    if (role === 'walk' && this._walkClip) return this._walkClip;

    const own = spec.clips.filter(n => this.clips[n]);
    let name = own.length ? own[Math.floor(this.rand() * own.length)]
                          : (spec.fallback ?? []).find(n => this.clips[n]) ?? null;
    if (role === 'walk') this._walkClip = name;
    return name;
  }

  /**
   * Play the animation for a role ('idle', 'walk', 'run', 'greet', 'greetBoth', 'dance',
   * 'sitBench', 'sitGround', 'standUp', 'rest'). Silently does nothing if the model has no
   * suitable clip. Looping roles don't restart if already playing, and start at a random
   * point in the cycle so agents sharing a clip aren't in lockstep.
   * @param {string} role
   * @param {{ clip?: string }} [opts] clip — force this clip (e.g. to copy a dance partner's moves)
   */
  playRole(role, opts = {}) {
    const spec = AGENT_CLIPS[role];
    const name = (opts.clip && this.clips[opts.clip]) ? opts.clip : this._clipFor(role);
    if (!name) return;
    const once = !!spec.once;
    if (this.currentClip === name && !once) { this.currentRole = role; return; }

    const next = this.clips[name];
    const prev = this.clips[this.currentClip];
    const duration = next.getClip().duration;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.timeScale = 1;
    if (spec.reverse) {
      next.time = duration;
      next.timeScale = -1;
    } else if (!once) {
      next.time = this.rand() * duration;
    }
    // Walking/running: update() drives the playback rate from the agent's actual speed.
    // Walk clips know the ground speed they covered (measured when root motion was
    // stripped); the run clip has none baked in, so config supplies a nominal one.
    const rootSpeed = next.getClip().userData?.rootSpeed ?? 0;
    this._groundSpeed = role === 'walk' ? rootSpeed * AGENT_SCALE : (spec.groundSpeed ?? 0);
    next.play();
    // No time-warp: it would overwrite the timeScale when the fade ends.
    if (prev && prev !== next) prev.crossFadeTo(next, 0.2, false);
    this.currentClip = name;
    this.currentRole = role;
  }

  /** The clip currently playing, e.g. to have a dance partner copy it. */
  get currentClipName() { return this.currentClip; }

  /** True once a play-once clip (sit down / stand up) has reached its end. */
  clipFinished() {
    const action = this.clips[this.currentClip];
    return !action || action.paused;
  }

  // ── Sitting transitions ────────────────────────────────────────────────────

  /**
   * Sit down: play Stand-To-Sit and (for a bench) lift the mesh onto the seat as the
   * animation progresses. Pass null for sitting on the ground (no lift).
   */
  sitDown(offset) {
    this._sitOffset = offset;
    this._sitMode = 'down';
    this._sitBlend = 0;
    this.playRole('sitGround');
  }

  /** Switch to the seated loop (Sitting-1) once the sit-down has finished. */
  settleSeated() {
    this._sitMode = this._sitOffset ? 'seated' : 'none';
    if (this._sitOffset) this.playRole('sitBench');
  }

  /** Stand up: Stand-To-Sit in reverse, lowering the mesh off the seat as it plays. */
  standUp() {
    this._sitMode = this._sitOffset ? 'up' : 'none';
    this.playRole('standUp');
  }

  /** Drop any sit offset immediately (used when something interrupts a sit). */
  clearSit() {
    this._sitOffset = null;
    this._sitMode = 'none';
    this._sitBlend = 0;
  }

  _updateSitBlend(delta) {
    if (!this._sitOffset) return;
    const action = this.clips[this.currentClip];
    if (this._sitMode === 'down' || this._sitMode === 'up') {
      // Follow the animation: 0 standing … 1 seated.
      const d = action ? action.getClip().duration : 1;
      this._sitBlend = THREE.MathUtils.clamp((action?.time ?? 0) / d, 0, 1);
    } else if (this._sitMode === 'seated') {
      this._sitBlend += (1 - this._sitBlend) * Math.min(1, delta * 10);
    }
  }

  update(delta) {
    this.animTime  += delta;
    this._lastDelta = delta;
    if (this.meetCooldown > 0) this.meetCooldown -= delta;

    // Ground slope along the direction of travel (rise over run; + = uphill): slows the agent
    // going up, speeds it a little going down, and makes it lean into the slope.
    let slope = 0;
    const moveSpeed = this.getSpeed();
    if (!this.stopped && moveSpeed > 0.2) {
      const dx = this.velocity.x / moveSpeed, dz = this.velocity.z / moveSpeed;
      slope = (getTerrainHeight(this.position.x + dx * 1.5, this.position.z + dz * 1.5)
             - getTerrainHeight(this.position.x, this.position.z)) / 1.5;
    }
    const k = Math.min(1, delta * 4);
    const S = AGENT_SLOPE;
    this._slopeMul += (THREE.MathUtils.clamp(1 - S.speedK * slope, S.speedMin, S.speedMax) - this._slopeMul) * k;
    this._pitch += (THREE.MathUtils.clamp(Math.atan(slope) * S.lean, -S.maxLean, S.maxLean) - this._pitch) * k;

    if (!this.stopped) {
      const baseMaxSpeed = this.maxSpeed;
      this.maxSpeed = baseMaxSpeed * this._slopeMul;
      super.update(delta);
      this.maxSpeed = baseMaxSpeed;
      // Face travel direction while actually moving.
      const speed = this.getSpeed ? this.getSpeed() : this.velocity.length();
      if (speed > 0.1) {
        // Turn toward the travel direction instead of snapping to it.
        const target = Math.atan2(this.velocity.x, this.velocity.z);
        if (this._facing == null) {
          this._facing = target;
        } else {
          let diff = target - this._facing;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest way round
          this._facing += diff * (1 - Math.exp(-AGENT_TURN_RATE * delta));
        }
      }
    }

    // Separation keeps walkers from stacking up, but it must not shove people who are standing
    // together on purpose (a conversation ring is closer than the separation radius) or sitting.
    this.separation.weight = this.holdsPosition ? 0 : SEPARATION_WEIGHT;

    // Keep the legs in step with the ground: walk/run clip rate follows actual speed.
    if (this._groundSpeed > 0) {
      const action = this.clips[this.currentClip];
      if (action) {
        action.timeScale = THREE.MathUtils.clamp(
          this.getSpeed() / this._groundSpeed, AGENT_WALK_TIMESCALE.min, AGENT_WALK_TIMESCALE.max);
      }
    }

    this.stateMachine.update();
    this.mixer.update(delta);
    this._updateSitBlend(delta);

    // Render sync (mesh.position/rotation from this.position/_facing) is
    // invoked automatically by YUKA.EntityManager.updateEntity() right after
    // this method returns — the entity must be added to an EntityManager
    // and updated via entityManager.update(dt), not agent.update(dt) directly.
    return this;
  }
}
