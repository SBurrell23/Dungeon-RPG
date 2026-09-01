import {
  TILE, VOID_COLOR, ANIM_TILES, ICON_SIZE, TRAP_SHEETS, CHEST_SHEET,
} from '../assets/manifest.js';
import { MONSTERS, ELITE_TINT, BOSS_TINT } from '../game/monsters.js';
import { CLASSES } from '../game/classes.js';
import { clamp, TAU } from '../core/util.js';

const SPRITE = 100;

/**
 * Global size multiplier for character sprites. The art is a small figure in a
 * 100px frame, which left characters dwarfed by 48px dungeon furniture; this
 * brings the two into a sane relationship without touching collision radii.
 */
const ACTOR_SCALE = 1.35;

/** Chests are drawn well below tile size so they read as a container on the floor. */
const CHEST_SIZE = 24;

/** Traps are translucent so they blend into the floor they are set in. */
const TRAP_OPACITY = 0.72;

/**
 * How far back into the floor the spike beds sit.
 *
 * They cover a whole tile and come in clusters, so at full strength they paved
 * over the ground; this keeps them legible without taking the floor over.
 */
const PIT_SPIKE_ALPHA = 0.45;

/** Seconds of the descent ritual; mirrors DESCENT_TIME in game/world.js. */
const DESCENT_SECONDS = 10;

/**
 * World renderer.
 *
 * Draw order is: baked terrain -> ground props and telegraphs -> pickups ->
 * actors (y-sorted, rotated to face) -> projectiles -> particles -> lighting ->
 * floating text. Sprites are drawn with smoothing off at every stage so the
 * pixel art stays crisp at the camera's 2x zoom.
 */
export class Renderer {
  constructor(canvas, assets, tilemap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.assets = assets;
    this.tilemap = tilemap;

    this.lightCanvas = document.createElement('canvas');
    this.lightCtx = this.lightCanvas.getContext('2d');
    this.lightScale = 0.5;
    this.enableLighting = true;
    this.showHitboxes = false;
    this.time = 0;
    // When each chest was first seen open, so the lid animation can play
    // once without the simulation carrying a clock for it.
    this._chestOpenedAt = new WeakMap();
    // Blend factor between the last two simulation ticks; see drawX/drawY.
    this.alpha = 1;
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.lightCanvas.width = Math.max(1, Math.ceil(w * this.lightScale));
    this.lightCanvas.height = Math.max(1, Math.ceil(h * this.lightScale));
  }

  render(world, camera, localPlayer, dt, alpha = 1) {
    this.time += dt;
    this.alpha = alpha;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = VOID_COLOR;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!world.dungeon) return;

    ctx.save();
    camera.apply(ctx);

    this.tilemap.draw(ctx, camera);
    this.drawGroundProps(ctx, world, camera);
    this.drawZones(ctx, world);
    this.drawTelegraphs(ctx, world);
    this.drawPickups(ctx, world, camera);
    this.drawActors(ctx, world, camera, localPlayer);
    this.drawProjectiles(ctx, world, camera);
    this.drawFx(ctx, world, camera);
    this.drawOverheads(ctx, world, camera, localPlayer);

    ctx.restore();

    if (this.enableLighting) this.drawLighting(world, camera);

    ctx.save();
    camera.apply(ctx);
    this.drawFloaters(ctx, world, camera);
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Props
  // -------------------------------------------------------------------------

  /** Cached frame of a tile animation - never a sub-rect, so nothing bleeds in. */
  animFrame(def, phase = 0) {
    const f = Math.floor(this.time * def.fps + phase) % def.frames;
    return this.assets.tileFrame('cavernAnim', def.col + f, def.row, def.w, def.h, TILE);
  }

