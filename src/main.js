import { SEED, DEFAULT_DISTRICTS, VORONOI_BOUNDS } from './config.js';
import { mulberry32 } from './utils/prng.js';
import { buildVoronoi } from './layout/voronoi.js';
import { runForceLayout, layoutProjects } from './layout/forceLayout.js';
import { loadData } from './data/loader.js';
import { buildGraph } from './data/graphBuilder.js';
import { createScene } from './world/scene.js';
import { createCamera } from './world/camera.js';
import { buildGround } from './world/ground.js';
import { renderDistricts } from './world/districts.js';
import { buildNetworkLayer } from './world/networkLayer.js';
import { placeProjectObjects, animateProjectObjects } from './world/projectObjects.js';
import { AssetLibrary } from './assets/AssetLibrary.js';
import { registerAssets } from './assets/registry.js';
import { placeBuildings } from './buildings/BuildingPlacer.js';
import { buildRoadGraph } from './agents/RoadGraph.js';
import { AgentManager } from './agents/AgentManager.js';
import { createPicker } from './interaction/picker.js';
import { CameraController } from './interaction/cameraController.js';
import { initOverlay, showProjectOverlay, hideProjectOverlay } from './ui/overlay.js';
import { initSpeechBubble, showPersonBubble, hideBubble, updateBubblePosition } from './ui/speechBubble.js';

async function init() {
  const rand = mulberry32(SEED);

  // ── Districts ─────────────────────────────────────────────────────────────
  const nodes = DEFAULT_DISTRICTS.map(d => ({ ...d }));

  // ── Data ──────────────────────────────────────────────────────────────────
  const { people, projects } = await loadData();
  const { nodes: personNodes, edges: personEdges } = buildGraph(people, projects, nodes, rand);

  // ── Force layout ──────────────────────────────────────────────────────────
  runForceLayout(nodes, personEdges, personNodes, VORONOI_BOUNDS);
  const projectNodes = layoutProjects(projects, nodes, VORONOI_BOUNDS, rand);

  // ── Voronoi + road graph ──────────────────────────────────────────────────
  const { cellPolygons, edges: roadEdges, intersections } = buildVoronoi(nodes, VORONOI_BOUNDS);
  const roadGraph = buildRoadGraph(intersections, roadEdges);

  // ── Scene + camera ────────────────────────────────────────────────────────
  const { scene, renderer } = createScene();
  const { cam, controls }   = createCamera(renderer);
  const camController       = new CameraController(cam, controls);

  buildGround(scene);
  renderDistricts(scene, nodes, cellPolygons, roadEdges);

  // ── Assets ────────────────────────────────────────────────────────────────
  const assetLibrary = new AssetLibrary();
  registerAssets(assetLibrary);
  await assetLibrary.preloadAll();

  // ── Buildings ─────────────────────────────────────────────────────────────
  placeBuildings(scene, nodes, cellPolygons, assetLibrary, rand);

  // ── Project landmarks ─────────────────────────────────────────────────────
  const projectMeshes = placeProjectObjects(scene, projectNodes);

  // ── Agents ────────────────────────────────────────────────────────────────
  let activeAgent = null; // currently stopped/selected agent

  const agentManager = new AgentManager(
    scene, roadGraph, personNodes, projectNodes, assetLibrary,
    (agent, project) => {
      // Arrived at project — show overlay, release on close
      showProjectOverlay(project, personNodes, _releaseActive);
      camController.zoomTo(agent.mesh.position, 4);
    }
  );
  agentManager.setRand(rand);

  // ── Network layer ─────────────────────────────────────────────────────────
  const networkEdges = personEdges.length > 0
    ? personEdges.map(e => ({
        ...e,
        waypoints: [
          [personNodes.find(n => n.id === e.source)?.x ?? 0,
           personNodes.find(n => n.id === e.source)?.y ?? 0],
          [personNodes.find(n => n.id === e.target)?.x ?? 0,
           personNodes.find(n => n.id === e.target)?.y ?? 0],
        ],
      }))
    : [];
  const networkLayer = buildNetworkLayer(scene, personNodes, networkEdges);
  networkLayer.visible = false;

  // ── UI ────────────────────────────────────────────────────────────────────
  initOverlay(person => {
    // Clicked a person name in the project overlay
    const agent = agentManager.getAgents().find(a => a.person.id === person.id);
    if (!agent) return;
    hideProjectOverlay();
    _selectAgent(agent);
  });

  initSpeechBubble(renderer, cam, (agent, project) => {
    // Walk to project — agent is the full AgentManager agent object
    activeAgent = agent;
    camController.follow(agent.mesh);
    agentManager.walkToProject(agent, project);
  });

  function _releaseActive() {
    if (activeAgent) { agentManager.resumeAgent(activeAgent); activeAgent = null; }
    camController.zoomOut();
  }

  // ── Picker ────────────────────────────────────────────────────────────────
  const picker = createPicker(
    renderer, cam,
    // Agent clicked
    (agent) => {
      if (activeAgent && activeAgent !== agent) agentManager.resumeAgent(activeAgent);
      activeAgent = agent;
      agentManager.stopAgent(agent);
      camController.zoomTo(agent.mesh.position, 3.5);
      showPersonBubble(agent, projectNodes, _releaseActive);
    },
    // Project clicked
    (project) => {
      hideBubble();
      showProjectOverlay(project, personNodes, () => camController.zoomOut());
      camController.zoomTo({ x: project.x, y: 0, z: project.y }, 3.5);
    }
  );

  picker.registerAgents(agentManager.getMeshes());
  picker.registerProjects(projectMeshes.map(pm => pm.group));

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  window.addEventListener('keydown', e => {
    if (e.key === 'n' || e.key === 'N') {
      networkLayer.visible = !networkLayer.visible;
    }
    if (e.key === 'Escape') {
      hideBubble();
      hideProjectOverlay();
      if (activeAgent) { agentManager.resumeAgent(activeAgent); activeAgent = null; }
      camController.zoomOut();
    }
  });

  // ── Animate ───────────────────────────────────────────────────────────────
  let lastTime = performance.now();
  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.1);
    lastTime  = now;

    controls.update();
    camController.update(dt);
    agentManager.update(dt);
    animateProjectObjects(projectMeshes, dt);
    updateBubblePosition();
    renderer.render(scene, cam);
  }
  animate();

  function _selectAgent(agent) {
    activeAgent = agent;
    agentManager.stopAgent(agent);
    camController.zoomTo(agent.mesh.position, 3.5);
    showPersonBubble(agent, projectNodes, _releaseActive);
  }
}

init().catch(console.error);
