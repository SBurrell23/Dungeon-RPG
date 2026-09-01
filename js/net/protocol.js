import { createMonster } from '../game/entities.js';
import { bossForFloor } from '../game/monsters.js';
import { dist2 } from '../core/util.js';

/**
 * Wire protocol.
 *
 * The host is authoritative for everything. Clients regenerate the dungeon
 * locally from the seed (identical output, zero bytes on the wire) and receive
 * only what cannot be derived: who is where, how hurt they are, and what just
 * happened.
 */

export const MSG = {
  HELLO: 'hello',       // client -> host: I exist, here is my name
  LOBBY: 'lobby',       // host -> client: current roster
  SELECT: 'select',     // client -> host: class choice / ready toggle
  START: 'start',       // host -> client: run is beginning
  FLOOR: 'floor',       // host -> client: floor contents (spawn manifest)
  SNAP: 'snap',         // host -> client: per-tick dynamic state
  SELF: 'self',         // host -> client: your own character in full
  MINE: 'mine',         // host -> client: your own volatile numbers, often
  EVENT: 'event',       // host -> client: discrete happenings
  INPUT: 'input',       // client -> host: movement/attack intent
  ACT: 'act',           // client -> host: inventory / shop / descend request
  CHAT: 'chat',
  GAMEOVER: 'gameover',
  KICK: 'kick',
};

/** How often the host ships a snapshot. Clients interpolate between them. */
export const SNAPSHOT_HZ = 20;
export const INPUT_HZ = 30;
/** Per-peer personal state (xp, mana, cooldowns, gold). Small, so it can be frequent. */
export const PERSONAL_HZ = 10;

const RELEVANCE = 1500;   // px; entities beyond this are not worth sending
const MAX_MOBS = 90;

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * Build the per-tick state blob.
 * Arrays instead of objects: this is the message that goes out 20x a second.
 */
export function buildSnapshot(world) {
  const players = world.players.map((p) => [
    p.id, Math.round(p.x), Math.round(p.y), +p.facing.toFixed(2),
    Math.round(p.hp), Math.round(p.mp), p.anim.key, +p.anim.t.toFixed(2),
    p.level, (p.downed ? 1 : 0) | (p.dead ? 2 : 0), Math.round(p.shield),
    Math.round(p.stats.maxHp), Math.round(p.stats.maxMp),
  ]);

  const anchors = world.players.filter((p) => !p.dead);
  const relevant = [];
  for (const m of world.monsters) {
    if (m.expired) continue;
    let near = anchors.length === 0;
    for (const a of anchors) {
      if (dist2(m.x, m.y, a.x, a.y) < RELEVANCE * RELEVANCE) { near = true; break; }
    }
    if (near) relevant.push(m);
  }
  relevant.length = Math.min(relevant.length, MAX_MOBS);

  const mobs = relevant.map((m) => [
    m.id, Math.round(m.x), Math.round(m.y), +m.facing.toFixed(2),
    Math.round(m.hp), m.anim.key, +m.anim.t.toFixed(2),
    (m.dead ? 1 : 0) | (m.enraged ? 2 : 0) | (m.buffs.some((b) => b.id === 'stun') ? 4 : 0),
  ]);

  const projectiles = world.projectiles.map((pr) => [
    pr.id, Math.round(pr.x), Math.round(pr.y), +pr.angle.toFixed(2),
    Math.round(pr.vx), Math.round(pr.vy), pr.sprite || 0, pr.glow || 0, pr.radius, pr.scale || 1,
  ]);

  const pickups = world.pickups.map((p) => [p.id, Math.round(p.x), Math.round(p.y), p.kind === 'bossLoot' ? 1 : 0, p.items[0]?.icon || 0]);

  const zones = world.zones.map((z) => [Math.round(z.x), Math.round(z.y), Math.round(z.radius), z.color, +(z.duration - z.elapsed).toFixed(1)]);

  // Ids the host has retired since the last snapshot.
  const gone = world.removedIds.length ? world.removedIds.slice() : undefined;
  world.removedIds.length = 0;

  return {
    t: world.time,
    players, mobs, projectiles, pickups, zones, gone,
    descent: [world.descent.playerId || 0, +world.descent.progress.toFixed(2), +world.descent.flash.toFixed(2)],
    shake: Math.round(world.shakeAmount),
  };
}

