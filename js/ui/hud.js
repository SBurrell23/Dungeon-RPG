import { $, el, iconUrl, portraitUrl, bindTooltip, escapeHtml } from './ui.js';
import { getAbility } from '../game/abilities.js';
import { getClass } from '../game/classes.js';
import { CONSUMABLES } from '../game/items.js';
import { xpToNext, MAX_LEVEL } from '../game/stats.js';
import { DESCENT_TIME, FLOOR_COUNT } from '../game/world.js';
import { clamp } from '../core/util.js';

/**
 * The in-run HUD. Rebuilt structurally only when something changes identity
 * (a new ability bound, a party member joining); the per-frame path just moves
 * bar widths and cooldown text, so it costs nothing at 60fps.
 */
export class Hud {
  constructor() {
    this.hotbarSlots = [];
    this.quickSlots = [];
    this.partyFrames = new Map();
    this.lastSignature = '';
    this.lastPartySig = '';
    this.player = null;
  }

  /** Full rebuild of the hotbar and quick-use row. */
  buildHotbar(player) {
    const bar = $('#hotbar');
    bar.innerHTML = '';
    this.hotbarSlots = [];

    const basic = getAbility(getClass(player.classId).basicAttack);
    const basicSlot = el('div', 'slot');
    basicSlot.appendChild(Object.assign(new Image(), { className: 'ic', src: iconUrl(basic?.icon) }));
    basicSlot.appendChild(el('span', 'key', 'LMB'));
    bindTooltip(basicSlot, () => `<div class="tt-name">${escapeHtml(basic?.name || 'Attack')}</div>
      <div class="tt-type">Basic attack</div><div class="tt-main">${escapeHtml(basic?.desc || '')}</div>`);
    bar.appendChild(basicSlot);

    for (let i = 0; i < 4; i++) {
      const slot = el('div', 'slot');
      slot.appendChild(el('span', 'key', String(i + 1)));
      const img = new Image();
      img.className = 'ic';
      slot.appendChild(img);
      const cd = el('div', 'cd');
      cd.style.display = 'none';
      slot.appendChild(cd);
      bar.appendChild(slot);
      this.hotbarSlots.push({ node: slot, img, cd, abilityId: null });

      bindTooltip(slot, () => {
        const id = this.player?.hotbar[i];
        const ab = getAbility(id);
        if (!ab) return '<div class="tt-name">Empty</div><div class="tt-desc">Bind a spell from the Spells tab.</div>';
        return `<div class="tt-name">${escapeHtml(ab.name)}</div>
          <div class="tt-type">${ab.school}</div>
          <div class="tt-main">${escapeHtml(ab.desc)}</div>
          <div class="tt-aff">${ab.mana} mana &middot; ${ab.cooldown}s cooldown</div>`;
      });
    }

    const quick = $('#quickslots');
    quick.innerHTML = '';
    this.quickSlots = [];
    for (const [key, consumableId] of [['Q', player.quickHeal], ['R', player.quickMana]]) {
      const slot = el('div', 'slot');
      const def = CONSUMABLES[consumableId];
      slot.appendChild(Object.assign(new Image(), { className: 'ic', src: iconUrl(def?.icon) }));
      slot.appendChild(el('span', 'key', key));
      const qty = el('span', 'qty', '0');
      slot.appendChild(qty);
      quick.appendChild(slot);
      this.quickSlots.push({ node: slot, qty, consumableId });
      bindTooltip(slot, () => `<div class="tt-name">${escapeHtml(def?.name || '')}</div>
        <div class="tt-main">${escapeHtml(def?.desc || '')}</div>`);
    }
  }

  update(world, player) {
    if (!player) return;
    this.player = player;

    const sig = `${player.classId}|${player.hotbar.join(',')}|${player.quickHeal}|${player.quickMana}`;
    if (sig !== this.lastSignature) {
      this.lastSignature = sig;
      this.buildHotbar(player);
      $('#portrait').style.backgroundImage = `url(${portraitUrl('hero', player.classId)})`;
      $('#pname').textContent = player.name;
    }

    const s = player.stats;
    $('#plevel').textContent = `Lv ${player.level}`;
    setBar('#hpfill', '#hptext', player.hp, s.maxHp, (a, b) => `${Math.ceil(Math.max(0, a))} / ${Math.round(b)}`);
    // Below a quarter health the bar pulses - readable without looking at it.
    $('#hpfill').parentElement.classList.toggle('low', player.hp / s.maxHp < 0.25);
    setBar('#mpfill', '#mptext', player.mp, s.maxMp, (a, b) => `${Math.ceil(a)} / ${Math.round(b)}`);
    if (player.level >= MAX_LEVEL) {
      setBar('#xpfill', '#xptext', 1, 1, () => 'MAX');
    } else {
      const need = xpToNext(player.level);
      setBar('#xpfill', '#xptext', player.xp, need, (a, b) => `${Math.round(a)} / ${b} xp`);
    }

    this.updateBuffs(player);
    this.updateHotbar(player);
    this.updateParty(world, player);
    this.updateFloor(world);
  }

