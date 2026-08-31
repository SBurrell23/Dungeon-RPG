import { RNG } from '../core/rng.js';
import { TILE, SOLID_DECOR, decorPlacement } from '../assets/manifest.js';

export const VOID = 0;
export const FLOOR = 1;

/**
 * Procedural dungeon floor generator.
 *
 * The layout is a BSP room graph rather than a pure cave: BSP guarantees rooms
 * never overlap and gives an obvious spanning tree to carve corridors along, so
 * connectivity is structural instead of something we have to pray for. Extra
 * chord edges are then added between nearby rooms to break the tree into a
 * graph with loops, which is what stops a floor feeling like a corridor maze.
 * Cave-shaped rooms and a smoothing pass hide the underlying grid.
 *
 * Everything is driven by a seeded RNG: the host sends a seed string and every
 * client regenerates a byte-identical floor, so no map data crosses the wire.
 */

/**
 * Visual theme per depth band.
 *
 * `base` and `accents` index FLOOR_VARIANTS: 0-5 are the cavern sheet's dirt
 * tones, 6-8 are grass, 9-11 dark earth, 12-17 browns and greys. Accents are
 * kept tonally close to their base - one green in an otherwise brown floor
 * reads as moss, three greens read as a lawn.
 */
/**
 * `tint` is multiplied over the baked terrain. The colours are close to white
 * on purpose - enough to give each depth its own cast (green damp, then clay,
 * then cold stone, then something sicklier) without recolouring the art or
 * darkening it.
 */
export const THEMES = [
  // `moss` is the one deliberately off-palette accent; it is painted in much
  // smaller patches than the earth tones so it reads as growth, not lawn.
  { name: 'Mossy Grotto', base: 0, accents: [2, 12], moss: 6, ambient: '#2e3026', tint: '#d8f0c8' },
  { name: 'Root Hollows', base: 1, accents: [3, 13], moss: 8, ambient: '#2b2d23', tint: '#e2edbe' },
  { name: 'Clay Warrens', base: 2, accents: [0, 12, 9], moss: 7, ambient: '#30271f', tint: '#ffd9ae' },
  { name: 'Sunken Halls', base: 3, accents: [2, 10, 14], ambient: '#2b231c', tint: '#e8c9a6' },
  { name: 'Deepstone', base: 4, accents: [5, 13, 15], ambient: '#26262e', tint: '#c4d2ea' },
  { name: 'The Undervault', base: 5, accents: [4, 15, 16], ambient: '#222229', tint: '#b8bcdc' },
  { name: 'Ashen Depths', base: 5, accents: [3, 14, 16], ambient: '#2b1d1b', tint: '#e6b8a8' },
  { name: 'Bonefields', base: 4, accents: [5, 16, 17], ambient: '#261a19', tint: '#e0d6c0' },
  { name: 'The Black Reach', base: 3, accents: [5, 17, 11], ambient: '#1d1a26', tint: '#a8a4d0' },
  { name: 'Throne of Rot', base: 3, accents: [4, 11, 10], ambient: '#1f1626', tint: '#bcd8a8' },
];

const ROOM_KIND = {
  NORMAL: 'normal',
  ENTRANCE: 'entrance',
  BOSS: 'boss',
  SHOP: 'shop',
  VAULT: 'vault',
  SHRINE: 'shrine',
  TRAPPED: 'trapped',
};

export class Dungeon {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.variant = new Uint8Array(w * h);
    this.roomId = new Int16Array(w * h).fill(-1);
    this.corridor = new Uint8Array(w * h);
    this.rooms = [];
    this.edges = [];
    this.decor = [];
    this.props = [];
    this.spawns = [];
    this.entrance = { x: 2, y: 2 };
    this.stairs = { x: 2, y: 2 };
    this.floor = 1;
    this.theme = THEMES[0];
    this.seed = '';
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  isFloor(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.tiles[y * this.w + x] === FLOOR; }
  isSolid(x, y) { return !this.isFloor(x, y); }
  set(x, y, v) { if (this.inBounds(x, y)) this.tiles[y * this.w + x] = v; }

  /** Pixel centre of a tile. */
  tileCenter(x, y) { return { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 }; }
  worldToTile(px, py) { return { x: Math.floor(px / TILE), y: Math.floor(py / TILE) }; }

