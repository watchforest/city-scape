import * as THREE from 'three';
import { CLUSTER_PALETTES } from '@/config.js';

/**
 * Themed wireframe landmark per project.
 * Tag → shape mapping:
 *   hci          → spinning rings (interaction loops)
 *   ml / data    → stacked data rings
 *   fabrication  → gantry frame
 *   urban        → arch / gateway
 *   bridge       → double helix coil
 *   (default)    → obelisk
 */

const TAG_PRIORITY = ['hci', 'ml', 'data', 'fabrication', 'urban', 'bridge'];

function primaryTag(tags) {
  const list = (tags ?? '').split(';').map(s => s.trim().toLowerCase());
  for (const t of TAG_PRIORITY) {
    if (list.includes(t)) return t;
  }
  return list[0] ?? 'default';
}

function clusterColor(members) {
  const cluster = members.split(';')[0]?.split('-')[0] ?? 'bridge';
  return CLUSTER_PALETTES[cluster] ?? CLUSTER_PALETTES.bridge;
}

function wire(geom, color) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geom),
    new THREE.LineBasicMaterial({ color })
  );
}

function line(pts, color) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color })
  );
}

// ── Shape builders ────────────────────────────────────────────────────────────

function makeHCI(palette) {
  // Three nested spinning rings on a pedestal
  const g = new THREE.Group();
  g.add(wire(new THREE.BoxGeometry(4, 1, 4), palette.accent)); // base
  for (let i = 0; i < 3; i++) {
    const ring = wire(new THREE.TorusGeometry(3 - i * 0.7, 0.15, 4, 12), palette.primary);
    ring.position.y = 4 + i * 3;
    ring.rotation.x = (i * Math.PI) / 3;
    ring.userData.spinAxis = 'y';
    ring.userData.spinSpeed = 0.4 + i * 0.3;
    g.add(ring);
  }
  return g;
}

function makeML(palette) {
  // Stacked rings growing upward like a data tower
  const g = new THREE.Group();
  g.add(wire(new THREE.BoxGeometry(4, 1, 4), palette.accent));
  const levels = 6;
  for (let i = 0; i < levels; i++) {
    const r = 1.5 + (levels - i) * 0.6;
    const ring = wire(new THREE.CylinderGeometry(r, r, 0.3, 8), palette.primary);
    ring.position.y = 2 + i * 2.5;
    g.add(ring);
  }
  // Vertical spine
  g.add(wire(new THREE.CylinderGeometry(0.2, 0.2, levels * 2.5, 6), palette.accent));
  return g;
}

function makeFabrication(palette) {
  // Gantry frame — two uprights + crossbeam + a hanging carriage
  const g = new THREE.Group();
  const h = 14;
  // Uprights
  for (const sx of [-4, 4]) {
    g.add(wire(new THREE.BoxGeometry(1, h, 1), palette.primary)).position.set(sx, h / 2, 0);
    const u = wire(new THREE.BoxGeometry(1, h, 1), palette.primary);
    u.position.set(sx, h / 2, 0);
    g.add(u);
  }
  // Crossbeam
  const beam = wire(new THREE.BoxGeometry(10, 1, 1), palette.accent);
  beam.position.y = h;
  g.add(beam);
  // Carriage (slides)
  const carriage = wire(new THREE.BoxGeometry(2, 2, 2), palette.accent);
  carriage.position.set(0, h - 1, 0);
  carriage.userData.slideAxis = 'x';
  carriage.userData.slideRange = 3.5;
  carriage.userData.slideSpeed = 1.2;
  g.add(carriage);
  // Base plate
  g.add(wire(new THREE.BoxGeometry(10, 0.5, 4), palette.accent));
  return g;
}

function makeUrban(palette) {
  // Gateway arch
  const g = new THREE.Group();
  const archH = 14, archW = 10;
  // Two pillars
  for (const sx of [-archW / 2, archW / 2]) {
    const pillar = wire(new THREE.BoxGeometry(2, archH, 2), palette.primary);
    pillar.position.set(sx, archH / 2, 0);
    g.add(pillar);
  }
  // Arch top — approximate with a series of short segments
  const segs = 10;
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * Math.PI;
    pts.push(new THREE.Vector3(
      Math.cos(Math.PI - t) * archW / 2,
      archH + Math.sin(t) * 5,
      0
    ));
  }
  g.add(line(pts, palette.accent));
  // Base
  g.add(wire(new THREE.BoxGeometry(archW + 4, 0.5, 4), palette.accent));
  return g;
}