  updateBuffs(player) {
    const box = $('#buffs');
    const sig = player.buffs.map((b) => b.id + Math.ceil(b.duration)).join('|') + (player.shield > 0 ? '|s' : '');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = '';
    for (const b of player.buffs) {
      if (b.duration > 900) continue;
      const debuff = ['burn', 'poison', 'chill', 'stun'].includes(b.id);
      const chip = el('div', `buffchip${debuff ? ' debuff' : ''}`);
      if (b.icon) chip.appendChild(Object.assign(new Image(), { className: 'ic', src: iconUrl(b.icon) }));
      chip.appendChild(el('span', null, `${b.name} ${Math.ceil(b.duration)}s`));
      box.appendChild(chip);
    }
    if (player.shield > 0) {
      const chip = el('div', 'buffchip');
      chip.appendChild(el('span', null, `Shield ${Math.round(player.shield)}`));
      box.appendChild(chip);
    }
  }

  updateHotbar(player) {
    for (let i = 0; i < this.hotbarSlots.length; i++) {
      const slot = this.hotbarSlots[i];
      const id = player.hotbar[i];
      if (slot.abilityId !== id) {
        slot.abilityId = id;
        const ab = getAbility(id);
        slot.img.src = ab ? iconUrl(ab.icon) : '';
        slot.node.classList.toggle('empty', !ab);
      }
      const ab = getAbility(id);
      const cd = player.cooldowns[id] || 0;
      if (cd > 0.05) {
        slot.cd.style.display = 'flex';
        slot.cd.textContent = cd >= 10 ? Math.ceil(cd) : cd.toFixed(1);
      } else {
        slot.cd.style.display = 'none';
      }
      slot.node.classList.toggle('nomana', !!ab && player.mp < ab.mana);
    }
    for (const q of this.quickSlots) {
      const stack = player.inventory.find((it) => it.type === 'consumable' && it.id === q.consumableId);
      const n = stack?.qty || 0;
      q.qty.textContent = n;
      q.node.classList.toggle('empty', n === 0);
    }
  }

  updateParty(world, localPlayer) {
    const box = $('#party');
    const others = world.players.filter((p) => p !== localPlayer);
    const sig = others.map((p) => p.id).join(',');
    if (sig !== this.lastPartySig) {
      this.lastPartySig = sig;
      box.innerHTML = '';
      this.partyFrames.clear();
      for (const p of others) {
        const frame = el('div', 'partyframe');
        const top = el('div', 'pf-top');
        top.appendChild(el('span', null, p.name));
        const lvl = el('span', 'pf-cls', `Lv ${p.level}`);
        top.appendChild(lvl);
        frame.appendChild(top);
        const hp = el('div', 'bar hp');
        const hpFill = el('div', 'fill');
        hp.appendChild(hpFill);
        frame.appendChild(hp);
        const mp = el('div', 'bar mp');
        const mpFill = el('div', 'fill');
        mp.appendChild(mpFill);
        frame.appendChild(mp);
        frame.appendChild(el('div', 'pf-cls', getClass(p.classId).name));
        box.appendChild(frame);
        this.partyFrames.set(p.id, { frame, hpFill, mpFill, lvl });
      }
    }
    for (const p of others) {
      const f = this.partyFrames.get(p.id);
      if (!f) continue;
      f.hpFill.style.width = `${clamp((p.hp / p.stats.maxHp) * 100, 0, 100)}%`;
      f.mpFill.style.width = `${clamp((p.mp / (p.stats.maxMp || 1)) * 100, 0, 100)}%`;
      f.lvl.textContent = `Lv ${p.level}`;
      f.frame.classList.toggle('downed', p.downed);
    }
  }

  updateFloor(world) {
    const d = world.dungeon;
    if (!d) return;
    $('#floorname').textContent = `Floor ${world.floorNo} / 10`;
    $('#floorsub').textContent = d.theme.name;

    const obj = $('#objective');
    const prog = world.descent?.progress || 0;
    const sig = prog > 0 ? `ch${prog.toFixed(1)}` : `idle${world.floorNo}`;
    if (obj.dataset.sig === sig) return;
    obj.dataset.sig = sig;
    const last = world.floorNo >= FLOOR_COUNT;
    obj.innerHTML = prog > 0
      ? `${last ? 'Opening the way out' : 'Unlocking the descent'} &mdash; <b>${(DESCENT_TIME - prog).toFixed(1)}s</b> left`
      : (last ? '<b>Escape the dungeon!</b>' : 'Find the descent to the next floor.');
  }
}

function setBar(fillSel, textSel, value, max, fmt) {
  const pct = clamp((value / (max || 1)) * 100, 0, 100);
  const fill = document.querySelector(fillSel);
  if (fill) fill.style.width = `${pct}%`;
  const text = document.querySelector(textSel);
  if (text) text.textContent = fmt(value, max);
}
