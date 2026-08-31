import { TILE } from '../assets/manifest.js';
import { dist, dist2, clamp, TAU } from '../core/util.js';
import { setAnim, isStunned, movementMult } from './entities.js';

/**
 * Monster behaviour.
 *
 * Pathing uses a multi-source flow field rebuilt a few times a second: a BFS
 * out from every living player across walkable tiles, giving each tile the
 * direction of the cheapest step toward *someone*. That is one cheap pass for
 * the whole bestiary instead of per-monster A*, and it means monsters round
 * corners and through doorways correctly instead of grinding on walls.
 */

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export class FlowField {
  constructor(dungeon) {
    this.d = dungeon;
    this.dist = new Uint16Array(dungeon.w * dungeon.h).fill(0xffff);
    this.dir = new Int8Array(dungeon.w * dungeon.h * 2);
    this.timer = 0;
    this.maxRange = 90; // tiles; monsters further away just wander
  }

  /** @param {Array<{x:number,y:number}>} sources pixel-space positions */
  rebuild(sources) {
    const d = this.d;
    this.dist.fill(0xffff);
    const queue = new Int32Array(d.w * d.h);
    let head = 0, tail = 0;

    for (const s of sources) {
      const tx = Math.floor(s.x / TILE);
      const ty = Math.floor(s.y / TILE);
      if (!d.isFloor(tx, ty)) continue;
      const i = ty * d.w + tx;
      if (this.dist[i] === 0) continue;
      this.dist[i] = 0;
      queue[tail++] = i;
    }

    while (head < tail) {
      const cur = queue[head++];
      const cd = this.dist[cur];
      if (cd >= this.maxRange) continue;
      const cx = cur % d.w, cy = (cur / d.w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
        if (!d.isFloor(nx, ny)) continue;
        const ni = ny * d.w + nx;
        if (this.dist[ni] !== 0xffff) continue;
        this.dist[ni] = cd + 1;
        queue[tail++] = ni;
      }
    }

    // Derive a per-tile step direction, preferring diagonals when both
    // orthogonal components are open so movement does not look gridlocked.
    for (let y = 1; y < d.h - 1; y++) {
      for (let x = 1; x < d.w - 1; x++) {
        const i = y * d.w + x;
        if (this.dist[i] === 0xffff) { this.dir[i * 2] = 0; this.dir[i * 2 + 1] = 0; continue; }
        let best = this.dist[i], bx = 0, by = 0;
        for (const [ox, oy] of DIRS) {
          const nx = x + ox, ny = y + oy;
          if (!d.isFloor(nx, ny)) continue;
          if (ox && oy && (!d.isFloor(x + ox, y) || !d.isFloor(x, y + oy))) continue;
          const nd = this.dist[ny * d.w + nx];
          if (nd < best) { best = nd; bx = ox; by = oy; }
        }
        this.dir[i * 2] = bx;
        this.dir[i * 2 + 1] = by;
      }
    }
  }

  /** Step direction at a pixel position, or null if unreachable. */
  sample(px, py) {
    const d = this.d;
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (!d.inBounds(tx, ty)) return null;
    const i = ty * d.w + tx;
    if (this.dist[i] === 0xffff) return null;
    const dx = this.dir[i * 2], dy = this.dir[i * 2 + 1];
    if (!dx && !dy) return null;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len, dist: this.dist[i] };
  }
}

// ---------------------------------------------------------------------------

const SEPARATION_RADIUS = 30;

