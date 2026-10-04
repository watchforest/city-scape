/**
 * Loads people.csv, projects.csv and quotes.json from public/assets/data/.
 * Returns { people, projects, quotes }. `quotes` is the shared list of lines anyone can say (quotes.json, a string[]);
 * a person's own lines are the `quotes` column of people.csv (several separated by `;`) and are mixed in with it
 * (see ui/chatBubbles.js).
 * Falls back to empty arrays/objects if files are not found (PoC mode).
 */

import { parseCSV } from './csv.js';
import { assetUrl } from '@/assets/assetUrl.js';

async function fetchCSV(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return parseCSV(await res.text());
  } catch {
    return [];
  }
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * `?data=<name>` loads people.csv / projects.csv from `assets/data/_test/<name>/` instead (see scripts/genTestData.mjs,
 * for trying other datasets); the shared quotes.json is used unless that folder has its own.
 */
export async function loadData() {
  const name = new URLSearchParams(location.search).get('data');
  const dir = name && /^[\w-]+$/.test(name) ? `assets/data/_test/${name}/` : 'assets/data/';
  const [people, projects, ownQuotes] = await Promise.all([
    fetchCSV(assetUrl(`${dir}people.csv`)),
    fetchCSV(assetUrl(`${dir}projects.csv`)),
    dir === 'assets/data/' ? {} : fetchJSON(assetUrl(`${dir}quotes.json`)),
  ]);
  const quotes = Array.isArray(ownQuotes) ? ownQuotes : await fetchJSON(assetUrl('assets/data/quotes.json'));
  return { people, projects, quotes };
}
