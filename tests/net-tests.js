import { NetSim, idle } from './net-sim.js';
import { World } from '../js/game/world.js';
import { acceptInput, consumeIntent, neutralIntent, INPUT_TIMEOUT } from '../js/net/sync.js';
import { applySnapshot, buildSnapshot, buildFloorManifest, applyFloorManifest } from '../js/net/protocol.js';
import { ABILITIES } from '../js/game/abilities.js';

/**
 * Regression tests for the four-player session.
 *
 * Each case is named after the symptom it used to produce, because that is how
 * they will be recognised if they ever come back.
 */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------------------

/** Stage a fight: drag a pack of monsters onto the party. */
function engage(sim, count = 24) {
  const party = sim.host.players;
  let n = 0;
  for (const m of sim.host.monsters) {
    if (n >= count || m.dead) continue;
    const p = party[n % party.length];
    const a = n * 0.9;
    const spot = sim.host.findStandableSpot(p.x + Math.cos(a) * 70, p.y + Math.sin(a) * 70, m, 6);
    if (!spot) continue;
    m.x = spot.x; m.y = spot.y; m.px = m.x; m.py = m.y; m.target = p.id;
    n++;
  }
  return n;
}

/** Walk at the nearest monster and swing at it. */
const brawl = (sim) => (i, tick, p) => {
  let best = null, bd = Infinity;
  for (const m of sim.host.monsters) {
    if (m.dead) continue;
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    if (d < bd) { bd = d; best = m; }
  }
  const a = best ? Math.atan2(best.y - p.y, best.x - p.x) : 0;
  const slot = tick % 120 === 0 ? (tick / 120 | 0) % 4 : -1;
  return {
    ...idle(),
    mx: bd > 60 ? Math.cos(a) : 0, my: bd > 60 ? Math.sin(a) : 0, aim: a,
    aimX: best ? best.x : p.x + 60, aimY: best ? best.y : p.y,
    attack: bd < 130, slots: [0, 1, 2, 3].map((s) => s === slot),
  };
};

// ---------------------------------------------------------------------------

test('a held input is released when the client stops sending it', () => {
  // Symptom: every remote player attacked continuously, forever, after one click.
  const base = {
    mx: 0, my: 0, aim: 0, aimX: 0, aimY: 0, attack: false, dash: false,
    slots: [false, false, false, false], useHp: false, useMp: false, interact: false,
  };
  let held = null;
  const on = [];
  for (let tick = 0; tick < 12; tick++) {
    if (tick % 2 === 0) held = acceptInput(held, { ...base, attack: tick === 0, dash: tick === 0 });
    if (held.attack) on.push(tick);
    held = consumeIntent(held);
  }
  // Pressed on tick 0 only; it may stay held until the next packet (tick 2).
  if (on.length > 2) throw new Error(`attack latched on for ticks ${on.join(',')}`);
  return { attackActiveTicks: on };
});

test('an edge-triggered flag fires exactly once', () => {
  // Symptom: remote players dashed continuously - `dash` was never cleared.
  const base = {
    mx: 0, my: 0, aim: 0, aimX: 0, aimY: 0, attack: false, dash: false,
    slots: [false, false, false, false], useHp: false, useMp: false, interact: false,
  };
  let held = acceptInput(null, { ...base, dash: true, slots: [true, false, false, false] });
  let dashes = 0, casts = 0;
  for (let tick = 0; tick < 10; tick++) {
    if (held.dash) dashes++;
    if (held.slots[0]) casts++;
    held = consumeIntent(held);
    if (tick % 2 === 1) held = acceptInput(held, base);
  }
  if (dashes !== 1 || casts !== 1) throw new Error(`dash fired ${dashes}x, slot fired ${casts}x; expected 1 each`);
  return { dashes, casts };
});

