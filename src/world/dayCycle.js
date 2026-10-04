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
import { setWaterLight } from './lake.js';
import { setSkyColors } from './sky.js';
import { setCloudLight } from './clouds.js';
import { SKY_DAY, SKY_DAWN, SKY_NIGHT } from '@/config.js';

const _skyDay   = new THREE.Color(SKY_DAY);
const _skyDawn  = new THREE.Color(SKY_DAWN);
const _skyNight = new THREE.Color(SKY_NIGHT);

// Precomputed colour scratch objects
const _skyBuf = new THREE.Color();
const _lightDir = new THREE.Vector3();
const _lightCol = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);
const _cloudLit = new THREE.Color();
const _cloudShade = new THREE.Color();
const _cloudNightLit = new THREE.Color(0.3, 0.34, 0.5);
const _cloudDayShade = new THREE.Color(0.6, 0.67, 0.8);
const _cloudNightShade = new THREE.Color(0.1, 0.12, 0.2);
const _horizonBuf = new THREE.Color();
const _zenithBuf = new THREE.Color();

function _lerpSky(a, b, t, out) {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  return out;
}

const UPDATE_INTERVAL_MS = 500;

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
    this._lastUpdateMs = -Infinity; // update() is throttled; see UPDATE_INTERVAL_MS
    this._cssNight = null;          // last theme written to the CSS variables
    this.daylight = 1;              // 0 (night) … 1 (day); set by update()

    // Hemisphere light instead of flat ambient: surfaces facing the sky pick up the sky colour and
    // downward-facing ones the (darker, earthier) ground colour, so shadowed sides keep some form.
    this._ambient = new THREE.HemisphereLight(0xffffff, 0x555555, 0.3);
    scene.add(this._ambient);

    this._sun = new THREE.DirectionalLight(0xfff5e0, 1.0);
    this._sun.castShadow = true;
    this._sun.shadow.mapSize.set(2048, 2048);
    this._sun.shadow.camera.near = 1;
    // Sun distance and shadow frustum follow the park size.
    this._parkScale = getParkScale();
    const shadowHalf = getParkHalf() + 5; // shadows right out to the edge trees
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
    this.update(true);
  }

  /**
   * The wall-clock time of day changes far too slowly to need per-frame work, so this
   * recomputes at most every UPDATE_INTERVAL_MS (the light/sky shift is imperceptible
   * over that span). Pass force = true to apply a change immediately.
   */
  update(force = false) {
    const nowMs = performance.now();
    if (!force && nowMs - this._lastUpdateMs < UPDATE_INTERVAL_MS) return;
    this._lastUpdateMs = nowMs;

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
    this.daylight = Math.min(1, sunAbove * 1.6); // 0 at night … 1 for most of the day (cloud shadows, …)

    // Gradient sky dome: hazy horizon, deeper zenith. At dawn/dusk the horizon keeps the warm sky colour.
    _horizonBuf.copy(sky).lerp(_white, 0.35 * this.daylight);
    _zenithBuf.copy(sky).multiplyScalar(0.55 + 0.1 * this.daylight);
    _zenithBuf.b = Math.min(1, _zenithBuf.b + 0.12 * this.daylight);
    setSkyColors(_horizonBuf, _zenithBuf);

    // ── Ambient ───────────────────────────────────────────────────────────
    this._ambient.intensity = 0.1 + sunAbove * 0.5;
    _lightCol.copy(sky).lerp(_white, 0.45);
    this._ambient.color.copy(_lightCol);                     // sky side: the sky colour, washed out
    this._ambient.groundColor.setRGB(0.28, 0.3, 0.2).multiplyScalar(0.4 + this.daylight * 0.6); // earthy bounce

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

    // ── Clouds: sunny tops take the sun's colour, undersides a grey-blue touched by the sky ─────
    _cloudLit.copy(this._sun.color).lerp(_cloudNightLit, 1 - this.daylight);
    _cloudShade.copy(_cloudDayShade).lerp(_cloudNightShade, 1 - this.daylight).lerp(this._scene.background, 0.22);
    setCloudLight(_cloudLit, _cloudShade);

    // ── Water: lit by whichever of sun/moon is up ─────────────────────────
    const lightSrc = sunVisible ? this._sun : this._moon;
    _lightDir.copy(lightSrc.position).normalize();
    const lightI = lightSrc.intensity;
    _lightCol.copy(lightSrc.color).multiplyScalar(Math.min(lightI, 1.2));
    // Same irradiance the Lambert ground gets (÷π), lifted a touch so water reads brighter than turf.
    const waterLevel = (this._ambient.intensity + lightI * Math.max(_lightDir.y, 0)) / Math.PI * 1.4;
    setWaterLight(_lightDir, _lightCol, this._scene.background, waterLevel);

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
    this.night = lampT; // exposed so agents can bias what they do (0 = day … 1 = night)
    if (this._lampHeadMat) this._lampHeadMat.emissiveIntensity = lampT * 2.0;
    if (this._lampHaloMat) this._lampHaloMat.opacity           = lampT * 0.9;

    // ── CSS variables for UI theming (only touched when the theme flips) ──
    const isNight = hours < 7 || hours > 19;
    if (isNight === this._cssNight) return;
    this._cssNight = isNight;
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
