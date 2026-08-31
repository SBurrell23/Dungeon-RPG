import { assets } from './assets/loader.js';
import { Input, mergeIntents, EMPTY_INTENT } from './core/input.js';
import { GameLoop } from './core/loop.js';
import { bus } from './core/events.js';
import { randomSeedString } from './core/rng.js';
import { clamp, dist2 } from './core/util.js';

import { World, FLOOR_COUNT } from './game/world.js';
import { getClass } from './game/classes.js';
import { recomputeStats } from './game/stats.js';
import { getAbility } from './game/abilities.js';
import { SELL_RATE } from './game/items.js';
import { bossForFloor } from './game/monsters.js';
import { saveWorld, loadIntoWorld, hasSave, readSaveMeta, deleteSave } from './game/save.js';

import { Camera } from './render/camera.js';
import { TileMap } from './render/tilemap.js';
import { Renderer } from './render/renderer.js';

import { Minimap } from './ui/minimap.js';
import { Hud } from './ui/hud.js';
import { Panels } from './ui/panels.js';
import { Lobby } from './ui/lobby.js';
import { showEndScreen } from './ui/endscreen.js';
import {
  $, showScreen, hideScreen, isScreenOpen, anyModalOpen, closeAllModals,
  setHudVisible, toast, pushLogLine, clearLog, bindButtonSounds, hideTooltip, el, escapeHtml,
} from './ui/ui.js';

import { initAudio, resumeAudio, playSfx, setSfxVolume } from './audio/sfx.js';
import { initMusic, startMusic, setMusicVolume, setDepth } from './audio/music.js';

import { Net } from './net/net.js';
import {
  MSG, SNAPSHOT_HZ, INPUT_HZ, buildSnapshot, applySnapshot,
  buildFloorManifest, applyFloorManifest, serialisePlayerFull, applyPlayerFull,
} from './net/protocol.js';

// ---------------------------------------------------------------------------
// Boot state
// ---------------------------------------------------------------------------

const canvas = $('#game');
const input = new Input(canvas);
const camera = new Camera(canvas);
const tilemap = new TileMap(assets);
const renderer = new Renderer(canvas, assets, tilemap);
const net = new Net();
const hud = new Hud();

const game = {
  mode: 'boot',            // boot | menu | lobby | playing | end
  world: null,
  localPlayer: null,
  minimap: null,
  panels: null,
  lobby: null,
  roster: [],              // lobby entries: {peerId, name, classId, ready, isHost}
  intents: new Map(),      // playerId -> merged intent (host)
  pendingIntent: null,     // client-side accumulator
  playerName: 'Adventurer',
  isOnline: false,
  spectateIndex: 0,
  lastSnapshot: 0,
  lastInputSend: 0,
  lastSave: 0,
  shakeEnabled: true,
  aimWorld: { x: 0, y: 0 },
};

// Handy for poking at a live run from the console.
window.DUNGEON = Object.assign(game, { camera, renderer, tilemap, assets, net, input });

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.resize(Math.floor(window.innerWidth * dpr), Math.floor(window.innerHeight * dpr));
  canvas.style.width = '100%';
  canvas.style.height = '100%';
}
window.addEventListener('resize', resize);
resize();

async function boot() {
  bindButtonSounds();
  bindMenu();
  bindHotkeys();
  bindGameEvents();

  await assets.loadAll((done, total, key) => {
    $('#loadfill').style.width = `${(done / total) * 100}%`;
    $('#loadstatus').textContent = `Loading ${key.replace(/:/g, ' ')} (${done}/${total})`;
  });

  if (assets.errors.length) {
    console.warn('[assets] missing:', assets.errors);
    $('#loadstatus').textContent = `${assets.errors.length} art files missing - check the console.`;
  }

  game.lobby = new Lobby({
    onSelect: (classId) => { if (game.isOnline) net.send(MSG.SELECT, { classId, ready: game.lobby.ready }); },
    onReady: (ready, classId) => onLobbyReady(ready, classId),
    onBegin: (seed) => hostBeginRun(seed),
    onLeave: () => leaveToMenu(),
  });
  game.lobby.refreshPortraits();

  game.panels = new Panels(makeActions());

  loop.start();
  goToMenu();
}

function goToMenu() {
  game.mode = 'menu';
  setHudVisible(false);
  closeAllModals();
  showScreen('screen-menu');
  refreshSaveSlot();
}

