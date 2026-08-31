import { nextId, clamp } from '../core/util.js';
import { recomputeStats, emptyMods } from './stats.js';
import { getClass } from './classes.js';
import { MONSTERS, ELITE_MODS, ELITE_PREFIX } from './monsters.js';
import { scaleMonster } from './stats.js';

/**
 * Entity construction and the small amount of shared per-entity behaviour
 * (animation state, buff bookkeeping). Everything here is plain data so the
 * whole world can be serialised for saves and snapshots without ceremony.
 */

export const TEAM = { PARTY: 0, MONSTER: 1, NEUTRAL: 2 };

// Animation playback is cosmetic: the simulation drives timing with explicit
// timers, and `anim` only decides which frame the renderer shows.
export function setAnim(actor, key, { loop = true, fps = 12, lock = 0 } = {}) {
  if (actor.anim.key === key && loop && actor.anim.loop) return;
  actor.anim.key = key;
  actor.anim.t = 0;
  actor.anim.loop = loop;
  actor.anim.fps = fps;
  actor.animLock = lock;
}

export function advanceAnim(actor, dt) {
  actor.anim.t += dt;
  if (actor.animLock > 0) {
    actor.animLock -= dt;
    if (actor.animLock <= 0) actor.animLock = 0;
  }
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export function createPlayer({ peerId, name, classId, slot }) {
  const cls = getClass(classId);
  const p = {
    id: nextId(),
    kind: 'player',
    team: TEAM.PARTY,
    peerId,
    slot,
    name: name || cls.name,
    classId: cls.id,
    level: 1,
    xp: 0,
    unspentPoints: 0,
    allocated: { str: 0, dex: 0, int: 0, vit: 0 },

    x: 0, y: 0, vx: 0, vy: 0,
    radius: 13,
    mass: 1.2,
    facing: 0,
    aim: 0,

    hp: 1, mp: 1,
    shield: 0,
    stats: {},
    buffs: [],
    blessings: emptyMods(),

    equipment: { weapon: null, offhand: null, head: null, chest: null, gloves: null, boots: null, belt: null, amulet: null, ring1: null, ring2: null },
    inventory: [],
    gold: 0,
    hotbar: [cls.ability, null, null, null],
    knownSpells: [cls.ability],
    quickHeal: 'healthPotion',
    quickMana: 'manaPotion',

    cooldowns: {},
    attackCd: 0,
    windup: 0,
    pendingAttack: null,
    dashCd: 0,
    invuln: 0,

    dead: false,
    downed: false,
    reviveTimer: 0,
    spectating: null,

    anim: { key: 'idle', t: 0, loop: true, fps: 10 },
    animLock: 0,
    hitFlash: 0,
    swingIndex: 0,

    stat: {
      kills: 0, damageDealt: 0, damageTaken: 0, healingDone: 0,
      goldEarned: 0, itemsFound: 0, deaths: 0, trapsTriggered: 0, chestsOpened: 0,
      floorsCleared: 0,
    },
  };

  recomputeStats(p, cls);
  p.hp = p.stats.maxHp;
  p.mp = p.stats.maxMp;
  return p;
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

/**
 * @param {object} opts { monsterId, level, elite, boss (boss def), x, y, rng }
 */
export function createMonster({ monsterId, level, elite = false, boss = null, x, y, rng }) {
  const def = MONSTERS[monsterId] || MONSTERS.slime;
  const scaled = scaleMonster(def.base, level);

  let hpMult = 1, dmgMult = 1, xpMult = 1, scale = def.scale, radius = def.radius, armorAdd = 0, speedMult = 1;
  let name = def.name;

  if (elite && !boss) {
    hpMult *= ELITE_MODS.hpMult;
    dmgMult *= ELITE_MODS.damageMult;
    xpMult *= ELITE_MODS.xpMult;
    armorAdd += ELITE_MODS.armorAdd;
    scale *= ELITE_MODS.scale;
    radius *= ELITE_MODS.scale;
    name = `${rng ? rng.pick(ELITE_PREFIX) : 'Vicious'} ${def.name}`;
  }
  if (boss) {
    hpMult *= boss.hpMult;
    dmgMult *= boss.damageMult;
    xpMult *= boss.xpMult;
    scale = boss.scale;
    radius = boss.radius;
    speedMult = boss.speedMult || 1;
    name = boss.name;
  }

  const maxHp = Math.round(scaled.maxHp * hpMult);
  const m = {
    id: nextId(),
    kind: 'monster',
    team: TEAM.MONSTER,
    monsterId,
    def,
    name,
    level,
    elite,
    boss: boss ? boss.floor : 0,
    bossDef: boss || null,

    x, y, vx: 0, vy: 0,
    radius,
    mass: def.mass * (boss ? 3 : elite ? 1.4 : 1),
    scale,
    facing: 0,
    flying: !!def.flying,

    hp: maxHp,
    stats: {
      maxHp,
      damage: scaled.damage * dmgMult,
      armor: scaled.armor + armorAdd,
      resist: scaled.resist,
      speed: scaled.speed * speedMult,
      xp: Math.round(scaled.xp * xpMult),
    },
    buffs: [],
    shield: 0,

    ai: def.ai,
    aiState: 'idle',
    target: null,
    aggroRange: boss ? 900 : elite ? 460 : 380,
    leash: { x, y },
    wanderTimer: 0,
    wanderDir: 0,
    repathTimer: 0,
    pathHint: null,

    attackCd: rng ? rng.float(0, 0.6) : 0,
    windup: 0,
    pendingAttack: null,
    specialCd: {},
    enraged: false,

    dead: false,
    deathTimer: 0,
    looted: false,
    hitFlash: 0,

    anim: { key: 'idle', t: rng ? rng.float(0, 1) : 0, loop: true, fps: 9 },
    animLock: 0,
  };

  for (const sp of def.specials || []) m.specialCd[sp.id] = sp.cooldown * (rng ? rng.float(0.3, 1) : 0.5);
  for (const sp of boss?.specials || []) m.specialCd[sp.id] = sp.cooldown * 0.4;
  m.specials = [...(def.specials || []), ...(boss?.specials || [])];

  return m;
}

// ---------------------------------------------------------------------------
// Neutral NPCs
// ---------------------------------------------------------------------------

/** Merchants are recoloured hero sprites so they read as "people, not monsters". */
export const NPC_TINTS = [
  'hue-rotate(150deg) saturate(0.75)',
  'hue-rotate(-70deg) saturate(1.2)',
  'hue-rotate(80deg) saturate(0.6) brightness(1.1)',
  'hue-rotate(210deg) saturate(1.1)',
];

export function createNpc({ role, spriteId, tint, name, x, y, stock }) {
  return {
    id: nextId(),
    kind: 'npc',
    team: TEAM.NEUTRAL,
    role,
    spriteId,
    tint,
    name,
    x, y, vx: 0, vy: 0,
    radius: 14,
    mass: 4,
    facing: 0,
    hp: 1,
    stats: { maxHp: 1 },
    stock: stock || [],
    anim: { key: 'idle', t: 0, loop: true, fps: 8 },
    animLock: 0,
    buffs: [],
    dead: false,
    idleTimer: 0,
  };
}

// ---------------------------------------------------------------------------
// Projectiles, pickups, effects
// ---------------------------------------------------------------------------

export function createProjectile(opts) {
  return {
    id: nextId(),
    ownerId: opts.ownerId,
    team: opts.team,
    x: opts.x, y: opts.y,
    angle: opts.angle,
    speed: opts.speed,
    vx: Math.cos(opts.angle) * opts.speed,
    vy: Math.sin(opts.angle) * opts.speed,
    radius: opts.radius ?? 8,
    range: opts.range ?? 500,
    travelled: 0,
    damage: opts.damage,
    type: opts.type || 'phys',
    sprite: opts.sprite || null,
    glow: opts.glow || null,
    scale: opts.scale || 1,
    pierce: opts.pierce ?? 0,
    homing: opts.homing || 0,
    knockback: opts.knockback || 0,
    explode: opts.explode || null,
    effects: opts.effects || null,
    onHit: opts.onHit || null,
    hits: new Set(),
    dead: false,
    life: 0,
  };
}

export function createPickup({ x, y, items, kind = 'loot' }) {
  return {
    id: nextId(),
    kind,
    x, y,
    items,
    bob: Math.random() * Math.PI * 2,
    age: 0,
    dead: false,
  };
}

// ---------------------------------------------------------------------------
// Buffs
// ---------------------------------------------------------------------------

export function applyBuff(actor, buff) {
  const existing = actor.buffs.find((b) => b.id === buff.id);
  if (existing) {
    existing.duration = Math.max(existing.duration, buff.duration);
    existing.stacks = Math.min((existing.stacks || 1) + 1, buff.maxStacks || 1);
    return existing;
  }
  const b = { ...buff, stacks: 1, elapsed: 0 };
  actor.buffs.push(b);
  return b;
}

export function tickBuffs(actor, dt) {
  let changed = false;
  for (let i = actor.buffs.length - 1; i >= 0; i--) {
    const b = actor.buffs[i];
    b.duration -= dt;
    b.elapsed += dt;
    if (b.duration <= 0) {
      actor.buffs.splice(i, 1);
      changed = true;
    }
  }
  return changed;
}

export function hasBuff(actor, id) {
  return actor.buffs.some((b) => b.id === id);
}

/** Multiplier applied to incoming damage from defensive buffs. */
export function damageTakenMult(actor) {
  let m = 1;
  for (const b of actor.buffs) if (b.damageTaken) m *= b.damageTaken;
  return m;
}

/** Movement multiplier from chills, stuns and haste effects. */
export function movementMult(actor) {
  let m = 1;
  for (const b of actor.buffs) {
    if (b.slow) m *= 1 - b.slow;
    if (b.id === 'stun') m = 0;
  }
  return clamp(m, 0, 3);
}

export function isStunned(actor) {
  return actor.buffs.some((b) => b.id === 'stun');
}
