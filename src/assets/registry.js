/**
 * Asset registry — the only file that needs editing to add new 3D models.
 *
 * Keys follow the convention:
 *   'tower:<cluster>'      — landmark tower per cluster type
 *   'building:small'       — generic small building
 *   'person:default'       — walking agent figure
 *
 * Drop a .glb file into public/assets/models/ and register it here.
 * If a file is missing or fails to load, the wireframe fallback is used automatically.
 */
export function registerAssets(library) {
  // Buildings — uncomment and add paths when GLBs are ready
  // library.register('tower:ml',       '/assets/models/buildings/tower_ml.glb');
  // library.register('tower:hci',      '/assets/models/buildings/tower_hci.glb');
  // library.register('tower:fab',      '/assets/models/buildings/tower_fab.glb');
  // library.register('tower:urb',      '/assets/models/buildings/tower_urb.glb');
  // library.register('tower:bridge',   '/assets/models/buildings/tower_bridge.glb');
  // library.register('building:small', '/assets/models/buildings/small_generic.glb');

  // People
  // library.register('person:default', '/assets/models/people/person_walk.glb');
}