/** Apply a snapshot to a client-side world. */
export function applySnapshot(world, snap) {
  if (snap.descent) {
    world.descent.playerId = snap.descent[0] || null;
    world.descent.progress = snap.descent[1];
    world.descent.flash = snap.descent[2];
  }
  if (snap.shake > world.shakeAmount) world.shakeAmount = snap.shake;

  for (const row of snap.players) {
    const p = world.byId.get(row[0]);
    if (!p) continue;
    p.netX = row[1]; p.netY = row[2];
    if (p !== world.localPlayer) {
      p.facing = row[3];
      // Snap on first sight or a teleport; otherwise let interpolation ease it.
      if (dist2(p.x, p.y, row[1], row[2]) > 220 * 220) { p.x = row[1]; p.y = row[2]; }
    }
    p.hp = row[4];
    // Applies to the local player too: a client does not simulate its own
    // casting, so without this its mana bar regenerates to full and sits there
    // while the host has it spending mana on every basic attack.
    p.mp = row[5];
    p.anim.key = row[6];
    p.anim.t = row[7];
    p.level = row[8];
    p.downed = !!(row[9] & 1);
    p.dead = !!(row[9] & 2);
    p.shield = row[10];
    p.stats.maxHp = row[11];
    p.stats.maxMp = row[12];
  }

  if (snap.gone && snap.gone.length) {
    const dropped = new Set(snap.gone);
    for (const id of dropped) world.byId.delete(id);
    world.monsters = world.monsters.filter((m) => !dropped.has(m.id));
  }

  const seen = new Set();
  for (const row of snap.mobs) {
    seen.add(row[0]);
    let m = world.byId.get(row[0]);
    if (!m) continue;
    // Snap on a big jump (teleport, first sight), interpolate otherwise.
    const dx = row[1] - m.x, dy = row[2] - m.y;
    // Retarget in both cases. Snapping without moving the target left the body
    // easing back toward its previous position until the next snapshot.
    if (dx * dx + dy * dy > 200 * 200) { m.x = row[1]; m.y = row[2]; }
    m.tx = row[1]; m.ty = row[2];
    m.facing = row[3];
    m.hp = row[4];
    m.anim.key = row[5];
    m.anim.t = row[6];
    m.dead = !!(row[7] & 1);
    m.enraged = !!(row[7] & 2);
    m.stunned = !!(row[7] & 4);
    m.netSeen = true;
  }

  world.projectiles = snap.projectiles.map((row) => ({
    id: row[0], x: row[1], y: row[2], angle: row[3],
    vx: row[4], vy: row[5],
    sprite: row[6] || null, glow: row[7] || null,
    radius: row[8], scale: row[9], life: 0, dead: false, hits: new Set(),
  }));

  world.pickups = snap.pickups.map((row) => ({
    id: row[0], x: row[1], y: row[2],
    kind: row[3] ? 'bossLoot' : 'loot',
    items: row[4] ? [{ icon: row[4] }] : [],
    bob: (row[0] % 100) / 16, age: 0, dead: false,
  }));

  world.zones = snap.zones.map((row) => ({
    x: row[0], y: row[1], radius: row[2], color: row[3],
    duration: Math.max(0.1, row[4]), elapsed: 0,
  }));
}

// ---------------------------------------------------------------------------
// Floor manifest
// ---------------------------------------------------------------------------

/** The one-time list of what got spawned, so clients can build matching entities. */
export function buildFloorManifest(world) {
  return {
    floorNo: world.floorNo,
    monsters: world.monsters.map((m) => [
      m.id, m.monsterId, m.level, m.elite ? 1 : 0, m.boss || 0,
      Math.round(m.x), Math.round(m.y), Math.round(m.stats.maxHp), m.roomId ?? -1, m.name,
    ]),
    npcs: world.npcs.map((n) => [n.id, n.role, n.spriteId, n.tint, n.name, Math.round(n.x), Math.round(n.y)]),
    props: world.dungeon.props.map((p, i) => [i, p.opened ? 1 : 0, p.used ? 1 : 0, p.armed === false ? 0 : 1, p.spent ? 1 : 0]),
  };
}