  /** Solid test in pixel space, used by the movement collider. */
  solidAtPixel(px, py) {
    return this.isSolid(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  roomAt(x, y) {
    if (!this.inBounds(x, y)) return null;
    const id = this.roomId[y * this.w + x];
    return id >= 0 ? this.rooms[id] : null;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {string} seed   world seed; the same seed + floor always yields the same map
 * @param {number} floorNo 1..10
 * @param {number} partySize scales room count and monster budget a little
 */
export function generateFloor(seed, floorNo, partySize = 1) {
  const rng = new RNG(`${seed}:floor:${floorNo}`);
  const depth = Math.max(0, Math.min(THEMES.length - 1, floorNo - 1));

  // Floors grow with depth so later runs feel like a real descent.
  const size = Math.min(148, 76 + floorNo * 6 + (partySize - 1) * 4);
  const d = new Dungeon(size, size);
  d.floor = floorNo;
  d.seed = seed;
  d.theme = THEMES[depth];

  const leaves = buildBsp(rng, d, floorNo);
  carveRooms(rng, d, leaves, floorNo);
  connectRooms(rng, d, leaves, floorNo);
  smooth(d);
  pruneDisconnected(d);
  carvePits(rng, d, floorNo);
  pruneDisconnected(d);
  sealBorder(d);
  indexRooms(d);
  assignRoles(rng, d, floorNo);
  paintVariants(rng, d);
  decorate(rng, d, floorNo);
  pruneBlockingProps(d);
  populate(rng, d, floorNo, partySize);

  return d;
}

/**
 * Remove any solid prop that walls off part of the floor.
 *
 * Boulders can be three tiles wide, and a torch sits in a doorway often enough
 * to matter - either can seal a corridor and strand the stairs. Rather than
 * hoping placement never does that, each solid prop is added one at a time and
 * kept only if the reachable set is unchanged. Connectivity is then a proven
 * property of the generated floor rather than an assumption about it.
 */
function pruneBlockingProps(d) {
  const size = d.w * d.h;
  const blocked = new Uint8Array(size);
  for (let i = 0; i < size; i++) blocked[i] = d.tiles[i] ? 0 : 1;

  const start = d.idx(d.entrance.x, d.entrance.y);
  const seen = new Uint8Array(size);
  const stack = new Int32Array(size);

  /** Flood fill over unblocked floor from the entrance; returns tiles reached. */
  const reach = () => {
    seen.fill(0);
    if (blocked[start]) return 0;
    let top = 0, count = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const p = stack[--top];
      count++;
      const x = p % d.w, y = (p / d.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= d.w || ny >= d.h) continue;
        const ni = ny * d.w + nx;
        if (blocked[ni] || seen[ni]) continue;
        seen[ni] = 1;
        stack[top++] = ni;
      }
    }
    return count;
  };

  // Reachable count with nothing placed. As props are accepted this drops by
  // exactly the tiles they occupy - anything more means the prop cut the floor.
  let baseline = reach();

  /**
   * Tiles a prop touches. Deliberately conservative - every tile its collision
   * rect overlaps at all counts, so this over-estimates what is blocked
   * relative to the runtime rectangle test. Erring that way keeps the
   * connectivity proof valid: anything this pass proves reachable stays
   * reachable in play.
   */
  const footprint = (kind, tx, ty) => {
    const pl = decorPlacement(kind, tx, ty);
    if (!pl) return [d.idx(tx, ty)];
    const ix = pl.sw * 0.12, iy = pl.sh * 0.12;
    const x0 = pl.dx + ix, y0 = pl.dy + iy;
    const x1 = pl.dx + pl.sw - ix, y1 = pl.dy + pl.sh - iy;
    const out = [];
    for (let y = Math.floor(y0 / TILE); y <= Math.floor((y1 - 1) / TILE); y++) {
      for (let x = Math.floor(x0 / TILE); x <= Math.floor((x1 - 1) / TILE); x++) {
        if (d.inBounds(x, y)) out.push(d.idx(x, y));
      }
    }
    return out;
  };

  const keptDecor = [];
  for (const dec of d.decor) {
    if (!SOLID_DECOR.has(dec.kind)) { keptDecor.push(dec); continue; }
    const tiles = footprint(dec.kind, dec.x, dec.y).filter((i) => !blocked[i]);
    if (!tiles.length) { keptDecor.push(dec); continue; }
    for (const i of tiles) blocked[i] = 1;
    const after = reach();
    if (after === baseline - tiles.length) {
      keptDecor.push(dec);
      baseline = after;
    } else {
      for (const i of tiles) blocked[i] = 0;
    }
  }
  d.decor = keptDecor;

  const keptProps = [];
  for (const prop of d.props) {
    if (!BLOCKING_PROPS.has(prop.type)) { keptProps.push(prop); continue; }
    const i = d.idx(prop.x, prop.y);
    if (blocked[i]) { keptProps.push(prop); continue; }
    blocked[i] = 1;
    const after = reach();
    if (after === baseline - 1) {
      keptProps.push(prop);
      baseline = after;
    } else {
      blocked[i] = 0;
      // A torch that would seal a doorway is simply not placed; a chest that
      // would is moved out of the blocking set rather than lost.
      if (prop.type !== 'torch') { prop.noBlock = true; keptProps.push(prop); }
    }
  }
  d.props = keptProps;
}

/** Prop types that occupy their tile. Mirrored by World.rebuildBlocked(). */
export const BLOCKING_PROPS = new Set(['chest', 'shrine', 'torch']);

// ---------------------------------------------------------------------------
// 1. BSP partition
// ---------------------------------------------------------------------------

function buildBsp(rng, d, floorNo) {
  const margin = 3;
  const root = { x: margin, y: margin, w: d.w - margin * 2, h: d.h - margin * 2 };
  // Leaves are deliberately small: roughly half the area of the old ones, so a
  // floor packs about twice as many rooms into the same footprint. Chambers you
  // can take in at a glance, joined by short halls, read as a dungeon; large
  // open halls read as a field with walls around it.
  // Room size stays roughly constant with depth; it is the floor that grows, so
  // deeper floors get *more* rooms rather than bigger or smaller ones.
  const minLeaf = Math.max(11, 14 - Math.floor(floorNo * 0.3));
  const maxLeaf = minLeaf * 2 + 8;
  const leaves = [];

  const split = (node, depth) => {
    const canSplitH = node.h >= minLeaf * 2;
    const canSplitV = node.w >= minLeaf * 2;
    const tooBig = node.w > maxLeaf || node.h > maxLeaf;
    if ((!canSplitH && !canSplitV) || (!tooBig && (depth > 3 && rng.bool(0.14)))) {
      leaves.push(node);
      return;
    }
    // Split across the long axis so rooms stay roughly square.
    let vertical;
    if (canSplitV && !canSplitH) vertical = true;
    else if (canSplitH && !canSplitV) vertical = false;
    else if (node.w / node.h > 1.25) vertical = true;
    else if (node.h / node.w > 1.25) vertical = false;
    else vertical = rng.bool();

    if (vertical) {
      const cut = rng.int(minLeaf, node.w - minLeaf);
      const a = { x: node.x, y: node.y, w: cut, h: node.h };
      const b = { x: node.x + cut, y: node.y, w: node.w - cut, h: node.h };
      node.children = [a, b];
      split(a, depth + 1);
      split(b, depth + 1);
    } else {
      const cut = rng.int(minLeaf, node.h - minLeaf);
      const a = { x: node.x, y: node.y, w: node.w, h: cut };
      const b = { x: node.x, y: node.y + cut, w: node.w, h: node.h - cut };
      node.children = [a, b];
      split(a, depth + 1);
      split(b, depth + 1);
    }
  };

  split(root, 0);
  d.bspRoot = root;
  return leaves;
}

// ---------------------------------------------------------------------------
// 2. Rooms
// ---------------------------------------------------------------------------

const SHAPES = ['rect', 'rect', 'oval', 'cave', 'cave', 'cross', 'hall'];

function carveRooms(rng, d, leaves, floorNo) {
  for (const leaf of leaves) {
    // A few leaves stay empty so the floor plan is not a perfect grid of rooms.
    if (leaves.length > 8 && rng.bool(0.08)) continue;

    const pad = 2;
    const maxW = leaf.w - pad * 2;
    const maxH = leaf.h - pad * 2;
    if (maxW < 5 || maxH < 5) continue;

    // Most rooms sit well inside their leaf, which both shrinks them and puts
    // real rock between neighbours. A minority take the whole leaf, so a floor
    // still has the occasional hall worth walking into.
    const grand = rng.bool(0.16);
    const lo = grand ? 0.85 : 0.5;
    const hi = grand ? 1.0 : 0.78;
    const rw = rng.int(Math.max(5, Math.floor(maxW * lo)), Math.max(5, Math.floor(maxW * hi)));
    const rh = rng.int(Math.max(5, Math.floor(maxH * lo)), Math.max(5, Math.floor(maxH * hi)));
    const rx = leaf.x + pad + rng.int(0, maxW - rw);
    const ry = leaf.y + pad + rng.int(0, maxH - rh);

    const shape = rng.pick(SHAPES);
    const room = {
      id: d.rooms.length,
      x: rx, y: ry, w: rw, h: rh,
      cx: Math.floor(rx + rw / 2), cy: Math.floor(ry + rh / 2),
      shape, kind: ROOM_KIND.NORMAL, area: 0, leaf,
      variant: 0, cleared: false,
    };
    carveShape(rng, d, room, floorNo);
    if (room.area >= 12) {
      leaf.room = room;
      d.rooms.push(room);
    } else {
      // Too small after shaping - erase it again so we do not leave a stub.
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) d.set(x, y, VOID);
    }
  }

  // Degenerate seeds are possible with very small maps; guarantee two rooms.
  if (d.rooms.length < 2) {
    for (let i = d.rooms.length; i < 2; i++) {
      const rw = 9, rh = 9;
      const rx = 4 + i * 14, ry = 4;
      const room = { id: d.rooms.length, x: rx, y: ry, w: rw, h: rh, cx: rx + 4, cy: ry + 4, shape: 'rect', kind: ROOM_KIND.NORMAL, area: 0, variant: 0, cleared: false };
      carveShape(rng, d, room, floorNo);
      d.rooms.push(room);
    }
  }
}

function carveShape(rng, d, room, floorNo) {
  const { x, y, w, h, shape } = room;
  let area = 0;
  const put = (tx, ty) => { if (d.inBounds(tx, ty)) { d.set(tx, ty, FLOOR); area++; } };

  if (shape === 'rect' || shape === 'hall') {
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) put(tx, ty);
    if (shape === 'hall' && w >= 9 && h >= 9) {
      // Pillared hall: regular void columns, kept away from the walls.
      const stepX = rng.int(3, 4), stepY = rng.int(3, 4);
      for (let ty = y + 2; ty < y + h - 2; ty += stepY) {
        for (let tx = x + 2; tx < x + w - 2; tx += stepX) {
          d.set(tx, ty, VOID); area--;
        }
      }
    }
  } else if (shape === 'oval') {
    const rx = w / 2, ry = h / 2, cx = x + rx - 0.5, cy = y + ry - 0.5;
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        const dx = (tx - cx) / rx, dy = (ty - cy) / ry;
        if (dx * dx + dy * dy <= 1.02) put(tx, ty);
      }
    }
  } else if (shape === 'cross') {
    const armW = Math.max(3, Math.floor(w / 3));
    const armH = Math.max(3, Math.floor(h / 3));
    const mx = x + Math.floor((w - armW) / 2);
    const my = y + Math.floor((h - armH) / 2);
    for (let ty = my; ty < my + armH; ty++) for (let tx = x; tx < x + w; tx++) put(tx, ty);
    for (let ty = y; ty < y + h; ty++) for (let tx = mx; tx < mx + armW; tx++) if (d.tiles[d.idx(tx, ty)] !== FLOOR) put(tx, ty);
  } else {
    // Cave: cellular automata inside the leaf, then keep only the largest blob
    // so a room is never split into disconnected pockets.
    const fill = 0.47 + rng.float(-0.03, 0.03);
    let grid = new Uint8Array(w * h);
    for (let i = 0; i < grid.length; i++) grid[i] = rng.next() < fill ? 1 : 0;
    // Bias the centre open so the room has a usable core.
    const cx = w / 2, cy = h / 2;
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const dx = (tx - cx) / (w / 2), dy = (ty - cy) / (h / 2);
        if (dx * dx + dy * dy < 0.30) grid[ty * w + tx] = 1;
        if (dx * dx + dy * dy > 1.0) grid[ty * w + tx] = 0;
      }
    }
    for (let pass = 0; pass < 4; pass++) {
      const next = new Uint8Array(grid);
      for (let ty = 0; ty < h; ty++) {
        for (let tx = 0; tx < w; tx++) {
          let n = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              if (ox === 0 && oy === 0) continue;
              const nx = tx + ox, ny = ty + oy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              n += grid[ny * w + nx];
            }
          }
          next[ty * w + tx] = n >= 5 ? 1 : n <= 2 ? 0 : grid[ty * w + tx];
        }
      }
      grid = next;
    }
    grid = largestBlob(grid, w, h);
    for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) if (grid[ty * w + tx]) put(x + tx, y + ty);
  }

  room.area = area;
}

