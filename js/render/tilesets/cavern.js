import { FLOOR_VARIANTS, decorPlacement } from '../../assets/manifest.js';
import { drawLayer, drawRim } from '../../gen/autotile.js';

/**
 * The cavern tileset: hewn rock around packed earth.
 *
 * Rock is drawn as a top-down blob - a 47-case autotile composed from quadrants
 * - with a rim of stone bleeding over the floor where the two meet. This is the
 * original look and the one everything else was tuned against, so it stays
 * exactly as it was; `crypt.js` is an alternative, not a replacement.
 */
export const cavern = {
  id: 'cavern',
  name: 'Caverns',

  /** Which decor set the generator should scatter. */
  decorSheet: 'cavern',

  /**
   * Paint one chunk of terrain.
   *
   * Coordinates are tiles; `ox`/`oy` are the chunk's origin, since the canvas
   * being drawn into is chunk-local.
   */
  bake(ctx, { dungeon: d, assets, x0, y0, x1, y1 }) {
    // 1. Base floor across the whole walkable mask.
    const baseVariant = FLOOR_VARIANTS[d.theme.base] || FLOOR_VARIANTS[0];
    const isFloor = (x, y) => d.isFloor(x, y);
    drawLayer(ctx, assets.img(baseVariant.sheet), baseVariant, isFloor, x0 - 1, y0 - 1, x1 + 1, y1 + 1, x0, y0);

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
      drawLayer(ctx, assets.img(variant.sheet), variant, mask, x0 - 1, y0 - 1, x1 + 1, y1 + 1, x0, y0);
    }

    // 3. Rock rim. Emitted from void tiles, so the loop reaches outside the
    //    chunk to pick up rims that bleed inward; the canvas clips the rest.
    drawRim(ctx, assets.img('cavern'), isFloor, x0 - 2, y0 - 2, x1 + 2, y1 + 2, x0, y0);

    // 4. Static decor.
    const sheet = assets.img('cavern');
    if (!sheet) return;
    for (const dec of d.decor) {
      // Props are anchored bottom-centre and can be wider or taller than their
      // tile, so cull generously and let the chunk canvas clip.
      if (dec.x < x0 - 3 || dec.x >= x1 + 3 || dec.y < y0 - 3 || dec.y >= y1 + 3) continue;
      const pl = decorPlacement(dec.kind, dec.x - x0, dec.y - y0);
      if (!pl) continue;
      ctx.drawImage(sheet, pl.sx, pl.sy, pl.sw, pl.sh, pl.dx, pl.dy, pl.sw, pl.sh);
    }
  },
};
