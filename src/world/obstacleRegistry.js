/**
 * Shared obstacle registry — single source of truth for all spawners.
 *
 * Two layers:
 *   1. Shape primitives (circle, ellipse) for landmarks, lake, placed props
 *   2. PathGrid — a rasterized occupancy grid built from actual path mesh
 *      triangles. Replaces the old capsule/segment approach so merged/widened
 *      paths are treated as one homogenous surface.
 */

// ── Shape primitives ──────────────────────────────────────────────────────────

export const registry = [];

export function clear() {
  registry.length = 0;
}

export function registerCircle(x, z, r) {
  registry.push({ type: 'circle', x, z, r });
}

export function registerEllipse(x, z, rx, rz) {
  registry.push({ type: 'ellipse', x, z, rx, rz });
}

// ── Path occupancy grid ───────────────────────────────────────────────────────

// Grid state — populated by rasterizePathMeshes(), queried by isOccupied().
let _grid      = null;  // Uint8Array, row-major [col + row * _cols]
let _gridCols  = 0;
let _gridRows  = 0;
let _gridMinX  = 0;
let _gridMinZ  = 0;
let _gridCell  = 1;     // world units per cell

/**
 * Rasterize an array of THREE.Mesh path objects into the occupancy grid.
 * Call once after all path meshes are built, before any prop placement.
 *
 * @param {THREE.Mesh[]} meshes   — path ribbon + plaza meshes
 * @param {number[]}     bounds   — [minX, minZ, maxX, maxZ] world bounds
 * @param {number}       cellSize — world units per grid cell (default 2)
 * @param {number}       margin   — extra cells to mark around each triangle (default 1)
 */
export function rasterizePathMeshes(meshes, bounds, cellSize = 2, margin = 1) {
  const [minX, minZ, maxX, maxZ] = bounds;
  _gridCell = cellSize;
  _gridMinX = minX;
  _gridMinZ = minZ;
  _gridCols = Math.ceil((maxX - minX) / cellSize) + 1;
  _gridRows = Math.ceil((maxZ - minZ) / cellSize) + 1;
  _grid = new Uint8Array(_gridCols * _gridRows);

  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;
    if (!pos) continue;

    const triCount = idx ? idx.count / 3 : pos.count / 3;

    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3)     : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

      // Path geometry is flat at y≈0; use x and z components
      const ax = pos.getX(i0), az = pos.getZ(i0);
      const bx = pos.getX(i1), bz = pos.getZ(i1);
      const cx = pos.getX(i2), cz = pos.getZ(i2);

      _rasterizeTriangle(ax, az, bx, bz, cx, cz, margin);
    }
  }
}

function _rasterizeTriangle(ax, az, bx, bz, cx, cz, margin) {
  // AABB of triangle in grid coords
  const gMinC = Math.max(0, Math.floor((_worldToGridX(Math.min(ax, bx, cx))) - margin));
  const gMaxC = Math.min(_gridCols - 1, Math.ceil((_worldToGridX(Math.max(ax, bx, cx))) + margin));
  const gMinR = Math.max(0, Math.floor((_worldToGridZ(Math.min(az, bz, cz))) - margin));
  const gMaxR = Math.min(_gridRows - 1, Math.ceil((_worldToGridZ(Math.max(az, bz, cz))) + margin));

  for (let r = gMinR; r <= gMaxR; r++) {
    for (let c = gMinC; c <= gMaxC; c++) {
      _grid[c + r * _gridCols] = 1;
    }
  }
}

function _worldToGridX(wx) { return (wx - _gridMinX) / _gridCell; }
function _worldToGridZ(wz) { return (wz - _gridMinZ) / _gridCell; }

/** Returns true if (x, z) falls inside a rasterized path cell. */
function _gridOccupied(x, z) {
  if (!_grid) return false;
  const c = Math.round(_worldToGridX(x));
  const r = Math.round(_worldToGridZ(z));
  if (c < 0 || c >= _gridCols || r < 0 || r >= _gridRows) return false;
  return _grid[c + r * _gridCols] === 1;
}

// ── isOccupied ────────────────────────────────────────────────────────────────

/**
 * Returns true if point (x, z) is inside any registered obstacle or path cell.
 * margin expands circle/ellipse obstacles outward by that many world units.
 * excludeGrid: if true, skip the path grid check (for path-adjacent props like benches).
 */
export function isOccupied(x, z, margin = 0, excludeGrid = false) {
  if (!excludeGrid && _gridOccupied(x, z)) return true;

  for (const o of registry) {
    if (o.type === 'circle') {
      const r = o.r + margin;
      if ((x - o.x) ** 2 + (z - o.z) ** 2 < r * r) return true;
    } else if (o.type === 'ellipse') {
      const rx = o.rx + margin, rz = o.rz + margin;
      if ((x - o.x) ** 2 / (rx * rx) + (z - o.z) ** 2 / (rz * rz) < 1) return true;
    }
  }
  return false;
}
