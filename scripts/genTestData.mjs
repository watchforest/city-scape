// Generates synthetic datasets for trying the park with other data than the real CSVs:
//   node scripts/genTestData.mjs
// writes public/assets/data/_test/<name>/{people,projects}.csv (gitignored); open the app with ?data=<name>.
//
//   tiny    3 projects, 6 people
//   medium  12 projects, 45 people (about the size of a real department)
//   large   36 projects, 160 people
//   huge    80 projects, 400 people
//   odd     edge cases: loners, empty projects, one-person project, unknown clusters, long and unicode text,
//           a missing optional column, people listed in projects but not in people.csv
//   single  one project, one person
//   empty   header rows only

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'data', '_test');

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (cols, rows) => [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n') + '\n';

const FIRST = ['Anna', 'Bo', 'Clara', 'David', 'Eva', 'Frederik', 'Gitte', 'Hans', 'Ida', 'Jonas', 'Karen', 'Lars', 'Mette', 'Nikolaj', 'Ole', 'Pia', 'Rasmus', 'Sofie', 'Thomas', 'Ulla', 'Viktor', 'Wenche', 'Yusuf', 'Zainab'];
const LAST = ['Andersen', 'Berg', 'Christensen', 'Dahl', 'Eriksen', 'Friis', 'Gram', 'Hansen', 'Iversen', 'Jensen', 'Kofoed', 'Larsen', 'Møller', 'Nielsen', 'Olsen', 'Poulsen', 'Rasmussen', 'Sørensen', 'Thomsen', 'Vestergaard'];
const ROLES = ['Professor', 'Associate Professor', 'Assistant Professor', 'Postdoc', 'PhD Student', 'Industrial PhD', 'Research Assistant', 'Division Secretary'];
const CLUSTERS = ['ml', 'hci', 'fab', 'urb', 'bridge'];
const WORDS = ['Digital', 'Urban', 'Open', 'Shared', 'Climate', 'Care', 'Data', 'Mobility', 'Energy', 'Learning', 'Public', 'Infrastructure', 'Futures', 'Commons', 'Sensing', 'Audit', 'Trust', 'Borders', 'Food', 'Water'];
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function make(name, { projects: P, people: N, clusters = CLUSTERS, perProject = [3, 8], loners = 0, emptyProjects = 0, long = false, withQuotes = true }, seed) {
  const rand = rng(seed), pick = a => a[Math.floor(rand() * a.length)];
  const people = [];
  for (let i = 0; i < N; i++) {
    const nm = `${pick(FIRST)} ${pick(LAST)}`;
    people.push({ id: `${slug(nm)}-${i}`, name: nm, cluster: pick(clusters), role: pick(ROLES), bio: i % 9 === 0 ? `Hi! I'm ${nm.split(' ')[0]} and I work on ${pick(WORDS).toLowerCase()} ${pick(WORDS).toLowerCase()}.` : '', quotes: withQuotes && i % 5 === 0 ? 'Is this on the roadmap?;Coffee first, then data' : '' });
  }
  const projects = [];
  for (let j = 0; j < P; j++) {
    const nm = `${pick(WORDS)}${pick(WORDS)}`;
    const size = Math.min(people.length, perProject[0] + Math.floor(rand() * (perProject[1] - perProject[0] + 1)));
    const pool = people.slice(0, Math.max(0, people.length - loners));
    const members = new Set();
    // Mostly one cluster (so there is structure to lay out), now and then someone from outside.
    const home = pick(clusters);
    for (let k = 0; k < size * 4 && members.size < size && pool.length; k++) {
      const c = pick(pool);
      if (c.cluster === home || rand() < 0.25) members.add(c.id);
    }
    projects.push({
      id: `proj-${String(j + 1).padStart(2, '0')}`, name: nm,
      fullname: long && j === 0 ? 'A Very Long Project Title That Goes On And On About Many Things Including Sociotechnical Imaginaries of Digital Public Infrastructure' : `${nm} — ${pick(WORDS)} ${pick(WORDS)}`,
      description: long && j === 0 ? 'Lorem ipsum dolor sit amet. '.repeat(60) : `A synthetic project about ${pick(WORDS).toLowerCase()} and ${pick(WORDS).toLowerCase()}.`,
      tags: `${pick(WORDS).toLowerCase()};${pick(WORDS).toLowerCase()}`, url: '',
      members: j < emptyProjects ? '' : [...members].join(';'), model: '', model_size: '',
    });
  }
  return { people, projects };
}

function write(name, { people, projects }, { peopleCols = ['id', 'name', 'cluster', 'role', 'bio', 'quotes', 'model'] } = {}) {
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'people.csv'), csv(peopleCols, people));
  writeFileSync(join(dir, 'projects.csv'), csv(['id', 'name', 'fullname', 'description', 'tags', 'url', 'members', 'model', 'model_size'], projects));
  console.log(`${name}: ${people.length} people, ${projects.length} projects`);
}

write('tiny', make('tiny', { projects: 3, people: 6, perProject: [2, 4] }, 1));
write('medium', make('medium', { projects: 12, people: 45 }, 2));
write('large', make('large', { projects: 36, people: 160, perProject: [3, 12] }, 3));
write('huge', make('huge', { projects: 80, people: 400, perProject: [3, 14] }, 4));

// Edge cases.
{
  const d = make('odd', { projects: 10, people: 30, loners: 6, emptyProjects: 2, long: true, clusters: [...CLUSTERS, 'zzz-unknown', 'new cluster', ''] }, 5);
  d.people[1].name = 'Zoë Ørsted-Næsgaard 🦆';
  d.people[2].name = 'A Person With An Extraordinarily Long Name That Might Overflow Labels And Bubbles Everywhere';
  d.people[3].bio = 'Bio with "quotes", commas, and a\nnewline.';
  d.projects[3].members = d.people[0].id;                                 // a one-person project
  d.projects[4].members += `;ghost-person;${d.projects[4].members.split(';')[0]}`; // unknown id, duplicate id
  d.projects[5].name = 'Æ Ø Å — ünïcödé';
  write('odd', d, { peopleCols: ['id', 'name', 'cluster', 'role', 'bio'] }); // no quotes / model columns
}
write('single', make('single', { projects: 1, people: 1, perProject: [1, 1] }, 6));
write('empty', { people: [], projects: [] });
