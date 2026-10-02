/**
 * Loads people.csv, projects.csv and quotes.json from public/assets/data/.
 * Returns { people, projects, quotes }. `quotes` is a map of personId -> string[].
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

export async function loadData() {
  const [people, projects, quotes] = await Promise.all([
    fetchCSV(assetUrl('assets/data/people.csv')),
    fetchCSV(assetUrl('assets/data/projects.csv')),
    fetchJSON(assetUrl('assets/data/quotes.json')),
  ]);
  return { people, projects, quotes };
}
