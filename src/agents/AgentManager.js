import * as THREE from 'three';
import { bfsPath } from './pathfinding.js';
import { wireBox } from '@/buildings/wireframes.js';
import { CLUSTER_PALETTES, AGENT_SPEED } from '@/config.js';

/**
 * Manages one walking agent per real person from the CSV.
 *
 * Agents walk between random road graph intersections.
 * They can be stopped (clicked), then commanded to walk to a project landmark.
 * On arrival at a project, onArrival(agentObj, project) is called.
 */
export class AgentManager {
  constructor(scene, roadGraph, personNodes, projectNodes, assetLibrary, onArrival) {
    this._scene     = scene;
    this._graph     = roadGraph;
    this._rand      = () => Math.random(); // overridden below — kept for safety
    this._agents    = [];
    this._onArrival = onArrival;

    const roadNodeIds = roadGraph.nodes.map(n => n.id);
    if (roadNodeIds.length < 2) return;

    for (const person of personNodes) {
      const palette = CLUSTER_PALETTES[person.cluster] ?? CLUSTER_PALETTES.bridge;
      const mesh = this._makeFigure(palette, assetLibrary);

      // Start near the person's x/y position — snap to nearest road node
      const startId = _nearestNode(roadGraph, person.x, person.y);
      const startNode = roadGraph.nodeMap.get(startId);
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
        walkingToProject: null,  // project node they're heading to
      };
      mesh.userData.agentRef = agent;
      this._agents.push(agent);
    }
  }

  setRand(rand) { this._rand = rand; }

  /** Returns all agent meshes for raycasting registration. */
  getMeshes() {
    return this._agents.map(a => a.mesh);
  }

  /** Returns all agent objects { mesh, person }. */
  getAgents() { return this._agents; }

  /** Stop an agent in place (on click). Preserves segment state so resume is seamless. */
  stopAgent(agent) {
    agent.stopped = true;
    // Do NOT clear path/segStart/segEnd — we resume mid-segment on release
  }

  /** Resume normal wandering, continuing from exactly where they stopped. */
  resumeAgent(agent) {
    agent.stopped = false;
    agent.walkingToProject = null;
    // If they have no segment (e.g. stopped before first step), anchor to nearest node
    if (!agent.segStart || !agent.segEnd) {
      const pos = agent.mesh.position;
      agent.currentId = _nearestNode(this._graph, pos.x, pos.z);
      agent.path = [];
      agent.progress = 0;
    }
    // Otherwise they simply resume walking their existing segment on next update tick
  }

  /**
   * Send agent to a project node (world x/y).
   * Finds nearest road node to the project, walks there, then calls onArrival.
   */
  walkToProject(agent, project) {
    agent.stopped = false;
    agent.walkingToProject = project;

    const nearestId = _nearestNode(this._graph, agent.mesh.position.x, agent.mesh.position.z);
    const goalId    = _nearestNode(this._graph, project.x, project.y);

    // Full path from nearest → goal, keep all nodes including nearestId
    const fullPath = bfsPath(this._graph.adjacency, nearestId, goalId);
    // fullPath[0] === nearestId — we use it as segEnd of the first off-road segment
    // then _stepAgent will shift it off and set currentId correctly from there

    agent.progress = 0;
    agent.path     = fullPath; // includes nearestId as first element

    // First segment: mesh position → nearestNode (the short off-road join)
    const nearestNode = this._graph.nodeMap.get(nearestId);
    agent.segStart = { x: agent.mesh.position.x, y: agent.mesh.position.z };
    agent.segEnd   = { x: nearestNode.x, y: nearestNode.y };
    // currentId stays as whatever it was — _stepAgent will update it on arrival
  }

  update(dt) {
    for (const agent of this._agents) {
      if (agent.stopped) continue;
      this._stepAgent(agent, dt);
    }
  }

  _stepAgent(agent, dt) {
    if (agent.path.length === 0) {
      // If heading to a project and path exhausted → arrived
      if (agent.walkingToProject) {
        const proj = agent.walkingToProject;
        agent.walkingToProject = null;
        agent.stopped = true;
        if (this._onArrival) this._onArrival(agent, proj);
        return;
      }

      // Pick a new random destination
      const ids = this._graph.nodes.map(n => n.id);
      let goalId;
      do { goalId = ids[Math.floor(this._rand() * ids.length)]; }
      while (goalId === agent.currentId);

      agent.path = bfsPath(this._graph.adjacency, agent.currentId, goalId);
      agent.path.shift();
      if (agent.path.length === 0) return;

      const from = this._graph.nodeMap.get(agent.currentId);
      const to   = this._graph.nodeMap.get(agent.path[0]);
      agent.segStart = { x: from.x, y: from.y };
      agent.segEnd   = { x: to.x,   y: to.y };
      agent.progress = 0;
    }

    if (!agent.segStart || !agent.segEnd) return;

    const segLen = Math.hypot(
      agent.segEnd.x - agent.segStart.x,
      agent.segEnd.y - agent.segStart.y
    );
    if (segLen < 0.01) { agent.path.shift(); return; }

    agent.progress += (AGENT_SPEED * dt) / segLen;

    if (agent.progress >= 1) {
      agent.currentId = agent.path.shift();
      agent.progress  = 0;
      if (agent.path.length > 0) {
        const from = this._graph.nodeMap.get(agent.currentId);
        const to   = this._graph.nodeMap.get(agent.path[0]);
        agent.segStart = { x: from.x, y: from.y };
        agent.segEnd   = { x: to.x,   y: to.y };
      }
      const node = this._graph.nodeMap.get(agent.currentId);
      if (node) agent.mesh.position.set(node.x, 0, node.y);
    } else {
      const x = agent.segStart.x + (agent.segEnd.x - agent.segStart.x) * agent.progress;
      const y = agent.segStart.y + (agent.segEnd.y - agent.segStart.y) * agent.progress;
      agent.mesh.position.set(x, 0, y);
      const dx = agent.segEnd.x - agent.segStart.x;
      const dz = agent.segEnd.y - agent.segStart.y;
      agent.mesh.rotation.y = -Math.atan2(dz, dx);
    }
  }

  _makeFigure(palette, assetLibrary) {
    const asset = assetLibrary.resolve('person:default');
    if (asset.type === 'gltf') return asset.scene.clone();

    const group = new THREE.Group();
    const body = wireBox(1.2, 2.0, 0.6, palette.primary);
    body.position.y = 1.0;
    group.add(body);
    const head = wireBox(0.7, 0.7, 0.7, palette.accent);
    head.position.y = 2.35;
    group.add(head);
    return group;
  }
}

function _nearestNode(graph, x, y) {
  let best = null, bestDist = Infinity;
  for (const node of graph.nodes) {
    const d = (node.x - x) ** 2 + (node.y - y) ** 2;
    if (d < bestDist) { bestDist = d; best = node.id; }
  }
  return best;
}
