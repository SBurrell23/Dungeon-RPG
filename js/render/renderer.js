import {
  TILE, VOID_COLOR, ANIM_TILES, CHEST, ICON_SIZE,
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

/** Chests are drawn below tile size so they read as objects, not architecture. */
const CHEST_SIZE = 38;

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
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.lightCanvas.width = Math.max(1, Math.ceil(w * this.lightScale));
    this.lightCanvas.height = Math.max(1, Math.ceil(h * this.lightScale));
  }

  render(world, camera, localPlayer, dt) {
    this.time += dt;
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
          ctx.save();
          if (!world.stairsUnlocked) ctx.globalAlpha = 0.35;
          if (img) ctx.drawImage(img, px, py - TILE, img.width, img.height);
          ctx.restore();
          if (world.stairsUnlocked) {
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
          }
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
          if (!cavern) break;
          const set = CHEST[p.tier] || CHEST.common;
          const [sc, sr] = p.opened ? set.open : set.closed;
          const off = (TILE - CHEST_SIZE) / 2;
          ctx.drawImage(cavern, sc * TILE, sr * TILE, TILE, TILE,
            px + off, py + off + 4, CHEST_SIZE, CHEST_SIZE);
          break;
        }
        case 'trap': {
          if (p.spent || !p.seen) break;
          this.drawTrap(ctx, p, px, py);
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Traps are drawn in JS rather than from the sheet so their state reads at a
   * glance. Only called once a player has come close enough to spot the trap;
   * an armed one pulses, a spent-but-persistent one sits dull.
   */
  drawTrap(ctx, p, px, py) {
    const cx = px + TILE / 2, cy = py + TILE / 2;
    ctx.save();

    const colors = {
      spike: '#b9bfd0', dart: '#c8a26a', flame: '#ff7a3c', poison: '#8ad86a',
    };
    const c = colors[p.kind] || '#aaa';

    ctx.strokeStyle = c;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, TAU);
    ctx.stroke();

    if (p.armed) {
      ctx.globalAlpha *= 0.55 + 0.45 * Math.sin(this.time * 4 + p.x);
    } else {
      ctx.globalAlpha *= 0.5;
    }
    ctx.fillStyle = c;
    if (p.kind === 'spike') {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4);
        ctx.lineTo(cx + Math.cos(a + 0.4) * 11, cy + Math.sin(a + 0.4) * 11);
        ctx.lineTo(cx + Math.cos(a - 0.4) * 11, cy + Math.sin(a - 0.4) * 11);
        ctx.fill();
      }
    } else if (p.kind === 'dart') {
      ctx.fillRect(cx - 9, cy - 2, 18, 4);
      ctx.fillRect(cx - 2, cy - 9, 4, 18);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, TAU);
      ctx.fill();
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

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.time * 5);
      const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 34);
      g.addColorStop(0, glow);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 34, 0, TAU);
      ctx.fill();
      ctx.restore();

      const item = p.items.find((i) => i.type !== 'gold') || p.items[0];
      if (item && icons && item.icon) {
        const s = 26;
        ctx.drawImage(icons, item.icon[0] * ICON_SIZE, item.icon[1] * ICON_SIZE, ICON_SIZE, ICON_SIZE,
          p.x - s / 2, p.y - s / 2 + bob - 6, s, s);
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

  drawActor(ctx, a, world, localPlayer) {
    const scale = a.scale || 1;
    const shadowR = (a.radius || 13) * 0.95;

    // Cast our own shadow rather than using the pack's baked-in one, so it stays
    // put when the sprite mirrors and so lighting stays consistent.
    ctx.save();
    ctx.globalAlpha = a.dead ? 0.18 : 0.34;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(a.x, a.y + shadowR * 0.55, shadowR, shadowR * 0.45, 0, 0, TAU);
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
    ctx.translate(a.x, a.y);
    if (facesLeft(a)) ctx.scale(-1, 1);
    if (a.dead) ctx.globalAlpha = Math.max(0.25, 1 - (a.deathTimer || 0) / 30);
    ctx.drawImage(sheet.img, frame * SPRITE, 0, SPRITE, SPRITE, -size / 2, -size / 2, size, size);

    if (a.hitFlash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(a.hitFlash * 4, 0, 0.85);
      ctx.drawImage(sheet.img, frame * SPRITE, 0, SPRITE, SPRITE, -size / 2, -size / 2, size, size);
    }
    ctx.restore();

    if (a.shield > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#9fd8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(a.x, a.y, (a.radius || 13) + 6, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

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
      if (p === localPlayer || p.dead) continue;
      if (!camera.isVisible(p.x, p.y, 100)) continue;
      const top = p.y - p.radius - 22;
      const frac = clamp(p.hp / p.stats.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(p.x - 22, top - 1, 44, 6);
      ctx.fillStyle = p.downed ? '#666' : '#4caf50';
      ctx.fillRect(p.x - 21, top, 42 * frac, 4);
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

    // Interaction prompt.
    if (localPlayer && !localPlayer.downed) {
      const prop = world.interactTarget(localPlayer);
      if (prop) {
        const c = world.dungeon.tileCenter(prop.x, prop.y);
        const label = {
          chest: 'Open', shrine: 'Pray', merchant: 'Trade',
          stairs: world.stairsUnlocked ? 'Descend' : 'Sealed',
        }[prop.type] || 'Use';
        ctx.font = 'bold 11px "Courier New", monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(c.x - 34, c.y - 52, 68, 15);
        ctx.fillStyle = world.stairsUnlocked || prop.type !== 'stairs' ? '#ffe9a8' : '#ff8080';
        ctx.fillText(`[E] ${label}`, c.x, c.y - 41);
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
      if (pr.sprite) {
        const img = this.assets.img(pr.sprite);
        if (img) {
          const s = SPRITE * (pr.scale || 1);
          ctx.save();
          ctx.translate(pr.x, pr.y);
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
      const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, r, 0, TAU);
      ctx.fill();
      // Motion streak behind the bolt.
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = pr.radius;
      ctx.beginPath();
      ctx.moveTo(pr.x, pr.y);
      ctx.lineTo(pr.x - Math.cos(pr.angle) * 22, pr.y - Math.sin(pr.angle) * 22);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawFx(ctx, world, camera) {
    for (const f of world.fx) {
      const t = clamp(f.t / f.life, 0, 1);
      if (!camera.isVisible(f.x, f.y, 200)) continue;
      switch (f.type) {
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
      if (p.type === 'stairs' && world.stairsUnlocked) addLight(p.x * TILE + 24, p.y * TILE + 24, 200, '#7fe6ff', 0.9);
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
