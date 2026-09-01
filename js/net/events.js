import { createMonster } from '../game/entities.js';
import { bossForFloor } from '../game/monsters.js';

/**
 * Apply one host event to a client world.
 *
 * The snapshot describes what things *are*; this stream describes what just
 * *happened* - a hit landing, a chest opening, a monster being born. It lives
 * here rather than in main.js so a test can drive it without booting the game.
 */
export function applyRemoteEvent(world, e, onStockChanged) {
  switch (e.t) {
    case 'dmg': {
      const target = world.byId.get(e.id);
      if (!target) break;
      target.hitFlash = 0.16;
      const color = e.c ? '#ffd23f' : target.kind === 'player' ? '#ff6b6b' : '#ffffff';
      world.floatText(target.x, target.y - target.radius - 10, e.a + (e.c ? '!' : ''), color, e.c ? 1.4 : 1);
      world.spawnFx('hit', target.x, target.y, { color: e.ty === 'phys' ? '#ff5a5a' : '#c08aff', radius: 10, life: 0.18 });
      break;
    }
    case 'txt':
      world.floatText(e.x, e.y, e.s, e.c, e.sc || 1);
      break;
    case 'fx':
      world.spawnFx(e.k, e.x, e.y, e.o || {});
      break;
    case 'sfx':
      world.sfxAt(e.x, e.y, e.n);
      break;
    case 'log':
      world.pushLog(e.s, e.c);
      break;
    case 'shake':
      world.shake(e.a);
      break;
    case 'unlock':
      break;
    case 'spawn': {
      // A monster born after the floor manifest went out: a summoned add or a
      // slime's children. Built the same way applyFloorManifest builds one.
      if (world.byId.get(e.id)) break;
      const m = createMonster({
        monsterId: e.k, level: e.lv, elite: !!e.e,
        boss: e.b ? bossForFloor(e.b) : null,
        x: e.x, y: e.y, rng: world.rng,
      });
      m.id = e.id;
      m.stats.maxHp = e.hp;
      m.hp = e.hp;
      m.roomId = e.r;
      m.name = e.n;
      if (e.sc) { m.scale = e.sc; }
      if (e.rad) m.radius = e.rad;
      world.monsters.push(m);
      world.byId.set(m.id, m);
      break;
    }
    case 'chest': {
      const prop = world.dungeon.props.find((p) => p.type === 'chest' && p.x === e.x && p.y === e.y);
      if (prop) prop.opened = true;
      break;
    }
    case 'shrine': {
      const prop = world.dungeon.props.find((p) => p.type === 'shrine' && p.x === e.x && p.y === e.y);
      if (prop) prop.used = true;
      break;
    }
    case 'stock': {
      const npc = world.npcs.find((n) => n.id === e.npc);
      const entry = npc?.stock[e.i];
      if (entry) entry.qty--;
      onStockChanged?.();
      break;
    }
    default:
      break;
  }
}
