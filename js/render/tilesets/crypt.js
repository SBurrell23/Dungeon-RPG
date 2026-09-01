import { TILE } from '../../assets/manifest.js';

/**
 * The crypt tileset: dressed stone, graves and old blood.
 *
 * Structurally unlike the cavern set. Cavern draws rock as a top-down blob with
 * a 47-case autotile; the crypt art is built as rooms - a masonry border around
 * a dark interior, with the south wall carrying a tall brick face because that
 * is the side you look at. So walls here are drawn per-edge from the solid
 * side, not blob-tiled, and the mass behind them is simply dark.
 *
 * Every coordinate below is a tile index into RA_Crypt.png, which is 32x16
 * tiles of 48px (the sheet is a 3x upscale of a 16px original).
 */

const SHEET = 'crypt';
const ANIM = 'cryptAnim';

/** Tile indices, [col, row]. */
const T = {
  // Floor: plain flags and a few worn variants, picked per tile from a hash.
  // Every one of these is verified full-coverage stone; the sheet mixes dark
  // filler tiles in among them, and picking one of those punches a hole in the
  // floor that reads as a missing tile.
  floors: [[6, 0], [7, 0], [10, 0], [7, 1], [9, 1]],
  floorsAlt: [[11, 0], [12, 0], [13, 0], [11, 1], [12, 1]],

  // Wall pieces, named for which side the floor is on.
  faceCap: [2, 6],     // wall tile directly above a south face
  face: [2, 7],        // the tall brick face you look at, floor below
  backEdge: [2, 2],    // floor above: the far side of a wall
  westEdge: [0, 3],    // floor to the west
  eastEdge: [3, 3],    // floor to the east
  cornerNW: [0, 2],
  cornerNE: [3, 2],

  // Dressing scattered on the floor. These are sparse overlays, drawn over
  // the flags rather than replacing them.
  blood: [[6, 2], [7, 2], [8, 2], [6, 3], [7, 3], [8, 3]],
  bones: [[9, 2], [10, 2], [11, 2], [9, 3], [10, 3], [11, 3]],
  rubble: [[9, 14], [10, 14], [12, 14], [13, 14], [11, 15], [13, 15]],
};

/** The mass behind a wall face. Flat, so the masonry reads against it. */
const WALL_DARK = '#171319';

/** Deterministic per-tile hash, so a floor looks the same every time it bakes. */
function hash(x, y) {
  let n = (x * 73856093) ^ (y * 19349663);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function put(ctx, img, tile, dx, dy) {
  if (!img || !tile) return;
  ctx.drawImage(img, tile[0] * TILE, tile[1] * TILE, TILE, TILE, dx, dy, TILE, TILE);
}

export const crypt = {
  id: 'crypt',
  name: 'Crypt',
  decorSheet: 'crypt',

  bake(ctx, { dungeon: d, assets, x0, y0, x1, y1 }) {
    const img = assets.img(SHEET);
    if (!img) return;

    // Deeper floors move from pale stone to the mossier set, which gives the
    // depth tint something to work with rather than tinting one flat grey.
    const alt = d.floorNo >= 5;
    const floors = alt ? T.floorsAlt : T.floors;

    // 1. Floor. No autotiling needed: the crypt floor is flagstones, so a
    //    hashed pick per tile is both cheaper and truer to the art.
    for (let y = y0 - 1; y < y1 + 1; y++) {
      for (let x = x0 - 1; x < x1 + 1; x++) {
        if (!d.isFloor(x, y)) continue;
        const h = hash(x, y);
        put(ctx, img, floors[Math.floor(h * floors.length)], (x - x0) * TILE, (y - y0) * TILE);
      }
    }

    // 2. Wall mass. Everything solid that touches floor is painted dark first,
    //    so the masonry drawn over it has something to sit against.
    for (let y = y0 - 2; y < y1 + 2; y++) {
      for (let x = x0 - 2; x < x1 + 2; x++) {
        if (d.isFloor(x, y)) continue;
        if (!touchesFloor(d, x, y)) continue;
        ctx.fillStyle = WALL_DARK;
        ctx.fillRect((x - x0) * TILE, (y - y0) * TILE, TILE, TILE);
      }
    }

    // 3. Masonry, drawn from the solid side, one edge at a time. Order matters:
    //    the south face is the tall one and should overlap its neighbours.
    for (let y = y0 - 2; y < y1 + 2; y++) {
      for (let x = x0 - 2; x < x1 + 2; x++) {
        if (d.isFloor(x, y)) continue;
        const dx = (x - x0) * TILE, dy = (y - y0) * TILE;
        const nFloor = d.isFloor(x, y - 1);
        const wFloor = d.isFloor(x - 1, y);
        const eFloor = d.isFloor(x + 1, y);

        if (nFloor) put(ctx, img, T.backEdge, dx, dy);
        if (wFloor) put(ctx, img, T.westEdge, dx, dy);
        if (eFloor) put(ctx, img, T.eastEdge, dx, dy);
      }
    }
    // South faces last, so the brick front sits over the side pieces.
    for (let y = y0 - 2; y < y1 + 2; y++) {
      for (let x = x0 - 2; x < x1 + 2; x++) {
        if (d.isFloor(x, y)) continue;
        const dx = (x - x0) * TILE, dy = (y - y0) * TILE;
        if (d.isFloor(x, y + 1)) {
          put(ctx, img, T.face, dx, dy);
          // The course above it, where there is wall to put it on.
          if (!d.isFloor(x, y - 1)) put(ctx, img, T.faceCap, dx, dy - TILE);
        }
      }
    }

    // 4. Dressing: blood, bones and rubble, thinly and deterministically.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!d.isFloor(x, y)) continue;
        const h = hash(x + 977, y + 311);
        let pool = null;
        if (h < 0.020) pool = T.blood;
        else if (h < 0.045) pool = T.bones;
        else if (h < 0.062) pool = T.rubble;
        if (!pool) continue;
        const pick = pool[Math.floor(hash(x + 41, y + 977) * pool.length)];
        put(ctx, img, pick, (x - x0) * TILE, (y - y0) * TILE);
      }
    }

    // 5. Static decor, from the crypt's own furniture.
    drawCryptDecor(ctx, d, assets, x0, y0, x1, y1);
  },
};

