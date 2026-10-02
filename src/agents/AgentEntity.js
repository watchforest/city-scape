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
 *                       arrived at its spot; while walking there it reads 'walking'.
 *   stopped           — true while paused for a UI interaction (greeting/overlay)
 *   chattingWith      — AgentEntity | null
 */

import * as THREE from 'three';
import * as YUKA from 'yuka';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import {
  AGENT_SCALE, AGENT_SPEED, AGENT_SPRINT_SPEED, AGENT_SEP_RADIUS, AGENT_TURN_RATE,
  AGENT_CLIPS, AGENT_WALK_TIMESCALE,
} from '@/config.js';
import { stripRootMotion } from '@/assets/rootMotion.js';
import { getTerrainHeight } from '@/world/terrain.js';
import { WalkingState } from './states/WalkingState.js';
import { ChattingState } from './states/ChattingState.js';
import { SittingOnBenchState } from './states/SittingOnBenchState.js';
import { SittingOnGroundState } from './states/SittingOnGroundState.js';
import { RestingOnGrassState } from './states/RestingOnGrassState.js';
import { DancingState } from './states/DancingState.js';

export class AgentEntity extends YUKA.Vehicle {
  constructor(scene, person, assetLibrary, { navGraph, pathSegments, rand, onArrivedAtAttraction, getAllAgents } = {}) {
    super();

    this.person       = person;
    this.state        = 'walking';
    this.stopped      = false;
    this.chattingWith = null;
    this.walkingToAttraction = null;
    this.animTime     = 0;
    this.rand         = rand ?? Math.random;

    this.maxSpeed = AGENT_SPEED;
    this._baseSpeed   = AGENT_SPEED;
    this._sprintSpeed = AGENT_SPRINT_SPEED;

    // Per-person model from people.csv, else the shared default character.
    let asset = assetLibrary.resolve(`person:${person.id}`);
    if (asset.type !== 'gltf') asset = assetLibrary.resolve('person:default');
    if (asset.type !== 'gltf') throw new Error('AgentEntity: no character model available (person:default failed to load)');

    this.mesh = skeletonClone(asset.scene);
    this.mesh.scale.setScalar(AGENT_SCALE);
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
    for (const clip of asset.animations) {
      this.clips[clip.name] = this.mixer.clipAction(clip);
    }
    this._walkClip = null; // chosen on first use so each agent keeps one walking style
    this._groundSpeed = 0; // world units/s the current clip covers per second at timeScale 1 (walk only)
    this.playRole('idle');

    const spawnU = person.u ?? person.x ?? 0;
    const spawnV = person.v ?? person.y ?? 0;
    this.position.set(spawnU, 0, spawnV);
    this.mesh.position.set(spawnU, getTerrainHeight(spawnU, spawnV), spawnV);
    scene.add(this.mesh);
    this.mesh.userData.agentRef = this;

    // Visual-only offset applied while seated on a bench: raises the mesh onto the
    // seat and nudges it forward of the backrest.
    this._sitOffset = null; // { up, forward } | null

    this.setRenderComponent(this.mesh, (entity, renderComponent) => {
      let x = entity.position.x, z = entity.position.z, y = getTerrainHeight(x, z);
      const so = entity._sitOffset;
      if (so) {
        const f = entity._facing ?? 0;
        x += Math.sin(f) * so.forward;
        z += Math.cos(f) * so.forward;
        y += so.up;
      }
      renderComponent.position.set(x, y, z);
      if (entity._facing != null) renderComponent.rotation.y = entity._facing;
    });

    // Separation keeps agents from stacking on top of each other.
    this.updateNeighborhood = true;
    this.neighborhoodRadius = AGENT_SEP_RADIUS;
    this.separation = new YUKA.SeparationBehavior();
    this.separation.weight = 2;
    this.steering.add(this.separation);

    this.stateMachine = new YUKA.StateMachine(this);
    this.stateMachine.add('walking', new WalkingState({ navGraph, pathSegments, onArrivedAtAttraction, getAllAgents }));
    this.stateMachine.add('chatting', new ChattingState());
    this.stateMachine.add('sitting', new SittingOnBenchState());
    this.stateMachine.add('sittingGround', new SittingOnGroundState({ pathSegments }));
    this.stateMachine.add('resting', new RestingOnGrassState({ pathSegments }));
    this.stateMachine.add('dancing', new DancingState());
    this.stateMachine.changeTo('walking');
  }

  /** Face a world-space point (u, v) — used for greetings and chat facing. */
  facePoint(u, v) {
    this._facing = Math.atan2(u - this.position.x, v - this.position.z);
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
   * Play the animation for a role ('idle', 'walk', 'run', 'greet', 'dance',
   * 'sitBench', 'sitGround', 'rest'). Silently does nothing if the model has no
   * suitable clip. Looping roles don't restart if already playing.
   */
  playRole(role) {
    const name = this._clipFor(role);
    if (!name) return;
    const once = !!AGENT_CLIPS[role].once;
    if (this.currentClip === name && !once) return;

    const next = this.clips[name];
    const prev = this.clips[this.currentClip];
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    // Walking: update() drives the playback rate from the agent's actual speed, using
    // the ground speed the clip originally covered (measured when root motion was
    // stripped). Other clips play at normal speed.
    const rootSpeed = next.getClip().userData?.rootSpeed ?? 0;
    this._groundSpeed = role === 'walk' ? rootSpeed * AGENT_SCALE : 0;
    next.timeScale = 1;
    next.play();
    // No time-warp: it would overwrite the timeScale when the fade ends.
    if (prev && prev !== next) prev.crossFadeTo(next, 0.2, false);
    this.currentClip = name;
  }

  update(delta) {
    this.animTime  += delta;
    this._lastDelta = delta;

    if (!this.stopped) {
      super.update(delta);
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

    // Keep the legs in step with the ground: walk-clip rate follows actual speed.
    if (this._groundSpeed > 0) {
      const action = this.clips[this.currentClip];
      if (action) {
        action.timeScale = THREE.MathUtils.clamp(
          this.getSpeed() / this._groundSpeed, AGENT_WALK_TIMESCALE.min, AGENT_WALK_TIMESCALE.max);
      }
    }

    this.stateMachine.update();
    this.mixer.update(delta);

    // Render sync (mesh.position/rotation from this.position/_facing) is
    // invoked automatically by YUKA.EntityManager.updateEntity() right after
    // this method returns — the entity must be added to an EntityManager
    // and updated via entityManager.update(dt), not agent.update(dt) directly.
    return this;
  }
}
