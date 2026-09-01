import { clamp } from '../core/util.js';

/**
 * Character stat model.
 *
 * Four D&D-flavoured primaries feed a table of derived combat numbers. Every
 * source of power - level ups, equipment, buffs, shrine blessings - funnels
 * through `recomputeStats`, so there is exactly one place that decides what a
 * character's numbers actually are.
 */

export const PRIMARIES = ['str', 'dex', 'int', 'vit'];

export const PRIMARY_LABEL = {
  str: 'Strength',
  dex: 'Dexterity',
  int: 'Intellect',
  vit: 'Vitality',
};

/** Icon-sheet cell per attribute, so the character sheet reads at a glance. */
export const PRIMARY_ICON = {
  str: [22, 19],   // orange orb
  dex: [30, 18],   // green orb
  int: [18, 18],   // blue orb
  vit: [22, 18],   // red orb
};

export const PRIMARY_BLURB = {
  str: 'Melee damage and carrying weight.',
  dex: 'Ranged damage, crit chance and attack speed.',
  int: 'Spell damage and maximum mana.',
  vit: 'Maximum health and armour.',
};

/** Additive modifier buckets that equipment and buffs write into. */
export function emptyMods() {
  return {
    str: 0, dex: 0, int: 0, vit: 0,
    maxHp: 0, maxMp: 0, armor: 0, resist: 0,
    damage: 0,          // flat weapon damage
    damagePct: 0,       // multiplicative, 0.15 = +15%
    critChance: 0, critMult: 0,
    moveSpeed: 0,       // fraction, 0.1 = +10%
    attackSpeed: 0,
    cooldown: 0,        // fraction reduction, capped
    hpRegen: 0, mpRegen: 0,
    lifeSteal: 0,
    magicFind: 0,
    xpBonus: 0,
  };
}

export function addMods(target, src, scale = 1) {
  for (const k in src) {
    if (typeof src[k] === 'number' && k in target) target[k] += src[k] * scale;
  }
  return target;
}

/**
 * XP needed to go from `level` to `level + 1`.
 *
 * Tuned against the actual monster budget per floor: a party clearing ~88% of
 * each floor arrives at roughly level 3, 4, 6, 9, 11, 16, 20, 24, 28, 32 on
 * floors 1-10, so there is a level-up every few rooms without ever capping out.
 */
export function xpToNext(level) {
  return Math.floor(58 * Math.pow(level, 1.70) + 40 * level);
}

export function totalXpForLevel(level) {
  let sum = 0;
  for (let i = 1; i < level; i++) sum += xpToNext(i);
  return sum;
}

export const MAX_LEVEL = 40;

/**
 * Fold class growth, level, equipment and active buffs into `actor.stats`.
 * Called whenever anything about the actor changes; cheap enough to run freely.
 */
