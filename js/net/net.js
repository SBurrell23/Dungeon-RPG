import { MSG } from './protocol.js';

/**
 * PeerJS transport.
 *
 * Topology is a star: everyone connects to the host, the host relays. That is
 * the right shape for an authoritative simulation and it keeps connection count
 * linear instead of quadratic.
 *
 * The class deliberately knows nothing about the game - it moves tagged
 * envelopes and reports connection changes.
 */

const ID_PREFIX = 'dungeonrpg-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.online = false;
    this.roomCode = null;
    this.conns = new Map();       // peerId -> DataConnection (host side)
    this.hostConn = null;         // client side
    this.handlers = new Map();
    this.onStatus = () => {};
    this.onPeerJoin = () => {};
    this.onPeerLeave = () => {};
    this.myPeerId = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  _dispatch(peerId, msg) {
    if (!msg || !msg.t) return;
    const set = this.handlers.get(msg.t);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(msg.d, peerId); } catch (err) { console.error(`[net] handler ${msg.t}`, err); }
    }
  }

  // -------------------------------------------------------------------------
  // Host
  // -------------------------------------------------------------------------

  /** Resolves with the short room code others type in to join. */
  host() {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') {
        reject(new Error('PeerJS failed to load. Check your connection, or play solo.'));
        return;
      }
      // Retry on id collision - short codes collide occasionally by design.
      const attempt = (triesLeft) => {
        const code = makeCode();
        const peer = new window.Peer(ID_PREFIX + code, { debug: 1 });

        peer.on('open', (id) => {
          this.peer = peer;
          this.isHost = true;
          this.online = true;
          this.roomCode = code;
          this.myPeerId = id;
          this.onStatus(`Hosting as ${code}`);
          resolve(code);
        });

        peer.on('connection', (conn) => this._acceptConnection(conn));

        peer.on('error', (err) => {
          if (err.type === 'unavailable-id' && triesLeft > 0) {
            peer.destroy();
            attempt(triesLeft - 1);
            return;
          }
          this.onStatus(`Network error: ${err.type}`);
          if (!this.online) reject(err);
        });

        peer.on('disconnected', () => {
          this.onStatus('Disconnected - reconnecting…');
          if (!peer.destroyed) peer.reconnect();
        });
      };
      attempt(4);
    });
  }

  _acceptConnection(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this.onStatus(`${this.conns.size + 1} in party`);
      this.onPeerJoin(conn.peer);
    });
    conn.on('data', (msg) => this._dispatch(conn.peer, msg));
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      this.onPeerLeave(conn.peer);
      this.onStatus(`${this.conns.size + 1} in party`);
    });
    conn.on('error', () => {
      this.conns.delete(conn.peer);
      this.onPeerLeave(conn.peer);
    });
  }

  // -------------------------------------------------------------------------
  // Client
  // -------------------------------------------------------------------------

  join(code) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') {
        reject(new Error('PeerJS failed to load. Check your connection, or play solo.'));
        return;
      }
      const clean = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!clean) { reject(new Error('Enter a room code.')); return; }

      const peer = new window.Peer(undefined, { debug: 1 });
      let settled = false;

      const fail = (msg) => {
        if (settled) return;
        settled = true;
        try { peer.destroy(); } catch { /* already gone */ }
        reject(new Error(msg));
      };

      const timeout = setTimeout(() => fail('Could not reach that room. Check the code.'), 15000);

      peer.on('open', () => {
        this.myPeerId = peer.id;
        const conn = peer.connect(ID_PREFIX + clean, { reliable: true });
        conn.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.peer = peer;
          this.hostConn = conn;
          this.isHost = false;
          this.online = true;
          this.roomCode = clean;
          this.onStatus(`Connected to ${clean}`);
          resolve(clean);
        });
        conn.on('data', (msg) => this._dispatch('host', msg));
        conn.on('close', () => {
          this.online = false;
          this.onStatus('Host disconnected.');
          this._dispatch('host', { t: MSG.KICK, d: { reason: 'Host disconnected.' } });
        });
        conn.on('error', () => fail('Connection failed.'));
      });

      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') fail('No room with that code.');
        else fail(`Network error: ${err.type}`);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /** Client -> host. */
  send(type, data) {
    if (this.isHost || !this.hostConn || !this.hostConn.open) return false;
    try { this.hostConn.send({ t: type, d: data }); return true; } catch { return false; }
  }

  /** Host -> everyone. */
  broadcast(type, data) {
    if (!this.isHost) return;
    const msg = { t: type, d: data };
    for (const conn of this.conns.values()) {
      if (conn.open) {
        try { conn.send(msg); } catch { /* dropped frame; next tick carries state */ }
      }
    }
  }

  /** Host -> one peer. */
  sendTo(peerId, type, data) {
    const conn = this.conns.get(peerId);
    if (!conn || !conn.open) return false;
    try { conn.send({ t: type, d: data }); return true; } catch { return false; }
  }

  peerCount() { return this.isHost ? this.conns.size : (this.online ? 1 : 0); }

  close() {
    for (const c of this.conns.values()) { try { c.close(); } catch { /* noop */ } }
    this.conns.clear();
    try { this.hostConn?.close(); } catch { /* noop */ }
    this.hostConn = null;
    try { this.peer?.destroy(); } catch { /* noop */ }
    this.peer = null;
    this.online = false;
    this.isHost = false;
    this.roomCode = null;
  }
}
