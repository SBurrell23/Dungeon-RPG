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
 * boundaries and overlap the surrounding floor.
 *
 * The overhang is kept small and deliberate: the collision insets in
 * game/world.js (RIM_N / RIM_S / RIM_W) mirror these numbers so a character can
 * never stand inside the wall art. Change one and change the other.
 */
export const RIM = {
  sheet: 'cavern',
  top: { x: 3.5 * TILE, y: 0, w: TILE, h: 24 },
  // South face is the lit front of the rock, so it is taller than the rest -
  // but only bleeds ~18px onto the floor below.
  bottom: { x: 3.5 * TILE, y: 2.75 * TILE, w: TILE, h: 26 },
  left: { x: 3 * TILE, y: 1.25 * TILE, w: 24, h: TILE },
  right: { x: 5.5 * TILE, y: 1.25 * TILE, w: 24, h: TILE },
  cornerTL: { x: 3 * TILE, y: 0, w: 24, h: 24 },
  cornerTR: { x: 5.5 * TILE, y: 0, w: 24, h: 24 },
  cornerBL: { x: 3 * TILE, y: 2.75 * TILE, w: 24, h: 26 },
  cornerBR: { x: 5.5 * TILE, y: 2.75 * TILE, w: 24, h: 26 },
};

/** Colour of the tileset's own pit interior - used as the void clear colour. */
export const VOID_COLOR = '#191210';

/**
 * Static decorations, as pixel rects `[x, y, w, h]` into RA_Cavern.
 *
 * Pixel rects rather than tile coords because the pack does not align its props
 * to the 48px grid - authoring these as whole tiles sliced the edges off half
 * the rocks. Every rect below was measured from the sheet by finding the empty
 * gutters around each sprite, so nothing is clipped and nothing bleeds in from
 * its neighbour. Props are drawn anchored bottom-centre on their tile.
 */
export const DECOR = {
  // Flat scatter - walkable.
  pebblesA: [783, 15, 15, 15], pebblesB: [825, 12, 27, 24], pebblesC: [873, 12, 24, 21],
  gravelA: [771, 51, 42, 42], gravelB: [819, 51, 42, 39], gravelC: [864, 51, 45, 42],
  rockFieldA: [816, 147, 192, 45], rockFieldB: [816, 195, 192, 45],

  // Small rocks that sit against a wall.
  rockA: [774, 153, 36, 33], rockB: [774, 201, 36, 33],

  // Boulders - solid.
  boulderA: [960, 195, 141, 93], boulderB: [1107, 201, 141, 87],
  boulderC: [1251, 195, 90, 90], boulderD: [1344, 210, 96, 75],
  boulderE: [1011, 297, 90, 81], boulderF: [1107, 297, 90, 81],
  boulderG: [1200, 297, 48, 87], boulderH: [1251, 291, 90, 90],
  boulderI: [1344, 306, 96, 78],

  // Flora.
  grassA: [588, 447, 21, 15], grassB: [636, 447, 24, 15], grassC: [678, 441, 39, 33],
  grassD: [588, 495, 27, 21], grassE: [630, 483, 39, 42], grassF: [678, 483, 36, 39],
  grassG: [723, 483, 42, 42],
  mushRedA: [255, 1359, 18, 24], mushRedB: [291, 1350, 42, 42],
  mushGreenA: [255, 1407, 18, 24], mushGreenB: [291, 1398, 42, 42],
  mushPinkA: [255, 1455, 18, 24], mushPinkB: [291, 1446, 42, 42],

  // Containers and furniture - solid.
  crateA: [342, 1254, 36, 84], crateB: [390, 1290, 36, 48], crateC: [438, 1275, 36, 63],
  crateD: [486, 1290, 36, 48], crateE: [534, 1275, 36, 63],
  crateStackA: [588, 1290, 72, 48], crateStackB: [684, 1290, 72, 48],
  crateTall: [768, 1248, 48, 96],
  pillar: [1200, 768, 48, 96],
  barrelA: [1251, 771, 42, 90], barrelB: [1299, 792, 42, 69],
  barrelC: [1347, 792, 42, 69], barrelD: [1395, 768, 90, 93],
  potA: [723, 867, 42, 42], potB: [873, 870, 30, 84], potC: [912, 882, 48, 78],
  sackA: [963, 867, 42, 90], sackB: [1011, 888, 42, 69],
  altar: [768, 864, 96, 96], pedestal: [1056, 864, 48, 96],

  // Decorative pools.
  poolDark: [1014, 6, 84, 84], poolWater: [1206, 6, 84, 84], poolLava: [1302, 6, 84, 84],
};

/**
 * Decor that blocks movement.
 *
 * Anything with physical bulk - rock, crates, barrels, pots - so players walk
 * around dungeon furniture instead of over it. Flat scatter (pebbles, grass,
 * mushrooms, gravel) stays walkable.
 */
export const SOLID_DECOR = new Set([
  'boulderA', 'boulderB', 'boulderC', 'boulderD', 'boulderE',
  'boulderF', 'boulderG', 'boulderH', 'boulderI',
  'pillar', 'altar', 'pedestal',
  'crateA', 'crateB', 'crateC', 'crateD', 'crateE',
  'crateStackA', 'crateStackB', 'crateTall',
  'barrelA', 'barrelB', 'barrelC', 'barrelD',
  'potA', 'potB', 'potC', 'sackA', 'sackB',
]);

/**
 * Where a decor sprite lands in the world, anchored bottom-centre on its tile.
 * Renderer and collision both go through this so they can never disagree.
 * @returns {{sx:number, sy:number, sw:number, sh:number, dx:number, dy:number}}
 */
export function decorPlacement(kind, tileX, tileY) {
  const r = DECOR[kind];
  if (!r) return null;
  const [sx, sy, sw, sh] = r;
  return {
    sx, sy, sw, sh,
    dx: Math.round(tileX * TILE + (TILE - sw) / 2),
    dy: Math.round(tileY * TILE + TILE - sh),
  };
}

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
