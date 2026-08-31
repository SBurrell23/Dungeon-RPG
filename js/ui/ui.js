import { assets } from '../assets/loader.js';
import { ICON_SIZE } from '../assets/manifest.js';
import { RARITY_BY_ID, SLOT_LABEL, FAMILY_INFO, describeAffix, AFFIX_LABEL, SELL_RATE } from '../game/items.js';
import { getAbility, SCHOOLS } from '../game/abilities.js';
import { playSfx } from '../audio/sfx.js';

/**
 * Shared UI plumbing: screen stack, tooltips, and the item/ability rendering
 * helpers that the inventory, shop and hotbar all use.
 */

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

const screenStack = [];

export function showScreen(id, { exclusive = true } = {}) {
  if (exclusive) {
    for (const s of $$('.screen')) if (!s.classList.contains('passthrough')) s.classList.remove('active');
    screenStack.length = 0;
  }
  const node = document.getElementById(id);
  if (node) {
    node.classList.add('active');
    screenStack.push(id);
  }
  return node;
}

export function hideScreen(id) {
  document.getElementById(id)?.classList.remove('active');
  const i = screenStack.indexOf(id);
  if (i >= 0) screenStack.splice(i, 1);
}

export function isScreenOpen(id) {
  return !!document.getElementById(id)?.classList.contains('active');
}

/** Any modal that should swallow gameplay input. */
export function anyModalOpen() {
  return ['screen-inventory', 'screen-shop', 'screen-map', 'screen-menu', 'screen-lobby',
    'screen-end', 'screen-options', 'screen-descend', 'screen-loading', 'screen-confirm', 'screen-dev']
    .some(isScreenOpen);
}

export function closeAllModals() {
  for (const id of ['screen-inventory', 'screen-shop', 'screen-map', 'screen-options', 'screen-descend']) {
    hideScreen(id);
  }
}

export function setHudVisible(v) {
  $('#hud').classList.toggle('hidden', !v);
}

/**
 * In-game confirm dialog.
 *
 * A styled modal rather than `window.confirm`, which would look like a browser
 * error in the middle of a dungeon. Resolves true/false.
 */
export function confirmDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    const yes = $('#confirm-yes');
    const no = $('#confirm-no');
    yes.textContent = confirmLabel;
    no.textContent = cancelLabel;

    const finish = (value) => {
      hideScreen('screen-confirm');
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      window.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    const onKey = (e) => {
      if (e.code === 'Escape') { e.stopPropagation(); finish(false); }
      if (e.code === 'Enter') { e.stopPropagation(); finish(true); }
    };
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    window.addEventListener('keydown', onKey, true);
    showScreen('screen-confirm', { exclusive: false });
  });
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

const tooltipEl = () => $('#tooltip');

export function showTooltip(html, ev) {
  const t = tooltipEl();
  t.innerHTML = html;
  t.classList.remove('hidden');
  moveTooltip(ev);
}

export function moveTooltip(ev) {
  const t = tooltipEl();
  if (t.classList.contains('hidden')) return;
  const pad = 14;
  const w = t.offsetWidth, h = t.offsetHeight;
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}

export function hideTooltip() {
  tooltipEl().classList.add('hidden');
}