function refreshSaveSlot() {
  const slot = $('#saveslot');
  const meta = hasSave() ? readSaveMeta() : null;
  if (!meta) { slot.classList.add('hidden'); return; }
  slot.classList.remove('hidden');
  const when = new Date(meta.savedAt).toLocaleString();
  const party = meta.party.map((p) => `${escapeHtml(p.name)} (${getClass(p.classId).name} ${p.level})`).join(', ');
  $('#saveinfo').innerHTML = `<b>Saved run</b> &middot; Floor ${meta.floor} &middot; ${when}<br><span class="dim">${party}</span>`;
}

// ---------------------------------------------------------------------------
// Menu wiring
// ---------------------------------------------------------------------------

function bindMenu() {
  const nameInput = $('#input-name');
  nameInput.value = localStorage.getItem('dungeonrpg.name') || '';

  const grabName = () => {
    game.playerName = (nameInput.value.trim() || 'Adventurer').slice(0, 14);
    localStorage.setItem('dungeonrpg.name', game.playerName);
    firstGesture();
  };

  $('#btn-solo').addEventListener('click', () => {
    grabName();
    game.isOnline = false;
    game.roster = [{ peerId: 'local', name: game.playerName, classId: 'knight', ready: false, isHost: true }];
    game.lobby.open({ isHost: true, roomCode: 'SOLO' });
    game.lobby.renderRoster(game.roster);
  });

  $('#btn-host').addEventListener('click', async () => {
    grabName();
    $('#btn-host').disabled = true;
    $('#netstatus').textContent = 'Opening room…';
    try {
      const code = await net.host();
      game.isOnline = true;
      game.roster = [{ peerId: net.myPeerId, name: game.playerName, classId: 'knight', ready: false, isHost: true }];
      game.lobby.open({ isHost: true, roomCode: code });
      game.lobby.renderRoster(game.roster);
      $('#netstatus').textContent = `Room ${code} open`;
    } catch (err) {
      $('#netstatus').textContent = err.message;
      toast(err.message, 4000);
    } finally {
      $('#btn-host').disabled = false;
    }
  });

  $('#btn-join').addEventListener('click', async () => {
    grabName();
    $('#btn-join').disabled = true;
    $('#netstatus').textContent = 'Connecting…';
    try {
      const code = await net.join($('#input-code').value);
      game.isOnline = true;
      net.send(MSG.HELLO, { name: game.playerName, classId: game.lobby.selected });
      game.lobby.open({ isHost: false, roomCode: code });
      $('#netstatus').textContent = `Joined ${code}`;
    } catch (err) {
      $('#netstatus').textContent = err.message;
      toast(err.message, 4000);
    } finally {
      $('#btn-join').disabled = false;
    }
  });

  $('#btn-continue').addEventListener('click', () => {
    firstGesture();
    resumeSavedRun();
  });
  $('#btn-delete').addEventListener('click', () => { deleteSave(); refreshSaveSlot(); });

  $('#btn-options').addEventListener('click', () => showScreen('screen-options', { exclusive: false }));
  $('#btn-optclose').addEventListener('click', () => hideScreen('screen-options'));
  $('#btn-endmenu').addEventListener('click', () => leaveToMenu());

  $('#opt-music').addEventListener('input', (e) => setMusicVolume(e.target.value / 100));
  $('#opt-sfx').addEventListener('input', (e) => setSfxVolume(e.target.value / 100));
  $('#opt-zoom').addEventListener('input', (e) => { camera.targetZoom = e.target.value / 100; });
  $('#opt-light').addEventListener('change', (e) => { renderer.enableLighting = e.target.checked; });
  $('#opt-shake').addEventListener('change', (e) => { game.shakeEnabled = e.target.checked; });

  $('#btn-closemap').addEventListener('click', () => toggleMap(false));
  $('#btn-descend-no').addEventListener('click', () => hideScreen('screen-descend'));
  $('#btn-descend-yes').addEventListener('click', () => {
    hideScreen('screen-descend');
    if (net.isHost || !game.isOnline) doDescend();
    else net.send(MSG.ACT, { a: 'descend' });
  });

  $('#input-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
}

let gestureDone = false;
function firstGesture() {
  if (gestureDone) return;
  gestureDone = true;
  initAudio();
  resumeAudio();
  initMusic();
  startMusic();
  setSfxVolume($('#opt-sfx').value / 100);
  setMusicVolume($('#opt-music').value / 100);
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

function onLobbyReady(ready, classId) {
  if (!game.isOnline) {
    game.roster[0].ready = ready;
    game.roster[0].classId = classId;
    game.lobby.renderRoster(game.roster);
    return;
  }
  if (net.isHost) {
    const me = game.roster.find((r) => r.peerId === net.myPeerId);
    if (me) { me.ready = ready; me.classId = classId; }
    broadcastRoster();
  } else {
    net.send(MSG.SELECT, { classId, ready });
  }
}

function broadcastRoster() {
  game.lobby.renderRoster(game.roster);
  net.broadcast(MSG.LOBBY, { roster: game.roster });
}

function leaveToMenu() {
  if (game.isOnline) net.close();
  game.isOnline = false;
  game.world = null;
  game.localPlayer = null;
  game.roster = [];
  clearLog();
  goToMenu();
}

// ---------------------------------------------------------------------------
// Starting a run
// ---------------------------------------------------------------------------

function hostBeginRun(seedInput) {
  const seed = (seedInput || randomSeedString()).toUpperCase();
  const world = new World({ seed, isHost: true });
  world.netActive = game.isOnline;
  world.animCheck = (kind, id, anim) => assets.hasAnim(kind, id, anim);

  game.roster.forEach((entry, i) => {
    const p = world.addPlayer({ peerId: entry.peerId, name: entry.name, classId: entry.classId, slot: i });
    entry.playerId = p.id;
  });

  startWorld(world, 1);

  if (game.isOnline) {
    net.broadcast(MSG.START, { seed, roster: game.roster.map(rosterWire) });
    net.broadcast(MSG.FLOOR, buildFloorManifest(world));
    sendAllSelf();
  }
}

function rosterWire(entry) {
  return { peerId: entry.peerId, name: entry.name, classId: entry.classId, playerId: entry.playerId };
}

function startWorld(world, floorNo) {
  game.world = world;
  world.loadFloor(floorNo);
  afterFloorLoad();
  game.mode = 'playing';
  closeAllModals();
  hideScreen('screen-lobby');
  hideScreen('screen-menu');
  setHudVisible(true);
  clearLog();
  settleHint();
  toast(`Floor ${floorNo} - ${world.dungeon.theme.name}`, 2600);
}

/** Show the control reminder brightly at the start of a run, then dim it. */
let hintTimer = null;
function settleHint() {
  const hint = $('#hint');
  hint.classList.remove('settled');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.add('settled'), 12000);
}

function afterFloorLoad() {
  const world = game.world;
  world.listener = null;
  tilemap.setDungeon(world.dungeon);
  game.minimap = game.minimap || new Minimap($('#minimap'), world);
  game.minimap.setWorld(world);

  game.localPlayer = resolveLocalPlayer(world);
  world.localPlayer = game.localPlayer;
  world.listener = game.localPlayer;
  game.panels.setPlayer(game.localPlayer);
  if (game.localPlayer) camera.snapTo(game.localPlayer.x, game.localPlayer.y);
  setDepth(world.floorNo);
  hud.lastSignature = '';
  hud.lastPartySig = '';
}

function resolveLocalPlayer(world) {
  if (!game.isOnline) return world.players[0];
  const myPeer = net.isHost ? net.myPeerId : net.myPeerId;
  return world.players.find((p) => p.peerId === myPeer) || world.players[0];
}

function resumeSavedRun() {
  const world = loadIntoWorld(World, { bossForFloor });
  if (!world) { toast('That save could not be read.'); return; }
  world.netActive = game.isOnline;
  world.animCheck = (kind, id, anim) => assets.hasAnim(kind, id, anim);

  game.roster = world.players.map((p, i) => ({
    peerId: p.peerId, name: p.name, classId: p.classId, ready: true, isHost: i === 0, playerId: p.id,
  }));
  // A resumed solo run belongs to whoever is at the keyboard.
  if (!game.isOnline && world.players[0]) world.players[0].peerId = 'local';

  game.world = world;
  afterFloorLoad();
  game.mode = 'playing';
  closeAllModals();
  setHudVisible(true);
  clearLog();
  settleHint();
  toast(`Resumed on floor ${world.floorNo}`, 2600);

  if (game.isOnline) {
    net.broadcast(MSG.START, { seed: world.seed, roster: game.roster.map(rosterWire) });
    net.broadcast(MSG.FLOOR, buildFloorManifest(world));
    sendAllSelf();
  }
}

// ---------------------------------------------------------------------------
// Descending
// ---------------------------------------------------------------------------

function doDescend() {
  const world = game.world;
  if (!world || !world.stairsUnlocked) return;

  for (const p of world.players) p.stat.floorsCleared++;

  if (world.floorNo >= FLOOR_COUNT) {
    endRun(true);
    return;
  }

  playSfx('descend');
  world.loadFloor(world.floorNo + 1);
  afterFloorLoad();
  toast(`Floor ${world.floorNo} - ${world.dungeon.theme.name}`, 2800);

  if (game.isOnline && net.isHost) {
    net.broadcast(MSG.FLOOR, buildFloorManifest(world));
    sendAllSelf();
  }
  saveWorld(world);
  refreshSaveSlot();
}

function endRun(victory) {
  const world = game.world;
  // A wipe can be reported a frame after the player already left to the menu.
  if (!world || game.mode === 'end') return;
  world.state = victory ? 'victory' : 'defeat';
  game.mode = 'end';
  setHudVisible(false);
  closeAllModals();
  showEndScreen({ victory, world, deepestFloor: world.floorNo });
  if (game.isOnline && net.isHost) {
    net.broadcast(MSG.GAMEOVER, { victory, floor: world.floorNo, players: world.players.map(serialisePlayerFull) });
  }
  if (victory) deleteSave();
  refreshSaveSlot();
}

// ---------------------------------------------------------------------------
// Actions facade (host applies; client forwards)
// ---------------------------------------------------------------------------

function makeActions() {
  const local = (fn) => (...args) => {
    const p = game.localPlayer;
    if (!p) return;
    if (game.isOnline && !net.isHost) return; // handled by the forwarding wrapper
    fn(p, ...args);
    if (game.isOnline && net.isHost) sendSelf(p);
  };

  const forward = (name, fn) => (...args) => {
    if (game.isOnline && !net.isHost) {
      net.send(MSG.ACT, { a: name, args });
      return;
    }
    local(fn)(...args);
  };

  return {
    equip: forward('equip', (p, uid) => applyEquip(p, uid)),
    unequip: forward('unequip', (p, slot) => applyUnequip(p, slot)),
    useItem: forward('useItem', (p, uid) => applyUseItem(p, uid)),
    dropItem: forward('dropItem', (p, uid) => applyDrop(p, uid)),
    learnTome: forward('learnTome', (p, uid) => applyLearnTome(p, uid)),
    bindSpell: forward('bindSpell', (p, slot, id) => { p.hotbar[slot] = id; }),
    allocate: forward('allocate', (p, stat) => applyAllocate(p, stat)),
    buy: forward('buy', (p, npcId, index) => applyBuy(p, npcId, index)),
    sell: forward('sell', (p, uid) => applySell(p, uid)),
  };
}

function applyEquip(p, uid) {
  const item = p.inventory.find((i) => i.uid === uid);
  if (!item || item.type !== 'equipment') return;
  if (p.level < (item.levelReq || 1)) { toast(`Requires level ${item.levelReq}`); playSfx('error'); return; }

  let slot = item.slot;
  // Rings pick whichever finger is free, else the first.
  if (slot === 'ring1' && p.equipment.ring1 && !p.equipment.ring2) slot = 'ring2';

  const current = p.equipment[slot];
  p.equipment[slot] = item;
  p.inventory.splice(p.inventory.indexOf(item), 1);
  if (current) p.inventory.push(current);
  recomputeStats(p, getClass(p.classId));
}

function applyUnequip(p, slot) {
  const item = p.equipment[slot];
  if (!item) return;
  if (p.inventory.length >= 40) { toast('Bag is full'); playSfx('error'); return; }
  p.equipment[slot] = null;
  p.inventory.push(item);
  recomputeStats(p, getClass(p.classId));
}

function applyUseItem(p, uid) {
  const item = p.inventory.find((i) => i.uid === uid);
  if (!item) return;
  if (item.type === 'consumable') game.world.consume(p, item);
  else if (item.type === 'tome') applyLearnTome(p, uid);
  else if (item.type === 'equipment') applyEquip(p, uid);
}

function applyDrop(p, uid) {
  const idx = p.inventory.findIndex((i) => i.uid === uid);
  if (idx < 0) return;
  const [item] = p.inventory.splice(idx, 1);
  game.world.pickups.push({
    id: Math.floor(Math.random() * 1e9), kind: 'loot',
    x: p.x, y: p.y + 24, items: [item], bob: 0, age: -1.2, dead: false,
  });
}

function applyLearnTome(p, uid) {
  const item = p.inventory.find((i) => i.uid === uid);
  if (!item || item.type !== 'tome') return;
  if (p.knownSpells.includes(item.abilityId)) { toast('Already known'); playSfx('error'); return; }
  p.knownSpells.push(item.abilityId);
  const free = p.hotbar.indexOf(null);
  if (free >= 0) p.hotbar[free] = item.abilityId;
  p.inventory.splice(p.inventory.indexOf(item), 1);
  const ab = getAbility(item.abilityId);
  game.world.pushLog(`${p.name} learned ${ab.name}!`, '#c264ff');
  playSfx('levelUp');
}

function applyAllocate(p, stat) {
  if (p.unspentPoints <= 0) return;
  p.unspentPoints--;
  p.allocated[stat] = (p.allocated[stat] || 0) + 1;
  recomputeStats(p, getClass(p.classId));
}

function applyBuy(p, npcId, index) {
  const npc = game.world.npcs.find((n) => n.id === npcId);
  if (!npc) return;
  const entry = npc.stock[index];
  if (!entry || entry.qty <= 0) return;
  const price = Math.round(entry.item.value * 1.35);
  if (p.gold < price) { toast('Not enough gold'); playSfx('error'); return; }
  const copy = JSON.parse(JSON.stringify(entry.item));
  copy.uid = Math.floor(Math.random() * 1e9) + 1e9;
  if (!game.world.addToInventory(p, copy)) return;
  p.gold -= price;
  entry.qty--;
  playSfx('coin');
  // Clients hold their own copy of the (deterministic) stock list, so tell them
  // what was bought rather than resending the whole inventory.
  if (game.isOnline && net.isHost) game.world.emitEvent({ t: 'stock', npc: npcId, i: index });
}

function applySell(p, uid) {
  const idx = p.inventory.findIndex((i) => i.uid === uid);
  if (idx < 0) return;
  const [item] = p.inventory.splice(idx, 1);
  const price = Math.max(1, Math.round(item.value * SELL_RATE) * (item.qty || 1));
  p.gold += price;
}

// ---------------------------------------------------------------------------
// Hotkeys
// ---------------------------------------------------------------------------

function bindHotkeys() {
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;

    if (e.code === 'Escape') {
      if (isScreenOpen('screen-options')) { hideScreen('screen-options'); return; }
      if (anyModalOpen() && game.mode === 'playing') { closeAllModals(); hideTooltip(); return; }
      if (game.mode === 'playing') showScreen('screen-options', { exclusive: false });
      return;
    }
    if (game.mode !== 'playing') return;

    if (e.code === 'KeyI' || e.code === 'Tab') { e.preventDefault(); game.panels.toggleInventory('inv'); }
    else if (e.code === 'KeyC') game.panels.toggleInventory('char');
    else if (e.code === 'KeyP') game.panels.toggleInventory('spells');
    else if (e.code === 'KeyM') toggleMap(!isScreenOpen('screen-map'));
    else if (e.code === 'Space' && game.localPlayer?.downed) cycleSpectate();
  });
}

