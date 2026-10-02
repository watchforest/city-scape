/**
 * Minimal CSV parser shared between the browser data loader and Node-side
 * offline scripts (e.g. scripts/bakeLayout.mjs). Pure string parsing, no
 * DOM/fetch — safe to import from either environment.
 */

export function parseCSVLine(line) {
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

export function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}
