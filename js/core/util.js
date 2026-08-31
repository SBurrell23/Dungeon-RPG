export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/** Shortest signed angular difference from a to b, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function angleTowards(from, to, maxStep) {
  const d = angleDelta(from, to);
  return from + clamp(d, -maxStep, maxStep);
}

/** Frame-rate independent smoothing: how much of the way to `to` we move in dt. */
export function damp(from, to, halfLife, dt) {
  if (halfLife <= 0) return to;
  return to + (from - to) * Math.pow(2, -dt / halfLife);
}

let _idCounter = 1;
export const nextId = () => _idCounter++;
export const seedIdCounter = (n) => { _idCounter = Math.max(_idCounter, n | 0); };

export function formatNumber(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

export function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h > 0 ? `${h}:` + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
}

/** Deep-ish clone that is safe for our plain-data game state. */
export function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

export function removeFrom(arr, item) {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
  return i >= 0;
}

/** Swap-remove every element failing `keep` - O(n), no allocation. */
export function retain(arr, keep) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    if (keep(arr[i])) arr[w++] = arr[i];
  }
  arr.length = w;
  return arr;
}