function largestBlob(grid, w, h) {
  const seen = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0;
  const stack = [];
  let label = 0;
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || seen[i] >= 0) continue;
    let size = 0;
    stack.length = 0;
    stack.push(i);
    seen[i] = label;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const px = p % w, py = (p / w) | 0;
      const push = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const ni = ny * w + nx;
        if (grid[ni] && seen[ni] < 0) { seen[ni] = label; stack.push(ni); }
      };
      push(px + 1, py); push(px - 1, py); push(px, py + 1); push(px, py - 1);
    }
    if (size > bestSize) { bestSize = size; best = label; }
    label++;
  }
  const out = new Uint8Array(w * h);
  if (best < 0) return out;
  for (let i = 0; i < out.length; i++) out[i] = seen[i] === best ? 1 : 0;
  return out;
}

// ---------------------------------------------------------------------------
// 3. Corridors
// ---------------------------------------------------------------------------

function connectRooms(rng, d, leaves, floorNo) {
  const rooms = d.rooms;
  if (rooms.length < 2) return;

  // Spanning tree from the BSP hierarchy: connect a representative room from
  // each subtree at every internal node. This can never leave a room stranded.
  const connect = (node) => {
    if (!node.children) return node.room ? [node.room] : [];
    const a = connect(node.children[0]);
    const b = connect(node.children[1]);
    if (a.length && b.length) {
      // Join the closest pair across the split for short, natural corridors.
      let best = null, bestD = Infinity;
      for (const ra of a) {
        for (const rb of b) {
          const dd = (ra.cx - rb.cx) ** 2 + (ra.cy - rb.cy) ** 2;
          if (dd < bestD) { bestD = dd; best = [ra, rb]; }
        }
      }
      if (best) carveCorridor(rng, d, best[0], best[1], floorNo);
    }
    return a.concat(b);
  };
  connect(d.bspRoot);

  // Chords: extra links between nearby rooms turn the tree into a graph with
  // loops, which reads as a real dungeon instead of a branching maze.
  const extra = Math.max(2, Math.floor(rooms.length * 0.16));
  const candidates = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const dd = Math.hypot(rooms[i].cx - rooms[j].cx, rooms[i].cy - rooms[j].cy);
      if (dd < 24) candidates.push({ a: rooms[i], b: rooms[j], d: dd });
    }
  }
  candidates.sort((p, q) => p.d - q.d);
  const used = new Set(d.edges.map((e) => e[0] + ':' + e[1]));
  let added = 0;
  for (const c of candidates) {
    if (added >= extra) break;
    const key = Math.min(c.a.id, c.b.id) + ':' + Math.max(c.a.id, c.b.id);
    if (used.has(key)) continue;
    if (rng.bool(0.55)) {
      used.add(key);
      carveCorridor(rng, d, c.a, c.b, floorNo);
      added++;
    }
  }
}

