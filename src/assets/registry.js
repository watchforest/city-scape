/**
 * Asset registry — default assets only.
 *
 * Keys follow the convention:
 *   'person:default'          — default walking agent figure
 *   'person:<personId>'       — per-person override (registered in main.js from people.csv `model`)
 *   'attraction:<projectId>'  — per-project landmark (registered in main.js from projects.csv `model`)
 */
import { assetUrl } from './assetUrl.js';

export function registerAssets(library) {
  library.register('person:default', assetUrl('assets/models/people/character.glb'));
}
