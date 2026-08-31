/**
 * Declarative description of the art pack. Nothing else in the codebase should
 * contain a hard-coded asset path - add new art here and the loader, renderer
 * and content tables all pick it up.
 *
 * Sprite sheets are horizontal strips of 100x100 frames. Characters are drawn
 * top-down facing RIGHT; the renderer mirrors them horizontally to face left
 * and never rotates them, so there are only ever two facings.
 */
export const FRAME = 100;
export const TILE = 48;

const CHAR_ROOT = 'assets/Characters(100x100 split)';

/**
 * Sheets live in `<root>/<side>/<folder>/<prefix>/<prefix><suffix>.png`.
 *
 * The pack also ships a "<prefix> with shadows" variant, but mirroring a sprite
 * mirrors its baked drop shadow with it. We use the shadow-free sheets and cast
 * our own ellipse, which stays put and keeps the lighting consistent.
 */
function chr(side, folder, prefix, anims) {
  return {
    side,
    dir: CHAR_ROOT + '/' + side + '/' + folder + '/' + prefix,
    prefix,
    anims,
  };
}

/** Playable classes. Keys double as the network/save identifiers. */
export const HERO_SHEETS = {
  knight: chr('Good Guys', 'Knight', 'Knight', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    attack3: '_Attack03', block: '_Block', hurt: '_Hurt', death: '_Death',
  }),
  templar: chr('Good Guys', 'Knight Templar', 'Knight Templar', {
    idle: '_Idle', walk: '_Walk01', walk2: '_Walk02', attack: '_Attack01',
    attack2: '_Attack02', attack3: '_Attack03', block: '_Block', hurt: '_Hurt', death: '_Death',
  }),
  swordsman: chr('Good Guys', 'Swordsman', 'Swordsman', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    attack3: '_Attack3', hurt: '_Hurt', death: '_Death',
  }),
  soldier: chr('Good Guys', 'Soldier', 'Soldier', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    attack3: '_Attack03', hurt: '_Hurt', death: '_Death',
  }),
  archer: chr('Good Guys', 'Archer', 'Archer', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    hurt: '_Hurt', death: '_Death',
  }),
  wizard: chr('Good Guys', 'Wizard', 'Wizard', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    hurt: '_Hurt', death: '_Death',
  }),
  priest: chr('Good Guys', 'Priest', 'Priest', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack', attack2: '_Heal',
    hurt: '_Hurt', death: '_Death',
  }),
};

/** Enemy art. Stat blocks live in game/monsters.js - this table is purely visual. */
export const MONSTER_SHEETS = {
  slime: chr('Bad Guys', 'Slime', 'Slime', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02', hurt: '_Hurt', death: '_Death',
  }),
  bat: chr('Bad Guys', 'Bat', 'Bat', {
    idle: '_Flying', walk: '_Flying', attack: '_Attack01', attack2: '_Attack02', hurt: '_Hurt', death: '_Death',
  }),
  orc: chr('Bad Guys', 'Orc', 'Orc', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02', hurt: '_Hurt', death: '_Death',
  }),
  skeleton: chr('Bad Guys', 'Skeleton', 'Skeleton', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    block: '_Block', summon: '_Summon', hurt: '_Hurt', death: '_Death',
  }),
  skeletonArcher: chr('Bad Guys', 'Skeleton Archer', 'Skeleton Archer', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack', summon: '_Summon', hurt: '_Hurt', death: '_Death',
  }),
  armoredSkeleton: chr('Bad Guys', 'Armored Skeleton', 'Armored Skeleton', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    summon: '_Summon', hurt: '_Hurt', death: '_Death',
  }),
  greatswordSkeleton: chr('Bad Guys', 'Greatsword Skeleton', 'Greatsword Skeleton', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    attack3: '_Attack03', summon: '_Summon', hurt: '_Hurt', death: '_Death',
  }),
  lancer: chr('Bad Guys', 'Lancer', 'Lancer', {
    idle: '_Idle', walk: '_Walk01', walk2: '_Walk02', attack: '_Attack01',
    attack2: '_Attack02', attack3: '_Attack03', hurt: '_Hurt', death: '_Death',
  }),
  armoredOrc: chr('Bad Guys', 'Armored Orc', 'Armored Orc', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    attack3: '_Attack03', block: '_Block', hurt: '_Hurt', death: '_Death',
  }),
  eliteOrc: chr('Bad Guys', 'Elite Orc', 'Elite Orc', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    attack3: '_Attack03', hurt: '_Hurt', death: '_Death',
  }),
  orcRider: chr('Bad Guys', 'Orc rider', 'Orc rider', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    attack3: '_Attack03', block: '_Block', hurt: '_Hurt', death: '_Death',
  }),
  armoredAxeman: chr('Bad Guys', 'Armored Axeman', 'Armored Axeman', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    attack3: '_Attack03', hurt: '_Hurt', death: '_Death',
  }),
  werewolf: chr('Bad Guys', 'Werewolf', 'Werewolf', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02', hurt: '_Hurt', death: '_Death',
  }),
  werebear: chr('Bad Guys', 'Werebear', 'Werebear', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    attack3: '_Attack03', hurt: '_Hurt', death: '_Death',
  }),
  necromancer: chr('Bad Guys', 'Necromancer', 'Necromancer', {
    idle: '_Idle', walk: '_Walk', attack: '_Attack01', attack2: '_Attack02',
    summon: '_Summon', hurt: '_Hurt', death: '_DEATH',
  }),
};