test('the aim point survives the trip to the host', () => {
  // Symptom: remote players' aimed abilities fired at a stale target, because
  // mergeIntents rebuilt the intent without aimX/aimY.
  const packet = {
    mx: 1, my: 0, aim: 0.5, aimX: 1234, aimY: 5678, attack: true, dash: false,
    slots: [false, false, false, false], useHp: false, useMp: false, interact: false,
  };
  const held = acceptInput(null, packet);
  const after = consumeIntent(held);
  if (after.aimX !== 1234 || after.aimY !== 5678) {
    throw new Error(`aim point lost: ${after.aimX},${after.aimY}`);
  }
  return { aimX: after.aimX, aimY: after.aimY };
});

test('a client sees its own mana drain', () => {
  // Symptom: a client never simulates its own casting, so its mana bar simply
  // regenerated to full while the host had it spending on every attack.
  const w = new World({ seed: 'mana', isHost: false });
  const p = w.addPlayer({ id: 'x', name: 'x', classId: 'wizard', local: true });
  w.loadFloor(1, { keepPlayers: true });
  w.localPlayer = p;
  p.mp = p.stats.maxMp;
  applySnapshot(w, {
    players: [[p.id, Math.round(p.x), Math.round(p.y), 0, Math.round(p.hp), 7,
      p.anim.key, 0, p.level, 0, 0, Math.round(p.stats.maxHp), Math.round(p.stats.maxMp)]],
    mobs: [], projectiles: [], pickups: [], zones: [],
    descent: [0, 0, 0], shake: 0,
  });
  if (p.mp !== 7) throw new Error(`local mana not applied from snapshot: ${p.mp}`);
  return { mp: p.mp };
});

test('xp, gold and cooldowns reach the client during a fight', () => {
  // Symptom: the XP bar never moved on a client. These only travelled inside
  // the full SELF message, sent on inventory actions and floor changes.
  const sim = new NetSim({ seed: 'xpsync', clients: 3, floor: 3, latency: 0.06 });
  for (const w of [sim.host, ...sim.clients.map((c) => c.world)]) {
    for (const p of w.players) p.level = 16;
  }
  engage(sim);
  sim.run(2400, brawl(sim));
  const d = sim.divergence();
  const bad = d.filter((r) => !r.xpMatch || !r.goldMatch || !r.levelMatch || r.mpError > 2);
  if (!sim.host.players[1].xp) throw new Error('test staged no kills, so it proves nothing');
  if (bad.length) throw new Error(`desynced: ${JSON.stringify(bad)}`);
  return { xp: d[0].xpHost, rows: d.map((r) => `${r.cls}: xp ${r.xpClient}/${r.xpHost}, mp err ${r.mpError}`) };
});

test('clients track monster positions', () => {
  // Symptom: "monsters stand still".
  const sim = new NetSim({ seed: 'mobsync', clients: 3, floor: 5, latency: 0.06 });
  for (const w of [sim.host, ...sim.clients.map((c) => c.world)]) {
    for (const p of w.players) p.level = 16;
  }
  engage(sim);
  sim.run(1800, brawl(sim));
  const rows = sim.monsterSync();
  for (const r of rows) {
    if (r.tracked < 5) throw new Error(`only ${r.tracked} monsters in range; test proves nothing`);
    if (r.neverUpdated > 0) throw new Error(`${r.neverUpdated} nearby monsters never received a position`);
    if (r.worstErrorPx > 60) throw new Error(`monster position error ${r.worstErrorPx}px`);
  }
  return rows;
});

test('a monster the host retires disappears on clients', () => {
  // Symptom: corpses the host had cleaned up stayed on clients for the run.
  const sim = new NetSim({ seed: 'gone', clients: 1, floor: 1, latency: 0 });
  const victim = sim.host.monsters[0];
  const id = victim.id;
  if (!sim.clients[0].world.byId.get(id)) throw new Error('client never knew this monster');
  victim.dead = true;
  victim.expired = true;
  sim.host.monsters = sim.host.monsters.filter((m) => m !== victim);
  sim.host.byId.delete(id);
  sim.host.removedIds.push(id);
  const snap = buildSnapshot(sim.host);
  applySnapshot(sim.clients[0].world, JSON.parse(JSON.stringify(snap)));
  if (sim.clients[0].world.byId.get(id)) throw new Error('client still holds the retired monster');
  return { removed: id };
});

