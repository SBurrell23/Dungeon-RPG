import { clamp, damp } from '../core/util.js';
import { TILE } from '../assets/manifest.js';

/**
 * Following camera. Smoothly chases its target, leans slightly toward the
 * cursor so you can see what you are aiming at, and clamps to the dungeon so
 * the void never fills half the screen.
 */
export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.zoom = 2.0;
    this.targetZoom = 2.0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.leadX = 0;
    this.leadY = 0;
  }

  get viewW() { return this.canvas.width / this.zoom; }
  get viewH() { return this.canvas.height / this.zoom; }

  snapTo(x, y) { this.x = x; this.y = y; this.leadX = 0; this.leadY = 0; }

  update(dt, target, aimWorld, dungeon, shakeAmount) {
    if (!target) return;
    this.zoom = damp(this.zoom, this.targetZoom, 0.12, dt);

    // Look-ahead toward the cursor, capped so the player never leaves centre by much.
    let lx = 0, ly = 0;
    if (aimWorld) {
      lx = clamp((aimWorld.x - target.x) * 0.24, -140, 140);
      ly = clamp((aimWorld.y - target.y) * 0.24, -110, 110);
    }
    this.leadX = damp(this.leadX, lx, 0.16, dt);
    this.leadY = damp(this.leadY, ly, 0.16, dt);

    const wantX = target.x + this.leadX;
    const wantY = target.y + this.leadY;
    this.x = damp(this.x, wantX, 0.055, dt);
    this.y = damp(this.y, wantY, 0.055, dt);

    if (dungeon) {
      const halfW = this.viewW / 2, halfH = this.viewH / 2;
      const worldW = dungeon.w * TILE, worldH = dungeon.h * TILE;
      this.x = worldW > this.viewW ? clamp(this.x, halfW, worldW - halfW) : worldW / 2;
      this.y = worldH > this.viewH ? clamp(this.y, halfH, worldH - halfH) : worldH / 2;
    }

    if (shakeAmount > 0.1) {
      this.shakeX = (Math.random() * 2 - 1) * shakeAmount;
      this.shakeY = (Math.random() * 2 - 1) * shakeAmount;
    } else {
      this.shakeX = 0; this.shakeY = 0;
    }
  }

  /**
   * Apply the camera transform; caller is responsible for save/restore.
   *
   * The translation is snapped to whole device pixels. With nearest-neighbour
   * scaling a fractional camera offset makes every terrain pixel shimmer as it
   * rounds one way or the other, which reads as the whole world vibrating
   * while you walk.
   */
  apply(ctx) {
    const z = this.zoom;
    ctx.translate(Math.round(this.canvas.width / 2), Math.round(this.canvas.height / 2));
    ctx.scale(z, z);
    ctx.translate(-Math.round((this.x + this.shakeX) * z) / z, -Math.round((this.y + this.shakeY) * z) / z);
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.canvas.width / 2) / this.zoom + this.x + this.shakeX,
      y: (sy - this.canvas.height / 2) / this.zoom + this.y + this.shakeY,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x - this.shakeX) * this.zoom + this.canvas.width / 2,
      y: (wy - this.y - this.shakeY) * this.zoom + this.canvas.height / 2,
    };
  }

  /** Visible tile range, padded by one so partially visible tiles still draw. */
  tileBounds(dungeon) {
    const halfW = this.viewW / 2, halfH = this.viewH / 2;
    return {
      x0: Math.max(0, Math.floor((this.x - halfW) / TILE) - 1),
      y0: Math.max(0, Math.floor((this.y - halfH) / TILE) - 1),
      x1: Math.min(dungeon.w, Math.ceil((this.x + halfW) / TILE) + 2),
      y1: Math.min(dungeon.h, Math.ceil((this.y + halfH) / TILE) + 2),
    };
  }

  isVisible(x, y, margin = 80) {
    return Math.abs(x - this.x) < this.viewW / 2 + margin
      && Math.abs(y - this.y) < this.viewH / 2 + margin;
  }
}
