/**
 * Offline decor bake — splits the model packs in decor_models/ into one small, optimised GLB per
 * model and writes public/assets/models/decor/manifest.json describing them.
 *
 * Each static model (trees, rocks, grass, bench, lamp) is:
 *   - cut out of its pack (one GLB per model, only the materials/textures it uses; a model may have
 *     several mesh parts, e.g. the bench's seat, back and legs),
 *   - baked to the origin: world transform applied, centred in X/Z, base on y = 0,
 *   - scaled to its category's size (see CATEGORIES), so the runtime only has to randomise it,
 *   - simplified down to the category's triangle budget (meshopt),
 *   - given a small WebP texture.
 * Skinned, animated models (the birds) are cut apart by armature instead: each bird keeps its own
 * skeleton, mesh and the animation tracks that drive it, and is only turned to face +Z.
 *
 * Re-run after changing the packs or the settings below. The originals stay in decor_models/
 * (untracked, like assets-src/); only the optimised output is committed.
 *
 * Usage: npm run bake-decor
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, textureCompress, transformMesh } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'decor_models');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'models', 'decor');

/**
 * Per category: what the baked models look like.
 *   height  — world height every model is normalised to (trees, grass, lamp), or
 *   length  — world extent along X after rotateY (bench), or
 *   scale   — a fixed scale applied to all models of the category instead (rocks keep their relative sizes)
 *   rotateY — turn the model about Y before anything else (radians), to bring its length along X / its front to +Z
 *   maxTris — triangle budget per model (simplified down to this if above)
 *   texture — texture edge in px (WebP); 0 keeps the material's flat colour (no texture)
 *   flat    — faceted low-poly look: normals are dropped so the mesh can be simplified, and the app shades it flat
 *   baseColorOnly — drop normal / metal-roughness / occlusion maps (the app only uses the colour map)
 *   error   — how far (relative to the model's size) simplification may move the surface; raise it if a model won't reach maxTris
 */
const CATEGORIES = {
  tree:  { height: 11,  maxTris: 700, texture: 256, error: 0.08, flat: true },
  rock:  { scale: 2.6,  maxTris: 120, texture: 256, flat: true },
  grass: { height: 1.3, maxTris: 60,  texture: 0 },
  // Bench: long axis along X, backrest on −Z, seat facing +Z (the model has its length on Z, front on +X).
  bench: { length: 6.1, rotateY: -Math.PI / 2, maxTris: 1000, texture: 512, baseColorOnly: true },
  lamp:  { height: 8.6, maxTris: 1000, texture: 0 }, // not simplified: its 8-triangle glass would not survive
  // From the nature pack (flat-coloured materials, no textures). Its native sizes are used, times `scale`.
  bush:     { scale: 0.9, maxTris: 300, texture: 0, flat: true },
  log:      { scale: 0.9, maxTris: 250, texture: 0, flat: true },   // fallen trunks
  flower:   { scale: 1.3, maxTris: 300, texture: 0, flat: true },
  mushroom: { scale: 1.6, maxTris: 130, texture: 0, flat: true },
  // Flower patches (textured, tiny in the source: ≈ 0.2 wide).
  flowerpatch: { scale: 8, maxTris: 400, texture: 256 },
  // A single football and a single goal in the park, so they can afford to be detailed.
  ball: { height: 1.0, maxTris: 700, texture: 256, baseColorOnly: true, error: 0.04 },
  goal: { height: 6.0, maxTris: 1e9, texture: 0 },                  // frame + net, 21k triangles for the one goal
};