function toggleMap(open) {
  if (open) {
    showScreen('screen-map');
    const world = game.world;
    $('#maptitle').textContent = `Floor ${world.floorNo} - ${world.dungeon.theme.name}`;
    $('#maplegend').innerHTML = [
      ['#4a8a58', 'Entrance'], ['#963e3e', 'Boss chamber'], ['#a89442', 'Merchant'],
      ['#a07630', 'Vault'], ['#4a769e', 'Shrine'], ['#804e8a', 'Trapped'],
      ['#ffd23f', 'Chest'], ['#7fe6ff', 'Stairs down'],
    ].map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('');
    drawBigMap();
  } else {
    hideScreen('screen-map');
  }
}

function drawBigMap() {
  const big = $('#bigmap');
  const mm = game.minimap;
  if (!mm) return;
  const prevCanvas = mm.canvas, prevCtx = mm.ctx;
  mm.canvas = big;
  mm.ctx = big.getContext('2d');
  mm.expanded = true;
  mm.update();
  mm.render(game.localPlayer);
  mm.expanded = false;
  mm.canvas = prevCanvas;
  mm.ctx = prevCtx;
}

function cycleSpectate() {
  const alive = game.world.players.filter((p) => !p.downed && !p.dead);
  if (!alive.length) return;
  game.spectateIndex = (game.spectateIndex + 1) % alive.length;
  playSfx('uiClick');
}

