/**
 * Loads people.csv and projects.csv from /assets/data/.
 * Returns { people, projects } as arrays of plain objects.
 * Falls back to empty arrays if files are not found (PoC mode).
 */

function parseCSVLine(line) {
  const values = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // Quoted field — scan for closing quote
      let val = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { val += line[i++]; }
      }
      values.push(val.trim());
      if (line[i] === ',') i++; // skip comma after closing quote
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) { values.push(line.slice(i).trim()); break; }
      values.push(line.slice(i, end).trim());
      i = end + 1;
    }
  }
  return values;
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
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