/** Static models: which mesh nodes of which pack make up which model (null = skip). */
function staticModels(file, doc) {
  const meshNodes = doc.getRoot().listNodes().filter(n => n.getMesh());
  const models = [];

  if (file.includes('trees') || file.includes('rocks') || file.includes('grass')) {
    // Packs: every mesh node is a model of its own.
    for (const n of meshNodes) {
      const name = n.getName();
      let category = null;
      if (file.includes('trees')) {
        // Deliberately left out: the dead (bare) tree `_11_tree` and the tree stump `_12_tree` — the park should look alive.
        if (/^_1[12]_tree/.test(name)) category = null;
        else if (/^Rock_/.test(name)) category = 'rock';
        else if (/_tree/.test(name)) category = 'tree';
      } else if (file.includes('rocks') && /^SM_Rocks_/.test(name)) category = 'rock';
      else if (file.includes('grass') && /^Circle/.test(name)) category = 'grass';
      if (category) models.push({ id: modelId(file, category, name), category, nodes: [n] });
      else console.log(`skip   ${file} / ${name}`);
    }
  } else if (file.includes('nature')) {
    models.push(...natureModels(meshNodes));
  } else if (file.includes('flowers')) {
    // Flower patches. (The loose leaves, layers and stem in the file are only parts of other flowers.)
    models.push(...groupModels(meshNodes, /^(Yellow Flower Patch|Dandelion Patch|Dandelions|Yellow Flowers|Dandelion)$/, 'flowerpatch', 'flowerpatch'));
  } else if (file.includes('football')) {
    models.push({ id: 'ball_01', category: 'ball', nodes: meshNodes });
  } else if (file.includes('goal')) {
    models.push({ id: 'goal_01', category: 'goal', nodes: meshNodes });
  } else if (file.includes('bench')) {
    models.push({ id: 'bench_01', category: 'bench', nodes: meshNodes });
  } else if (file.includes('light')) {
    models.push({ id: 'lamp_01', category: 'lamp', nodes: meshNodes });
  }
  return models;
}

/** The named group a mesh node belongs to: its parent (packs from Blender put a named empty above each mesh). */
const groupOf = n => n.getParentNode()?.getName() ?? n.getName();

/**
 * One model per distinct group name matching `re` (in file order), made of all the mesh nodes in that group.
 * `idPrefix` + a running number name them (flower_01, flower_02 …).
 */
function groupModels(meshNodes, re, category, idPrefix, extra = {}) {
  const names = [...new Set(meshNodes.map(groupOf))].filter(g => re.test(g));
  return names.map((g, i) => ({
    id: `${idPrefix}_${String(i + 1).padStart(2, '0')}`, category,
    nodes: meshNodes.filter(n => groupOf(n) === g), ...extra,
  }));
}

/**
 * The low-poly nature pack: five trees (trunk + branches + leaves are separate meshes), three fallen
 * trunks, six rocks, bushes, flowers and mushrooms. The terrain tile and the grass tufts are not used.
 * Tree 3 is a pine, 4 a birch, 5 an oak, 1 and 2 other broadleaf trees (see DECOR_TREE_FAMILIES in config.js).
 */
function natureModels(meshNodes) {
  const models = [];
  for (let t = 1; t <= 5; t++) {
    const parts = meshNodes.filter(n => new RegExp(`^(Tronco|Ramas|Hojas)${t}_\\d+$`).test(groupOf(n)));
    if (parts.length) models.push({ id: `tree_n${t}`, category: 'tree', nodes: parts });
    // (The pack's stumps, `Tronco<t>.001`, are left out on purpose: the park should look alive.)
  }
  models.push(...groupModels(meshNodes, /^Cylinder(\.\d+)?_\d+$/, 'log', 'log'));
  models.push(...groupModels(meshNodes, /^rock\d_\d+$/, 'rock', 'rock_n', { scale: 1.5 }));   // (bigger than the pack's own scale: the other rocks are ≈ 2.4 across)
  models.push(...groupModels(meshNodes, /^bus[hf]F?\d_\d+$/, 'bush', 'bush'));                 // (the pack misspells one "busfF3")
  models.push(...groupModels(meshNodes, /^Flower\d(VAR)?_\d+$/, 'flower', 'flower'));
  models.push(...groupModels(meshNodes, /^Mushroom\d(VAR)?_\d+$/, 'mushroom', 'mushroom'));
  return models;
}

/** e.g. "_3_tree" → tree_03, "SM_Rocks_07" → rock_07, "Circle.018" → grass_018 (the rock in the trees pack → rock_t01). */
function modelId(file, category, name) {
  const digits = name.match(/\d+/)?.[0] ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const num = digits.length < 2 ? digits.padStart(2, '0') : digits;
  return `${category}_${file.includes('trees') && category === 'rock' ? 't' : ''}${num}`;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

// ── Small column-major 4×4 helpers (no maths dependency) ─────────────────────────
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (A, B) => { const R = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) R[c * 4 + r] += A[i * 4 + r] * B[c * 4 + i]; return R; };
const rotY = a => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
const scaleM = k => [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1];
const moveM = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

