/**
 * Speech bubble UI for person interaction.
 * Uses a plain HTML element positioned via CSS — no CSS2DRenderer needed.
 * The bubble is positioned by projecting the person's 3D position to screen space each frame.
 */

let _bubble = null;
let _renderer = null;
let _cam = null;
let _targetPerson = null; // { mesh, person }
let _state = 'hidden'; // 'hidden' | 'intro' | 'dialogue' | 'project-select'
let _onWalkToProject = null;

const _v = { x: 0, y: 0, z: 0 }; // reusable projected pos

export function initSpeechBubble(renderer, cam, onWalkToProject) {
  _renderer = renderer;
  _cam = cam;
  _onWalkToProject = onWalkToProject;

  _bubble = document.createElement('div');
  _bubble.id = 'speech-bubble';
  document.body.appendChild(_bubble);

  const style = document.createElement('style');
  style.textContent = `
    #speech-bubble {
      position: fixed;
      display: none;
      max-width: 260px;
      background: rgba(0,0,0,0.9);
      border: 1px solid #1a4a6a;
      border-radius: 6px;
      padding: 12px 14px;
      color: #cce8ff;
      font: 12px/1.6 monospace;
      pointer-events: none;
      z-index: 200;
      transform: translate(-50%, -100%);
      margin-top: -16px;
    }
    #speech-bubble.active { display: block; pointer-events: auto; }
    #speech-bubble::after {
      content: '';
      position: absolute;
      bottom: -7px; left: 50%;
      transform: translateX(-50%);
      border: 7px solid transparent;
      border-bottom: none;
      border-top-color: #1a4a6a;
    }
    #speech-bubble .name {
      color: #fff;
      font-weight: bold;
      margin-bottom: 4px;
    }
    #speech-bubble .bio { color: #99ccdd; margin-bottom: 10px; }
    #speech-bubble .options { display: flex; gap: 8px; flex-wrap: wrap; }
    #speech-bubble .opt-btn {
      background: #0a2a3a;
      border: 1px solid #1a4a6a;
      color: #66bbdd;
      font: 11px monospace;
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
    }
    #speech-bubble .opt-btn:hover { background: #1a3a4a; color: #fff; }
    #speech-bubble .project-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
    #speech-bubble .proj-btn {
      background: #0a2a3a;
      border: 1px solid #1a4a6a;
      color: #88ddcc;
      font: 11px monospace;
      padding: 5px 10px;
      border-radius: 3px;
      cursor: pointer;
      text-align: left;
    }
    #speech-bubble .proj-btn:hover { background: #1a3a4a; color: #fff; }
  `;
  document.head.appendChild(style);
}

let _onDismiss = null;

export function showPersonBubble(agentObj, projectNodes, onDismiss) {
  _targetPerson = agentObj; // full agent object: { mesh, person, currentId, ... }
  _onDismiss = onDismiss ?? null;
  _state = 'intro';
  _render(projectNodes);
  _bubble.classList.add('active');
}

export function hideBubble() {
  _state = 'hidden';
  _targetPerson = null;
  _bubble.classList.remove('active');
  _bubble.innerHTML = '';
  if (_onDismiss) { _onDismiss(); _onDismiss = null; }
}

export function updateBubblePosition() {
  if (_state === 'hidden' || !_targetPerson?.mesh) return;

  // Project 3D position to screen
  const pos = _targetPerson.mesh.position.clone();
  pos.y += 5; // above head
  pos.project(_cam);

  const hw = _renderer.domElement.clientWidth / 2;
  const hh = _renderer.domElement.clientHeight / 2;
  const sx = pos.x * hw + hw;
  const sy = -pos.y * hh + hh;

  _bubble.style.left = `${sx}px`;
  _bubble.style.top  = `${sy}px`;
}

function _render(projectNodes) {
  if (!_targetPerson) return;
  const { person } = _targetPerson;

  if (_state === 'intro') {
    _bubble.innerHTML = `
      <div class="name">${person.name} · ${person.role}</div>
      <div class="bio">${person.bio ?? ''}</div>
      <div class="options">
        <button class="opt-btn" id="bubble-yes">See a project →</button>
        <button class="opt-btn" id="bubble-no">Nice to meet you</button>
      </div>
    `;
    _bubble.querySelector('#bubble-yes').addEventListener('click', () => {
      _state = 'project-select';
      _render(projectNodes);
    });
    _bubble.querySelector('#bubble-no').addEventListener('click', hideBubble);
  }

  if (_state === 'project-select') {
    const projects = (projectNodes ?? []).filter(p =>
      (p.members ?? '').split(';').map(s => s.trim()).includes(person.id)
    );

    _bubble.innerHTML = `
      <div class="name">Which project?</div>
      <div class="project-list">
        ${projects.map(p => `<button class="proj-btn" data-id="${p.id}">${p.name}</button>`).join('')}
        <button class="opt-btn" id="bubble-back" style="margin-top:4px">← Back</button>
      </div>
    `;
    _bubble.querySelectorAll('.proj-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const proj = projects.find(p => p.id === btn.dataset.id);
        if (proj && _onWalkToProject) _onWalkToProject(_targetPerson, proj);
        // Don't fire onDismiss — agent is walking, not being released
        _onDismiss = null;
        hideBubble();
      });
    });
    _bubble.querySelector('#bubble-back').addEventListener('click', () => {
      _state = 'intro';
      _render(projectNodes);
    });
  }
}
