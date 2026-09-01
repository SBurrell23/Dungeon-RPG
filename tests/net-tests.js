import { NetSim, idle } from './net-sim.js';
import { World } from '../js/game/world.js';
import { acceptInput, consumeIntent, neutralIntent, INPUT_TIMEOUT } from '../js/net/sync.js';
import { applySnapshot, buildSnapshot, buildFloorManifest, applyFloorManifest } from '../js/net/protocol.js';
import { ABILITIES } from '../js/game/abilities.js';
import { setAnim } from '../js/game/entities.js';

const setAnimDeath = (m) => setAnim(m, 'death', { loop: false, fps: 11, lock: 999 });

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

test('a monster born mid-floor reaches the clients', () => {
  // Symptom: "some players see bats that don't exist for other players". A
  // boss summons bats and a slime splits into children, both long after the
  // floor manifest went out, so only the host had them.
  const sim = new NetSim({ seed: 'summon', clients: 2, floor: 2, latency: 0.05 });
  const summoner = sim.host.monsters[0];
  sim.host.summonMinion(summoner, 'bat', summoner.x + 40, summoner.y);
  const born = sim.host.monsters[sim.host.monsters.length - 1];
  if (born.monsterId !== 'bat') throw new Error('summon did not happen; test proves nothing');

  sim.run(60, () => idle());

  for (const c of sim.clients) {
    const m = c.world.byId.get(born.id);
    if (!m) throw new Error('client never learned about the summoned bat');
    if (m.monsterId !== 'bat') throw new Error(`client built a ${m.monsterId}`);
    if (Math.round(m.stats.maxHp) !== Math.round(born.stats.maxHp)) {
      throw new Error(`hp mismatch: ${m.stats.maxHp} vs ${born.stats.maxHp}`);
    }
  }
  return { id: born.id, kind: born.monsterId, onClients: sim.clients.length };
});

test('a dead body rests on its last frame instead of looping', () => {
  // Symptom: on clients, corpses replayed their death animation forever. The
  // snapshot carried anim.key and anim.t but never anim.loop, and the renderer
  // uses loop to decide between wrapping and clamping to the last frame.
  const sim = new NetSim({ seed: 'corpse', clients: 1, floor: 1, latency: 0 });
  const victim = sim.host.monsters.find((m) => !m.dead);
  // Put it next to the party so it stays inside the snapshot's relevance range.
  const p = sim.host.players[0];
  const spot = sim.host.findStandableSpot(p.x + 40, p.y, victim, 6);
  if (spot) { victim.x = spot.x; victim.y = spot.y; }
  sim.host.killActor ? sim.host.killActor(victim) : null;
  victim.hp = 0;
  sim.run(30, () => idle());
  // Whatever route the host took, it should be dead and non-looping by now.
  if (!victim.dead) { victim.dead = true; setAnimDeath(victim); sim.run(20, () => idle()); }
  const cm = sim.clients[0].world.byId.get(victim.id);
  if (!cm) throw new Error('client lost the monster');
  if (cm.anim.key !== victim.anim.key) throw new Error(`anim key ${cm.anim.key} vs host ${victim.anim.key}`);
  if (cm.anim.loop !== victim.anim.loop) {
    throw new Error(`loop flag ${cm.anim.loop} vs host ${victim.anim.loop} - corpse will loop`);
  }
  return { anim: cm.anim.key, loop: cm.anim.loop, hostLoop: victim.anim.loop };
});

test('attack wind-up markers reach the clients', () => {
  // Symptom: only the host saw the red charge and slam warnings, so everyone
  // else was dodging attacks that gave them no tell.
  const sim = new NetSim({ seed: 'telegraph', clients: 2, floor: 3, latency: 0.05 });
  const p = sim.host.players[0];
  sim.host.telegraphLine(p.x, p.y, 0.5, 400, 0.9);
  sim.host.telegraphRing(p.x + 60, p.y, 120, 0.8, '#ff5533');
  sim.run(12, () => idle());
  for (const c of sim.clients) {
    if (c.world.telegraphs.length !== 2) {
      throw new Error(`client has ${c.world.telegraphs.length} telegraphs, expected 2`);
    }
    const line = c.world.telegraphs.find((t) => t.kind === 'line');
    const ring = c.world.telegraphs.find((t) => t.kind === 'circle');
    if (!line || !ring) throw new Error('telegraph shapes did not survive the wire');
    if (Math.abs(line.length - 400) > 1) throw new Error(`line length ${line.length}`);
    if (Math.abs(ring.radius - 120) > 1) throw new Error(`ring radius ${ring.radius}`);
  }
  return sim.clients.map((c) => c.world.telegraphs.map((t) => `${t.kind} ${t.radius || t.length}`));
});

