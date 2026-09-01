import { TILE, SOLID_DECOR, decorPlacement } from '../assets/manifest.js';

/**
 * Body-versus-geometry tests, in one place.
 *
 * These used to live inside World.canStep, with the generator's connectivity
 * check approximating them on the tile grid. The approximation was wrong in
 * both directions and a floor could generate with rooms - or nearly the whole
 * map - that no body could actually walk into. Anything that needs to know
 * whether something can stand somewhere now asks the same code the movement
 * collider asks, so the generator's proof cannot drift away from play.
 */

/**
 * How far the rock rim art bleeds over the floor on each side of a wall, in px.
 *
 * Read straight off gen/autotile.js drawRim(): the side pieces are 24px drawn
 * with a 4px bite into the wall tile, so they cover 20px of the floor beside
 * them; the top and bottom faces cover 18px.
 */
export const RIM_N = 18;   // rock face hanging down from the wall above
export const RIM_S = 18;
export const RIM_W = 20;

/**
 * Narrowest walkable window the rim is ever allowed to leave, in px.
 *
 * Where rock faces a body from both sides the two insets can overlap, or leave
 * a slot only a couple of pixels wide - and a two-pixel slot is not a passage
 * when a body travels three pixels a tick. Anything tighter than this is
 * widened around its own midpoint instead: the body ends up sharing the
 * overlap evenly between the two walls, which is what a narrow passage looks
 * like anyway, and the passage stays walkable.
 *
 * A one-tile-tall east-west corridor was the case that mattered. North is
 * measured from the body centre and south from its edge, so the raw window
 * there was about 2.6px, and whether you could get through depended on which
 * pixel you happened to approach on. That is what sealed whole floors.
 */
export const MIN_WINDOW = 14;

/**
 * How much walkable band two neighbouring tiles must share, in px.
 *
 * A body travels about three pixels a tick, so a seam thinner than this is one
 * you cross by luck rather than by steering.
 */
export const MIN_OVERLAP = 10;

/** The collision radius of an actor: bodies sit a little inside their art. */
export const bodyRadius = (a) => a.radius * 0.72;

/** Is any part of a body of radius r inside a solid tile? */
export function hitsRock(d, x, y, r) {
  const solid = (px, py) => {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (tx < 0 || ty < 0 || tx >= d.w || ty >= d.h) return true;
    return d.tiles[ty * d.w + tx] === 0;
  };
  return solid(x - r, y - r) || solid(x + r, y - r)
    || solid(x - r, y + r) || solid(x + r, y + r) || solid(x, y);
}

/** The honest walkable interval inside a tile on each axis, in local px. */
function spanX(d, tx, ty, r) {
  return [
    d.isSolid(tx - 1, ty) ? RIM_W + r : 0,
    d.isSolid(tx + 1, ty) ? TILE - RIM_W - r : TILE,
  ];
}

function spanY(d, tx, ty, r) {
  return [
    d.isSolid(tx, ty - 1) ? RIM_N : 0,
    d.isSolid(tx, ty + 1) ? TILE - RIM_S - r : TILE,
  ];
}

const tight = (span) => span[1] - span[0] < MIN_WINDOW;

/** A too-tight interval reopened to MIN_WINDOW around its own midpoint. */
function widen(span) {
  if (!tight(span)) return span;
  const mid = (span[0] + span[1]) / 2;
  return [mid - MIN_WINDOW / 2, mid + MIN_WINDOW / 2];
}

/**
 * The interval a body may occupy on one axis, given the tile's own rim and the
 * tiles it can step into along the perpendicular axis.
 *
 * Per-tile windows alone are not enough, because they are a step function at
 * the tile boundary while movement is continuous. Two cases sealed floors
 * outright. A one-tile-wide corridor is relaxed to a window through its middle,
 * but the tile at its mouth has rock on one side only, keeps its honest window,
 * and the two overlapped by under two pixels. Worse, where a corridor jogs
 * sideways - rock on the west of one tile, on the east of the next - the two
 * windows do not overlap at all, and no body can cross that seam however it
 * approaches. Every tile was still connected to every other, which is exactly
 * why the generator's old tile-level check saw nothing wrong with a floor a
 * player could not walk across.
 *
 * So neighbouring windows are guaranteed to share a band wide enough to steer
 * through. Where they fall short, both are widened by half the shortfall - the
 * same amount from either side, so the two tiles always agree - which spends
 * overlap into the rock art only at the squeeze that needs it.
 */
