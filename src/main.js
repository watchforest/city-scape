import * as THREE from 'three';
import {
  SEED, MAX_FPS, SHADOW_UPDATE_EVERY,
  CAM_PERSON_RADIUS, CAM_PERSON_CENTRE, CAM_PERSON_RATIO, CAM_PERSON_LIST_RATIO, CAM_FOLLOW_RATIO,
} from './config.js';
import { mulberry32 } from './utils/prng.js';
import { buildProjectEdges } from './layout/projectLayout.js';
import { buildNavMesh } from './world/NavMesh.js';
import { resolveModelUrl } from './assets/modelUrl.js';
import { assetUrl } from './assets/assetUrl.js';
import { fitParkToNodes, getParkBounds, getParkHalf } from './world/parkBounds.js';
import { bakePathTexture } from './paths/pathTexture.js';
import { computeFootprints } from './attractions/landmarkFit.js';
import { buildAttractionMeshes, animateAttractions } from './attractions/AttractionPlacer.js';
import { registerCircle, rasterizePathMeshes, registry } from './world/obstacleRegistry.js';
import { loadData } from './data/loader.js';
import { buildGraph } from './data/graphBuilder.js';
import { createScene } from './world/scene.js';
import { createCamera } from './world/camera.js';
import { buildGround, updateGroundShade } from './world/ground.js';
import { addContactShade } from './world/groundShade.js';
import { buildSky } from './world/sky.js';
import { registerDecor, collectDecor } from './world/decor.js';
import { buildBirds, buildDucks, updateWildlife } from './world/wildlife.js';
import { setLake, buildWater, updateWater } from './world/lake.js';
import { getTerrainHeight } from './world/terrain.js';
import { buildEnvironment, findLakePosition } from './world/environment.js';
import { buildClouds, updateClouds, cloudState } from './world/clouds.js';
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
import { initLandmarkLabels, toggleLandmarkLabels, updateLandmarkLabels } from './ui/landmarkLabels.js';
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
  const decorManifest = await registerDecor(assetLibrary); // trees, rocks, grass, stumps (see world/decor.js)
  await assetLibrary.preloadAll();
  const decor = collectDecor(assetLibrary, decorManifest);

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

  const { pathMeshes, pathShapes, pathSegments, renderedSegments, navGraph, attractions, plazaRadius } = buildNavMesh(projectNodes, rand, affinityEdges, lakePos, footprints);

  // Rasterize all path meshes into occupancy grid — exact visual surface
  // (includes plaza discs, ribbon paths, junction discs)
  rasterizePathMeshes(pathMeshes, getParkBounds(), 2, 0);

  // ── People graph ──────────────────────────────────────────────────────────
  const { nodes: personNodes } = buildGraph(people, projectNodes, rand);

  // ── Scene + camera ────────────────────────────────────────────────────────
  const { scene, renderer } = createScene();
  if (import.meta.env.DEV) window.__renderer = renderer; // dev only: inspect renderer.info from the console
  const { cam, controls }   = createCamera(renderer);
  const camController       = new CameraController(cam, controls, renderer.domElement);

  // The path meshes only feed the occupancy grid; the paths you see are painted onto the ground
  // from one baked texture, so overlapping paths merge cleanly instead of z-fighting.
  const pathTexture = bakePathTexture(pathShapes, getParkHalf());

  // ── Environment ───────────────────────────────────────────────────────────
  const { lampHeadMat, lampHaloMat } = buildEnvironment(scene, projectNodes, navGraph, rand, renderedSegments, plazaRadius, lakePos, decor);
  for (const a of attractions) addContactShade(a.displayU, a.displayV, a.footprintRadius * 1.35, 0.4); // grounds the landmarks
  buildGround(scene, rand, pathTexture); // bakes the contact shading, so register it first
  buildSky(scene);
  buildWater(scene, getTerrainHeight);
  buildGrass(scene, rand, decor.grass);
  buildClouds(scene, rand);
  buildBirds(scene, rand, decor.bird);
  buildDucks(scene, rand);

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
      frameLandmark(attraction, { zoomOutHere: true });
    }
  );
  if (import.meta.env.DEV) Object.assign(window.__dbg ??= {}, { cam, controls, camController, agentController, scene, attractionMeshes, pathSegments, navGraph, clouds: { update: updateClouds, state: cloudState } }); // dev only: poke at the scene from the console
  agentController.setRand(rand);
  agentController.setCamera(cam);
  agentController.setDismissCallback(() => { camController.zoomOut(); activeAgent = null; });
  // The agent walks on by itself after waving; stop tracking it as the selected agent.
  agentController.setArrivalDoneCallback(agent => { if (activeAgent === agent) activeAgent = null; });
  agentController.setNightFactor(() => dayCycle.night);

  // ── Camera framing ────────────────────────────────────────────────────────
  const _landmarkBounds = new Map();

  /**
   * Fly to a landmark and frame it: look at the middle of its bounding box (so a tall landmark is centred
   * vertically and the camera aims at the real height, not the ground), and stand back far enough to see all of
   * it beside the side panel. The camera ends up in the user's hands to turn around it.
   */
  function frameLandmark(attraction, opts = {}) {
    let b = _landmarkBounds.get(attraction);
    if (!b) {
      const box = new THREE.Box3().setFromObject(attractionMeshes.find(a => a.instance === attraction).group);
      b = { centre: box.getCenter(new THREE.Vector3()), radius: Math.max(box.getSize(new THREE.Vector3()).length() / 2, 6) };
      _landmarkBounds.set(attraction, b);
    }
    const panel = document.getElementById('project-overlay');
    const insetPx = Math.min(panel?.offsetWidth ?? 0, window.innerWidth * 0.4); // the project panel covers the right edge
    camController.zoomTo(b.centre, camController.frameFor(b.radius, { insetPx }), { userOrbit: true, insetPx, ...opts });
  }

  /** The point a person is looked at from: mid-body, at their real height on the terrain. */
  function personFocus(agent) {
    const p = agent.mesh.position;
    return { x: p.x, y: p.y + CAM_PERSON_CENTRE, z: p.z };
  }
  const personFrame = ratio => camController.frameFor(CAM_PERSON_RADIUS, { comfortRatio: ratio });

  // ── UI ────────────────────────────────────────────────────────────────────
  initOverlay(person => {
    const agent = agentController.getAgents().find(a => a.person.id === person.id);
    if (!agent) return;
    hideProjectOverlay();
    _selectAgent(agent);
  });

  initSleepZs(scene);
  initChatBubbles(quotes, cam);

  initSpeechBubble(renderer, cam, (agent, attraction) => {
    activeAgent = agent;
    camController.follow(agent.mesh, personFrame(CAM_FOLLOW_RATIO), CAM_PERSON_CENTRE);
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
      camController.zoomTo(personFocus(agent), personFrame(CAM_PERSON_RATIO));
      showPersonBubble(agent, attractions, _releaseActive);
    },
    (attraction) => {
      hideBubble();
      showProjectOverlay(attraction, personNodes, () => camController.zoomOut());
      frameLandmark(attraction);
    }
  );

  initLandmarkLabels(cam, renderer, attractionMeshes); // L toggles project names over the landmarks
  picker.registerAgents(agentController.getMeshes());
  picker.registerProjects(attractionMeshes.map(am => am.group));

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  window.addEventListener('keydown', e => {
    if (e.key === 't' || e.key === 'T') {
      dayCycle.cyclePreset();
    }
    if (e.key === 'l' || e.key === 'L') {
      toggleLandmarkLabels();
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
  // Dev only: milliseconds of JavaScript per part of the frame, summed since the page loaded (read window.__perf in the
  // console; divide by .frames). The GPU cost is not in here.
  const perf = import.meta.env.DEV ? (window.__perf = { camera: 0, agents: 0, world: 0, ui: 0, render: 0, frames: 0 }) : null;
  let _p0 = 0;
  const mark = perf ? key => { const n = performance.now(); if (key) perf[key] += n - _p0; _p0 = n; } : () => {};
  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    // Frame cap: on a 120 Hz display skip every other callback instead of doing twice the work.
    // (The small slack keeps a 60 Hz display from dropping frames to timer jitter.)
    if (now - lastTime < FRAME_MS - 2) return;
    const dt  = Math.min((now - lastTime) / 1000, 0.1);
    lastTime  = now;

    mark();
    controls.update();
    camController.update(dt);
    mark('camera');
    agentController.update(dt);
    mark('agents');
    updateSleepZs(agentController.getAgents(), dt);
    updateChatBubbles(agentController.getAgents(), dt);
    animateAttractions(attractionMeshes, dt);
    updateGrass(dt);
    updateClouds(dt);
    updateWater(dt);
    updateGroundShade(dt, dayCycle.daylight);
    updateWildlife(dt, dayCycle.daylight);
    dayCycle.update();
    mark('world');
    updateBubblePosition();
    updateLandmarkLabels();
    mark('ui');
    if (frameNo++ % SHADOW_UPDATE_EVERY === 0) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, cam);
    mark('render'); // CPU time to submit the frame; the GPU works on after this
    if (perf) perf.frames++;
  }
  animate();

  function _selectAgent(agent) {
    activeAgent = agent;
    agentController.greetAgent(agent);
    camController.zoomTo(personFocus(agent), personFrame(CAM_PERSON_LIST_RATIO));
    showPersonBubble(agent, attractions, _releaseActive);
  }
}

init().catch(console.error);
