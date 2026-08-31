/**
 * Procedural sound effects.
 *
 * Everything is synthesised at play time from oscillators and noise buffers -
 * no sample files. Each sound is a small recipe of layers so tweaking the feel
 * of a hit is editing three numbers rather than re-recording anything.
 */

let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = false;
let volume = 0.5;

// Rapid identical sounds (a whirlwind hitting eight things) would stack into
// clipping, so each name gets a short retrigger floor.
const lastPlayed = new Map();

export function initAudio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  const len = ctx.sampleRate * 1.2;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function setSfxVolume(v) {
  volume = v;
  if (master) master.gain.value = muted ? 0 : v;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : volume;
}

export function isMuted() { return muted; }

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function now() { return ctx.currentTime; }

/** Pitched layer with an exponential frequency sweep and AD envelope. */
function tone({ type = 'sine', f0, f1 = f0, t = 0.2, gain = 0.3, delay = 0, attack = 0.005, curve = 'exp', detune = 0 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.detune.value = detune;
  const start = now() + delay;
  o.frequency.setValueAtTime(Math.max(1, f0), start);
  if (f1 !== f0) {
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), start + t);
    else o.frequency.linearRampToValueAtTime(Math.max(1, f1), start + t);
  }
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + t);
  o.connect(g).connect(master);
  o.start(start);
  o.stop(start + t + 0.05);
}

/** Filtered noise layer - the body of every impact, swing and explosion. */
function noise({ t = 0.2, gain = 0.3, delay = 0, type = 'bandpass', f0 = 1200, f1 = 400, q = 1.2 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  const start = now() + delay;
  filt.frequency.setValueAtTime(f0, start);
  filt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), start + t);
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(0.0002, gain), start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + t);
  src.connect(filt).connect(g).connect(master);
  src.start(start, Math.random() * 0.5);
  src.stop(start + t + 0.05);
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

