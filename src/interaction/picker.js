import * as THREE from 'three';
import { showHoverLabel } from '@/ui/hoverLabel.js';

/**
 * Raycaster-based click picker.
 * Detects clicks on agent meshes and project objects.
 *
 * onAgentClick(agentObj)   — agentObj has .person and .mesh
 * onProjectClick(project)  — project is the raw project data node
 */
export class Picker {
  constructor(renderer, cam, onAgentClick, onProjectClick) {
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();
    this._cam = cam;
    this._agentMeshes = [];    // THREE.Object3D[]
    this._projectGroups = [];  // THREE.Group[]

    renderer.domElement.addEventListener('click', e => this._onClick(e));
    renderer.domElement.addEventListener('pointermove', e => this._onMove(e));
    renderer.domElement.addEventListener('pointerleave', () => this._setHover(null));
  }

  _setHover(project, x = 0, y = 0) {
    showHoverLabel(project ? project.name : null, x, y);
    document.body.style.cursor = project ? 'pointer' : '';
  }

  /** Landmark name tag under the cursor (one raycast per animation frame at most). */
  _onMove(e) {
    if (e.buttons) { this._setHover(null); return; } // dragging the camera
    this._lastMove = e;
    if (this._movePending) return;
    this._movePending = true;
    requestAnimationFrame(() => {
      this._movePending = false;
      const m = this._lastMove, rect = m.target.getBoundingClientRect();
      this._mouse.x =  ((m.clientX - rect.left) / rect.width)  * 2 - 1;
      this._mouse.y = -((m.clientY - rect.top)  / rect.height) * 2 + 1;
      this._raycaster.setFromCamera(this._mouse, this._cam);
      // An agent standing in front of a landmark hides its label.
      const agentHit = this._raycaster.intersectObjects(this._agentMeshes, true)[0];
      const projHit  = this._raycaster.intersectObjects(this._projectGroups, true)[0];
      if (!projHit || (agentHit && agentHit.distance < projHit.distance)) { this._setHover(null); return; }
      let obj = projHit.object;
      while (obj && !obj.userData.project) obj = obj.parent;
      this._setHover(obj?.userData.project ?? null, m.clientX, m.clientY);
    });
  }

  registerAgents(meshes) {
    this._agentMeshes = meshes;
  }

  registerProjects(groups) {
    this._projectGroups = groups;
  }

  _onClick(e) {
    const el = e.target;
    const rect = el.getBoundingClientRect();
    this._mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

    this._raycaster.setFromCamera(this._mouse, this._cam);

    // Check agents first
    const agentHits = this._raycaster.intersectObjects(this._agentMeshes, true);
    if (agentHits.length > 0) {
      const hit = agentHits[0].object;
      // Walk up to find the group with userData.agentRef
      let obj = hit;
      while (obj && !obj.userData.agentRef) obj = obj.parent;
      if (obj?.userData.agentRef) {
        this._onAgentClick(obj.userData.agentRef);
        return;
      }
    }

    // Check project objects
    const projHits = this._raycaster.intersectObjects(this._projectGroups, true);
    if (projHits.length > 0) {
      const hit = projHits[0].object;
      let obj = hit;
      while (obj && !obj.userData.project) obj = obj.parent;
      if (obj?.userData.project) {
        this._onProjectClick(obj.userData.project);
        return;
      }
    }
  }
}

// Module-level wired callbacks (set from main)
let _picker = null;

export function createPicker(renderer, cam, onAgentClick, onProjectClick) {
  _picker = new Picker(renderer, cam, onAgentClick, onProjectClick);
  _picker._onAgentClick = onAgentClick;
  _picker._onProjectClick = onProjectClick;
  return _picker;
}
