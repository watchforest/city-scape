/** Small name tag that follows the cursor while it hovers a landmark. */

let _el = null;

function _ensure() {
  if (_el) return _el;
  _el = document.createElement('div');
  _el.style.cssText = `
    position: fixed; z-index: 20; pointer-events: none; display: none;
    padding: 4px 9px; border-radius: 6px; white-space: nowrap;
    font: 600 12px/1.3 system-ui, sans-serif;
    background: var(--ui-bg, rgba(255,248,230,0.95)); color: var(--ui-text, #2d1a00);
    border: 1px solid var(--ui-border, #c8a850); box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    transform: translate(14px, 16px);
  `;
  document.body.appendChild(_el);
  return _el;
}

/** Show `text` at the cursor, or hide the label when `text` is null. */
export function showHoverLabel(text, x, y) {
  const el = _ensure();
  if (!text) { el.style.display = 'none'; return; }
  if (el.textContent !== text) el.textContent = text;
  el.style.display = 'block';
  // Keep the tag on screen near the right/bottom edges.
  const flipX = x > window.innerWidth - 220, flipY = y > window.innerHeight - 60;
  el.style.transform = `translate(${flipX ? 'calc(-100% - 14px)' : '14px'}, ${flipY ? 'calc(-100% - 12px)' : '16px'})`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}
