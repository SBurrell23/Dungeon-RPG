/**
 * The seven playable classes.
 *
 * `base` is the level-1 stat line, `growth` is what a level adds. Every class
 * gets one basic attack (bound to the mouse) and one signature ability in the
 * first hotbar slot; the other three slots are filled by spell tomes found or
 * bought in the dungeon.
 */

export const CLASS_ORDER = ['knight', 'templar', 'swordsman', 'archer', 'wizard', 'priest'];

export const CLASSES = {
  knight: {
    id: 'knight',
    name: 'Warrior',
    tagline: 'Immovable. Holds the line while the party works.',
    role: 'Tank',
    color: '#c9d3e0',
    // Portrait/world art keys resolve through assets.sheet('hero', id, anim).
    base: { hp: 128, mp: 30, str: 9, dex: 4, int: 3, vit: 11, speed: 106 },
    growth: { hp: 15, mp: 2.0, str: 1.5, dex: 0.5, int: 0.25, vit: 1.7 },
    unarmedDamage: 6,
    weaponFamily: 'longsword',
    basicAttack: 'stab',
    ability: 'shieldWall',
    startingGear: { weapon: { family: 'longsword', tier: 1 }, chest: { family: 'body', tier: 1 }, offhand: { family: 'shield', tier: 1 } },
    startingPotions: { healthPotion: 3 },
    blurb: 'Heavy armour, a wall of a health pool, and a shield that turns a killing blow into a scratch.',
  },

  templar: {
    id: 'templar',
    name: 'Knight Templar',
    tagline: 'Consecrated spear. Reach, and the discipline to use it.',
    role: 'Bruiser / Skirmish',
    color: '#e8d9a8',
    base: { hp: 112, mp: 60, str: 8, dex: 4, int: 6, vit: 9, speed: 110 },
    growth: { hp: 12.5, mp: 4.5, str: 1.3, dex: 0.5, int: 0.9, vit: 1.35 },
    unarmedDamage: 6,
    weaponFamily: 'spear',
    basicAttack: 'thrust',
    ability: 'javelin',
    startingGear: { weapon: { family: 'spear', tier: 1 }, chest: { family: 'body', tier: 1 }, offhand: { family: 'shield', tier: 0 } },
    startingPotions: { healthPotion: 2, manaPotion: 1 },
    blurb: 'Strikes from just outside the enemy swing, then throws a javelin straight through the rank behind.',
  },

  swordsman: {
    id: 'swordsman',
    name: 'Swordsman',
    tagline: 'Fast, greedy, always in the middle of it.',
    role: 'Melee DPS',
    color: '#dfa8a0',
    base: { hp: 96, mp: 36, str: 8, dex: 8, int: 3, vit: 6, speed: 124 },
    growth: { hp: 10.5, mp: 2.4, str: 1.5, dex: 1.3, int: 0.25, vit: 0.95 },
    unarmedDamage: 5,
    weaponFamily: 'sword',
    basicAttack: 'slash',
    ability: 'whirlwind',
    startingGear: { weapon: { family: 'sword', tier: 2 }, chest: { family: 'body', tier: 0 }, boots: { family: 'boots', tier: 1 } },
    startingPotions: { healthPotion: 3 },
    blurb: 'The quickest blade in the party. Whirlwind clears a pack; nothing stops it clearing your health bar too.',
  },


  archer: {
    id: 'archer',
    name: 'Archer',
    tagline: 'Kill it before it arrives.',
    role: 'Ranged DPS',
    color: '#a8d3b0',
    base: { hp: 82, mp: 44, str: 4, dex: 12, int: 4, vit: 5, speed: 121 },
    growth: { hp: 8.5, mp: 3.2, str: 0.4, dex: 2.0, int: 0.5, vit: 0.85 },
    unarmedDamage: 4,
    weaponFamily: 'bow',
    basicAttack: 'shoot',
    ability: 'multishot',
    startingGear: { weapon: { family: 'bow', tier: 2 }, chest: { family: 'body', tier: 0 }, boots: { family: 'boots', tier: 1 } },
    startingPotions: { healthPotion: 2 },
    blurb: 'Highest single-target damage at range, and the crit chance to make it stick. Fragile up close.',
  },

  wizard: {
    id: 'wizard',
    name: 'Wizard',
    tagline: 'Deletes crowds. Dies to a stiff breeze.',
    role: 'Ranged AoE',
    color: '#9fb4e8',
    base: { hp: 70, mp: 96, str: 3, dex: 5, int: 13, vit: 4, speed: 113 },
    growth: { hp: 7.0, mp: 8.0, str: 0.25, dex: 0.6, int: 2.2, vit: 0.7 },
    unarmedDamage: 4,
    weaponFamily: 'wand',
    basicAttack: 'arcaneBolt',
    ability: 'fireball',
    startingGear: { weapon: { family: 'wand', tier: 2 }, chest: { family: 'body', tier: 0 }, amulet: { family: 'amulet', tier: 1 } },
    startingPotions: { healthPotion: 2, manaPotion: 3 },
    blurb: 'The largest mana pool in the game and the spells to spend it on. Stay behind the knight.',
  },

  priest: {
    id: 'priest',
    name: 'Priest',
    tagline: 'The reason the party is still standing.',
    role: 'Healer',
    color: '#e0d0e8',
    base: { hp: 88, mp: 88, str: 4, dex: 4, int: 11, vit: 6, speed: 115 },
    growth: { hp: 9.0, mp: 7.0, str: 0.35, dex: 0.5, int: 1.9, vit: 1.0 },
    unarmedDamage: 4,
    weaponFamily: 'wand',
    basicAttack: 'holyBolt',
    ability: 'heal',
    startingGear: { weapon: { family: 'wand', tier: 1 }, chest: { family: 'body', tier: 1 }, amulet: { family: 'amulet', tier: 1 } },
    startingPotions: { healthPotion: 2, manaPotion: 2 },
    blurb: 'Party-wide healing, and the only class that starts able to learn Resurrection.',
  },
};

/** Class ids that can learn a given tome, or null for "anyone". */
export const SCHOOL_AFFINITY = {
  arcane: ['wizard', 'archer', 'swordsman'],
  holy: ['priest', 'templar', 'knight'],
  nature: null,
  war: ['knight', 'templar', 'swordsman'],
};

export function getClass(id) {
  return CLASSES[id] || CLASSES.knight;
}
