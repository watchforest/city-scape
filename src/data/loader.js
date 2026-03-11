/**
 * Loads people.csv and projects.csv from /assets/data/.
 * Returns { people, projects } as arrays of plain objects.
 * Falls back to empty arrays if files are not found (PoC mode).
 */

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

async function fetchCSV(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return parseCSV(await res.text());
  } catch {
    return [];
  }
}

export async function loadData() {
  const [people, projects] = await Promise.all([
    fetchCSV('/assets/data/people.csv'),
    fetchCSV('/assets/data/projects.csv'),
  ]);
  return { people, projects };
}