/** Flat sheets that are not per-character. */
export const IMAGES = {
  icons: 'assets/icons.png',
  ground: 'assets/terrain/RA_Ground_Tiles.png',
  cavern: 'assets/terrain/RA_Cavern.png',
  cavernAnim: 'assets/terrain/RA_Cavern_Animations.png',
  arrow1: 'assets/projectiles/Arrow(Projectile)/Arrow01(100x100).png',
  arrow2: 'assets/projectiles/Arrow(Projectile)/Arrow02(100x100).png',
  arrow3: 'assets/projectiles/Arrow(Projectile)/Arrow03(100x100).png',
  fxWizard1: 'assets/projectiles/Magic(Projectile)/Wizard_Attack01_Effect.png',
  fxWizard2: 'assets/projectiles/Magic(Projectile)/Wizard_Attack02_Effect.png',
  fxPriestAttack: 'assets/projectiles/Magic(Projectile)/Priest_Attack_effect.png',
  fxPriestHeal: 'assets/projectiles/Magic(Projectile)/Priest_Heal_effect.png',
  fxNecro: 'assets/projectiles/Magic(Projectile)/Necromancer_Attack02_Effect.png',
  fxSummon: 'assets/projectiles/Magic(Projectile)/Necromancer_Sumon_Effect.png',
};

/** Frame counts for the flat FX strips (width / 100). */
export const FX_STRIPS = {
  fxWizard1: 10, fxWizard2: 7, fxPriestAttack: 5, fxPriestHeal: 4, fxNecro: 6, fxSummon: 7,
};

export const MUSIC = { dungeon: 'assets/music/Stay Down.mp3' };

// ---------------------------------------------------------------------------
// Terrain atlas geometry
// ---------------------------------------------------------------------------
// Both terrain sheets store ground as a "blob" autotile: a 3x3 set of edge and
// outer-corner tiles with a solid centre, plus four concave (inner) corner
// tiles. gen/autotile.js composes 24x24 quadrants out of these.

/** RA_Ground_Tiles: 12 variants. Each is 3 cols wide; inner-corner ring on top. */
function groundVariants() {
  const out = [];
  for (const rowBase of [1, 9]) {
    for (const col of [1, 5, 9, 13, 17, 21]) {
      out.push({
        sheet: 'ground',
        // 3x3 ring with a hole in the middle: its corner tiles are the concave pieces.
        ring: { col, row: rowBase },
        // 3x3 blob: edges, convex corners and a solid centre.
        blob: { col, row: rowBase + 3 },
        tone: rowBase === 1 && col <= 9 ? 'moss' : 'dirt',
      });
    }
  }
  return out;
}

/**
 * RA_Cavern floors: laid out as [fill][blank] over a 2x2 inner-corner set,
 * with a 3x3 blob two columns to the right.
 */
function cavernFloorVariants() {
  const out = [];
  for (const row of [0, 3, 6]) {
    for (const col of [6, 11]) {
      out.push({
        sheet: 'cavern',
        fill: { col, row },
        inner: { col, row: row + 1 },
        blob: { col: col + 2, row },
        tone: 'cave',
      });
    }
  }
  return out;
}

export const CAVE_FLOORS = cavernFloorVariants();
export const GROUND_FLOORS = groundVariants();
export const FLOOR_VARIANTS = [...CAVE_FLOORS, ...GROUND_FLOORS];

