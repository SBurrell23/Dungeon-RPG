import {
  $, el, iconUrl, portraitUrl, bindTooltip, itemTooltip, rarityClass, itemLocked,
  escapeHtml, showScreen, hideScreen, isScreenOpen, hideTooltip, toast, openItemMenu, closeItemMenu,
} from './ui.js';
import { SLOTS, SLOT_LABEL, SELL_RATE, BUY_MARKUP, INVENTORY_SIZE } from '../game/items.js';
import { PRIMARIES, PRIMARY_LABEL, PRIMARY_BLURB, PRIMARY_ICON, xpToNext } from '../game/stats.js';
import { getAbility, SCHOOLS } from '../game/abilities.js';
import { getClass } from '../game/classes.js';
import { MONSTERS, TRAP_INFO } from '../game/monsters.js';
import { playSfx } from '../audio/sfx.js';

/**
 * Inventory, spellbook, run stats and the shop.
 *
 * These panels never mutate game state directly - they call through
 * `actions`, which on the host applies immediately and on a client sends the
 * request to the host. That keeps one authority for everything that matters.
 */
/** Human-readable behaviour names for compendium entries. */
const AI_LABEL = {
  chaser: 'Chaser', tank: 'Bruiser', charger: 'Charger',
  erratic: 'Erratic flyer', ranged: 'Ranged', summoner: 'Summoner',
};

/**
 * Small canvas thumbnail of a trap plate. Drawn rather than sprited because
 * the traps themselves are drawn, so the two always match.
 */
