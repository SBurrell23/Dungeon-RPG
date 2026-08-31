import { clamp } from '../core/util.js';

/**
 * Monster bestiary.
 *
 * `sheet` is a key into MONSTER_SHEETS, so several entries can reuse the same
 * art at different levels, sizes and behaviours - which is exactly how the
 * bestiary is meant to grow. Adding a new enemy is one entry here plus (if it
 * is genuinely new art) one entry in the manifest.
 *
 * AI archetypes are implemented in game/ai.js; `ai` just names one.
 */

export const MONSTERS = {
  slime: {
    id: 'slime', sheet: 'slime', name: 'Cave Slime',
    base: { hp: 26, damage: 9, armor: 0, resist: 4, xp: 9, speed: 52 },
    radius: 15, scale: 1.0, ai: 'chaser', mass: 0.8,
    attack: { range: 40, arc: 2.2, cooldown: 1.5, windup: 0.35, coef: 1, type: 'phys' },
    floors: [1, 4], weight: 12,
    flavour: 'Slow, stupid, and everywhere. Bursts on death.',
    onDeath: 'splitSmall',
  },
  bat: {
    id: 'bat', sheet: 'bat', name: 'Cave Bat',
    base: { hp: 18, damage: 7, armor: 0, resist: 0, xp: 8, speed: 138 },
    radius: 11, scale: 0.9, ai: 'erratic', mass: 0.4, flying: true,
    attack: { range: 34, arc: 2.0, cooldown: 1.0, windup: 0.18, coef: 1, type: 'phys' },
    floors: [1, 5], weight: 11,
    flavour: 'Hard to hit, barely worth hitting, always in your face.',
  },
  orc: {
    id: 'orc', sheet: 'orc', name: 'Orc Grunt',
    base: { hp: 44, damage: 14, armor: 3, resist: 0, xp: 14, speed: 88 },
    radius: 14, scale: 1.0, ai: 'chaser', mass: 1.1,
    attack: { range: 48, arc: 1.6, cooldown: 1.35, windup: 0.4, coef: 1, type: 'phys' },
    floors: [1, 5], weight: 12,
    flavour: 'Where there is one, there are six.',
  },
  skeleton: {
    id: 'skeleton', sheet: 'skeleton', name: 'Skeleton',
    base: { hp: 36, damage: 12, armor: 2, resist: 8, xp: 13, speed: 96 },
    radius: 13, scale: 1.0, ai: 'chaser', mass: 0.9,
    attack: { range: 46, arc: 1.7, cooldown: 1.25, windup: 0.35, coef: 1, type: 'phys' },
    floors: [1, 6], weight: 12,
    flavour: 'Reassembles itself if you leave the bones lying around.',
  },
  skeletonArcher: {
    id: 'skeletonArcher', sheet: 'skeletonArcher', name: 'Bone Archer',
    base: { hp: 32, damage: 15, armor: 1, resist: 8, xp: 18, speed: 84 },
    radius: 13, scale: 1.0, ai: 'ranged', mass: 0.9, preferredRange: 190,
    attack: {
      range: 340, cooldown: 2.0, windup: 0.5, coef: 1, type: 'phys',
      projectile: { sprite: 'arrow3', speed: 420, radius: 7 },
    },
    floors: [2, 8], weight: 9,
    flavour: 'Picks you off while its friends hold you in place.',
  },
  armoredSkeleton: {
    id: 'armoredSkeleton', sheet: 'armoredSkeleton', name: 'Armoured Skeleton',
    base: { hp: 72, damage: 17, armor: 14, resist: 10, xp: 28, speed: 82 },
    radius: 14, scale: 1.05, ai: 'tank', mass: 1.6,
    attack: { range: 52, arc: 1.7, cooldown: 1.5, windup: 0.45, coef: 1, type: 'phys' },
    floors: [3, 9], weight: 9,
    flavour: 'The plate is the problem, not the bones.',
  },
  lancer: {
    id: 'lancer', sheet: 'lancer', name: 'Skeletal Lancer',
    base: { hp: 58, damage: 20, armor: 8, resist: 6, xp: 30, speed: 104 },
    radius: 14, scale: 1.05, ai: 'charger', mass: 1.2,
    attack: { range: 78, arc: 0.8, cooldown: 1.7, windup: 0.5, coef: 1, type: 'phys' },
    specials: [{ id: 'chargeDash', cooldown: 6, range: 420, speed: 620, coef: 1.5 }],
    floors: [3, 10], weight: 8,
    flavour: 'Lines you up from across the room and does not miss.',
  },
  greatswordSkeleton: {
    id: 'greatswordSkeleton', sheet: 'greatswordSkeleton', name: 'Greatsword Revenant',
    base: { hp: 96, damage: 19, armor: 10, resist: 12, xp: 46, speed: 80 },
    radius: 16, scale: 1.15, ai: 'tank', mass: 1.8,
    attack: { range: 76, arc: 2.1, cooldown: 2.0, windup: 0.6, coef: 1.2, type: 'phys', knockback: 160 },
    specials: [{ id: 'slam', cooldown: 8, radius: 110, coef: 1.6 }],
    floors: [4, 10], weight: 8,
    flavour: 'A two-handed sword swung by something that feels no fatigue.',
  },
  armoredOrc: {
    id: 'armoredOrc', sheet: 'armoredOrc', name: 'Armoured Orc',
    base: { hp: 118, damage: 17, armor: 20, resist: 8, xp: 48, speed: 80 },
    radius: 16, scale: 1.1, ai: 'tank', mass: 2.0,
    attack: { range: 56, arc: 1.7, cooldown: 1.6, windup: 0.5, coef: 1, type: 'phys' },
    specials: [{ id: 'enrage', cooldown: 999, hpThreshold: 0.35 }],
    floors: [4, 10], weight: 8,
    flavour: 'Ignores the first three hits out of principle.',
  },
  werewolf: {
    id: 'werewolf', sheet: 'werewolf', name: 'Werewolf',
    base: { hp: 92, damage: 21, armor: 6, resist: 6, xp: 52, speed: 168 },
    radius: 15, scale: 1.1, ai: 'charger', mass: 1.1,
    attack: { range: 52, arc: 1.9, cooldown: 0.95, windup: 0.25, coef: 1, type: 'phys' },
    specials: [{ id: 'chargeDash', cooldown: 5, range: 380, speed: 760, coef: 1.2 }],
    floors: [5, 10], weight: 8,
    flavour: 'Closes the distance before you finish turning around.',
  },
  eliteOrc: {
    id: 'eliteOrc', sheet: 'eliteOrc', name: 'Orc Champion',
    base: { hp: 150, damage: 26, armor: 22, resist: 12, xp: 78, speed: 88 },
    radius: 17, scale: 1.2, ai: 'tank', mass: 2.2,
    attack: { range: 62, arc: 1.9, cooldown: 1.7, windup: 0.5, coef: 1.1, type: 'phys', knockback: 140 },
    specials: [{ id: 'slam', cooldown: 7, radius: 120, coef: 1.7 }, { id: 'enrage', cooldown: 999, hpThreshold: 0.3 }],
    floors: [6, 10], weight: 7,
    flavour: 'Wears the armour of everyone who tried this before you.',
  },
  orcRider: {
    id: 'orcRider', sheet: 'orcRider', name: 'Orc Outrider',
    base: { hp: 132, damage: 24, armor: 16, resist: 8, xp: 72, speed: 152 },
    radius: 17, scale: 1.2, ai: 'charger', mass: 2.4,
    attack: { range: 64, arc: 1.5, cooldown: 1.4, windup: 0.4, coef: 1, type: 'phys', knockback: 180 },
    specials: [{ id: 'chargeDash', cooldown: 5, range: 520, speed: 820, coef: 1.8, knockback: 260 }],
    floors: [6, 10], weight: 7,
    flavour: 'Runs you down, wheels around, does it again.',
  },
  armoredAxeman: {
    id: 'armoredAxeman', sheet: 'armoredAxeman', name: 'Iron Axeman',
    base: { hp: 168, damage: 31, armor: 26, resist: 14, xp: 88, speed: 78 },
    radius: 17, scale: 1.2, ai: 'tank', mass: 2.4,
    attack: { range: 70, arc: 2.2, cooldown: 2.1, windup: 0.65, coef: 1.3, type: 'phys', knockback: 200 },
    specials: [{ id: 'slam', cooldown: 7, radius: 130, coef: 1.9 }],
    floors: [6, 10], weight: 7,
    flavour: 'Slow enough to dodge. Once.',
  },
  werebear: {
    id: 'werebear', sheet: 'werebear', name: 'Werebear',
    base: { hp: 240, damage: 36, armor: 24, resist: 16, xp: 130, speed: 104 },
    radius: 21, scale: 1.45, ai: 'tank', mass: 3.4,
    attack: { range: 78, arc: 2.0, cooldown: 1.8, windup: 0.5, coef: 1.2, type: 'phys', knockback: 240 },
    specials: [
      { id: 'slam', cooldown: 6, radius: 150, coef: 2.0 },
      { id: 'enrage', cooldown: 999, hpThreshold: 0.4 },
    ],
    floors: [7, 10], weight: 6,
    flavour: 'A wall of muscle that hits back harder the more you hurt it.',
  },
  necromancer: {
    id: 'necromancer', sheet: 'necromancer', name: 'Necromancer',
    base: { hp: 120, damage: 26, armor: 8, resist: 30, xp: 110, speed: 78 },
    radius: 14, scale: 1.1, ai: 'summoner', mass: 1.0, preferredRange: 300,
    attack: {
      range: 380, cooldown: 2.4, windup: 0.6, coef: 1.1, type: 'magic',
      projectile: { glow: '#a060ff', speed: 300, radius: 12, homing: 1.6 },
    },
    specials: [
      { id: 'summonAdds', cooldown: 12, count: 3, minions: ['skeleton', 'skeletonArcher'] },
      { id: 'blink', cooldown: 7, distance: 220 },
    ],
    floors: [6, 10], weight: 6,
    flavour: 'Kill it first. Everything else in the room is its fault.',
  },
};