function countTris(mesh) {
  let t = 0;
  for (const p of mesh.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return Math.round(t);
}

/** Bounds of a mesh's vertices after transforming them by `W`. */
function boundsOf(mesh, W) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], v = [0, 0, 0];
  for (const p of mesh.listPrimitives()) {
    const a = p.getAttribute('POSITION');
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, v);
      const w = [
        W[0] * v[0] + W[4] * v[1] + W[8]  * v[2] + W[12],
        W[1] * v[0] + W[5] * v[1] + W[9]  * v[2] + W[13],
        W[2] * v[0] + W[6] * v[1] + W[10] * v[2] + W[14],
      ];
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); }
    }
  }
  return { mn, mx };
}

const unionBounds = list => ({
  mn: [0, 1, 2].map(k => Math.min(...list.map(b => b.mn[k]))),
  mx: [0, 1, 2].map(k => Math.max(...list.map(b => b.mx[k]))),
});

const manifest = { generatedAt: new Date().toISOString(), models: [] };
rmSync(OUT, { recursive: true, force: true });

async function writeModel(doc, category, id, extra) {
  const rel = `${category}/${id}.glb`;
  mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
  await io.write(path.join(OUT, rel), doc);
  manifest.models.push({ id, category, file: rel, ...extra });
}

// ── Static models ──────────────────────────────────────────────────────────────────

async function bakeStatic(file, model) {
  const cfg = CATEGORIES[model.category];
  const doc = await io.read(path.join(SRC, file));
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  const root = doc.getRoot();

  // Find this model's nodes in the freshly read document (same names as the listing document).
  const wanted = new Set(model.nodes.map(n => n.getName()));
  const nodes = root.listNodes().filter(n => n.getMesh() && wanted.has(n.getName()));

  // The packs come from FBX, so the parents carry a unit scale and an axis rotation: read each node's
  // world transform before cutting it out of its parents, then bound everything after the model's own rotation.
  const R = rotY(cfg.rotateY ?? 0);
  const parts = nodes.map(n => ({ node: n, mesh: n.getMesh(), W: mul(R, Array.from(n.getWorldMatrix())) }));
  const { mn, mx } = unionBounds(parts.map(p => boundsOf(p.mesh, p.W)));

  // Keep only this model: detach everything else, then prune what is left unused.
  const scene = root.listScenes()[0];
  for (const child of scene.listChildren()) scene.removeChild(child);
  for (const p of parts) {
    p.node.getParentNode()?.removeChild(p.node);
    scene.addChild(p.node);
  }
  const keepNodes = new Set(parts.map(p => p.node)), keepMeshes = new Set(parts.map(p => p.mesh));
  for (const n of root.listNodes()) if (!keepNodes.has(n)) n.dispose();
  for (const m of root.listMeshes()) if (!keepMeshes.has(m)) m.dispose();

  // Bake to the origin: rotation, world transform, centre X/Z, base on y = 0, category scale.
  const k = cfg.height ? cfg.height / (mx[1] - mn[1]) : cfg.length ? cfg.length / (mx[0] - mn[0]) : (model.scale ?? cfg.scale);
  const place = mul(scaleM(k), moveM(-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2));
  for (const p of parts) {
    p.node.setMatrix(IDENTITY);
    transformMesh(p.mesh, mul(place, p.W));
  }

  // Flat-shaded low-poly models give every triangle its own vertices and normals, which leaves the
  // simplifier nothing to collapse. Drop the normals (and the unused lightmap UVs) so vertices weld by
  // position + UV; the runtime shades these flat (`flatShading`) from screen-space derivatives instead.
  for (const p of parts) {
    for (const prim of p.mesh.listPrimitives()) {
      if (cfg.flat) { prim.setAttribute('NORMAL', null); prim.setAttribute('TEXCOORD_1', null); }
      if (cfg.baseColorOnly) prim.setAttribute('TANGENT', null);
    }
  }
  if (cfg.baseColorOnly) {
    for (const m of root.listMaterials()) {
      m.setNormalTexture(null); m.setOcclusionTexture(null); m.setMetallicRoughnessTexture(null); m.setEmissiveTexture(null);
    }
  }

  const before = parts.reduce((t, p) => t + countTris(p.mesh), 0);
  await doc.transform(
    weld(),
    ...(before > cfg.maxTris ? [simplify({ simplifier: MeshoptSimplifier, ratio: cfg.maxTris / before, error: cfg.error ?? 0.03 })] : []),
    dedup(),
    prune(),
    ...(cfg.texture ? [textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.texture, cfg.texture], quality: 80 })] : []),
  );
  const after = parts.reduce((t, p) => t + countTris(p.mesh), 0);

  const b = unionBounds(parts.map(p => boundsOf(p.mesh, IDENTITY)));
  await writeModel(doc, model.category, model.id, {
    tris: after,
    parts: parts.length,
    size: [0, 1, 2].map(i => +(b.mx[i] - b.mn[i]).toFixed(2)),
  });
  console.log(`${model.category.padEnd(5)} ${model.id.padEnd(14)} ${String(before).padStart(5)} → ${String(after).padStart(4)} tris   from ${file}`);
}

