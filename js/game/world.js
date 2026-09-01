import { TILE, SOLID_DECOR, decorPlacement } from '../assets/manifest.js';
import { RNG } from '../core/rng.js';
import { clamp, dist, dist2, TAU, retain, nextId } from '../core/util.js';
import { bus } from '../core/events.js';
import { generateFloor, BLOCKING_PROPS } from '../gen/dungeon.js';
import { FlowField, updateMonster } from './ai.js';
import {
  createPlayer, createMonster, createNpc, createProjectile, createPickup,
  setAnim, advanceAnim, applyBuff as applyBuffTo, tickBuffs, damageTakenMult,
  movementMult, isStunned, TEAM, NPC_TINTS,
} from './entities.js';
import { recomputeStats, mitigate, rollDamage, xpToNext, MAX_LEVEL } from './stats.js';
import { getClass } from './classes.js';
import { getAbility } from './abilities.js';
import { MONSTERS, poolForFloor, bossForFloor, levelForSpawn } from './monsters.js';
import {
  rollLoot, rollEquipment, makeConsumable, rollShopStock, CONSUMABLES,
  INVENTORY_SIZE, consumableCooldownKey,
} from './items.js';

/**
 * The simulation.
 *
 * On the host this runs everything. On a client it runs only presentation
 * (interpolation, particles, local movement prediction) and takes authoritative
 * positions from snapshots - so there is no second copy of the AI to desync.
 *
 * All of the verbs abilities and monsters call live on this class; that small
 * surface is deliberately the only way anything affects the world.
 */

export const FLOOR_COUNT = 10;

const CELL = 96; // spatial hash cell size in pixels

/** Effects worth the bandwidth to mirror; hit sparks are re-derived from damage. */
const NETWORKED_FX = new Set(['slash', 'thrust', 'stab', 'blast', 'sheet', 'ward', 'spin',
  'chain', 'spikes', 'heal', 'gather']);

// How far the rock rim art bleeds over the floor on each side of a wall, in px.
// Mirrors the offsets in gen/autotile.js drawRim().
const RIM_N = 18;   // rock face hanging down from the wall above
const RIM_S = 16;
const RIM_W = 16;

/** How long you must hold the descent marker, and how close you must stand. */
export const DESCENT_TIME = 10;
const DESCENT_RADIUS = 44;

/** Traps within this distance of a player become visible. */
const TRAP_REVEAL_RANGE = 150;

/** Monsters within this distance are added to the compendium - roughly what
 *  fits on screen, so an entry means you actually saw the thing. */
const CODEX_RANGE = 310;

/** Trap kinds that survive being triggered and re-arm; the rest are one-shot. */
const PERSISTENT_TRAPS = new Set(['flame', 'poison']);

export class World {
  /** @param {{ seed:string, isHost:boolean }} opts */
  constructor({ seed, isHost = true }) {
    this.seed = seed;
    this.isHost = isHost;
    this.rng = new RNG(seed + ':runtime');
    this.floorNo = 0;
    this.dungeon = null;
    this.flow = null;

    this.players = [];
    this.monsters = [];
    this.npcs = [];
    this.projectiles = [];
    this.pickups = [];
    this.zones = [];
    this.telegraphs = [];
    this.fx = [];
    this.floaters = [];
    this.timers = [];
    this.removedIds = [];

    this.byId = new Map();
    this.grid = new Map();

    this.explored = null;
    this.blocked = null;

    this.time = 0;
    this.runTime = 0;
    this.shakeAmount = 0;
    this.events = [];      // network/UI events produced this tick
    this.log = [];         // player-visible message log
    // Only mirrored to the network when a run is actually multiplayer; a solo
    // host would otherwise build an event list nobody reads.
    this.netActive = false;
    this.localPlayer = null;
    this.listener = null;
    this.animCheck = null;

    /** Descent channel state; see updateDescent(). */
    this.descent = { playerId: null, progress: 0, flash: 0 };

    /** What the party has seen this run - drives the Compendium tab. */
    this.codex = { monsters: [], traps: [] };
    this.state = 'playing'; // playing | descending | victory | defeat
    this.partyGold = 0;

    /** Dev-console cheats. Off in every normal run; see ui #screen-dev. */
    this.debug = { god: false, speed: false, noclip: false, oneHit: false };
  }

  // -------------------------------------------------------------------------
  // Floor lifecycle
  // -------------------------------------------------------------------------

  /** Build floor `n`. Deterministic given the world seed. */
  loadFloor(n, { keepPlayers = true } = {}) {
    this.floorNo = n;
    this.dungeon = generateFloor(this.seed, n, Math.max(1, this.players.length));
    this.flow = new FlowField(this.dungeon);

    this.monsters = [];
    this.npcs = [];
    this.projectiles = [];
    this.pickups = [];
    this.zones = [];
    this.telegraphs = [];
    this.fx = [];
    this.floaters = [];
    this.timers = [];
    this.removedIds = [];
    this.byId = new Map();
    this.descent = { playerId: null, progress: 0, flash: 0 };
    this.state = 'playing';

    const d = this.dungeon;
    this.explored = new Uint8Array(d.w * d.h);
    this.rebuildBlocked();

    const spawn = d.tileCenter(d.entrance.x, d.entrance.y);
    for (const p of this.players) {
      this.byId.set(p.id, p);
      if (keepPlayers) {
        // Everyone gets back up between floors; the descent is the checkpoint.
        p.dead = false;
        p.downed = false;
        p.spectating = null;
        p.hp = Math.max(p.hp, p.stats.maxHp * 0.5);
        p.mp = Math.max(p.mp, p.stats.maxMp * 0.5);
      }
      const jitter = this.rng.float(0, TAU);
      const want = {
        x: spawn.x + Math.cos(jitter) * this.rng.float(0, 30),
        y: spawn.y + Math.sin(jitter) * this.rng.float(0, 30),
      };
      // The generator picks an open tile, but props and the rock rim can still
      // make a specific pixel illegal - and a player who spawns inside geometry
      // cannot move in any direction at all.
      const spot = this.findStandableSpot(want.x, want.y, p, 8) || spawn;
      p.x = spot.x;
      p.y = spot.y;
      p.px = p.x; p.py = p.y;
      p.vx = 0; p.vy = 0;
    }

    if (this.isHost) {
      this.spawnMonsters();
      this.spawnNpcs();
    }

    this.pushLog(`Floor ${n} - ${d.theme.name}`, '#ffd27f');
    bus.emit('floor:loaded', this);
    return d;
  }

  /**
   * Build the movement-blocking mask.
   *
   * Props are anchored bottom-left and can be several tiles across, so every
   * tile the art actually covers is blocked - marking only the anchor is what
   * let players stand on top of boulders and chests.
   */
  /**
   * Build the movement-blocking geometry.
   *
   * Props collide as rectangles, not tiles. A boulder is 90px wide on a 48px
   * grid, so a tile mask either lets you stand on its corners or blocks a 3x2
   * area for a 2x2 rock - neither reads right. The rects are bucketed by tile
   * so a step test only ever looks at a handful.
   *
   * `blocked` is still maintained at tile granularity for the coarse checks
   * (spawn validity, pathing hints); the rects are what movement uses.
   */
  rebuildBlocked() {
    const d = this.dungeon;
    this.blocked = new Uint8Array(d.w * d.h);
    for (let i = 0; i < d.tiles.length; i++) this.blocked[i] = d.tiles[i] ? 0 : 1;

    this.solidRects = [];
    this.rectBuckets = new Map();

    const addRect = (x, y, w, h) => {
      const rect = { x, y, w, h };
      this.solidRects.push(rect);
      const tx0 = Math.floor(x / TILE), tx1 = Math.floor((x + w) / TILE);
      const ty0 = Math.floor(y / TILE), ty1 = Math.floor((y + h) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (!d.inBounds(tx, ty)) continue;
          const key = ty * d.w + tx;
          let list = this.rectBuckets.get(key);
          if (!list) this.rectBuckets.set(key, (list = []));
          list.push(rect);
          this.blocked[key] = 1;
        }
      }
    };

    for (const dec of d.decor) {
      if (!dec.solid && !SOLID_DECOR.has(dec.kind)) continue;
      const pl = decorPlacement(dec.kind, dec.x, dec.y);
      if (!pl) continue;
      // Inset a little: sprite edges are soft, and the collision box reading
      // slightly smaller than the art is far kinder than the reverse.
      const ix = pl.sw * 0.12, iy = pl.sh * 0.12;
      addRect(pl.dx + ix, pl.dy + iy, pl.sw - ix * 2, pl.sh - iy * 2);
    }