function spectateTarget() {
  const p = game.localPlayer;
  if (!p || !p.downed) return p;
  const alive = game.world.players.filter((a) => !a.downed && !a.dead);
  if (!alive.length) return p;
  return alive[game.spectateIndex % alive.length];
}

// ---------------------------------------------------------------------------
// Game events
// ---------------------------------------------------------------------------

function bindGameEvents() {
  bus.on('sfx', (name, vol) => playSfx(name, vol));
  bus.on('log', ({ text, color }) => pushLogLine(text, color));

  bus.on('ui:shop', ({ npcId, player }) => {
    if (player !== game.localPlayer) return;
    const npc = game.world.npcs.find((n) => n.id === npcId);
    if (npc) game.panels.openShop(npc);
  });

  bus.on('ui:descend', ({ player }) => {
    if (player !== game.localPlayer) return;
    const list = $('#descend-party');
    list.innerHTML = '';
    for (const p of game.world.players) {
      const row = el('div', 'descend-row');
      row.appendChild(el('span', null, `${p.name} - ${getClass(p.classId).name} ${p.level}`));
      row.appendChild(el('span', p.downed ? 'dim' : '', p.downed ? 'fallen (will be raised)' : `${Math.ceil(p.hp)} hp`));
      list.appendChild(row);
    }
    showScreen('screen-descend', { exclusive: false });
  });

  bus.on('game:over', () => {
    if (net.isHost || !game.isOnline) endRun(false);
  });
}

