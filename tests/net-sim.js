import { World } from '../js/game/world.js';
import { CLASS_ORDER } from '../js/game/classes.js';
import { mergeIntents } from '../js/core/input.js';
import { acceptInput, consumeIntent, predictLocal, reconcile } from '../js/net/sync.js';
import {
  SNAPSHOT_HZ, INPUT_HZ, PERSONAL_HZ,
  buildSnapshot, applySnapshot,
  buildFloorManifest, applyFloorManifest,
  serialisePlayerFull, applyPlayerFull,
  buildPersonal, applyPersonal, selfSignature,
} from '../js/net/protocol.js';

/**
 * A four-player session with the transport taken out.
 *
 * PeerJS is the one part of multiplayer that cannot be tested offline, and it
 * is also the part least likely to be wrong - it moves tagged envelopes. What
 * breaks is everything either side does to a world before and after those
 * envelopes: which intent the host believes a player is holding, what the
 * snapshot chooses to carry, what the client does with it.
 *
 * So this runs one authoritative host world and three client worlds in the same
 * process, wired together by direct calls through the real protocol functions,
 * at the real rates, with a configurable delay. Every desync it reports is a
 * desync the game has.
 */

const HOST_ID = 'peer-host';

export class NetSim {
  /**
   * @param {object} opts
   * @param {number} [opts.clients]  extra players beyond the host
   * @param {number} [opts.latency]  one-way delay in seconds
   */
  constructor({ seed = 'netsim', clients = 3, latency = 0.05, floor = 1 } = {}) {
    this.dt = 1 / 60;
    this.time = 0;
    this.tick = 0;
    this.latency = latency;
    this.wire = [];            // [deliverAt, target, type, payload]
    this.stats = { snapshots: 0, inputs: 0, personal: 0, selfs: 0, bytes: 0 };

    const roster = [];
    for (let i = 0; i < clients + 1; i++) {
      roster.push({ peerId: i === 0 ? HOST_ID : `peer-${i}`, classId: CLASS_ORDER[i % CLASS_ORDER.length] });
    }
    this.roster = roster;

    // --- host world -------------------------------------------------------
    this.host = new World({ seed, isHost: true });
    for (const r of roster) {
      this.host.addPlayer({ peerId: r.peerId, name: r.peerId, classId: r.classId, local: r.peerId === HOST_ID });
    }
    this.host.loadFloor(floor);
    this.hostIntents = new Map();
    this.selfSigs = new Map();
    this.hostLocal = this.host.players[0];

    // --- client worlds ----------------------------------------------------
    this.clients = [];
    const manifest = buildFloorManifest(this.host);
    for (let i = 1; i < roster.length; i++) {
      const w = new World({ seed, isHost: false });
      for (const r of roster) {
        const p = w.addPlayer({ peerId: r.peerId, name: r.peerId, classId: r.classId });
        w.byId.delete(p.id);
        p.id = this.host.players[roster.indexOf(r)].id;
        w.byId.set(p.id, p);
      }
      w.loadFloor(floor, { keepPlayers: true });
      applyFloorManifest(w, manifest);
      const local = w.players[i];
      w.localPlayer = local;
      // The host ships a full SELF at run start.
      for (const hp of this.host.players) {
        const cp = w.byId.get(hp.id);
        if (cp) applyPlayerFull(cp, serialisePlayerFull(hp));
      }
      this.clients.push({ world: w, local, pending: null, sendAcc: 0, peerId: roster[i].peerId });
    }

    this.snapAcc = 0;
    this.personalAcc = 0;
  }

  // -------------------------------------------------------------------------

  _post(target, type, payload) {
    // Structured-clone the payload the way a real send would, so a test can
    // never accidentally pass a live object reference between worlds.
    this.wire.push([this.time + this.latency, target, type, JSON.parse(JSON.stringify(payload))]);
    this.stats.bytes += JSON.stringify(payload).length;
  }

  _deliver() {
    const due = this.wire.filter((m) => m[0] <= this.time);
    if (!due.length) return;
    this.wire = this.wire.filter((m) => m[0] > this.time);
    for (const [, target, type, payload] of due) {
      if (target === 'host') {
        if (type === 'input') {
          const p = this.host.players.find((pl) => pl.peerId === payload.peerId);
          if (p) this.hostIntents.set(p.id, acceptInput(this.hostIntents.get(p.id), payload.intent));
        }
        continue;
      }
      const c = this.clients[target];
      if (type === 'snap') applySnapshot(c.world, payload);
      else if (type === 'mine') {
        const p = c.world.byId.get(payload.id);
        if (p) applyPersonal(p, payload);
      } else if (type === 'self') {
        const p = c.world.byId.get(payload.id);
        if (p) applyPlayerFull(p, payload);
      }
    }
  }

