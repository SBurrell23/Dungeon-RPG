import { TILE } from '../assets/manifest.js';

/**
 * Two bits of atmosphere that cost nothing and change how the place feels.
 *
 * Both are purely presentational - no simulation state, nothing on the wire -
 * so they can differ between clients without consequence, and neither ever
 * obscures something a player needs to see.
 */

// ---------------------------------------------------------------------------
// Drifting mist
// ---------------------------------------------------------------------------

const CLOUDS = 18;

/**
 * Slow banks of mist crossing the floor.
 *
 * Positions are a pure function of time, so there is no particle list to keep
 * and the mist is already in motion the moment you arrive rather than easing in
 * from nothing. They wrap over a window much larger than the screen, which is
 * what stops the same bank sliding past twice in a row.
 */
export function drawMist(ctx, camera, time, seed = 0) {
  const view = camera.viewRect ? camera.viewRect() : null;
  const cx = view ? view.x + view.w / 2 : 0;
  const cy = view ? view.y + view.h / 2 : 0;
  const span = (view ? Math.max(view.w, view.h) : 900) * 2.2;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < CLOUDS; i++) {
    const s = seed * 0.7 + i * 12.9898;
    const speed = 5 + (i % 3) * 3.5;
    const dir = s * 1.7;
    // Drift, wrapped into a window centred on the camera.
    const wander = Math.sin(time * 0.07 + s) * span * 0.15;
    let x = (Math.cos(dir) * (time * speed) + s * 311) % span;
    let y = (Math.sin(dir) * (time * speed * 0.5) + s * 197 + wander) % span;
    if (x < 0) x += span;
    if (y < 0) y += span;
    x += cx - span / 2;
    y += cy - span / 2;

    const r = 150 + (i % 5) * 85;
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.11 + s);
    // Many banks, each barely there. Additive blending stacks where they
    // overlap, so anything stronger reads as a grey wash over the whole screen
    // rather than as mist moving through a dungeon.
    ctx.globalAlpha = 0.014 + pulse * 0.018;
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, '#cfd6e2');
    g.addColorStop(0.55, 'rgba(150,160,180,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Something watching
// ---------------------------------------------------------------------------

/** Eye colours, and how often each turns up. */
const EYE_COLOURS = ['#d8e070', '#6ce07a', '#ff3a2a'];
const EYE_WEIGHTS = [0.58, 0.30, 0.12];

function weightedIndex(r) {
  let acc = 0;
  for (let i = 0; i < EYE_WEIGHTS.length; i++) {
    acc += EYE_WEIGHTS[i];
    if (r < acc) return i;
  }
  return 0;
}

const EYE_LIFE = 5.5;
const EYE_TRIES = 40;

/**
 * Pairs of eyes that open in the solid dark and blink at you.
 *
 * They are only ever placed in rock the party cannot enter, and only outside
 * the lit radius, so they read as something beyond the wall rather than a
 * monster you failed to attack. A pair fades in, blinks a couple of times, and
 * fades out; there is never more than a handful.
 */
export class EyesInTheDark {
  constructor({ max = 3, interval = 4.2 } = {}) {
    this.max = max;
    this.interval = interval;
    this.timer = 1.5;
    this.eyes = [];
  }

  clear() { this.eyes.length = 0; }

  update(dt, world, camera, rand = Math.random) {
    for (const e of this.eyes) e.t += dt;
    this.eyes = this.eyes.filter((e) => e.t < EYE_LIFE);

    this.timer -= dt;
    if (this.timer > 0 || this.eyes.length >= this.max) return;
    this.timer = this.interval * (0.6 + rand() * 0.9);

    const spot = this.findDark(world, camera, rand);
    if (!spot) return;
    this.eyes.push({
      x: spot.x, y: spot.y, t: 0,
      // A little variation so a pair is never quite the same as the last.
      gap: 5 + rand() * 4,
      size: 1.6 + rand() * 1.1,
      // Mostly the pale yellow of something watching; sometimes green, and
      // rarely red, which is the one you notice.
      hue: EYE_COLOURS[weightedIndex(rand())],
      blinkAt: 1.4 + rand() * 1.6,
      blinkAt2: 3.1 + rand() * 1.4,
      tilt: (rand() - 0.5) * 0.4,
    });
  }

  /** A void tile on screen, away from the light and from anyone standing. */
  findDark(world, camera, rand) {
    const d = world.dungeon;
    if (!d) return null;
    const view = camera.viewRect ? camera.viewRect() : null;
    if (!view) return null;

    for (let i = 0; i < EYE_TRIES; i++) {
      const x = view.x + rand() * view.w;
      const y = view.y + rand() * view.h;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (d.isFloor(tx, ty)) continue;
      // Solid on every side, so the eyes are inside real rock rather than in
      // the sliver of void behind a wall face.
      let solid = true;
      for (let oy = -1; oy <= 1 && solid; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (d.isFloor(tx + ox, ty + oy)) { solid = false; break; }
        }
      }
      if (!solid) continue;
      // And far enough from every torch-lit body that it stays a suggestion.
      let tooClose = false;
      for (const p of world.players) {
        if (Math.hypot(p.x - x, p.y - y) < 170) { tooClose = true; break; }
      }
      if (tooClose) continue;
      return { x, y };
    }
    return null;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.eyes) {
      const t = e.t / EYE_LIFE;
      // Fade up, hold, fade away.
      let a = t < 0.18 ? t / 0.18 : t > 0.72 ? (1 - t) / 0.28 : 1;
      // Two blinks, which is what makes them read as alive.
      const blink = (at) => Math.max(0, 1 - Math.abs(e.t - at) / 0.11);
      const lid = Math.max(blink(e.blinkAt), blink(e.blinkAt2));
      const open = 1 - lid;
      if (open <= 0.02) continue;
      a *= 0.85;

      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = e.hue;
      for (const side of [-1, 1]) {
        const ex = e.x + side * e.gap;
        const ey = e.y + side * e.tilt * 2;
        const h = e.size * open;
        // Blocky, like everything else here.
        ctx.fillRect(Math.round(ex - e.size), Math.round(ey - h), Math.round(e.size * 2), Math.max(1, Math.round(h * 2)));
      }
      // A faint glow so they carry in a black corner.
      ctx.globalAlpha = Math.max(0, a * 0.25);
      for (const side of [-1, 1]) {
        const ex = e.x + side * e.gap;
        const g = ctx.createRadialGradient(ex, e.y, 0, ex, e.y, 9);
        g.addColorStop(0, e.hue);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ex, e.y, 9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
