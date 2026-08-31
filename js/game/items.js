import { ICON, ICON_FAMILIES } from '../assets/manifest.js';
import { emptyMods } from './stats.js';
import { tomePool, getAbility } from './abilities.js';
import { clamp } from '../core/util.js';

/**
 * Items, affixes and loot rolling.
 *
 * The icon sheet is laid out as families of 16 columns that read left-to-right
 * as increasing power, in four material palettes. That maps perfectly onto
 * (tier, rarity), so an item's art is derived from its stats instead of being
 * authored - which means new tiers cost nothing.
 */

export const SLOTS = ['weapon', 'offhand', 'head', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring1', 'ring2'];

export const SLOT_LABEL = {
  weapon: 'Weapon', offhand: 'Off-hand', head: 'Head', chest: 'Chest',
  gloves: 'Hands', boots: 'Feet', belt: 'Waist', amulet: 'Neck',
  ring1: 'Ring', ring2: 'Ring',
};

export const RARITY = [
  { id: 'common', name: 'Common', color: '#b8b8b8', affixes: 0, mult: 1.00, weight: 100, iconRow: 2 },
  { id: 'uncommon', name: 'Uncommon', color: '#5fd06a', affixes: 1, mult: 1.14, weight: 46, iconRow: 0 },
  { id: 'rare', name: 'Rare', color: '#5aa8ff', affixes: 2, mult: 1.32, weight: 17, iconRow: 1 },
  { id: 'epic', name: 'Epic', color: '#c264ff', affixes: 3, mult: 1.55, weight: 5.5, iconRow: 3 },
  { id: 'legendary', name: 'Legendary', color: '#ff9a2e', affixes: 4, mult: 1.85, weight: 1.2, iconRow: 3 },
];

export const RARITY_BY_ID = Object.fromEntries(RARITY.map((r) => [r.id, r]));

/** Which icon family and slot each equipment type uses. */
export const FAMILY_INFO = {
  sword: { slot: 'weapon', kind: 'weapon', name: 'Sword', hands: 1, speed: 1.05, scale: 'str' },
  longsword: { slot: 'weapon', kind: 'weapon', name: 'Greatsword', hands: 2, speed: 0.9, scale: 'str' },
  axe: { slot: 'weapon', kind: 'weapon', name: 'Axe', hands: 1, speed: 0.95, scale: 'str' },
  spear: { slot: 'weapon', kind: 'weapon', name: 'Spear', hands: 2, speed: 1.0, scale: 'str' },
  bow: { slot: 'weapon', kind: 'weapon', name: 'Bow', hands: 2, speed: 1.05, scale: 'dex' },
  wand: { slot: 'weapon', kind: 'weapon', name: 'Wand', hands: 1, speed: 1.0, scale: 'int' },
  shield: { slot: 'offhand', kind: 'armor', name: 'Shield', armorMult: 1.25 },
  helm: { slot: 'head', kind: 'armor', name: 'Helm', armorMult: 0.8 },
  helmHeavy: { slot: 'head', kind: 'armor', name: 'Great Helm', armorMult: 1.0 },
  body: { slot: 'chest', kind: 'armor', name: 'Armour', armorMult: 1.4 },
  bodyHeavy: { slot: 'chest', kind: 'armor', name: 'Plate', armorMult: 1.7 },
  gloves: { slot: 'gloves', kind: 'armor', name: 'Gauntlets', armorMult: 0.55 },
  boots: { slot: 'boots', kind: 'armor', name: 'Boots', armorMult: 0.6 },
  belt: { slot: 'belt', kind: 'armor', name: 'Girdle', armorMult: 0.5 },
  amulet: { slot: 'amulet', kind: 'trinket', name: 'Amulet', armorMult: 0.2 },
  ring: { slot: 'ring1', kind: 'trinket', name: 'Ring', armorMult: 0.15 },
};

const WEAPON_FAMILIES = ['sword', 'longsword', 'axe', 'spear', 'bow', 'wand'];
const ARMOR_FAMILIES = ['shield', 'helm', 'helmHeavy', 'body', 'bodyHeavy', 'gloves', 'boots', 'belt'];
const TRINKET_FAMILIES = ['amulet', 'ring'];

/** Base-name flavour by tier band, so a level-30 sword is not still "Iron". */
const MATERIALS = [
  'Rusted', 'Iron', 'Steel', 'Tempered', 'Silvered', 'Runed', 'Meteoric',
  'Obsidian', 'Ardent', 'Dragonbone', 'Void-forged', 'Godsteel',
];

// ---------------------------------------------------------------------------
// Affixes
// ---------------------------------------------------------------------------

/** `scale` is per tier; the roll is `base + scale * tier`, jittered. */
const AFFIXES = [
  { id: 'str', prefix: 'Brutal', suffix: 'of the Bear', mod: 'str', base: 1, scale: 0.55 },
  { id: 'dex', prefix: 'Swift', suffix: 'of the Hawk', mod: 'dex', base: 1, scale: 0.55 },
  { id: 'int', prefix: 'Arcane', suffix: 'of the Owl', mod: 'int', base: 1, scale: 0.55 },
  { id: 'vit', prefix: 'Stalwart', suffix: 'of the Ox', mod: 'vit', base: 1, scale: 0.55 },
  { id: 'maxHp', prefix: 'Hale', suffix: 'of Vigour', mod: 'maxHp', base: 8, scale: 4.2 },
  { id: 'maxMp', prefix: 'Deep', suffix: 'of the Wellspring', mod: 'maxMp', base: 6, scale: 3.0 },
  { id: 'armor', prefix: 'Plated', suffix: 'of Warding', mod: 'armor', base: 4, scale: 2.4 },
  { id: 'resist', prefix: 'Sealed', suffix: 'of Spellbreaking', mod: 'resist', base: 3, scale: 2.0 },
  { id: 'damage', prefix: 'Honed', suffix: 'of Ruin', mod: 'damage', base: 2, scale: 1.15 },
  { id: 'damagePct', prefix: 'Savage', suffix: 'of Slaughter', mod: 'damagePct', base: 0.04, scale: 0.012, pct: true },
  { id: 'critChance', prefix: 'Keen', suffix: 'of Precision', mod: 'critChance', base: 0.02, scale: 0.006, pct: true },
  { id: 'critMult', prefix: 'Cruel', suffix: 'of Butchery', mod: 'critMult', base: 0.08, scale: 0.025, pct: true },
  { id: 'moveSpeed', prefix: 'Fleet', suffix: 'of the Wind', mod: 'moveSpeed', base: 0.03, scale: 0.008, pct: true },
  { id: 'attackSpeed', prefix: 'Quick', suffix: 'of Alacrity', mod: 'attackSpeed', base: 0.03, scale: 0.009, pct: true },
  { id: 'cooldown', prefix: 'Attuned', suffix: 'of Focus', mod: 'cooldown', base: 0.02, scale: 0.007, pct: true },
  { id: 'hpRegen', prefix: 'Mending', suffix: 'of Renewal', mod: 'hpRegen', base: 0.3, scale: 0.16 },
  { id: 'mpRegen', prefix: 'Flowing', suffix: 'of Clarity', mod: 'mpRegen', base: 0.3, scale: 0.14 },
  { id: 'lifeSteal', prefix: 'Vampiric', suffix: 'of Leeching', mod: 'lifeSteal', base: 0.015, scale: 0.004, pct: true },
  { id: 'magicFind', prefix: 'Lucky', suffix: 'of Fortune', mod: 'magicFind', base: 0.04, scale: 0.012, pct: true },
  { id: 'xpBonus', prefix: 'Sage', suffix: 'of Insight', mod: 'xpBonus', base: 0.03, scale: 0.008, pct: true },
];

const AFFIX_BY_ID = Object.fromEntries(AFFIXES.map((a) => [a.id, a]));

/** Affixes that make no sense on a given family. */
function affixAllowed(affix, family) {
  const info = FAMILY_INFO[family];
  if (!info) return true;
  if (info.kind !== 'weapon' && (affix.id === 'damage' || affix.id === 'critMult')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------

export function tierForFloor(rng, floorNo) {
  // Floor 1 drops tier 0-2; floor 10 drops tier 12-15.
  const centre = (floorNo - 1) * 1.45;
  const t = centre + rng.gauss(0.6, 1.6);
  return clamp(Math.round(t), 0, 15);
}

export function rollRarity(rng, magicFind = 0, luck = 0) {
  const entries = RARITY.map((r, i) => ({
    r,
    // Magic find lifts the tail without ever making commons impossible.
    weight: r.weight * (i === 0 ? 1 : 1 + magicFind * (0.6 + i * 0.35) + luck),
  }));
  return rng.weighted(entries, (e) => e.weight).r;
}

let itemUid = 1;
export function resetItemUid(n) { itemUid = n || 1; }
export function peekItemUid() { return itemUid; }

/**
 * Roll a piece of equipment.
 * @param {RNG} rng
 * @param {{floor:number, family?:string, slot?:string, rarity?:string, tier?:number, magicFind?:number, classId?:string}} opts
 */
export function rollEquipment(rng, opts = {}) {
  const floorNo = opts.floor ?? 1;
  let family = opts.family;
  if (!family) {
    if (opts.slot) {
      const pool = Object.entries(FAMILY_INFO)
        .filter(([, i]) => i.slot === opts.slot || (opts.slot === 'ring2' && i.slot === 'ring1'))
        .map(([f]) => f);
      family = pool.length ? rng.pick(pool) : 'sword';
    } else {
      const roll = rng.next();
      family = roll < 0.32 ? rng.pick(WEAPON_FAMILIES)
        : roll < 0.78 ? rng.pick(ARMOR_FAMILIES)
          : rng.pick(TRINKET_FAMILIES);
    }
  }

  const info = FAMILY_INFO[family];
  const tier = opts.tier ?? tierForFloor(rng, floorNo);
  const rarity = opts.rarity ? RARITY_BY_ID[opts.rarity] : rollRarity(rng, opts.magicFind || 0);

  const mods = emptyMods();
  const item = {
    uid: itemUid++,
    type: 'equipment',
    family,
    slot: info.slot,
    tier,
    rarity: rarity.id,
    mods,
    affixes: [],
  };

  if (info.kind === 'weapon') {
    item.damage = Math.round((5 + tier * 3.1) * rarity.mult * (1 + rng.float(-0.06, 0.06)) * 10) / 10;
    item.speed = info.speed;
    item.scale = info.scale;
  }
  const armorBase = (info.armorMult || 0) * (3 + tier * 3.4) * rarity.mult;
  if (armorBase > 0) {
    item.armorValue = Math.round(armorBase);
    mods.armor += item.armorValue;
  }

  // Affixes.
  const pool = AFFIXES.filter((a) => affixAllowed(a, family));
  rng.shuffle(pool);
  const count = rarity.affixes;
  for (let i = 0; i < count && i < pool.length; i++) {
    const a = pool[i];
    const raw = (a.base + a.scale * tier) * rng.float(0.8, 1.15);
    const value = a.pct ? Math.round(raw * 1000) / 1000 : Math.round(raw * 10) / 10;
    if (value <= 0) continue;
    mods[a.mod] += value;
    item.affixes.push({ id: a.id, value });
  }

  item.name = buildName(item, info);
  item.icon = iconFor(item);
  item.value = itemValue(item);
  item.levelReq = Math.max(1, Math.round(tier * 2.1));
  return item;
}

function buildName(item, info) {
  const material = MATERIALS[clamp(Math.floor(item.tier * (MATERIALS.length - 1) / 15), 0, MATERIALS.length - 1)];
  let name = `${material} ${info.name}`;
  const pre = item.affixes[0] && AFFIX_BY_ID[item.affixes[0].id];
  const suf = item.affixes[1] && AFFIX_BY_ID[item.affixes[1].id];
  if (pre) name = `${pre.prefix} ${name}`;
  if (suf) name = `${name} ${suf.suffix}`;
  return name;
}

/** Column = tier, row = rarity palette. Both clamp to the family's real extent. */
export function iconFor(item) {
  const fam = ICON_FAMILIES[item.family];
  if (!fam) return ICON.coin;
  const cols = fam.cols || 16;
  const col = fam.col0 + clamp(Math.round((item.tier / 15) * (cols - 1)), 0, cols - 1);
  const row = fam.rows[clamp(RARITY_BY_ID[item.rarity].iconRow, 0, fam.rows.length - 1)];
  return [col, row];
}

export function itemValue(item) {
  if (item.type === 'consumable') return CONSUMABLES[item.id]?.value ?? 10;
  if (item.type === 'tome') return 220 + (getAbility(item.abilityId)?.mana || 0) * 6;
  const r = RARITY_BY_ID[item.rarity] || RARITY[0];
  const base = 18 + item.tier * 26;
  return Math.round(base * r.mult * (1 + item.affixes.length * 0.28));
}

// ---------------------------------------------------------------------------
// Consumables
// ---------------------------------------------------------------------------

export const CONSUMABLES = {
  healthPotion: {
    id: 'healthPotion', name: 'Health Potion', icon: ICON.potionHp, stack: 20, value: 45,
    desc: 'Restores 35% of maximum health.',
    use: (world, actor) => world.healActor(actor, actor.stats.maxHp * 0.35, 'potion'),
  },
  greaterHealthPotion: {
    id: 'greaterHealthPotion', name: 'Greater Health Potion', icon: ICON.potionHpBig, stack: 20, value: 130, minFloor: 4,
    desc: 'Restores 70% of maximum health.',
    use: (world, actor) => world.healActor(actor, actor.stats.maxHp * 0.7, 'potion'),
  },
  manaPotion: {
    id: 'manaPotion', name: 'Mana Potion', icon: ICON.potionMp, stack: 20, value: 45,
    desc: 'Restores 40% of maximum mana.',
    use: (world, actor) => world.restoreMana(actor, actor.stats.maxMp * 0.4),
  },
  greaterManaPotion: {
    id: 'greaterManaPotion', name: 'Greater Mana Potion', icon: ICON.potionMpBig, stack: 20, value: 130, minFloor: 4,
    desc: 'Restores 80% of maximum mana.',
    use: (world, actor) => world.restoreMana(actor, actor.stats.maxMp * 0.8),
  },
  revivePotion: {
    id: 'revivePotion', name: 'Draught of Return', icon: ICON.potionRevive, stack: 5, value: 900, minFloor: 5, rare: true,
    desc: 'Raises one fallen ally nearby at half health. Does not work on yourself.',
    use: (world, actor) => world.reviveNearest(actor, 300, 0.5),
  },
  antidote: {
    id: 'antidote', name: 'Antidote', icon: ICON.potionAntidote, stack: 10, value: 60, minFloor: 3,
    desc: 'Clears poison, burning and chill.',
    use: (world, actor) => world.cleanse(actor, ['poison', 'burn', 'chill']),
  },
  strengthElixir: {
    id: 'strengthElixir', name: 'Elixir of Might', icon: ICON.potionStrength, stack: 10, value: 180, minFloor: 3,
    desc: '+25% damage for 45 seconds.',
    use: (world, actor) => world.applyBuff(actor, {
      id: 'might', name: 'Might', duration: 45, icon: ICON.potionStrength, mods: { damagePct: 0.25 },
    }),
  },
  speedElixir: {
    id: 'speedElixir', name: 'Elixir of Haste', icon: ICON.potionSpeed, stack: 10, value: 180, minFloor: 3,
    desc: '+20% move and attack speed for 45 seconds.',
    use: (world, actor) => world.applyBuff(actor, {
      id: 'haste', name: 'Haste', duration: 45, icon: ICON.potionSpeed, mods: { moveSpeed: 0.2, attackSpeed: 0.2 },
    }),
  },
};

export function makeConsumable(id, qty = 1) {
  const def = CONSUMABLES[id];
  if (!def) return null;
  return {
    uid: itemUid++, type: 'consumable', id, name: def.name,
    icon: def.icon, qty, value: def.value, desc: def.desc, stack: def.stack,
  };
}

export function makeTome(abilityId) {
  const ab = getAbility(abilityId);
  if (!ab) return null;
  return {
    uid: itemUid++, type: 'tome', abilityId,
    name: `Tome: ${ab.name}`, icon: ab.icon, school: ab.school,
    desc: ab.desc, value: 220 + ab.mana * 6, rarity: ab.rare ? 'legendary' : 'rare',
  };
}

export function makeGold(amount) {
  return { uid: itemUid++, type: 'gold', name: 'Gold', icon: ICON.coin, qty: amount, value: amount };
}

// ---------------------------------------------------------------------------
// Loot tables
// ---------------------------------------------------------------------------

/**
 * Roll the contents of a monster drop, chest or breakable.
 * @param {RNG} rng
 * @param {{floor:number, source:'monster'|'chest'|'boss'|'elite'|'prop', magicFind?:number, tier?:string}} opts
 * @returns {Array} items
 */
export function rollLoot(rng, opts) {
  const { floor: floorNo, source } = opts;
  const mf = opts.magicFind || 0;
  const out = [];

  const profile = {
    monster: { goldChance: 0.55, gold: [3, 12], equipChance: 0.13, consChance: 0.16, tomeChance: 0.008, count: 1 },
    elite: { goldChance: 0.9, gold: [12, 34], equipChance: 0.42, consChance: 0.34, tomeChance: 0.03, count: 1 },
    prop: { goldChance: 0.5, gold: [2, 9], equipChance: 0.07, consChance: 0.22, tomeChance: 0.004, count: 1 },
    chest: { goldChance: 1, gold: [22, 60], equipChance: 0.95, consChance: 0.7, tomeChance: 0.10, count: 2 },
    rareChest: { goldChance: 1, gold: [60, 150], equipChance: 1, consChance: 0.9, tomeChance: 0.22, count: 3 },
    boss: { goldChance: 1, gold: [140, 320], equipChance: 1, consChance: 1, tomeChance: 0.55, count: 4 },
  }[source] || { goldChance: 0.4, gold: [1, 6], equipChance: 0.06, consChance: 0.1, tomeChance: 0, count: 1 };

  if (rng.bool(profile.goldChance)) {
    const g = Math.round(rng.int(profile.gold[0], profile.gold[1]) * (1 + floorNo * 0.55));
    out.push(makeGold(g));
  }

  for (let i = 0; i < profile.count; i++) {
    if (rng.bool(profile.equipChance)) {
      out.push(rollEquipment(rng, { floor: floorNo, magicFind: mf }));
    }
    if (rng.bool(profile.consChance)) {
      const pool = Object.values(CONSUMABLES).filter((c) => (c.minFloor || 1) <= floorNo && (!c.rare || floorNo >= 5));
      // Revive draughts stay genuinely scarce even once they are unlocked.
      const weights = pool.map((c) => ({ c, w: c.rare ? 0.6 : c.minFloor ? 3 : 10 }));
      const picked = rng.weighted(weights, (e) => e.w).c;
      out.push(makeConsumable(picked.id, picked.rare ? 1 : rng.int(1, 2)));
    }
  }

  if (rng.bool(profile.tomeChance)) {
    const pool = tomePool(floorNo);
    if (pool.length) out.push(makeTome(rng.pick(pool).id));
  }

  return out;
}

/** Build the merchant's stock for a floor. */
export function rollShopStock(rng, floorNo) {
  const stock = [];
  stock.push({ item: makeConsumable('healthPotion', 1), qty: 99 });
  stock.push({ item: makeConsumable('manaPotion', 1), qty: 99 });
  if (floorNo >= 4) {
    stock.push({ item: makeConsumable('greaterHealthPotion', 1), qty: 99 });
    stock.push({ item: makeConsumable('greaterManaPotion', 1), qty: 99 });
  }
  if (floorNo >= 3) {
    stock.push({ item: makeConsumable('antidote', 1), qty: 6 });
    if (rng.bool(0.6)) stock.push({ item: makeConsumable('strengthElixir', 1), qty: 3 });
    if (rng.bool(0.6)) stock.push({ item: makeConsumable('speedElixir', 1), qty: 3 });
  }
  if (floorNo >= 6 && rng.bool(0.35)) {
    stock.push({ item: makeConsumable('revivePotion', 1), qty: 1 });
  }

  const equipCount = 4 + Math.floor(floorNo / 3);
  for (let i = 0; i < equipCount; i++) {
    stock.push({ item: rollEquipment(rng, { floor: floorNo + 1, magicFind: 0.5 }), qty: 1 });
  }
  const pool = tomePool(floorNo);
  if (pool.length && rng.bool(0.7)) {
    stock.push({ item: makeTome(rng.pick(pool).id), qty: 1 });
  }
  return stock;
}

/** Merchants pay a fraction of list price. */
export const SELL_RATE = 0.32;

export function describeAffix(affix) {
  const def = AFFIX_BY_ID[affix.id];
  if (!def) return '';
  const v = affix.value;
  const shown = def.pct ? `+${(v * 100).toFixed(1)}%` : `+${v % 1 === 0 ? v : v.toFixed(1)}`;
  return `${shown} ${AFFIX_LABEL[def.mod] || def.mod}`;
}

export const AFFIX_LABEL = {
  str: 'Strength', dex: 'Dexterity', int: 'Intellect', vit: 'Vitality',
  maxHp: 'Max Health', maxMp: 'Max Mana', armor: 'Armour', resist: 'Resistance',
  damage: 'Damage', damagePct: 'Damage', critChance: 'Crit Chance', critMult: 'Crit Damage',
  moveSpeed: 'Move Speed', attackSpeed: 'Attack Speed', cooldown: 'Cooldown Reduction',
  hpRegen: 'Health Regen', mpRegen: 'Mana Regen', lifeSteal: 'Life Steal',
  magicFind: 'Magic Find', xpBonus: 'Experience',
};