export function updateMonster(world, m, dt) {
  if (m.dead) {
    m.deathTimer += dt;
    return;
  }

  m.attackCd = Math.max(0, m.attackCd - dt);
  for (const k in m.specialCd) m.specialCd[k] = Math.max(0, m.specialCd[k] - dt);
  if (m.hitFlash > 0) m.hitFlash -= dt;

  if (isStunned(m)) {
    m.vx *= 0.85; m.vy *= 0.85;
    setAnim(m, 'hurt', { loop: true, fps: 6 });
    return;
  }

  // A queued strike resolves at the end of its wind-up, so the player has a
  // real window to read the animation and get out of the way.
  if (m.windup > 0) {
    m.windup -= dt;
    m.vx *= 0.7; m.vy *= 0.7;
    if (m.windup <= 0 && m.pendingAttack) {
      const fn = m.pendingAttack;
      m.pendingAttack = null;
      fn();
    }
    return;
  }

  acquireTarget(world, m);

  const behaviour = BEHAVIOURS[m.ai] || BEHAVIOURS.chaser;
  behaviour(world, m, dt);

  applySeparation(world, m, dt);

  const speed = Math.hypot(m.vx, m.vy);
  if (speed > 6) {
    m.facing = Math.atan2(m.vy, m.vx);
    setAnim(m, 'walk', { loop: true, fps: 10 });
  } else if (m.animLock <= 0) {
    setAnim(m, 'idle', { loop: true, fps: 8 });
  }
}

function acquireTarget(world, m) {
  const cur = m.target != null ? world.actorById(m.target) : null;
  if (cur && !cur.dead && !cur.downed) {
    const dd = dist(m.x, m.y, cur.x, cur.y);
    // Keep the current target unless it has genuinely escaped.
    if (dd < m.aggroRange * 2.2) return;
  }

  let best = null, bestD = m.aggroRange * m.aggroRange;
  for (const p of world.players) {
    if (p.dead || p.downed) continue;
    const dd = dist2(m.x, m.y, p.x, p.y);
    // Shield Wall and War Cry pull attention, which is what makes a tank a tank.
    const taunted = p.buffs.some((b) => b.taunt);
    const weighted = taunted ? dd * 0.3 : dd;
    if (weighted < bestD) { bestD = weighted; best = p; }
  }
  m.target = best ? best.id : null;
}

// ---------------------------------------------------------------------------
// Behaviours
// ---------------------------------------------------------------------------

const BEHAVIOURS = {
  chaser(world, m, dt) {
    const t = m.target != null ? world.actorById(m.target) : null;
    if (!t) return wander(world, m, dt);
    approachAndStrike(world, m, t, dt, 1);
  },

  tank(world, m, dt) {
    const t = m.target != null ? world.actorById(m.target) : null;
    if (!t) return wander(world, m, dt);
    tryEnrage(world, m);
    trySpecials(world, m, t);
    approachAndStrike(world, m, t, dt, 0.92);
  },

  charger(world, m, dt) {
    const t = m.target != null ? world.actorById(m.target) : null;
    if (!t) return wander(world, m, dt);
    trySpecials(world, m, t);
    approachAndStrike(world, m, t, dt, 1.05);
  },

  /** Bats: swoop in, veer off, come back. Deliberately hard to line up. */
  erratic(world, m, dt) {
    const t = m.target != null ? world.actorById(m.target) : null;
    if (!t) return wander(world, m, dt);
    m.wanderTimer -= dt;
    if (m.wanderTimer <= 0) {
      m.wanderTimer = 0.5 + world.rng.float(0, 0.7);
      m.swoopOffset = world.rng.float(-1.2, 1.2);
    }
    const toT = Math.atan2(t.y - m.y, t.x - m.x);
    const d = dist(m.x, m.y, t.x, t.y);
    const angle = toT + (d > 90 ? m.swoopOffset * 0.7 : 0);
    steer(world, m, Math.cos(angle), Math.sin(angle), m.stats.speed, dt);
    if (d < m.def.attack.range && m.attackCd <= 0) beginAttack(world, m, t);
  },

  ranged(world, m, dt) {
    const t = m.target != null ? world.actorById(m.target) : null;
    if (!t) return wander(world, m, dt);
    const d = dist(m.x, m.y, t.x, t.y);
    const want = m.def.preferredRange || 240;
    const toT = Math.atan2(t.y - m.y, t.x - m.x);
    m.facing = toT;

    const canShoot = d < m.def.attack.range && m.attackCd <= 0
      && world.hasLineOfSight(m.x, m.y, t.x, t.y);

    // Taking the shot beats repositioning. Kiting on every frame regardless of
    // whether the bow was ready made archers look like they were fleeing from a
    // fight they were actually winning.
    if (canShoot) {
      m.vx *= 0.7; m.vy *= 0.7;
      beginAttack(world, m, t);
      return;
    }

    // Only give ground when genuinely crowded - a bowman at medium range holds
    // his line. Backing off from anything inside 70% of preferred range meant
    // they spent the whole fight walking backwards.
    const crowded = want * 0.5;
    if (d < crowded) {
      // And only when there is somewhere to go: retreating into a wall used to
      // leave them grinding against it for seconds at a time.
      const probe = m.radius + 26;
      if (world.canStep(m, m.x - Math.cos(toT) * probe, m.y - Math.sin(toT) * probe)) {
        steer(world, m, -Math.cos(toT), -Math.sin(toT), m.stats.speed * 0.85, dt);
      } else {
        steer(world, m, -Math.sin(toT), Math.cos(toT), m.stats.speed * 0.7, dt);
      }
    } else if (d > m.def.attack.range * 0.9) {
      steer(world, m, Math.cos(toT), Math.sin(toT), m.stats.speed, dt);
    } else {
      // In the pocket: hold the line and shuffle, rather than pace the room.
      steer(world, m, -Math.sin(toT) * 0.6, Math.cos(toT) * 0.6, m.stats.speed * 0.35, dt);
    }
  },

  summoner(world, m, dt) {
    const t = m.target != null ? world.actorById(m.target) : null;
    if (!t) return wander(world, m, dt);
    trySpecials(world, m, t);
    BEHAVIOURS.ranged(world, m, dt);
  },
};

