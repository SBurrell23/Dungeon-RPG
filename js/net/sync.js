import { recomputeStats } from '../game/stats.js';
import { getClass } from '../game/classes.js';
import { clamp, dist2 } from '../core/util.js';

/**
 * Client prediction, reconciliation and host-side intent bookkeeping.
 *
 * These are the parts of the netcode that are pure state transforms over a
 * world and an intent - no transport, no DOM - which is what makes the whole
 * host/client handshake testable without PeerJS. `tests/net-sim.js` drives a
 * four-player session through exactly these functions.
 */

// ---------------------------------------------------------------------------
// Intent plumbing
// ---------------------------------------------------------------------------

/**
 * Inputs that describe a *held* state rather than a moment.
 *
 * The distinction matters: a held input is whatever the latest packet says, so
 * releasing the button has to be able to turn it off. An edge-triggered flag is
 * a one-shot that must survive until a tick consumes it, because the client
 * samples at 60 Hz but only ships at 30 Hz and a quick tap lands between sends.
 */
const HELD = ['mx', 'my', 'aim', 'aimX', 'aimY', 'attack'];
const EDGE = ['dash', 'useHp', 'useMp', 'interact'];

/**
 * Host: fold an arriving input packet into what we hold for that player.
 *
 * Held inputs are taken from the packet outright. Edge flags are OR-ed in, so
 * anything the client accumulated between sends still fires, and the tick that
 * runs next clears them via `consumeIntent`.
 */
export function acceptInput(prev, packet) {
  if (!packet) return prev;
  if (!prev) return { ...packet };
  const out = { ...prev };
  for (const k of HELD) out[k] = packet[k];
  for (const k of EDGE) out[k] = !!prev[k] || !!packet[k];
  out.slots = (prev.slots || []).map((v, i) => !!v || !!(packet.slots || [])[i]);
  if (!out.slots.length) out.slots = [...(packet.slots || [false, false, false, false])];
  return out;
}

/**
 * Host: clear the one-shot flags a tick has just acted on, keep the held ones.
 *
 * Held inputs persist deliberately - between two input packets the player is
 * still walking and still holding the attack button - and are replaced wholesale
 * by the next packet.
 */
export function consumeIntent(intent) {
  if (!intent) return intent;
  return {
    ...intent,
    slots: [false, false, false, false],
    dash: false,
    useHp: false,
    useMp: false,
    interact: false,
  };
}

/**
 * How long the host keeps acting on a player's last held input before deciding
 * they have gone quiet.
 *
 * Held inputs persist between packets on purpose - a walking player is still
 * walking - but that only holds while packets keep coming. A client that stops
 * sending (alt-tabbed, so the browser suspends its frame loop; a dropped
 * connection; a stall) would otherwise have its character walk into a wall and
 * swing at nothing indefinitely, which is exactly what "everyone auto-attacks"
 * looks like from the other side of the room.
 */
export const INPUT_TIMEOUT = 0.6;

/** Neutral intent: standing still, holding nothing. */
export function neutralIntent(prev) {
  return {
    ...(prev || {}),
    mx: 0, my: 0, attack: false, dash: false,
    slots: [false, false, false, false],
    useHp: false, useMp: false, interact: false,
  };
}

// ---------------------------------------------------------------------------
// Client-side prediction
// ---------------------------------------------------------------------------

/** Move the local body immediately, so input feels attached to the character. */
export function predictLocal(world, p, intent, dt) {
  if (!p || p.downed) return;
  recomputeStats(p, getClass(p.classId));
  const speed = p.stats.moveSpeed;
  if (intent.mx || intent.my) {
    const k = clamp(dt * 22, 0, 1);
    p.vx += (intent.mx * speed - p.vx) * k;
    p.vy += (intent.my * speed - p.vy) * k;
  } else {
    const k = clamp(dt * 26, 0, 1);
    p.vx += (0 - p.vx) * k;
    p.vy += (0 - p.vy) * k;
  }
  p.facing = intent.aim;
  world.integrate(p, dt);
}

/** Ease the predicted position back onto the host's, or snap if far out. */
export function reconcile(p) {
  if (!p || p.netX == null) return;
  const err2 = dist2(p.x, p.y, p.netX, p.netY);
  if (err2 > 90 * 90) {
    // Too far out to blend - the host knows something we do not (a knockback,
    // a wall we predicted through). Snap.
    p.x = p.netX; p.y = p.netY;
  } else if (err2 > 4) {
    p.x += (p.netX - p.x) * 0.12;
    p.y += (p.netY - p.y) * 0.12;
  }
}
