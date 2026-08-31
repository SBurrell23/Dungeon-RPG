import {
  $, el, iconUrl, portraitUrl, bindTooltip, itemTooltip, rarityClass, itemLocked,
  escapeHtml, showScreen, hideScreen, isScreenOpen, hideTooltip, toast,
} from './ui.js';
import { SLOTS, SLOT_LABEL, SELL_RATE, BUY_MARKUP, INVENTORY_SIZE } from '../game/items.js';
import { PRIMARIES, PRIMARY_LABEL, PRIMARY_BLURB, PRIMARY_ICON, xpToNext } from '../game/stats.js';
import { getAbility, SCHOOLS } from '../game/abilities.js';
import { getClass } from '../game/classes.js';
import { playSfx } from '../audio/sfx.js';

/**
 * Inventory, spellbook, run stats and the shop.
 *
 * These panels never mutate game state directly - they call through
 * `actions`, which on the host applies immediately and on a client sends the
 * request to the host. That keeps one authority for everything that matters.
 */
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
    hideTooltip();
  }

  refresh() {
    if (!this.player) return;
    if (isScreenOpen('screen-inventory')) {
      if (this.activeTab === 'inv') this.renderInventory();
      else if (this.activeTab === 'spells') this.renderSpells();
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

    left.appendChild(el('h3', null, 'Combat'));
    const combat = el('div', 'statblock tight');
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
    left.appendChild(combat);
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
        // Right-click drops on the ground where anyone can grab it - the only
        // item-trading mechanism the party has.
        onRightClick: () => {
          this.actions.dropItem(item.uid);
          this.refresh();
        },
      }));
    }
    for (let i = p.inventory.length; i < 32; i++) bag.appendChild(el('div', 'itemcell empty'));
    right.appendChild(bag);
    right.appendChild(el('div', 'small dim baghint',
      'Left-click to equip or use. Right-click to drop it for a teammate. Click an equipped item to take it off.'));
    layout.appendChild(right);

    pane.appendChild(layout);
  }

  itemCell(item, { onClick, onRightClick, price, priceLabel } = {}) {
    const locked = itemLocked(item, this.player);
    const cell = el('div', `itemcell ${rarityClass(item)}${locked ? ' locked' : ''}`);
    cell.appendChild(Object.assign(new Image(), { src: iconUrl(item.icon) }));
    if (item.qty > 1) cell.appendChild(el('span', 'qty', item.qty));
    if (price != null) cell.appendChild(el('span', 'price', `${price}g`));
    // A red level badge is readable at a glance across a full bag.
    if (locked) cell.appendChild(el('span', 'lockbadge', `L${item.levelReq}`));
    bindTooltip(cell, () => itemTooltip(item, this.player, { price, priceLabel }));
    if (onClick) cell.addEventListener('click', onClick);
    if (onRightClick) {
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

    if (p.knownSpells.length <= 1) {
      pane.appendChild(el('p', 'sub', 'Find or buy spell tomes in the dungeon to learn more. Tomes drop from chests, elites and bosses.'));
    }
  }

  /** Run totals - interesting, but not something you need mid-fight. */
  renderStats() {
    const p = this.player;
    const pane = $('#pane-stats');
    pane.innerHTML = '';
    pane.appendChild(el('h2', null, `${escapeHtml(p.name)} - this run`));
    pane.appendChild(el('p', 'sub', `Level ${p.level} - ${Math.round(p.xp)} / ${xpToNext(p.level)} experience`));

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
    pane.appendChild(block);
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
      }));
    }
    if (!bag.childElementCount) bag.appendChild(el('div', 'small dim', 'Nothing to sell.'));
  }
}