/**
 * Rock rim drawn where floor meets the void, sampled out of the cavern sheet's
 * pit prefab at tiles (3,0)-(5,4). In that prefab the pit interior spans
 * x[3.5, 5.5] and y[0.5, 2.75] tiles, so the rim pieces sit on half-tile
 * boundaries and overlap the surrounding floor by 24px (96px on the south side,
 * which is the lit "front face" of the rock).
 */
export const RIM = {
  sheet: 'cavern',
  top: { x: 3.5 * TILE, y: 0, w: TILE, h: 24 },
  bottom: { x: 3.5 * TILE, y: 2.75 * TILE, w: TILE, h: 60 },
  left: { x: 3 * TILE, y: 1.25 * TILE, w: 24, h: TILE },
  right: { x: 5.5 * TILE, y: 1.25 * TILE, w: 24, h: TILE },
  cornerTL: { x: 3 * TILE, y: 0, w: 24, h: 24 },
  cornerTR: { x: 5.5 * TILE, y: 0, w: 24, h: 24 },
  cornerBL: { x: 3 * TILE, y: 2.75 * TILE, w: 24, h: 60 },
  cornerBR: { x: 5.5 * TILE, y: 2.75 * TILE, w: 24, h: 60 },
};

/** Colour of the tileset's own pit interior - used as the void clear colour. */
export const VOID_COLOR = '#191210';

/** Static decorations as [col, row, wTiles, hTiles] into RA_Cavern. */
export const DECOR = {
  pebblesA: [16, 0, 1, 1], pebblesB: [17, 0, 1, 1], pebblesC: [18, 0, 1, 1],
  gravelA: [16, 1, 1, 1], gravelB: [17, 1, 1, 1], gravelC: [18, 1, 1, 1],
  rockA: [16, 3, 1, 1], rockB: [17, 3, 1, 1], rockC: [18, 3, 1, 1], rockD: [19, 3, 1, 1],
  rockE: [16, 4, 1, 1], rockF: [17, 4, 1, 1], rockG: [18, 4, 1, 1], rockH: [19, 4, 1, 1],
  boulderA: [21, 4, 2, 2], boulderB: [23, 4, 2, 2], boulderC: [25, 4, 2, 2], boulderD: [27, 4, 2, 2],
  boulderE: [21, 6, 2, 2], boulderF: [23, 6, 2, 2], boulderG: [25, 6, 2, 2], boulderH: [27, 6, 2, 2],
  spireA: [16, 6, 2, 2], spireB: [18, 6, 2, 2],
  grassA: [12, 9, 1, 1], grassB: [13, 9, 1, 1], grassC: [14, 9, 1, 1], grassD: [15, 9, 1, 1],
  grassE: [12, 10, 1, 1], grassF: [13, 10, 1, 1], grassG: [14, 10, 1, 1],
  mushRedA: [5, 28, 1, 1], mushRedB: [6, 28, 1, 1], mushRedC: [7, 28, 1, 1],
  mushGreenA: [5, 29, 1, 1], mushGreenB: [6, 29, 1, 1], mushGreenC: [7, 29, 1, 1],
  mushPinkA: [5, 30, 1, 1], mushPinkB: [6, 30, 1, 1], mushPinkC: [7, 30, 1, 1],
  crateA: [7, 24, 1, 2], crateB: [8, 25, 1, 1], crateC: [9, 24, 1, 2], crateD: [11, 24, 1, 2],
  crateStackA: [12, 24, 2, 2], crateStackB: [14, 24, 2, 2],
  barrelA: [27, 16, 1, 2], barrelB: [28, 16, 1, 2], barrelC: [29, 16, 1, 2],
  potA: [16, 18, 1, 2], potB: [17, 18, 1, 2], potC: [18, 18, 1, 2], potD: [19, 18, 1, 2],
  sackA: [20, 18, 1, 2], sackB: [21, 18, 1, 2],
  pillar: [26, 16, 1, 2],
  altar: [22, 16, 1, 2],
  slab: [16, 16, 1, 1], slabCross: [17, 16, 1, 1], slabQuad: [18, 16, 1, 1],
  poolWater: [25, 0, 2, 2], poolDark: [21, 0, 2, 2], poolLava: [27, 0, 2, 2],
};

/** Decor that should block movement (props tall enough to stand behind). */
export const SOLID_DECOR = new Set([
  'boulderA', 'boulderB', 'boulderC', 'boulderD', 'boulderE', 'boulderF', 'boulderG', 'boulderH',
  'spireA', 'spireB', 'pillar', 'crateStackA', 'crateStackB', 'altar',
]);