/**
 * Bosses. Each floor has exactly one; it holds the stairs.
 * `scale` and the stat multipliers are what make a reused sprite feel like a
 * genuine set-piece rather than a big grunt.
 */
export const BOSSES = [
  {
    floor: 1, base: 'slime', name: 'Gorge, the Bloated',
    scale: 2.4, radius: 34, hpMult: 9, damageMult: 2.0, xpMult: 12,
    specials: [{ id: 'slam', cooldown: 5, radius: 150, coef: 1.4 }, { id: 'summonAdds', cooldown: 14, count: 3, minions: ['slime'] }],
    title: 'a mound of hungry gel that has eaten most of this floor',
  },
  {
    floor: 2, base: 'bat', name: 'Nightwing Matriarch',
    scale: 2.2, radius: 26, hpMult: 8, damageMult: 2.0, xpMult: 12, speedMult: 1.15,
    specials: [{ id: 'summonAdds', cooldown: 10, count: 4, minions: ['bat'] }, { id: 'volley', cooldown: 7, count: 6, coef: 0.8 }],
    title: 'she screams and the ceiling comes alive',
  },
  {
    floor: 3, base: 'orc', name: 'Grukk Skullsplitter',
    scale: 2.1, radius: 26, hpMult: 9, damageMult: 2.2, xpMult: 12,
    specials: [{ id: 'slam', cooldown: 6, radius: 160, coef: 1.6 }, { id: 'chargeDash', cooldown: 7, range: 480, speed: 700, coef: 1.8 }, { id: 'summonAdds', cooldown: 15, count: 3, minions: ['orc'] }],
    title: 'warchief of everything that still breathes down here',
  },
  {
    floor: 4, base: 'greatswordSkeleton', name: 'The Bone Marshal',
    scale: 2.0, radius: 28, hpMult: 8, damageMult: 2.0, xpMult: 12,
    specials: [{ id: 'slam', cooldown: 5, radius: 170, coef: 1.8 }, { id: 'summonAdds', cooldown: 12, count: 4, minions: ['skeleton', 'armoredSkeleton'] }],
    title: 'it still gives orders, and the dead still follow them',
  },
  {
    floor: 5, base: 'werewolf', name: 'Fenrath the Swift',
    scale: 2.0, radius: 26, hpMult: 8.5, damageMult: 2.1, xpMult: 12, speedMult: 1.2,
    specials: [{ id: 'chargeDash', cooldown: 4, range: 560, speed: 900, coef: 2.0 }, { id: 'enrage', cooldown: 999, hpThreshold: 0.5 }],
    title: 'nothing outruns it, so stop trying',
  },
  {
    floor: 6, base: 'armoredOrc', name: 'Ironhide Warlord',
    scale: 2.1, radius: 30, hpMult: 9, damageMult: 2.1, xpMult: 12,
    specials: [{ id: 'slam', cooldown: 5, radius: 180, coef: 1.9 }, { id: 'enrage', cooldown: 999, hpThreshold: 0.45 }, { id: 'summonAdds', cooldown: 14, count: 4, minions: ['armoredOrc', 'orc'] }],
    title: 'armour over armour over a very bad temper',
  },
  {
    floor: 7, base: 'necromancer', name: 'Malachai the Pale',
    scale: 2.0, radius: 24, hpMult: 8, damageMult: 2.2, xpMult: 12,
    specials: [
      { id: 'summonAdds', cooldown: 8, count: 5, minions: ['skeleton', 'skeletonArcher', 'armoredSkeleton'] },
      { id: 'blink', cooldown: 4, distance: 300 },
      { id: 'volley', cooldown: 6, count: 8, coef: 0.9, magic: true },
    ],
    title: 'he does not fight you; the floor does',
  },
  {
    floor: 8, base: 'orcRider', name: 'Gorehoof',
    scale: 2.2, radius: 30, hpMult: 9, damageMult: 2.2, xpMult: 12, speedMult: 1.1,
    specials: [{ id: 'chargeDash', cooldown: 3.5, range: 620, speed: 980, coef: 2.2, knockback: 320 }, { id: 'slam', cooldown: 8, radius: 160, coef: 1.7 }],
    title: 'a cavalry charge in a room with no exits',
  },
  {
    floor: 9, base: 'werebear', name: 'Ursath, the Mountain',
    scale: 2.3, radius: 40, hpMult: 8.5, damageMult: 2.1, xpMult: 12,
    specials: [{ id: 'slam', cooldown: 4.5, radius: 200, coef: 2.2 }, { id: 'enrage', cooldown: 999, hpThreshold: 0.5 }, { id: 'chargeDash', cooldown: 9, range: 460, speed: 700, coef: 2.0 }],
    title: 'the reason nothing else lives on this floor',
  },
  {
    floor: 10, base: 'necromancer', name: 'The Rot King',
    scale: 2.6, radius: 30, hpMult: 13, damageMult: 2.6, xpMult: 20,
    specials: [
      { id: 'summonAdds', cooldown: 7, count: 6, minions: ['greatswordSkeleton', 'armoredSkeleton', 'skeletonArcher', 'werewolf'] },
      { id: 'blink', cooldown: 4, distance: 340 },
      { id: 'volley', cooldown: 5, count: 10, coef: 1.0, magic: true },
      { id: 'slam', cooldown: 9, radius: 240, coef: 2.4 },
      { id: 'enrage', cooldown: 999, hpThreshold: 0.4 },
    ],
    title: 'whatever is left of the first thing that came down here',
  },
];