function window1d(own, neighbours) {
  const [lo, hi] = widen(own);
  let grow = 0;
  for (const n of neighbours) {
    if (!n) continue;
    const [a, b] = widen(n);
    const shared = Math.min(hi, b) - Math.max(lo, a);
    if (shared < MIN_OVERLAP) grow = Math.max(grow, (MIN_OVERLAP - shared) / 2);
  }
  return [lo - grow, hi + grow];
}

export function hitsRim(d, x, y, r) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  const lx = x - tx * TILE, ly = y - ty * TILE;

  // Perpendicular neighbours only, and only real floor: those are the tiles a
  // body could be lining itself up to move into.
  const [xLo, xHi] = window1d(spanX(d, tx, ty, r), [
    d.isFloor(tx, ty - 1) ? spanX(d, tx, ty - 1, r) : null,
    d.isFloor(tx, ty + 1) ? spanX(d, tx, ty + 1, r) : null,
  ]);
  if (lx < xLo || lx > xHi) return true;

  const [yLo, yHi] = window1d(spanY(d, tx, ty, r), [
    d.isFloor(tx - 1, ty) ? spanY(d, tx - 1, ty, r) : null,
    d.isFloor(tx + 1, ty) ? spanY(d, tx + 1, ty, r) : null,
  ]);
  return ly < yLo || ly > yHi;
}

/**
 * Collision rectangles for every solid prop on a floor, bucketed by tile.
 *
 * The generator and the simulation build these the same way for the same
 * reason as everything else here: a prop the generator proved you could walk
 * past has to be a prop you can walk past.
 */
/** The collision box of one solid decoration piece, or null if it has none. */
export function decorRect(kind, tx, ty) {
  const pl = decorPlacement(kind, tx, ty);
  if (!pl) return null;
  // Inset a little: sprite edges are soft, and the collision box reading
  // slightly smaller than the art is far kinder than the reverse.
  const ix = pl.sw * 0.12, iy = pl.sh * 0.12;
  return { x: pl.dx + ix, y: pl.dy + iy, w: pl.sw - ix * 2, h: pl.sh - iy * 2 };
}

export function buildSolidRects(d, { includeProps = true, blockingProps } = {}) {
  const rects = [];
  const buckets = new Map();
  const tiles = new Uint8Array(d.w * d.h);

  const add = (x, y, w, h) => {
    const rect = { x, y, w, h };
    rects.push(rect);
    const tx0 = Math.floor(x / TILE), tx1 = Math.floor((x + w) / TILE);
    const ty0 = Math.floor(y / TILE), ty1 = Math.floor((y + h) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!d.inBounds(tx, ty)) continue;
        const key = ty * d.w + tx;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(rect);
        tiles[key] = 1;
      }
    }
  };

  for (const dec of d.decor) {
    if (!dec.solid && !SOLID_DECOR.has(dec.kind)) continue;
    const rect = decorRect(dec.kind, dec.x, dec.y);
    if (rect) add(rect.x, rect.y, rect.w, rect.h);
  }

  if (includeProps && blockingProps) {
    for (const prop of d.props) {
      if (!blockingProps.has(prop.type) || prop.noBlock) continue;
      add(prop.x * TILE + 8, prop.y * TILE + 8, TILE - 16, TILE - 16);
    }
  }

  return { rects, buckets, tiles };
}

/** Does a body of radius r overlap any solid prop rectangle? */
export function hitsRect(d, buckets, x, y, r) {
  if (!buckets) return false;
  const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
  const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const list = buckets.get(ty * d.w + tx);
      if (!list) continue;
      for (const q of list) {
        if (x + r > q.x && x - r < q.x + q.w && y + r > q.y && y - r < q.y + q.h) return true;
      }
    }
  }
  return false;
}

/** Everything at once: can a plain body of radius r stand at this pixel? */
export function canOccupy(d, buckets, x, y, r) {
  return !hitsRock(d, x, y, r) && !hitsRect(d, buckets, x, y, r) && !hitsRim(d, x, y, r);
}