// ---------------------------------------------------------------------------
// Net message handling
// ---------------------------------------------------------------------------

net.onStatus = (s) => { $('#netstatus').textContent = s; };

net.onPeerJoin = (peerId) => {
  if (!net.isHost) return;
  if (game.mode === 'playing') {
    // Late joiners spectate until the next floor; simplest correct behaviour.
    net.sendTo(peerId, MSG.KICK, { reason: 'That run has already started. Ask the host to restart.' });
    return;
  }
  broadcastRoster();
};

net.onPeerLeave = (peerId) => {
  if (!net.isHost) return;
  game.roster = game.roster.filter((r) => r.peerId !== peerId);
  if (game.mode === 'lobby') broadcastRoster();
  else if (game.world) {
    const p = game.world.players.find((pl) => pl.peerId === peerId);
    if (p) game.world.pushLog(`${p.name} disconnected.`, '#ff9060');
  }
};

net.on(MSG.HELLO, (d, peerId) => {
  if (!net.isHost) return;
  game.roster.push({ peerId, name: (d.name || 'Adventurer').slice(0, 14), classId: d.classId || 'knight', ready: false, isHost: false });
  broadcastRoster();
});

net.on(MSG.SELECT, (d, peerId) => {
  if (!net.isHost) return;
  const entry = game.roster.find((r) => r.peerId === peerId);
  if (!entry) return;
  entry.classId = d.classId;
  entry.ready = !!d.ready;
  broadcastRoster();
});

