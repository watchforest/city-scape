/**
 * Offline layout bake — runs the ForceAtlas2 project layout once and writes
 * static (layoutU, layoutV) coordinates to public/assets/data/layout.json.
 *
 * The app no longer runs this simulation at runtime; it fetches this file
 * and merges the coordinates onto projects by id. Re-run this script (and
 * commit the updated layout.json) whenever projects.csv membership changes
 * enough that the layout should be recomputed.
 *
 * Usage: node scripts/bakeLayout.mjs [--seed=42]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseCSV } from '../src/data/csv.js';
import { layoutProjects } from '../src/layout/projectLayout.js';
import { mulberry32 } from '../src/utils/prng.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'public', 'assets', 'data');

const seedArg = process.argv.find(a => a.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.split('=')[1]) : 42;

function loadCSV(filename) {
  const text = readFileSync(path.join(dataDir, filename), 'utf8');
  return parseCSV(text);
}

const projects = loadCSV('projects.csv');

const rand = mulberry32(seed);
const projectNodes = layoutProjects(projects, rand);

const output = {
  seed,
  generatedAt: new Date().toISOString(),
  projects: projectNodes.map(p => ({
    id: p.id,
    layoutU: p.layoutU,
    layoutV: p.layoutV,
  })),
};

const outPath = path.join(dataDir, 'layout.json');
writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');

console.log(`Baked layout for ${output.projects.length} projects (seed=${seed}) -> ${outPath}`);
