/**
 * Asset registry — default assets only.
 *
 * Keys follow the convention:
 *   'person:default'          — default walking agent figure
 *   'person:<personId>'       — per-person override (registered in main.js from people.csv `model`)
 *   'attraction:<projectId>'  — per-project landmark (registered in main.js from projects.csv `model`)
 */
export function registerAssets(library) {
  library.register('person:default', '/assets/models/people/simple_character_with_basic_animations/scene.gltf');
}
