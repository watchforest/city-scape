import { assetUrl } from './assetUrl.js';

/**
 * Turn a `model` cell from people.csv / projects.csv into a fetchable URL, or null if empty.
 *  - 'http(s)://…'  used as-is (external).
 *  - '/…'           a site path, resolved against the site's base URL (so it keeps
 *                   working when hosted under a subpath such as GitHub Pages).
 *  - anything else  relative to public/assets/models/ (e.g. 'people/lasse.glb').
 */
export function resolveModelUrl(value) {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/')) return assetUrl(v);
  return assetUrl('assets/models/' + v.replace(/^\.?\//, ''));
}