function approachAndStrike(world, m, t, dt, speedMult) {
  const d = dist(m.x, m.y, t.x, t.y);
  const reach = m.def.attack.range + t.radius * 0.5;
  if (d > reach * 0.85) {
    const flow = world.flow.sample(m.x, m.y);
    let dx, dy;
    if (flow && d > 140) {
      dx = flow.x; dy = flow.y;
    } else {
      const a = Math.atan2(t.y - m.y, t.x - m.x);
      dx = Math.cos(a); dy = Math.sin(a);
    }
    steer(world, m, dx, dy, m.stats.speed * speedMult, dt);
  } else {
    m.vx *= 0.8; m.vy *= 0.8;
    m.facing = Math.atan2(t.y - m.y, t.x - m.x);
    if (m.attackCd <= 0) beginAttack(world, m, t);
  }
}

function wander(world, m, dt) {
  m.wanderTimer -= dt;
  if (m.wanderTimer <= 0) {
    m.wanderTimer = 1.2 + world.rng.float(0, 2.2);
    m.wanderDir = world.rng.bool(0.35) ? world.rng.float(0, TAU) : null;
  }
  if (m.wanderDir == null) {
    m.vx *= 0.86; m.vy *= 0.86;
    return;
  }
  // Drift back toward the spawn point so packs stay where they were placed.
  const home = dist(m.x, m.y, m.leash.x, m.leash.y);
  let dir = m.wanderDir;
  if (home > 220) dir = Math.atan2(m.leash.y - m.y, m.leash.x - m.x);
  steer(world, m, Math.cos(dir), Math.sin(dir), m.stats.speed * 0.35, dt);
}

/**
 * Steering with obstacle whiskers: if the desired direction is blocked, fan out
 * to either side until something is open. Cheap, and enough to keep monsters
 * from grinding into corners when they are too close for the flow field.
 */
