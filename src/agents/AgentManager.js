import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { bfsPath } from './pathfinding.js';
import { buildHumanoid, animateHumanoid } from './HumanoidBuilder.js';
import { selectNextBehaviour } from './AgentStateMachine.js';
import { CLUSTER_PALETTES, AGENT_SPEED, AGENT_SPRINT_SPEED } from '@/config.js';

/**
 * Manages one walking agent per person from the CSV.
 *
 * If the 'person:default' GLTF is loaded it is used (with AnimationMixer);
 * otherwise falls back to the procedural HumanoidBuilder mesh.
 *
 * Extra state: 'greeting' — played when the agent is clicked, facing camera.
 */
export class AgentManager {
  constructor(scene, pathGraph, personNodes, projectNodes, assetLibrary, onArrival) {
    this._scene     = scene;
    this._graph     = pathGraph;
    this._rand      = () => Math.random();
    this._agents    = [];
    this._onArrival = onArrival;
    this._camera    = null; // set via setCamera()

    const nodeIds = pathGraph.nodes.map(n => n.id);
    if (nodeIds.length < 2) return;

    const asset = assetLibrary.resolve('person:default');
    const useGltf = asset.type === 'gltf';

    // Count per cluster so we can spread hues within each cluster
    const clusterCounters = {};

    for (const person of personNodes) {
      const palette = CLUSTER_PALETTES[person.cluster] ?? CLUSTER_PALETTES.bridge;
      clusterCounters[person.cluster] = (clusterCounters[person.cluster] ?? 0) + 1;
      const personColor = _personColor(palette.primary, clusterCounters[person.cluster]);

      let mesh, mixer = null, clips = {};

      if (useGltf) {
        // Clone the GLTF scene — SkeletonUtils.clone re-binds the skeleton correctly
        mesh = skeletonClone(asset.scene);
        _tintGltf(mesh, personColor);

        // Scale down — the model is ~5 units tall in scene units
        mesh.scale.setScalar(1.5);
        mesh.castShadow = true;
        mesh.traverse(c => { if (c.isMesh) c.castShadow = true; });

        mixer = new THREE.AnimationMixer(mesh);
        for (const clip of asset.animations) {
          clips[clip.name] = mixer.clipAction(clip);
        }
        // Start idle
        if (clips.idle) {
          clips.idle.play();
        }
      } else {
        mesh = buildHumanoid(palette);
      }

      const startId   = _nearestNode(pathGraph, person.x, person.y);
      const startNode = pathGraph.nodeMap.get(startId);
      mesh.position.set(startNode.x, 0, startNode.y);
      mesh.userData.agentRef = null; // set below

      scene.add(mesh);

      const agent = {
        mesh,
        person,
        currentId: startId,
        path: [],
        progress: 0,
        segStart: null,
        segEnd: null,
        stopped: false,
        walkingToProject: null,
        // Behaviour fields
        state: 'walking',
        stateTimer: 0,
        animTime: 0,
        chattingWith: null,
        // GLTF animation
        mixer,
        clips,
        currentClip: useGltf ? 'idle' : null,
      };
      mesh.userData.agentRef = agent;
      this._agents.push(agent);

      if (useGltf) _playClip(agent, 'walking');
    }
  }

  setCamera(camera)            { this._camera = camera; }
  setRand(rand)                { this._rand = rand; }
  setDismissCallback(fn)       { this._onDismiss = fn; }

  getMeshes()  { return this._agents.map(a => a.mesh); }
  getAgents()  { return this._agents; }

  stopAgent(agent) {
    agent.stopped = true;
  }

  resumeAgent(agent) {
    agent.stopped          = false;
    agent.walkingToProject = null;
    agent.state            = 'walking';
    agent.chattingWith     = null;
    agent.stateTimer       = 0;
    agent.sprinting        = false;
    if (agent.mixer) { agent.mixer.timeScale = 1; _playClip(agent, 'walking'); }
    if (!agent.segStart || !agent.segEnd) {
      const pos = agent.mesh.position;
      agent.currentId = _nearestNode(this._graph, pos.x, pos.z);
      agent.path = [];
      agent.progress = 0;
    }
  }

  /** Called from picker when agent is clicked. */
  greetAgent(agent) {
    agent.stopped = true;
    agent.state   = 'greeting';
    agent.stateTimer = 3; // seconds — long enough for greeting clip

    // Face camera
    if (this._camera) {
      const cp = this._camera.position;
      const ap = agent.mesh.position;
      agent.mesh.rotation.y = Math.atan2(cp.x - ap.x, cp.z - ap.z);
    }

    if (agent.mixer) {
      _playClip(agent, 'greeting');
    }
  }

