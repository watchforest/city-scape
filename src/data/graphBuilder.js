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
 * districtNodes — DEFAULT_DISTRICTS array, used to assign x/y to each person
 *                 based on their cluster field.
 */
export function buildGraph(people, projects, districtNodes = [], rand = Math.random) {
  if (!people.length) return { nodes: [], edges: [] };

  // Map cluster -> centroid position
  const clusterPos = new Map();
  for (const d of districtNodes) {
    if (!clusterPos.has(d.cluster)) clusterPos.set(d.cluster, { x: d.x, y: d.y });
  }

  // Build a map: personId -> Set of projectIds
  const membership = new Map();
  for (const person of people) {
    membership.set(person.id, new Set());
  }
  for (const proj of projects) {
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

  // Enrich people nodes with world positions — spread within their district
  // so individual people are visibly distinct in the network layer.
  const clusterCount = new Map();
  const nodes = people.map(p => {
    const pos = clusterPos.get(p.cluster) ?? { x: 0, y: 0 };
    const count = clusterCount.get(p.cluster) ?? 0;
    clusterCount.set(p.cluster, count + 1);
    // Arrange in a small circle around the cluster centroid
    const angle = (count / 5) * Math.PI * 2 + rand() * 0.5;
    const radius = 12 + rand() * 8;
    return {
      ...p,
      x: pos.x + Math.cos(angle) * radius,
      y: pos.y + Math.sin(angle) * radius,
    };
  });

  return {
    nodes,
    edges: [...edgeMap.values()],
  };
}
