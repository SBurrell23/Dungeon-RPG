import { $, el, iconUrl, portraitUrl, showScreen } from './ui.js';
import { CLASSES, CLASS_ORDER, getClass } from '../game/classes.js';
import { getAbility } from '../game/abilities.js';

/**
 * Menu and party lobby.
 *
 * Purely presentational: it renders whatever roster it is handed and reports
 * intent back through `callbacks`. The host owns the actual lobby state.
 */
export class Lobby {
  constructor(callbacks) {
    this.cb = callbacks;
    this.selected = 'knight';
    this.roster = [];
    this.isHost = false;
    this.ready = false;
    this.buildClassList();
    this.bind();
  }

  bind() {
    $('#btn-ready').addEventListener('click', () => {
      this.ready = !this.ready;
      $('#btn-ready').textContent = this.ready ? 'Not ready' : 'Ready';
      this.cb.onReady(this.ready, this.selected);
    });
    $('#btn-begin').addEventListener('click', () => this.cb.onBegin($('#input-seed').value.trim()));
    $('#btn-leave').addEventListener('click', () => this.cb.onLeave());
    $('#btn-copy').addEventListener('click', () => {
      const code = $('#roomcode').textContent;
      navigator.clipboard?.writeText(code);
      $('#btn-copy').textContent = 'Copied';
      setTimeout(() => { $('#btn-copy').textContent = 'Copy'; }, 1400);
    });
  }

  buildClassList() {
    const list = $('#classlist');
    list.innerHTML = '';
    for (const id of CLASS_ORDER) {
      const cls = CLASSES[id];
      const row = el('div', 'classrow');
      row.dataset.classId = id;
      const img = new Image();
      img.className = 'spritebox';
      img.src = portraitUrl('hero', id);
      row.appendChild(img);
      const text = el('div');
      text.appendChild(el('div', 'cname', cls.name));
      text.appendChild(el('div', 'crole', cls.role));
      row.appendChild(text);
      row.appendChild(el('span', 'taken'));
      row.addEventListener('click', () => this.select(id));
      list.appendChild(row);
    }
    this.select(this.selected);
  }

  /** Portraits need the assets loaded, so refresh them once loading finishes. */
  refreshPortraits() {
    for (const row of document.querySelectorAll('.classrow')) {
      const img = row.querySelector('img');
      if (img) img.src = portraitUrl('hero', row.dataset.classId);
    }
    this.renderDetail();
  }

  select(id) {
    this.selected = id;
    for (const row of document.querySelectorAll('.classrow')) {
      row.classList.toggle('sel', row.dataset.classId === id);
    }
    this.renderDetail();
    this.cb.onSelect?.(id);
  }

  renderDetail() {
    const cls = getClass(this.selected);
    const box = $('#classdetail');
    box.innerHTML = '';

    const head = el('div');
    head.appendChild(el('div', 'cd-name', cls.name));
    head.appendChild(el('div', 'cd-tag', cls.tagline));
    box.appendChild(head);
    box.appendChild(el('div', 'cd-blurb', cls.blurb));

    const stats = el('div', 'statgrid');
    const b = cls.base, g = cls.growth;
    const rows = [
      ['Health', `${b.hp} (+${g.hp}/lvl)`],
      ['Mana', `${b.mp} (+${g.mp}/lvl)`],
      ['Strength', `${b.str} (+${g.str})`],
      ['Dexterity', `${b.dex} (+${g.dex})`],
      ['Intellect', `${b.int} (+${g.int})`],
      ['Vitality', `${b.vit} (+${g.vit})`],
      ['Move speed', b.speed],
      ['Weapon', cls.weaponFamily],
    ];
    for (const [k, v] of rows) {
      const row = el('div', 'row');
      row.appendChild(el('span', 'k', k));
      row.appendChild(el('span', 'v', v));
      stats.appendChild(row);
    }
    box.appendChild(stats);

    for (const abId of [cls.basicAttack, cls.ability]) {
      const ab = getAbility(abId);
      if (!ab) continue;
      const card = el('div', 'abilitycard');
      card.appendChild(Object.assign(new Image(), { className: 'ic', src: iconUrl(ab.icon) }));
      const body = el('div');
      body.appendChild(el('div', 'an', `${ab.name}${ab.basic ? '  (basic attack)' : ''}`));
      body.appendChild(el('div', 'ad', ab.desc));
      card.appendChild(body);
      box.appendChild(card);
    }
  }

  open({ isHost, roomCode }) {
    this.isHost = isHost;
    this.ready = false;
    $('#btn-ready').textContent = 'Ready';
    $('#roomcode').textContent = roomCode || 'SOLO';
    for (const n of document.querySelectorAll('.hostonly')) n.style.display = isHost ? '' : 'none';
    $('#lobby-sub').textContent = isHost
      ? 'Share the room code, pick a class, then begin the descent.'
      : 'Pick a class and ready up. The host starts the run.';
    showScreen('screen-lobby');
    this.renderRoster(this.roster);
  }

  renderRoster(roster) {
    this.roster = roster || [];
    const box = $('#partylist');
    box.innerHTML = '';
    const takenBy = new Map();
    for (const p of this.roster) {
      const chip = el('div', `partychip${p.ready ? ' ready' : ''}`);
      chip.appendChild(el('span', 'dot'));
      chip.appendChild(el('span', null, `${p.name} - ${getClass(p.classId).name}`));
      if (p.isHost) chip.appendChild(el('span', 'small dim', 'host'));
      box.appendChild(chip);
      takenBy.set(p.classId, (takenBy.get(p.classId) || 0) + 1);
    }
    for (const row of document.querySelectorAll('.classrow')) {
      const n = takenBy.get(row.dataset.classId) || 0;
      row.querySelector('.taken').textContent = n ? `x${n}` : '';
    }
    const allReady = this.roster.length > 0 && this.roster.every((p) => p.ready);
    const begin = $('#btn-begin');
    begin.disabled = !allReady;
    begin.textContent = allReady ? 'Begin Descent' : 'Waiting for party…';
  }
}