function carveCorridor(rng, d, a, b, floorNo) {
  d.edges.push([Math.min(a.id, b.id), Math.max(a.id, b.id)]);
  // Wider halls deeper down: room to fight in, and fewer doorway pile-ups.
  const width = floorNo >= 7 && rng.bool(0.3) ? 3 : 2;

  const ax = a.cx, ay = a.cy, bx = b.cx, by = b.cy;
  const horizontalFirst = rng.bool();
  const elbowX = horizontalFirst ? bx : ax;
  const elbowY = horizontalFirst ? ay : by;

  carveLine(d, ax, ay, elbowX, elbowY, width);
  carveLine(d, elbowX, elbowY, bx, by, width);
}

function carveLine(d, x0, y0, x1, y1, width) {
  const half = Math.floor(width / 2);
  const stamp = (cx, cy) => {
    for (let oy = -half; oy <= width - 1 - half; oy++) {
      for (let ox = -half; ox <= width - 1 - half; ox++) {
        const x = cx + ox, y = cy + oy;
        if (x <= 1 || y <= 1 || x >= d.w - 2 || y >= d.h - 2) continue;
        const i = d.idx(x, y);
        if (d.tiles[i] !== FLOOR) d.corridor[i] = 1;
        d.tiles[i] = FLOOR;
      }
    }
  };
  if (x0 === x1) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) stamp(x0, y);
  } else if (y0 === y1) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) stamp(x, y0);
  } else {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      stamp(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps));
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Cleanup passes
// ---------------------------------------------------------------------------

/** Round off single-tile nubs and fill single-tile pinholes. */
function smooth(d) {
  const src = d.tiles.slice();
  const count = (x, y) => {
    let n = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        if (d.inBounds(x + ox, y + oy) && src[(y + oy) * d.w + (x + ox)] === FLOOR) n++;
      }
    }
    return n;
  };
  for (let y = 1; y < d.h - 1; y++) {
    for (let x = 1; x < d.w - 1; x++) {
      const i = d.idx(x, y);
      const n = count(x, y);
      // A wall tile hemmed in by floor is a pinhole; open it.
      if (src[i] === VOID && n >= 7) d.tiles[i] = FLOOR;
      // A floor tile hanging off by a thread is a nub; close it.
      else if (src[i] === FLOOR && n <= 1) d.tiles[i] = VOID;
    }
  }

  // Open up diagonal-only links so a body can actually fit through.
  for (let y = 1; y < d.h - 1; y++) {
    for (let x = 1; x < d.w - 1; x++) {
      if (!d.isFloor(x, y)) continue;
      if (d.isFloor(x + 1, y + 1) && !d.isFloor(x + 1, y) && !d.isFloor(x, y + 1)) d.set(x + 1, y, FLOOR);
      if (d.isFloor(x + 1, y - 1) && !d.isFloor(x + 1, y) && !d.isFloor(x, y - 1)) d.set(x + 1, y, FLOOR);
    }
  }
}