function steer(world, m, dx, dy, speed, dt) {
  const mult = movementMult(m);
  if (mult <= 0) { m.vx *= 0.8; m.vy *= 0.8; return; }

  const probe = m.radius + 16;
  let angle = Math.atan2(dy, dx);
  if (!world.canStep(m, m.x + Math.cos(angle) * probe, m.y + Math.sin(angle) * probe)) {
    let found = false;
    for (const off of [0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2]) {
      const a = angle + off;
      if (world.canStep(m, m.x + Math.cos(a) * probe, m.y + Math.sin(a) * probe)) {
        angle = a; found = true; break;
      }
    }
    if (!found) { m.vx *= 0.7; m.vy *= 0.7; return; }
  }

  const target = speed * mult;
  const ax = Math.cos(angle) * target;
  const ay = Math.sin(angle) * target;
  // Accelerate rather than snap so heavy monsters read as heavy.
  const accel = clamp(dt * 9, 0, 1);
  m.vx += (ax - m.vx) * accel;
  m.vy += (ay - m.vy) * accel;
}

function applySeparation(world, m, dt) {
  let sx = 0, sy = 0, n = 0;
  world.forEachNear(m.x, m.y, SEPARATION_RADIUS + m.radius, (other) => {
    if (other === m || other.dead || other.kind === 'npc') return;
    const dx = m.x - other.x, dy = m.y - other.y;
    const dd = Math.hypot(dx, dy);
    const want = m.radius + other.radius;
    if (dd > 0.001 && dd < want) {
      const push = (want - dd) / want;
      sx += (dx / dd) * push;
      sy += (dy / dd) * push;
      n++;
    }
  });
  if (n) {
    const strength = 120 / Math.max(1, m.mass);
    m.vx += sx * strength * dt * 8;
    m.vy += sy * strength * dt * 8;
  }
}

// ---------------------------------------------------------------------------
// Attacks and specials
// ---------------------------------------------------------------------------

function beginAttack(world, m, target) {
  const atk = m.def.attack;
  m.attackCd = atk.cooldown * (m.enraged ? 0.72 : 1);
  m.windup = atk.windup;
  m.facing = Math.atan2(target.y - m.y, target.x - m.x);
  const swing = world.rng.pick(['attack', 'attack2', 'attack3']);
  setAnim(m, world.hasMonsterAnim(m.monsterId, swing) ? swing : 'attack', {
    loop: false, fps: 14, lock: atk.windup + 0.35,
  });
  world.sfxAt(m.x, m.y, atk.projectile ? 'mobShoot' : 'mobSwing');

  m.pendingAttack = () => {
    if (m.dead) return;
    const dmg = m.stats.damage * (atk.coef || 1) * (m.enraged ? 1.35 : 1);
    if (atk.projectile) {
      world.spawnMonsterProjectile(m, {
        angle: m.facing, damage: dmg, type: atk.type,
        ...atk.projectile, range: atk.range,
      });
    } else {
      world.monsterMelee(m, {
        range: atk.range, arc: atk.arc || 1.6, damage: dmg,
        type: atk.type, knockback: atk.knockback || 60,
      });
    }
  };
}

function trySpecials(world, m, target) {
  if (!m.specials || !m.specials.length) return;
  const d = dist(m.x, m.y, target.x, target.y);
  for (const sp of m.specials) {
    if (m.specialCd[sp.id] > 0) continue;
    if (!SPECIALS[sp.id]) continue;
    if (SPECIALS[sp.id](world, m, target, sp, d)) {
      m.specialCd[sp.id] = sp.cooldown;
      return;
    }
  }
}

function tryEnrage(world, m) {
  const sp = (m.specials || []).find((s) => s.id === 'enrage');
  if (!sp || m.enraged) return;
  if (m.hp / m.stats.maxHp <= sp.hpThreshold) {
    m.enraged = true;
    world.applyBuff(m, {
      id: 'enraged', name: 'Enraged', duration: 9999,
      mods: {}, tint: '#ff5533',
    });
    world.spawnFx('ward', m.x, m.y, { color: '#ff4422', radius: m.radius * 2.4, life: 0.6 });
    world.sfxAt(m.x, m.y, 'roar');
    world.floatText(m.x, m.y - m.radius - 24, 'ENRAGED', '#ff5533');
  }
}

