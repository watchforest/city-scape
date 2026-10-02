/**
 * PathRenderer — converts route control points into Three.js geometry.
 *
 * Responsibilities:
 *   - Sample Catmull-Rom splines from control points
 *   - Create ribbon meshes per edge
 *   - Create plaza disc meshes
 *   - Create small junction discs at transit nodes
 *
 * Returns { meshes: THREE.Mesh[], segments: PathSegment[] }
 * PathSegment = { pts: SamplePoint[] }
 * SamplePoint = { u, v, tu, tv, arc }  (tu/tv = unit tangent)
 */

import * as THREE from 'three';
import { PATH_COLOR } from '@/config.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const PATH_WIDTH       = 8;
const NAV_SAMPLE_STEP  = 6;
const MIN_RIBBON_LEN   = 8;
const PLAZA_SEGMENTS   = 32;
// Parallel-merge tunables
const MERGE_DIST       = PATH_WIDTH * 2.2; // centreline distance to consider "parallel & close"
const MERGE_DOT        = 0.75;             // min |dot product| of tangents to be considered parallel
const MAX_MERGED_WIDTH = PATH_WIDTH * 4;   // cap merged ribbon width

// ── Material ──────────────────────────────────────────────────────────────────

function _mat() {
  return new THREE.MeshLambertMaterial({
    color: PATH_COLOR,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

const PATH_LIFT = 0.04; // just enough to avoid z-fighting with the flat ground beneath

function _discGeo(cu, cv, r) {
  const pos = [cu, PATH_LIFT, cv];
  const idx = [];
  for (let i = 0; i <= PLAZA_SEGMENTS; i++) {
    const a  = (i / PLAZA_SEGMENTS) * Math.PI * 2;
    pos.push(cu + Math.cos(a) * r, PATH_LIFT, cv + Math.sin(a) * r);
  }
  for (let i = 0; i < PLAZA_SEGMENTS; i++) idx.push(0, i+1, i+2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// pts: array of { u, v, tu, tv, width } — width may vary per sample
function _ribbonGeo(pts) {
  const pos = [], idx = [];
  for (const { u, v, tu, tv, width } of pts) {
    const hw  = (width ?? PATH_WIDTH) / 2;
    const lx  = u - tv * hw, lz = v + tu * hw;
    const rx  = u + tv * hw, rz = v - tu * hw;
    pos.push(lx, PATH_LIFT, lz);
    pos.push(rx, PATH_LIFT, rz);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const b = i * 2;
    idx.push(b, b+1, b+2, b+1, b+3, b+2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── Catmull-Rom sampler (UV space) ────────────────────────────────────────────

function _catmullAt(p0, p1, p2, p3, t) {
  const t2 = t*t, t3 = t2*t;
  return {
    u: 0.5*((2*p1.u)+(-p0.u+p2.u)*t+(2*p0.u-5*p1.u+4*p2.u-p3.u)*t2+(-p0.u+3*p1.u-3*p2.u+p3.u)*t3),
    v: 0.5*((2*p1.v)+(-p0.v+p2.v)*t+(2*p0.v-5*p1.v+4*p2.v-p3.v)*t2+(-p0.v+3*p1.v-3*p2.v+p3.v)*t3),
  };
}

function _catmullTanAt(p0, p1, p2, p3, t) {
  const t2 = t*t;
  return {
    u: 0.5*((-p0.u+p2.u)+2*(2*p0.u-5*p1.u+4*p2.u-p3.u)*t+3*(-p0.u+3*p1.u-3*p2.u+p3.u)*t2),
    v: 0.5*((-p0.v+p2.v)+2*(2*p0.v-5*p1.v+4*p2.v-p3.v)*t+3*(-p0.v+3*p1.v-3*p2.v+p3.v)*t2),
  };
}

function _sampleSpline(pts, step) {
  const n = pts.length;
  if (n < 2) return [];
  const RAW = (n - 1) * 80;
  const raw = [];
  for (let s = 0; s <= RAW; s++) {
    const uParam = (s / RAW) * (n - 1);
    const i  = Math.min(Math.floor(uParam), n - 2);
    const t  = uParam - i;
    const p0 = pts[Math.max(i-1, 0)];
    const p1 = pts[i];
    const p2 = pts[Math.min(i+1, n-1)];
    const p3 = pts[Math.min(i+2, n-1)];
    const p  = _catmullAt(p0, p1, p2, p3, t);
    const g  = _catmullTanAt(p0, p1, p2, p3, t);
    const gl = Math.hypot(g.u, g.v) || 1;
    const arc = s === 0 ? 0 : raw[s-1].arc + Math.hypot(p.u - raw[s-1].u, p.v - raw[s-1].v);
    raw.push({ u: p.u, v: p.v, tu: g.u/gl, tv: g.v/gl, arc });
  }
  const result = [];
  let next = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].arc >= next || i === 0 || i === raw.length - 1) {
      result.push(raw[i]);
      next += step;
    }
  }
  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} routes — output of PathRouter.buildRoutes()
 * @param {ProjectNode[]} projectNodes
 * @returns {{ meshes: THREE.Mesh[], segments: PathSegment[] }}
 */
export function renderPaths(routes, projectNodes) {
  const { edges, degree, plazaRadius } = routes;
  const mat = _mat();
  const meshes = [];
  const segments = [];

  // ── Plaza discs ──────────────────────────────────────────────────────────
  for (const proj of projectNodes) {
    const r = plazaRadius.get(proj.id);
    if (!r) continue;
    meshes.push(Object.assign(
      new THREE.Mesh(_discGeo(proj.layoutU, proj.layoutV, r), mat),
      { receiveShadow: true }
    ));
  }

  // ── Junction discs at transit nodes ──────────────────────────────────────
  for (const proj of projectNodes) {
    if ((plazaRadius.get(proj.id) ?? 0) > 0) continue;
    const deg = degree.get(proj.id) ?? 0;
    if (deg >= 2) {
      meshes.push(Object.assign(
        new THREE.Mesh(_discGeo(proj.layoutU, proj.layoutV, PATH_WIDTH * 0.5), mat),
        { receiveShadow: true }
      ));
    }
  }

  // ── Sample all edges first ────────────────────────────────────────────────
  const allSampled = [];
  for (const edge of edges) {
    const pts = _sampleSpline(edge.controlPts, NAV_SAMPLE_STEP);
    if (!pts.length || pts[pts.length - 1].arc < MIN_RIBBON_LEN) continue;
    allSampled.push({ edge, pts });
    segments.push({ edgeFromId: edge.fromId, edgeToId: edge.toId, pts });
  }

  // ── Render ribbons with per-point merged width ────────────────────────────
  // For each edge, mark it as "absorbed" if its centreline is fully covered by
  // a wider already-rendered ribbon. Otherwise render it, widening at any point
  // where parallel sibling ribbons run close by.
  const rendered = []; // { pts } of edges whose ribbons have been drawn

  for (const { pts } of allSampled) {
    // Check if this edge is >70% absorbed by already-rendered ribbons
    let absorbed = 0;
    for (const pt of pts) {
      for (const r of rendered) {
        let near = false;
        for (const rp of r.pts) {
          if ((pt.u - rp.u)**2 + (pt.v - rp.v)**2 < (MERGE_DIST * 0.5)**2) {
            if (Math.abs(pt.tu * rp.tu + pt.tv * rp.tv) > MERGE_DOT) { near = true; break; }
          }
        }
        if (near) { absorbed++; break; }
      }
    }
    if (absorbed / pts.length > 0.7) continue; // fully absorbed — skip

    // Build per-point widths: for each sample, count parallel siblings nearby
    const widePts = pts.map(pt => {
      let extraWidth = 0;
      for (const { pts: other } of allSampled) {
        if (other === pts) continue;
        for (const op of other) {
          const d2 = (pt.u - op.u)**2 + (pt.v - op.v)**2;
          if (d2 < MERGE_DIST * MERGE_DIST) {
            if (Math.abs(pt.tu * op.tu + pt.tv * op.tv) > MERGE_DOT) {
              extraWidth += PATH_WIDTH;
              break; // one contribution per sibling edge
            }
          }
        }
      }
      return { ...pt, width: Math.min(PATH_WIDTH + extraWidth, MAX_MERGED_WIDTH) };
    });

    meshes.push(Object.assign(
      new THREE.Mesh(_ribbonGeo(widePts), mat),
      { receiveShadow: true }
    ));
    rendered.push({ pts, widePts, edgeFromId: allSampled.find(s => s.pts === pts)?.edge.fromId, edgeToId: allSampled.find(s => s.pts === pts)?.edge.toId });
  }

  // renderedSegments: only non-absorbed edges, with per-point actual width.
  // Use these for prop placement so benches/lamps reflect the visual path surface.
  const renderedSegments = rendered.map(r => ({
    edgeFromId: r.edgeFromId,
    edgeToId:   r.edgeToId,
    pts:        r.widePts,  // includes .width per point
  }));

  return { meshes, segments, renderedSegments };
}

export { NAV_SAMPLE_STEP, PATH_WIDTH };