export function applyFloorManifest(world, manifest) {
  // Drop the previous floor's entities from the id index; otherwise it grows by
  // a few hundred stale entries per floor for the length of a run.
  for (const m of world.monsters) world.byId.delete(m.id);
  world.monsters = [];
  for (const row of manifest.monsters) {
    const boss = row[4] ? bossForFloor(row[4]) : null;
    const m = createMonster({
      monsterId: row[1], level: row[2], elite: !!row[3], boss,
      x: row[5], y: row[6], rng: world.rng,
    });
    m.id = row[0];
    m.stats.maxHp = row[7];
    m.hp = row[7];
    m.roomId = row[8];
    m.name = row[9];
    world.monsters.push(m);
    world.byId.set(m.id, m);
  }
  // Merchants are generated locally from the seed - stock included - so a
  // client can browse the shop without the host shipping the inventory. Only
  // the entity ids come off the wire, so `buy` requests address the same NPC.
  world.spawnNpcs();
  manifest.npcs.forEach((row, i) => {
    const npc = world.npcs[i];
    if (!npc) return;
    world.byId.delete(npc.id);
    npc.id = row[0];
    npc.spriteId = row[2];
    npc.tint = row[3];
    npc.name = row[4];
    npc.x = row[5];
    npc.y = row[6];
    world.byId.set(npc.id, npc);
  });
  for (const prop of world.dungeon.props) {
    if (prop.type !== 'merchant') continue;
    const near = world.npcs.find((n) => Math.abs(n.x - (prop.x * 48 + 24)) < 40 && Math.abs(n.y - (prop.y * 48 + 24)) < 40);
    if (near) prop.npcId = near.id;
  }
  for (const row of manifest.props) {
    const prop = world.dungeon.props[row[0]];
    if (!prop) continue;
    prop.opened = !!row[1];
    prop.used = !!row[2];
    if (prop.type === 'trap') { prop.armed = !!row[3]; prop.spent = !!row[4]; }
  }
}

// ---------------------------------------------------------------------------
// Player serialisation (for the SELF message and the lobby)
// ---------------------------------------------------------------------------

export function serialisePlayerFull(p) {
  return {
    id: p.id, peerId: p.peerId, name: p.name, classId: p.classId, slot: p.slot,
    level: p.level, xp: p.xp, unspentPoints: p.unspentPoints, allocated: p.allocated,
    hp: p.hp, mp: p.mp, gold: p.gold, shield: p.shield,
    equipment: p.equipment, inventory: p.inventory,
    hotbar: p.hotbar, knownSpells: p.knownSpells,
    quickHeal: p.quickHeal, quickMana: p.quickMana,
    stats: p.stats, stat: p.stat, buffs: p.buffs,
    cooldowns: p.cooldowns, downed: p.downed, x: p.x, y: p.y,
  };
}

export function applyPlayerFull(p, data) {
  Object.assign(p, {
    level: data.level, xp: data.xp, unspentPoints: data.unspentPoints,
    allocated: data.allocated, gold: data.gold,
    equipment: data.equipment, inventory: data.inventory,
    hotbar: data.hotbar, knownSpells: data.knownSpells,
    quickHeal: data.quickHeal, quickMana: data.quickMana,
    stats: data.stats, stat: data.stat, buffs: data.buffs,
    cooldowns: data.cooldowns,
  });
}

// ---------------------------------------------------------------------------
// Personal state
// ---------------------------------------------------------------------------

/**
 * The volatile numbers that belong to one player and cannot ride the shared
 * snapshot.
 *
 * XP, gold and cooldowns used to travel only inside the full SELF message,
 * which the host sent on inventory actions and floor changes - so on a client
 * the XP bar never moved while killing things, gold never ticked up, and the
 * hotbar never showed a cooldown. This goes out to its owner several times a
 * second and is small enough to do so.
 */
export function buildPersonal(p) {
  const cds = {};
  for (const k in p.cooldowns) {
    const v = p.cooldowns[k];
    if (v > 0.05) cds[k] = +v.toFixed(2);
  }
  return {
    id: p.id,
    xp: p.xp,
    level: p.level,
    gold: p.gold,
    mp: Math.round(p.mp),
    unspentPoints: p.unspentPoints,
    cooldowns: cds,
    attackCd: +p.attackCd.toFixed(2),
    dashCd: +p.dashCd.toFixed(2),
    rev: selfSignature(p),
  };
}

export function applyPersonal(p, d) {
  p.xp = d.xp;
  p.level = d.level;
  p.gold = d.gold;
  p.mp = d.mp;
  p.unspentPoints = d.unspentPoints;
  p.cooldowns = d.cooldowns;
  p.attackCd = d.attackCd;
  p.dashCd = d.dashCd;
}

/**
 * Cheap fingerprint of the state that only the full SELF message carries.
 *
 * Hooking every mutation site would be easy to forget one of; comparing a
 * fingerprint each tick cannot miss a change, however it happened.
 */
export function selfSignature(p) {
  let sig = `${p.inventory.length}|${p.knownSpells.length}|${p.hotbar.join(',')}|${p.unspentPoints}|${p.allocated ? Object.values(p.allocated).join('.') : ''}`;
  for (const slot in p.equipment) sig += `|${p.equipment[slot]?.uid ?? 0}`;
  for (const it of p.inventory) sig += `|${it.uid ?? it.id}:${it.qty ?? 1}`;
  return sig;
}