const SPECIALS = {
  slam(world, m, target, sp, d) {
    if (d > sp.radius * 0.9) return false;
    m.windup = 0.65;
    setAnim(m, world.hasMonsterAnim(m.monsterId, 'attack3') ? 'attack3' : 'attack2', { loop: false, fps: 12, lock: 1.0 });
    world.telegraphRing(m.x, m.y, sp.radius, 0.65, '#ff6a30');
    world.sfxAt(m.x, m.y, 'windup');
    m.pendingAttack = () => {
      if (m.dead) return;
      world.monsterExplode(m, m.x, m.y, {
        radius: sp.radius, damage: m.stats.damage * sp.coef, type: 'phys',
        knockback: 260, color: '#ff7a40',
      });
      world.sfxAt(m.x, m.y, 'boom');
      world.shake(6);
    };
    return true;
  },

  chargeDash(world, m, target, sp, d) {
    if (d > sp.range || d < 90) return false;
    if (!world.hasLineOfSight(m.x, m.y, target.x, target.y)) return false;
    const angle = Math.atan2(target.y - m.y, target.x - m.x);
    m.facing = angle;
    m.windup = 0.5;
    setAnim(m, 'idle', { loop: true, fps: 14, lock: 0.5 });
    world.telegraphLine(m.x, m.y, angle, Math.min(d + 120, sp.range), 0.5);
    world.sfxAt(m.x, m.y, 'windup');
    m.pendingAttack = () => {
      if (m.dead) return;
      world.startDash(m, angle, sp.speed, 0.42, {
        damage: m.stats.damage * sp.coef, knockback: sp.knockback || 220, type: 'phys',
      });
      world.sfxAt(m.x, m.y, 'dash');
    };
    return true;
  },

  volley(world, m, target, sp, d) {
    if (d > 520) return false;
    m.windup = 0.55;
    setAnim(m, 'attack2', { loop: false, fps: 12, lock: 0.9 });
    m.pendingAttack = () => {
      if (m.dead) return;
      const base = Math.atan2(target.y - m.y, target.x - m.x);
      for (let i = 0; i < sp.count; i++) {
        const a = base + (i / (sp.count - 1) - 0.5) * 1.5;
        world.spawnMonsterProjectile(m, {
          angle: a, damage: m.stats.damage * sp.coef,
          type: sp.magic ? 'magic' : 'phys',
          speed: 320, radius: 10, range: 520,
          glow: sp.magic ? '#b070ff' : null,
          sprite: sp.magic ? null : 'arrow3',
        });
      }
      world.sfxAt(m.x, m.y, 'mobShoot');
    };
    return true;
  },

  summonAdds(world, m, target, sp) {
    if (world.monsterCount() > 260) return false;
    m.windup = 0.8;
    setAnim(m, world.hasMonsterAnim(m.monsterId, 'summon') ? 'summon' : 'attack2', { loop: false, fps: 10, lock: 1.2 });
    world.sfxAt(m.x, m.y, 'summon');
    m.pendingAttack = () => {
      if (m.dead) return;
      for (let i = 0; i < sp.count; i++) {
        const a = (i / sp.count) * TAU + world.rng.float(0, 1);
        const r = 50 + world.rng.float(0, 40);
        world.summonMinion(m, world.rng.pick(sp.minions), m.x + Math.cos(a) * r, m.y + Math.sin(a) * r);
      }
    };
    return true;
  },

  blink(world, m, target, sp, d) {
    if (d > 260) return false;
    const away = Math.atan2(m.y - target.y, m.x - target.x) + world.rng.float(-0.8, 0.8);
    world.blink(m, away, sp.distance);
    world.spawnFx('ward', m.x, m.y, { color: '#a060ff', radius: 30, life: 0.35 });
    world.sfxAt(m.x, m.y, 'blink');
    return true;
  },

  enrage() { return false; }, // handled by tryEnrage
};