const SOUNDS = {
  swing: (v) => {
    noise({ t: 0.13, gain: 0.18 * v, f0: 2600, f1: 700, q: 0.9 });
    tone({ type: 'triangle', f0: 320, f1: 140, t: 0.09, gain: 0.05 * v });
  },
  mobSwing: (v) => {
    noise({ t: 0.16, gain: 0.14 * v, f0: 1600, f1: 380, q: 0.8 });
  },
  bow: (v) => {
    noise({ t: 0.09, gain: 0.16 * v, f0: 3800, f1: 900, q: 2.0 });
    tone({ type: 'sine', f0: 700, f1: 240, t: 0.08, gain: 0.06 * v });
  },
  mobShoot: (v) => {
    noise({ t: 0.1, gain: 0.12 * v, f0: 2400, f1: 600, q: 1.5 });
  },
  cast: (v) => {
    tone({ type: 'sine', f0: 420, f1: 980, t: 0.16, gain: 0.12 * v });
    tone({ type: 'sine', f0: 630, f1: 1470, t: 0.16, gain: 0.06 * v, delay: 0.02 });
    noise({ t: 0.14, gain: 0.05 * v, f0: 3200, f1: 1600, q: 3 });
  },
  hit: (v) => {
    noise({ t: 0.08, gain: 0.16 * v, f0: 900, f1: 200, q: 0.7 });
  },
  boom: (v) => {
    noise({ t: 0.55, gain: 0.34 * v, type: 'lowpass', f0: 1400, f1: 90, q: 0.8 });
    tone({ type: 'sine', f0: 150, f1: 38, t: 0.5, gain: 0.30 * v });
    tone({ type: 'square', f0: 90, f1: 30, t: 0.28, gain: 0.08 * v });
  },
  frost: (v) => {
    tone({ type: 'sine', f0: 1500, f1: 380, t: 0.4, gain: 0.14 * v });
    noise({ t: 0.42, gain: 0.13 * v, f0: 5200, f1: 900, q: 1.6 });
  },
  shock: (v) => {
    for (let i = 0; i < 4; i++) {
      noise({ t: 0.05, gain: 0.13 * v, delay: i * 0.035, f0: 5000 + Math.random() * 3000, f1: 1400, q: 3 });
    }
    tone({ type: 'sawtooth', f0: 900, f1: 260, t: 0.2, gain: 0.07 * v });
  },
  holy: (v) => {
    tone({ type: 'sine', f0: 660, f1: 990, t: 0.5, gain: 0.11 * v });
    tone({ type: 'sine', f0: 880, f1: 1320, t: 0.5, gain: 0.07 * v, delay: 0.05 });
    tone({ type: 'sine', f0: 1320, f1: 1760, t: 0.45, gain: 0.04 * v, delay: 0.1 });
  },
  heal: (v) => {
    tone({ type: 'sine', f0: 520, f1: 880, t: 0.35, gain: 0.11 * v });
    tone({ type: 'sine', f0: 780, f1: 1170, t: 0.3, gain: 0.06 * v, delay: 0.08 });
  },
  buff: (v) => {
    tone({ type: 'triangle', f0: 260, f1: 620, t: 0.28, gain: 0.11 * v });
    tone({ type: 'triangle', f0: 390, f1: 930, t: 0.26, gain: 0.06 * v, delay: 0.04 });
  },
  revive: (v) => {
    tone({ type: 'sine', f0: 330, f1: 660, t: 0.7, gain: 0.14 * v });
    tone({ type: 'sine', f0: 495, f1: 990, t: 0.7, gain: 0.09 * v, delay: 0.1 });
    tone({ type: 'sine', f0: 660, f1: 1320, t: 0.6, gain: 0.06 * v, delay: 0.22 });
  },
  blink: (v) => {
    tone({ type: 'sine', f0: 1600, f1: 240, t: 0.16, gain: 0.12 * v });
    noise({ t: 0.14, gain: 0.07 * v, f0: 4000, f1: 700, q: 2 });
  },
  dash: (v) => {
    noise({ t: 0.18, gain: 0.13 * v, f0: 1400, f1: 260, q: 0.7 });
  },
  drink: (v) => {
    tone({ type: 'sine', f0: 300, f1: 620, t: 0.18, gain: 0.10 * v });
    noise({ t: 0.12, gain: 0.05 * v, f0: 900, f1: 400, q: 2 });
  },
  coin: (v) => {
    tone({ type: 'square', f0: 1560, f1: 1560, t: 0.07, gain: 0.07 * v });
    tone({ type: 'square', f0: 2100, f1: 2100, t: 0.1, gain: 0.05 * v, delay: 0.05 });
  },
  pickup: (v) => {
    tone({ type: 'triangle', f0: 700, f1: 1250, t: 0.13, gain: 0.09 * v });
  },
  chest: (v) => {
    noise({ t: 0.25, gain: 0.13 * v, f0: 900, f1: 200, q: 1 });
    tone({ type: 'triangle', f0: 420, f1: 880, t: 0.3, gain: 0.09 * v, delay: 0.08 });
  },
  shrine: (v) => {
    for (let i = 0; i < 3; i++) {
      tone({ type: 'sine', f0: 523 * (i + 1), f1: 523 * (i + 1) * 1.5, t: 0.9, gain: (0.09 / (i + 1)) * v, delay: i * 0.09 });
    }
  },
  unlock: (v) => {
    tone({ type: 'sine', f0: 180, f1: 90, t: 0.7, gain: 0.16 * v });
    noise({ t: 0.8, gain: 0.14 * v, type: 'lowpass', f0: 800, f1: 100 });
    tone({ type: 'triangle', f0: 660, f1: 990, t: 0.5, gain: 0.07 * v, delay: 0.3 });
  },
  levelUp: (v) => {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f, t: 0.26, gain: 0.10 * v, delay: i * 0.075 }));
  },
  spike: (v) => {
    noise({ t: 0.14, gain: 0.20 * v, f0: 3200, f1: 500, q: 1.4 });
    tone({ type: 'sawtooth', f0: 220, f1: 80, t: 0.14, gain: 0.08 * v });
  },
  dart: (v) => {
    for (let i = 0; i < 3; i++) noise({ t: 0.07, gain: 0.10 * v, delay: i * 0.03, f0: 3400, f1: 1100, q: 2.5 });
  },
  flame: (v) => {
    noise({ t: 0.6, gain: 0.16 * v, type: 'lowpass', f0: 2200, f1: 300 });
    tone({ type: 'sawtooth', f0: 120, f1: 60, t: 0.5, gain: 0.05 * v });
  },
  gas: (v) => {
    noise({ t: 0.9, gain: 0.12 * v, type: 'bandpass', f0: 700, f1: 250, q: 0.6 });
  },
  mobDeath: (v) => {
    tone({ type: 'sawtooth', f0: 260, f1: 70, t: 0.34, gain: 0.11 * v });
    noise({ t: 0.3, gain: 0.11 * v, f0: 1200, f1: 200, q: 0.8 });
  },
  bossDeath: (v) => {
    tone({ type: 'sawtooth', f0: 180, f1: 40, t: 1.4, gain: 0.20 * v });
    noise({ t: 1.5, gain: 0.20 * v, type: 'lowpass', f0: 1200, f1: 60 });
    tone({ type: 'sine', f0: 80, f1: 30, t: 1.6, gain: 0.16 * v, delay: 0.15 });
  },
  playerHurt: (v) => {
    tone({ type: 'square', f0: 200, f1: 110, t: 0.12, gain: 0.09 * v });
    noise({ t: 0.12, gain: 0.10 * v, f0: 800, f1: 200, q: 0.9 });
  },
  playerDeath: (v) => {
    tone({ type: 'sawtooth', f0: 300, f1: 55, t: 1.0, gain: 0.16 * v });
    noise({ t: 0.9, gain: 0.10 * v, type: 'lowpass', f0: 900, f1: 80 });
  },
  windup: (v) => {
    tone({ type: 'sawtooth', f0: 120, f1: 340, t: 0.5, gain: 0.07 * v });
  },
  roar: (v) => {
    tone({ type: 'sawtooth', f0: 140, f1: 70, t: 0.8, gain: 0.16 * v });
    tone({ type: 'square', f0: 90, f1: 46, t: 0.8, gain: 0.09 * v, delay: 0.05 });
    noise({ t: 0.8, gain: 0.12 * v, type: 'lowpass', f0: 1600, f1: 200 });
  },
  shout: (v) => {
    tone({ type: 'sawtooth', f0: 260, f1: 120, t: 0.45, gain: 0.14 * v });
    noise({ t: 0.4, gain: 0.10 * v, type: 'bandpass', f0: 1200, f1: 400, q: 0.8 });
  },
  summon: (v) => {
    tone({ type: 'sine', f0: 90, f1: 300, t: 0.6, gain: 0.11 * v });
    noise({ t: 0.6, gain: 0.07 * v, type: 'bandpass', f0: 400, f1: 1800, q: 2 });
  },
  descend: (v) => {
    tone({ type: 'sine', f0: 300, f1: 70, t: 1.3, gain: 0.16 * v });
    noise({ t: 1.4, gain: 0.10 * v, type: 'lowpass', f0: 1000, f1: 60 });
  },
  uiClick: (v) => tone({ type: 'square', f0: 900, f1: 620, t: 0.05, gain: 0.05 * v }),
  uiHover: (v) => tone({ type: 'sine', f0: 1200, f1: 1200, t: 0.03, gain: 0.02 * v }),
  equip: (v) => {
    noise({ t: 0.12, gain: 0.10 * v, f0: 2600, f1: 700, q: 1.6 });
    tone({ type: 'triangle', f0: 520, f1: 780, t: 0.12, gain: 0.05 * v });
  },
  error: (v) => tone({ type: 'square', f0: 200, f1: 140, t: 0.14, gain: 0.06 * v }),
  victory: (v) => {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f, t: 0.5, gain: 0.10 * v, delay: i * 0.14 }));
  },
  defeat: (v) => {
    const notes = [392, 349, 311, 262];
    notes.forEach((f, i) => tone({ type: 'sine', f0: f, f1: f, t: 0.8, gain: 0.11 * v, delay: i * 0.28 }));
  },
};

const MIN_GAP = {
  hit: 0.03, swing: 0.05, mobSwing: 0.06, mobShoot: 0.05,
  playerHurt: 0.09, mobDeath: 0.05, coin: 0.04, pickup: 0.05,
};

export function playSfx(name, volumeScale = 1) {
  if (!ctx || muted) return;
  const fn = SOUNDS[name];
  if (!fn) return;
  const gap = MIN_GAP[name] ?? 0.02;
  const t = ctx.currentTime;
  if ((lastPlayed.get(name) || -1) + gap > t) return;
  lastPlayed.set(name, t);
  try { fn(Math.max(0.03, Math.min(1, volumeScale))); } catch { /* audio graph churn */ }
}

export const SFX_NAMES = Object.keys(SOUNDS);
