/**
 * Passing other walkers on a path: keep to the right.
 *
 *   - `PassOncomingBehavior` — a steering behaviour for a walking agent: when someone is coming the other way, close
 *     ahead and nearly in its way, it steers to its own right. Both walkers do the same, so they pass each other on
 *     opposite sides instead of walking into each other (the plain separation steering pushes straight back along the
 *     line between them, which for two people facing each other just makes them brake).
 *   - `offsetToRight` (waypoints.js) — each walker also follows its own lane, a little to the right of the path's
 *     centre line, so oncoming walkers are already apart before they meet.
 */

import * as YUKA from 'yuka';
import { PASS_LOOK, PASS_WIDTH, PASS_STRENGTH } from '@/config.js';

export class PassOncomingBehavior extends YUKA.SteeringBehavior {
  calculate(vehicle, force /*, delta */) {
    force.set(0, 0, 0);
    const speed = vehicle.getSpeed();
    if (speed < 0.5) return force;
    const fx = vehicle.velocity.x / speed, fz = vehicle.velocity.z / speed;
    const rx = -fz, rz = fx; // to the agent's right (in the ground plane, y up)

    let push = 0;
    for (const other of vehicle.neighbors) {
      if (other === vehicle) continue;
      const dx = other.position.x - vehicle.position.x, dz = other.position.z - vehicle.position.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > PASS_LOOK) continue;                  // behind, or too far to bother yet
      if (Math.abs(dx * rx + dz * rz) > PASS_WIDTH) continue;         // well off to one side: not in the way
      const oncoming = other.velocity.x * fx + other.velocity.z * fz < -0.25 * speed;
      if (!oncoming) continue;                                        // (same-direction traffic is left to separation)
      push = Math.max(push, 1 - ahead / PASS_LOOK);                   // the closer, the harder
    }
    if (push > 0) force.set(rx, 0, rz).multiplyScalar(push * PASS_STRENGTH * vehicle.maxSpeed);
    return force;
  }
}
