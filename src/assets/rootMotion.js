/**
 * Root-motion removal for character animation clips.
 *
 * Some clips (e.g. Walking, Dancing-2) have the character's root joint travelling
 * forward across the clip, so each loop ends displaced and snaps back — choppy
 * once the agent is moved by the steering system instead. This subtracts the
 * linear horizontal drift from every position track, which makes the clip loop
 * in place while keeping sway and bob (the track still ends where it began).
 *
 * The removed ground speed is stored on `clip.userData.rootSpeed` (units per second
 * in the loaded model's own space, i.e. before any scale applied to the mesh) so
 * playback can be matched to the agent's actual speed.
 */

import * as THREE from 'three';

const MIN_DRIFT = 0.05; // ignore tracks that barely move (track units)

const _processed = new WeakSet();

const _v = new THREE.Vector3();
const _o = new THREE.Vector3();

/** Length, in the model's own space, of a (dx, 0, dz) move made in `node`'s parent space. */
function _worldLength(node, dx, dz) {
  const parent = node?.parent;
  if (!parent) return Math.hypot(dx, dz);
  parent.updateWorldMatrix(true, false);
  _o.set(0, 0, 0).applyMatrix4(parent.matrixWorld);
  return _v.set(dx, 0, dz).applyMatrix4(parent.matrixWorld).sub(_o).length();
}

/**
 * @param {{ scene: THREE.Object3D, animations: THREE.AnimationClip[] }} asset — a loaded glTF
 * @param {Set<string>} [skip] — clip names to leave untouched (non-looping clips
 *   whose root movement is intentional, e.g. Stand-To-Sit)
 */
export function stripRootMotion(asset, skip = new Set()) {
  const clips = asset.animations;
  if (_processed.has(clips)) return;
  _processed.add(clips);

  for (const clip of clips) {
    clip.userData = clip.userData ?? {};
    clip.userData.rootSpeed = 0;
    if (skip.has(clip.name)) continue;

    for (const track of clip.tracks) {
      if (!track.name.endsWith('.position')) continue;
      const t = track.times, v = track.values, n = t.length;
      if (n < 2) continue;

      const dx = v[(n - 1) * 3]     - v[0];
      const dz = v[(n - 1) * 3 + 2] - v[2];
      const drift = Math.hypot(dx, dz);
      if (drift < MIN_DRIFT) continue;

      const span = t[n - 1] - t[0];
      const node = asset.scene.getObjectByName(THREE.PropertyBinding.parseTrackName(track.name).nodeName);
      const speed = _worldLength(node, dx, dz) / span;
      for (let i = 0; i < n; i++) {
        const k = (t[i] - t[0]) / span;
        v[i * 3]     -= dx * k;
        v[i * 3 + 2] -= dz * k;
      }
      clip.userData.rootSpeed = Math.max(clip.userData.rootSpeed, speed);
    }
  }
}
