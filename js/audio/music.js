import { MUSIC } from '../assets/manifest.js';

/**
 * Background music. The single supplied track loops for the whole run; the
 * playback rate and filter shift subtly with depth so floor 10 sounds heavier
 * than floor 1 without needing more audio.
 */

let el = null;
let bossEl = null;
let volume = 0.35;
let enabled = true;
let started = false;
/** Which track should be audible. Both play; only one is turned up. */
let onBoss = false;

export function initMusic() {
  if (el) return el;
  el = new Audio();
  el.src = encodeURI(MUSIC.dungeon);
  el.loop = true;
  el.preload = 'auto';
  el.volume = 0;

  // The boss track runs alongside rather than swapping the source, so entering
  // and leaving a boss chamber is a crossfade instead of a stutter and a reload.
  bossEl = new Audio();
  bossEl.src = encodeURI(MUSIC.boss);
  bossEl.loop = true;
  bossEl.preload = 'auto';
  bossEl.volume = 0;
  return el;
}

/** Must be called from a user gesture the first time - browsers require it. */
export function startMusic() {
  if (!el) initMusic();
  if (started) return;
  el.play().then(() => {
    started = true;
    fadeTo(enabled ? volume : 0, 1.5);
    bossEl.play().catch(() => { /* joins on the next gesture */ });
  }).catch(() => { /* autoplay blocked; retried on the next gesture */ });
}

/**
 * Switch between the dungeon and boss tracks.
 *
 * Called every frame with what the game currently believes; it only acts on a
 * change, so the caller does not have to track edges itself.
 */
export function setBossMusic(on) {
  if (!el || onBoss === !!on) return;
  onBoss = !!on;
  if (!started) return;
  fadeEl(el, onBoss ? 0 : (enabled ? volume : 0), 1.2);
  fadeEl(bossEl, onBoss ? (enabled ? volume : 0) : 0, 1.2);
}

export function isBossMusic() { return onBoss; }

export function setMusicVolume(v) {
  volume = v;
  if (!el || !started) return;
  el.volume = enabled && !onBoss ? v : 0;
  bossEl.volume = enabled && onBoss ? v : 0;
}

export function setMusicEnabled(on) {
  enabled = on;
  if (el) el.volume = on && !onBoss ? volume : 0;
  if (bossEl) bossEl.volume = on && onBoss ? volume : 0;
  if (on && !started) startMusic();
}

export function isMusicEnabled() { return enabled; }

/** Deeper floors: slightly slower and darker. */
export function setDepth(floorNo) {
  if (!el) return;
  const t = Math.max(0, Math.min(1, (floorNo - 1) / 9));
  el.playbackRate = 1.0 - t * 0.12;
}

const fadeTimers = new WeakMap();
function fadeEl(target, to, seconds) {
  if (!target) return;
  clearInterval(fadeTimers.get(target));
  const from = target.volume;
  const steps = Math.max(1, Math.round(seconds * 30));
  let i = 0;
  const timer = setInterval(() => {
    i++;
    target.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
    if (i >= steps) clearInterval(timer);
  }, 1000 / 30);
  fadeTimers.set(target, timer);
}

export function fadeTo(target, seconds) {
  fadeEl(onBoss ? bossEl : el, target, seconds);
}

export function duckFor(seconds) {
  if (!el || !enabled) return;
  fadeTo(volume * 0.25, 0.3);
  setTimeout(() => fadeTo(volume, 0.8), seconds * 1000);
}
