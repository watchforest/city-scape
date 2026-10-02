/**
 * DayCycle — real wall-clock based sky and lighting.
 *
 * Uses the actual local time to drive:
 *   - Scene background color (night → dawn → day → dusk → night)
 *   - AmbientLight intensity
 *   - DirectionalLight (sun): position arc east→west, warm at dawn/dusk
 *   - DirectionalLight (moon): dim cool blue, visible at night
 *   - CSS custom properties for UI theming
 */

import * as THREE from 'three';
import { getParkHalf, getParkScale } from './parkBounds.js';
import { SKY_DAY, SKY_DAWN, SKY_NIGHT } from '@/config.js';

const _skyDay   = new THREE.Color(SKY_DAY);
const _skyDawn  = new THREE.Color(SKY_DAWN);
const _skyNight = new THREE.Color(SKY_NIGHT);

// Precomputed colour scratch objects
const _skyBuf = new THREE.Color();

function _lerpSky(a, b, t, out) {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  return out;
}

// Time presets for the T key toggle (hours in 24h format)
const TIME_PRESETS = [
  { label: 'dawn',  hours: 6.5  },
  { label: 'day',   hours: 12.0 },
  { label: 'dusk',  hours: 18.5 },
  { label: 'night', hours: 23.0 },
];

export class DayCycle {
  constructor(scene) {
    this._overrideHours = null; // null = use real clock
    this._presetIdx = -1;
    this._scene = scene;
    this._lampHeadMat = null;
    this._lampHaloMat = null;

    this._ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(this._ambient);

    this._sun = new THREE.DirectionalLight(0xfff5e0, 1.0);
    this._sun.castShadow = true;
    this._sun.shadow.mapSize.set(2048, 2048);
    this._sun.shadow.camera.near = 1;
    // Sun distance and shadow frustum follow the park size.
    this._parkScale = getParkScale();
    const shadowHalf = getParkHalf() - 20;
    this._sun.shadow.camera.far  = 600 * this._parkScale;
    this._sun.shadow.camera.left   = -shadowHalf;
    this._sun.shadow.camera.right  =  shadowHalf;
    this._sun.shadow.camera.top    =  shadowHalf;
    this._sun.shadow.camera.bottom = -shadowHalf;
    scene.add(this._sun);

    this._moon = new THREE.DirectionalLight(0x8899cc, 0.15);
    this._moon.position.set(-50, 80, -50);
    scene.add(this._moon);

    this.update();
  }

  /** Register lamp materials to be driven by the day cycle. */
  setLampMaterials(headMat, haloMat) {
    this._lampHeadMat = headMat;
    this._lampHaloMat = haloMat;
  }

  /** Cycle through dawn/day/dusk/night presets (T key). */
  cyclePreset() {
    this._presetIdx = (this._presetIdx + 1) % TIME_PRESETS.length;
    this._overrideHours = TIME_PRESETS[this._presetIdx].hours;
    console.log(`[DayCycle] preset: ${TIME_PRESETS[this._presetIdx].label} (${this._overrideHours}h)`);
  }

  update() {
    const now     = new Date();
    const hours   = this._overrideHours ?? (now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600);
    const dayFrac = hours / 24; // 0..1

    // Sun elevation: peaks at noon (hour=12 → dayFrac=0.5)
    const elevation = Math.sin(dayFrac * Math.PI * 2 - Math.PI / 2); // -1..1, peak at 0.5

    // Clamp to 0..1 for above-horizon fraction
    const sunAbove = Math.max(0, elevation);

    // ── Sky colour ─────────────────────────────────────────────────────────
    let sky;
    if (hours < 5 || hours >= 21) {
      // Deep night
      sky = _skyNight;
    } else if (hours < 7) {
      // Night → dawn
      const t = (hours - 5) / 2;
      sky = _lerpSky(_skyNight, _skyDawn, t, _skyBuf);
    } else if (hours < 9) {
      // Dawn → day
      const t = (hours - 7) / 2;
      sky = _lerpSky(_skyDawn, _skyDay, t, _skyBuf);
    } else if (hours < 17) {
      // Full day
      sky = _skyDay;
    } else if (hours < 19) {
      // Day → dusk
      const t = (hours - 17) / 2;
      sky = _lerpSky(_skyDay, _skyDawn, t, _skyBuf);
    } else {
      // Dusk → night
      const t = (hours - 19) / 2;
      sky = _lerpSky(_skyDawn, _skyNight, t, _skyBuf);
    }
    this._scene.background.set(sky);

    // ── Ambient ───────────────────────────────────────────────────────────
    this._ambient.intensity = 0.05 + sunAbove * 0.4;

    // ── Sun ───────────────────────────────────────────────────────────────
    const sunVisible = hours >= 5 && hours <= 19;
    this._sun.visible = sunVisible;
    if (sunVisible) {
      // Arc east (positive x) at dawn → west (negative x) at dusk
      const arcAngle = ((hours - 5) / 14) * Math.PI; // 0 → π
      const s        = this._parkScale;
      const sunY     = (Math.sin(arcAngle) * 150 + 10) * s;
      const sunX     = Math.cos(arcAngle) * -150 * s;
      this._sun.position.set(sunX, sunY, -80 * s);
      this._sun.intensity = 0.3 + sunAbove * 0.9;

      // Colour: warm orange at dawn/dusk, white at noon
      const noon   = Math.abs(hours - 12) / 7; // 0 at noon, 1 at 5/19
      const sunR   = 1.0;
      const sunG   = 1.0 - noon * 0.35;
      const sunB   = 1.0 - noon * 0.65;
      this._sun.color.setRGB(sunR, sunG, sunB);
    }

    // ── Moon ──────────────────────────────────────────────────────────────
    this._moon.visible   = !sunVisible || hours < 7 || hours > 18;
    this._moon.intensity = Math.max(0, 0.15 - sunAbove * 0.12);

    // ── Lamp posts: emissive glow + ground halo, driven by time of day ────
    let lampT; // 0 = off (day), 1 = fully on (night)
    if (hours < 7 || hours >= 19) {
      lampT = 1;
    } else if (hours < 9) {
      lampT = 1 - (hours - 7) / 2;
    } else if (hours < 17) {
      lampT = 0;
    } else {
      lampT = (hours - 17) / 2;
    }
    if (this._lampHeadMat) this._lampHeadMat.emissiveIntensity = lampT * 2.0;
    if (this._lampHaloMat) this._lampHaloMat.opacity           = lampT * 0.9;

    // ── CSS variables for UI theming ──────────────────────────────────────
    const isNight = hours < 7 || hours > 19;
    const root    = document.documentElement.style;
    if (isNight) {
      root.setProperty('--ui-bg',     'rgba(20,15,10,0.95)');
      root.setProperty('--ui-text',   '#ffe8cc');
      root.setProperty('--ui-accent', '#cc8833');
      root.setProperty('--ui-border', '#3a2a10');
      root.setProperty('--ui-tag-bg', '#2a1a00');
      root.setProperty('--ui-muted',  '#664422');
    } else {
      root.setProperty('--ui-bg',     'rgba(255,248,230,0.97)');
      root.setProperty('--ui-text',   '#2d1a00');
      root.setProperty('--ui-accent', '#8B6914');
      root.setProperty('--ui-border', '#c8a850');
      root.setProperty('--ui-tag-bg', '#f0e0b0');
      root.setProperty('--ui-muted',  '#8a7040');
    }
  }
}
