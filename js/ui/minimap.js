import { TILE } from '../assets/manifest.js';
import { clamp } from '../core/util.js';

/**
 * Fog-of-war minimap.
 *
 * Explored tiles are baked into an offscreen 1px-per-tile image that is only
 * repainted when new ground is revealed; the corner map and the full-screen map
 * are both just scaled blits of that image plus live markers on top.
 */
export class Minimap {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.base = document.createElement('canvas');
    this.baseCtx = this.base.getContext('2d');
    this.revealed = 0;
    this.dirty = true;
    this.expanded = false;
    this.dungeonRef = null;
  }

  setWorld(world) {
    this.world = world;
    this.dungeonRef = null;
    this.dirty = true;
  }

  ensureBase() {
    const d = this.world.dungeon;
    if (!d) return false;
    if (this.dungeonRef !== d) {
      this.dungeonRef = d;
      this.base.width = d.w;
      this.base.height = d.h;
      this.revealed = -1;
      this.dirty = true;
    }
    return true;
  }

  /** Repaint the explored image. Cheap enough to do a few times a second. */
  bake() {
    const d = this.world.dungeon;
    const ctx = this.baseCtx;
    const img = ctx.createImageData(d.w, d.h);
    const data = img.data;
    const explored = this.world.explored;

    for (let i = 0; i < d.tiles.length; i++) {
      const o = i * 4;
      if (!explored[i]) { data[o + 3] = 0; continue; }
      if (d.tiles[i] === 0) {
        data[o] = 26; data[o + 1] = 20; data[o + 2] = 18; data[o + 3] = 210;
        continue;
      }
      const roomId = d.roomId[i];
      const room = roomId >= 0 ? d.rooms[roomId] : null;
      let r = 118, g = 102, b = 82;
      if (d.corridor[i]) { r = 84; g = 74; b = 62; }
      if (room) {
        switch (room.kind) {
          case 'boss': r = 150; g = 62; b = 62; break;
          case 'shop': r = 168; g = 148; b = 66; break;
          case 'vault': r = 160; g = 118; b = 48; break;
          case 'shrine': r = 74; g = 118; b = 158; break;
          case 'entrance': r = 74; g = 138; b = 88; break;
          case 'trapped': r = 128; g = 78; b = 138; break;
          default: break;
        }
      }
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.dirty = false;
  }

  update() {
    if (!this.ensureBase()) return;
    let count = 0;
    const e = this.world.explored;
    // Sampling every 8th tile is enough to notice new ground without scanning
    // 20k entries every frame.
    for (let i = 0; i < e.length; i += 8) count += e[i];
    if (count !== this.revealed) {
      this.revealed = count;
      this.dirty = true;
    }
    if (this.dirty) this.bake();
  }

  render(localPlayer) {
    if (!this.ensureBase()) return;
    const d = this.world.dungeon;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = 'rgba(8,7,10,0.82)';
    ctx.fillRect(0, 0, W, H);

    if (this.expanded) {
      const scale = Math.min(W / d.w, H / d.h) * 0.94;
      const ox = (W - d.w * scale) / 2;
      const oy = (H - d.h * scale) / 2;
      ctx.drawImage(this.base, ox, oy, d.w * scale, d.h * scale);
      this.drawMarkers(ctx, localPlayer, (tx, ty) => ({ x: ox + tx * scale, y: oy + ty * scale }), scale, true);
    } else {
      // Windowed view centred on the player.
      const scale = 2.6;
      const spanX = W / scale, spanY = H / scale;
      const px = localPlayer ? localPlayer.x / TILE : d.w / 2;
      const py = localPlayer ? localPlayer.y / TILE : d.h / 2;
      const ox = clamp(px - spanX / 2, 0, Math.max(0, d.w - spanX));
      const oy = clamp(py - spanY / 2, 0, Math.max(0, d.h - spanY));
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      ctx.drawImage(this.base, -ox * scale, -oy * scale, d.w * scale, d.h * scale);
      this.drawMarkers(ctx, localPlayer, (tx, ty) => ({ x: (tx - ox) * scale, y: (ty - oy) * scale }), scale, false);
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(180,160,120,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  drawMarkers(ctx, localPlayer, project, scale, expanded) {
    const world = this.world;
    const d = world.dungeon;
    const explored = world.explored;
    const dot = (tx, ty, color, size) => {
      const p = project(tx + 0.5, ty + 0.5);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    };

    for (const prop of d.props) {
      const i = d.idx(prop.x, prop.y);
      if (!explored[i]) continue;
      if (prop.type === 'chest' && !prop.opened) dot(prop.x, prop.y, '#ffd23f', expanded ? 2.4 : 2);
      else if (prop.type === 'merchant') dot(prop.x, prop.y, '#5fe0e0', expanded ? 3 : 2.5);
      else if (prop.type === 'shrine' && !prop.used) dot(prop.x, prop.y, '#8fd8ff', expanded ? 2.6 : 2.2);
      else if (prop.type === 'stairs') {
        const p = project(prop.x + 0.5, prop.y + 0.5);
        ctx.save();
        ctx.fillStyle = world.stairsUnlocked ? '#7fe6ff' : '#a05050';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 5);
        ctx.lineTo(p.x + 5, p.y + 4);
        ctx.lineTo(p.x - 5, p.y + 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // Only monsters on explored ground, so the map is not an x-ray.
    for (const m of world.monsters) {
      if (m.dead) continue;
      const tx = Math.floor(m.x / TILE), ty = Math.floor(m.y / TILE);
      if (!d.inBounds(tx, ty) || !explored[d.idx(tx, ty)]) continue;
      if (!m.boss && !expanded && !this.nearAnyPlayer(m, 620)) continue;
      if (!m.boss && expanded && !this.nearAnyPlayer(m, 620)) continue;
      dot(tx, ty, m.boss ? '#ff4fd8' : m.elite ? '#ff9a2e' : '#d05050', m.boss ? 3.5 : 1.6);
    }

    for (const p of world.players) {
      if (p.dead) continue;
      const tx = p.x / TILE, ty = p.y / TILE;
      const proj = project(tx, ty);
      ctx.save();
      ctx.fillStyle = p === localPlayer ? '#7fff9f' : p.downed ? '#888' : '#7fc8ff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, p === localPlayer ? 3.4 : 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (p === localPlayer) {
        ctx.strokeStyle = '#7fff9f';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(proj.x, proj.y);
        ctx.lineTo(proj.x + Math.cos(p.facing) * 8, proj.y + Math.sin(p.facing) * 8);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  nearAnyPlayer(m, radius) {
    for (const p of this.world.players) {
      if (p.dead) continue;
      if (Math.hypot(m.x - p.x, m.y - p.y) < radius) return true;
    }
    return false;
  }
}