net.on(MSG.LOBBY, (d) => {
  game.roster = d.roster;
  game.lobby.renderRoster(game.roster);
});

net.on(MSG.START, (d) => {
  const world = new World({ seed: d.seed, isHost: false });
  world.animCheck = (kind, id, anim) => assets.hasAnim(kind, id, anim);
  for (const entry of d.roster) {
    const p = world.addPlayer({ peerId: entry.peerId, name: entry.name, classId: entry.classId, slot: 0 });
    world.byId.delete(p.id);
    p.id = entry.playerId;
    world.byId.set(p.id, p);
  }
  game.world = world;
  world.loadFloor(1, { keepPlayers: true });
  afterFloorLoad();
  game.mode = 'playing';
  closeAllModals();
  hideScreen('screen-lobby');
  setHudVisible(true);
  clearLog();
  settleHint();
  toast(`Floor 1 - ${world.dungeon.theme.name}`, 2600);
});

net.on(MSG.FLOOR, (d) => {
  const world = game.world;
  if (!world) return;
  if (world.floorNo !== d.floorNo) {
    world.loadFloor(d.floorNo, { keepPlayers: true });
    afterFloorLoad();
    toast(`Floor ${d.floorNo} - ${world.dungeon.theme.name}`, 2800);
    playSfx('descend');
  }
  applyFloorManifest(world, d);
});