test('a taunt pulls monsters that are already fighting someone else', () => {
  // Symptom: Shield Wall did nothing mid-fight. acquireTarget returned early
  // whenever a monster already had a target, before the taunt was considered.
  const sim = new NetSim({ seed: 'taunt', clients: 3, floor: 2, latency: 0 });
  const tank = sim.host.players[0];
  const victim = sim.host.players[2];
  // Everything is busy chewing on someone who is not the tank.
  const pack = [];
  let n = 0;
  for (const m of sim.host.monsters) {
    if (n >= 10 || m.dead) continue;
    const a = n * 0.7;
    const spot = sim.host.findStandableSpot(victim.x + Math.cos(a) * 60, victim.y + Math.sin(a) * 60, m, 6);
    if (!spot) continue;
    m.x = spot.x; m.y = spot.y; m.target = victim.id;
    pack.push(m); n++;
  }
  if (pack.length < 4) throw new Error('could not stage a pack; test proves nothing');
  // The tank steps in and braces.
  tank.x = victim.x + 30; tank.y = victim.y + 30;
  sim.host.applyBuff(tank, {
    id: 'shieldWall', name: 'Shield Wall', duration: 8,
    damageTaken: 0.55, taunt: true, mods: { armor: 40 },
  });
  sim.run(60, () => idle());
  const pulled = pack.filter((m) => m.target === tank.id).length;
  if (pulled < pack.length) {
    throw new Error(`taunt pulled only ${pulled} of ${pack.length} monsters`);
  }
  return { pack: pack.length, pulledToTank: pulled };
});

test('the relevance cap drops the furthest monsters, not the newest', () => {
  const sim = new NetSim({ seed: 'cap', clients: 1, floor: 8, latency: 0 });
  const p = sim.host.players[0];
  // Park more monsters than the cap around one player.
  let n = 0;
  const near = [];
  for (const m of sim.host.monsters) {
    if (n >= 120) break;
    m.x = p.x + (n % 12) * 20;
    m.y = p.y + Math.floor(n / 12) * 20;
    near.push(m); n++;
  }
  const snap = buildSnapshot(sim.host);
  const sent = new Set(snap.mobs.map((r) => r[0]));
  const dist = (m) => Math.hypot(m.x - p.x, m.y - p.y);
  const sentMax = Math.max(...near.filter((m) => sent.has(m.id)).map(dist));
  const droppedMin = Math.min(...near.filter((m) => !sent.has(m.id)).map(dist), Infinity);
  if (droppedMin < sentMax) {
    throw new Error(`dropped a monster at ${Math.round(droppedMin)}px while sending one at ${Math.round(sentMax)}px`);
  }
  return { staged: near.length, sent: sent.size, furthestSent: Math.round(sentMax) };
});

test('a floor change does not carry monsters into the next floor', () => {
  // Symptom: "non-hosts still see bats that are not really there". loadFloor
  // cleared every other list but not the event queue, so a spawn event from the
  // floor just left was broadcast after clients had applied the new manifest,
  // conjuring a monster on the new floor that the host does not have.
  const sim = new NetSim({ seed: 'straggler', clients: 1, floor: 1, latency: 0 });
  const client = sim.clients[0].world;

  // A boss summons on the old floor, and the party descends before the next
  // snapshot flushes the event.
  const summoner = sim.host.monsters[0];
  sim.host.summonMinion(summoner, 'bat', summoner.x + 40, summoner.y);
  const strayId = sim.host.monsters[sim.host.monsters.length - 1].id;
  const queuedBefore = sim.host.events.filter((e) => e.t === 'spawn').length;
  if (!queuedBefore) throw new Error('no spawn queued; test proves nothing');

  sim.host.loadFloor(2);
  client.loadFloor(2, { keepPlayers: true });
  applyFloorManifest(client, JSON.parse(JSON.stringify(buildFloorManifest(sim.host))));

  // Anything still queued now goes out on the next snapshot.
  sim.run(30, () => idle());

  if (client.byId.get(strayId)) {
    throw new Error('client built a monster from the previous floor');
  }
  const hostIds = new Set(sim.host.monsters.map((m) => m.id));
  const phantoms = client.monsters.filter((m) => !hostIds.has(m.id));
  if (phantoms.length) {
    throw new Error(`${phantoms.length} monsters on the client that the host does not have`);
  }
  return { queuedBefore, hostMonsters: sim.host.monsters.length, clientMonsters: client.monsters.length };
});

test('a sprung trap is spent on the clients too', () => {
  // Symptom: trap state only ever travelled in the once-per-floor manifest, so
  // on a client every trap stayed armed and visible for the whole run.
  const sim = new NetSim({ seed: 'trapsync', clients: 2, floor: 4, latency: 0.05 });
  const trap = sim.host.dungeon.props.find(
    (t) => t.type === 'trap' && t.kind !== 'flame' && t.kind !== 'poison');
  if (!trap) throw new Error('no one-shot trap on this floor');
  const p = sim.host.players[0];
  const c = sim.host.dungeon.tileCenter(trap.x, trap.y);
  p.x = c.x; p.y = c.y; p.px = p.x; p.py = p.y;

  sim.run(60, (i, tick, pl) => ({ ...idle(), aimX: pl.x + 60, aimY: pl.y }));

  if (!trap.spent) throw new Error('the trap never fired; test proves nothing');
  for (const cl of sim.clients) {
    const cp = cl.world.dungeon.props.find((t) => t.type === 'trap' && t.x === trap.x && t.y === trap.y);
    if (!cp) throw new Error('client has no such trap');
    if (!cp.spent || cp.armed) {
      throw new Error(`client trap still armed (armed=${cp.armed}, spent=${!!cp.spent})`);
    }
  }
  return { kind: trap.kind, hostSpent: trap.spent, clientsSpent: sim.clients.length };
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
