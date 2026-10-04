/**
 * The "?" button (or the H key) that hides and shows the help text in the bottom-left corner (#hud in index.html).
 * Hidden by default; the choice is remembered between visits.
 */

const STORAGE_KEY = 'city-scape:help-hidden';

export function initHelpToggle() {
  const hud = document.getElementById('hud');
  const button = hud?.querySelector('.help-toggle');
  if (!hud || !button) return;

  const set = hidden => {
    hud.classList.toggle('collapsed', hidden);
    try { localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0'); } catch { /* storage blocked: fine */ }
  };
  // Hidden unless the visitor has chosen to show it (index.html starts it hidden too, so there is no flash).
  let hidden = true;
  try { hidden = localStorage.getItem(STORAGE_KEY) !== '0'; } catch { /* storage blocked: start hidden */ }
  hud.classList.toggle('collapsed', hidden);

  button.addEventListener('click', e => { e.stopPropagation(); set(!hud.classList.contains('collapsed')); });
  window.addEventListener('keydown', e => {
    if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !e.altKey) set(!hud.classList.contains('collapsed'));
  });
}