export function recomputeStats(actor, classDef) {
  const lvl = actor.level;
  const g = classDef.growth;

  const mods = emptyMods();
  for (const item of Object.values(actor.equipment || {})) {
    if (item && item.mods) addMods(mods, item.mods);
  }
  for (const buff of actor.buffs || []) {
    if (buff.mods) addMods(mods, buff.mods);
  }
  if (actor.blessings) addMods(mods, actor.blessings);

  const str = classDef.base.str + g.str * (lvl - 1) + mods.str + (actor.allocated?.str || 0);
  const dex = classDef.base.dex + g.dex * (lvl - 1) + mods.dex + (actor.allocated?.dex || 0);
  const int = classDef.base.int + g.int * (lvl - 1) + mods.int + (actor.allocated?.int || 0);
  const vit = classDef.base.vit + g.vit * (lvl - 1) + mods.vit + (actor.allocated?.vit || 0);

  const weaponDmg = actor.equipment?.weapon?.damage || classDef.unarmedDamage || 4;

  const s = actor.stats || (actor.stats = {});
  s.str = Math.round(str);
  s.dex = Math.round(dex);
  s.int = Math.round(int);
  s.vit = Math.round(vit);

  s.maxHp = Math.round(classDef.base.hp + vit * 6.5 + (lvl - 1) * classDef.growth.hp + mods.maxHp);
  s.maxMp = Math.round(classDef.base.mp + int * 4.5 + (lvl - 1) * classDef.growth.mp + mods.maxMp);
  s.armor = Math.round(vit * 0.7 + mods.armor);
  s.resist = Math.round(int * 0.45 + mods.resist);

  // Weapon damage is the spine of the number; primaries scale it rather than
  // replace it, which keeps upgrades feeling meaningful at every level.
  // These coefficients are deliberately modest - combat should be a fight, not
  // a one-click delete, so a grunt survives a few swings on every floor.
  const dmgBase = weaponDmg + mods.damage;
  s.attackPower = (dmgBase + str * 0.85) * (1 + mods.damagePct);
  s.rangedPower = (dmgBase + dex * 0.85) * (1 + mods.damagePct);
  s.spellPower = (dmgBase * 0.5 + int * 1.15) * (1 + mods.damagePct);

  s.critChance = clamp(0.04 + dex * 0.0035 + mods.critChance, 0, 0.75);
  s.critMult = 1.65 + mods.critMult;
  s.moveSpeed = classDef.base.speed * (1 + clamp(mods.moveSpeed, -0.6, 1.2));
  s.attackSpeed = clamp(1 + dex * 0.005 + mods.attackSpeed, 0.5, 2.6);
  s.cooldownMult = clamp(1 - mods.cooldown, 0.4, 1);
  s.hpRegen = 0.35 + vit * 0.035 + mods.hpRegen;
  // A class may carry its own regen multiplier. The archer has one: its
  // basic attack costs mana but its intellect is low, so it recovers far
  // more slowly than the casters it pays the same kind of cost as.
  s.mpRegen = (0.9 + int * 0.06) * (classDef.mpRegenMult || 1) + mods.mpRegen;
  s.lifeSteal = clamp(mods.lifeSteal, 0, 0.5);
  s.magicFind = mods.magicFind;
  s.xpBonus = mods.xpBonus;

  actor.hp = Math.min(actor.hp ?? s.maxHp, s.maxHp);
  actor.mp = Math.min(actor.mp ?? s.maxMp, s.maxMp);
  return s;
}

/** Armour is diminishing rather than subtractive so big hits always land. */
export function mitigate(amount, armor) {
  return amount * (110 / (110 + Math.max(0, armor)));
}

/**
 * Roll a single damage instance.
 * @returns {{amount:number, crit:boolean}}
 */
export function rollDamage(power, coefficient, critChance, critMult, rand, variance = 0.16) {
  const spread = 1 + (rand() * 2 - 1) * variance;
  let amount = power * coefficient * spread;
  const crit = rand() < critChance;
  if (crit) amount *= critMult;
  return { amount: Math.max(1, amount), crit };
}

/**
 * Monster power curve.
 *
 * Health is only mildly super-linear. Player damage grows with weapon tier AND
 * primary stat AND affixes, so it compounds; matching that with a steep health
 * curve turns late floors into damage sponges, while a flat one makes them
 * trivial. These constants are tuned so a single grunt takes roughly 1.5-2.5
 * seconds of focused attention on every floor - what changes with depth is how
 * hard it hits and how many friends it brought.
 */
export function scaleMonster(base, level) {
  const t = level - 1;
  return {
    maxHp: Math.round(base.hp * (1 + t * 0.20 + t * t * 0.0035)),
    damage: base.damage * (1 + t * 0.24),
    armor: Math.round(base.armor + t * 1.2),
    resist: Math.round((base.resist || 0) + t * 1.0),
    xp: Math.round(base.xp * (1 + t * 0.26)),
    speed: base.speed,
  };
}
