// @ts-check
/**
 * The action register: every action across every meeting, filtered.
 *
 * This is the view that outlives the meeting. The filters exist because the useful
 * question is never "show me everything" — it's "what's late", "what's mine", or
 * "what's coming this week".
 *
 * The follow-up text is a plain-text digest grouped by owner, for pasting into a
 * chat or an email. Deliberately not a mail-merge: someone reads it before sending.
 *
 * From board.html:1100-1136.
 */

import { esc } from '../lib/dom.js';
import { byId } from '../lib/seq.js';
import { isOpen } from '../domain/queries.js';
import { dueClass, dueLabel, isOverdue, isDueSoon, personOk, inScope } from '../domain/dueness.js';
import { actionLabel } from '../domain/actions.js';
import { pageHeader } from './shell.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

const FILTERS = [
  ['open', 'Open'],
  ['over', 'Overdue'],
  ['soon', 'Next 7 days'],
  ['done', 'Done'],
  ['all', 'All']
];

function dis(env) {
  return env.areaReadonly ? ' disabled' : '';
}

/** Does an action pass the named filter? */
function matches(a, filter, today) {
  if (filter === 'all') return true;
  if (filter === 'open') return isOpen(a);
  if (filter === 'over') return isOverdue(a, today);
  if (filter === 'soon') return isDueSoon(a, today);
  if (filter === 'done') return !isOpen(a);
  return true;
}

/**
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 */
export function renderActions(snap, ui, env) {
  const today = env.today;

  const scoped = snap.actions.filter(function (a) {
    return inScope(a, ui.regTab) && personOk(a, ui.person) &&
      (ui.projFilter === 'all' || (a.parent && a.parent.id === ui.projFilter));
  });

  const counts = {};
  FILTERS.forEach(function (f) {
    counts[f[0]] = scoped.filter(function (a) { return matches(a, f[0], today); }).length;
  });

  const rows = scoped
    .filter(function (a) { return matches(a, ui.filter, today); })
    .sort(function (a, b) {
      if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
      return (a.due || '9') < (b.due || '9') ? -1 : 1;
    });

  const chips = FILTERS.map(function (f) {
    return '<button type="button" class="fchip' + (ui.filter === f[0] ? ' sel' : '') +
      '" data-act="filter" data-v="' + f[0] + '"' +
      (ui.filter === f[0] ? ' aria-pressed="true"' : '') + '>' +
      f[1] + '<span class="cnt n">' + counts[f[0]] + '</span></button>';
  }).join('');

  const tabOpts = '<option value="all">All meetings</option>' + snap.tabs.map(function (t) {
    return '<option value="' + esc(t.id) + '"' +
      (ui.regTab === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>';
  }).join('');

  const scopeNote = ui.person !== 'all'
    ? '<p class="scope-note">Showing only work owned or supported by <b>' + esc(ui.person) +
      '</b>. <button type="button" class="linkbtn" data-act="clearPerson">Show everyone</button></p>'
    : '';

  const addForm = ui.open === 'action'
    ? '<form class="add" data-form="action" data-tab="' + esc(ui.regTab === 'all' ? (snap.tabs[0] ? snap.tabs[0].id : '') : ui.regTab) + '">' +
      '<input class="fld" name="text" type="text" placeholder="What will be done" required>' +
      '<select class="fld" name="owner" aria-label="Owner" required>' +
      '<option value="">Owner…</option>' + snap.people.map(function (p) {
        return '<option value="' + esc(p.name) + '">' + esc(p.name) + '</option>';
      }).join('') + '</select>' +
      '<input class="fld" name="due" type="date" required aria-label="Due date">' +
      '<button class="btn" type="submit">Add</button>' +
      '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
    : '<button class="btn ghost add-btn edit-only" type="button" data-act="openForm" data-v="action"' + dis(env) + '>+ Action</button>';

  const list = rows.length
    ? '<ul class="alist">' + rows.map(function (a) {
        const tab = byId(snap.tabs, a.tab);
        return '<li class="arow ' + dueClass(a, today) + (isOpen(a) ? '' : ' done-row') +
          '" id="row-' + esc(a.id) + '">' +
          '<label class="ax"><input type="checkbox" data-edit="actionDone" data-id="' + esc(a.id) + '"' +
          (isOpen(a) ? '' : ' checked') + dis(env) + '>' +
          '<span class="aid">' + actionLabel(a) + '</span></label>' +
          '<span class="atext">' + esc(a.text) + '</span>' +
          '<span class="own">' + esc(a.owner || 'No owner') +
          (a.support ? ' <span class="muted">(with ' + esc(a.support) + ')</span>' : '') + '</span>' +
          '<span class="m">' + esc(tab ? tab.name : '') + '</span>' +
          '<input class="fld dt" type="date" value="' + esc(a.due || '') +
          '" data-edit="actionDue" data-id="' + esc(a.id) + '" aria-label="Due date for ' + actionLabel(a) + '"' + dis(env) + '>' +
          '<span class="adue ' + dueClass(a, today) + '">' + dueLabel(a, today) + '</span>' +
          '<button class="x edit-only" type="button" data-act="delAction" data-id="' + esc(a.id) +
          '" aria-label="Delete ' + actionLabel(a) + '"' + dis(env) + '>×</button></li>';
      }).join('') + '</ul>'
    : '<p class="none">Nothing here.</p>';

  const follow = ui.follow
    ? '<div class="follow"><div class="pan-h"><h2>Follow-up text</h2>' +
      '<button class="btn ghost sm" type="button" data-act="toggleFollow">Hide</button></div>' +
      '<textarea class="fld mono" rows="12" readonly>' + esc(followText(snap, rows, today)) + '</textarea></div>'
    : '<button class="btn ghost sm" type="button" data-act="toggleFollow">Follow-up text</button>';

  return pageHeader('Action items', 'One owner each, always a date',
    '<select class="fld" data-edit="regTab" aria-label="Filter by meeting">' + tabOpts + '</select>') +
    '<div class="filters">' + chips + '</div>' + scopeNote + addForm + list + follow;
}

/**
 * The digest, grouped by owner. Grouped that way because the point is to send one
 * person their own list, not to send everyone the whole board.
 *
 * @param {Snapshot} snap
 * @param {any[]} rows
 * @param {string} today
 */
export function followText(snap, rows, today) {
  const byOwner = {};
  rows.forEach(function (a) {
    const key = a.owner || 'No owner';
    if (!byOwner[key]) byOwner[key] = [];
    byOwner[key].push(a);
  });

  const names = Object.keys(byOwner).sort();
  if (!names.length) return 'Nothing to follow up.\n';

  const out = [];
  names.forEach(function (name) {
    out.push(name + ':');
    byOwner[name]
      .sort(function (a, b) { return (a.due || '9') < (b.due || '9') ? -1 : 1; })
      .forEach(function (a) {
        const tab = byId(snap.tabs, a.tab);
        out.push('  ' + actionLabel(a) + ' ' + a.text +
          ' — ' + dueLabel(a, today) +
          (tab ? ' (' + tab.name + ')' : '') +
          (isOpen(a) ? '' : ' [done]'));
      });
    out.push('');
  });
  return out.join('\n');
}
