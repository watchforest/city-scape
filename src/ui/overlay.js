/**
 * HTML overlay panel for project info.
 * Slides in from the right when a project/attraction is clicked.
 * Uses CSS custom properties set by DayCycle for day/night theming.
 */

import QRCode from 'qrcode';

let _panel = null;
let _onPersonClick = null;
let _onClose = null;

export function initOverlay(onPersonClick) {
  _onPersonClick = onPersonClick;

  _panel = document.createElement('div');
  _panel.id = 'project-overlay';
  _panel.innerHTML = '';
  document.body.appendChild(_panel);

  const style = document.createElement('style');
  style.textContent = `
    #project-overlay {
      position: fixed;
      top: 0; right: 0;
      width: 320px; height: 100vh;
      background: var(--ui-bg, rgba(255,248,230,0.97));
      border-left: 1px solid var(--ui-border, #c8a850);
      color: var(--ui-text, #2d1a00);
      font: 13px/1.6 system-ui, sans-serif;
      padding: 24px 20px;
      box-sizing: border-box;
      transform: translateX(100%);
      transition: transform 0.3s ease;
      overflow: hidden;
      z-index: 100;
      display: flex;
      flex-direction: column;
    }
    #project-overlay.open { transform: translateX(0); }
    #project-overlay h2 {
      font-size: 15px;
      color: var(--ui-text, #2d1a00);
      margin: 0 0 6px 0;
      line-height: 1.3;
      font-weight: 700;
    }
    #project-overlay .fullname {
      font-size: 11px;
      color: var(--ui-muted, #8a7040);
      margin: -4px 0 4px 0;
      font-style: italic;
    }
    #project-overlay .tags {
      display: flex; flex-wrap: wrap; gap: 6px;
      margin: 10px 0;
    }
    #project-overlay .tag {
      background: var(--ui-tag-bg, #f0e0b0);
      border: 1px solid var(--ui-border, #c8a850);
      border-radius: 3px;
      padding: 2px 8px;
      font-size: 11px;
      color: var(--ui-accent, #8B6914);
    }
    #project-overlay .desc {
      color: var(--ui-muted, #8a7040);
      margin: 12px 0;
      font-size: 12px;
      flex: 1;
      overflow-y: auto;
      padding-right: 4px;
      min-height: 0;
    }
    #project-overlay .bottom-section {
      flex-shrink: 0;
      border-top: 1px solid var(--ui-border, #c8a850);
      padding-top: 10px;
    }
    #project-overlay .section-label {
      color: var(--ui-muted, #8a7040);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 16px 0 6px 0;
    }
    #project-overlay .member {
      display: block;
      color: var(--ui-accent, #8B6914);
      cursor: pointer;
      padding: 3px 0;
      font-size: 12px;
    }
    #project-overlay .member:hover { color: var(--ui-text, #2d1a00); }
    #project-overlay .qr-wrap {
      margin: 16px 0;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    #project-overlay .qr-wrap canvas {
      border: 1px solid var(--ui-border, #c8a850);
      padding: 6px;
      background: var(--ui-tag-bg, #f0e0b0);
    }
    #project-overlay .qr-label {
      font-size: 10px;
      color: var(--ui-muted, #8a7040);
      margin-top: 4px;
    }
    #project-overlay .close-btn {
      position: absolute;
      top: 14px; right: 16px;
      background: none;
      border: none;
      color: var(--ui-muted, #8a7040);
      font: 18px system-ui;
      cursor: pointer;
      line-height: 1;
    }
    #project-overlay .close-btn:hover { color: var(--ui-text, #2d1a00); }
  `;
  document.head.appendChild(style);
}

export async function showProjectOverlay(project, personNodes, onClose) {
  _onClose = onClose ?? null;
  if (!_panel) return;

  const tags = (project.tags ?? '').split(';').map(s => s.trim()).filter(Boolean);
  const members = (project.members ?? '').split(';').map(s => s.trim()).filter(Boolean);

  const memberNames = members.map(id => {
    const person = personNodes.find(p => p.id === id);
    return person ? { id, name: person.name, role: person.role } : { id, name: id, role: '' };
  });

  _panel.innerHTML = `
    <button class="close-btn" id="overlay-close">✕</button>
    <h2>${project.name}</h2>
    ${project.fullname ? `<div class="fullname">${project.fullname}</div>` : ''}
    <div class="tags">${tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
    <div class="desc">${project.description ?? ''}</div>
    <div class="bottom-section">
      <div class="section-label">Team</div>
      ${memberNames.map(m => `<span class="member" data-id="${m.id}">${m.name} <span style="opacity:0.6">— ${m.role}</span></span>`).join('')}
      <div id="qr-target"></div>
    </div>
  `;

  if (project.url) {
    try {
      const canvas = document.createElement('canvas');
      await QRCode.toCanvas(canvas, project.url, {
        width: 120,
        color: { dark: '#5c3d00', light: '#fff8e6' },
        margin: 1,
      });
      const wrap = document.createElement('div');
      wrap.className = 'qr-wrap';
      wrap.appendChild(canvas);
      const lbl = document.createElement('div');
      lbl.className = 'qr-label';
      lbl.textContent = project.url;
      wrap.appendChild(lbl);
      _panel.querySelector('#qr-target').appendChild(wrap);
    } catch (e) { /* ignore */ }
  }

  _panel.querySelector('#overlay-close').addEventListener('click', hideProjectOverlay);

  _panel.querySelectorAll('.member').forEach(el => {
    el.addEventListener('click', () => {
      const person = personNodes.find(p => p.id === el.dataset.id);
      if (person && _onPersonClick) _onPersonClick(person);
    });
  });

  _panel.classList.add('open');
}

export function hideProjectOverlay() {
  _panel?.classList.remove('open');
  if (_onClose) { _onClose(); _onClose = null; }
}
