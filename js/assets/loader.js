import { FRAME, IMAGES, HERO_SHEETS, MONSTER_SHEETS, FX_STRIPS, ICON_SIZE, ICON_COLS } from './manifest.js';

/**
 * Loads every image the game needs and exposes them as sliceable sprite sheets.
 *
 * A "sheet" here is `{ img, frames, w, h }` where the source image is a
 * horizontal strip of `frames` frames of `w`x`h` pixels. Drawing pulls a source
 * rect straight out of the image - we never blit frames into separate canvases,
 * which keeps memory flat and lets the GPU cache the whole sheet.
 */
export class Assets {
  constructor() {
    this.images = new Map();      // key -> HTMLImageElement
    this.sheets = new Map();      // "hero:knight:idle" -> {img, frames, w, h}
    this.recolored = new Map();   // "<key>|<filter>" -> HTMLCanvasElement
    this.iconCache = new Map();   // "c,r,size" -> HTMLCanvasElement
    this.errors = [];
    this.loadedCount = 0;
    this.totalCount = 0;
  }

  async loadAll(onProgress) {
    const jobs = [];
    for (const [key, path] of Object.entries(IMAGES)) jobs.push([key, path]);

    for (const [id, def] of Object.entries(HERO_SHEETS)) {
      for (const [anim, suffix] of Object.entries(def.anims)) {
        jobs.push([`hero:${id}:${anim}`, `${def.dir}/${def.prefix}${suffix}.png`]);
      }
    }
    for (const [id, def] of Object.entries(MONSTER_SHEETS)) {
      for (const [anim, suffix] of Object.entries(def.anims)) {
        jobs.push([`mob:${id}:${anim}`, `${def.dir}/${def.prefix}${suffix}.png`]);
      }
    }

    this.totalCount = jobs.length;
    // Browsers cap concurrent requests per origin; a modest batch size keeps the
    // progress bar smooth without stalling on a queue.
    const BATCH = 24;
    for (let i = 0; i < jobs.length; i += BATCH) {
      await Promise.all(jobs.slice(i, i + BATCH).map(([key, path]) => this._load(key, path, onProgress)));
    }

    this._buildSheetIndex();
    return this;
  }

  _load(key, path, onProgress) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.images.set(key, img);
        this.loadedCount++;
        onProgress?.(this.loadedCount, this.totalCount, key);
        resolve(img);
      };
      img.onerror = () => {
        this.errors.push(path);
        this.loadedCount++;
        onProgress?.(this.loadedCount, this.totalCount, key);
        resolve(null);
      };
      img.src = encodeURI(path);
    });
  }

  /** Derive frame counts from sheet widths so new art needs no extra metadata. */
  _buildSheetIndex() {
    for (const [key, img] of this.images) {
      if (key.startsWith('hero:') || key.startsWith('mob:')) {
        this.sheets.set(key, { img, frames: Math.max(1, Math.round(img.width / FRAME)), w: FRAME, h: FRAME });
      }
    }
    for (const [key, frames] of Object.entries(FX_STRIPS)) {
      const img = this.images.get(key);
      if (img) this.sheets.set('fx:' + key, { img, frames, w: FRAME, h: FRAME });
    }
  }

  img(key) { return this.images.get(key) || null; }

  /**
   * Look up an animation strip, falling back through sensible alternatives so a
   * missing sheet degrades to the idle pose instead of a blank sprite.
   */
  sheet(kind, id, anim) {
    const base = `${kind}:${id}:`;
    return this.sheets.get(base + anim)
      || this.sheets.get(base + (anim === 'walk' ? 'idle' : 'walk'))
      || this.sheets.get(base + 'idle')
      || null;
  }

  hasAnim(kind, id, anim) { return this.sheets.has(`${kind}:${id}:${anim}`); }

  /**
   * Palette-shifted copy of a whole sheet. Used for neutral NPC variants (the
   * "recoloured good guys") and for elite/champion monster tints. Cached, so
   * calling this per frame is fine.
   */
  recolor(key, filter) {
    const cacheKey = key + '|' + filter;
    let c = this.recolored.get(cacheKey);
    if (c) return c;
    const img = this.images.get(key);
    if (!img) return null;
    c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.filter = filter;
    ctx.drawImage(img, 0, 0);
    this.recolored.set(cacheKey, c);
    return c;
  }

  /** Same as `sheet()` but returns a recoloured surface for the same geometry. */
  recolorSheet(kind, id, anim, filter) {
    const key = `${kind}:${id}:${anim}`;
    const base = this.sheets.get(key) || this.sheet(kind, id, anim);
    if (!base) return null;
    const srcKey = [...this.images.entries()].find(([, v]) => v === base.img)?.[0];
    if (!srcKey) return base;
    const surface = this.recolor(srcKey, filter);
    return surface ? { img: surface, frames: base.frames, w: base.w, h: base.h } : base;
  }

  /**
   * Extract one icon cell into its own canvas at `size` px. Icons are drawn
   * into UI elements far more often than into the world, and blitting a small
   * cached canvas is much cheaper than a scaled sub-rect draw.
   */
  icon(col, row, size = ICON_SIZE) {
    const key = `${col},${row},${size}`;
    let c = this.iconCache.get(key);
    if (c) return c;
    const img = this.images.get('icons');
    if (!img) return null;
    c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, col * ICON_SIZE, row * ICON_SIZE, ICON_SIZE, ICON_SIZE, 0, 0, size, size);
    this.iconCache.set(key, c);
    return c;
  }

  /** Data URL for an icon, so the DOM UI can use it as a CSS background. */
  iconURL(col, row, size = ICON_SIZE) {
    const c = this.icon(col, row, size);
    return c ? c.toDataURL() : '';
  }

  clampIcon(col, row) {
    return [Math.max(0, Math.min(ICON_COLS - 1, col | 0)), Math.max(0, Math.min(ICON_COLS - 1, row | 0))];
  }
}

export const assets = new Assets();