/** Keep only the largest connected floor region; erase the rest. */
function pruneDisconnected(d) {
  const seen = new Uint8Array(d.w * d.h);
  let best = null, bestSize = 0;
  const stack = [];
  for (let i = 0; i < d.tiles.length; i++) {
    if (d.tiles[i] !== FLOOR || seen[i]) continue;
    const region = [];
    stack.length = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const p = stack.pop();
      region.push(p);
      const x = p % d.w, y = (p / d.w) | 0;
      const push = (nx, ny) => {
        if (!d.inBounds(nx, ny)) return;
        const ni = ny * d.w + nx;
        if (d.tiles[ni] === FLOOR && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
      };
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
    if (region.length > bestSize) { bestSize = region.length; best = region; }
  }
  if (!best) return;
  const keep = new Uint8Array(d.w * d.h);
  for (const i of best) keep[i] = 1;
  for (let i = 0; i < d.tiles.length; i++) if (d.tiles[i] === FLOOR && !keep[i]) d.tiles[i] = VOID;
}

/**
 * Chasms inside larger rooms. Carved before the connectivity re-check so a pit
 * that would cut the floor in half simply gets thrown away.
 */
function carvePits(rng, d, floorNo) {
  if (floorNo < 2) return;
  const budget = Math.floor(d.rooms.length * 0.35);
  let made = 0;
  for (const room of d.rooms) {
    if (made >= budget) break;
    if (room.area < 60 || !rng.bool(0.45)) continue;
    const pw = rng.int(2, Math.min(5, Math.floor(room.w / 3)));
    const ph = rng.int(2, Math.min(5, Math.floor(room.h / 3)));
    const px = room.x + rng.int(2, Math.max(2, room.w - pw - 2));
    const py = room.y + rng.int(2, Math.max(2, room.h - ph - 2));
    const snapshot = [];
    for (let y = py; y < py + ph; y++) {
      for (let x = px; x < px + pw; x++) {
        if (!d.inBounds(x, y)) continue;
        snapshot.push([d.idx(x, y), d.tiles[d.idx(x, y)]]);
        d.set(x, y, VOID);
      }
    }
    if (!stillConnected(d)) {
      for (const [i, v] of snapshot) d.tiles[i] = v;
    } else {
      room.hasPit = true;
      made++;
    }
  }
}

function stillConnected(d) {
  let start = -1;
  let total = 0;
  for (let i = 0; i < d.tiles.length; i++) if (d.tiles[i] === FLOOR) { if (start < 0) start = i; total++; }
  if (start < 0) return false;
  const seen = new Uint8Array(d.tiles.length);
  const stack = [start];
  seen[start] = 1;
  let n = 0;
  while (stack.length) {
    const p = stack.pop();
    n++;
    const x = p % d.w, y = (p / d.w) | 0;
    const push = (nx, ny) => {
      if (!d.inBounds(nx, ny)) return;
      const ni = ny * d.w + nx;
      if (d.tiles[ni] === FLOOR && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
    };
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return n === total;
}

function sealBorder(d) {
  for (let x = 0; x < d.w; x++) {
    for (let b = 0; b < 2; b++) {
      d.set(x, b, VOID);
      d.set(x, d.h - 1 - b, VOID);
    }
  }
  for (let y = 0; y < d.h; y++) {
    for (let b = 0; b < 2; b++) {
      d.set(b, y, VOID);
      d.set(d.w - 1 - b, y, VOID);
    }
  }
}

/** Recompute per-room tile lists after all the carving and pruning. */
function indexRooms(d) {
  d.roomId.fill(-1);
  const alive = [];
  for (const room of d.rooms) {
    room.tiles = [];
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (!d.isFloor(x, y)) continue;
        const i = d.idx(x, y);
        if (d.roomId[i] >= 0) continue; // overlapping bounds: first room wins
        d.roomId[i] = room.id;
        room.tiles.push([x, y]);
      }
    }
    room.area = room.tiles.length;
    if (room.area >= 9) alive.push(room);
  }
  // Renumber so ids stay contiguous after dropping dead rooms.
  d.rooms = alive;
  d.roomId.fill(-1);
  d.rooms.forEach((room, newId) => {
    const oldId = room.id;
    room.id = newId;
    for (const [x, y] of room.tiles) d.roomId[d.idx(x, y)] = newId;
    room._oldId = oldId;
  });
  const remap = new Map(d.rooms.map((r) => [r._oldId, r.id]));
  d.edges = d.edges
    .map(([a, b]) => [remap.get(a), remap.get(b)])
    .filter(([a, b]) => a !== undefined && b !== undefined && a !== b);
  // Recentre on an actual floor tile so spawn points are never inside rock.
  for (const room of d.rooms) {
    let best = room.tiles[0], bestD = Infinity;
    const tcx = room.x + room.w / 2, tcy = room.y + room.h / 2;
    for (const [x, y] of room.tiles) {
      const dd = (x - tcx) ** 2 + (y - tcy) ** 2;
      if (dd < bestD) { bestD = dd; best = [x, y]; }
    }
    room.cx = best[0]; room.cy = best[1];
    delete room._oldId;
  }
}

// ---------------------------------------------------------------------------
// 5. Room roles
// ---------------------------------------------------------------------------

function assignRoles(rng, d, floorNo) {
  const rooms = d.rooms;
  if (!rooms.length) return;

  const adj = new Map(rooms.map((r) => [r.id, []]));
  for (const [a, b] of d.edges) { adj.get(a)?.push(b); adj.get(b)?.push(a); }

  /** BFS over the room graph; falls back to scaled euclidean where the graph is sparse. */
  const bfs = (fromId) => {
    const dist = new Map([[fromId, 0]]);
    const queue = [fromId];
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      for (const nb of adj.get(cur) || []) {
        if (!dist.has(nb)) { dist.set(nb, dist.get(cur) + 1); queue.push(nb); }
      }
    }
    const from = rooms[fromId];
    for (const r of rooms) {
      if (!dist.has(r.id)) dist.set(r.id, Math.round(Math.hypot(r.cx - from.cx, r.cy - from.cy) / 12) + 1);
    }
    return dist;
  };

  // Put entrance and boss at the two ends of the room graph's diameter, so the
  // floor always demands a real traversal rather than a two-room hop.
  const probe = bfs(rng.pick(rooms).id);
  const farA = rooms.reduce((best, r) => (probe.get(r.id) > probe.get(best.id) ? r : best), rooms[0]);
  const fromA = bfs(farA.id);
  const farB = rooms.reduce((best, r) => {
    const da = fromA.get(r.id), db = fromA.get(best.id);
    if (da !== db) return da > db ? r : best;
    return r.area > best.area ? r : best;
  }, rooms[0]);

  const entrance = farA;
  entrance.kind = ROOM_KIND.ENTRANCE;
  d.entrance = { x: entrance.cx, y: entrance.cy };
  d.entranceRoom = entrance.id;
  for (const r of rooms) r.depth = fromA.get(r.id);

  const boss = farB.id === entrance.id ? (rooms.find((r) => r.id !== entrance.id) || entrance) : farB;
  boss.kind = ROOM_KIND.BOSS;
  d.bossRoom = boss.id;
  d.stairs = { x: boss.cx, y: boss.cy };

  const free = () => rooms.filter((r) => r.kind === ROOM_KIND.NORMAL);

  // Merchant: mid-depth, so you find him with loot to sell but before the boss.
  const shopPool = free().filter((r) => r.depth >= 1 && r.depth <= Math.max(2, boss.depth - 1) && r.area >= 30);
  if (shopPool.length && (floorNo === 1 || rng.bool(0.75))) {
    const shop = rng.pick(shopPool);
    shop.kind = ROOM_KIND.SHOP;
    d.shopRoom = shop.id;
  }

  // Vault: a guarded treasure room, always off the critical path if possible.
  const vaultPool = free().filter((r) => r.depth >= 2);
  if (vaultPool.length && rng.bool(0.8)) rng.pick(vaultPool).kind = ROOM_KIND.VAULT;

  const shrinePool = free().filter((r) => r.area >= 24);
  if (shrinePool.length && (floorNo >= 2 && rng.bool(0.6))) rng.pick(shrinePool).kind = ROOM_KIND.SHRINE;

  const trapPool = free();
  const trapCount = Math.min(trapPool.length, Math.floor(floorNo / 3) + (rng.bool(0.5) ? 1 : 0));
  for (let i = 0; i < trapCount; i++) {
    const r = rng.pick(trapPool);
    if (r.kind === ROOM_KIND.NORMAL) r.kind = ROOM_KIND.TRAPPED;
  }
}

