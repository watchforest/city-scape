/**
 * AgentEntity — a yuka.Vehicle subclass representing one park visitor.
 *
 * Wraps the Three.js mesh/mixer/animation-clip plumbing (GLTF skeleton clone,
 * or procedural HumanoidBuilder fallback) and drives behaviour through a
 * yuka.StateMachine ticked from update(dt) alongside the vehicle's own
 * steering physics.
 *
 * Public fields read by UI code (chatBubbles.js, sleepZs.js, overlay.js,
 * speechBubble.js, picker.js) — kept stable across the yuka rewrite:
 *   mesh              — THREE.Object3D, positioned/rotated each frame from the vehicle
 *   person            — source person-node data (id, name, role, bio, quotes, ...)
 *   state             — string, one of 'walking' | 'chatting' | 'sitting' | 'resting'
 *   stopped           — true while paused for a UI interaction (greeting/overlay)
 *   chattingWith      — AgentEntity | null
 */

import * as THREE from 'three';
import * as YUKA from 'yuka';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { DEFAULT_PALETTE, AGENT_SPEED, AGENT_SPRINT_SPEED, AGENT_SEP_RADIUS } from '@/config.js';
import { buildHumanoid, animateHumanoid } from './HumanoidBuilder.js';
import { getTerrainHeight } from '@/world/terrain.js';
import { WalkingState } from './states/WalkingState.js';
import { ChattingState } from './states/ChattingState.js';
import { SittingOnBenchState } from './states/SittingOnBenchState.js';
import { RestingOnGrassState } from './states/RestingOnGrassState.js';

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
    const useGltf = asset.type === 'gltf';
    this.mixer = null;
    this.clips = {};
    this.currentClip = null;

    if (useGltf) {
      this.mesh = skeletonClone(asset.scene);
      this.mesh.scale.setScalar(1.5);
      this.mesh.castShadow = true;
      this.mesh.traverse(c => { if (c.isMesh) c.castShadow = true; });

      this.mixer = new THREE.AnimationMixer(this.mesh);
      for (const clip of asset.animations) {
        this.clips[clip.name] = this.mixer.clipAction(clip);
      }
      this._playClip('idle');
    } else {
      this.mesh = buildHumanoid(DEFAULT_PALETTE);
    }

    const spawnU = person.u ?? person.x ?? 0;
    const spawnV = person.v ?? person.y ?? 0;
    this.position.set(spawnU, 0, spawnV);
    this.mesh.position.set(spawnU, getTerrainHeight(spawnU, spawnV), spawnV);
    scene.add(this.mesh);
    this.mesh.userData.agentRef = this;

    // Visual-only offset applied while seated (no sit animation yet): raises
    // the mesh onto the seat and nudges it forward of the backrest.
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
    this.stateMachine.add('resting', new RestingOnGrassState());
    this.stateMachine.changeTo('walking');
  }

  /** Face a world-space point (u, v) — used for greetings and chat facing. */
  facePoint(u, v) {
    this._facing = Math.atan2(u - this.position.x, v - this.position.z);
  }

  _playClip(name) {
    const next = this.clips[name];
    if (!next || this.currentClip === name) return;
    const prev = this.clips[this.currentClip];
    if (prev) { next.reset().play(); prev.crossFadeTo(next, 0.2, true); }
    else { next.reset().play(); }
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
        this._facing = Math.atan2(this.velocity.x, this.velocity.z);
      }
    }

    this.stateMachine.update();

    if (this.mixer) {
      this.mixer.update(delta);
    } else {
      animateHumanoid(this.mesh, this.state, this.animTime);
    }

    // Render sync (mesh.position/rotation from this.position/_facing) is
    // invoked automatically by YUKA.EntityManager.updateEntity() right after
    // this method returns — the entity must be added to an EntityManager
    // and updated via entityManager.update(dt), not agent.update(dt) directly.
    return this;
  }
}
