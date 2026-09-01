import { TILE, FLOOR_VARIANTS, VOID_COLOR, decorPlacement } from '../assets/manifest.js';
import { drawLayer, drawRim } from '../gen/autotile.js';

const CHUNK = 12;             // tiles per chunk edge
const CHUNK_PX = CHUNK * TILE;
const MAX_CACHED = 28;
const SEAM_BLEED = 0.5;   // px of overlap between chunks, see draw()

/** Tiles of margin around a chunk when building its void-fade mask. */
const FADE_PAD = 3;
/** Distance from floor, in tiles, at which the dark starts and finishes. */
const FADE_START = 1.6;
const FADE_SPAN = 2.6;
const VOID_RGB = [16, 12, 14];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Stable per-tile noise, so the ragged edge does not crawl between bakes. */
function tileNoise(x, y) {
  let n = (x * 374761393) ^ (y * 668265263);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * Tiles-from-walkable-ground for every tile, by multi-source BFS.
 *
 * Computed once per floor. Capped, since past the fade distance the answer
 * stops mattering and an uncapped flood over a 148x148 map is wasted work.
 */
function buildVoidDistance(d) {
  const MAXD = 12;
  const out = new Uint8Array(d.w * d.h).fill(MAXD);
  let frontier = [];
  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      if (!d.isFloor(x, y)) continue;
      const i = y * d.w + x;
      out[i] = 0;
      frontier.push(i);
    }
  }
  for (let step = 1; step <= MAXD && frontier.length; step++) {
    const next = [];
    for (const i of frontier) {
      const x = i % d.w, y = (i / d.w) | 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= d.w || ny >= d.h) continue;
        const ni = ny * d.w + nx;
        if (out[ni] <= step) continue;
        out[ni] = step;
        next.push(ni);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Chunked terrain cache.
 *
 * A 148x148 dungeon is 7100x7100 px - far too much to keep as one surface, and
 * far too much to autotile every frame. Instead the floor is baked into 576px
 * chunks on demand and evicted LRU, so scrolling costs one bake per newly
 * visible chunk and nothing thereafter.
 */
export class TileMap {
  constructor(assets) {
    this.assets = assets;
    this.cache = new Map();   // "cx,cy" -> {canvas, used}
    this.dungeon = null;
    this.clock = 0;
  }

  setDungeon(dungeon) {
    this.dungeon = dungeon;
    this.cache.clear();
    this.voidDist = dungeon ? buildVoidDistance(dungeon) : null;
  }

  invalidate() { this.cache.clear(); }

  invalidateAt(tx, ty) {
    // A prop can bleed into the neighbouring chunks, so drop those too.
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) this.cache.delete(`${x},${y}`);
    }
  }

  draw(ctx, camera) {
    const d = this.dungeon;
    if (!d) return;
    const b = camera.tileBounds(d);
    const cx0 = Math.floor(b.x0 / CHUNK), cx1 = Math.floor((b.x1 - 1) / CHUNK);
    const cy0 = Math.floor(b.y0 / CHUNK), cy1 = Math.floor((b.y1 - 1) / CHUNK);

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = this.getChunk(cx, cy);
        if (!chunk) continue;
        // Half a pixel of bleed. At a fractional camera zoom the chunk edges
        // land between device pixels and a hairline of background shows through
        // the seam; overlapping neighbours by a sliver removes it, and 0.5px on
        // 576 is far too small a stretch to see.
        ctx.drawImage(chunk, 0, 0, CHUNK_PX, CHUNK_PX,
          cx * CHUNK_PX, cy * CHUNK_PX, CHUNK_PX + SEAM_BLEED, CHUNK_PX + SEAM_BLEED);
      }
    }
  }

  getChunk(cx, cy) {
    const key = `${cx},${cy}`;
    const hit = this.cache.get(key);
    if (hit) { hit.used = ++this.clock; return hit.canvas; }

    const canvas = this.bakeChunk(cx, cy);
    this.cache.set(key, { canvas, used: ++this.clock });
    if (this.cache.size > MAX_CACHED) {
      let oldestKey = null, oldest = Infinity;
      for (const [k, v] of this.cache) if (v.used < oldest) { oldest = v.used; oldestKey = k; }
      if (oldestKey) this.cache.delete(oldestKey);
    }
    return canvas;
  }

  bakeChunk(cx, cy) {
    const d = this.dungeon;
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK_PX;
    canvas.height = CHUNK_PX;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = VOID_COLOR;
    ctx.fillRect(0, 0, CHUNK_PX, CHUNK_PX);

    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const x1 = x0 + CHUNK, y1 = y0 + CHUNK;

    // 1. Base floor across the whole walkable mask.
    const baseVariant = FLOOR_VARIANTS[d.theme.base] || FLOOR_VARIANTS[0];
    const isFloor = (x, y) => d.isFloor(x, y);
    drawLayer(ctx, this.assets.img(baseVariant.sheet), baseVariant, isFloor, x0 - 1, y0 - 1, x1 + 1, y1 + 1, x0, y0);

    // 2. Accent patches on top. Each distinct variant present in (and around)
    //    this chunk gets its own autotiled pass, which gives the patches proper
    //    rounded borders instead of hard rectangles.
    const present = new Set();
    for (let y = y0 - 2; y < y1 + 2; y++) {
      for (let x = x0 - 2; x < x1 + 2; x++) {
        if (!d.isFloor(x, y)) continue;
        const v = d.variant[d.idx(x, y)];
        if (v !== d.theme.base) present.add(v);
      }
    }
    for (const v of present) {
      const variant = FLOOR_VARIANTS[v];
      if (!variant) continue;
      const mask = (x, y) => d.isFloor(x, y) && d.variant[d.idx(x, y)] === v;
      drawLayer(ctx, this.assets.img(variant.sheet), variant, mask, x0 - 1, y0 - 1, x1 + 1, y1 + 1, x0, y0);
    }

    // 3. Rock rim. Emitted from void tiles, so the loop reaches outside the
    //    chunk to pick up rims that bleed inward; the canvas clips the rest.
    drawRim(ctx, this.assets.img('cavern'), isFloor, x0 - 2, y0 - 2, x1 + 2, y1 + 2, x0, y0);

    // 4. Static decor.
    this.drawDecor(ctx, x0, y0, x1, y1);

    // 5. Fade the rock out into the dark. The drawn rock stops a couple of
    //    tiles past the floor and flat void begins, which left a hard,
    //    tile-aligned edge running across the screen. This lays a mask of void
    //    colour over the solid ground, thickening with distance from anywhere
    //    walkable, and paints it from a one-pixel-per-tile bitmap scaled up
    //    with smoothing - so the boundary is a soft gradient rather than a line.
    this.drawVoidFade(ctx, x0, y0);

    // 6. Depth tint. Multiplying by a near-white colour shifts the whole
    //    chunk's cast without noticeably darkening it, which is what makes one
    //    floor feel different from the next using the same tileset.
    if (d.theme.tint) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = d.theme.tint;
      ctx.fillRect(0, 0, CHUNK_PX, CHUNK_PX);
      ctx.globalCompositeOperation = 'source-over';
    }

    return canvas;
  }

  /**
   * Soften the boundary between drawn rock and empty dark.
   *
   * `FADE_PAD` tiles of margin on each side keep the gradient continuous across
   * chunk seams; the canvas clips whatever falls outside.
   */
  drawVoidFade(ctx, x0, y0) {
    const d = this.dungeon;
    const dist = this.voidDist;
    if (!dist) return;

    const n = CHUNK + FADE_PAD * 2;
    if (!this.fadeCanvas) {
      this.fadeCanvas = document.createElement('canvas');
      this.fadeCanvas.width = n;
      this.fadeCanvas.height = n;
      this.fadeCtx = this.fadeCanvas.getContext('2d');
    }
    const fc = this.fadeCtx;
    const img = fc.createImageData(n, n);
    const px = img.data;

    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const tx = x0 - FADE_PAD + ix;
        const ty = y0 - FADE_PAD + iy;
        let a = 0;
        if (d.inBounds(tx, ty)) {
          const dd = dist[d.idx(tx, ty)];
          // Nothing over the floor or the first ring of rock; then ramp up.
          a = clamp01((dd - FADE_START) / FADE_SPAN);
          // A little per-tile jitter so the edge is ragged rather than a
          // clean contour following the room's shape.
          if (a > 0 && a < 1) a = clamp01(a + (tileNoise(tx, ty) - 0.5) * 0.55);
        } else {
          a = 1;
        }
        const o = (iy * n + ix) * 4;
        px[o] = VOID_RGB[0]; px[o + 1] = VOID_RGB[1]; px[o + 2] = VOID_RGB[2];
        px[o + 3] = Math.round(a * 255);
      }
    }
    fc.putImageData(img, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.fadeCanvas, -FADE_PAD * TILE, -FADE_PAD * TILE, n * TILE, n * TILE);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
  }

  drawDecor(ctx, x0, y0, x1, y1) {
    const d = this.dungeon;
    const sheet = this.assets.img('cavern');
    if (!sheet) return;
    for (const dec of d.decor) {
      // Props are anchored bottom-centre and can be wider or taller than their
      // tile, so cull generously and let the chunk canvas clip.
      if (dec.x < x0 - 3 || dec.x >= x1 + 3 || dec.y < y0 - 3 || dec.y >= y1 + 3) continue;
      const pl = decorPlacement(dec.kind, dec.x - x0, dec.y - y0);
      if (!pl) continue;
      ctx.drawImage(sheet, pl.sx, pl.sy, pl.sw, pl.sh, pl.dx, pl.dy, pl.sw, pl.sh);
    }
  }
}