function trapThumb(kind, color) {
  const c = document.createElement('canvas');
  c.width = 40;
  c.height = 40;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a4038';
  ctx.fillRect(2, 2, 36, 36);
  ctx.strokeStyle = '#6a5b4c';
  ctx.strokeRect(4.5, 4.5, 31, 31);
  ctx.fillStyle = color;
  if (kind === 'spike') {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(9 + i * 11, 28);
      ctx.lineTo(12.5 + i * 11, 12);
      ctx.lineTo(16 + i * 11, 28);
      ctx.fill();
    }
  } else if (kind === 'dart') {
    for (let gy = 0; gy < 3; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        ctx.beginPath();
        ctx.arc(11 + gx * 9, 11 + gy * 9, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (kind === 'flame') {
    for (let i = 0; i < 5; i++) ctx.fillRect(8, 9 + i * 5, 24, 2.4);
  } else {
    ctx.beginPath();
    ctx.arc(20, 20, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2620';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(20 + Math.cos(a) * 5, 20 + Math.sin(a) * 5, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

export class Panels {
  constructor(actions) {
    this.actions = actions;
    this.player = null;
    this.shopNpc = null;
    this.activeTab = 'inv';
    this.bindStatic();
  }

  bindStatic() {
    for (const tab of document.querySelectorAll('#screen-inventory .tab')) {
      tab.addEventListener('click', () => this.selectTab(tab.dataset.tab));
    }
    $('#btn-closeinv').addEventListener('click', () => this.closeInventory());
    $('#btn-closeshop').addEventListener('click', () => this.closeShop());
  }

  setPlayer(p) { this.player = p; }

  /** The compendium reads discoveries off the world, not the character. */
  setWorld(w) { this.world = w; }

  selectTab(tab) {
    this.activeTab = tab;
    for (const t of document.querySelectorAll('#screen-inventory .tab')) {
      t.classList.toggle('active', t.dataset.tab === tab);
    }
    for (const p of document.querySelectorAll('#screen-inventory .tabpane')) {
      p.classList.toggle('active', p.id === `pane-${tab}`);
    }
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // Sheet
  // -------------------------------------------------------------------------

  toggleInventory(tab) {
    if (isScreenOpen('screen-inventory') && (!tab || tab === this.activeTab)) {
      this.closeInventory();
      return;
    }
    if (tab) this.selectTab(tab);
    showScreen('screen-inventory');
    this.refresh();
  }

  closeInventory() {
    hideScreen('screen-inventory');
    closeItemMenu();
    hideTooltip();
  }

  refresh() {
    if (!this.player) return;
    // Rebuilding the grids orphans any open cell menu, so drop it first.
    closeItemMenu();
    if (isScreenOpen('screen-inventory')) {
      if (this.activeTab === 'inv') this.renderInventory();
      else if (this.activeTab === 'spells') this.renderSpells();
      else if (this.activeTab === 'codex') this.renderCodex();
      else this.renderStats();
    }
    if (isScreenOpen('screen-shop')) this.renderShop();
  }

  /**
   * The main sheet: identity, equipment and live stats down the left, bag on
   * the right.
   *
   * Attributes sit beside the bag on purpose - unspent points and a thin stat
   * line should be the first thing you see when you open your inventory, not
   * something hidden behind a second tab.
   */
  renderInventory() {
    const p = this.player;
    const cls = getClass(p.classId);
    const s = p.stats;
    const pane = $('#pane-inv');
    pane.innerHTML = '';

    const layout = el('div', 'invlayout');
    const left = el('div', 'invleft');

    const head = el('div', 'charhead');
    const port = el('div', 'charportrait');
    port.style.backgroundImage = `url(${portraitUrl('hero', p.classId)})`;
    head.appendChild(port);
    const who = el('div');
    who.appendChild(el('div', 'charname', p.name));
    who.appendChild(el('div', 'charsub', `${cls.name} - Level ${p.level}`));
    who.appendChild(el('div', 'charsub goldtext', `${p.gold} gold`));
    head.appendChild(who);
    left.appendChild(head);

    left.appendChild(el('h3', null, 'Equipped'));
    const grid = el('div', 'equipgrid');
    for (const slot of SLOTS) {
      const cell = el('div', 'equipslot');
      cell.appendChild(el('span', 'lbl', SLOT_LABEL[slot]));
      const item = p.equipment[slot];
      if (item) {
        cell.classList.add(rarityClass(item));
        cell.appendChild(Object.assign(new Image(), { src: iconUrl(item.icon) }));
        bindTooltip(cell, () => itemTooltip(item, null));
        cell.addEventListener('click', () => {
          this.actions.unequip(slot);
          playSfx('equip', 0.8);
          this.refresh();
        });
      }
      grid.appendChild(cell);
    }
    left.appendChild(grid);

    if (p.unspentPoints > 0) {
      left.appendChild(el('div', 'pointsleft', `${p.unspentPoints} attribute point${p.unspentPoints > 1 ? 's' : ''} to spend`));
    }

    left.appendChild(el('h3', null, 'Attributes'));
    const attrs = el('div', 'attrlist');
    for (const key of PRIMARIES) {
      const row = el('div', 'attrrow');
      row.appendChild(Object.assign(new Image(), { className: 'attricon', src: iconUrl(PRIMARY_ICON[key]) }));
      row.appendChild(el('span', 'attrname', PRIMARY_LABEL[key]));
      row.appendChild(el('span', 'attrval', s[key]));
      if (p.unspentPoints > 0) {
        const plus = el('button', 'btn small attrplus', '+');
        plus.addEventListener('click', (e) => {
          e.stopPropagation();
          this.actions.allocate(key);
          this.refresh();
        });
        row.appendChild(plus);
      }
      bindTooltip(row, () => `<div class="tt-name">${PRIMARY_LABEL[key]}</div><div class="tt-main">${PRIMARY_BLURB[key]}</div>`);
      attrs.appendChild(row);
    }
    left.appendChild(attrs);

    layout.appendChild(left);

    const right = el('div', 'invright');
    right.appendChild(el('h3', null, `Bag (${p.inventory.length}/${INVENTORY_SIZE})`));
    const bag = el('div', 'itemgrid');
    for (const item of p.inventory) {
      bag.appendChild(this.itemCell(item, {
        onClick: () => {
          if (item.type === 'equipment') {
            if (itemLocked(item, p)) {
              toast(`${item.name} needs level ${item.levelReq} - you are level ${p.level}`, 2600);
              playSfx('error');
              return;
            }
            this.actions.equip(item.uid);
            playSfx('equip', 0.8);
          } else if (item.type === 'consumable') this.actions.useItem(item.uid);
          else if (item.type === 'tome') this.actions.learnTome(item.uid);
          this.refresh();
        },
        // Right-click opens a menu rather than dropping outright - dropping is
        // the party's only item-trading mechanism, but it was far too easy to
        // fire by accident while equipping.
        menu: () => [
          item.type === 'equipment'
            ? { label: 'Equip', disabled: itemLocked(item, p),
                run: () => { this.actions.equip(item.uid); playSfx('equip', 0.8); } }
            : item.type === 'tome'
              ? { label: 'Learn', run: () => this.actions.learnTome(item.uid) }
              : { label: 'Use', run: () => this.actions.useItem(item.uid) },
          { label: 'Drop', danger: true, run: () => this.actions.dropItem(item.uid) },
        ],
      }));
    }
    for (let i = p.inventory.length; i < 32; i++) bag.appendChild(el('div', 'itemcell empty'));
    right.appendChild(bag);
    right.appendChild(el('div', 'small dim baghint',
      'Left-click to equip or use. Right-click for more options. Click an equipped item to take it off.'));
    layout.appendChild(right);

    pane.appendChild(layout);
  }

  itemCell(item, { onClick, onRightClick, menu, price, priceLabel } = {}) {
    const locked = itemLocked(item, this.player);
    const cell = el('div', `itemcell ${rarityClass(item)}${locked ? ' locked' : ''}`);
    cell.appendChild(Object.assign(new Image(), { src: iconUrl(item.icon) }));
    if (item.qty > 1) cell.appendChild(el('span', 'qty', item.qty));
    if (price != null) cell.appendChild(el('span', 'price', `${price}g`));
    // A red level badge is readable at a glance across a full bag.
    if (locked) cell.appendChild(el('span', 'lockbadge', `L${item.levelReq}`));
    bindTooltip(cell, () => itemTooltip(item, this.player, { price, priceLabel }));
    if (onClick) cell.addEventListener('click', onClick);
    if (menu) {
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openItemMenu(e.clientX, e.clientY, menu(), () => this.refresh());
      });
    } else if (onRightClick) {
      cell.addEventListener('contextmenu', (e) => { e.preventDefault(); onRightClick(); });
    }
    return cell;
  }

  renderSpells() {
    const p = this.player;
    const pane = $('#pane-spells');
    pane.innerHTML = '';
    pane.appendChild(el('h3', null, 'Known spells - click to bind to the next free hotbar slot'));

    const grid = el('div', 'spellgrid');
    for (const id of p.knownSpells) {
      const ab = getAbility(id);
      if (!ab) continue;
      const bound = p.hotbar.indexOf(id);
      const card = el('div', `spellcard${bound >= 0 ? ' bound' : ''}`);
      card.appendChild(Object.assign(new Image(), { className: 'ic', src: iconUrl(ab.icon) }));
      const body = el('div');
      body.appendChild(el('div', 'sn', ab.name + (bound >= 0 ? `  [${bound + 1}]` : '')));
      body.appendChild(el('div', 'sd', ab.desc));
      body.appendChild(el('div', 'sm', `${ab.mana} mana - ${ab.cooldown}s - ${SCHOOLS[ab.school]?.name || ''}`));
      card.appendChild(body);
      card.addEventListener('click', () => {
        if (bound >= 0) this.actions.bindSpell(bound, null);
        else {
          let slot = p.hotbar.indexOf(null);
          if (slot < 0) slot = 3;
          this.actions.bindSpell(slot, id);
        }
        this.refresh();
      });
      grid.appendChild(card);
    }
    pane.appendChild(grid);

  }

  /** Derived combat numbers and run totals - reference, not mid-fight reading. */
  renderStats() {
    const p = this.player;
    const s = p.stats;
    const pane = $('#pane-stats');
    pane.innerHTML = '';
    pane.appendChild(el('h2', null, escapeHtml(p.name)));
    pane.appendChild(el('p', 'sub', `Level ${p.level} - ${Math.round(p.xp)} / ${xpToNext(p.level)} experience`));

    const cols = el('div', 'charstats');
    const combatWrap = el('div');
    combatWrap.appendChild(el('h3', null, 'Combat'));
    const combat = el('div', 'statblock');
    const rows = [
      ['Health', `${Math.ceil(p.hp)} / ${Math.round(s.maxHp)}`],
      ['Mana', `${Math.ceil(p.mp)} / ${Math.round(s.maxMp)}`],
      ['Melee power', s.attackPower.toFixed(1)],
      ['Ranged power', s.rangedPower.toFixed(1)],
      ['Spell power', s.spellPower.toFixed(1)],
      ['Armour', Math.round(s.armor)],
      ['Resistance', Math.round(s.resist)],
      ['Crit chance', `${(s.critChance * 100).toFixed(1)}%`],
      ['Crit damage', `${Math.round(s.critMult * 100)}%`],
      ['Attack speed', `${Math.round(s.attackSpeed * 100)}%`],
      ['Move speed', Math.round(s.moveSpeed)],
      ['Cooldowns', `${Math.round((1 - s.cooldownMult) * 100)}% faster`],
      ['Health regen', `${s.hpRegen.toFixed(1)}/s`],
      ['Mana regen', `${s.mpRegen.toFixed(1)}/s`],
    ];
    if (s.lifeSteal > 0) rows.push(['Life steal', `${(s.lifeSteal * 100).toFixed(1)}%`]);
    if (s.magicFind > 0) rows.push(['Magic find', `${(s.magicFind * 100).toFixed(0)}%`]);
    if (s.xpBonus > 0) rows.push(['Experience', `+${(s.xpBonus * 100).toFixed(0)}%`]);
    for (const [k, v] of rows) {
      const row = el('div', 'statline');
      row.appendChild(el('span', 'k', k));
      row.appendChild(el('span', 'v', v));
      combat.appendChild(row);
    }
    combatWrap.appendChild(combat);
    cols.appendChild(combatWrap);

    const runWrap = el('div');
    runWrap.appendChild(el('h3', null, 'This run'));
    const block = el('div', 'statblock');
    const st = p.stat;
    for (const [k, v] of [
      ['Kills', st.kills],
      ['Damage dealt', Math.round(st.damageDealt)],
      ['Damage taken', Math.round(st.damageTaken)],
      ['Healing done', Math.round(st.healingDone)],
      ['Gold earned', st.goldEarned],
      ['Items found', st.itemsFound],
      ['Chests opened', st.chestsOpened],
      ['Traps triggered', st.trapsTriggered],
      ['Floors cleared', st.floorsCleared],
      ['Times downed', st.deaths],
    ]) {
      const row = el('div', 'statline');
      row.appendChild(el('span', 'k', k));
      row.appendChild(el('span', 'v', String(v)));
      block.appendChild(row);
    }
    runWrap.appendChild(block);
    cols.appendChild(runWrap);
    pane.appendChild(cols);
  }

  /**
   * The compendium. Fills in as the party meets things, so it is a record of
   * what this run has actually shown you rather than a spoiler list.
   */
  renderCodex() {
    const pane = $('#pane-codex');
    pane.innerHTML = '';
    const codex = this.world?.codex || { monsters: [], traps: [] };

    const total = Object.keys(MONSTERS).length + Object.keys(TRAP_INFO).length;
    const found = codex.monsters.length + codex.traps.length;
    pane.appendChild(el('h3', null, `Dungeon Compendium - ${found} of ${total} recorded`));

    if (!found) {
      pane.appendChild(el('p', 'sub',
        'Nothing recorded yet. Entries appear the first time you lay eyes on a monster or spot a trap.'));
      return;
    }

    const grid = el('div', 'codexgrid');

    for (const kind of codex.traps) {
      const info = TRAP_INFO[kind];
      if (!info) continue;
      const card = el('div', 'codexcard');
      const art = el('div', 'codexart');
      art.appendChild(trapThumb(kind, info.color));
      card.appendChild(art);
      const text = el('div');
      text.appendChild(el('div', 'cxname', info.name));
      text.appendChild(el('div', 'cxtype', info.persistent ? 'Trap - re-arms' : 'Trap - single use'));
      text.appendChild(el('div', 'cxdesc', info.flavour));
      card.appendChild(text);
      grid.appendChild(card);
    }

    for (const id of codex.monsters) {
      const def = MONSTERS[id];
      if (!def) continue;
      const card = el('div', 'codexcard');
      const art = el('div', 'codexart');
      const img = new Image();
      img.src = portraitUrl('mob', def.sheet);
      art.appendChild(img);
      card.appendChild(art);
      const text = el('div');
      text.appendChild(el('div', 'cxname', def.name));
      text.appendChild(el('div', 'cxtype', `${AI_LABEL[def.ai] || def.ai} - floors ${def.floors[0]}-${def.floors[1]}`));
      text.appendChild(el('div', 'cxdesc', def.flavour));
      const stats = el('div', 'cxstats');
      for (const bit of [`${def.base.hp} hp`, `${def.base.damage} dmg`, `${def.base.armor} arm`, `${def.base.xp} xp`]) {
        stats.appendChild(el('span', null, bit));
      }
      text.appendChild(stats);
      card.appendChild(text);
      grid.appendChild(card);
    }
    pane.appendChild(grid);
  }

  // -------------------------------------------------------------------------
  // Shop
  // -------------------------------------------------------------------------

  openShop(npc) {
    this.shopNpc = npc;
    showScreen('screen-shop');
    this.renderShop();
  }

  closeShop() {
    hideScreen('screen-shop');
    closeItemMenu();
    this.shopNpc = null;
    hideTooltip();
  }

  renderShop() {
    const npc = this.shopNpc;
    const p = this.player;
    if (!npc || !p) return;

    $('#shopname').textContent = `${npc.name} the Merchant`;
    $('#shopgold').textContent = `${p.gold} gold`;

    const stock = $('#shopstock');
    stock.innerHTML = '';
    npc.stock.forEach((entry, index) => {
      if (entry.qty <= 0) return;
      const price = Math.round(entry.item.value * BUY_MARKUP);
      const cell = this.itemCell(entry.item, {
        price,
        priceLabel: 'Costs',
        onClick: () => {
          if (p.gold < price) { toast('Not enough gold'); playSfx('error'); return; }
          this.actions.buy(npc.id, index);
          this.refresh();
        },
      });
      if (p.gold < price) cell.style.opacity = '0.45';
      stock.appendChild(cell);
    });
    if (!stock.childElementCount) stock.appendChild(el('div', 'small dim', 'Sold out.'));

    const bag = $('#shopbag');
    bag.innerHTML = '';
    for (const item of p.inventory) {
      const price = Math.max(1, Math.round(item.value * SELL_RATE) * (item.qty || 1));
      bag.appendChild(this.itemCell(item, {
        price,
        priceLabel: 'Sells for',
        onClick: () => { this.actions.sell(item.uid); playSfx('coin'); this.refresh(); },
        menu: () => [
          { label: `Sell (${price}g)`, run: () => { this.actions.sell(item.uid); playSfx('coin'); } },
          { label: 'Drop', danger: true, run: () => this.actions.dropItem(item.uid) },
        ],
      }));
    }
    if (!bag.childElementCount) bag.appendChild(el('div', 'small dim', 'Nothing to sell.'));
  }
}
