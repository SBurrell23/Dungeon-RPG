import { MUSIC } from '../assets/manifest.js';

/**
 * Background music. The single supplied track loops for the whole run; the
 * playback rate and filter shift subtly with depth so floor 10 sounds heavier
 * than floor 1 without needing more audio.
 */

let el = null;
let volume = 0.35;
let enabled = true;
let started = false;

export function initMusic() {
  if (el) return el;
  el = new Audio();
  el.src = encodeURI(MUSIC.dungeon);
  el.loop = true;
  el.preload = 'auto';
  el.volume = 0;
  return el;
}

/** Must be called from a user gesture the first time - browsers require it. */
export function startMusic() {
  if (!el) initMusic();
  if (started) return;
  el.play().then(() => {
    started = true;
    fadeTo(enabled ? volume : 0, 1.5);
  }).catch(() => { /* autoplay blocked; retried on the next gesture */ });
}

export function setMusicVolume(v) {
  volume = v;
  if (el && started) el.volume = enabled ? v : 0;
}

export function setMusicEnabled(on) {
  enabled = on;
  if (el) el.volume = on ? volume : 0;
  if (on && !started) startMusic();
}

export function isMusicEnabled() { return enabled; }

/** Deeper floors: slightly slower and darker. */
export function setDepth(floorNo) {
  if (!el) return;
  const t = Math.max(0, Math.min(1, (floorNo - 1) / 9));
  el.playbackRate = 1.0 - t * 0.12;
}

let fadeTimer = null;
export function fadeTo(target, seconds) {
  if (!el) return;
  clearInterval(fadeTimer);
  const from = el.volume;
  const steps = Math.max(1, Math.round(seconds * 30));
  let i = 0;
  fadeTimer = setInterval(() => {
    i++;
    el.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
    if (i >= steps) clearInterval(fadeTimer);
  }, 1000 / 30);
}

export function duckFor(seconds) {
  if (!el || !enabled) return;
  fadeTo(volume * 0.25, 0.3);
  setTimeout(() => fadeTo(volume, 0.8), seconds * 1000);
}
