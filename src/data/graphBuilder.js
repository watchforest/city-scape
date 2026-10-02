/**
 * Derives a weighted people-connection graph from CSV data.
 * Edge weight = number of shared projects between two people.
 *
 * Returns { nodes: Person[], edges: { source, target, weight }[] }
 * where source/target are person ids.
 *
 * Falls back to empty edges if no CSV data is present.
 */

/**
 * @param {object[]} people
 * @param {object[]} projects   — laid-out ProjectNode[] with layoutU/layoutV
 * @param {function} rand
 */
export function buildGraph(people, projects, rand = Math.random) {
  if (!people.length) return { nodes: [], edges: [] };

  // Build a map: personId -> Set of projectIds, and projectId -> {layoutU, layoutV}
  const membership = new Map();
  const projectPos = new Map();
  for (const person of people) {
    membership.set(person.id, new Set());
  }
  for (const proj of projects) {
    projectPos.set(proj.id, { u: proj.layoutU, v: proj.layoutV });
    const members = (proj.members ?? '').split(';').map(s => s.trim()).filter(Boolean);
    for (const id of members) {
      if (!membership.has(id)) membership.set(id, new Set());
      membership.get(id).add(proj.id);
    }
  }

  // Count shared projects between all pairs
  const edgeMap = new Map();
  const ids = [...membership.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      const setA = membership.get(a);
      const setB = membership.get(b);
      let shared = 0;
      for (const pid of setA) { if (setB.has(pid)) shared++; }
      if (shared > 0) {
        const key = `${a}|${b}`;
        edgeMap.set(key, { source: a, target: b, weight: shared });
      }
    }
  }

  // Enrich people nodes with world positions — spawn near the centroid of the
  // project(s) they belong to, spread on a small circle so individuals are
  // visibly distinct. People with no project fall back to a random park position.
  const nodes = people.map(p => {
    const projIds = [...(membership.get(p.id) ?? [])];
    const positions = projIds.map(id => projectPos.get(id)).filter(Boolean);

    let centerU = 0, centerV = 0;
    if (positions.length > 0) {
      for (const pos of positions) { centerU += pos.u; centerV += pos.v; }
      centerU /= positions.length;
      centerV /= positions.length;
    } else {
      centerU = (rand() - 0.5) * 400;
      centerV = (rand() - 0.5) * 400;
    }

    const angle  = rand() * Math.PI * 2;
    const radius = 12 + rand() * 8;
    return {
      ...p,
      u: centerU + Math.cos(angle) * radius,
      v: centerV + Math.sin(angle) * radius,
    };
  });

  return {
    nodes,
    edges: [...edgeMap.values()],
  };
}
