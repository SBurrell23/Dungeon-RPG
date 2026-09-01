import { generateFloor, BLOCKING_PROPS } from '../js/gen/dungeon.js';
import { TILE } from '../js/assets/manifest.js';
import { buildSolidRects, canOccupy, hitsRock, hitsRim } from '../js/core/collision.js';

/**
 * Reachability tests for generated floors.
 *
 * A floor can be perfectly connected as tiles and still be one no player can
 * walk across: bodies have width, and the rock rim art eats into the tiles
 * beside every wall. The generator used to check connectivity by walking tile
 * centres, which tests the map rather than the game, and it passed happily on
 * floors where a single corridor jog sealed off most of the level. These walk
 * the real collider instead.
 */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/** The collision radius of an ordinary player - the body that has to fit. */
const R = 13 * 0.72;

// ---------------------------------------------------------------------------

/** A dungeon just real enough for the collider, built from an ASCII map. */
function sketch(rows) {
  const h = rows.length, w = rows[0].length;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) tiles[y * w + x] = rows[y][x] === '#' ? 0 : 1;
  }
  return {
    w, h, tiles,
    idx: (x, y) => y * w + x,
    inBounds: (x, y) => x >= 0 && y >= 0 && x < w && y < h,
    isFloor: (x, y) => x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x] === 1,
    isSolid(x, y) { return !this.isFloor(x, y); },
    tileCenter: (x, y) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 }),
  };
}

/**
 * Flood the walkable area from a pixel and report the tiles a body of radius R
 * can stand in. This is the movement collider, not an approximation of it.
 */
function walkFrom(d, buckets, sx, sy, step = 6) {
  const gw = Math.ceil(d.w * TILE / step), gh = Math.ceil(d.h * TILE / step);
  const seen = new Uint8Array(gw * gh);
  const reached = new Set();
  const stack = [];
  const push = (gx, gy) => {
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return;
    const c = gy * gw + gx;
    if (seen[c]) return;
    seen[c] = 1;
    if (canOccupy(d, buckets, gx * step + step / 2, gy * step + step / 2, R)) stack.push(gx, gy);
  };
  push(Math.floor(sx / step), Math.floor(sy / step));
  while (stack.length) {
    const gy = stack.pop(), gx = stack.pop();
    const px = gx * step + step / 2, py = gy * step + step / 2;
    reached.add(Math.floor(py / TILE) * d.w + Math.floor(px / TILE));
    push(gx + 1, gy); push(gx - 1, gy); push(gx, gy + 1); push(gx, gy - 1);
  }
  return reached;
}

/** Somewhere inside a tile a body can stand, or null if there is nowhere. */
function standIn(d, buckets, tx, ty) {
  for (let ly = 3; ly < TILE; ly += 3) {
    for (let lx = 3; lx < TILE; lx += 3) {
      const x = tx * TILE + lx, y = ty * TILE + ly;
      if (canOccupy(d, buckets, x, y, R)) return { x, y };
    }
  }
  return null;
}

/** Every floor tile the tile grid says is connected to the entrance. */
function tileConnected(d) {
  const seen = new Set([d.entrance.y * d.w + d.entrance.x]);
  const stack = [[d.entrance.x, d.entrance.y]];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!d.isFloor(nx, ny)) continue;
      const i = ny * d.w + nx;
      if (seen.has(i)) continue;
      seen.add(i);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------

test('a body fits through a one-tile-wide corridor', () => {
  // The rim art covers 20px of each side of a 48px tile, leaving 8px for an
  // 18.7px body, so the corridor is relaxed to a window through its middle.
  // The tile at its mouth is not relaxed - it has rock on one side only, so it
  // keeps its honest window - and the two overlapped by under two pixels.
  // Getting through depended on the exact pixel you happened to arrive on.
  const d = sketch([
    '#########',
    '#.....###',
    '#.....###',
    '#####.###',
    '#####.###',
    '#####.###',
    '#.....###',
    '#.....###',
    '#########',
  ]);
  const from = standIn(d, null, 2, 1);
  if (!from) throw new Error('nowhere to stand in the top room');
  const reached = walkFrom(d, null, from.x, from.y, 3);
  if (!reached.has(7 * d.w + 2)) throw new Error('the corridor cuts off the bottom room');
  return { reachedTiles: reached.size };
});

