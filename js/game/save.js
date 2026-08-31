import { createMonster } from './entities.js';
import { recomputeStats } from './stats.js';
import { getClass } from './classes.js';
import { seedIdCounter } from '../core/util.js';
import { resetItemUid, peekItemUid } from './items.js';

/**
 * Host-side autosave.
 *
 * The dungeon itself is never serialised - it is regenerated from the seed and
 * floor number, which is exact. Only the parts that diverge from a fresh
 * generation are stored: what the party is carrying, what has been killed or
 * opened, and where the fog has been lifted.
 */

const KEY = 'dungeonrpg.save.v1';
const VERSION = 1;

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function readSaveMeta() {
  const raw = safeRead();
  if (!raw) return null;
  return {
    floor: raw.floorNo,
    seed: raw.seed,
    savedAt: raw.savedAt,
    runTime: raw.runTime,
    party: (raw.players || []).map((p) => ({ name: p.name, classId: p.classId, level: p.level })),
  };
}

export function deleteSave() {
  try { localStorage.removeItem(KEY); } catch { /* storage disabled */ }
}

function safeRead() {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const data = JSON.parse(s);
    return data.version === VERSION ? data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

export function saveWorld(world) {
  if (!world.isHost || !world.dungeon) return false;
  try {
    const data = {
      version: VERSION,
      savedAt: Date.now(),
      seed: world.seed,
      floorNo: world.floorNo,
      runTime: world.runTime,
      itemUid: peekItemUid(),
      stairsUnlocked: world.stairsUnlocked,
      players: world.players.map(serialisePlayer),
      monsters: world.monsters.filter((m) => !m.expired).map(serialiseMonster),
      props: world.dungeon.props.map((p, i) => ({
        i,
        opened: p.opened || false,
        used: p.used || false,
        armed: p.armed !== false,
        hidden: p.hidden || false,
        locked: p.locked || false,
      })),
      pickups: world.pickups.map((p) => ({ x: p.x, y: p.y, items: p.items })),
      explored: encodeBits(world.explored),
      log: world.log.slice(-20).map((l) => ({ text: l.text, color: l.color })),
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('[save] failed', err);
    return false;
  }
}

function serialisePlayer(p) {
  return {
    peerId: p.peerId,
    slot: p.slot,
    name: p.name,
    classId: p.classId,
    level: p.level,
    xp: p.xp,
    unspentPoints: p.unspentPoints,
    allocated: p.allocated,
    hp: p.hp,
    mp: p.mp,
    gold: p.gold,
    equipment: p.equipment,
    inventory: p.inventory,
    hotbar: p.hotbar,
    knownSpells: p.knownSpells,
    quickHeal: p.quickHeal,
    quickMana: p.quickMana,
    stat: p.stat,
    downed: p.downed,
    x: p.x,
    y: p.y,
  };
}

function serialiseMonster(m) {
  return {
    monsterId: m.monsterId,
    level: m.level,
    elite: m.elite,
    boss: m.boss,
    x: Math.round(m.x),
    y: Math.round(m.y),
    hp: Math.round(m.hp),
    dead: m.dead,
    roomId: m.roomId,
    summoned: m.summoned || false,
  };
}

// ---------------------------------------------------------------------------

/**
 * Rebuild a world from the save. The caller supplies a freshly constructed
 * World; this fills it in and returns the roster so the lobby/net layer can
 * reattach peers to their characters.
 */
export function loadIntoWorld(World, { bossForFloor } = {}) {
  const data = safeRead();
  if (!data) return null;

  const world = new World({ seed: data.seed, isHost: true });
  world.runTime = data.runTime || 0;
  resetItemUid(data.itemUid || 1);

  // Recreate players before generating the floor: floor size depends on party size.
  for (const sp of data.players) {
    const p = world.addPlayer({ peerId: sp.peerId, name: sp.name, classId: sp.classId, slot: sp.slot });
    Object.assign(p, {
      level: sp.level, xp: sp.xp, unspentPoints: sp.unspentPoints,
      allocated: sp.allocated || { str: 0, dex: 0, int: 0, vit: 0 },
      gold: sp.gold, equipment: sp.equipment, inventory: sp.inventory,
      hotbar: sp.hotbar, knownSpells: sp.knownSpells,
      quickHeal: sp.quickHeal, quickMana: sp.quickMana,
      stat: sp.stat, downed: sp.downed,
    });
    recomputeStats(p, getClass(p.classId));
    p.hp = Math.max(1, Math.min(sp.hp, p.stats.maxHp));
    p.mp = Math.min(sp.mp, p.stats.maxMp);
    // Highest uid in play must not collide with newly rolled items.
    for (const it of [...p.inventory, ...Object.values(p.equipment).filter(Boolean)]) {
      if (it.uid) seedIdCounter(it.uid + 1);
    }
  }

  world.loadFloor(data.floorNo, { keepPlayers: true });

  // Restore player positions after the floor rebuilt them at the entrance.
  data.players.forEach((sp, i) => {
    const p = world.players[i];
    if (!p) return;
    if (typeof sp.x === 'number' && world.dungeon.isFloor(Math.floor(sp.x / 48), Math.floor(sp.y / 48))) {
      p.x = sp.x; p.y = sp.y;
    }
    p.downed = !!sp.downed;
    if (p.downed) p.hp = 0;
  });

  // Replace the freshly spawned monsters with the saved ones.
  world.monsters = [];
  for (const sm of data.monsters) {
    const boss = sm.boss ? bossForFloor?.(sm.boss) : null;
    const m = createMonster({
      monsterId: sm.monsterId, level: sm.level, elite: sm.elite,
      boss, x: sm.x, y: sm.y, rng: world.rng,
    });
    m.hp = sm.hp;
    m.dead = sm.dead;
    m.roomId = sm.roomId;
    m.summoned = sm.summoned;
    if (m.dead) { m.deathTimer = 5; m.anim.key = 'death'; m.anim.t = 5; m.anim.loop = false; }
    world.addMonster(m);
  }

  // Prop state.
  data.props.forEach((sp) => {
    const prop = world.dungeon.props[sp.i];
    if (!prop) return;
    if ('opened' in sp) prop.opened = sp.opened;
    if ('used' in sp) prop.used = sp.used;
    if (prop.type === 'trap') { prop.armed = sp.armed; prop.hidden = sp.hidden; }
    if (prop.type === 'stairs') prop.locked = sp.locked;
  });
  world.stairsUnlocked = !!data.stairsUnlocked;

  for (const pk of data.pickups || []) {
    world.pickups.push({ id: Math.random() * 1e9 | 0, kind: 'loot', x: pk.x, y: pk.y, items: pk.items, bob: 0, age: 0, dead: false });
  }

  decodeBits(data.explored, world.explored);

  // Merchant stock is deterministic from the seed and was already rebuilt by
  // loadFloor, so nothing to restore here.

  for (const l of data.log || []) world.log.push({ ...l, t: 0 });
  return world;
}

// ---------------------------------------------------------------------------
// Fog packing: 1 bit per tile, base64. A 148x148 floor is ~3.6 KB packed.
// ---------------------------------------------------------------------------

function encodeBits(bytes) {
  if (!bytes) return '';
  const packed = new Uint8Array(Math.ceil(bytes.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i]) packed[i >> 3] |= 1 << (i & 7);
  }
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < packed.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, packed.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function decodeBits(b64, target) {
  if (!b64 || !target) return;
  try {
    const bin = atob(b64);
    for (let i = 0; i < target.length; i++) {
      const byte = bin.charCodeAt(i >> 3);
      target[i] = (byte >> (i & 7)) & 1;
    }
  } catch { /* corrupted fog is cosmetic; ignore */ }
}