  /**
   * Advance one 60 Hz tick. `intentFor(playerIndex, tick)` supplies input, so a
   * test can script a scenario (everyone attacks, then nobody does).
   */
  step(intentFor) {
    const dt = this.dt;
    this.time += dt;
    this._deliver();

    // --- clients: sample, predict, ship ----------------------------------
    this.clients.forEach((c, i) => {
      const intent = intentFor(i + 1, this.tick, c.local);
      c.pending = mergeIntents(c.pending, intent);
      c.sendAcc += dt;
      if (c.sendAcc >= 1 / INPUT_HZ) {
        c.sendAcc = 0;
        this._post('host', 'input', { peerId: c.peerId, intent: c.pending });
        this.stats.inputs++;
        c.pending = null;
      }
      predictLocal(c.world, c.local, intent, dt);
      c.world.update(dt, null);
      reconcile(c.local);
    });

    // --- host: simulate ---------------------------------------------------
    this.hostIntents.set(this.hostLocal.id, intentFor(0, this.tick, this.hostLocal));
    this.host.update(dt, this.hostIntents);
    for (const [id, v] of this.hostIntents) this.hostIntents.set(id, consumeIntent(v));

    // --- host: broadcast --------------------------------------------------
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAPSHOT_HZ) {
      this.snapAcc = 0;
      const snap = buildSnapshot(this.host);
      this.clients.forEach((_, i) => this._post(i, 'snap', snap));
      this.stats.snapshots++;
      this.host.drainEvents();
    }
    this.personalAcc += dt;
    if (this.personalAcc >= 1 / PERSONAL_HZ) {
      this.personalAcc = 0;
      this.host.players.forEach((p, idx) => {
        if (idx === 0) return;
        const sig = selfSignature(p);
        if (this.selfSigs.get(p.id) !== sig) {
          this.selfSigs.set(p.id, sig);
          this._post(idx - 1, 'self', serialisePlayerFull(p));
          this.stats.selfs++;
        } else {
          this._post(idx - 1, 'mine', buildPersonal(p));
          this.stats.personal++;
        }
      });
    }
    this.tick = (this.tick || 0) + 1;
  }

  run(ticks, intentFor) {
    for (let i = 0; i < ticks; i++) this.step(intentFor);
    // Let anything still on the wire land, so a measurement taken right after
    // a run is not reading a state the client simply has not received yet.
    for (let i = 0; i < 30; i++) { this.time += this.dt; this._deliver(); }
    return this;
  }

  // -------------------------------------------------------------------------
  // Measurements
  // -------------------------------------------------------------------------

  /** Per-client view of its own player versus the host's copy. */
  divergence() {
    return this.clients.map((c, i) => {
      const hp = this.host.players[i + 1];
      const cp = c.local;
      return {
        client: i + 1,
        cls: hp.classId,
        posError: Math.round(Math.hypot(hp.x - cp.x, hp.y - cp.y)),
        xpHost: hp.xp, xpClient: cp.xp, xpMatch: hp.xp === cp.xp,
        levelMatch: hp.level === cp.level,
        goldHost: hp.gold, goldClient: cp.gold, goldMatch: hp.gold === cp.gold,
        mpHost: Math.round(hp.mp), mpClient: Math.round(cp.mp),
        mpError: Math.abs(Math.round(hp.mp) - Math.round(cp.mp)),
        bagHost: hp.inventory.length, bagClient: cp.inventory.length,
        bagMatch: hp.inventory.length === cp.inventory.length,
        cooldownsShown: Object.values(cp.cooldowns).filter((v) => v > 0.05).length,
        cooldownsHost: Object.values(hp.cooldowns).filter((v) => v > 0.05).length,
      };
    });
  }

  /** How well do clients track monster positions? */
  monsterSync() {
    const out = [];
    for (const c of this.clients) {
      let n = 0, sum = 0, worst = 0, stationary = 0, live = 0;
      for (const hm of this.host.monsters) {
        if (hm.dead) continue;
        const cm = c.world.byId.get(hm.id);
        if (!cm) continue;
        live++;
        // Only judge monsters the host considers near enough to send.
        const near = this.host.players.some((p) => Math.hypot(hm.x - p.x, hm.y - p.y) < 900);
        if (!near) continue;
        n++;
        const e = Math.hypot(hm.x - cm.x, hm.y - cm.y);
        sum += e; worst = Math.max(worst, e);
        if (cm.tx == null) stationary++;
      }
      out.push({
        tracked: n, liveKnown: live,
        meanErrorPx: n ? +(sum / n).toFixed(1) : 0,
        worstErrorPx: Math.round(worst),
        neverUpdated: stationary,
      });
    }
    return out;
  }

  /** Did anyone attack without being told to? */
  attackAudit() {
    return this.host.players.map((p, i) => ({
      player: i, cls: p.classId, swings: p.stat?.swings ?? null,
    }));
  }
}

/** Handy scripted intents. */
export const IDLE = {
  mx: 0, my: 0, aim: 0, aimX: 0, aimY: 0, attack: false, dash: false,
  slots: [false, false, false, false], useHp: false, useMp: false, interact: false,
};

export function idle() { return { ...IDLE, slots: [false, false, false, false] }; }

export function walking(i, tick, p) {
  const a = tick * 0.02 + i * 1.7;
  return { ...idle(), mx: Math.cos(a), my: Math.sin(a * 1.3), aim: a, aimX: p.x + 60, aimY: p.y };
}
