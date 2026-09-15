// @ts-check
/**
 * The timeline: the next six weeks of open actions and project due dates.
 *
 * Six weeks because that's the horizon a weekly meeting can actually act on.
 * Anything further out goes in a "later" bucket rather than shrinking the columns
 * that matter, and anything overdue gets its own bucket at the front — late work
 * should not be mixed in with work that is merely upcoming.
 *
 * From board.html:1142-1186.
 */

import { esc } from '../lib/dom.js';
import { fmt, fmtShort, addDays, diffDays, nextOn } from '../lib/dates.js';
import { byId } from '../lib/seq.js';
import { isOpen, personName } from '../domain/queries.js';
import { dueClass, dueLabel, personOk } from '../domain/dueness.js';
import { actionLabel } from '../domain/actions.js';
import { ACTIVE_STATUSES } from '../domain/constants.js';
import { pageHeader } from './shell.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

const WEEKS = 6;

/**
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 */
export function renderTimeline(snap, ui, env) {
  const today = env.today;
  const groupByPerson = ui.tlGroup === 'person';

  /** Everything with a date we care about. */
  const items = [];

  snap.actions
    .filter(function (a) { return isOpen(a) && a.due && personOk(a, ui.person); })
    .forEach(function (a) {
      const tab = byId(snap.tabs, a.tab);
      items.push({
        date: a.due,
        group: groupByPerson ? (a.owner || 'No owner') : (tab ? tab.name : 'No meeting'),
        label: actionLabel(a) + ' ' + a.text,
        meta: (a.owner || 'No owner') + ' · ' + dueLabel(a, today),
        cls: dueClass(a, today),
        kind: 'action',
        id: a.id
      });
    });

  snap.projects
    .filter(function (p) { return p.due && ACTIVE_STATUSES.indexOf(p.status) >= 0; })
    .forEach(function (p) {
      const tab = byId(snap.tabs, p.tab);
      const owner = personName(snap, p.personId);
      if (ui.person !== 'all' && owner !== ui.person) return;
      items.push({
        date: p.due,
        group: groupByPerson ? owner : (tab ? tab.name : 'No meeting'),
        label: p.name,
        meta: owner + ' · project due ' + fmt(p.due),
        cls: p.due < today ? 'over' : '',
        kind: 'project',
        id: p.id
      });
    });

  /* --- week columns, starting from this week's Monday --- */

  // The Monday of the current week. nextOn gives the next Monday ON or after today,
  // so it returns today when today IS Monday; otherwise step back a week.
  const nextMonday = nextOn(today, 1);
  const firstMonday = nextMonday === today ? today : addDays(nextMonday, -7);

  const columns = [];
  for (let i = 0; i < WEEKS; i++) {
    const start = addDays(firstMonday, i * 7);
    columns.push({ start: start, end: addDays(start, 6), items: [] });
  }
  const overdue = [];
  const later = [];

  items.forEach(function (it) {
    if (it.date < columns[0].start) { overdue.push(it); return; }
    const last = columns[columns.length - 1];
    if (it.date > last.end) { later.push(it); return; }
    const week = Math.floor(diffDays(columns[0].start, it.date) / 7);
    columns[Math.min(Math.max(week, 0), WEEKS - 1)].items.push(it);
  });

  function itemHtml(it) {
    return '<li class="tl-in ' + it.cls + '">' +
      '<button type="button" data-act="' +
      (it.kind === 'action' ? 'focusAction' : 'showProjActions') +
      '" data-id="' + esc(it.id) + '">' +
      '<span class="t">' + esc(it.label) + '</span>' +
      '<span class="m">' + esc(it.meta) + '</span></button></li>';
  }

  function bucket(title, list, cls) {
    if (!list.length) return '';
    return '<div class="tl ' + cls + '"><div class="tl-lab">' + title +
      '<span class="cnt n">' + list.length + '</span></div>' +
      '<ul class="items">' + list.map(itemHtml).join('') + '</ul></div>';
  }

  const weekCols = columns.map(function (c, i) {
    const isThisWeek = today >= c.start && today <= c.end;
    return '<div class="tl' + (isThisWeek ? ' today' : '') + '">' +
      '<div class="tl-lab">' + (isThisWeek ? 'This week' : 'Week of ' + fmtShort(c.start)) +
      (c.items.length ? '<span class="cnt n">' + c.items.length + '</span>' : '') + '</div>' +
      (c.items.length
        ? '<ul class="items">' + c.items.map(itemHtml).join('') + '</ul>'
        : '<p class="tl-empty">Clear</p>') +
      '</div>';
  }).join('');

  const toggle = '<div class="filters">' +
    '<button type="button" class="fchip' + (!groupByPerson ? ' sel' : '') +
    '" data-act="tlGroup" data-v="meeting">By meeting</button>' +
    '<button type="button" class="fchip' + (groupByPerson ? ' sel' : '') +
    '" data-act="tlGroup" data-v="person">By person</button></div>';

  return pageHeader('Timeline', 'The next six weeks of dated work') + toggle +
    '<div class="tl-scroll">' +
    bucket('Overdue', overdue, 'tl-over') +
    weekCols +
    bucket('Later', later, 'tl-later') +
    '</div>' +
    (!items.length ? '<p class="none">Nothing dated' +
      (ui.person !== 'all' ? ' for ' + esc(ui.person) : '') + '.</p>' : '');
}