// ── Birds (skinned + animated) ─────────────────────────────────────────────────────

/**
 * Cut a skinned, animated pack apart by armature (birds: five; butterfly: one), each keeping its own skeleton, mesh and
 * the animation tracks that drive it.
 *   rotate          turn about Y so the creature faces +Z
 *   scale           uniform scale folded into the armature (the source sizes are not ours)
 *   zeroTranslation move the armature to the origin (the birds are spread out as a flock; the butterfly's parts are
 *                   offset relative to its armature, so it must stay)
 */
async function splitSkinned(file, { category, rotate, scale = 1, zeroTranslation }) {
  const names = (await io.read(path.join(SRC, file))).getRoot().listNodes()
    .filter(n => /^Armature/.test(n.getName()) && !n.getParentNode()?.getName().startsWith('Armature')).map(n => n.getName());

  for (const [i, name] of names.entries()) {
    const doc = await io.read(path.join(SRC, file));
    doc.setLogger(new Logger(Logger.Verbosity.WARN));
    const root = doc.getRoot();
    const armature = root.listNodes().find(n => n.getName() === name);

    // The nodes belonging to this bird (armature, bones, skinned mesh).
    const mine = new Set();
    armature.traverse(n => mine.add(n));

    // Keep only this bird's animation tracks.
    for (const anim of root.listAnimations()) {
      for (const ch of anim.listChannels()) {
        if (mine.has(ch.getTargetNode())) continue;
        const sampler = ch.getSampler();
        anim.removeChannel(ch); ch.dispose();
        if (sampler && !anim.listChannels().some(c => c.getSampler() === sampler)) { anim.removeSampler(sampler); sampler.dispose(); }
      }
    }

    // Out of the flock: the pack's parents carry a unit scale (FBX), so fold their world transform into the
    // armature, then move it to the origin and turn it so the bird flies towards +Z (it models towards −Z).
    const placed = mul(Array.from(armature.getParentNode().getWorldMatrix()), Array.from(armature.getMatrix()));
    if (zeroTranslation) placed[12] = placed[13] = placed[14] = 0;

    const scene = root.listScenes()[0];
    for (const child of scene.listChildren()) scene.removeChild(child);
    armature.getParentNode()?.removeChild(armature);
    scene.addChild(armature);
    for (const n of root.listNodes()) if (!mine.has(n)) n.dispose();
    armature.setMatrix(mul(rotY(rotate), mul(scaleM(scale), placed)));

    await doc.transform(prune());
    const meshes = root.listMeshes();
    const id = `${category}_${String(i + 1).padStart(2, '0')}`;
    const tris = meshes.reduce((t, m) => t + countTris(m), 0);
    await writeModel(doc, category, id, {
      tris, parts: meshes.reduce((t, m) => t + m.listPrimitives().length, 0), skinned: true,
      animations: root.listAnimations().map(a => a.getName()),
    });
    console.log(`${category.padEnd(5)} ${id.padEnd(14)} ${String(tris).padStart(5)} tris   from ${file} (${name})`);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────────

for (const file of readdirSync(SRC).filter(f => f.endsWith('.glb')).sort()) {
  // The birds model towards −Z and are spread out as a flock; the butterfly's head is at its +X end, and ≈ 7 units
  // across in the source (we want ≈ 1.5).
  if (file.includes('bird')) { await splitSkinned(file, { category: 'bird', rotate: Math.PI, zeroTranslation: true }); continue; }
  if (file.includes('butterfly')) { await splitSkinned(file, { category: 'butterfly', rotate: -Math.PI / 2, scale: 0.22, zeroTranslation: false }); continue; }
  const listing = await io.read(path.join(SRC, file));
  for (const model of staticModels(file, listing)) await bakeStatic(file, model);
}

writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${manifest.models.length} models → ${path.relative(process.cwd(), OUT)}`);
