import { $, el, showScreen } from './ui.js';
import { getClass } from '../game/classes.js';
import { formatTime, formatNumber } from '../core/util.js';
import { playSfx } from '../audio/sfx.js';

/**
 * Run summary. Shown when the party wipes or clears floor 10 - the same layout
 * either way, because the interesting part is the same either way: what each
 * character actually did.
 */
export function showEndScreen({ victory, world, deepestFloor }) {
  const title = $('#endtitle');
  const sub = $('#endsub');

  if (victory) {
    title.textContent = 'THE DUNGEON IS CLEARED';
    title.style.color = 'var(--gold)';
    sub.textContent = `You reached the bottom of all ten floors and walked back out. Total time ${formatTime(world.runTime * 1000)}.`;
    playSfx('victory');
  } else {
    title.textContent = 'THE PARTY HAS FALLEN';
    title.style.color = '#ff6b6b';
    sub.textContent = `Everyone went down on floor ${deepestFloor}. Total time ${formatTime(world.runTime * 1000)}.`;
    playSfx('defeat');
  }

  const box = $('#endstats');
  box.innerHTML = '';

  const totals = { kills: 0, damageDealt: 0, damageTaken: 0, healingDone: 0, goldEarned: 0, itemsFound: 0, deaths: 0, chestsOpened: 0, trapsTriggered: 0 };
  for (const p of world.players) {
    for (const k in totals) totals[k] += p.stat[k] || 0;
  }

  const summary = el('div', 'endsummary');
  summary.style.gridColumn = '1 / -1';
  summary.innerHTML = `
    <span>Floor reached <b>${deepestFloor} / 10</b></span>
    <span>Total kills <b>${totals.kills}</b></span>
    <span>Damage dealt <b>${formatNumber(totals.damageDealt)}</b></span>
    <span>Gold gathered <b>${formatNumber(totals.goldEarned)}</b></span>
    <span>Items found <b>${totals.itemsFound}</b></span>
    <span>Chests opened <b>${totals.chestsOpened}</b></span>
    <span>Traps sprung <b>${totals.trapsTriggered}</b></span>
    <span>Times downed <b>${totals.deaths}</b></span>
  `;
  box.appendChild(summary);

  // Rank by damage so there is something to argue about afterwards.
  const ranked = [...world.players].sort((a, b) => b.stat.damageDealt - a.stat.damageDealt);
  for (const p of ranked) {
    const cls = getClass(p.classId);
    const card = el('div', 'endcard');
    card.appendChild(el('h4', null, p.name));
    card.appendChild(el('div', 'ecls', `${cls.name} · Level ${p.level}`));
    const rows = [
      ['Kills', p.stat.kills],
      ['Damage dealt', formatNumber(p.stat.damageDealt)],
      ['Damage taken', formatNumber(p.stat.damageTaken)],
      ['Healing done', formatNumber(p.stat.healingDone)],
      ['Gold earned', formatNumber(p.stat.goldEarned)],
      ['Items found', p.stat.itemsFound],
      ['Chests opened', p.stat.chestsOpened],
      ['Traps triggered', p.stat.trapsTriggered],
      ['Times downed', p.stat.deaths],
      ['Final state', p.downed ? 'Fallen' : 'Standing'],
    ];
    for (const [k, v] of rows) {
      const row = el('div', 'erow');
      row.appendChild(el('span', 'k', k));
      row.appendChild(el('span', 'v', String(v)));
      card.appendChild(row);
    }

    const best = bestItem(p);
    if (best) {
      const row = el('div', 'erow');
      row.appendChild(el('span', 'k', 'Best find'));
      row.appendChild(el('span', 'v', best.name));
      card.appendChild(row);
    }
    box.appendChild(card);
  }

  showScreen('screen-end');
}

function bestItem(p) {
  const all = [...Object.values(p.equipment).filter(Boolean), ...p.inventory.filter((i) => i.type === 'equipment')];
  if (!all.length) return null;
  return all.reduce((best, i) => (i.value > (best?.value || 0) ? i : best), null);
}
