import { TILE, RIM } from '../assets/manifest.js';

/**
 * Quadrant ("sub-tile") autotiling.
 *
 * Each 48x48 tile is drawn as four 24x24 quadrants. A quadrant's appearance
 * depends only on the three mask cells that touch that corner, which gives the
 * full 47-case blob behaviour out of a 3x3 blob plus four concave corners -
 * exactly the layout both terrain sheets ship.
 *
 *   both orthogonal neighbours + diagonal  -> solid centre
 *   both orthogonal, diagonal missing      -> concave (inner) corner
 *   one orthogonal only                    -> straight edge
 *   neither                                -> convex (outer) corner
 */

const H = TILE / 2; // 24

// Quadrant order: 0 = NW, 1 = NE, 2 = SW, 3 = SE.
const QUAD_OFF = [
  [0, 0],
  [H, 0],
  [0, H],
  [H, H],
];

/**
 * Resolve the source tile coords for one quadrant.
 * @returns {[number, number]} tile column/row inside the sheet
 */
function quadSource(variant, quad, ortho1, ortho2, diag) {
  const b = variant.blob;
  if (ortho1 && ortho2) {
    if (diag) return [b.col + 1, b.row + 1];          // solid centre
    return innerCorner(variant, quad);                 // concave corner
  }
  switch (quad) {
    case 0: // NW: ortho1 = north, ortho2 = west
      if (ortho1) return [b.col, b.row + 1];           // left edge
      if (ortho2) return [b.col + 1, b.row];           // top edge
      return [b.col, b.row];                           // top-left corner
    case 1: // NE: ortho1 = north, ortho2 = east
      if (ortho1) return [b.col + 2, b.row + 1];       // right edge
      if (ortho2) return [b.col + 1, b.row];           // top edge
      return [b.col + 2, b.row];                       // top-right corner
    case 2: // SW: ortho1 = south, ortho2 = west
      if (ortho1) return [b.col, b.row + 1];           // left edge
      if (ortho2) return [b.col + 1, b.row + 2];       // bottom edge
      return [b.col, b.row + 2];                       // bottom-left corner
    default: // SE: ortho1 = south, ortho2 = east
      if (ortho1) return [b.col + 2, b.row + 1];       // right edge
      if (ortho2) return [b.col + 1, b.row + 2];       // bottom edge
      return [b.col + 2, b.row + 2];                   // bottom-right corner
  }
}

/**
 * The concave pieces live in different places in the two sheets:
 *  - RA_Ground_Tiles stores a 3x3 ring whose corner tiles are the concave ones,
 *    rotated 180 degrees relative to the quadrant they serve.
 *  - RA_Cavern stores a plain 2x2 set in reading order (NW, NE, SW, SE).
 */
function innerCorner(variant, quad) {
  if (variant.inner) {
    const i = variant.inner;
    return [i.col + (quad & 1), i.row + (quad >> 1)];
  }
  const r = variant.ring;
  switch (quad) {
    case 0: return [r.col + 2, r.row + 2];
    case 1: return [r.col, r.row + 2];
    case 2: return [r.col + 2, r.row];
    default: return [r.col, r.row];
  }
}

/**
 * Draw one autotiled terrain layer.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} sheet     source image for `variant`
 * @param {object} variant             entry from manifest FLOOR_VARIANTS
 * @param {(x:number,y:number)=>boolean} mask  is this tile part of the layer
 * @param {number} x0,y0,x1,y1         tile range to draw (x1/y1 exclusive)
 * @param {number} originX,originY     tile coords mapped to canvas pixel (0,0)
 */
export function drawLayer(ctx, sheet, variant, mask, x0, y0, x1, y1, originX, originY) {
  if (!sheet) return;
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      if (!mask(tx, ty)) continue;

      const n = mask(tx, ty - 1);
      const s = mask(tx, ty + 1);
      const w = mask(tx - 1, ty);
      const e = mask(tx + 1, ty);
      const nw = mask(tx - 1, ty - 1);
      const ne = mask(tx + 1, ty - 1);
      const sw = mask(tx - 1, ty + 1);
      const se = mask(tx + 1, ty + 1);

      const px = (tx - originX) * TILE;
      const py = (ty - originY) * TILE;

      // Fast path: fully interior tile is a single blit.
      if (n && s && w && e && nw && ne && sw && se) {
        const b = variant.blob;
        ctx.drawImage(sheet, (b.col + 1) * TILE, (b.row + 1) * TILE, TILE, TILE, px, py, TILE, TILE);
        continue;
      }

      drawQuad(ctx, sheet, variant, 0, n, w, nw, px, py);
      drawQuad(ctx, sheet, variant, 1, n, e, ne, px, py);
      drawQuad(ctx, sheet, variant, 2, s, w, sw, px, py);
      drawQuad(ctx, sheet, variant, 3, s, e, se, px, py);
    }
  }
}

