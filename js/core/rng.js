// Seeded deterministic RNG. Every client generates the same dungeon from the
// same seed, so the host only ever has to send the seed over the wire.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32 - small, fast, good enough distribution for level generation. */
export class RNG {
  constructor(seed = 1) {
    this.seed = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;
    this.state = this.seed;
  }

  /** Fresh generator derived from this one - lets subsystems have independent streams. */
  fork(salt) {
    return new RNG((Math.imul(this.state ^ hashString(String(salt)), 2654435761) >>> 0) || 1);
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min = 0, max = 1) { return min + this.next() * (max - min); }
  /** Integer in [min, max] inclusive. */
  int(min, max) { return Math.floor(this.float(min, max + 1)); }
  bool(chance = 0.5) { return this.next() < chance; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** Pick from [{weight, ...}] - weight defaults to 1. */
  weighted(entries, weightFn = (e) => e.weight ?? 1) {
    let total = 0;
    for (const e of entries) total += weightFn(e);
    if (total <= 0) return entries[0];
    let r = this.next() * total;
    for (const e of entries) {
      r -= weightFn(e);
      if (r <= 0) return e;
    }
    return entries[entries.length - 1];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Normal-ish distribution via sum of uniforms. */
  gauss(mean = 0, dev = 1) {
    const u = (this.next() + this.next() + this.next() + this.next()) / 2 - 1;
    return mean + u * dev;
  }
}

export function randomSeedString() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