    // You should have to stand next to these to use them, not on top of them.
    // `noBlock` is set by the generator on the rare prop that would otherwise
    // seal a passage - see pruneBlockingProps().
    for (const prop of d.props) {
      if (!BLOCKING_PROPS.has(prop.type) || prop.noBlock) continue;
      addRect(prop.x * TILE + 8, prop.y * TILE + 8, TILE - 16, TILE - 16);
    }
  }

  /** Does an actor's body at (x, y) overlap a solid prop rectangle? */
  hitsSolidRect(a, x, y) {
    if (!this.rectBuckets) return false;
    const d = this.dungeon;
    const r = a.radius * 0.72;
    const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
    const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const list = this.rectBuckets.get(ty * d.w + tx);
        if (!list) continue;
        for (const q of list) {
          if (x + r > q.x && x - r < q.x + q.w && y + r > q.y && y - r < q.y + q.h) return true;
        }
      }
    }
    return false;
  }

  spawnMonsters() {
    const d = this.dungeon;
    const pool = poolForFloor(this.floorNo);
    const bossDef = bossForFloor(this.floorNo);

    for (const s of d.spawns) {
      let monsterId, level, boss = null;
      if (s.boss) {
        boss = bossDef;
        monsterId = bossDef.base;
        level = levelForSpawn(this.floorNo, s.depth, true, true);
      } else {
        // Deeper rooms bias the roll toward the heavier end of the pool.
        const biased = pool.map((e) => ({
          m: e.m,
          weight: e.weight * (1 + Math.max(0, s.tierBias - 4) * 0.12 * (e.m.floors[0] >= this.floorNo - 1 ? 2 : 1)),
        }));
        monsterId = this.rng.weighted(biased, (e) => e.weight).m.id;
        level = levelForSpawn(this.floorNo, s.depth, s.elite, false);
      }
      const pos = d.tileCenter(s.x, s.y);
      const m = createMonster({ monsterId, level, elite: s.elite, boss, x: pos.x, y: pos.y, rng: this.rng });
      // Big monsters and props can make a nominally-open spawn tile unusable.
      const spot = this.findStandableSpot(pos.x, pos.y, m);
      if (!spot) continue;
      m.x = spot.x; m.y = spot.y;
      m.roomId = s.roomId;
      m.guard = !!s.guard;
      if (boss) {
        // A boss fought by four people should not melt in a quarter of the time.
        const partyScale = 1 + (this.players.length - 1) * 0.55;
        m.stats.maxHp = Math.round(m.stats.maxHp * partyScale);
        m.hp = m.stats.maxHp;
      }
      this.addMonster(m, false);   // the floor manifest already lists these
    }
  }

  spawnNpcs() {
    const d = this.dungeon;
    // Idempotent: a client may re-apply a floor manifest for the floor it is
    // already on, and we must not end up with two of every merchant.
    for (const old of this.npcs) this.byId.delete(old.id);
    this.npcs = [];
    // Seeded independently of the runtime RNG so a client can regenerate the
    // identical shop inventory without the host having to ship it.
    const shopRng = this.shopRng();
    for (const prop of d.props) {
      if (prop.type !== 'merchant') continue;
      const sprites = ['priest', 'soldier', 'wizard', 'archer', 'knight'];
      const pos = d.tileCenter(prop.x, prop.y);
      const npc = createNpc({
        role: 'merchant',
        spriteId: shopRng.pick(sprites),
        tint: shopRng.pick(NPC_TINTS),
        name: shopRng.pick(['Corvin', 'Mother Aslan', 'Old Tam', 'Sabine', 'The Tinker', 'Grix']),
        x: pos.x, y: pos.y,
        stock: rollShopStock(shopRng, this.floorNo),
      });
      this.npcs.push(npc);
      this.byId.set(npc.id, npc);
      prop.npcId = npc.id;
    }
  }

  /** Deterministic generator for merchant inventories on this floor. */
  shopRng() {
    return new RNG(`${this.seed}:shop:${this.floorNo}`);
  }

  /**
   * @param {object} m
   * @param {boolean} [announce] false while populating a floor, where the
   *   manifest already describes every monster and per-monster events would be
   *   a few hundred redundant messages.
   */
  addMonster(m, announce = true) {
    this.monsters.push(m);
    this.byId.set(m.id, m);
    // Splits and summons are born after the floor manifest went out, so without
    // this a client never learns they exist: a boss's bats and a slime's
    // children would hit people who could not see them, and the snapshot rows
    // for them would be dropped for want of a matching id.
    if (announce && this.isHost && this.netActive) {
      this.emitEvent({
        t: 'spawn',
        id: m.id, k: m.monsterId, lv: m.level,
        e: m.elite ? 1 : 0, b: m.boss || 0,
        x: Math.round(m.x), y: Math.round(m.y),
        hp: Math.round(m.stats.maxHp), r: m.roomId ?? -1, n: m.name,
        sc: +(m.scale || 1).toFixed(2), rad: Math.round(m.radius),
      });
    }
    return m;
  }

  addPlayer(opts) {
    const p = createPlayer(opts);
    this.players.push(p);
    this.byId.set(p.id, p);
    this.giveStartingKit(p);
    return p;
  }

  giveStartingKit(p) {
    const cls = getClass(p.classId);
    const rng = this.rng.fork('kit:' + p.id);
    for (const [slot, spec] of Object.entries(cls.startingGear || {})) {
      const item = rollEquipment(rng, { floor: 1, family: spec.family, tier: spec.tier, rarity: 'common' });
      item.slot = slot === 'offhand' ? 'offhand' : item.slot;
      p.equipment[slot] = item;
    }
    for (const [id, qty] of Object.entries(cls.startingPotions || {})) {
      p.inventory.push(makeConsumable(id, qty));
    }
    p.gold = 40;
    recomputeStats(p, cls);
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------

  update(dt, intents) {
    this.time += dt;
    this.runTime += dt;
    this.snapshotPrevious();
    if (this.shakeAmount > 0) this.shakeAmount = Math.max(0, this.shakeAmount - dt * 30);

    this.rebuildGrid();

    for (const p of this.players) this.updatePlayer(p, intents?.get(p.id), dt);

    if (this.isHost) {
      this.flow.timer -= dt;
      if (this.flow.timer <= 0) {
        this.flow.timer = 0.28;
        this.flow.rebuild(this.players.filter((p) => !p.dead && !p.downed));
      }
      for (const m of this.monsters) {
        if (!m.dead) updateMonster(this, m, dt);
        this.integrate(m, dt);
        advanceAnim(m, dt);
        tickBuffs(m, dt);
        this.tickDots(m, dt);
        if (m.dead && m.deathTimer > 30) m.expired = true;
      }
      retain(this.monsters, (m) => {
        if (m.expired) {
          this.byId.delete(m.id);
          // Clients cannot tell "gone" from "too far to send", so removals have
          // to be stated. Without this a corpse the host has cleaned up stays
          // on every client's floor for the rest of the run.
          this.removedIds.push(m.id);
          return false;
        }
        return true;
      });

      this.updateProjectiles(dt);
      this.updateZones(dt);
      this.updateTelegraphs(dt);
      this.updateTraps(dt);
      this.updateDescent(dt, intents);
    } else {
      for (const m of this.monsters) advanceAnim(m, dt);
      this.interpolateNet(dt);
      this.updateProjectilesVisual(dt);
      // Telegraphs are replaced wholesale by each snapshot, but they have to
      // keep filling in between them or the warning would visibly stutter.
      for (const t of this.telegraphs) t.t += dt;
    }

    for (const n of this.npcs) advanceAnim(n, dt);

    this.updateTrapVisibility(dt);
    this.updateCodex();
    this.updateTimers(dt);
    this.updateFx(dt);
    this.updatePickups(dt);
    this.revealFog();
  }

  /**
   * Client-side smoothing. Snapshots arrive at 20 Hz but we render at 60+, so
   * every networked body eases toward its last authoritative position instead
   * of stepping. Facing is left alone - it is already sent every snapshot and
   * blending it would make aim look mushy.
   */
  interpolateNet(dt) {
    const k = Math.min(1, dt * 16);
    for (const m of this.monsters) {
      if (m.tx == null) continue;
      m.x += (m.tx - m.x) * k;
      m.y += (m.ty - m.y) * k;
    }
    for (const p of this.players) {
      if (p === this.localPlayer || p.netX == null) continue;
      p.x += (p.netX - p.x) * k;
      p.y += (p.netY - p.y) * k;
    }
  }

  /**
   * Stash every body's position before it moves.
   *
   * The simulation runs at a fixed 60 Hz while rendering runs at the display
   * rate, so without this a 144 Hz monitor draws the same position for two
   * frames then jumps - which is exactly the movement jitter you see. The
   * renderer blends prev -> current by the loop's leftover alpha.
   */
  snapshotPrevious() {
    for (const p of this.players) { p.px = p.x; p.py = p.y; }
    for (const m of this.monsters) { m.px = m.x; m.py = m.y; }
    for (const pr of this.projectiles) { pr.px = pr.x; pr.py = pr.y; }
  }

  updateTimers(dt) {
    for (const t of this.timers) t.t -= dt;
    const fired = this.timers.filter((t) => t.t <= 0);
    retain(this.timers, (t) => t.t > 0);
    for (const t of fired) t.fn(this);
  }

  updateFx(dt) {
    for (const f of this.fx) { f.t += dt; }
    retain(this.fx, (f) => f.t < f.life);
    for (const f of this.floaters) {
      f.t += dt;
      f.y -= dt * 34;
    }
    retain(this.floaters, (f) => f.t < f.life);
  }

  updatePickups(dt) {
    for (const p of this.pickups) {
      p.age += dt;
      p.bob += dt * 3;
    }
    if (!this.isHost) return;
    for (const p of this.pickups) {
      if (p.dead) continue;
      for (const pl of this.players) {
        if (pl.dead || pl.downed) continue;
        // Whoever dropped this cannot hoover it straight back up - they have to
        // step away first. That is what makes right-click-drop a way to hand an
        // item to a teammate rather than a no-op.
        if (p.dropperId === pl.id && !p.armed) {
          if (dist2(p.x, p.y, pl.x, pl.y) > 70 * 70) p.armed = true;
          continue;
        }
        if (dist2(p.x, p.y, pl.x, pl.y) < 34 * 34) {
          this.collect(pl, p);
          break;
        }
      }
    }
    retain(this.pickups, (p) => !p.dead);
  }

  // -------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------

  updatePlayer(p, intent, dt) {
    advanceAnim(p, dt);
    if (p.hitFlash > 0) p.hitFlash -= dt;
    if (p.invuln > 0) p.invuln -= dt;

    if (p.downed) {
      p.vx *= 0.8; p.vy *= 0.8;
      setAnim(p, 'death', { loop: false, fps: 8 });
      this.integrate(p, dt);
      return;
    }

    tickBuffs(p, dt);
    this.tickDots(p, dt);
    recomputeStats(p, getClass(p.classId));

    // Regeneration is slow enough that potions still matter.
    p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.hpRegen * dt);
    p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.mpRegen * dt);

    p.attackCd = Math.max(0, p.attackCd - dt);
    if (p.noManaFlash > 0) p.noManaFlash -= dt;
    p.dashCd = Math.max(0, p.dashCd - dt);
    for (const k in p.cooldowns) p.cooldowns[k] = Math.max(0, p.cooldowns[k] - dt);

    if (p.windup > 0) {
      p.windup -= dt;
      if (p.windup <= 0 && p.pendingAttack) {
        const fn = p.pendingAttack;
        p.pendingAttack = null;
        fn();
      }
    }

    if (!intent) {
      p.vx *= 0.82; p.vy *= 0.82;
      this.integrate(p, dt);
      return;
    }

    p.aim = intent.aim;
    const stunned = isStunned(p);
    const moveMult = movementMult(p);
    const speed = p.stats.moveSpeed * moveMult * (p.windup > 0 ? 0.45 : 1) * (this.debug.speed ? 3 : 1);

    if (!stunned && (intent.mx || intent.my)) {
      // Snappy, near-instant acceleration - this is an action game, not a sim.
      const ax = intent.mx * speed;
      const ay = intent.my * speed;
      const k = clamp(dt * 22, 0, 1);
      p.vx += (ax - p.vx) * k;
      p.vy += (ay - p.vy) * k;
      if (p.animLock <= 0) setAnim(p, 'walk', { loop: true, fps: 12 });
      p.facing = Math.atan2(p.vy, p.vx);
    } else {
      const k = clamp(dt * 26, 0, 1);
      p.vx += (0 - p.vx) * k;
      p.vy += (0 - p.vy) * k;
      if (p.animLock <= 0) setAnim(p, 'idle', { loop: true, fps: 9 });
    }
    // Aim wins over movement for facing, so shots always go where you point.
    if (!stunned) p.facing = intent.aim;

    if (!stunned && intent.dash && p.dashCd <= 0 && (intent.mx || intent.my)) {
      p.dashCd = 2.2;
      const a = Math.atan2(intent.my, intent.mx);
      this.startDash(p, a, 620, 0.09, null);
      p.invuln = Math.max(p.invuln, 0.22);
      this.sfxAt(p.x, p.y, 'dash');
    }

    if (!stunned && intent.attack && p.attackCd <= 0 && p.windup <= 0) {
      this.useAbility(p, getClass(p.classId).basicAttack, intent);
    }
    if (!stunned) {
      for (let i = 0; i < 4; i++) {
        if (intent.slots[i] && p.hotbar[i]) this.useAbility(p, p.hotbar[i], intent);
      }
    }
    if (intent.useHp) this.useQuickItem(p, p.quickHeal);
    if (intent.useMp) this.useQuickItem(p, p.quickMana);
    if (intent.interact) this.interact(p);

    this.integrate(p, dt);
    this.checkTraps(p);
  }

  useAbility(p, abilityId, intent) {
    const ab = getAbility(abilityId);
    if (!ab) return false;
    const cd = p.cooldowns[abilityId] || 0;
    if (cd > 0) return false;
    if (ab.mana > 0 && p.mp < ab.mana && !this.debug.god) {
      // Basics are retried every frame the button is held, so their warning is
      // throttled - otherwise an empty bar buries the screen in float text.
      if (!ab.basic) {
        this.floatText(p.x, p.y - 30, 'No mana', '#7fa8ff');
      } else if ((p.noManaFlash || 0) <= 0) {
        p.noManaFlash = 1.1;
        this.floatText(p.x, p.y - 30, 'No mana', '#7fa8ff');
        this.sfxAt(p.x, p.y, 'error');
      }
      return false;
    }

    const aimDist = 260;
    const ctx = {
      world: this,
      actor: p,
      aim: intent ? intent.aim : p.facing,
      aimX: intent?.aimX ?? p.x + Math.cos(p.facing) * aimDist,
      aimY: intent?.aimY ?? p.y + Math.sin(p.facing) * aimDist,
      rng: () => this.rng.next(),
    };

    // Basic attacks resolve on a wind-up so the swing animation lines up with
    // the hitbox; utility spells fire instantly for responsiveness.
    const windup = ab.basic ? 0.09 : 0;
    const run = () => {
      const result = ab.cast(ctx);
      if (result === false) return;
    };

    if (ab.basic) {
      p.attackCd = ab.cooldown / p.stats.attackSpeed;
      const swings = ab.swings || ['attack'];
      const key = swings[p.swingIndex % swings.length];
      p.swingIndex++;
      setAnim(p, this.hasHeroAnim(p.classId, key) ? key : 'attack', {
        loop: false, fps: 18, lock: p.attackCd * 0.85,
      });
    } else {
      p.cooldowns[abilityId] = ab.cooldown * p.stats.cooldownMult;
      if (ab.anim) setAnim(p, this.hasHeroAnim(p.classId, ab.anim) ? ab.anim : 'attack', { loop: false, fps: 16, lock: 0.45 });
      this.emitEvent({ t: 'ability', id: p.id, a: abilityId });
    }
    if (ab.mana > 0 && !this.debug.god) p.mp -= ab.mana;

    if (windup > 0) {
      p.windup = windup;
      p.pendingAttack = run;
    } else {
      run();
    }
    return true;
  }

  useQuickItem(p, consumableId) {
    const slot = p.inventory.find((i) => i.type === 'consumable' && i.id === consumableId && i.qty > 0);
    if (!slot) {
      this.floatText(p.x, p.y - 30, 'None left', '#aaa');
      return false;
    }
    return this.consume(p, slot);
  }

  consume(p, slot) {
    const def = CONSUMABLES[slot.id];
    if (!def) return false;

    // Potions share a cooldown per kind, so a stack of twenty is not a second
    // health bar you can chug through mid-fight.
    const cdKey = consumableCooldownKey(slot.id);
    const remaining = this.debug.god ? 0 : (p.cooldowns[cdKey] || 0);
    if (remaining > 0) {
      this.floatText(p.x, p.y - 34, `${remaining.toFixed(1)}s`, '#ff9060');
      this.sfxAt(p.x, p.y, 'error');
      return false;
    }

    const ok = def.use(this, p);
    if (ok === false) return false;
    if (def.cooldown) p.cooldowns[cdKey] = def.cooldown;
    slot.qty--;
    if (slot.qty <= 0) retain(p.inventory, (i) => i !== slot);
    this.sfxAt(p.x, p.y, 'drink');
    this.emitEvent({ t: 'consume', id: p.id, item: slot.id });
    return true;
  }

  // -------------------------------------------------------------------------
  // Movement and collision
  // -------------------------------------------------------------------------

  integrate(a, dt) {
    if (a.dash) {
      a.dash.t -= dt;
      if (a.dash.t <= 0) {
        a.dash = null;
      } else {
        a.vx = Math.cos(a.dash.angle) * a.dash.speed;
        a.vy = Math.sin(a.dash.angle) * a.dash.speed;
        if (a.dash.payload) this.dashHitCheck(a, dt);
      }
    }
    if (a.knock) {
      a.knock.t -= dt;
      if (a.knock.t <= 0) a.knock = null;
    }

    const nx = a.x + a.vx * dt;
    const ny = a.y + a.vy * dt;
    // Axis-separated so sliding along a wall feels smooth instead of sticky.
    if (this.canStep(a, nx, a.y)) a.x = nx; else a.vx *= -0.15;
    if (this.canStep(a, a.x, ny)) a.y = ny; else a.vy *= -0.15;
  }

  /**
   * Circle-vs-tile test at a candidate position.
   *
   * As well as solid tiles and props, this keeps bodies out of the rock rim
   * that the renderer bleeds over the edges of floor tiles - without it you can
   * stand inside the wall art. The inset is only applied when the *opposite*
   * side of the tile is open floor, so a one-tile-wide corridor never becomes
   * impassable, and very large monsters skip it so bosses cannot wedge in a
   * doorway.
   */
  canStep(a, x, y) {
    const r = a.radius * 0.72;
    const d = this.dungeon;
    if (!d) return true;
    if (this.debug.noclip && a.kind === 'player') {
      return x > 0 && y > 0 && x < d.w * TILE && y < d.h * TILE;
    }
    const check = (px, py) => {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      if (tx < 0 || ty < 0 || tx >= d.w || ty >= d.h) return true;
      return d.tiles[ty * d.w + tx] === 0;
    };
    if (check(x - r, y - r) || check(x + r, y - r) || check(x - r, y + r) || check(x + r, y + r) || check(x, y)) {
      return false;
    }
    if (!a.flying && this.hitsSolidRect(a, x, y)) return false;

    // Rim test, applied to the body centre only. Testing the whole hitbox would
    // reject nearly every tile that touches a wall and carve the floor to
    // pieces; keeping it to the centre means a tile that is walkable at all
    // stays walkable, so this can never disconnect the dungeon. Each inset is
    // also skipped unless the opposite side is open floor, so one-tile
    // passages keep their full width.
    if (a.flying || a.radius > 24) return true;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const lx = x - tx * TILE;
    const ly = y - ty * TILE;
    if (ly < RIM_N && d.isSolid(tx, ty - 1) && d.isFloor(tx, ty + 1)) return false;
    if (ly > TILE - RIM_S && d.isSolid(tx, ty + 1) && d.isFloor(tx, ty - 1)) return false;
    if (lx < RIM_W && d.isSolid(tx - 1, ty) && d.isFloor(tx + 1, ty)) return false;
    if (lx > TILE - RIM_W && d.isSolid(tx + 1, ty) && d.isFloor(tx - 1, ty)) return false;
    return true;
  }

  /**
   * Nearest position an actor of this size can legally stand, searching
   * outward from (x, y). Used whenever something is created at a position that
   * might be inside geometry - split slimes, summons, relocations.
   */
  findStandableSpot(x, y, actorLike, maxRadius = 6) {
    if (this.canStep(actorLike, x, y)) return { x, y };
    for (let ring = 1; ring <= maxRadius; ring++) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const px = x + Math.cos(a) * ring * TILE * 0.6;
        const py = y + Math.sin(a) * ring * TILE * 0.6;
        if (this.canStep(actorLike, px, py)) return { x: px, y: py };
      }
    }
    return null;
  }

  hasLineOfSight(x0, y0, x1, y1) {
    const d = this.dungeon;
    const steps = Math.ceil(dist(x0, y0, x1, y1) / (TILE * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      if (d.isSolid(Math.floor(px / TILE), Math.floor(py / TILE))) return false;
    }
    return true;
  }

  startDash(a, angle, speed, duration, payload) {
    a.dash = { angle, speed, t: duration, payload, hits: new Set() };
  }

  dashHitCheck(a, dt) {
    this.forEachNear(a.x, a.y, a.radius + 30, (other) => {
      if (other.team === a.team || other.dead) return;
      if (a.dash.hits.has(other.id)) return;
      if (dist2(a.x, a.y, other.x, other.y) > (a.radius + other.radius + 6) ** 2) return;
      a.dash.hits.add(other.id);
      const p = a.dash.payload;
      this.dealDamage({
        source: a, target: other, amount: p.damage, type: p.type,
        knockback: p.knockback, angle: a.dash.angle,
      });
    });
  }

  blink(a, angle, maxDist) {
    let best = { x: a.x, y: a.y };
    const steps = Math.ceil(maxDist / 12);
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * maxDist;
      const px = a.x + Math.cos(angle) * t;
      const py = a.y + Math.sin(angle) * t;
      if (!this.canStep(a, px, py)) break;
      best = { x: px, y: py };
    }
    this.spawnFx('ward', a.x, a.y, { color: '#a8b8ff', radius: a.radius * 1.8, life: 0.3 });
    a.x = best.x; a.y = best.y;
    a.vx = 0; a.vy = 0;
    this.spawnFx('ward', a.x, a.y, { color: '#a8b8ff', radius: a.radius * 1.8, life: 0.3 });
  }

  // -------------------------------------------------------------------------
  // Spatial queries
  // -------------------------------------------------------------------------

  rebuildGrid() {
    this.grid.clear();
    const add = (a) => {
      if (a.dead && a.kind === 'monster') return;
      const key = ((a.y / CELL) | 0) * 100000 + ((a.x / CELL) | 0);
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(a);
    };
    for (const p of this.players) if (!p.dead) add(p);
    for (const m of this.monsters) add(m);
    for (const n of this.npcs) add(n);
  }

  forEachNear(x, y, radius, fn) {
    const c0x = ((x - radius) / CELL) | 0, c1x = ((x + radius) / CELL) | 0;
    const c0y = ((y - radius) / CELL) | 0, c1y = ((y + radius) / CELL) | 0;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const list = this.grid.get(cy * 100000 + cx);
        if (!list) continue;
        for (const a of list) fn(a);
      }
    }
  }

  /** Closest living hostile to a point - used by homing projectiles and chains. */
  nearestEnemy(x, y, team, radius) {
    let best = null, bestD = radius * radius;
    this.forEachNear(x, y, radius, (t) => {
      if (t.dead || t.downed || t.team === team || t.kind === 'npc') return;
      const d = dist2(x, y, t.x, t.y);
      if (d < bestD) { bestD = d; best = t; }
    });
    return best;
  }

  actorById(id) { return this.byId.get(id) || null; }
  monsterCount() { return this.monsters.reduce((n, m) => n + (m.dead ? 0 : 1), 0); }

  livePlayers() { return this.players.filter((p) => !p.dead && !p.downed); }

  // -------------------------------------------------------------------------
  // Combat verbs (the ability API)
  // -------------------------------------------------------------------------

  melee(actor, opts) {
    const { range, arc, coef, power, type, knockback } = opts;
    if (opts.sfx) this.sfxAt(actor.x, actor.y, opts.sfx);
    // The effect traces the actual hitbox, so a long narrow thrust looks like
    // reach and a wide sweep looks like a sweep.
    this.spawnFx(opts.fx || 'slash', actor.x, actor.y, {
      angle: actor.facing, arc, radius: range, life: opts.fx === 'thrust' ? 0.2 : 0.16,
      color: type === 'phys' ? '#ffffff' : '#ffd48a',
    });

    const stat = actor.stats[power] ?? actor.stats.attackPower;
    let hits = 0;
    this.forEachNear(actor.x, actor.y, range + 30, (t) => {
      if (t === actor || t.dead || t.team === actor.team || t.kind === 'npc') return;
      const dd = dist(actor.x, actor.y, t.x, t.y);
      if (dd > range + t.radius) return;
      const a = Math.atan2(t.y - actor.y, t.x - actor.x);
      if (arc < TAU - 0.01) {
        let delta = Math.abs(((a - actor.facing + Math.PI * 3) % TAU) - Math.PI);
        if (delta > arc / 2) return;
      }
      const roll = rollDamage(stat, coef, actor.stats.critChance || 0, actor.stats.critMult || 1.5, () => this.rng.next());
      this.dealDamage({
        source: actor, target: t, amount: roll.amount, crit: roll.crit,
        type, knockback, angle: a, effects: opts.effects,
      });
      opts.onHit?.(this, actor, t, roll.amount);
      hits++;
    });
    return hits;
  }

  monsterMelee(m, opts) {
    this.spawnFx('slash', m.x, m.y, {
      angle: m.facing, arc: opts.arc, radius: opts.range, life: 0.16, color: '#ff8060',
    });
    this.forEachNear(m.x, m.y, opts.range + 30, (t) => {
      if (t.kind !== 'player' || t.dead || t.downed) return;
      const dd = dist(m.x, m.y, t.x, t.y);
      if (dd > opts.range + t.radius) return;
      const a = Math.atan2(t.y - m.y, t.x - m.x);
      let delta = Math.abs(((a - m.facing + Math.PI * 3) % TAU) - Math.PI);
      if (delta > opts.arc / 2) return;
      this.dealDamage({
        source: m, target: t, amount: opts.damage, type: opts.type,
        knockback: opts.knockback, angle: a,
      });
    });
  }

  fireProjectile(actor, opts) {
    const stat = actor.stats[opts.power] ?? actor.stats.attackPower;
    const roll = rollDamage(stat, opts.coef, actor.stats.critChance || 0, actor.stats.critMult || 1.5, () => this.rng.next());
    if (opts.sfx) this.sfxAt(actor.x, actor.y, opts.sfx);
    const offset = actor.radius + 8;
    const pr = createProjectile({
      ownerId: actor.id,
      team: actor.team,
      x: actor.x + Math.cos(opts.angle) * offset,
      y: actor.y + Math.sin(opts.angle) * offset,
      angle: opts.angle,
      speed: opts.speed,
      radius: opts.radius,
      range: opts.range,
      damage: roll.amount,
      crit: roll.crit,
      type: opts.type,
      sprite: opts.sprite,
      glow: opts.glow,
      scale: opts.scale,
      pierce: opts.pierce,
      homing: opts.homing,
      knockback: opts.knockback,
      explode: opts.explode ? { ...opts.explode, power: opts.power } : null,
      effects: opts.effects,
      onHit: opts.onHit,
    });
    pr.crit = roll.crit;
    this.projectiles.push(pr);
    return pr;
  }

  spawnMonsterProjectile(m, opts) {
    const pr = createProjectile({
      ownerId: m.id,
      team: m.team,
      x: m.x + Math.cos(opts.angle) * (m.radius + 6),
      y: m.y + Math.sin(opts.angle) * (m.radius + 6),
      angle: opts.angle,
      speed: opts.speed,
      radius: opts.radius ?? 8,
      range: opts.range ?? 400,
      damage: opts.damage,
      type: opts.type,
      sprite: opts.sprite,
      glow: opts.glow,
      homing: opts.homing,
      knockback: 40,
    });
    this.projectiles.push(pr);
    return pr;
  }

  updateProjectiles(dt) {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      pr.life += dt;

      if (pr.homing) {
        const target = this.nearestEnemy(pr.x, pr.y, pr.team, 340);
        if (target) {
          const want = Math.atan2(target.y - pr.y, target.x - pr.x);
          let delta = ((want - pr.angle + Math.PI * 3) % TAU) - Math.PI;
          pr.angle += clamp(delta, -pr.homing * dt, pr.homing * dt);
          pr.vx = Math.cos(pr.angle) * pr.speed;
          pr.vy = Math.sin(pr.angle) * pr.speed;
        }
      }

      const step = Math.hypot(pr.vx, pr.vy) * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.travelled += step;

      if (pr.travelled > pr.range) { this.endProjectile(pr, false); continue; }
      if (this.dungeon.solidAtPixel(pr.x, pr.y)) { this.endProjectile(pr, true); continue; }

      let consumed = false;
      this.forEachNear(pr.x, pr.y, pr.radius + 26, (t) => {
        if (consumed || t.dead || t.team === pr.team || t.kind === 'npc') return;
        if (t.id === pr.ownerId) return;
        if (pr.hits.has(t.id)) return;
        if (dist2(pr.x, pr.y, t.x, t.y) > (pr.radius + t.radius) ** 2) return;
        pr.hits.add(t.id);
        const owner = this.actorById(pr.ownerId);
        this.dealDamage({
          source: owner || { team: pr.team, stats: {}, kind: 'monster' },
          target: t, amount: pr.damage, crit: pr.crit, type: pr.type,
          knockback: pr.knockback, angle: pr.angle, effects: pr.effects,
        });
        pr.onHit?.(this, owner, t, pr.damage);
        if (pr.pierce > 0) pr.pierce--;
        else { this.endProjectile(pr, true); consumed = true; }
      });
    }
    retain(this.projectiles, (p) => !p.dead);
  }

  /** Clients still move projectiles so they look smooth between snapshots. */
  updateProjectilesVisual(dt) {
    for (const pr of this.projectiles) {
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life += dt;
    }
    retain(this.projectiles, (p) => p.life < 4 && !p.dead);
  }

  endProjectile(pr, impacted) {
    pr.dead = true;
    if (pr.explode) {
      const owner = this.actorById(pr.ownerId);
      this.explode(owner, pr.x, pr.y, {
        radius: pr.explode.radius,
        coef: pr.explode.coef,
        power: pr.explode.power,
        type: pr.type,
        color: pr.explode.color,
        fx: pr.explode.fx,
        effects: pr.effects,
        knockback: 120,
        sfx: 'boom',
      });
    } else if (impacted) {
      this.spawnFx('impact', pr.x, pr.y, { color: pr.glow || '#ffffff', radius: pr.radius * 1.6, life: 0.2 });
    }
  }

  explode(actor, x, y, opts) {
    const stat = actor?.stats?.[opts.power] ?? actor?.stats?.spellPower ?? 10;
    this.spawnFx(opts.fx ? 'sheet' : 'blast', x, y, {
      color: opts.color || '#ffb060', radius: opts.radius, life: opts.fx ? 0.5 : 0.32, sheet: opts.fx,
    });
    if (opts.sfx) this.sfxAt(x, y, opts.sfx);
    this.shake(Math.min(9, opts.radius / 20));

    this.forEachNear(x, y, opts.radius + 30, (t) => {
      if (t.dead || t.kind === 'npc') return;
      if (actor && t.team === actor.team) return;
      if (!actor && t.kind !== 'player') return;
      const dd = dist(x, y, t.x, t.y);
      if (dd > opts.radius + t.radius) return;
      // Falloff keeps the edge of a blast from being as good as the centre.
      const falloff = clamp(1 - (dd / (opts.radius + t.radius)) * 0.45, 0.4, 1);
      const roll = rollDamage(stat, opts.coef * falloff, actor?.stats?.critChance || 0, actor?.stats?.critMult || 1.5, () => this.rng.next());
      this.dealDamage({
        source: actor, target: t, amount: roll.amount, crit: roll.crit, type: opts.type,
        knockback: (opts.knockback || 0) * falloff, angle: Math.atan2(t.y - y, t.x - x),
        effects: opts.effects,
      });
    });
  }

  monsterExplode(m, x, y, opts) {
    this.spawnFx('blast', x, y, { color: opts.color || '#ff7a40', radius: opts.radius, life: 0.32 });
    this.forEachNear(x, y, opts.radius + 30, (t) => {
      if (t.kind !== 'player' || t.dead || t.downed) return;
      const dd = dist(x, y, t.x, t.y);
      if (dd > opts.radius + t.radius) return;
      const falloff = clamp(1 - (dd / opts.radius) * 0.4, 0.5, 1);
      this.dealDamage({
        source: m, target: t, amount: opts.damage * falloff, type: opts.type,
        knockback: opts.knockback * falloff, angle: Math.atan2(t.y - y, t.x - x),
      });
    });
  }

  chain(actor, opts) {
    const stat = actor.stats[opts.power] ?? actor.stats.spellPower;
    let from = actor;
    let coef = opts.coef;
    const hit = new Set([actor.id]);
    const points = [{ x: actor.x, y: actor.y }];

    for (let j = 0; j < opts.jumps; j++) {
      const reach = j === 0 ? opts.range : opts.jumpRange;
      let best = null, bestD = reach * reach;
      this.forEachNear(from.x, from.y, reach, (t) => {
        if (t.dead || t.team === actor.team || t.kind === 'npc' || hit.has(t.id)) return;
        const dd = dist2(from.x, from.y, t.x, t.y);
        if (dd < bestD) { bestD = dd; best = t; }
      });
      if (!best) break;
      hit.add(best.id);
      points.push({ x: best.x, y: best.y });
      const roll = rollDamage(stat, coef, actor.stats.critChance, actor.stats.critMult, () => this.rng.next());
      this.dealDamage({ source: actor, target: best, amount: roll.amount, crit: roll.crit, type: opts.type });
      coef *= opts.falloff;
      from = best;
    }
    if (points.length > 1) {
      this.spawnFx('chain', actor.x, actor.y, { points, color: opts.color, life: 0.28 });
      if (opts.sfx) this.sfxAt(actor.x, actor.y, opts.sfx);
    }
  }

  groundZone(actor, opts) {
    this.zones.push({
      id: nextId(),
      ownerId: actor.id,
      team: actor.team,
      x: opts.x, y: opts.y, radius: opts.radius,
      duration: opts.duration, elapsed: 0,
      tickRate: opts.tickRate || 0.5, tickTimer: 0,
      coef: opts.coef || 0, power: opts.power, type: opts.type,
      color: opts.color, healAllies: opts.healAllies || 0,
      effects: opts.effects, friendly: !!opts.friendly,
    });
    if (opts.sfx) this.sfxAt(opts.x, opts.y, opts.sfx);
  }

  updateZones(dt) {
    for (const z of this.zones) {
      z.elapsed += dt;
      z.tickTimer -= dt;
      if (z.tickTimer > 0) continue;
      z.tickTimer = z.tickRate;
      const owner = this.actorById(z.ownerId);
      const stat = owner?.stats?.[z.power] ?? owner?.stats?.spellPower ?? 10;

      this.forEachNear(z.x, z.y, z.radius + 24, (t) => {
        if (t.dead || t.kind === 'npc') return;
        const dd = dist(z.x, z.y, t.x, t.y);
        if (dd > z.radius + t.radius * 0.5) return;
        if (t.team === z.team) {
          if (z.healAllies && t.kind === 'player' && !t.downed) {
            this.healActor(t, t.stats.maxHp * z.healAllies, owner);
          }
        } else if (z.coef > 0) {
          const roll = rollDamage(stat, z.coef, 0, 1, () => this.rng.next());
          this.dealDamage({ source: owner, target: t, amount: roll.amount, type: z.type, effects: z.effects });
        }
      });
    }
    retain(this.zones, (z) => z.elapsed < z.duration);
  }

  telegraph(actor, opts) {
    this.telegraphs.push({
      kind: 'circle', x: opts.x, y: opts.y, radius: opts.radius,
      t: 0, life: opts.delay, color: opts.color,
      onLand: opts.onLand, owner: actor?.id,
    });
  }

  telegraphRing(x, y, radius, delay, color) {
    this.telegraphs.push({ kind: 'circle', x, y, radius, t: 0, life: delay, color });
  }

  telegraphLine(x, y, angle, length, delay) {
    this.telegraphs.push({ kind: 'line', x, y, angle, length, t: 0, life: delay, color: '#ff5533' });
  }

  updateTelegraphs(dt) {
    for (const t of this.telegraphs) {
      t.t += dt;
      if (t.t >= t.life && !t.fired) {
        t.fired = true;
        t.onLand?.(this);
      }
    }
    retain(this.telegraphs, (t) => t.t < t.life + 0.15);
  }

  delay(seconds, fn) { this.timers.push({ t: seconds, fn }); }

  // -------------------------------------------------------------------------
  // Damage, healing, death
  // -------------------------------------------------------------------------

  dealDamage({ source, target, amount, crit = false, type = 'phys', knockback = 0, angle = 0, effects = null }) {
    if (!target || target.dead || target.downed) return 0;
    if (target.kind === 'player' && (target.invuln > 0 || this.debug.god)) return 0;
    if (this.debug.oneHit && source?.kind === 'player' && target.kind !== 'player') {
      amount = (target.stats.maxHp || 1) * 99;
    }

    const armor = type === 'phys' ? (target.stats.armor || 0) : (target.stats.resist || 0);
    let dmg = mitigate(amount, armor) * damageTakenMult(target);
    dmg = Math.max(1, dmg);

    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0) this.floatText(target.x, target.y - target.radius - 12, `-${Math.round(absorbed)}`, '#9fd8ff');
    }

    target.hp -= dmg;
    target.hitFlash = 0.16;

    if (dmg > 0.5) {
      const color = crit ? '#ffd23f' : target.kind === 'player' ? '#ff6b6b' : '#ffffff';
      this.floatText(target.x + this.rng.float(-8, 8), target.y - target.radius - 10, Math.round(dmg) + (crit ? '!' : ''), color, crit ? 1.4 : 1);
      if (this.netActive && this.isHost) {
        this.emitEvent({ t: 'dmg', id: target.id, a: Math.round(dmg), c: crit ? 1 : 0, ty: type });
      }
    }
    this.spawnFx('hit', target.x, target.y, { color: type === 'phys' ? '#ff5a5a' : '#c08aff', radius: 10, life: 0.18 });

    if (knockback > 0) {
      const resist = 1 / (1 + (target.mass || 1));
      target.vx += Math.cos(angle) * knockback * resist * 2.4;
      target.vy += Math.sin(angle) * knockback * resist * 2.4;
    }

    if (effects) for (const e of effects) this.applyEffect(source, target, e);

    if (source && source.kind === 'player') {
      source.stat.damageDealt += dmg;
      if (source.stats.lifeSteal > 0) this.healActor(source, dmg * source.stats.lifeSteal, source, true);
    }
    if (target.kind === 'player') {
      target.stat.damageTaken += dmg;
      target.lastDamageTime = this.time;
      this.sfxAt(target.x, target.y, 'playerHurt');
      if (target.animLock <= 0) setAnim(target, 'hurt', { loop: false, fps: 14, lock: 0.2 });
      this.shake(2.5);
    } else if (target.animLock <= 0 && this.rng.bool(0.35)) {
      setAnim(target, 'hurt', { loop: false, fps: 14, lock: 0.22 });
    }

    if (target.hp <= 0) this.handleDeath(target, source);
    return dmg;
  }

  /** Bypasses armour and buffs - used for self-inflicted costs. */
  damageActorDirect(actor, amount) {
    actor.hp -= amount;
    this.floatText(actor.x, actor.y - actor.radius - 10, `-${Math.round(amount)}`, '#c060ff');
    if (actor.hp <= 0) this.handleDeath(actor, null);
  }

  applyEffect(source, target, e) {
    const power = source?.stats?.spellPower || source?.stats?.damage || 10;
    switch (e.id) {
      case 'burn':
      case 'poison':
        applyBuffTo(target, {
          id: e.id, name: e.id === 'burn' ? 'Burning' : 'Poisoned',
          duration: e.duration, dot: power * e.coef, tick: e.tick, tickTimer: e.tick,
          sourceId: source?.id, type: e.id === 'burn' ? 'fire' : 'poison',
        });
        break;
      case 'chill':
        applyBuffTo(target, { id: 'chill', name: 'Chilled', duration: e.duration, slow: e.slow });
        break;
      case 'stun':
        if (target.boss) {
          applyBuffTo(target, { id: 'chill', name: 'Staggered', duration: e.duration, slow: 0.5 });
        } else {
          applyBuffTo(target, { id: 'stun', name: 'Stunned', duration: e.duration });
        }
        break;
      default:
        break;
    }
  }

  tickDots(actor, dt) {
    for (const b of actor.buffs) {
      if (!b.dot) continue;
      b.tickTimer -= dt;
      if (b.tickTimer > 0) continue;
      b.tickTimer = b.tick;
      const src = b.sourceId != null ? this.actorById(b.sourceId) : null;
      const dmg = Math.max(1, b.dot * damageTakenMult(actor));
      actor.hp -= dmg;
      this.floatText(actor.x, actor.y - actor.radius - 6, Math.round(dmg), b.type === 'fire' ? '#ff9040' : '#8ad86a', 0.8);
      if (src && src.kind === 'player') src.stat.damageDealt += dmg;
      if (actor.hp <= 0) this.handleDeath(actor, src);
    }
  }

  healActor(actor, amount, source, silent = false) {
    if (!actor || actor.dead) return false;
    const before = actor.hp;
    actor.hp = Math.min(actor.stats.maxHp, actor.hp + amount);
    const gained = actor.hp - before;
    if (gained > 0.5 && !silent) {
      this.floatText(actor.x, actor.y - actor.radius - 14, `+${Math.round(gained)}`, '#7fe07f');
      this.spawnFx('heal', actor.x, actor.y, { color: '#8fffa0', radius: actor.radius * 1.6, life: 0.4 });
      if (this.netActive && this.isHost) {
        this.emitEvent({ t: 'txt', x: Math.round(actor.x), y: Math.round(actor.y - actor.radius - 14), s: `+${Math.round(gained)}`, c: '#7fe07f' });
      }
    }
    if (source && source.kind === 'player' && source !== actor) source.stat.healingDone += gained;
    return gained > 0;
  }

  healLowestAlly(actor, amount) {
    let target = null, lowest = Infinity;
    for (const p of this.players) {
      if (p.dead || p.downed) continue;
      const frac = p.hp / p.stats.maxHp;
      if (frac < lowest) { lowest = frac; target = p; }
    }
    if (target && lowest < 1) this.healActor(target, amount, actor);
  }

  healAllies(actor, opts) {
    let healed = 0;
    for (const p of this.players) {
      if (p.dead || p.downed) continue;
      if (dist(actor.x, actor.y, p.x, p.y) > opts.radius) continue;
      const amount = (opts.flat || 0) + p.stats.maxHp * (opts.pct || 0);
      if (this.healActor(p, amount, actor)) healed++;
      if (opts.fx) this.spawnFx('sheet', p.x, p.y, { sheet: opts.fx, radius: 60, life: 0.5, color: '#aaffcc' });
    }
    if (opts.sfx) this.sfxAt(actor.x, actor.y, opts.sfx);
    return healed;
  }

  buffAllies(actor, radius, buff) {
    for (const p of this.players) {
      if (p.dead || p.downed) continue;
      if (dist(actor.x, actor.y, p.x, p.y) > radius) continue;
      applyBuffTo(p, buff);
      this.spawnFx('ward', p.x, p.y, { color: '#ffc060', radius: 30, life: 0.4 });
    }
  }

  shieldAllies(actor, radius, amount, duration) {
    for (const p of this.players) {
      if (p.dead || p.downed) continue;
      if (dist(actor.x, actor.y, p.x, p.y) > radius) continue;
      p.shield = Math.max(p.shield, amount);
      applyBuffTo(p, { id: 'ward', name: 'Ward of Light', duration, shield: amount });
      this.spawnFx('ward', p.x, p.y, { color: '#fff0b0', radius: 34, life: 0.5 });
    }
  }

  applyBuff(actor, buff) {
    applyBuffTo(actor, buff);
    if (buff.shield) actor.shield = Math.max(actor.shield || 0, buff.shield);
  }

  cleanse(actor, ids) {
    const before = actor.buffs.length;
    retain(actor.buffs, (b) => !ids.includes(b.id));
    return actor.buffs.length < before;
  }

  restoreMana(actor, amount) {
    if (!actor.stats.maxMp) return false;
    const before = actor.mp;
    actor.mp = Math.min(actor.stats.maxMp, actor.mp + amount);
    const gained = actor.mp - before;
    if (gained > 0.5) this.floatText(actor.x, actor.y - actor.radius - 22, `+${Math.round(gained)}`, '#7fa8ff');
    return gained > 0;
  }

  reviveNearest(actor, radius, hpFraction) {
    let best = null, bestD = radius * radius;
    for (const p of this.players) {
      if (!p.downed || p === actor) continue;
      const dd = dist2(actor.x, actor.y, p.x, p.y);
      if (dd < bestD) { bestD = dd; best = p; }
    }
    if (!best) {
      this.floatText(actor.x, actor.y - 30, 'No one to raise', '#aaa');
      return false;
    }
    this.revivePlayer(best, hpFraction);
    return true;
  }

  revivePlayer(p, hpFraction = 0.5) {
    p.downed = false;
    p.dead = false;
    p.spectating = null;
    p.hp = Math.max(1, p.stats.maxHp * hpFraction);
    p.mp = Math.max(p.mp, p.stats.maxMp * 0.25);
    p.invuln = 2.0;
    p.buffs.length = 0;
    setAnim(p, 'idle', { loop: true, fps: 9 });
    this.spawnFx('ward', p.x, p.y, { color: '#ffe9a8', radius: 60, life: 0.8 });
    this.pushLog(`${p.name} has been raised.`, '#ffe9a8');
    this.emitEvent({ t: 'revive', id: p.id });
  }

  handleDeath(target, source) {
    if (target.dead || target.downed) return;

    if (target.kind === 'player') {
      target.downed = true;
      target.hp = 0;
      target.stat.deaths++;
      target.buffs.length = 0;
      target.shield = 0;
      setAnim(target, 'death', { loop: false, fps: 10, lock: 999 });
      this.pushLog(`${target.name} has fallen.`, '#ff6b6b');
      this.sfxAt(target.x, target.y, 'playerDeath');
      this.emitEvent({ t: 'downed', id: target.id });
      // Spectate a living ally so a downed player still has something to watch.
      const alive = this.livePlayers();
      target.spectating = alive.length ? alive[0].id : null;
      if (!alive.length) this.onPartyWipe();
      return;
    }

    target.dead = true;
    target.hp = 0;
    target.deathTimer = 0;
    target.vx = 0; target.vy = 0;
    setAnim(target, 'death', { loop: false, fps: 11, lock: 999 });
    this.sfxAt(target.x, target.y, target.boss ? 'bossDeath' : 'mobDeath');

    if (target.def?.onDeath === 'splitSmall' && target.stats.maxHp > 40 && !target.isSplit) {
      for (let i = 0; i < 2; i++) {
        const a = this.rng.float(0, TAU);
        const child = createMonster({
          monsterId: target.monsterId, level: Math.max(1, target.level - 2),
          x: target.x + Math.cos(a) * 24, y: target.y + Math.sin(a) * 24, rng: this.rng,
        });
        child.isSplit = true;
        child.scale *= 0.7; child.radius *= 0.7;
        child.stats.maxHp = Math.round(child.stats.maxHp * 0.35);
        child.hp = child.stats.maxHp;
        child.roomId = target.roomId;
        // A slime dying against a wall would otherwise drop its children inside
        // it - unreachable, unkillable, and enough to seal the stairs forever.
        const spot = this.findStandableSpot(child.x, child.y, child);
        if (!spot) continue;
        child.x = spot.x; child.y = spot.y;
        this.addMonster(child);
      }
    }

    this.awardXp(target, source);
    this.dropLoot(target);

    if (target.boss) {
      this.pushLog(`${target.name} falls. The way down is open.`, '#ffd27f');
      this.shake(14);
      this.spawnFx('blast', target.x, target.y, { color: '#ffd27f', radius: 160, life: 0.8 });
    }
  }

  awardXp(monster, killer) {
    const xp = monster.stats.xp;
    // Everyone in the party shares experience, so nobody falls behind by dying
    // or by playing support. The divisor is below the party size on purpose: a
    // bigger group levels a little faster, which is the point of grouping.
    const eligible = this.players.filter((p) => !p.dead);
    if (!eligible.length) return;
    const share = Math.max(1, Math.round(xp / Math.max(1, eligible.length * 0.75)));
    for (const p of eligible) {
      const bonus = 1 + (p.stats.xpBonus || 0);
      this.giveXp(p, Math.round(share * bonus));
    }
    if (killer && killer.kind === 'player') killer.stat.kills++;
  }

  giveXp(p, amount) {
    if (p.level >= MAX_LEVEL) return;
    p.xp += amount;
    let leveled = false;
    while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      p.unspentPoints += 2;
      leveled = true;
    }
    if (leveled) {
      recomputeStats(p, getClass(p.classId));
      p.hp = p.stats.maxHp;
      p.mp = p.stats.maxMp;
      this.floatText(p.x, p.y - 46, 'LEVEL UP', '#ffd23f', 1.6);
      this.spawnFx('ward', p.x, p.y, { color: '#ffd23f', radius: 60, life: 0.9 });
      this.sfxAt(p.x, p.y, 'levelUp');
      this.pushLog(`${p.name} reached level ${p.level}!`, '#ffd23f');
      this.emitEvent({ t: 'levelup', id: p.id, level: p.level });
    }
  }

  dropLoot(monster) {
    const source = monster.boss ? 'boss' : monster.elite ? 'elite' : 'monster';
    const mf = this.players.reduce((m, p) => Math.max(m, p.stats.magicFind || 0), 0);
    const items = rollLoot(this.rng, { floor: this.floorNo, source, magicFind: mf });
    if (!items.length) return;
    monster.lootable = true;
    this.pickups.push(createPickup({ x: monster.x, y: monster.y, items, kind: monster.boss ? 'bossLoot' : 'loot' }));
  }

  collect(player, pickup) {
    pickup.dead = true;
    let gold = 0;
    const gained = [];
    for (const item of pickup.items) {
      if (item.type === 'gold') {
        gold += item.qty;
        continue;
      }
      if (this.addToInventory(player, item)) gained.push(item);
    }
    if (gold) {
      player.gold += gold;
      player.stat.goldEarned += gold;
      this.floatText(player.x, player.y - 40, `+${gold}g`, '#ffd23f');
    }
    if (gained.length) {
      player.stat.itemsFound += gained.length;
      for (const g of gained) this.pushLog(`${player.name} found ${g.name}`, g.rarity ? undefined : '#cfcfcf', g);
    }
    // Loot arcs off the floor and onto whoever grabbed it, so a pickup reads
    // as going somewhere rather than just blinking out.
    const shown = pickup.items.find((i) => i.type !== 'gold') || pickup.items[0];
    this.spawnFx('gather', pickup.x, pickup.y, {
      life: 0.36, to: player.id, icon: shown?.icon || null, gold: !!gold && !gained.length,
    });
    this.sfxAt(player.x, player.y, gold && !gained.length ? 'coin' : 'pickup');
    this.emitEvent({ t: 'pickup', id: player.id, pid: pickup.id });
  }

  addToInventory(player, item) {
    if (item.type === 'consumable') {
      const slot = player.inventory.find((i) => i.type === 'consumable' && i.id === item.id && i.qty < (i.stack || 20));
      if (slot) { slot.qty += item.qty; return true; }
    }
    if (player.inventory.length >= INVENTORY_SIZE) {
      this.floatText(player.x, player.y - 50, 'Bag full', '#ff8080');
      return false;
    }
    player.inventory.push(item);
    return true;
  }

  onPartyWipe() {
    this.state = 'defeat';
    this.pushLog('The party has fallen.', '#ff4444');
    bus.emit('game:over', { victory: false, world: this });
  }

  // -------------------------------------------------------------------------
  // Props: traps, chests, shrines, stairs
  // -------------------------------------------------------------------------

  updateTraps(dt) {
    for (const prop of this.dungeon.props) {
      if (prop.type !== 'trap' || prop.spent) continue;
      if (prop.cooldown > 0) {
        prop.cooldown -= dt;
        if (prop.cooldown <= 0) prop.armed = true;
      }
    }
  }

  /**
   * Traps fade in when somebody is close and fade back out when they leave, so
   * a cleared room does not stay littered with markers. `vis` is a 0-1 alpha
   * the renderer uses directly.
   */
  updateTrapVisibility(dt) {
    const players = this.players.filter((p) => !p.dead);
    for (const prop of this.dungeon.props) {
      if (prop.type !== 'trap') continue;
      let near = false;
      const cx = prop.x * TILE + TILE / 2;
      const cy = prop.y * TILE + TILE / 2;
      for (const p of players) {
        if (dist2(cx, cy, p.x, p.y) < TRAP_REVEAL_RANGE * TRAP_REVEAL_RANGE) { near = true; break; }
      }
      const target = near && !prop.spent ? 1 : 0;
      const v = prop.vis ?? 0;
      prop.vis = v + clamp(target - v, -dt * 3, dt * 4);
      if (near && !prop.spent) this.discover('trap', prop.kind);
    }
  }

  /**
   * Dungeon compendium. Anything a player gets close enough to see is recorded
   * once, and the entry stays for the rest of the run.
   */
  discover(kind, id) {
    const set = kind === 'trap' ? this.codex.traps : this.codex.monsters;
    if (set.includes(id)) return;
    set.push(id);
    this.emitEvent({ t: 'codex', k: kind, id });
    bus.emit('codex:new', { kind, id });
  }

  /** Record every monster close enough to have been seen this tick. */
  updateCodex() {
    for (const m of this.monsters) {
      if (m.dead || this.codex.monsters.includes(m.monsterId)) continue;
      for (const p of this.players) {
        if (p.dead) continue;
        if (dist2(m.x, m.y, p.x, p.y) < CODEX_RANGE * CODEX_RANGE) { this.discover('monster', m.monsterId); break; }
      }
    }
  }

  checkTraps(p) {
    const d = this.dungeon;
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    if (p.lastTrapTile === ty * d.w + tx) return;
    p.lastTrapTile = ty * d.w + tx;

    for (const prop of d.props) {
      if (prop.type !== 'trap' || !prop.armed || prop.spent) continue;
      if (prop.x !== tx || prop.y !== ty) continue;
      this.triggerTrap(prop, p);
      break;
    }
  }

  triggerTrap(trap, p) {
    trap.armed = false;
    trap.hidden = false;
    trap.seen = true;
    p.stat.trapsTriggered++;
    // One-shot traps break when they fire; vents and gas jets keep working, so
    // they re-arm and stay on the map as a hazard to route around.
    if (PERSISTENT_TRAPS.has(trap.kind)) {
      trap.cooldown = 8;
    } else {
      trap.spent = true;
    }
    const power = 8 + this.floorNo * 7;

    switch (trap.kind) {
      case 'spike':
        this.dealDamage({ source: null, target: p, amount: power * 1.6, type: 'phys' });
        this.spawnFx('spikes', p.x, p.y, { color: '#c8c8d0', radius: 26, life: 0.4 });
        this.sfxAt(p.x, p.y, 'spike');
        break;
      case 'dart': {
        const angle = this.rng.float(0, TAU);
        for (let i = 0; i < 6; i++) {
          this.projectiles.push(createProjectile({
            ownerId: -1, team: TEAM.MONSTER,
            x: p.x, y: p.y, angle: angle + (i / 6) * TAU,
            speed: 300, radius: 6, range: 260,
            damage: power * 0.8, type: 'phys', sprite: 'arrow3',
          }));
        }
        this.sfxAt(p.x, p.y, 'dart');
        break;
      }
      case 'flame':
        this.groundZone({ id: -1, team: TEAM.MONSTER, stats: { spellPower: power } }, {
          x: p.x, y: p.y, radius: 78, duration: 3, tickRate: 0.4,
          coef: 0.5, power: 'spellPower', type: 'fire', color: '#ff7030',
          effects: [{ id: 'burn', duration: 3, coef: 0.15, tick: 0.5 }],
        });
        this.sfxAt(p.x, p.y, 'flame');
        break;
      case 'poison':
        this.groundZone({ id: -1, team: TEAM.MONSTER, stats: { spellPower: power } }, {
          x: p.x, y: p.y, radius: 92, duration: 5, tickRate: 0.6,
          coef: 0.35, power: 'spellPower', type: 'poison', color: '#8ad86a',
          effects: [{ id: 'poison', duration: 4, coef: 0.12, tick: 0.6 }],
        });
        this.sfxAt(p.x, p.y, 'gas');
        break;
      default:
        break;
    }
    this.shake(4);
    this.pushLog(`${p.name} triggered a ${trap.kind} trap!`, '#ff9060');
  }

  /** What the player would interact with right now, or null. */
  interactTarget(p) {
    const d = this.dungeon;
    let best = null, bestD = 70 * 70;
    for (const prop of d.props) {
      if (!['chest', 'shrine', 'stairs', 'merchant'].includes(prop.type)) continue;
      const c = d.tileCenter(prop.x, prop.y);
      const dd = dist2(p.x, p.y, c.x, c.y);
      if (dd > bestD) continue;
      if (prop.type === 'chest' && prop.opened) continue;
      if (prop.type === 'shrine' && prop.used) continue;
      bestD = dd;
      best = prop;
    }
    return best;
  }

  interact(p) {
    const prop = this.interactTarget(p);
    if (!prop) return false;
    const c = this.dungeon.tileCenter(prop.x, prop.y);

    switch (prop.type) {
      case 'chest': {
        prop.opened = true;
        p.stat.chestsOpened++;
        const source = prop.tier === 'boss' ? 'boss' : prop.tier === 'rare' ? 'rareChest' : 'chest';
        const items = rollLoot(this.rng, { floor: this.floorNo, source, magicFind: p.stats.magicFind });
        this.pickups.push(createPickup({ x: c.x, y: c.y + 20, items }));
        this.sfxAt(c.x, c.y, 'chest');
        this.emitEvent({ t: 'chest', x: prop.x, y: prop.y });
        this.pushLog(`${p.name} opened a chest.`, '#ffd27f');
        return true;
      }
      case 'shrine': {
        prop.used = true;
        for (const ally of this.players) {
          if (ally.downed) this.revivePlayer(ally, 0.6);
          this.healActor(ally, ally.stats.maxHp, p);
          this.restoreMana(ally, ally.stats.maxMp);
        }
        this.spawnFx('ward', c.x, c.y, { color: '#a8e8ff', radius: 120, life: 1.0 });
        this.sfxAt(c.x, c.y, 'shrine');
        this.pushLog('The shrine restores the party.', '#a8e8ff');
        this.emitEvent({ t: 'shrine', x: prop.x, y: prop.y });
        return true;
      }
      case 'merchant': {
        bus.emit('ui:shop', { npcId: prop.npcId, player: p });
        return true;
      }
      case 'stairs': {
        this.floatText(p.x, p.y - 40, 'Stand still on the marker', '#8fe0ff');
        return false;
      }
      default:
        return false;
    }
  }

  /** Live monsters still in the boss chamber. Informational only now. */
  bossRoomGuards() {
    const id = this.dungeon.bossRoom;
    return this.monsters.filter((m) => !m.dead && m.roomId === id);
  }

  /**
   * The descent ritual.
   *
   * Standing on the stairway marker for ten uninterrupted seconds opens the way
   * down. Taking a hit or swinging at anything resets it, so the chamber still
   * has to be cleared - but the gate is a thing the player does, not a monster
   * counter that can get stuck on an unreachable straggler.
   */
  updateDescent(dt, intents) {
    const d = this.descent;
    const stairs = this.dungeon.props.find((p) => p.type === 'stairs');
    if (!stairs) return;
    const c = this.dungeon.tileCenter(stairs.x, stairs.y);

    if (d.flash > 0) d.flash -= dt;

    const onPad = this.players.find((p) => !p.dead && !p.downed
      && dist2(p.x, p.y, c.x, c.y) < DESCENT_RADIUS * DESCENT_RADIUS);

    if (!onPad) {
      if (d.progress > 0.5) this.pushLog('You stepped off the marker.', '#ff9060');
      d.progress = 0;
      d.playerId = null;
      return;
    }
    if (d.playerId !== onPad.id) { d.playerId = onPad.id; d.progress = 0; }

    const intent = intents?.get(onPad.id);
    const acted = !!intent && (intent.attack || intent.slots?.some(Boolean));
    const hurt = this.time - (onPad.lastDamageTime ?? -99) < 0.35;
    if (acted || hurt) {
      if (d.progress > 0.4) {
        this.pushLog(hurt ? 'The ritual is broken - you were struck!' : 'The ritual is broken - you attacked.', '#ff6b6b');
        this.sfxAt(c.x, c.y, 'error');
        d.flash = 0.7;
      }
      d.progress = 0;
      return;
    }

    d.progress += dt;
    if (d.progress >= DESCENT_TIME) {
      d.progress = 0;
      d.playerId = null;
      bus.emit('descend:ready', { world: this, player: onPad });
    }
  }

  // -------------------------------------------------------------------------
  // Fog of war
  // -------------------------------------------------------------------------

  revealFog() {
    if (!this.explored) return;
    const d = this.dungeon;
    const R = 9;
    for (const p of this.players) {
      if (p.dead) continue;
      const cx = Math.floor(p.x / TILE), cy = Math.floor(p.y / TILE);
      for (let y = cy - R; y <= cy + R; y++) {
        for (let x = cx - R; x <= cx + R; x++) {
          if (!d.inBounds(x, y)) continue;
          if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
          this.explored[y * d.w + x] = 1;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Presentation hooks
  // -------------------------------------------------------------------------

  // Presentation is generated locally on the host and mirrored to clients as
  // compact events, so both ends see the same hit sparks and hear the same
  // sounds without the client having to re-run any of the simulation.

  spawnFx(type, x, y, opts = {}) {
    this.fx.push({ type, x, y, t: 0, life: opts.life ?? 0.3, ...opts });
    if (this.netActive && this.isHost && NETWORKED_FX.has(type)) {
      this.emitEvent({ t: 'fx', k: type, x: Math.round(x), y: Math.round(y), o: opts });
    }
  }

  floatText(x, y, text, color = '#fff', scale = 1) {
    this.floaters.push({ x, y, text: String(text), color, scale, t: 0, life: 0.9 });
  }

  shake(amount) {
    this.shakeAmount = Math.min(24, this.shakeAmount + amount);
    if (this.netActive && this.isHost && amount >= 4) this.emitEvent({ t: 'shake', a: Math.round(amount) });
  }

  sfx(name) {
    bus.emit('sfx', name, 1);
    if (this.netActive && this.isHost) this.emitEvent({ t: 'sfx', n: name, x: 0, y: 0, g: 1 });
  }

  sfxAt(x, y, name) {
    if (!name) return;
    if (this.netActive && this.isHost) {
      this.emitEvent({ t: 'sfx', n: name, x: Math.round(x), y: Math.round(y) });
    }
    // Attenuate by distance to the local viewpoint so a 200-monster floor does
    // not turn into white noise.
    const ref = this.listener || this.players[0];
    if (!ref) { bus.emit('sfx', name, 1); return; }
    const dd = dist(x, y, ref.x, ref.y);
    if (dd > 900) return;
    bus.emit('sfx', name, clamp(1 - dd / 900, 0.05, 1));
  }

  pushLog(text, color = '#ddd', item = null) {
    this.log.push({ text, color, item, t: this.time });
    if (this.log.length > 60) this.log.shift();
    bus.emit('log', { text, color, item });
    if (this.netActive && this.isHost) this.emitEvent({ t: 'log', s: text, c: color });
  }

  emitEvent(e) { this.events.push(e); }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  hasHeroAnim(classId, anim) { return this.animCheck ? this.animCheck('hero', classId, anim) : true; }
  hasMonsterAnim(monsterId, anim) {
    const sheet = MONSTERS[monsterId]?.sheet || monsterId;
    return this.animCheck ? this.animCheck('mob', sheet, anim) : true;
  }

  summonMinion(summoner, monsterId, x, y) {
    const m = createMonster({
      monsterId,
      level: Math.max(1, summoner.level - 2),
      x, y, rng: this.rng,
    });
    const spot = this.findStandableSpot(x, y, m);
    if (!spot) return;
    m.x = spot.x; m.y = spot.y;
    m.roomId = summoner.roomId;
    m.summoned = true;
    this.addMonster(m);
    this.spawnFx('summon', spot.x, spot.y, { color: '#a060ff', radius: 30, life: 0.5 });
  }
}
