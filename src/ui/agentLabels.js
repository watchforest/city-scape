/**
 * Always-on name labels over the people, toggled with a key (N). Each is in the colour of its character (agentColors.js)
 * and clicking one selects that person, like clicking the person. While they are on, the cursor hover label for people
 * (hoverLabel.js) is switched off. Remembered between visits. (The tags themselves: labelLayer.js.)
 */

import { setHoverLabelEnabled } from './hoverLabel.js';
import { createLabelLayer } from './labelLayer.js';
import { applyNameColor } from './agentColors.js';

const LIFT = 5.2; // world units above a person's feet (just over the head)

let _layer = null;

/**
 * @param {THREE.PerspectiveCamera} cam
 * @param {THREE.WebGLRenderer} renderer
 * @param {object[]} agents  AgentEntity[]
 * @param {(agent: object) => void} [onClick]
 */
export function initAgentLabels(cam, renderer, agents, onClick = () => {}) {
  _layer = createLabelLayer({
    cam, renderer, storageKey: 'city-scape:agent-labels', zIndex: 16,
    onToggle: on => setHoverLabelEnabled('agent', !on),
  });
  for (const agent of agents) {
    _layer.add(
      agent.person?.name ?? '',
      out => out.set(agent.mesh.position.x, agent.mesh.position.y + LIFT, agent.mesh.position.z),
      () => onClick(agent),
      el => applyNameColor(el, agent),
    );
  }
  _layer.init();
}

export function toggleAgentLabels() { return _layer ? _layer.toggle() : false; }

/** Call every frame. */
export function updateAgentLabels() { _layer?.update(); }