net.on(MSG.SNAP, (d) => {
  if (!game.world) return;
  applySnapshot(game.world, d);
});

net.on(MSG.SELF, (d) => {
  const p = game.world?.byId.get(d.id);
  if (!p) return;
  applyPlayerFull(p, d);
  if (p === game.localPlayer) {
    game.panels.setPlayer(p);
    game.panels.refresh();
  }
});

net.on(MSG.EVENT, (list) => {
  const world = game.world;
  if (!world) return;
  for (const e of list) applyRemoteEvent(world, e);
});

net.on(MSG.ACT, (d, peerId) => {
  if (!net.isHost) return;
  const p = game.world?.players.find((pl) => pl.peerId === peerId);
  if (!p) return;
  const handlers = {
    equip: applyEquip, unequip: applyUnequip, useItem: applyUseItem,
    dropItem: applyDrop, learnTome: applyLearnTome, allocate: applyAllocate,
    buy: applyBuy, sell: applySell,
    bindSpell: (pl, slot, id) => { pl.hotbar[slot] = id; },
    descend: () => doDescend(),
  };
  const fn = handlers[d.a];
  if (fn) {
    fn(p, ...(d.args || []));
    sendSelf(p);
  }
});

net.on(MSG.INPUT, (d, peerId) => {
  if (!net.isHost || !game.world) return;
  const p = game.world.players.find((pl) => pl.peerId === peerId);
  if (!p) return;
  game.intents.set(p.id, mergeIntents(game.intents.get(p.id), d));
});

net.on(MSG.GAMEOVER, (d) => {
  if (net.isHost) return;
  game.mode = 'end';
  setHudVisible(false);
  closeAllModals();
  // Replace local player copies with the host's authoritative final stats.
  d.players.forEach((sp) => {
    const p = game.world.byId.get(sp.id);
    if (p) applyPlayerFull(p, sp);
  });
  showEndScreen({ victory: d.victory, world: game.world, deepestFloor: d.floor });
});

net.on(MSG.KICK, (d) => {
  toast(d.reason || 'Disconnected', 5000);
  leaveToMenu();
});

function applyRemoteEvent(world, e) {
  switch (e.t) {
    case 'dmg': {
      const target = world.byId.get(e.id);
      if (!target) break;
      target.hitFlash = 0.16;
      const color = e.c ? '#ffd23f' : target.kind === 'player' ? '#ff6b6b' : '#ffffff';
      world.floatText(target.x, target.y - target.radius - 10, e.a + (e.c ? '!' : ''), color, e.c ? 1.4 : 1);
      world.spawnFx('hit', target.x, target.y, { color: e.ty === 'phys' ? '#ff5a5a' : '#c08aff', radius: 10, life: 0.18 });
      break;
    }
    case 'txt':
      world.floatText(e.x, e.y, e.s, e.c, e.sc || 1);
      break;
    case 'fx':
      world.spawnFx(e.k, e.x, e.y, e.o || {});
      break;
    case 'sfx':
      world.sfxAt(e.x, e.y, e.n);
      break;
    case 'log':
      world.pushLog(e.s, e.c);
      break;
    case 'shake':
      world.shake(e.a);
      break;
    case 'unlock':
      world.stairsUnlocked = true;
      break;
    case 'chest': {
      const prop = world.dungeon.props.find((p) => p.type === 'chest' && p.x === e.x && p.y === e.y);
      if (prop) prop.opened = true;
      break;
    }
    case 'shrine': {
      const prop = world.dungeon.props.find((p) => p.type === 'shrine' && p.x === e.x && p.y === e.y);
      if (prop) prop.used = true;
      break;
    }
    case 'stock': {
      const npc = world.npcs.find((n) => n.id === e.npc);
      const entry = npc?.stock[e.i];
      if (entry) entry.qty--;
      if (isScreenOpen('screen-shop')) game.panels.refresh();
      break;
    }
    default:
      break;
  }
}

function sendSelf(p) {
  if (!game.isOnline || !net.isHost) return;
  if (p.peerId === net.myPeerId) return;
  net.sendTo(p.peerId, MSG.SELF, serialisePlayerFull(p));
}

