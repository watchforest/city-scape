import {
  SEED, MAX_FPS, SHADOW_UPDATE_EVERY, CAM_FRAME_PERSON, CAM_FRAME_PERSON_FROM_LIST,
  CAM_FRAME_LANDMARK_PER_RADIUS, CAM_FRAME_LANDMARK_MIN,
} from './config.js';
import { mulberry32 } from './utils/prng.js';
import { buildProjectEdges } from './layout/projectLayout.js';
import { buildNavMesh } from './world/NavMesh.js';
import { resolveModelUrl } from './assets/modelUrl.js';
import { assetUrl } from './assets/assetUrl.js';
import { fitParkToNodes, getParkBounds } from './world/parkBounds.js';
import { computeFootprints } from './attractions/landmarkFit.js';
import { buildAttractionMeshes, animateAttractions } from './attractions/AttractionPlacer.js';
import { registerCircle, rasterizePathMeshes, registry } from './world/obstacleRegistry.js';
import { loadData } from './data/loader.js';
import { buildGraph } from './data/graphBuilder.js';
import { createScene } from './world/scene.js';
import { createCamera } from './world/camera.js';
import { buildGround } from './world/ground.js';
import { setLake, buildWater, updateWater } from './world/lake.js';
import { getTerrainHeight } from './world/terrain.js';
import { buildEnvironment, findLakePosition } from './world/environment.js';
import { buildClouds, updateClouds } from './world/clouds.js';
import { buildGrass, updateGrass } from './world/grass.js';
import { DayCycle } from './world/dayCycle.js';
import { AssetLibrary } from './assets/AssetLibrary.js';
import { registerAssets } from './assets/registry.js';
import { AgentController } from './agents/AgentController.js';
import { createPicker } from './interaction/picker.js';
import { CameraController } from './interaction/cameraController.js';
import { initOverlay, showProjectOverlay, hideProjectOverlay } from './ui/overlay.js';
import { initSpeechBubble, showPersonBubble, hideBubble, updateBubblePosition } from './ui/speechBubble.js';
import { initSleepZs, updateSleepZs } from './ui/sleepZs.js';
import { initChatBubbles, updateChatBubbles } from './ui/chatBubbles.js';

