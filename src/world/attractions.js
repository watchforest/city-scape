/**
 * Attraction objects — one per project, solid THREE.Mesh shapes.
 *
 * Each cluster has a distinct landmark shape:
 *   ml     → stepped pyramid (stacked boxes)
 *   hci    → Ferris wheel (cylinder hub + spokes + torus ring)
 *   fab    → industrial crane (upright + arm + hanging cube)
 *   urb    → gateway arch (2 pillars + torus arc)
 *   bridge → suspension towers + catenary tube
 *   default→ tall box + sphere top
 *
 * CRITICAL: every group AND every descendant Mesh carries
 *   userData.project = proj
 * so picker.js raycaster traversal works correctly.
 */

import * as THREE from 'three';

// Single neutral palette for all attractions — no cluster colouring
const NEUTRAL = { primary: 0xc8a86b, accent: 0xe8d4a0 };

function tagProject(obj, proj) {
  obj.userData.project = proj;
  if (obj.children) {
    for (const child of obj.children) tagProject(child, proj);
  }
}

function mat(color) {
  const m = new THREE.MeshLambertMaterial({ color });
  return m;
}

// ── Shape builders ───────────────────────────────────────────────────────────

function makeML(palette) {
  const group = new THREE.Group();
  const sizes = [[14, 3, 14], [10, 3, 10], [6, 3, 6]];
  let y = 0;
  for (const [w, h, d] of sizes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(palette.primary));
    m.position.y = y + h / 2;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    y += h;
  }
  // Accent sphere on top
  const cap = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), mat(palette.accent));
  cap.position.y = y + 2;
  cap.castShadow = true;
  group.add(cap);
  return group;
}

function makeHCI(palette) {
  const group = new THREE.Group();

  // Hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.5, 8), mat(palette.primary));
  hub.position.y = 12;
  hub.castShadow = true;
  group.add(hub);

  // Ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 0.6, 6, 20), mat(palette.accent));
  ring.position.y = 12;
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = true;
  group.add(ring);

  // Spokes
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 9), mat(palette.primary));
    spoke.position.y = 12;
    spoke.rotation.y = angle;
    spoke.position.x = Math.cos(angle) * 4.5;
    spoke.position.z = Math.sin(angle) * 4.5;
    spoke.castShadow = true;
    group.add(spoke);
  }

  // Support pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 12, 6), mat(palette.primary));
  pole.position.y = 6;
  pole.castShadow = true;
  group.add(pole);

  return group;
}

function makeFab(palette) {
  const group = new THREE.Group();

  // Upright column
  const col = new THREE.Mesh(new THREE.BoxGeometry(2, 18, 2), mat(palette.primary));
  col.position.y = 9;
  col.castShadow = true;
  group.add(col);

  // Horizontal arm
  const arm = new THREE.Mesh(new THREE.BoxGeometry(14, 1.5, 1.5), mat(palette.primary));
  arm.position.set(6, 18, 0);
  arm.castShadow = true;
  group.add(arm);

  // Counter-arm
  const counter = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 1), mat(palette.accent));
  counter.position.set(-3.5, 18, 0);
  counter.castShadow = true;
  group.add(counter);

  // Hanging cable (thin box)
  const cable = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), mat(0x444444));
  cable.position.set(12, 12, 0);
  group.add(cable);

  // Hanging cube
  const hook = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 2.5), mat(palette.accent));
  hook.position.set(12, 9, 0);
  hook.castShadow = true;
  group.add(hook);

  return group;
}

function makeUrb(palette) {
  const group = new THREE.Group();
  const H = 16, W = 3;

  // Left pillar
  const left = new THREE.Mesh(new THREE.BoxGeometry(W, H, W), mat(palette.primary));
  left.position.set(-8, H / 2, 0);
  left.castShadow = true;
  group.add(left);

  // Right pillar
  const right = new THREE.Mesh(new THREE.BoxGeometry(W, H, W), mat(palette.primary));
  right.position.set(8, H / 2, 0);
  right.castShadow = true;
  group.add(right);

  // Arch torus (half-torus)
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(8, 1.2, 6, 16, Math.PI),
    mat(palette.accent)
  );
  arch.position.y = H;
  arch.rotation.z = -Math.PI / 2;
  arch.castShadow = true;
  group.add(arch);

  return group;
}

