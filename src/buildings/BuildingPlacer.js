import * as THREE from 'three';
import { centroid, pointInPolygon, polyBounds } from '@/utils/geometry.js';
import { CLUSTER_PALETTES, TOWER_HEIGHTS, BUILDINGS_PER_DISTRICT_MIN, BUILDINGS_PER_DISTRICT_MAX } from '@/config.js';
import { buildTower } from './TowerBuilder.js';
import { wireBox } from './wireframes.js';

export function placeBuildings(scene, nodes, cellPolygons, assetLibrary, rand) {
  for (let i = 0; i < nodes.length; i++) {
    const poly = cellPolygons[i];
    if (!poly) continue;

    const node    = nodes[i];
    const palette = CLUSTER_PALETTES[node.cluster];
    const [cx, cz] = centroid(poly);

    // Landmark tower
    const towerAsset = assetLibrary.resolve(`tower:${node.cluster}`);
    scene.add(buildTower(cx, cz, palette, TOWER_HEIGHTS[i] ?? 40, towerAsset, rand));

    // Small buildings
    const count = BUILDINGS_PER_DISTRICT_MIN + Math.floor(rand() * (BUILDINGS_PER_DISTRICT_MAX - BUILDINGS_PER_DISTRICT_MIN + 1));
    const { minX, maxX, minY, maxY } = polyBounds(poly);

    let placed = 0, attempts = 0;
    while (placed < count && attempts < 200) {
      attempts++;
      const tx = minX + rand() * (maxX - minX);
      const ty = minY + rand() * (maxY - minY);
      if (!pointInPolygon(tx, ty, poly)) continue;
      if ((tx - cx) ** 2 + (ty - cz) ** 2 < 10 * 10) continue;

      const buildingAsset = assetLibrary.resolve('building:small');
      scene.add(_buildSmallBuilding(tx, ty, palette, buildingAsset, rand));
      placed++;
    }
  }
}

function _buildSmallBuilding(cx, cz, palette, asset, rand) {
  if (asset.type === 'gltf') {
    const group = asset.scene.clone();
    group.position.set(cx, 0, cz);
    return group;
  }

  const group = new THREE.Group();
  const w = 5 + rand() * 8;
  const d = 5 + rand() * 8;
  const h = 8 + rand() * 20;

  // Body
  const body = wireBox(w, h, d, palette.primary);
  body.position.y = h / 2;
  group.add(body);

  // Parapet
  const parapet = wireBox(w + 1, 1.2, d + 1, palette.accent);
  parapet.position.y = h + 0.6;
  group.add(parapet);

  // HVAC
  const hvacW = 1.5 + rand() * 2;
  const hvacH = 1.5 + rand() * 2;
  const hvac = wireBox(hvacW, hvacH, hvacW, 0x335544);
  hvac.position.set(
    (rand() - 0.5) * w * 0.4,
    h + 1.2 + hvacH / 2,
    (rand() - 0.5) * d * 0.4
  );
  group.add(hvac);

  // Window bands
  const rows = Math.max(2, Math.floor(h / 5));
  for (let r = 1; r < rows; r++) {
    const wy = r * (h / rows);
    const pts = [
      new THREE.Vector3(-w / 2, wy, d / 2 + 0.05),
      new THREE.Vector3( w / 2, wy, d / 2 + 0.05),
    ];
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: palette.accent })
    ));
  }

  group.position.set(cx, 0, cz);
  return group;
}