async function init() {
  const rand = mulberry32(SEED);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { people, projects, quotes } = await loadData();

  // ── Layout — baked offline via `npm run bake-layout` (see scripts/bakeLayout.mjs) ──
  const layoutRes = await fetch(assetUrl('assets/data/layout.json'));
  const layout = layoutRes.ok ? await layoutRes.json() : { projects: [] };
  const layoutById = new Map(layout.projects.map(p => [p.id, p]));
  const projectNodes = projects.map(proj => ({
    ...proj,
    layoutU: layoutById.get(proj.id)?.layoutU ?? 0,
    layoutV: layoutById.get(proj.id)?.layoutV ?? 0,
  }));

  // Project node footprints are covered by the rasterized path grid (plaza discs
  // are included in pathMeshes). No need to register circles here.

  // ── Assets (before the spatial layer: landmark sizes drive plaza sizes) ──
  const assetLibrary = new AssetLibrary();
  registerAssets(assetLibrary);
  // Per-project custom landmark models (optional `model` column in projects.csv).
  // Empty or unloadable paths fall back to the default pavilion.
  // Per-person character models (optional `model` column in people.csv).
  for (const person of people) {
    const url = resolveModelUrl(person.model);
    if (url) assetLibrary.register(`person:${person.id}`, url);
  }
  for (const proj of projects) {
    const url = resolveModelUrl(proj.model);
    if (url) assetLibrary.register(`attraction:${proj.id}`, url);
  }
  await assetLibrary.preloadAll();

  // ── Spatial layer — paths, nav graph, attraction instances ───────────────
  const affinityEdges = buildProjectEdges(projects);

  // Size the park around the layout (re-centres the nodes on the origin). Must
  // run before anything that reads the park bounds: lake, terrain, environment…
  const footprints = computeFootprints(projectNodes, assetLibrary);
  fitParkToNodes(projectNodes, footprints);

  // Find lake position before baking the terrain mask so the lake bed is flat
  const routeSegments = affinityEdges.map(({ i, j }) =>
    [projectNodes[i].layoutU, projectNodes[i].layoutV, projectNodes[j].layoutU, projectNodes[j].layoutV]);
  const lakePos = findLakePosition(projectNodes, routeSegments);
  setLake(lakePos);

  const { pathMeshes, pathSegments, renderedSegments, navGraph, attractions, plazaRadius } = buildNavMesh(projectNodes, rand, affinityEdges, lakePos, footprints);

  // Rasterize all path meshes into occupancy grid — exact visual surface
  // (includes plaza discs, ribbon paths, junction discs)
  rasterizePathMeshes(pathMeshes, getParkBounds(), 2, 0);

  // ── People graph ──────────────────────────────────────────────────────────
  const { nodes: personNodes } = buildGraph(people, projectNodes, rand);

  // ── Scene + camera ────────────────────────────────────────────────────────
  const { scene, renderer } = createScene();
  const { cam, controls }   = createCamera(renderer);
  const camController       = new CameraController(cam, controls);

  for (const mesh of pathMeshes) scene.add(mesh);

  // ── Environment ───────────────────────────────────────────────────────────
  const { lampHeadMat, lampHaloMat } = buildEnvironment(scene, projectNodes, navGraph, rand, renderedSegments, plazaRadius, lakePos);
  buildGround(scene, rand);
  buildWater(scene, getTerrainHeight);
  buildGrass(scene, rand);
  buildClouds(scene, rand);

  // ── Day/night cycle ───────────────────────────────────────────────────────
  const dayCycle = new DayCycle(scene);
  dayCycle.setLampMaterials(lampHeadMat, lampHaloMat);

  // ── Attractions ───────────────────────────────────────────────────────────
  const attractionMeshes = buildAttractionMeshes(scene, attractions, assetLibrary);

  // ── Agents ────────────────────────────────────────────────────────────────
  let activeAgent = null;

  const agentController = new AgentController(
    scene, navGraph, personNodes, attractions, assetLibrary, pathSegments,
    (agent, attraction) => {
      // The agent led us here: select the landmark immediately (the agent keeps
      // waving) and frame the landmark itself. Closing zooms out from the landmark
      // rather than flying back to wherever the agent was first selected.
      showProjectOverlay(attraction, personNodes, () => camController.zoomOut());
      camController.zoomTo(
        { x: attraction.displayU, y: 0, z: attraction.displayV },
        landmarkFrameDistance(attraction),
        { zoomOutHere: true },
      );
    }
  );
  agentController.setRand(rand);
  agentController.setCamera(cam);
  agentController.setDismissCallback(() => { camController.zoomOut(); activeAgent = null; });
  // The agent walks on by itself after waving; stop tracking it as the selected agent.
  agentController.setArrivalDoneCallback(agent => { if (activeAgent === agent) activeAgent = null; });
  agentController.setNightFactor(() => dayCycle.night);

  /** Camera distance that frames a landmark; wider landmarks are framed from further back. */
  function landmarkFrameDistance(attraction) {
    return Math.max(CAM_FRAME_LANDMARK_MIN, attraction.footprintRadius * CAM_FRAME_LANDMARK_PER_RADIUS);
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  initOverlay(person => {
    const agent = agentController.getAgents().find(a => a.person.id === person.id);
    if (!agent) return;
    hideProjectOverlay();
    _selectAgent(agent);
  });

  initSleepZs(scene);
  initChatBubbles(scene, quotes);

  initSpeechBubble(renderer, cam, (agent, attraction) => {
    activeAgent = agent;
    camController.follow(agent.mesh);
    agentController.walkToProject(agent, attraction);
  });

  function _releaseActive() {
    if (activeAgent) { agentController.resumeAgent(activeAgent); activeAgent = null; }
    camController.zoomOut();
  }

  // ── Picker ────────────────────────────────────────────────────────────────
  const picker = createPicker(
    renderer, cam,
    (agent) => {
      if (activeAgent && activeAgent !== agent) agentController.resumeAgent(activeAgent);
      activeAgent = agent;
      agentController.greetAgent(agent);
      camController.zoomTo(agent.mesh.position, CAM_FRAME_PERSON);
      showPersonBubble(agent, attractions, _releaseActive);
    },
    (attraction) => {
      hideBubble();
      showProjectOverlay(attraction, personNodes, () => camController.zoomOut());
      camController.zoomTo({ x: attraction.displayU, y: 0, z: attraction.displayV }, landmarkFrameDistance(attraction));
    }
  );

  picker.registerAgents(agentController.getMeshes());
  picker.registerProjects(attractionMeshes.map(am => am.group));

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  window.addEventListener('keydown', e => {
    if (e.key === 't' || e.key === 'T') {
      dayCycle.cyclePreset();
    }
    if (e.key === 'Escape') {
      hideBubble();
      hideProjectOverlay();
      if (activeAgent) { agentController.resumeAgent(activeAgent); activeAgent = null; }
      camController.zoomOut();
    }
  });

  // ── Animate ───────────────────────────────────────────────────────────────
  let lastTime = performance.now();
  const FRAME_MS = 1000 / MAX_FPS;
  // The shadow map is the biggest remaining per-frame cost and almost everything in it is
  // static, so refresh it only every SHADOW_UPDATE_EVERY frames instead of every frame.
  renderer.shadowMap.autoUpdate = false;
  let frameNo = 0;
  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    // Frame cap: on a 120 Hz display skip every other callback instead of doing twice the work.
    // (The small slack keeps a 60 Hz display from dropping frames to timer jitter.)
    if (now - lastTime < FRAME_MS - 2) return;
    const dt  = Math.min((now - lastTime) / 1000, 0.1);
    lastTime  = now;

    controls.update();
    camController.update(dt);
    agentController.update(dt);
    updateSleepZs(agentController.getAgents(), dt);
    updateChatBubbles(agentController.getAgents(), dt);
    animateAttractions(attractionMeshes, dt);
    updateGrass(dt);
    updateClouds(dt);
    updateWater(dt);
    dayCycle.update();
    updateBubblePosition();
    if (frameNo++ % SHADOW_UPDATE_EVERY === 0) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, cam);
  }
  animate();

  function _selectAgent(agent) {
    activeAgent = agent;
    agentController.greetAgent(agent);
    camController.zoomTo(agent.mesh.position, CAM_FRAME_PERSON_FROM_LIST);
    showPersonBubble(agent, attractions, _releaseActive);
  }
}

init().catch(console.error);