/** Attach hover-tooltip behaviour to a node. */
export function bindTooltip(node, htmlFn) {
  node.addEventListener('mouseenter', (e) => { showTooltip(htmlFn(), e); playSfx('uiHover', 0.4); });
  node.addEventListener('mousemove', moveTooltip);
  node.addEventListener('mouseleave', hideTooltip);
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const iconUrlCache = new Map();

export function iconUrl(icon, size = ICON_SIZE) {
  if (!icon) return '';
  const key = `${icon[0]},${icon[1]},${size}`;
  let url = iconUrlCache.get(key);
  if (!url) {
    url = assets.iconURL(icon[0], icon[1], size);
    iconUrlCache.set(key, url);
  }
  return url;
}

export function iconImg(icon, cls = 'ic') {
  const img = new Image();
  img.className = cls;
  img.src = iconUrl(icon);
  return img;
}

/** First idle frame of a character sheet, as a data URL - used for portraits. */
const portraitCache = new Map();
export function portraitUrl(kind, id, tint) {
  const key = `${kind}:${id}:${tint || ''}`;
  let url = portraitCache.get(key);
  if (url) return url;
  const sheet = tint ? assets.recolorSheet(kind, id, 'idle', tint) : assets.sheet(kind, id, 'idle');
  if (!sheet) return '';
  const c = document.createElement('canvas');
  c.width = 96; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // The character occupies barely a quarter of the 100px frame, so crop tight
  // around it - otherwise the portrait is mostly empty space.
  ctx.drawImage(sheet.img, 38, 31, 30, 30, 0, 0, 96, 96);
  url = c.toDataURL();
  portraitCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------
// Item tooltips
// ---------------------------------------------------------------------------

export function rarityClass(item) {
  return item?.rarity ? `r-${item.rarity}` : '';
}

/** True when the player is too low level to equip this item. */
export function itemLocked(item, player) {
  return !!(player && item?.type === 'equipment' && player.level < (item.levelReq || 1));
}

export function rarityColor(item) {
  if (item?.type === 'tome') return '#c264ff';
  return RARITY_BY_ID[item?.rarity]?.color || '#b8b8b8';
}

/**
 * Full item tooltip, optionally comparing against what the player has equipped
 * in the same slot - the single most useful thing an ARPG tooltip can do.
 */
export function itemTooltip(item, player, { showValue = true, priceLabel = null, price = null } = {}) {
  if (!item) return '';
  const color = rarityColor(item);
  const parts = [];
  parts.push(`<div class="tt-name" style="color:${color}">${escapeHtml(item.name)}</div>`);

  if (item.type === 'equipment') {
    const fam = FAMILY_INFO[item.family];
    parts.push(`<div class="tt-type">${RARITY_BY_ID[item.rarity]?.name || ''} &middot; ${SLOT_LABEL[item.slot] || fam?.name || ''} &middot; Tier ${item.tier + 1}</div>`);
    const main = [];
    if (item.damage) main.push(`${item.damage.toFixed(1)} damage`);
    if (item.armorValue) main.push(`${item.armorValue} armour`);
    if (main.length) parts.push(`<div class="tt-main">${main.join(' &middot; ')}</div>`);
    for (const aff of item.affixes || []) {
      parts.push(`<div class="tt-aff">${describeAffix(aff)}</div>`);
    }
    // Level gating is the single most common reason a click does nothing, so
    // it gets a loud line rather than a quiet grey one.
    if (itemLocked(item, player)) {
      parts.push(`<div class="tt-locked">Requires level ${item.levelReq} &mdash; you are level ${player.level}</div>`);
    } else if (item.levelReq > 1) {
      parts.push(`<div class="small dim">Requires level ${item.levelReq}</div>`);
    }
    if (player) {
      const cmp = compareToEquipped(item, player);
      if (cmp) parts.push(`<div class="tt-cmp">${cmp}</div>`);
    }
  } else if (item.type === 'consumable') {
    parts.push('<div class="tt-type">Consumable</div>');
    parts.push(`<div class="tt-main">${escapeHtml(item.desc || '')}</div>`);
    if (item.qty > 1) parts.push(`<div class="small dim">${item.qty} in bag</div>`);
  } else if (item.type === 'tome') {
    const ab = getAbility(item.abilityId);
    parts.push(`<div class="tt-type">Spell Tome &middot; ${SCHOOLS[item.school]?.name || ''}</div>`);
    parts.push(`<div class="tt-main">${escapeHtml(ab?.desc || '')}</div>`);
    if (ab) parts.push(`<div class="tt-aff">${ab.mana} mana &middot; ${ab.cooldown}s cooldown</div>`);
    const known = player?.knownSpells?.includes(item.abilityId);
    parts.push(`<div class="small ${known ? 'dim' : ''}">${known ? 'Already known' : 'Right-click to learn'}</div>`);
  } else if (item.type === 'gold') {
    parts.push(`<div class="tt-main">${item.qty} gold</div>`);
  }

  const foot = [];
  if (priceLabel && price != null) foot.push(`<span>${priceLabel} <b style="color:var(--gold)">${price}g</b></span>`);
  else if (showValue && item.value) foot.push(`<span>Worth <b style="color:var(--gold)">${Math.round(item.value * SELL_RATE)}g</b></span>`);
  if (foot.length) parts.push(`<div class="tt-foot">${foot.join('')}</div>`);
  return parts.join('');
}

function compareToEquipped(item, player) {
  if (item.type !== 'equipment') return '';
  const slots = item.slot === 'ring1' ? ['ring1', 'ring2'] : [item.slot];
  const current = slots.map((s) => player.equipment[s]).find(Boolean);
  if (!current) return '<span class="up">Nothing equipped there</span>';

  const lines = [];
  const dmgDelta = (item.damage || 0) - (current.damage || 0);
  if (dmgDelta) lines.push(deltaLine('Damage', dmgDelta.toFixed(1)));
  const keys = new Set([...Object.keys(item.mods || {}), ...Object.keys(current.mods || {})]);
  for (const k of keys) {
    if (k === 'armor' && item.armorValue == null && current.armorValue == null) continue;
    const a = item.mods?.[k] || 0;
    const b = current.mods?.[k] || 0;
    const d = a - b;
    if (Math.abs(d) < 0.001) continue;
    const pct = ['damagePct', 'critChance', 'critMult', 'moveSpeed', 'attackSpeed', 'cooldown', 'lifeSteal', 'magicFind', 'xpBonus'].includes(k);
    lines.push(deltaLine(AFFIX_LABEL[k] || k, pct ? `${(d * 100).toFixed(1)}%` : d.toFixed(1)));
  }
  if (!lines.length) return `<span class="dim">Sidegrade vs ${escapeHtml(current.name)}</span>`;
  return `<div class="dim small" style="margin-bottom:4px">vs ${escapeHtml(current.name)}</div>${lines.join('')}`;
}

function deltaLine(label, value) {
  const num = parseFloat(value);
  const cls = num > 0 ? 'up' : 'down';
  const sign = num > 0 ? '+' : '';
  return `<div class="${cls}">${sign}${value} ${label}</div>`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Toast / log
// ---------------------------------------------------------------------------

let toastTimer = null;
export function toast(text, ms = 2200) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const logLines = [];
export function pushLogLine(text, color = '#ddd') {
  const box = $('#log');
  const node = el('div', 'logline', text);
  node.style.color = color;
  box.prepend(node);
  logLines.push(node);
  // Lines fade rather than vanish, so the last few stay readable.
  setTimeout(() => node.classList.add('fade'), 7000);
  setTimeout(() => node.remove(), 8200);
  while (logLines.length > 10) {
    const old = logLines.shift();
    old?.remove();
  }
}

export function clearLog() {
  $('#log').innerHTML = '';
  logLines.length = 0;
}

/** Wire click sounds onto every button once. */
export function bindButtonSounds() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('.btn, .tab, .itemcell, .classrow, .spellcard')) playSfx('uiClick', 0.7);
  });
}