  walkToProject(agent, project) {
    agent.stopped = false;
    agent.walkingToProject = project;
    agent.state = 'walking';
    agent.chattingWith = null;
    agent.walkStarted = false;

    const nearestId   = _nearestNode(this._graph, agent.mesh.position.x, agent.mesh.position.z);
    const goalId      = project.id; // resolves to closest on-path node beside the landmark
    const fullPath    = bfsPath(this._graph.adjacency, nearestId, goalId, this._graph.nodeMap);

    // Snap agent to nearest node — eliminates backward-segment artefact
    const nearestNode = this._graph.nodeMap.get(nearestId);
    if (nearestNode) agent.mesh.position.set(nearestNode.x, 0, nearestNode.y);

    agent.currentId = nearestId;
    agent.progress  = 0;
    agent.path      = fullPath;

    // Remove the first node (we're already there) and set the first real segment
    fullPath.shift();
    if (fullPath.length > 0) {
      const to = this._graph.nodeMap.get(fullPath[0]);
      if (to && nearestNode) {
        agent.segStart = { x: nearestNode.x, y: nearestNode.y };
        agent.segEnd   = { x: to.x, y: to.y };
      }
    }

    agent.sprinting = true;
    if (agent.mixer) {
      _playClip(agent, 'walking');
      agent.mixer.timeScale = 3;
    }
  }

  update(dt) {
    for (const agent of this._agents) {
      agent.animTime += dt;
      if (agent.mixer) agent.mixer.update(dt);

      if (agent.stopped) {
        if (agent.state === 'greeting') {
          agent.stateTimer -= dt;
          if (agent.stateTimer <= 0) {
            if (agent.greetingAfterArrival) {
              // Arrived at landmark — walk off and notify
              agent.greetingAfterArrival = false;
              if (this._onDismiss) this._onDismiss(agent);
              this.resumeAgent(agent);
            } else {
              // Manual click greeting — just go idle, stay stopped
              agent.state = 'resting';
              agent.stateTimer = 3;
              if (agent.mixer) _playClip(agent, 'idle');
            }
          }
        }
        continue;
      }

      switch (agent.state) {
        case 'walking':
          this._stepAgent(agent, dt);
          break;

        case 'chatting':
        case 'resting':
        case 'stretching':
          agent.stateTimer -= dt;
          if (agent.state === 'chatting' && agent.chattingWith) {
            const dx = agent.chattingWith.mesh.position.x - agent.mesh.position.x;
            const dz = agent.chattingWith.mesh.position.z - agent.mesh.position.z;
            agent.mesh.rotation.y = Math.atan2(dx, dz);
          }
          if (agent.stateTimer <= 0) {
            this._transitionFromIdle(agent);
          }
          break;
      }

      if (agent.state === 'walking') agent.mesh.rotation.z = 0;

      // Procedural fallback animation
      if (!agent.mixer) {
        animateHumanoid(agent.mesh, agent.state, agent.animTime);
      }
    }
  }

  _transitionFromIdle(agent) {
    agent.chattingWith = null;
    const behaviour = selectNextBehaviour(agent, this._agents, this._rand);
    agent.state    = behaviour.state;

    if (behaviour.state === 'walking') {
      if (agent.mixer) _playClip(agent, 'walking');
      this._startRandomWalk(agent);
    } else {
      agent.stateTimer   = behaviour.duration ?? 5;
      agent.chattingWith = behaviour.partner  ?? null;
      if (agent.mixer) _playClip(agent, 'idle');
    }
  }