export function bossForFloor(floorNo) {
  return BOSSES.find((b) => b.floor === floorNo) || BOSSES[BOSSES.length - 1];
}

/** Enemies legal for a floor, weighted toward the top of their band. */
export function poolForFloor(floorNo) {
  return Object.values(MONSTERS)
    .filter((m) => floorNo >= m.floors[0] && floorNo <= m.floors[1] + 2)
    .map((m) => {
      // Species fade out rather than vanish, so early mobs still show up deep
      // (at a much higher level) instead of the roster resetting each floor.
      const over = Math.max(0, floorNo - m.floors[1]);
      const under = Math.max(0, m.floors[0] - floorNo);
      return { m, weight: m.weight * Math.pow(0.45, over) * Math.pow(0.3, under) };
    })
    .filter((e) => e.weight > 0.05);
}

/**
 * Monster level for a spawn. Depth inside the floor matters, so the rooms
 * nearest the stairs are meaningfully harder than the ones by the entrance.
 */
export function levelForSpawn(floorNo, roomDepth, elite, boss) {
  const base = 1 + (floorNo - 1) * 3.1 + clamp(roomDepth, 0, 20) * 0.28;
  let lvl = Math.round(base);
  if (elite) lvl += 2;
  if (boss) lvl += 4;
  return clamp(lvl, 1, 60);
}

