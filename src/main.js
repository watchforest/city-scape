import { SEED, PARK_BOUNDS } from './config.js';
import { mulberry32 } from './utils/prng.js';
import { layoutProjectsByAffinity, clusterCentroidsFromProjects } from './layout/projectAffinityLayout.js';
import { buildPathNetwork } from './layout/pathNetwork.js';
import { registerCircle, registry } from './world/obstacleRegistry.js';
import { loadData } from './data/loader.js';
import { buildGraph } from './data/graphBuilder.js';
import { createScene } from './world/scene.js';
import { createCamera } from './world/camera.js';
import { buildGround } from './world/ground.js';
import { buildEnvironment } from './world/environment.js';
import { buildClouds, updateClouds } from './world/clouds.js';
import { DayCycle } from './world/dayCycle.js';
import { placeAttractions, animateAttractions } from './world/attractions.js';
import { AssetLibrary } from './assets/AssetLibrary.js';
import { registerAssets } from './assets/registry.js';
import { AgentManager } from './agents/AgentManager.js';
import { createPicker } from './interaction/picker.js';
import { CameraController } from './interaction/cameraController.js';
import { initOverlay, showProjectOverlay, hideProjectOverlay } from './ui/overlay.js';
import { initSpeechBubble, showPersonBubble, hideBubble, updateBubblePosition } from './ui/speechBubble.js';
import { initSleepZs, updateSleepZs } from './ui/sleepZs.js';

async function init() {
  const rand = mulberry32(SEED);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { people, projects } = await loadData();

  // ── Layout — projects by affinity ─────────────────────────────────────────
  const projectNodes = layoutProjectsByAffinity(projects, people, PARK_BOUNDS, rand);

  // ── Register landmark footprints before building paths/environment ─────────
  for (const p of projectNodes) registerCircle(p.x, p.y, 16);

  // ── Path network ──────────────────────────────────────────────────────────
  const { pathMeshes, pathGraph, pathSegments } = buildPathNetwork(projectNodes, rand);

  // Register path waypoints so trees/grass avoid them
  for (const n of pathGraph.nodes) registerCircle(n.x, n.y, 4);

  // ── Cluster centroids from project layout (for graphBuilder) ───────────────
  const clusterCentroids = clusterCentroidsFromProjects(projectNodes);

  // ── People graph (positions derived from cluster centroids) ───────────────
  const { nodes: personNodes, edges: personEdges } = buildGraph(people, projects, clusterCentroids, rand);

  // ── Scene + camera ────────────────────────────────────────────────────────
  const { scene, renderer } = createScene();
  const { cam, controls }   = createCamera(renderer);
  const camController       = new CameraController(cam, controls);

  // Add path meshes to scene
  for (const mesh of pathMeshes) scene.add(mesh);

  // ── Assets ────────────────────────────────────────────────────────────────
  const assetLibrary = new AssetLibrary();
  registerAssets(assetLibrary);
  await assetLibrary.preloadAll();

  // ── Environment (trees, benches, lampposts, lake) — consumes rand first ──
  const { lampLights } = buildEnvironment(scene, projectNodes, pathGraph, rand, pathSegments);
  buildGround(scene, rand);            // patches after environment, registry excludes lake
  buildClouds(scene, rand);

  // ── Day/night cycle ───────────────────────────────────────────────────────
  const dayCycle = new DayCycle(scene);
  dayCycle.setLampLights(lampLights);

  // ── Attractions ───────────────────────────────────────────────────────────
  const attractionMeshes = placeAttractions(scene, projectNodes, assetLibrary);

  // ── Agents ────────────────────────────────────────────────────────────────
  let activeAgent = null;

  const agentManager = new AgentManager(
    scene, pathGraph, personNodes, projectNodes, assetLibrary,
    (agent, project) => {
      showProjectOverlay(project, personNodes, _releaseActive);
      camController.zoomTo(agent.mesh.position, 4.5);
    }
  );
  agentManager.setRand(rand);
  agentManager.setCamera(cam);
  agentManager.setDismissCallback(() => { camController.zoomOut(); activeAgent = null; });

  // ── UI ────────────────────────────────────────────────────────────────────
  initOverlay(person => {
    const agent = agentManager.getAgents().find(a => a.person.id === person.id);
    if (!agent) return;
    hideProjectOverlay();
    _selectAgent(agent);
  });

  initSleepZs(scene);

  initSpeechBubble(renderer, cam, (agent, project) => {
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
    (agent) => {
      if (activeAgent && activeAgent !== agent) agentManager.resumeAgent(activeAgent);
      activeAgent = agent;
      agentManager.greetAgent(agent);
      camController.zoomTo(agent.mesh.position, 8);
      showPersonBubble(agent, projectNodes, _releaseActive);
    },
    (project) => {
      hideBubble();
      showProjectOverlay(project, personNodes, () => camController.zoomOut());
      camController.zoomTo({ x: project.x, y: 0, z: project.y }, 3.5);
    }
  );

  picker.registerAgents(agentManager.getMeshes());
  picker.registerProjects(attractionMeshes.map(am => am.group));

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  window.addEventListener('keydown', e => {
    if (e.key === 't' || e.key === 'T') {
      dayCycle.cyclePreset(); // cycle dawn→day→dusk→night
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
    updateSleepZs(agentManager.getAgents(), dt);
    animateAttractions(attractionMeshes, dt);
    updateClouds(dt);
    dayCycle.update();
    updateBubblePosition();
    renderer.render(scene, cam);
  }
  animate();

  function _selectAgent(agent) {
    activeAgent = agent;
    agentManager.greetAgent(agent);
    camController.zoomTo(agent.mesh.position, 3.5);
    showPersonBubble(agent, projectNodes, _releaseActive);
  }
}

init().catch(console.error);
