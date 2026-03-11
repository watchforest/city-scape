/**
 * HTML overlay panel for project info.
 * Slides in from the right when a project is clicked.
 * Includes name, description, tags, member list, and QR code if URL present.
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

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #project-overlay {
      position: fixed;
      top: 0; right: 0;
      width: 320px; height: 100vh;
      background: rgba(0,0,0,0.92);
      border-left: 1px solid #1a3a4a;
      color: #cce8ff;
      font: 13px/1.6 monospace;
      padding: 24px 20px;
      box-sizing: border-box;
      transform: translateX(100%);
      transition: transform 0.3s ease;
      overflow-y: auto;
      z-index: 100;
    }
    #project-overlay.open { transform: translateX(0); }
    #project-overlay h2 {
      font-size: 15px;
      color: #fff;
      margin: 0 0 6px 0;
      line-height: 1.3;
    }
    #project-overlay .tags {
      display: flex; flex-wrap: wrap; gap: 6px;
      margin: 10px 0;
    }
    #project-overlay .tag {
      background: #0a2a3a;
      border: 1px solid #1a4a6a;
      border-radius: 3px;
      padding: 2px 8px;
      font-size: 11px;
      color: #66bbdd;
    }
    #project-overlay .desc {
      color: #99ccdd;
      margin: 12px 0;
      font-size: 12px;
    }
    #project-overlay .section-label {
      color: #445566;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 16px 0 6px 0;
    }
    #project-overlay .member {
      display: block;
      color: #88ddcc;
      cursor: pointer;
      padding: 3px 0;
      font-size: 12px;
    }
    #project-overlay .member:hover { color: #fff; }
    #project-overlay .qr-wrap {
      margin: 16px 0;
      text-align: center;
    }
    #project-overlay .qr-wrap canvas {
      border: 1px solid #1a3a4a;
      padding: 6px;
      background: #050f14;
    }
    #project-overlay .qr-label {
      font-size: 10px;
      color: #334455;
      margin-top: 4px;
    }
    #project-overlay .close-btn {
      position: absolute;
      top: 14px; right: 16px;
      background: none;
      border: none;
      color: #445566;
      font: 18px monospace;
      cursor: pointer;
      line-height: 1;
    }
    #project-overlay .close-btn:hover { color: #fff; }
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

  let qrHTML = '';
  if (project.url) {
    try {
      const canvas = document.createElement('canvas');
      await QRCode.toCanvas(canvas, project.url, {
        width: 120,
        color: { dark: '#66ccff', light: '#050f14' },
        margin: 1,
      });
      const qrWrap = document.createElement('div');
      qrWrap.className = 'qr-wrap';
      qrWrap.appendChild(canvas);
      const lbl = document.createElement('div');
      lbl.className = 'qr-label';
      lbl.textContent = project.url;
      qrWrap.appendChild(lbl);
      qrHTML = qrWrap.outerHTML;
      // We'll inject the canvas after setting innerHTML, see below
    } catch (e) {
      console.warn('QR generation failed', e);
    }
  }

  _panel.innerHTML = `
    <button class="close-btn" id="overlay-close">✕</button>
    <h2>${project.name}</h2>
    <div class="tags">${tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
    <div class="desc">${project.description ?? ''}</div>
    <div class="section-label">Team</div>
    ${memberNames.map(m => `<span class="member" data-id="${m.id}">${m.name} <span style="color:#334455">— ${m.role}</span></span>`).join('')}
    <div id="qr-target"></div>
  `;

  // Generate QR into the placeholder div
  if (project.url) {
    try {
      const canvas = document.createElement('canvas');
      await QRCode.toCanvas(canvas, project.url, {
        width: 120,
        color: { dark: '#66ccff', light: '#050f14' },
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
