/**
 * Asset registry — the only file that needs editing to add new 3D models.
 *
 * Keys follow the convention:
 *   'attraction:<cluster>' — park attraction per cluster type
 *   'person:default'       — walking agent figure
 *
 * Drop a .glb into public/assets/attractions/<cluster>/attraction.glb and
 * uncomment the relevant line. Missing files fall through to procedural shapes.
 */
export function registerAssets(library) {
  // Attractions — uncomment and add GLBs when ready
  // library.register('attraction:ml',     '/assets/attractions/ml/attraction.glb');
  // library.register('attraction:hci',    '/assets/attractions/hci/attraction.glb');
  // library.register('attraction:fab',    '/assets/attractions/fab/attraction.glb');
  // library.register('attraction:urb',    '/assets/attractions/urb/attraction.glb');
  // library.register('attraction:bridge', '/assets/attractions/bridge/attraction.glb');

  // People
  library.register('person:default', '/assets/models/people/simple_character_with_basic_animations/scene.gltf');
}