function sendAllSelf() {
  if (!game.isOnline || !net.isHost) return;
  for (const p of game.world.players) sendSelf(p);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const loop = new GameLoop({ update, render });

function update(dt) {
  const world = game.world;
  if (game.mode !== 'playing' || !world) { input.endFrame(); return; }

  const localPlayer = game.localPlayer;
  const viewTarget = spectateTarget();

  // Sample intent from the keyboard/mouse for the local player.
  input.enabled = !anyModalOpen();
  const aim = camera.screenToWorld(input.mouse.x, input.mouse.y);
  game.aimWorld = aim;
  let intent = EMPTY_INTENT;
  if (localPlayer && !localPlayer.downed) {
    intent = input.sample(aim, localPlayer);
    intent.aimX = aim.x;
    intent.aimY = aim.y;
  }

  if (game.isOnline && !net.isHost) {
    // Client: predict own movement, ship the intent, let the host arbitrate.
    game.pendingIntent = mergeIntents(game.pendingIntent, intent);
    game.lastInputSend += dt;
    if (game.lastInputSend >= 1 / INPUT_HZ) {
      game.lastInputSend = 0;
      net.send(MSG.INPUT, game.pendingIntent);
      game.pendingIntent = null;
    }
    predictLocal(world, localPlayer, intent, dt);
    world.update(dt, null);
    reconcile(localPlayer);
    // The host runs the actual interaction (it saw the same intent). Locally we
    // only open the panels, because opening a chest twice would desync loot.
    if (intent.interact) clientInteractUi(world, localPlayer);
  } else {
    game.intents.set(localPlayer?.id, intent);
    world.update(dt, game.intents);
    // Edge-triggered flags are consumed by the tick that saw them.
    for (const [id, v] of game.intents) {
      game.intents.set(id, { ...v, slots: [false, false, false, false], useHp: false, useMp: false, interact: false, attack: v.attack });
    }
  }

  if (game.minimap) game.minimap.update();

  // Host: ship state and autosave.
  if (game.isOnline && net.isHost) {
    game.lastSnapshot += dt;
    if (game.lastSnapshot >= 1 / SNAPSHOT_HZ) {
      game.lastSnapshot = 0;
      net.broadcast(MSG.SNAP, buildSnapshot(world));
      const events = world.drainEvents();
      if (events.length) net.broadcast(MSG.EVENT, events);
    }
  } else if (!game.isOnline) {
    world.drainEvents();
  }

  if (net.isHost || !game.isOnline) {
    game.lastSave += dt;
    if (game.lastSave > 20) {
      game.lastSave = 0;
      saveWorld(world);
    }
  }

  // Spectate bar, but only while there is actually someone left to watch -
  // a solo death goes straight to the run summary instead.
  const spectateOpen = !!localPlayer?.downed && world.livePlayers().length > 0;
  document.getElementById('screen-spectate').classList.toggle('active', spectateOpen);
  if (spectateOpen) $('#spectate-name').textContent = viewTarget?.name || '—';

  input.endFrame();
}

/**
 * Client-side interaction: UI only. Chests, shrines and traps are resolved by
 * the host from the same input packet, so all a client does here is open the
 * panel that the interaction implies.
 */
function clientInteractUi(world, player) {
  if (!player || player.downed) return;
  const prop = world.interactTarget(player);
  if (!prop) return;
  if (prop.type === 'merchant') {
    const npc = world.npcs.find((n) => n.id === prop.npcId);
    if (npc) game.panels.openShop(npc);
  } else if (prop.type === 'stairs' && world.stairsUnlocked) {
    bus.emit('ui:descend', { player, world });
  }
}

/** Client-side prediction: run the same movement integration the host will. */
function predictLocal(world, p, intent, dt) {
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

function reconcile(p) {
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

function render(alpha, dt) {
  const world = game.world;
  if (game.mode === 'boot' || !world) return;

  const viewTarget = spectateTarget() || game.localPlayer;
  camera.update(dt, viewTarget, game.aimWorld, world.dungeon, game.shakeEnabled ? world.shakeAmount : 0);
  renderer.render(world, camera, game.localPlayer, dt);

  if (game.mode === 'playing') {
    hud.update(world, game.localPlayer);
    game.minimap?.render(game.localPlayer);
    if (isScreenOpen('screen-map')) drawBigMap();
  }
}

// ---------------------------------------------------------------------------

boot().catch((err) => {
  console.error(err);
  $('#loadstatus').textContent = `Startup failed: ${err.message}`;
});
