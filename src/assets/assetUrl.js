/**
 * Resolve a path inside public/ against the site's base URL, so the app also works
 * when it is hosted under a subpath (e.g. GitHub Pages at /city-scape/) instead of
 * the domain root. Always use this instead of a hardcoded '/assets/...'.
 *
 *   assetUrl('assets/data/people.csv')   // leading slash is optional
 */
export function assetUrl(path) {
  return import.meta.env.BASE_URL + String(path).replace(/^\/+/, '');
}
