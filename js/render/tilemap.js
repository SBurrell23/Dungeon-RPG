import { TILE, VOID_COLOR } from '../assets/manifest.js';
import { getTileset, DEFAULT_TILESET } from './tilesets/index.js';

const CHUNK = 12;             // tiles per chunk edge
const CHUNK_PX = CHUNK * TILE;
const MAX_CACHED = 28;
const SEAM_BLEED = 0.5;   // px of overlap between chunks, see draw()

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
    this.tilesetId = DEFAULT_TILESET;
  }

  /** Swap the terrain look. Every baked chunk is now wrong, so drop them all. */
  setTileset(id) {
    if (id === this.tilesetId) return;
    this.tilesetId = id;
    this.cache.clear();
  }

  setDungeon(dungeon) {
    this.dungeon = dungeon;
    this.cache.clear();
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

    // Everything about how this floor looks belongs to the tileset.
    getTileset(this.tilesetId).bake(ctx, { dungeon: d, assets: this.assets, x0, y0, x1, y1 });

    // Depth tint. Multiplying by a near-white colour shifts the whole
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

}