function makeBridge(palette) {
  // Double helix coil
  const g = new THREE.Group();
  g.add(wire(new THREE.BoxGeometry(4, 1, 4), palette.accent));
  const turns = 4, pointsPerTurn = 16, totalH = 18;
  for (const offset of [0, Math.PI]) {
    const pts = [];
    const total = turns * pointsPerTurn;
    for (let i = 0; i <= total; i++) {
      const t = i / total;
      const angle = t * turns * Math.PI * 2 + offset;
      pts.push(new THREE.Vector3(
        Math.cos(angle) * 2.5,
        1 + t * totalH,
        Math.sin(angle) * 2.5
      ));
    }
    g.add(line(pts, palette.primary));
  }
  // Rungs
  const rungs = turns * 4;
  for (let i = 0; i < rungs; i++) {
    const t = i / rungs;
    const angle = t * turns * Math.PI * 2;
    const y = 1 + t * totalH;
    const rungPts = [
      new THREE.Vector3(Math.cos(angle) * 2.5, y, Math.sin(angle) * 2.5),
      new THREE.Vector3(Math.cos(angle + Math.PI) * 2.5, y, Math.sin(angle + Math.PI) * 2.5),
    ];
    g.add(line(rungPts, palette.accent));
  }
  return g;
}

function makeObelisk(palette) {
  const g = new THREE.Group();
  g.add(wire(new THREE.BoxGeometry(5, 1, 5), palette.accent));
  g.add(wire(new THREE.BoxGeometry(3, 16, 3), palette.primary)).position.y = 8.5;
  const shaft = wire(new THREE.BoxGeometry(3, 16, 3), palette.primary);
  shaft.position.y = 8.5;
  g.add(shaft);
  const tip = wire(new THREE.ConeGeometry(2, 5, 4), palette.accent);
  tip.position.y = 18.5;
  g.add(tip);
  return g;
}

// ── Public API ────────────────────────────────────────────────────────────────

const SHAPE_BUILDERS = {
  hci:         makeHCI,
  ml:          makeML,
  data:        makeML,
  fabrication: makeFabrication,
  urban:       makeUrban,
  bridge:      makeBridge,
};

/**
 * Builds and places all project landmark objects in the scene.
 * Returns an array of { mesh, project } for raycasting.
 */
export function placeProjectObjects(scene, projectNodes) {
  const projectMeshes = [];

  for (const proj of projectNodes) {
    const palette = clusterColor(proj.members ?? '');
    const tag = primaryTag(proj.tags);
    const builder = SHAPE_BUILDERS[tag] ?? makeObelisk;
    const group = builder(palette);

    group.position.set(proj.x, 0, proj.y);
    group.userData.project = proj;
    group.userData.isProject = true;

    // Make all children in the group pickable
    group.traverse(child => {
      if (child.isLine || child.isLineSegments) {
        child.userData.project = proj;
        child.userData.isProject = true;
      }
    });

    scene.add(group);
    projectMeshes.push({ group, project: proj });
  }

  return projectMeshes;
}

/**
 * Called each frame — animates spinning/sliding elements.
 */
export function animateProjectObjects(projectMeshes, dt) {
  for (const { group } of projectMeshes) {
    group.traverse(child => {
      if (child.userData.spinAxis) {
        child.rotation[child.userData.spinAxis] += child.userData.spinSpeed * dt;
      }
      if (child.userData.slideAxis) {
        const axis = child.userData.slideAxis;
        const range = child.userData.slideRange;
        const speed = child.userData.slideSpeed;
        if (!child.userData._slideT) child.userData._slideT = 0;
        child.userData._slideT += dt * speed;
        child.position[axis] = Math.sin(child.userData._slideT) * range;
      }
    });
  }
}
