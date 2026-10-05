/**
 * Passing other walkers on a path: keep to the right.
 *
 *   - `PassOncomingBehavior` — a steering behaviour for a walking agent: when someone is coming the other way, close
 *     ahead and nearly in its way, it steers to its own right. Both walkers do the same, so they pass each other on
 *     opposite sides instead of walking into each other (the plain separation steering pushes straight back along the
 *     line between them, which for two people facing each other just makes them brake).
 *   - the same behaviour also walks round people standing still in the way (a chat on the path): it picks the side away
 *     from where they stand and steers off the path round them, instead of queueing behind them.
 *   - `offsetToRight` (waypoints.js) — each walker also follows its own lane, a little to the right of the path's
 *     centre line, so oncoming walkers are already apart before they meet.
 */

import * as YUKA from 'yuka';
import { PASS_LOOK, PASS_WIDTH, PASS_STRENGTH, DETOUR_LOOK, DETOUR_WIDTH, DETOUR_STRENGTH } from '@/config.js';

/** Someone standing in one place: chatting, dancing, admiring, held by the UI … */
const standingStill = a => (a.stopped || a.holdsPosition || a.gathering) && a.getSpeed() < 0.4;

export class PassOncomingBehavior extends YUKA.SteeringBehavior {
  _side = 0;   // the way round standing people we are taking (-1 left, +1 right, 0 = not detouring)
  _hold = 0;   // seconds left to keep that side after the way clears (so we do not weave back in too early)

  calculate(vehicle, force, delta) {
    force.set(0, 0, 0);
    const speed = vehicle.getSpeed();
    // The way we are heading: our velocity, or (when held up) the way we are facing.
    let fx, fz;
    if (speed >= 0.5) { fx = vehicle.velocity.x / speed; fz = vehicle.velocity.z / speed; }
    else if (vehicle._facing != null) { fx = Math.sin(vehicle._facing); fz = Math.cos(vehicle._facing); }
    else return force;
    const rx = -fz, rz = fx; // to the agent's right (in the ground plane, y up)

    // ── Standing people in the way (a chat on the path): leave the path and walk round them ──
    let lat = 0, blockers = 0, close = 0;
    for (const other of vehicle.neighbors) {
      if (other === vehicle || !standingStill(other)) continue;
      const dx = other.position.x - vehicle.position.x, dz = other.position.z - vehicle.position.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= -1 || ahead > DETOUR_LOOK) continue;
      const side = dx * rx + dz * rz;
      if (Math.abs(side) > DETOUR_WIDTH) continue;
      lat += side; blockers++;
      close = Math.max(close, 1 - Math.max(0, ahead) / DETOUR_LOOK);
    }
    if (blockers) {
      if (this._side === 0) this._side = lat > 0.25 ? -1 : lat < -0.25 ? 1 : 1;  // away from where they stand; dead ahead: to the right
      this._hold = 1.5;
    } else if (this._side !== 0) {
      this._hold -= delta ?? 0.016;
      if (this._hold <= 0) this._side = 0;
    }
    const detour = this._side !== 0 ? (blockers ? 0.6 + close : 0.5) * DETOUR_STRENGTH * vehicle.maxSpeed : 0;
    if (speed < 0.5) { if (detour) force.set(rx, 0, rz).multiplyScalar(this._side * detour); return force; }

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
    if (detour) force.x += rx * this._side * detour, force.z += rz * this._side * detour;
    return force;
  }
}