function touchesFloor(d, x, y) {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (d.isFloor(x + ox, y + oy)) return true;
    }
  }
  return false;
}

/**
 * Graves, sarcophagi and pillars.
 *
 * The generator scatters decor by an abstract kind ('rock', 'pillar', ...); the
 * tileset decides what that looks like, which is what lets the two sets share
 * one dungeon without either knowing about the other.
 */
const CRYPT_DECOR = {
  // Sarcophagi and graves, two tiles tall, so they are drawn from the tile above.
  grave: { tiles: [[16, 0], [17, 0], [18, 0], [19, 0]], h: 2 },
  graveLit: { tiles: [[16, 2], [17, 2], [18, 2], [19, 2]], h: 2 },
  tomb: { tiles: [[20, 0], [21, 0], [20, 8], [21, 8]], h: 2 },
  pillar: { tiles: [[25, 0], [25, 4], [25, 8]], h: 2 },
  slab: { tiles: [[16, 6], [17, 6], [18, 6], [19, 6]], h: 1 },
  urn: { tiles: [[22, 0], [22, 4], [22, 8]], h: 1 },
};

const DECOR_FOR = {
  rock: ['pillar', 'tomb', 'urn'],
  rockSmall: ['urn', 'slab'],
  bones: ['slab'],
  crate: ['grave', 'graveLit'],
  barrel: ['tomb', 'urn'],
  mushroom: ['slab'],
  plant: ['slab'],
};

function drawCryptDecor(ctx, d, assets, x0, y0, x1, y1) {
  const img = assets.img(SHEET);
  if (!img) return;
  for (const dec of d.decor) {
    if (dec.x < x0 - 3 || dec.x >= x1 + 3 || dec.y < y0 - 3 || dec.y >= y1 + 3) continue;
    const pool = DECOR_FOR[dec.kind] || DECOR_FOR.rock;
    const name = pool[Math.floor(hash(dec.x, dec.y) * pool.length)];
    const def = CRYPT_DECOR[name];
    if (!def) continue;
    const tile = def.tiles[Math.floor(hash(dec.x + 7, dec.y + 13) * def.tiles.length)];
    const dx = (dec.x - x0) * TILE;
    // Two-tile furniture is anchored at its base, like the cavern props.
    const dy = (dec.y - y0 - (def.h - 1)) * TILE;
    ctx.drawImage(img, tile[0] * TILE, tile[1] * TILE, TILE, TILE * def.h, dx, dy, TILE, TILE * def.h);
  }
}

export { ANIM as CRYPT_ANIM_SHEET };