  drawGroundProps(ctx, world, camera) {
    const d = world.dungeon;
    const cavern = this.assets.img('cavern');

    for (const p of d.props) {
      const px = p.x * TILE;
      const py = p.y * TILE;
      if (!camera.isVisible(px + TILE / 2, py, 160)) continue;

      switch (p.type) {
        case 'torch': {
          const img = this.animFrame(ANIM_TILES[p.anim] || ANIM_TILES.torch, p.x * 3 + p.y);
          if (img) ctx.drawImage(img, px, py - (img.height - TILE), img.width, img.height);
          break;
        }
        case 'stairs': {
          const img = this.animFrame(ANIM_TILES.stairsDown);
          if (img) ctx.drawImage(img, px, py - TILE, img.width, img.height);
          const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.25 + pulse * 0.25;
          const g = ctx.createRadialGradient(px + TILE / 2, py + TILE / 2, 4, px + TILE / 2, py + TILE / 2, 90);
          g.addColorStop(0, '#7fe6ff');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px - 60, py - 60, 170, 170);
          ctx.restore();
          this.drawDescentBar(ctx, world, px, py);
          break;
        }
        case 'entrance': {
          const img = this.animFrame(ANIM_TILES.runePlate);
          ctx.globalAlpha = 0.8;
          if (img) ctx.drawImage(img, px, py - TILE, img.width, img.height);
          ctx.globalAlpha = 1;
          break;
        }
        case 'shrine': {
          const img = this.animFrame(ANIM_TILES.fountain);
          ctx.save();
          if (p.used) ctx.globalAlpha = 0.4;
          if (img) ctx.drawImage(img, px, py - TILE, img.width, img.height);
          ctx.restore();
          break;
        }
        case 'chest': {
          this.drawChest(ctx, p, px, py);
          break;
        }
        case 'trap': {
          if (!p.vis || p.vis < 0.02) break;
          this.drawTrap(ctx, p, px, py, world);
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Progress of the descent ritual, floating above the marker. Only drawn while
   * somebody is actually channelling, plus a red flash when it breaks.
   */
  drawDescentBar(ctx, world, px, py) {
    const d = world.descent;
    if (!d) return;
    const cx = px + TILE / 2;
    const top = py - TILE - 16;

    if (d.flash > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(d.flash, 0, 1);
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.strokeText('INTERRUPTED', cx, top);
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText('INTERRUPTED', cx, top);
      ctx.restore();
    }
    if (d.progress <= 0) return;

    const W = 72, H = 7;
    const frac = clamp(d.progress / DESCENT_SECONDS, 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.7)';
    ctx.fillRect(cx - W / 2 - 1, top - 1, W + 2, H + 2);
    ctx.fillStyle = '#7fe6ff';
    ctx.fillRect(cx - W / 2, top, W * frac, H);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.fillRect(cx - W / 2, top, W * frac, 2);

    // "Unlocking" with animated dots, so it reads as an active ritual.
    const dots = '.'.repeat(1 + (Math.floor(this.time * 3) % 3));
    ctx.textAlign = 'center';
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(`Unlocking${dots}`, cx, top - 5);
    ctx.fillStyle = '#bff0ff';
    ctx.fillText(`Unlocking${dots}`, cx, top - 5);
    ctx.restore();
  }

  /**
   * Traps, drawn in JS so their state always reads clearly.
   *
   * Each is a recessed stone plate with mechanism-specific detail, rather than
   * an abstract marker: spikes are blades pushing through slots, darts are a
   * grille of bore holes, flame is a burner grate, gas is a perforated vent.
   * Alpha comes from `vis`, which the sim fades with proximity.
   */
  /**
   * A chest, from the animated sheet, tiered by what is inside it.
   *
   * The lid comes off over about half a second the first time we see it open;
   * the renderer times that itself rather than the simulation having to carry
   * an animation clock for a thing that happens once.
   */
  drawChest(ctx, p, px, py) {
    const img = this.assets.img(CHEST_SHEET.img);
    if (!img) return;
    const { fw, fh, cols, fps } = CHEST_SHEET;
    const row = CHEST_SHEET.rows[p.tier] ?? CHEST_SHEET.rows.common;

    let sx = 0, sy = row;
    if (p.opened) {
      if (this._chestOpenedAt.get(p) === undefined) this._chestOpenedAt.set(p, this.time);
      const t = this.time - this._chestOpenedAt.get(p);
      const f = Math.floor(t * fps);
      // Row below is the lid coming off; hold on its last frame afterwards.
      sy = row + 1;
      sx = Math.min(cols - 1, f);
    }

    // Chests are 48x32 art on a 48px tile; keep the aspect and sit it on the
    // floor rather than centring it in the tile.
    const w = CHEST_SIZE * 1.8;
    const h = w * (fh / fw);
    ctx.save();
    ctx.translate(px + TILE / 2, py + TILE / 2 + 4);

    // A soft shadow so it sits on the floor instead of hovering over it.
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, h * 0.42, w * 0.40, h * 0.15, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // A stable coin-flip per chest, so a room of them does not all face one way.
    if (((p.x * 73856093) ^ (p.y * 19349663)) & 1) ctx.scale(-1, 1);
    ctx.drawImage(img, sx * fw, sy * fh, fw, fh, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /**
   * Traps are drawn from their spritesheets, on the frame the simulation says
   * they are on, so what you see and what hurts you cannot drift apart.
   *
   * The poison vent has no sheet and is still drawn by hand, redrawn here as
   * flat pixel blocks rather than the smooth gradients it had before.
   */
  drawTrap(ctx, p, px, py, world) {
    ctx.save();
    if (p.kind === 'squisher') {
      // Solid, and always drawn. A crusher is a machine bolted into the wall,
      // not something concealed under the floor - fading it in as you approach
      // made it look like a ghost of a trap rather than a ton of moving stone.
      this.drawCrusher(ctx, p, px, py, world);
      ctx.restore();
      return;
    }

    const alpha = clamp(p.vis ?? 1, 0, 1) * (p.spent ? TRAP_OPACITY * 0.5 : TRAP_OPACITY);
    if (alpha < 0.02) { ctx.restore(); return; }
    ctx.globalAlpha = alpha;

    if (p.kind === 'poison') this.drawGasVent(ctx, p, px, py);
    else this.drawTrapSheet(ctx, p, px, py, world);

    ctx.restore();
  }

  /** One tile of a sheet-backed trap. */
  drawTrapSheet(ctx, p, px, py, world) {
    const def = TRAP_SHEETS[p.sheet || p.kind];
    const img = def && this.assets.img(def.img);
    if (!img) return;
    const frame = world ? world.trapFrame(p) : 0;

    if (p.kind === 'pit') {
      // Full tile, but sunk well back into the floor: at full strength a bed of
      // them paved over the ground, and shrinking them read as clutter. Faint
      // and full-size looks like spikes set into the stone. Mirrored on a hash
      // of the tile so a bed is not one sprite stamped in a grid.
      ctx.save();
      ctx.globalAlpha *= PIT_SPIKE_ALPHA;
      ctx.translate(px + TILE / 2, py + TILE / 2);
      if (((p.x * 73856093) ^ (p.y * 19349663)) & 2) ctx.scale(-1, 1);
      ctx.drawImage(img, frame * def.fw, 0, def.fw, def.fh, -TILE / 2, -TILE / 2, TILE, TILE);
      ctx.restore();
      return;
    }

    // The art is 32px to a tile; scale it up and hang any extra height (the
    // fire vent's flame) above the tile rather than squashing it into it.
    const scale = TILE / def.fw;
    const h = def.fh * scale;
    ctx.drawImage(img, frame * def.fw, 0, def.fw, def.fh,
      px, py + TILE - h, TILE, h);
  }

  /**
   * A crusher: a ram on each wall of a thin corridor, closing on each other.
   *
   * One sheet covers both, mirrored - Push_Trap_Front travels along the
   * vertical axis and Push_Trap_Right along the horizontal, so between them and
   * a flip the rams face all four ways.
   */
  drawCrusher(ctx, p, px, py, world) {
    const def = TRAP_SHEETS[p.axis === 'v' ? 'pushV' : 'pushH'];
    const img = def && this.assets.img(def.img);
    if (!img) return;
    const frame = world ? world.trapFrame(p) : 0;
    const span = p.span || 2;

    // The art mounts at the top edge of its cell and drives out downward, so a
    // cell laid on the first and last tiles of the corridor puts each mount
    // flush with the wall it is bolted to and sends the ram into the hallway.
    for (const far of [false, true]) {
      ctx.save();
      if (p.axis === 'v') {
        const y = py + (far ? (span - 1) * TILE : 0);
        ctx.translate(px + TILE / 2, y + TILE / 2);
        if (far) ctx.scale(1, -1);          // the far ram faces back up
      } else {
        const x = px + (far ? (span - 1) * TILE : 0);
        ctx.translate(x + TILE / 2, py + TILE / 2);
        if (far) ctx.scale(-1, 1);
      }
      ctx.drawImage(img, frame * def.fw, 0, def.fw, def.fh,
        -TILE / 2, -TILE / 2, TILE, TILE);
      ctx.restore();
    }
  }

  /**
   * The one hand-drawn trap: a perforated cap over a pocket of rot.
   *
   * Built on whole pixels from the tile's own corner, so the grate lands square
   * on the tile instead of a half-pixel off it.
   */
  drawGasVent(ctx, p, px, py) {
    const x0 = Math.round(px) + 6;       // a 36px plate centred in a 48px tile
    const y0 = Math.round(py) + 6;
    const S = 36;
    const armed = p.armed && !p.spent;

    // Flat blocks, no gradients - it has to sit beside the pixel art, not on it.
    ctx.fillStyle = '#2b2a22';
    ctx.fillRect(x0, y0, S, S);
    ctx.fillStyle = '#4a5238';
    ctx.fillRect(x0 + 2, y0 + 2, S - 4, S - 4);
    ctx.fillStyle = '#5d6844';
    ctx.fillRect(x0 + 2, y0 + 2, S - 4, 3);
    ctx.fillStyle = '#33391f';
    ctx.fillRect(x0 + 2, y0 + S - 5, S - 4, 3);

    // A 4x4 grid of bores, all on whole pixels.
    ctx.fillStyle = '#1d2313';
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) ctx.fillRect(x0 + 5 + c * 8, y0 + 6 + r * 7, 5, 4);
    }
    if (!armed) return;

    const breathe = 0.5 + 0.5 * Math.sin(this.time * 2.2 + p.x * 1.7 + p.y);
    // Gas sitting in the bores.
    ctx.save();
    ctx.globalAlpha *= 0.55 + breathe * 0.35;
    ctx.fillStyle = '#b6f08a';
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) ctx.fillRect(x0 + 5 + c * 8, y0 + 6 + r * 7, 5, 2);
    }
    ctx.restore();

    // And a cloud actually hanging over it, so the hazard reads from a distance
    // rather than only when you are standing on the plate.
    ctx.save();
    const cx = px + TILE / 2, cy = py + TILE / 2;
    for (let i = 0; i < 7; i++) {
      const seed = p.x * 2.3 + p.y * 1.7 + i * 1.9;
      const t = (this.time * 0.5 + i / 7 + seed) % 1;
      const r = 7 + t * 15;
      const ox = Math.sin(seed * 4 + this.time * 0.7) * 12;
      const oy = -t * 16 + Math.cos(seed * 3 + this.time * 0.5) * 5;
      ctx.globalAlpha = (1 - t) * 0.42;
      ctx.fillStyle = i % 2 ? '#8ad86a' : '#6fbf52';
      // Blocky puffs rather than soft circles, to match the art.
      ctx.fillRect(Math.round(cx + ox - r / 2), Math.round(cy + oy - r / 2), Math.round(r), Math.round(r * 0.7));
    }
    ctx.restore();
  }

  drawZones(ctx, world) {
    for (const z of world.zones) {
      const life = 1 - z.elapsed / z.duration;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16 + 0.1 * Math.sin(this.time * 4) * life;
      const g = ctx.createRadialGradient(z.x, z.y, z.radius * 0.15, z.x, z.y, z.radius);
      g.addColorStop(0, z.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.35 * life;
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawTelegraphs(ctx, world) {
    for (const t of world.telegraphs) {
      const prog = clamp(t.t / t.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.30 + 0.35 * prog;
      ctx.strokeStyle = t.color || '#ff5533';
      ctx.lineWidth = 3;
      if (t.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.16 * prog;
        ctx.fillStyle = t.color || '#ff5533';
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius * prog, 0, TAU);
        ctx.fill();
      } else {
        ctx.translate(t.x, t.y);
        ctx.rotate(t.angle);
        ctx.globalAlpha = 0.20 + 0.3 * prog;
        ctx.fillStyle = t.color || '#ff5533';
        ctx.fillRect(0, -18, t.length, 36);
      }
      ctx.restore();
    }
  }

  drawPickups(ctx, world, camera) {
    const icons = this.assets.img('icons');
    for (const p of world.pickups) {
      if (!camera.isVisible(p.x, p.y, 60)) continue;
      const bob = Math.sin(p.bob) * 3;
      const glow = p.kind === 'bossLoot' ? '#ff9a2e' : '#ffd23f';

      // A loose coin is a coin, not a treasure hoard - draw gold-only drops
      // noticeably smaller than a piece of gear so the floor reads correctly.
      const item = p.items.find((i) => i.type !== 'gold') || p.items[0];
      const coinOnly = !p.items.some((i) => i.type !== 'gold');
      const size = coinOnly ? 15 : 26;
      const halo = coinOnly ? 20 : 34;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (coinOnly ? 0.26 : 0.35) + 0.15 * Math.sin(this.time * 5);
      const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, halo);
      g.addColorStop(0, glow);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, halo, 0, TAU);
      ctx.fill();
      ctx.restore();

      if (item && icons && item.icon) {
        ctx.drawImage(icons, item.icon[0] * ICON_SIZE, item.icon[1] * ICON_SIZE, ICON_SIZE, ICON_SIZE,
          p.x - size / 2, p.y - size / 2 + bob - (coinOnly ? 3 : 6), size, size);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Actors
  // -------------------------------------------------------------------------

  drawActors(ctx, world, camera, localPlayer) {
    const drawables = [];
    for (const m of world.monsters) {
      if (camera.isVisible(m.x, m.y, 120)) drawables.push(m);
    }
    for (const p of world.players) {
      if (!p.dead && camera.isVisible(p.x, p.y, 120)) drawables.push(p);
    }
    for (const n of world.npcs) {
      if (camera.isVisible(n.x, n.y, 120)) drawables.push(n);
    }
    // Painter's algorithm on Y: things lower on screen overlap things above.
    drawables.sort((a, b) => (a.dead === b.dead ? a.y - b.y : a.dead ? -1 : 1));

    for (const a of drawables) this.drawActor(ctx, a, world, localPlayer);
  }

  /**
   * Where to draw a body this frame.
   *
   * The simulation is a fixed 60 Hz but frames arrive at the display rate, so
   * drawing the raw position makes movement step. Blending the previous tick's
   * position toward the current one by the loop's leftover alpha turns that
   * back into smooth motion.
   */
  drawX(a) { return a.px === undefined ? a.x : a.px + (a.x - a.px) * this.alpha; }
  drawY(a) { return a.py === undefined ? a.y : a.py + (a.y - a.py) * this.alpha; }

  drawActor(ctx, a, world, localPlayer) {
    const scale = a.scale || 1;
    const shadowR = (a.radius || 13) * 0.95;
    const ax = this.drawX(a);
    const ay = this.drawY(a);

    // Cast our own shadow rather than using the pack's baked-in one, so it stays
    // put when the sprite mirrors and so lighting stays consistent.
    ctx.save();
    ctx.globalAlpha = a.dead ? 0.18 : 0.34;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(ax, ay + shadowR * 0.55, shadowR, shadowR * 0.45, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    const sheet = this.resolveSheet(a);
    if (!sheet) return;

    const frames = sheet.frames;
    let frame;
    if (a.anim.loop) {
      frame = Math.floor(a.anim.t * a.anim.fps) % frames;
    } else {
      frame = Math.min(frames - 1, Math.floor(a.anim.t * a.anim.fps));
    }

    const size = SPRITE * scale * ACTOR_SCALE;
    ctx.save();
    ctx.translate(ax, ay);
    if (facesLeft(a)) ctx.scale(-1, 1);
    if (a.dead) ctx.globalAlpha = Math.max(0.25, 1 - (a.deathTimer || 0) / 30);
    ctx.drawImage(sheet.img, frame * SPRITE, 0, SPRITE, SPRITE, -size / 2, -size / 2, size, size);

    if (a.hitFlash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(a.hitFlash * 4, 0, 0.85);
      ctx.drawImage(sheet.img, frame * SPRITE, 0, SPRITE, SPRITE, -size / 2, -size / 2, size, size);
    }

    // Burning tints the sprite itself, because a body on fire should read as
    // one at a glance rather than as an icon in the corner of the screen.
    if (!a.dead && a.buffs?.some((b) => b.id === 'burn')) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.28 + 0.16 * Math.sin(this.time * 14 + a.id);
      ctx.drawImage(sheet.img, frame * SPRITE, 0, SPRITE, SPRITE, -size / 2, -size / 2, size, size);
    }
    ctx.restore();

    if (!a.dead && a.buffs) this.drawStatusFx(ctx, a, ax, ay);

    if (a.shield > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#9fd8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ax, ay, (a.radius || 13) + 6, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

  }

  /**
   * Bleeding and burning, drawn on the body.
   *
   * Both are seeded off the actor's id so every character's flames and drips
   * are out of step with everyone else's, and both are pure functions of time -
   * no particle state to keep, and identical on every client.
   */
  drawStatusFx(ctx, a, ax, ay) {
    const r = a.radius || 13;
    const bleeding = a.buffs.some((b) => b.id === 'bleed');
    const burning = a.buffs.some((b) => b.id === 'burn');
    if (!bleeding && !burning) return;

    ctx.save();
    if (burning) {
      // Flames licking up off the shoulders and head.
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const seed = a.id * 0.37 + i * 1.9;
        const t = (this.time * 1.9 + i * 0.2 + seed) % 1;
        const x = ax + Math.sin(seed * 5 + this.time * 3) * r * 0.8;
        const y = ay + r * 0.5 - t * (r * 2.6);
        const h = (1 - t) * 9 + 3;
        ctx.globalAlpha = (1 - t) * 0.75;
        ctx.fillStyle = t < 0.35 ? '#ffe066' : t < 0.7 ? '#ff9a2e' : '#d23b1e';
        // Blocky, to match the art.
        ctx.fillRect(Math.round(x) - 2, Math.round(y) - h / 2, 4, h);
      }
    }
    if (bleeding) {
      // Drips running down and falling off, plus a little pool under the feet.
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 4; i++) {
        const seed = a.id * 0.53 + i * 2.7;
        const t = (this.time * 1.35 + i * 0.27 + seed) % 1;
        const x = ax + Math.sin(seed * 7) * r * 0.85;
        const y = ay - r * 0.35 + t * (r * 2.1);
        ctx.globalAlpha = 0.85 * (1 - t * 0.55);
        ctx.fillStyle = t < 0.5 ? '#c81e1e' : '#8f1010';
        ctx.fillRect(Math.round(x), Math.round(y), 2, 3 + (1 - t) * 3);
      }
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#7a0f0f';
      ctx.fillRect(Math.round(ax - r * 0.5), Math.round(ay + r * 0.85), Math.round(r), 2);
    }
    ctx.restore();
  }

  resolveSheet(a) {
    if (a.kind === 'player') return this.assets.sheet('hero', a.classId, a.anim.key);
    if (a.kind === 'npc') return this.assets.recolorSheet('hero', a.spriteId, a.anim.key, a.tint);
    const sheetId = MONSTERS[a.monsterId]?.sheet || a.monsterId;
    if (a.boss) return this.assets.recolorSheet('mob', sheetId, a.anim.key, BOSS_TINT);
    if (a.elite) return this.assets.recolorSheet('mob', sheetId, a.anim.key, ELITE_TINT);
    return this.assets.sheet('mob', sheetId, a.anim.key);
  }

  // -------------------------------------------------------------------------
  // Overhead labels
  // -------------------------------------------------------------------------

  drawOverheads(ctx, world, camera, localPlayer) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '9px "Courier New", monospace';

    for (const m of world.monsters) {
      if (m.dead || !camera.isVisible(m.x, m.y, 100)) continue;
      const top = m.y - m.radius - (m.boss ? 30 : 20);
      const w = m.boss ? 76 : m.elite ? 52 : 40;
      const frac = clamp(m.hp / m.stats.maxHp, 0, 1);

      // Level + health above the head, as asked for; bosses get their name too.
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(m.x - w / 2 - 1, top - 1, w + 2, 6);
      ctx.fillStyle = m.boss ? '#c264ff' : m.elite ? '#ff9a2e' : '#c8402e';
      ctx.fillRect(m.x - w / 2, top, w * frac, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(m.x - w / 2, top, w, 1);

      ctx.fillStyle = m.boss ? '#e0b0ff' : m.elite ? '#ffc47a' : '#d8d0c4';
      ctx.fillText(
        m.boss || m.elite ? `${m.name}  Lv${m.level}` : `Lv${m.level}`,
        m.x, top - 3,
      );
      if (m.buffs.some((b) => b.id === 'stun')) {
        ctx.fillStyle = '#ffe066';
        ctx.fillText('stunned', m.x, top - 12);
      }
    }

    for (const p of world.players) {
      if (p.dead) continue;
      if (!camera.isVisible(p.x, p.y, 100)) continue;
      const top = p.y - p.radius - 22;
      const frac = clamp(p.hp / p.stats.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(p.x - 22, top - 1, 44, 6);
      ctx.fillStyle = p.downed ? '#666' : '#4caf50';
      ctx.fillRect(p.x - 21, top, 42 * frac, 4);
      // Your own bar, but without the name tag - you know who you are, and the
      // label would sit under the cursor all game.
      if (p === localPlayer) continue;
      ctx.fillStyle = CLASSES[p.classId]?.color || '#fff';
      ctx.fillText(`${p.name}${p.downed ? ' (down)' : ''}`, p.x, top - 3);
    }

    for (const n of world.npcs) {
      if (!camera.isVisible(n.x, n.y, 100)) continue;
      ctx.fillStyle = '#8fe0ff';
      ctx.fillText(n.name, n.x, n.y - n.radius - 16);
      ctx.fillStyle = '#6fa8c0';
      ctx.fillText('merchant', n.x, n.y - n.radius - 6);
    }

    // Downed allies get a marker you can see from across the room.
    for (const p of world.players) {
      if (!p.downed) continue;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
      ctx.save();
      ctx.globalAlpha = 0.4 + pulse * 0.4;
      ctx.strokeStyle = '#ff5555';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x - 9, p.y - 26); ctx.lineTo(p.x + 9, p.y - 8);
      ctx.moveTo(p.x + 9, p.y - 26); ctx.lineTo(p.x - 9, p.y - 8);
      ctx.stroke();
      ctx.restore();
    }

    // Interaction prompt. The stairs are excluded: they are not pressed, they
    // are stood on, and the ritual bar says so far better than a key hint.
    if (localPlayer && !localPlayer.downed) {
      const prop = world.interactTarget(localPlayer);
      if (prop && prop.type !== 'stairs') {
        const c = world.dungeon.tileCenter(prop.x, prop.y);
        const label = {
          chest: 'Open', shrine: 'Pray', merchant: 'Trade',
        }[prop.type] || 'Use';
        ctx.font = 'bold 9px "Courier New", monospace';
        const w = ctx.measureText(`[E] ${label}`).width + 10;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(c.x - w / 2, c.y - 32, w, 12);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText(`[E] ${label}`, c.x, c.y - 23);
      }
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Projectiles and particles
  // -------------------------------------------------------------------------

  drawProjectiles(ctx, world, camera) {
    for (const pr of world.projectiles) {
      if (!camera.isVisible(pr.x, pr.y, 60)) continue;
      const prx = this.drawX(pr), pry = this.drawY(pr);
      if (pr.sprite) {
        const img = this.assets.img(pr.sprite);
        if (img) {
          const s = SPRITE * (pr.scale || 1);
          ctx.save();
          ctx.translate(prx, pry);
          ctx.rotate(pr.angle);
          ctx.drawImage(img, -s / 2, -s / 2, s, s);
          ctx.restore();
          continue;
        }
      }
      const color = pr.glow || '#ffd27f';
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = pr.radius * 2.4;
      const g = ctx.createRadialGradient(prx, pry, 0, prx, pry, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(prx, pry, r, 0, TAU);
      ctx.fill();
      // Motion streak behind the bolt.
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = pr.radius;
      ctx.beginPath();
      ctx.moveTo(prx, pry);
      ctx.lineTo(prx - Math.cos(pr.angle) * 22, pry - Math.sin(pr.angle) * 22);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawFx(ctx, world, camera) {
    for (const f of world.fx) {
      const t = clamp(f.t / f.life, 0, 1);
      if (!camera.isVisible(f.x, f.y, 200)) continue;
      switch (f.type) {
        case 'gather': {
          // The loot arcs off the floor and onto the collector, shrinking as it
          // lands. Drawn after the actors so it finishes in front of them.
          const target = world.byId.get(f.to);
          if (!target) break;
          const ease = t * t * (3 - 2 * t);
          const gx = f.x + (this.drawX(target) - f.x) * ease;
          const gy = f.y + (this.drawY(target) - 14 - f.y) * ease - Math.sin(t * Math.PI) * 24;
          const scale = 1 - t * 0.45;

          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - t) * 0.5;
          const trail = ctx.createRadialGradient(gx, gy, 0, gx, gy, 18 * scale);
          trail.addColorStop(0, f.gold ? '#ffd23f' : '#fff2c4');
          trail.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = trail;
          ctx.beginPath();
          ctx.arc(gx, gy, 18 * scale, 0, TAU);
          ctx.fill();
          ctx.restore();

          const icons = this.assets.img('icons');
          if (f.icon && icons) {
            const s = 22 * scale;
            ctx.save();
            ctx.globalAlpha = 1 - t * 0.35;
            ctx.drawImage(icons, f.icon[0] * ICON_SIZE, f.icon[1] * ICON_SIZE, ICON_SIZE, ICON_SIZE,
              gx - s / 2, gy - s / 2, s, s);
            ctx.restore();
          }
          break;
        }
        case 'slash': {
          ctx.save();
          ctx.translate(f.x, f.y);
          ctx.rotate(f.angle);
          ctx.globalAlpha = (1 - t) * 0.75;
          ctx.strokeStyle = f.color || '#fff';
          ctx.lineWidth = 5 * (1 - t * 0.5);
          ctx.beginPath();
          ctx.arc(0, 0, f.radius * (0.65 + t * 0.4), -f.arc / 2, f.arc / 2);
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'stab': {
          // Short and quick: a stubby blade that snaps out and back, so it
          // reads as a jab rather than a shortened version of the lance.
          ctx.save();
          ctx.translate(f.x, f.y);
          ctx.rotate(f.angle);
          // Out fast, back in - peaks a third of the way through the effect.
          const punch = t < 0.34 ? t / 0.34 : 1 - (t - 0.34) / 0.66 * 0.45;
          const reach = f.radius * (0.45 + punch * 0.55);
          const halfW = f.radius * 0.2 * (1 - t * 0.4);
          ctx.globalAlpha = (1 - t * t) * 0.9;
          ctx.fillStyle = f.color || '#fff';
          ctx.beginPath();
          ctx.moveTo(4, -halfW);
          ctx.lineTo(reach - 5, -halfW * 0.45);
          ctx.lineTo(reach, 0);
          ctx.lineTo(reach - 5, halfW * 0.45);
          ctx.lineTo(4, halfW);
          ctx.closePath();
          ctx.fill();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - t) * 0.75;
          const spark = ctx.createRadialGradient(reach, 0, 0, reach, 0, 8);
          spark.addColorStop(0, '#ffffff');
          spark.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = spark;
          ctx.beginPath();
          ctx.arc(reach, 0, 8, 0, TAU);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'thrust': {
          // A tapered lance stroke that reaches the full hit range, so the
          // weapon's reach is obvious from the animation alone.
          ctx.save();
          ctx.translate(f.x, f.y);
          ctx.rotate(f.angle);
          // Peaks at exactly f.radius, which is the melee range, so the
          // animation never promises reach the hitbox does not have.
          const reach = f.radius * (0.5 + t * 0.5);
          const halfW = (f.radius * 0.16) * (1 - t * 0.55);
          ctx.globalAlpha = (1 - t) * 0.85;
          ctx.fillStyle = f.color || '#fff';
          ctx.beginPath();
          ctx.moveTo(6, -halfW);
          ctx.lineTo(reach - 7, -halfW * 0.28);
          ctx.lineTo(reach, 0);
          ctx.lineTo(reach - 7, halfW * 0.28);
          ctx.lineTo(6, halfW);
          ctx.closePath();
          ctx.fill();
          // Bright point at the tip of the reach.
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - t) * 0.9;
          const tip = ctx.createRadialGradient(reach, 0, 0, reach, 0, 11);
          tip.addColorStop(0, '#ffffff');
          tip.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = tip;
          ctx.beginPath();
          ctx.arc(reach, 0, 11, 0, TAU);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'spin': {
          ctx.save();
          ctx.globalAlpha = (1 - t) * 0.5;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.radius * (0.7 + t * 0.35), 0, TAU);
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'hit': {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = f.color;
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * TAU + f.x;
            const d = t * 22;
            ctx.beginPath();
            ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 3 * (1 - t), 0, TAU);
            ctx.fill();
          }
          ctx.restore();
          break;
        }
        case 'blast': {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - t) * 0.9;
          const r = f.radius * (0.4 + t * 0.75);
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.3, f.color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(f.x, f.y, r, 0, TAU);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'sheet': {
          const sh = this.assets.sheets.get('fx:' + f.sheet);
          if (sh) {
            const frame = Math.min(sh.frames - 1, Math.floor(t * sh.frames));
            const s = (f.radius || 60) * 2.2;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(sh.img, frame * SPRITE, 0, SPRITE, SPRITE, f.x - s / 2, f.y - s / 2, s, s);
            ctx.restore();
          }
          break;
        }
        case 'ward':
        case 'heal':
        case 'summon': {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - t) * 0.8;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.radius * (0.3 + t), 0, TAU);
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'impact': {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = f.color;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.radius * (1 - t * 0.5), 0, TAU);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'chain': {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let i = 0; i < f.points.length - 1; i++) {
            const a = f.points[i], b = f.points[i + 1];
            ctx.moveTo(a.x, a.y);
            // Jagged midpoints read as lightning rather than a drawn line.
            const segs = 4;
            for (let s = 1; s <= segs; s++) {
              const u = s / segs;
              const jx = (Math.random() - 0.5) * 14 * (s < segs ? 1 : 0);
              const jy = (Math.random() - 0.5) * 14 * (s < segs ? 1 : 0);
              ctx.lineTo(a.x + (b.x - a.x) * u + jx, a.y + (b.y - a.y) * u + jy);
            }
          }
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'spikes': {
          ctx.save();
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = f.color;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU;
            const d = 6 + t * 16;
            ctx.beginPath();
            ctx.moveTo(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d);
            ctx.lineTo(f.x + Math.cos(a + 0.25) * (d + 12), f.y + Math.sin(a + 0.25) * (d + 12));
            ctx.lineTo(f.x + Math.cos(a - 0.25) * (d + 12), f.y + Math.sin(a - 0.25) * (d + 12));
            ctx.fill();
          }
          ctx.restore();
          break;
        }
        default:
          break;
      }
    }
  }

  drawFloaters(ctx, world, camera) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const f of world.floaters) {
      if (!camera.isVisible(f.x, f.y, 120)) continue;
      const t = f.t / f.life;
      ctx.globalAlpha = clamp(1 - t * t, 0, 1);
      const size = Math.round(11 * (f.scale || 1));
      ctx.font = `bold ${size}px "Courier New", monospace`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Lighting
  // -------------------------------------------------------------------------

  /**
   * A cheap multiply pass. Torches, spell effects and each player carry a light;
   * everything else falls off to the floor's ambient colour, which is what
   * makes deeper floors feel darker without touching the art.
   */
  drawLighting(world, camera) {
    const lc = this.lightCtx;
    const s = this.lightScale;
    const w = this.lightCanvas.width, h = this.lightCanvas.height;

    lc.globalCompositeOperation = 'source-over';
    lc.fillStyle = world.dungeon.theme.ambient || '#101018';
    lc.fillRect(0, 0, w, h);
    lc.globalCompositeOperation = 'lighter';

    const addLight = (wx, wy, radius, color, intensity = 1) => {
      const p = camera.worldToScreen(wx, wy);
      const px = p.x * s, py = p.y * s;
      const r = radius * camera.zoom * s;
      if (px < -r || py < -r || px > w + r || py > h + r) return;
      const g = lc.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, color);
      g.addColorStop(0.55, `rgba(${hexToRgb(color)},${0.35 * intensity})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.globalAlpha = intensity;
      lc.beginPath();
      lc.arc(px, py, r, 0, TAU);
      lc.fill();
    };

    const d = world.dungeon;
    const b = camera.tileBounds(d);
    for (const p of d.props) {
      if (p.type !== 'torch') continue;
      if (p.x < b.x0 - 4 || p.x > b.x1 + 4 || p.y < b.y0 - 4 || p.y > b.y1 + 4) continue;
      const flicker = 0.82 + 0.18 * Math.sin(this.time * 9 + p.x * 2.3 + p.y * 1.7);
      addLight(p.x * TILE + TILE / 2, p.y * TILE + 10, 190 * flicker, '#ffb35c', 0.95);
    }
    for (const p of d.props) {
      if (p.type === 'stairs') addLight(p.x * TILE + 24, p.y * TILE + 24, 200, '#7fe6ff', 0.9);
      if (p.type === 'shrine' && !p.used) addLight(p.x * TILE + 24, p.y * TILE + 24, 170, '#8fd8ff', 0.8);
      if (p.type === 'entrance') addLight(p.x * TILE + 24, p.y * TILE + 24, 150, '#9fe0a0', 0.7);
    }

    for (const p of world.players) {
      if (p.dead) continue;
      addLight(p.x, p.y, p.downed ? 150 : 310, p.downed ? '#883333' : '#fff3d8', p.downed ? 0.5 : 1);
    }
    for (const pr of world.projectiles) {
      if (pr.glow) addLight(pr.x, pr.y, 110, pr.glow, 0.8);
    }
    for (const f of world.fx) {
      if (f.type === 'blast' || f.type === 'sheet') {
        addLight(f.x, f.y, (f.radius || 60) * 2.4, f.color || '#ffb060', 1 - f.t / f.life);
      }
    }
    for (const z of world.zones) addLight(z.x, z.y, z.radius * 1.5, z.color, 0.55);

    lc.globalAlpha = 1;

    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.lightCanvas, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
  }
}

/**
 * Which way a character sprite should face.
 *
 * The art is drawn facing right, so we only ever mirror it - characters do not
 * spin to the aim angle. Aiming straight up or down leaves the horizontal
 * component near zero, which would make the sprite flicker between facings, so
 * the last decision sticks until the aim is clearly to one side. The flag is
 * cached on the entity because it is presentation state, not simulation state.
 */
const FACE_DEADZONE = 0.15;

function facesLeft(a) {
  const c = Math.cos(a.facing || 0);
  if (a.faceLeft === undefined) a.faceLeft = c < 0;
  else if (c < -FACE_DEADZONE) a.faceLeft = true;
  else if (c > FACE_DEADZONE) a.faceLeft = false;
  return a.faceLeft;
}

/** Rounded rectangle path helper - used by the trap plates. */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const rgbCache = new Map();
function hexToRgb(hex) {
  let v = rgbCache.get(hex);
  if (v) return v;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  v = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  rgbCache.set(hex, v);
  return v;
}