function makeBridge(palette) {
  const group = new THREE.Group();

  // Two towers
  for (const sx of [-10, 10]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2, 20, 2), mat(palette.primary));
    tower.position.set(sx, 10, 0);
    tower.castShadow = true;
    group.add(tower);

    // Cross-beam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), mat(palette.accent));
    beam.position.set(sx, 18, 0);
    group.add(beam);
  }

  // Deck (road surface)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 4), mat(0x888888));
  deck.position.y = 3;
  group.add(deck);

  // Catenary cable (TubeGeometry)
  const points = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const x = -12 + t * 24;
    const y = 20 - 17 * 4 * t * (1 - t); // parabola dipping from tower tops
    points.push(new THREE.Vector3(x, y, 0));
  }
  const curve  = new THREE.CatmullRomCurve3(points);
  const cable  = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 20, 0.3, 6, false),
    mat(palette.accent)
  );
  group.add(cable);

  return group;
}

function makeDefault(palette) {
  const group = new THREE.Group();
  // Base platform
  const base = new THREE.Mesh(new THREE.BoxGeometry(14, 1.5, 14), mat(0x888888));
  base.position.y = 0.75;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);
  // Tower body
  const body = new THREE.Mesh(new THREE.BoxGeometry(8, 16, 8), mat(palette.primary));
  body.position.y = 9.5;
  body.castShadow = true;
  group.add(body);
  // Sphere cap
  const top  = new THREE.Mesh(new THREE.SphereGeometry(5, 10, 7), mat(palette.accent));
  top.position.y = 20;
  top.castShadow = true;
  group.add(top);
  return group;
}

// Using a single unified landmark shape for all clusters for now
const _builders = {};

// ── Spin/slide animation state keys ─────────────────────────────────────────

function _tagAnimations(group, cluster) {
  if (cluster === 'hci') {
    // The ring and spokes spin around Y
    group.children.forEach(c => { c.userData.spinAxis = 'y'; });
  }
  if (cluster === 'fab') {
    // Hanging cube oscillates
    const cube = group.children.find(c => c.geometry?.type === 'BoxGeometry' && c.position.y === 9);
    if (cube) cube.userData.slideAxis = 'y';
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Place one attraction group per project in the scene.
 *
 * For non-plaza projects the nav node sits on the path beside the landmark.
 * We offset the mesh away from the nav node so it doesn't sit on the ribbon.
 *
 * @param {THREE.Scene}  scene
 * @param {object[]}     projectNodes
 * @param {object}       assetLibrary
 * @param {object}       pathGraph    — { nodeMap } from buildPathNetwork
 * @returns {Array<{ group, project }>}
 */
export function placeAttractions(scene, projectNodes, assetLibrary) {
  const results = [];

  for (const proj of projectNodes) {
    let group;
    const asset = assetLibrary.resolve('attraction:default');
    if (asset && asset.type === 'gltf') {
      group = asset.scene.clone();
    } else {
      group = makeDefault(NEUTRAL);
    }

    const mx = proj.x;
    const my = proj.y;

    group.position.set(mx, 0, my);
    tagProject(group, proj);

    scene.add(group);
    results.push({ group, project: proj });
  }

  return results;
}

/**
 * Animate attraction meshes each frame.
 * @param {Array<{ group, project }>} meshes
 * @param {number} dt
 */
export function animateAttractions(meshes, dt) {
  const t = performance.now() / 1000;
  for (const { group } of meshes) {
    // HCI Ferris wheel: rotate the whole group slowly
    if (group.children.some(c => c.userData.spinAxis)) {
      group.children.forEach(c => {
        if (c.userData.spinAxis === 'y') c.rotation.y += dt * 0.4;
      });
    }
    // FAB crane: swing hanging cube
    group.children.forEach(c => {
      if (c.userData.slideAxis === 'y') {
        c.position.y = 9 + Math.sin(t * 0.8) * 1.5;
      }
    });
  }
}