// ---------------------------------------------------------------------------
// 6. Floor texture variants
// ---------------------------------------------------------------------------

function paintVariants(rng, d) {
  const theme = d.theme;
  d.variant.fill(theme.base);

  /**
   * Accent patches are painted as clusters of jittered discs rather than by
   * filling a room rectangle. Room bounding boxes can overlap, so filling them
   * leaves visible rectangular seams; blobs ignore room borders entirely and
   * the quadrant autotiler gives them properly rounded, blended edges.
   */
  const blob = (cx, cy, radius, variant, jitter = 0.9) => {
    const r = Math.ceil(radius) + 1;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (!d.isFloor(x, y)) continue;
        const dd = Math.hypot(x - cx, y - cy) + rng.float(-jitter, jitter);
        if (dd <= radius) d.variant[d.idx(x, y)] = variant;
      }
    }
  };

  const patch = (room, variant, coverage, rMin = 1.8, rMax = 3.4) => {
    const blobs = Math.max(1, Math.round((room.area / 60) * coverage));
    for (let i = 0; i < blobs; i++) {
      const [x, y] = rng.pick(room.tiles);
      blob(x, y, rng.float(rMin, rMax), variant);
    }
  };

  for (const room of d.rooms) {
    room.variant = theme.base;
    if (!room.tiles.length) continue;

    // Special rooms read as "different ground" - a floor you notice.
    if (room.kind === ROOM_KIND.SHOP || room.kind === ROOM_KIND.SHRINE) {
      room.variant = theme.accents[0];
      patch(room, room.variant, 1.6);
    } else if (room.kind === ROOM_KIND.BOSS) {
      room.variant = theme.accents[theme.accents.length - 1];
      patch(room, room.variant, 1.8);
    } else if (rng.bool(0.6)) {
      room.variant = rng.pick(theme.accents);
      patch(room, room.variant, rng.float(0.5, 1.1));
    }
    // Moss creeps in small clumps, and only in the upper floors that have it.
    if (theme.moss != null && rng.bool(0.4)) {
      patch(room, theme.moss, rng.float(0.15, 0.4), 0.9, 1.9);
    }
  }

  // Loose drift across the whole floor, corridors included.
  const blotches = Math.floor((d.w * d.h) / 500);
  for (let i = 0; i < blotches; i++) {
    const cx = rng.int(3, d.w - 4), cy = rng.int(3, d.h - 4);
    if (!d.isFloor(cx, cy)) continue;
    blob(cx, cy, rng.float(1.4, 3.2), rng.pick(theme.accents));
  }
  if (theme.moss != null) {
    // Moss likes edges: seed it where floor meets rock.
    const mossSpots = Math.floor((d.w * d.h) / 1600);
    for (let i = 0; i < mossSpots; i++) {
      const cx = rng.int(3, d.w - 4), cy = rng.int(3, d.h - 4);
      if (!d.isFloor(cx, cy)) continue;
      const nearWall = d.isSolid(cx + 1, cy) || d.isSolid(cx - 1, cy) || d.isSolid(cx, cy + 1) || d.isSolid(cx, cy - 1);
      if (!nearWall) continue;
      blob(cx, cy, rng.float(0.9, 2.2), theme.moss, 0.7);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Props and decoration
// ---------------------------------------------------------------------------

const WALL_PROPS = ['rockA', 'rockB'];
const GROUND_SCATTER = ['pebblesA', 'pebblesB', 'pebblesC', 'gravelA', 'gravelB', 'gravelC',
  'rockFieldA', 'rockFieldB'];
const FLORA = ['grassA', 'grassB', 'grassC', 'grassD', 'grassE', 'grassF', 'grassG',
  'mushRedA', 'mushRedB', 'mushGreenA', 'mushGreenB', 'mushPinkA', 'mushPinkB'];
const BIG_PROPS = ['boulderA', 'boulderB', 'boulderC', 'boulderD', 'boulderE',
  'boulderF', 'boulderG', 'boulderH', 'boulderI'];
const CONTAINERS = ['crateA', 'crateB', 'crateC', 'crateD', 'crateE', 'crateStackA', 'crateStackB',
  'crateTall', 'barrelA', 'barrelB', 'barrelC', 'barrelD', 'potA', 'potB', 'potC', 'sackA', 'sackB'];

function decorate(rng, d, floorNo) {
  const occupied = new Set();
  const key = (x, y) => y * d.w + x;
  const freeTile = (x, y) => d.isFloor(x, y) && !occupied.has(key(x, y));
  const take = (x, y) => occupied.add(key(x, y));

  // Keep spawn and exit clear.
  for (let oy = -2; oy <= 2; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      take(d.entrance.x + ox, d.entrance.y + oy);
      take(d.stairs.x + ox, d.stairs.y + oy);
    }
  }

  const addDecor = (kind, x, y, solid = false) => {
    d.decor.push({ kind, x, y, solid });
    take(x, y);
  };

  /**
   * A tile with open floor on all four sides. Chests and shrines have to go
   * here: the rock rim bleeds over the edge of any tile that touches a wall,
   * which would bury them in the wall art.
   */
  const interiorFree = (x, y) => freeTile(x, y)
    && d.isFloor(x - 1, y) && d.isFloor(x + 1, y)
    && d.isFloor(x, y - 1) && d.isFloor(x, y + 1)
    && d.isFloor(x - 1, y - 1) && d.isFloor(x + 1, y - 1);

  /** Pick the first interior tile from a shuffled candidate list. */
  const takeInterior = (list) => {
    for (let i = 0; i < list.length; i++) {
      const [x, y] = list[i];
      if (interiorFree(x, y)) { list.splice(i, 1); return [x, y]; }
    }
    return null;
  };

  // Wall-hugging rocks: only where the tile north of us is rock, so the prop
  // visually sits against the cliff face instead of floating.
  for (let y = 2; y < d.h - 2; y++) {
    for (let x = 2; x < d.w - 2; x++) {
      if (!freeTile(x, y)) continue;
      const againstWall = d.isSolid(x, y - 1) || d.isSolid(x + 1, y) || d.isSolid(x - 1, y);
      if (!againstWall) continue;
      if (rng.bool(0.10)) addDecor(rng.pick(WALL_PROPS), x, y);
      else if (rng.bool(0.07)) addDecor(rng.pick(FLORA), x, y);
    }
  }

  // Loose ground scatter everywhere at low density.
  const scatterCount = Math.floor(d.w * d.h * 0.012);
  for (let i = 0; i < scatterCount; i++) {
    const x = rng.int(2, d.w - 3), y = rng.int(2, d.h - 3);
    if (!freeTile(x, y)) continue;
    addDecor(rng.pick(GROUND_SCATTER), x, y);
  }

  for (const room of d.rooms) {
    const interior = room.tiles.filter(([x, y]) =>
      freeTile(x, y) && !d.corridor[d.idx(x, y)] &&
      d.isFloor(x + 1, y) && d.isFloor(x - 1, y) && d.isFloor(x, y + 1) && d.isFloor(x, y - 1));

    // Torches along the north wall light the room and read as inhabited.
    const wallTiles = room.tiles.filter(([x, y]) => d.isSolid(x, y - 1) && freeTile(x, y));
    rng.shuffle(wallTiles);
    const torches = Math.min(wallTiles.length, Math.max(1, Math.floor(room.area / 45)));
    for (let i = 0; i < torches; i++) {
      const [x, y] = wallTiles[i];
      d.props.push({ type: 'torch', anim: rng.bool(0.6) ? 'torch' : 'brazier', x, y });
      take(x, y);
    }

    // Solid obstacles give melee something to break line of sight around, but
    // never in corridors and never enough to wall a room off.
    if (room.kind !== ROOM_KIND.SHOP && interior.length > 12) {
      const blockers = rng.int(0, Math.min(3, Math.floor(room.area / 34)));
      rng.shuffle(interior);
      for (let i = 0; i < blockers && i < interior.length; i++) {
        const [x, y] = interior[i];
        if (!freeTile(x, y)) continue;
        addDecor(rng.pick(BIG_PROPS), x, y, true);
      }
    }

    const spots = room.tiles.filter(([x, y]) => freeTile(x, y));
    rng.shuffle(spots);
    let cursor = 0;
    const nextSpot = () => (cursor < spots.length ? spots[cursor++] : null);

    switch (room.kind) {
      case ROOM_KIND.ENTRANCE: {
        d.props.push({ type: 'entrance', x: d.entrance.x, y: d.entrance.y });
        for (let i = 0; i < 2; i++) {
          const s = nextSpot();
          if (s && freeTile(s[0], s[1])) addDecor(rng.pick(CONTAINERS), s[0], s[1]);
        }
        break;
      }
      case ROOM_KIND.BOSS: {
        d.props.push({ type: 'stairs', x: d.stairs.x, y: d.stairs.y, locked: true });
        for (let i = 0; i < 4; i++) {
          const s = nextSpot();
          if (s) d.props.push({ type: 'torch', anim: 'brazier', x: s[0], y: s[1] }), take(s[0], s[1]);
        }
        break;
      }
      case ROOM_KIND.SHOP: {
        d.props.push({ type: 'merchant', x: room.cx, y: room.cy });
        take(room.cx, room.cy);
        for (let i = 0; i < 5; i++) {
          const s = nextSpot();
          if (s && freeTile(s[0], s[1])) addDecor(rng.pick(CONTAINERS), s[0], s[1]);
        }
        break;
      }
      case ROOM_KIND.VAULT: {
        const chests = rng.int(2, 3);
        for (let i = 0; i < chests; i++) {
          const s = takeInterior(spots);
          if (s) { d.props.push({ type: 'chest', tier: 'rare', x: s[0], y: s[1], opened: false }); take(s[0], s[1]); }
        }
        break;
      }
      case ROOM_KIND.SHRINE: {
        const s = interiorFree(room.cx, room.cy) ? [room.cx, room.cy] : takeInterior(spots);
        if (s) { d.props.push({ type: 'shrine', x: s[0], y: s[1], used: false }); take(s[0], s[1]); }
        break;
      }
      default: break;
    }

    // Ordinary chests, weighted toward the deeper end of the floor.
    const chestChance = 0.20 + room.depth * 0.05;
    if (room.kind === ROOM_KIND.NORMAL || room.kind === ROOM_KIND.TRAPPED) {
      if (rng.bool(Math.min(0.6, chestChance))) {
        const s = takeInterior(spots);
        if (s) { d.props.push({ type: 'chest', tier: 'common', x: s[0], y: s[1], opened: false }); take(s[0], s[1]); }
      }
    }
  }

  // The boss room gets a guaranteed reward chest next to the stairs.
  const bossRoom = d.rooms[d.bossRoom];
  if (bossRoom) {
    const spot = bossRoom.tiles.find(([x, y]) => interiorFree(x, y) && Math.hypot(x - d.stairs.x, y - d.stairs.y) > 2);
    if (spot) {
      d.props.push({ type: 'chest', tier: 'boss', x: spot[0], y: spot[1], opened: false });
      take(spot[0], spot[1]);
    }
  }

  placeTraps(rng, d, floorNo, freeTile, take);
}

const TRAP_KINDS = ['spike', 'dart', 'flame', 'poison'];

function placeTraps(rng, d, floorNo, freeTile, take) {
  const density = 0.0016 + floorNo * 0.0011;
  const target = Math.floor(d.w * d.h * density);
  let placed = 0, attempts = 0;
  while (placed < target && attempts < target * 30) {
    attempts++;
    const x = rng.int(3, d.w - 4), y = rng.int(3, d.h - 4);
    if (!freeTile(x, y)) continue;
    if (Math.hypot(x - d.entrance.x, y - d.entrance.y) < 8) continue;
    const room = d.roomAt(x, y);
    if (room && (room.kind === ROOM_KIND.SHOP || room.kind === ROOM_KIND.ENTRANCE)) continue;
    // Corridors and doorways are the classic trap spot; rooms get fewer.
    const inCorridor = d.corridor[d.idx(x, y)] === 1;
    if (!inCorridor && !rng.bool(0.4)) continue;
    const kinds = floorNo >= 4 ? TRAP_KINDS : TRAP_KINDS.slice(0, 2);
    d.props.push({
      type: 'trap',
      kind: rng.pick(kinds),
      x, y,
      armed: true,
      hidden: rng.bool(0.55),
    });
    take(x, y);
    placed++;
  }

  // Trapped rooms get a dense cluster - a recognisable hazard, not random noise.
  for (const room of d.rooms) {
    if (room.kind !== 'trapped') continue;
    const spots = room.tiles.filter(([x, y]) => freeTile(x, y));
    rng.shuffle(spots);
    const n = Math.min(spots.length, Math.floor(room.area / 8));
    for (let i = 0; i < n; i++) {
      const [x, y] = spots[i];
      d.props.push({ type: 'trap', kind: rng.pick(TRAP_KINDS), x, y, armed: true, hidden: rng.bool(0.3) });
      take(x, y);
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Monster placement
// ---------------------------------------------------------------------------

/**
 * Emits spawn descriptors only - the actual stat blocks are resolved by
 * game/monsters.js so that balance lives in one place.
 */
function populate(rng, d, floorNo, partySize) {
  const partyScale = 1 + (partySize - 1) * 0.45;
  // Scales with floor size, not just depth - a floor-10 map is nearly twice
  // the area of floor 1, and the old flat curve left it feeling empty.
  const budget = Math.floor((26 + floorNo * 13) * partyScale);
  let spent = 0;

  const rooms = d.rooms.filter((r) => r.kind !== 'entrance' && r.kind !== 'shop' && r.kind !== 'boss');
  const totalWeight = rooms.reduce((s, r) => s + (1 + r.depth * 0.6), 0) || 1;

  for (const room of rooms) {
    const share = ((1 + room.depth * 0.6) / totalWeight) * budget;
    const packCount = Math.max(1, Math.round(share / 3.2));
    const spots = room.tiles.filter(([x, y]) => Math.hypot(x - d.entrance.x, y - d.entrance.y) > 10);
    if (!spots.length) continue;
    rng.shuffle(spots);

    let placed = 0;
    for (let p = 0; p < packCount && placed < spots.length; p++) {
      const packSize = rng.int(2, Math.min(5, 2 + Math.floor(floorNo / 2)));
      const anchor = spots[placed++];
      for (let m = 0; m < packSize; m++) {
        const jitterX = anchor[0] + rng.int(-2, 2);
        const jitterY = anchor[1] + rng.int(-2, 2);
        if (!d.isFloor(jitterX, jitterY)) continue;
        d.spawns.push({
          x: jitterX, y: jitterY,
          roomId: room.id,
          depth: room.depth,
          // Elites get more common the deeper you go.
          elite: rng.bool(Math.min(0.22, 0.02 + floorNo * 0.02)),
          tierBias: room.depth,
        });
        spent++;
        if (spent >= budget) break;
      }
      if (spent >= budget) break;
    }
    if (spent >= budget) break;
  }

  // Wandering monsters in the corridors keep travel tense.
  const wanderers = Math.floor(8 + floorNo * 2.4);
  for (let i = 0; i < wanderers; i++) {
    const x = rng.int(3, d.w - 4), y = rng.int(3, d.h - 4);
    if (!d.isFloor(x, y) || !d.corridor[d.idx(x, y)]) continue;
    if (Math.hypot(x - d.entrance.x, y - d.entrance.y) < 12) continue;
    d.spawns.push({ x, y, roomId: -1, depth: 1, elite: false, tierBias: 1, wander: true });
  }

  // The boss chamber: one boss plus a heavy guard, gating the stairs.
  const boss = d.rooms[d.bossRoom];
  if (boss) {
    d.spawns.push({ x: boss.cx, y: boss.cy - 2, roomId: boss.id, depth: boss.depth, boss: true, elite: true, tierBias: 99 });
    const guardCount = Math.round((5 + floorNo) * partyScale * 0.6);
    const spots = boss.tiles.filter(([x, y]) => Math.hypot(x - boss.cx, y - boss.cy) > 2);
    rng.shuffle(spots);
    for (let i = 0; i < guardCount && i < spots.length; i++) {
      d.spawns.push({
        x: spots[i][0], y: spots[i][1],
        roomId: boss.id, depth: boss.depth,
        elite: rng.bool(0.4), tierBias: boss.depth + 2, guard: true,
      });
    }
  }
}

export { ROOM_KIND };