function drawQuad(ctx, sheet, variant, quad, o1, o2, diag, px, py) {
  const [sc, sr] = quadSource(variant, quad, o1, o2, diag);
  const [ox, oy] = QUAD_OFF[quad];
  ctx.drawImage(sheet, sc * TILE + ox, sr * TILE + oy, H, H, px + ox, py + oy, H, H);
}

/**
 * Rock rim where floor meets void.
 *
 * The rim pieces overlap the floor rather than the void, so this is drawn after
 * the floor layer. The south rim is deliberately taller: in the source art that
 * edge is the lit front face of the rock, which is what gives the caverns their
 * sense of depth.
 *
 * @param {(x:number,y:number)=>boolean} isFloor
 */
export function drawRim(ctx, sheet, isFloor, x0, y0, x1, y1, originX, originY) {
  if (!sheet) return;
  const R = RIM;

  // Edges first, then corners on top so the corner rocks close the seams.
  for (let ty = y0 - 1; ty <= y1; ty++) {
    for (let tx = x0 - 1; tx <= x1; tx++) {
      if (isFloor(tx, ty)) continue; // rims are emitted from the void side
      const px = (tx - originX) * TILE;
      const py = (ty - originY) * TILE;

      // Floor below us -> our south face is exposed; draw the tall rock front.
      if (isFloor(tx, ty + 1)) {
        ctx.drawImage(sheet, R.bottom.x, R.bottom.y, R.bottom.w, R.bottom.h, px, py + TILE - 8, TILE, R.bottom.h);
      }
      if (isFloor(tx, ty - 1)) {
        ctx.drawImage(sheet, R.top.x, R.top.y, R.top.w, R.top.h, px, py - R.top.h + 6, TILE, R.top.h);
      }
      if (isFloor(tx - 1, ty)) {
        ctx.drawImage(sheet, R.left.x, R.left.y, R.left.w, R.left.h, px - R.left.w + 4, py, R.left.w, TILE);
      }
      if (isFloor(tx + 1, ty)) {
        ctx.drawImage(sheet, R.right.x, R.right.y, R.right.w, R.right.h, px + TILE - 4, py, R.right.w, TILE);
      }
    }
  }

  // Diagonal-only contacts still need a rock or the corner reads as a gap.
  for (let ty = y0 - 1; ty <= y1; ty++) {
    for (let tx = x0 - 1; tx <= x1; tx++) {
      if (isFloor(tx, ty)) continue;
      const px = (tx - originX) * TILE;
      const py = (ty - originY) * TILE;
      const n = isFloor(tx, ty - 1), s = isFloor(tx, ty + 1);
      const w = isFloor(tx - 1, ty), e = isFloor(tx + 1, ty);
      if (!n && !w && isFloor(tx - 1, ty - 1)) {
        ctx.drawImage(sheet, R.cornerTL.x, R.cornerTL.y, R.cornerTL.w, R.cornerTL.h, px - 20, py - 18, 24, 24);
      }
      if (!n && !e && isFloor(tx + 1, ty - 1)) {
        ctx.drawImage(sheet, R.cornerTR.x, R.cornerTR.y, R.cornerTR.w, R.cornerTR.h, px + TILE - 4, py - 18, 24, 24);
      }
      if (!s && !w && isFloor(tx - 1, ty + 1)) {
        ctx.drawImage(sheet, R.cornerBL.x, R.cornerBL.y, R.cornerBL.w, 24, px - 20, py + TILE - 8, 24, 24);
      }
      if (!s && !e && isFloor(tx + 1, ty + 1)) {
        ctx.drawImage(sheet, R.cornerBR.x, R.cornerBR.y, R.cornerBR.w, 24, px + TILE - 4, py + TILE - 8, 24, 24);
      }
    }
  }
}