test('a body gets round a corridor that jogs sideways', () => {
  // Rock on the west of one tile and on the east of the next puts the two
  // tiles' walkable windows on opposite sides of the tile with no overlap at
  // all. No approach could cross that seam, and one seam like it sealed three
  // quarters of a floor while every tile stayed connected to every other.
  const d = sketch([
    '#########',
    '#.......#',
    '####.####',
    '####.####',
    '###..####',
    '###.#####',
    '###.#####',
    '#.......#',
    '#########',
  ]);
  const from = standIn(d, null, 2, 1);
  if (!from) throw new Error('nowhere to stand in the top room');
  const reached = walkFrom(d, null, from.x, from.y, 3);
  if (!reached.has(7 * d.w + 6)) throw new Error('the jog in the corridor cannot be walked');
  return { reachedTiles: reached.size };
});

test('every generated floor can be walked end to end', () => {
  // The one that matters. Whatever the tile grid claims is connected, a body
  // has to be able to reach; anything left over is floor a player can see
  // across the room and never get to.
  const bad = [];
  let floors = 0, floorTiles = 0;
  for (let s = 0; s < 3; s++) {
    for (const f of [1, 4, 7, 10]) {
      const d = generateFloor('walk' + s, f, 3);
      const { buckets, tiles } = buildSolidRects(d, { blockingProps: BLOCKING_PROPS });
      const spawn = d.tileCenter(d.entrance.x, d.entrance.y);
      const start = canOccupy(d, buckets, spawn.x, spawn.y, R)
        ? spawn : standIn(d, buckets, d.entrance.x, d.entrance.y);
      if (!start) throw new Error('floor ' + f + ': nowhere to stand on the entrance tile');
      const reached = walkFrom(d, buckets, start.x, start.y);
      let sealed = 0;
      for (const i of tileConnected(d)) {
        floorTiles++;
        // A tile under a boulder is meant to be unreachable. A tile behind one
        // is the bug.
        if (!reached.has(i) && !tiles[i]) sealed++;
      }
      floors++;
      if (sealed) bad.push('seed walk' + s + ' floor ' + f + ': ' + sealed + ' tiles sealed off');
    }
  }
  if (bad.length) throw new Error(bad.join('; '));
  return { floors, floorTiles };
});

test('a solid prop is never left sealing a passage', () => {
  // pruneBlockingProps adds each boulder, torch and shrine one at a time and
  // keeps it only if the reachable set is unchanged. This holds that promise
  // to the real collider rather than to tile centres.
  const bad = [];
  for (const f of [2, 5, 9]) {
    const d = generateFloor('props', f, 4);
    const bare = buildSolidRects({ ...d, decor: [], props: [] }, { blockingProps: BLOCKING_PROPS });
    const { buckets, tiles } = buildSolidRects(d, { blockingProps: BLOCKING_PROPS });
    const spawn = d.tileCenter(d.entrance.x, d.entrance.y);
    const open = walkFrom(d, bare.buckets, spawn.x, spawn.y);
    const withProps = walkFrom(d, buckets, spawn.x, spawn.y);
    let lost = 0;
    for (const i of open) if (!withProps.has(i) && !tiles[i]) lost++;
    if (lost) bad.push('floor ' + f + ': props cut off ' + lost + ' tiles');
  }
  if (bad.length) throw new Error(bad.join('; '));
  return { floors: 3 };
});

test('nothing is placed standing inside the wall art', () => {
  // Decoration is drawn from its own tile but its art can hang over the rock.
  // A prop sitting where no body could stand is a prop drawn into the wall.
  let props = 0, inside = 0;
  for (const f of [1, 6, 10]) {
    const d = generateFloor('art', f, 2);
    for (const dec of d.decor) {
      props++;
      if (d.isSolid(dec.x, dec.y)) { inside++; continue; }
      const c = d.tileCenter(dec.x, dec.y);
      if (hitsRock(d, c.x, c.y, 2) || hitsRim(d, c.x, c.y, 2)) inside++;
    }
  }
  if (inside) throw new Error(inside + ' of ' + props + ' decorations sit on wall art');
  return { decorations: props };
});

// ---------------------------------------------------------------------------

export function runFloorTests() {
  const results = [];
  for (const t of tests) {
    try {
      results.push({ name: t.name, pass: true, detail: t.fn() });
    } catch (err) {
      results.push({ name: t.name, pass: false, error: String(err && err.message || err) });
    }
  }
  return { passed: results.filter((r) => r.pass).length, total: results.length, results };
}