  _stepAgent(agent, dt) {
    if (agent.path.length === 0) {
      if (agent.walkingToProject) {
        if (!agent.walkStarted) {
          // Already at destination — defer one tick so walking clip plays briefly
          agent.walkStarted = true;
          return;
        }
        const proj = agent.walkingToProject;
        agent.walkingToProject = null;
        agent.sprinting = false;
        agent.stopped = true;
        agent.state = 'greeting';
        agent.stateTimer = 2.5;
        agent.greetingAfterArrival = true;
        agent.arrivalProject = proj;
        if (agent.mixer) { agent.mixer.timeScale = 1; _playClip(agent, 'greeting'); }
        // Face camera
        if (this._camera) {
          const cp = this._camera.position;
          const ap = agent.mesh.position;
          agent.mesh.rotation.y = Math.atan2(cp.x - ap.x, cp.z - ap.z);
        }
        if (this._onArrival) this._onArrival(agent, proj);
        return;
      }
      const behaviour = selectNextBehaviour(agent, this._agents, this._rand);
      agent.state = behaviour.state;
      if (behaviour.state !== 'walking') {
        agent.stateTimer   = behaviour.duration ?? 5;
        agent.chattingWith = behaviour.partner  ?? null;
        if (agent.mixer) _playClip(agent, 'idle');
        return;
      }
      this._startRandomWalk(agent);
      return;
    }

    if (!agent.segStart || !agent.segEnd) return;

    const segLen = Math.hypot(
      agent.segEnd.x - agent.segStart.x,
      agent.segEnd.y - agent.segStart.y,
    );
    if (segLen < 0.01) { agent.path.shift(); return; }

    const speed = agent.sprinting ? AGENT_SPRINT_SPEED : AGENT_SPEED;
    agent.progress += (speed * dt) / segLen;

    if (agent.progress >= 1) {
      agent.walkStarted = true;
      agent.currentId = agent.path.shift();
      agent.progress  = 0;
      if (agent.path.length > 0) {
        const from = this._graph.nodeMap.get(agent.currentId);
        const to   = this._graph.nodeMap.get(agent.path[0]);
        if (from && to) {
          agent.segStart = { x: from.x, y: from.y };
          agent.segEnd   = { x: to.x,   y: to.y };
        }
      }
      const node = this._graph.nodeMap.get(agent.currentId);
      if (node) agent.mesh.position.set(node.x, 0, node.y);
    } else {
      const x = agent.segStart.x + (agent.segEnd.x - agent.segStart.x) * agent.progress;
      const z = agent.segStart.y + (agent.segEnd.y - agent.segStart.y) * agent.progress;
      agent.mesh.position.set(x, 0, z);
      const dx = agent.segEnd.x - agent.segStart.x;
      const dz = agent.segEnd.y - agent.segStart.y;
      agent.mesh.rotation.y = Math.atan2(dx, dz);
    }
  }

  _startRandomWalk(agent) {
    const ids = this._graph.nodes.map(n => n.id);
    if (ids.length < 2) return;
    let goalId;
    do { goalId = ids[Math.floor(this._rand() * ids.length)]; }
    while (goalId === agent.currentId);

    const path = bfsPath(this._graph.adjacency, agent.currentId, goalId, this._graph.nodeMap);
    path.shift();
    if (path.length === 0) return;

    agent.path = path;
    const from = this._graph.nodeMap.get(agent.currentId);
    const to   = this._graph.nodeMap.get(path[0]);
    if (from && to) {
      agent.segStart = { x: from.x, y: from.y };
      agent.segEnd   = { x: to.x,   y: to.y };
      agent.progress = 0;
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _nearestNode(graph, x, y) {
  let best = null, bestDist = Infinity;
  for (const node of graph.nodes) {
    const d = (node.x - x) ** 2 + (node.y - y) ** 2;
    if (d < bestDist) { bestDist = d; best = node.id; }
  }
  return best;
}

/** Cross-fade to the named clip. */
function _playClip(agent, name) {
  const next = agent.clips[name];
  if (!next || agent.currentClip === name) return;

  const prev = agent.clips[agent.currentClip];
  if (prev) {
    next.reset().play();
    prev.crossFadeTo(next, 0.2, true);
  } else {
    next.reset().play();
  }
  agent.currentClip = name;
}

/**
 * Clone materials and apply a flat color to all meshes in the GLTF clone.
 * Materials must be cloned per-agent so they don't share the same instance.
 */
function _tintGltf(root, color) {
  const c = new THREE.Color(color);
  root.traverse(child => {
    if (!child.isMesh) return;
    if (Array.isArray(child.material)) {
      child.material = child.material.map(m => {
        const clone = m.clone();
        clone.color.set(c);
        return clone;
      });
    } else if (child.material) {
      child.material = child.material.clone();
      child.material.color.set(c);
    }
  });
}

/**
 * Generate a per-person color by rotating the hue of the cluster base color.
 * Each successive person in the same cluster gets a hue shift of ~30°.
 */
function _personColor(baseHex, index) {
  const base = new THREE.Color(baseHex);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  // Shift hue by 30° steps, keep saturation vivid, vary lightness slightly
  hsl.h = (hsl.h + (index - 1) * (30 / 360)) % 1;
  hsl.s = Math.min(1, hsl.s + 0.1);
  hsl.l = 0.45 + ((index - 1) % 3) * 0.07;
  return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
}