test('changing floors does not leak the previous floor into the id index', () => {
  const sim = new NetSim({ seed: 'floors', clients: 1, floor: 1, latency: 0 });
  const client = sim.clients[0].world;
  const before = client.byId.size;
  sim.host.loadFloor(2);
  client.loadFloor(2, { keepPlayers: true });
  applyFloorManifest(client, JSON.parse(JSON.stringify(buildFloorManifest(sim.host))));
  const after = client.byId.size;
  const monsters = client.monsters.length;
  // Index should hold this floor's entities, not both floors'.
  if (after > monsters + client.npcs.length + client.players.length + 4) {
    throw new Error(`id index holds ${after} for ${monsters} monsters - previous floor leaked`);
  }
  return { before, after, monsters };
});

test('a four-player party stays in sync over a long run with latency', () => {
  const sim = new NetSim({ seed: 'soak', clients: 3, floor: 4, latency: 0.12 });
  const tomes = Object.keys(ABILITIES).filter((k) => ABILITIES[k].cooldown > 0.8).slice(0, 4);
  for (const w of [sim.host, ...sim.clients.map((c) => c.world)]) {
    for (const p of w.players) { p.level = 18; p.hotbar = [...tomes]; p.knownSpells = [...tomes]; }
  }
  engage(sim);
  sim.run(5400, brawl(sim));          // 90 seconds
  const d = sim.divergence();
  const bad = d.filter((r) => !r.xpMatch || !r.goldMatch || !r.bagMatch || r.posError > 40 || r.mpError > 3);
  if (bad.length) throw new Error(`desynced: ${JSON.stringify(bad)}`);
  return { posErrors: d.map((r) => r.posError), mpErrors: d.map((r) => r.mpError), stats: sim.stats };
});

test('a client that goes quiet stops acting', () => {
  // Symptom: an alt-tabbed player kept walking and swinging, because the
  // browser suspends a hidden tab's frame loop so it stops sending input while
  // the host went on applying the last thing it held.
  const sim = new NetSim({ seed: 'quiet', clients: 1, floor: 1, latency: 0.05 });
  const target = sim.host.players[1];
  const seen = new Map();
  const held = () => sim.hostIntents.get(target.id);

  // 2 seconds of walking and attacking, then the client falls silent.
  for (let t = 0; t < 120; t++) {
    sim.step((i) => (i === 1
      ? { ...idle(), mx: 1, my: 0, attack: true }
      : idle()));
    seen.set(target.id, sim.host.runTime);
  }
  if (!held()?.attack) throw new Error('setup failed: host is not holding an attack');

  // Now nothing arrives. Mimic main.js's timeout sweep.
  let cleared = -1;
  for (let t = 0; t < 120; t++) {
    sim.step(() => idle());
    const h = held();
    if (sim.host.runTime - (seen.get(target.id) ?? 0) > INPUT_TIMEOUT && h && (h.attack || h.mx)) {
      sim.hostIntents.set(target.id, neutralIntent(h));
    }
    if (cleared < 0 && !held()?.attack && !held()?.mx) cleared = t / 60;
  }
  if (cleared < 0) throw new Error('held input never released after the client went quiet');
  if (cleared > INPUT_TIMEOUT + 0.2) throw new Error(`took ${cleared}s to release`);
  return { releasedAfterSeconds: +cleared.toFixed(2), timeout: INPUT_TIMEOUT };
});

// ---------------------------------------------------------------------------

export function runNetTests() {
  const results = [];
  for (const t of tests) {
    try {
      const detail = t.fn();
      results.push({ name: t.name, pass: true, detail });
    } catch (err) {
      results.push({ name: t.name, pass: false, error: String(err && err.message || err) });
    }
  }
  return { passed: results.filter((r) => r.pass).length, total: results.length, results };
}
