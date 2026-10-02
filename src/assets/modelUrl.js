const MODEL_ROOT = '/assets/models/';

/**
 * Turn a `model` cell from projects.csv into a fetchable URL, or null if empty.
 * Absolute ('/…', 'http(s)://…') paths are used as-is; anything else is
 * relative to public/assets/models/.
 */
export function resolveModelUrl(value) {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (v.startsWith('/') || /^https?:\/\//i.test(v)) return v;
  return MODEL_ROOT + v.replace(/^\.?\//, '');
}