/**
 * Trap reference text for the compendium. Kept beside the bestiary so all the
 * "what is this thing" copy lives in one place.
 */
export const TRAP_INFO = {
  spike: {
    name: 'Spike Plate', color: '#cfd6e2', persistent: false,
    flavour: 'A pressure plate over a bed of blades. Springs once, hard, then the mechanism is spent.',
  },
  dart: {
    name: 'Dart Grille', color: '#d8b070', persistent: false,
    flavour: 'Bore holes packed with primed darts. Fires in every direction at once, so backing off does not help.',
  },
  flame: {
    name: 'Flame Vent', color: '#ff8a3c', persistent: true,
    flavour: 'A burner grate fed from below. It re-arms after a few seconds - route around it rather than through it.',
  },
  poison: {
    name: 'Gas Vent', color: '#96e072', persistent: true,
    flavour: 'A perforated cap over a pocket of rot. Leaves a lingering cloud and keeps venting; an antidote clears the worst.',
  },
};

export const ELITE_PREFIX = ['Vicious', 'Scarred', 'Ancient', 'Bloodsoaked', 'Feral', 'Cursed', 'Grim'];

/** Elites get a visible tint and a real stat bump, not just a bigger number. */
export const ELITE_MODS = { hpMult: 2.6, damageMult: 1.45, xpMult: 3.0, armorAdd: 8, scale: 1.18 };

export const ELITE_TINT = 'saturate(1.6) hue-rotate(-25deg) brightness(1.12)';
export const BOSS_TINT = 'saturate(1.4) hue-rotate(200deg) brightness(0.92)';