/** Chest sprites, cavern sheet tile coords. */
export const CHEST = {
  common: { closed: [23, 18], open: [23, 19] },
  rare: { closed: [23, 23], open: [23, 24] },
  boss: { closed: [23, 28], open: [23, 29] },
};

/**
 * RA_Cavern_Animations: three colour blocks of 12 rows each. Within a block,
 * groups of 4 frames start at column 1 and are separated by a blank column.
 * Frame N is at [col + N, row].
 */
export const ANIM_TILES = {
  torch: { col: 1, row: 0, w: 1, h: 2, frames: 4, fps: 8 },
  brazier: { col: 6, row: 0, w: 1, h: 2, frames: 4, fps: 8 },
  candles: { col: 11, row: 2, w: 1, h: 2, frames: 4, fps: 7 },
  firePit: { col: 1, row: 4, w: 1, h: 2, frames: 4, fps: 9 },
  stairsDown: { col: 16, row: 6, w: 1, h: 2, frames: 4, fps: 5 },
  runePlate: { col: 21, row: 6, w: 1, h: 2, frames: 4, fps: 5 },
  runeCircle: { col: 6, row: 8, w: 1, h: 2, frames: 4, fps: 5 },
  fountain: { col: 1, row: 10, w: 1, h: 2, frames: 4, fps: 8 },
};

/** Icon sheet is a 32x32 grid of 48px cells. */
export const ICON_SIZE = 48;
export const ICON_COLS = 32;

/**
 * Equipment icon families. Each family is a set of rows (one per material tier)
 * of columns that read left-to-right as increasing power, so an item's tier
 * maps straight onto a column index and its rarity onto a row.
 */
export const ICON_FAMILIES = {
  sword: { rows: [0, 1, 2, 3], col0: 0, cols: 16 },
  longsword: { rows: [4, 5, 6, 7], col0: 0, cols: 16 },
  wand: { rows: [8, 9, 10, 11], col0: 0, cols: 16 },
  axe: { rows: [12, 13, 14, 15], col0: 0, cols: 16 },
  bow: { rows: [16, 17, 18, 19], col0: 0, cols: 16 },
  spear: { rows: [20, 21, 22, 23], col0: 0, cols: 16 },
  helm: { rows: [24, 25, 26, 27], col0: 0, cols: 8 },
  body: { rows: [24, 25, 26, 27], col0: 8, cols: 8 },
  helmHeavy: { rows: [28, 29, 30, 31], col0: 0, cols: 8 },
  bodyHeavy: { rows: [28, 29, 30, 31], col0: 8, cols: 8 },
  shield: { rows: [0, 1, 2, 3], col0: 16, cols: 8 },
  gloves: { rows: [0, 1, 2, 3], col0: 24, cols: 8 },
  belt: { rows: [4, 5, 6, 7], col0: 16, cols: 8 },
  boots: { rows: [4, 5, 6, 7], col0: 24, cols: 8 },
  amulet: { rows: [8, 9, 10, 11], col0: 16, cols: 8 },
  ring: { rows: [8, 9, 10, 11], col0: 24, cols: 8 },
};

/** Single-purpose icons, [col, row]. */
export const ICON = {
  potionHp: [18, 12], potionHpBig: [19, 12],
  potionMp: [22, 12], potionMpBig: [23, 12],
  potionRevive: [30, 12], potionAntidote: [18, 13],
  potionStrength: [26, 12], potionSpeed: [22, 13],
  key: [19, 14],
  gemBlue: [19, 15], gemPink: [27, 15], gemGreen: [19, 16],
  gemRed: [27, 16], gemGrey: [19, 17], gemWhite: [27, 17],
  coin: [26, 18], coinSmall: [25, 18], coinPile: [27, 18],
  ingotGold: [19, 22], ingotSilver: [19, 21], ingotCopper: [19, 20],
  bagBrown: [30, 20], bagGrey: [30, 22],
  tomeRed: [21, 23], tomeBlue: [18, 23], tomeGreen: [19, 23], tomeGold: [22, 23],
  tomeHoly: [26, 23], tomeDark: [24, 23], tomeLife: [29, 24], tomeSkull: [18, 24],
  scroll: [23, 28], scrollPair: [24, 28],
  bread: [16, 29], meat: [17, 28], cheese: [18, 28], apple: [22, 26],
  skull: [17, 24], heart: [29, 24], wrench: [28, 28],
};
