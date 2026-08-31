import { TAU } from '../core/util.js';
import { ICON } from '../assets/manifest.js';

/**
 * Ability registry.
 *
 * Abilities are pure descriptions plus a `cast(ctx)` that calls into the world.
 * Everything a spell can do goes through the small verb set on `ctx.world`
 * (melee / fireProjectile / explode / applyBuff / heal / ...), which means new
 * spells are data plus a few lines - no new systems.
 *
 * ctx = { world, actor, aim, aimX, aimY, rng }
 */

const P = { melee: 'attackPower', ranged: 'rangedPower', spell: 'spellPower' };

export const SCHOOLS = {
  basic: { name: 'Basic', color: '#cfcfcf' },
  war: { name: 'War', color: '#e08a5a' },
  arcane: { name: 'Arcane', color: '#7fa8ff' },
  holy: { name: 'Holy', color: '#ffe08a' },
  nature: { name: 'Nature', color: '#7fd98a' },
};

export const ABILITIES = {
  // -------------------------------------------------------------------------
  // Basic attacks - free, gated only by weapon speed.
  // -------------------------------------------------------------------------
  slash: {
    id: 'slash', name: 'Slash', school: 'basic', icon: [4, 0], basic: true,
    desc: 'A wide sweep of the blade.',
    mana: 0, cooldown: 0.60, anim: 'attack', swings: ['attack', 'attack2', 'attack3'],
    cast(ctx) {
      ctx.world.melee(ctx.actor, {
        range: 46, arc: 1.05, coef: 1.0, power: P.melee, type: 'phys',
        knockback: 90, sfx: 'swing',
      });
    },
  },

  thrust: {
    id: 'thrust', name: 'Thrust', school: 'basic', icon: [4, 20], basic: true,
    desc: 'A long stab that outranges most claws.',
    mana: 0, cooldown: 0.66, anim: 'attack', swings: ['attack', 'attack2', 'attack3'],
    cast(ctx) {
      ctx.world.melee(ctx.actor, {
        range: 68, arc: 0.5, coef: 1.12, power: P.melee, type: 'phys',
        knockback: 130, sfx: 'swing',
      });
    },
  },

  shoot: {
    id: 'shoot', name: 'Loose Arrow', school: 'basic', icon: [4, 16], basic: true,
    desc: 'Nock, draw, release.',
    mana: 0, cooldown: 0.56, anim: 'attack', swings: ['attack', 'attack2'],
    cast(ctx) {
      ctx.world.fireProjectile(ctx.actor, {
        angle: ctx.aim, speed: 640, range: 620, coef: 1.0, power: P.ranged,
        type: 'phys', sprite: 'arrow2', radius: 7, knockback: 40, sfx: 'bow',
      });
    },
  },

  arcaneBolt: {
    id: 'arcaneBolt', name: 'Arcane Bolt', school: 'basic', icon: ICON.gemBlue, basic: true,
    desc: 'A dart of raw magic. Costs nothing but time.',
    mana: 0, cooldown: 0.60, anim: 'attack', swings: ['attack', 'attack2'],
    cast(ctx) {
      ctx.world.fireProjectile(ctx.actor, {
        angle: ctx.aim, speed: 520, range: 560, coef: 1.05, power: P.spell,
        type: 'magic', glow: '#7fb2ff', radius: 9, sfx: 'cast',
      });
    },
  },

  holyBolt: {
    id: 'holyBolt', name: 'Holy Bolt', school: 'basic', icon: ICON.gemWhite, basic: true,
    desc: 'Sears the unliving, and returns a little of the light to your wounded.',
    mana: 0, cooldown: 0.62, anim: 'attack', swings: ['attack'],
    cast(ctx) {
      ctx.world.fireProjectile(ctx.actor, {
        angle: ctx.aim, speed: 500, range: 540, coef: 1.0, power: P.spell,
        type: 'holy', glow: '#ffe9b0', radius: 9, sfx: 'cast',
        onHit: (world, owner, victim, dmg) => world.healLowestAlly(owner, dmg * 0.18),
      });
    },
  },

  // -------------------------------------------------------------------------
  // Signature class abilities
  // -------------------------------------------------------------------------
  shieldWall: {
    id: 'shieldWall', name: 'Shield Wall', school: 'war', icon: [21, 0],
    desc: 'Brace. Take 45% less damage and hold aggro for 8 seconds.',
    mana: 18, cooldown: 16, anim: 'block',
    cast(ctx) {
      ctx.world.applyBuff(ctx.actor, {
        id: 'shieldWall', name: 'Shield Wall', duration: 8, icon: [21, 0],
        damageTaken: 0.55, taunt: true, mods: { armor: 40, moveSpeed: -0.1 },
      });
      ctx.world.spawnFx('ward', ctx.actor.x, ctx.actor.y, { color: '#cfd8e8', radius: 42, life: 0.5 });
      ctx.world.sfx('buff');
    },
  },

  consecrate: {
    id: 'consecrate', name: 'Consecrate', school: 'holy', icon: ICON.tomeHoly, tome: true, minFloor: 2,
    desc: 'Hallow the ground: burns enemies and mends allies who stand in it.',
    mana: 26, cooldown: 9, anim: 'attack2',
    cast(ctx) {
      ctx.world.groundZone(ctx.actor, {
        x: ctx.actor.x, y: ctx.actor.y, radius: 105, duration: 4, tickRate: 0.5,
        coef: 0.34, power: P.spell, type: 'holy', color: '#ffe9a8',
        healAllies: 0.035, sfx: 'holy',
      });
    },
  },

  whirlwind: {
    id: 'whirlwind', name: 'Whirlwind', school: 'war', icon: [11, 12],
    desc: 'Spin through everything within reach. Three sweeps, no target left out.',
    mana: 20, cooldown: 7, anim: 'attack3',
    cast(ctx) {
      for (let i = 0; i < 3; i++) {
        ctx.world.delay(i * 0.16, () => {
          ctx.world.melee(ctx.actor, {
            range: 62, arc: TAU, coef: 0.72, power: P.melee, type: 'phys',
            knockback: 110, sfx: 'swing',
          });
          ctx.world.spawnFx('spin', ctx.actor.x, ctx.actor.y, { radius: 62, life: 0.2 });
        });
      }
    },
  },

  javelin: {
    id: 'javelin', name: 'Javelin', school: 'war', icon: [9, 21],
    desc: 'Hurl your spear clean through a rank of enemies.',
    mana: 16, cooldown: 6, anim: 'attack2',
    cast(ctx) {
      ctx.world.fireProjectile(ctx.actor, {
        angle: ctx.aim, speed: 760, range: 700, coef: 1.75, power: P.melee,
        type: 'phys', sprite: 'arrow1', radius: 11, pierce: 99, knockback: 180,
        scale: 1.6, sfx: 'bow',
      });
    },
  },

  multishot: {
    id: 'multishot', name: 'Multishot', school: 'war', icon: [11, 17],
    desc: 'Five arrows in a fan. Good for corridors, better for packs.',
    mana: 22, cooldown: 7, anim: 'attack2',
    cast(ctx) {
      const spread = 0.62;
      for (let i = 0; i < 5; i++) {
        const a = ctx.aim + (i / 4 - 0.5) * spread;
        ctx.world.fireProjectile(ctx.actor, {
          angle: a, speed: 620, range: 560, coef: 0.66, power: P.ranged,
          type: 'phys', sprite: 'arrow2', radius: 7, knockback: 30, sfx: i === 0 ? 'bow' : null,
        });
      }
    },
  },

  fireball: {
    id: 'fireball', name: 'Fireball', school: 'arcane', icon: ICON.gemRed,
    desc: 'Detonates on contact and leaves the survivors burning.',
    mana: 24, cooldown: 5, anim: 'attack2',
    cast(ctx) {
      ctx.world.fireProjectile(ctx.actor, {
        angle: ctx.aim, speed: 430, range: 620, coef: 1.35, power: P.spell,
        type: 'fire', glow: '#ff9040', radius: 12, sfx: 'cast',
        explode: { radius: 96, coef: 1.15, fx: 'fxWizard1', color: '#ff8030' },
        effects: [{ id: 'burn', duration: 4, coef: 0.14, tick: 0.5 }],
      });
    },
  },

  heal: {
    id: 'heal', name: 'Mend Wounds', school: 'holy', icon: ICON.tomeLife,
    desc: 'Restore health to every ally around you.',
    mana: 30, cooldown: 8, anim: 'attack2',
    cast(ctx) {
      ctx.world.healAllies(ctx.actor, {
        radius: 210,
        flat: ctx.actor.stats.spellPower * 1.35,
        pct: 0.16,
        fx: 'fxPriestHeal',
        sfx: 'heal',
      });
    },
  },

  // -------------------------------------------------------------------------
  // Findable / purchasable tomes
  // -------------------------------------------------------------------------
  frostNova: {
    id: 'frostNova', name: 'Frost Nova', school: 'arcane', icon: [23, 15], tome: true, minFloor: 1,
    desc: 'A ring of ice. Damages and halves the speed of everything nearby.',
    mana: 26, cooldown: 11, anim: 'attack2',
    cast(ctx) {
      ctx.world.explode(ctx.actor, ctx.actor.x, ctx.actor.y, {
        radius: 160, coef: 1.05, power: P.spell, type: 'frost', color: '#8fd8ff',
        knockback: 60, sfx: 'frost',
        effects: [{ id: 'chill', duration: 3.5, slow: 0.5 }],
      });
    },
  },

  chainLightning: {
    id: 'chainLightning', name: 'Chain Lightning', school: 'arcane', icon: [23, 17], tome: true, minFloor: 2,
    desc: 'Arcs between up to five enemies, weakening with each jump.',
    mana: 28, cooldown: 8, anim: 'attack2',
    cast(ctx) {
      ctx.world.chain(ctx.actor, {
        angle: ctx.aim, jumps: 5, range: 420, jumpRange: 200,
        coef: 1.3, falloff: 0.82, power: P.spell, type: 'shock',
        color: '#cfe8ff', sfx: 'shock',
      });
    },
  },

  arcaneMissiles: {
    id: 'arcaneMissiles', name: 'Arcane Missiles', school: 'arcane', icon: [23, 15], tome: true, minFloor: 1,
    desc: 'Three seeking darts that will not miss.',
    mana: 18, cooldown: 5, anim: 'attack',
    cast(ctx) {
      for (let i = 0; i < 3; i++) {
        ctx.world.delay(i * 0.1, () => {
          ctx.world.fireProjectile(ctx.actor, {
            angle: ctx.aim + (ctx.rng() - 0.5) * 0.5, speed: 400, range: 520,
            coef: 0.72, power: P.spell, type: 'magic', glow: '#ff9fe0', radius: 8,
            homing: 5.5, sfx: i === 0 ? 'cast' : null,
          });
        });
      }
    },
  },

  meteor: {
    id: 'meteor', name: 'Meteor', school: 'arcane', icon: [23, 16], tome: true, minFloor: 4,
    desc: 'Calls a burning rock down where you aim. Slow, telegraphed, enormous.',
    mana: 46, cooldown: 15, anim: 'attack2',
    cast(ctx) {
      ctx.world.telegraph(ctx.actor, {
        x: ctx.aimX, y: ctx.aimY, radius: 130, delay: 1.1, color: '#ff7040',
        onLand: (world) => {
          world.explode(ctx.actor, ctx.aimX, ctx.aimY, {
            radius: 140, coef: 2.6, power: P.spell, type: 'fire', color: '#ff7030',
            knockback: 220, fx: 'fxWizard1', sfx: 'boom',
            effects: [{ id: 'burn', duration: 5, coef: 0.2, tick: 0.5 }],
          });
        },
      });
    },
  },

  blink: {
    id: 'blink', name: 'Blink', school: 'arcane', icon: [19, 17], tome: true, minFloor: 2,
    desc: 'Step through space toward your cursor. The only real escape button.',
    mana: 14, cooldown: 6,
    cast(ctx) {
      ctx.world.blink(ctx.actor, ctx.aim, 240);
      ctx.world.sfx('blink');
    },
  },

  lifeTap: {
    id: 'lifeTap', name: 'Life Tap', school: 'arcane', icon: ICON.tomeDark, tome: true, minFloor: 3,
    desc: 'Burn 20% of your health to refill a third of your mana.',
    mana: 0, cooldown: 12,
    cast(ctx) {
      const cost = ctx.actor.stats.maxHp * 0.2;
      if (ctx.actor.hp <= cost + 1) return false;
      ctx.world.damageActorDirect(ctx.actor, cost, 'self');
      ctx.world.restoreMana(ctx.actor, ctx.actor.stats.maxMp * 0.34);
      ctx.world.spawnFx('ward', ctx.actor.x, ctx.actor.y, { color: '#b060ff', radius: 34, life: 0.4 });
      ctx.world.sfx('buff');
      return true;
    },
  },

  poisonCloud: {
    id: 'poisonCloud', name: 'Creeping Rot', school: 'nature', icon: ICON.gemGreen, tome: true, minFloor: 3,
    desc: 'A lingering cloud that eats through armour over time.',
    mana: 30, cooldown: 12, anim: 'attack2',
    cast(ctx) {
      ctx.world.groundZone(ctx.actor, {
        x: ctx.aimX, y: ctx.aimY, radius: 130, duration: 7, tickRate: 0.6,
        coef: 0.3, power: P.spell, type: 'poison', color: '#8ad86a', sfx: 'cast',
        effects: [{ id: 'poison', duration: 3, coef: 0.1, tick: 0.6 }],
      });
    },
  },

  healingSpring: {
    id: 'healingSpring', name: 'Healing Spring', school: 'nature', icon: ICON.tomeGreen, tome: true, minFloor: 2,
    desc: 'A pool of clean water. Anyone standing in it recovers steadily.',
    mana: 34, cooldown: 16, anim: 'attack2',
    cast(ctx) {
      ctx.world.groundZone(ctx.actor, {
        x: ctx.aimX, y: ctx.aimY, radius: 120, duration: 8, tickRate: 0.5,
        coef: 0, healAllies: 0.028, type: 'holy', color: '#7fe0d8', friendly: true, sfx: 'heal',
      });
    },
  },

  bloodlust: {
    id: 'bloodlust', name: 'Bloodlust', school: 'war', icon: ICON.tomeRed, tome: true, minFloor: 2,
    desc: 'The whole party swings and moves faster for ten seconds.',
    mana: 32, cooldown: 24,
    cast(ctx) {
      ctx.world.buffAllies(ctx.actor, 260, {
        id: 'bloodlust', name: 'Bloodlust', duration: 10, icon: ICON.tomeRed,
        mods: { attackSpeed: 0.35, moveSpeed: 0.2, damagePct: 0.15 },
      });
      ctx.world.sfx('buff');
    },
  },

  stoneSkin: {
    id: 'stoneSkin', name: 'Stone Skin', school: 'war', icon: [21, 21], tome: true, minFloor: 2,
    desc: 'Harden your hide. Heavy armour bonus, slightly slower feet.',
    mana: 22, cooldown: 18,
    cast(ctx) {
      ctx.world.applyBuff(ctx.actor, {
        id: 'stoneSkin', name: 'Stone Skin', duration: 12, icon: [21, 21],
        mods: { armor: 70, resist: 40, moveSpeed: -0.08 },
      });
      ctx.world.sfx('buff');
    },
  },

  warCry: {
    id: 'warCry', name: 'War Cry', school: 'war', icon: ICON.tomeGold, tome: true, minFloor: 3,
    desc: 'A shout that staggers everything close and steels your allies.',
    mana: 26, cooldown: 18,
    cast(ctx) {
      ctx.world.explode(ctx.actor, ctx.actor.x, ctx.actor.y, {
        radius: 200, coef: 0.4, power: P.melee, type: 'phys', color: '#ffd080',
        knockback: 200, sfx: 'shout',
        effects: [{ id: 'stun', duration: 1.4 }],
      });
      ctx.world.buffAllies(ctx.actor, 240, {
        id: 'rallied', name: 'Rallied', duration: 8, icon: ICON.tomeGold,
        mods: { damagePct: 0.18, armor: 20 },
      });
    },
  },

  holyNova: {
    id: 'holyNova', name: 'Holy Nova', school: 'holy', icon: ICON.tomeHoly, tome: true, minFloor: 3,
    desc: 'A burst of light: sears enemies and heals allies in the same breath.',
    mana: 34, cooldown: 12, anim: 'attack2',
    cast(ctx) {
      ctx.world.explode(ctx.actor, ctx.actor.x, ctx.actor.y, {
        radius: 190, coef: 1.5, power: P.spell, type: 'holy', color: '#fff0c0',
        knockback: 90, fx: 'fxPriestAttack', sfx: 'holy',
      });
      ctx.world.healAllies(ctx.actor, { radius: 190, flat: ctx.actor.stats.spellPower * 0.8, pct: 0.08, fx: 'fxPriestHeal' });
    },
  },

  lightWard: {
    id: 'lightWard', name: 'Ward of Light', school: 'holy', icon: [21, 1], tome: true, minFloor: 3,
    desc: 'Wraps every nearby ally in a shield that soaks the next few hits.',
    mana: 30, cooldown: 20,
    cast(ctx) {
      const amount = ctx.actor.stats.spellPower * 2.2 + 30;
      ctx.world.shieldAllies(ctx.actor, 240, amount, 10);
      ctx.world.sfx('holy');
    },
  },

  resurrect: {
    id: 'resurrect', name: 'Resurrection', school: 'holy', icon: ICON.tomeLife, tome: true, minFloor: 5, rare: true,
    desc: 'Brings a fallen ally back to their feet at half health. Very rare.',
    mana: 60, cooldown: 45, anim: 'attack2',
    cast(ctx) {
      const ok = ctx.world.reviveNearest(ctx.actor, 260, 0.5);
      if (ok) ctx.world.sfx('revive');
      return ok;
    },
  },
};

/** Tomes that can drop or be sold, filtered by the floor you are on. */
export function tomePool(floorNo) {
  return Object.values(ABILITIES).filter((a) => a.tome && (a.minFloor || 1) <= floorNo && !(a.rare && floorNo < 5));
}

export function getAbility(id) {
  return ABILITIES[id] || null;
}
