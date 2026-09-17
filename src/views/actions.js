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
import { isOpen, parentRef, matchesActionQuery } from '../domain/queries.js';
import { dueClass, dueLabel, isOverdue, isDueSoon, personOk, inScope } from '../domain/dueness.js';
import {
  actionLabel, ACTION_SORT_COLUMNS, actionSorter, byActionWorkOrder
} from '../domain/actions.js';
import { projectTitle } from '../domain/projects.js';
import { pageHeader, sortableTh } from './shell.js';

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

  // The search narrows before the chips are counted: a chip promises "clicking me
  // shows N", and saying 23 above a three-row table makes the control a liar.
  const narrowed = scoped.filter(function (a) {
    return matchesActionQuery(snap, a, ui.actQuery);
  });

  const counts = {};
  FILTERS.forEach(function (f) {
    counts[f[0]] = narrowed.filter(function (a) { return matches(a, f[0], today); }).length;
  });

  const sortCol = ACTION_SORT_COLUMNS[ui.actSort] ? ui.actSort : null;

  const rows = narrowed
    .filter(function (a) { return matches(a, ui.filter, today); })
    .sort(sortCol ? actionSorter(sortCol, ui.actSortDir) : byActionWorkOrder);

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

  /*
   * The form exists only so `restoreForms` gives the caret back after the redraw
   * that every keystroke causes. Keep it to ONE field: restoreForms abandons a form
   * whose field count changed, and the meeting select beside it is data-derived.
   */
  const search = '<form class="psearch" data-form="actSearch" role="search">' +
    '<label class="sr-only" for="act-q">Search actions</label>' +
    '<input class="fld" id="act-q" type="search" data-input="actQuery" ' +
    'placeholder="Search actions, owners, origins" value="' + esc(ui.actQuery || '') + '">' +
    '</form>';

  const proj = ui.projFilter !== 'all' ? byId(snap.projects, ui.projFilter) : null;
  const projNote = proj
    ? '<button type="button" class="fchip" data-act="clearProjFilter" aria-pressed="true">' +
      esc(projectTitle(proj)) + ' ×</button>'
    : '';

  const dirty = sortCol || ui.actQuery || ui.projFilter !== 'all';
  const reset = dirty
    ? '<button type="button" class="fchip reset" data-act="actReset">Reset</button>'
    : '';

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

  // The header emitter is shared with the Projects table (views/shell.js).
  function th(col, label, cls) {
    return sortableTh({
      columns: ACTION_SORT_COLUMNS, col: col, label: label, cls: cls,
      sortCol: sortCol, dir: ui.actSortDir, act: 'actSort'
    });
  }

  const list = rows.length
    ? '<div class="tbl-scroll"><table class="t">' +
      '<thead><tr>' +
      '<th class="c"><span class="sr-only">Done</span></th>' +
      th('num', 'ID', '') +
      '<th>Action</th><th>Origin</th>' +
      th('owner', 'Owner', '') +
      '<th>Meeting</th>' +
      th('due', 'Due', '') +
      '<th class="c"><span class="sr-only">Remove</span></th>' +
      '</tr></thead><tbody>' +
      rows.map(function (a) { return actionRow(snap, env, a, today); }).join('') +
      '</tbody></table></div>'
    : '<p class="none">' + emptyMessage(ui, scoped.length, narrowed.length) + '</p>';

  const follow = ui.follow
    ? '<div class="follow"><div class="pan-h"><h2>Follow-up text</h2>' +
      '<button class="btn ghost sm" type="button" data-act="toggleFollow">Hide</button></div>' +
      '<textarea class="fld mono" rows="12" readonly>' + esc(followText(snap, rows, today)) + '</textarea></div>'
    : '<button class="btn ghost sm" type="button" data-act="toggleFollow">Follow-up text</button>';

  return pageHeader('Action items', 'One owner each, always a date') +
    '<div class="filters">' + chips + '</div>' +
    '<div class="filters">' + search +
    '<select class="fld" data-edit="regTab" aria-label="Filter by meeting">' + tabOpts + '</select>' +
    projNote + '<span class="sp"></span>' + reset + '</div>' +
    scopeNote + addForm + list + follow;
}

/**
 * One row. `id="row-<id>"` is load-bearing: `focusAction` (handlers.js) scrolls to
 * it and flashes it when you arrive from the Overview or the Timeline.
 */
function actionRow(snap, env, a, today) {
  const tab = byId(snap.tabs, a.tab);
  const open = isOpen(a);

  return '<tr id="row-' + esc(a.id) + '"' + (open ? '' : ' class="done"') + '>' +
    '<td class="c"><input type="checkbox" data-edit="actionDone" data-id="' + esc(a.id) + '"' +
    (open ? '' : ' checked') + ' aria-label="Mark ' + actionLabel(a) + ' done"' + dis(env) + '></td>' +
    '<td class="mono' + (isOverdue(a, today) ? ' overdue' : '') + '">' + actionLabel(a) + '</td>' +
    '<td><span class="atx">' + esc(a.text) + '</span></td>' +
    '<td class="orig">' + originCell(snap, a) + '</td>' +
    '<td>' + esc(a.owner || 'No owner') +
    (a.support ? ' <span class="k">(with ' + esc(a.support) + ')</span>' : '') + '</td>' +
    '<td class="k">' + esc(tab ? tab.name : '') + '</td>' +
    '<td class="duec"><input class="fld" type="date" id="due-' + esc(a.id) + '" value="' +
    esc(a.due || '') + '" data-edit="actionDue" data-id="' + esc(a.id) +
    '" aria-label="Due date for ' + actionLabel(a) + '"' + dis(env) + '>' +
    '<span class="k ' + dueClass(a, today) + '">' + dueLabel(a, today) + '</span></td>' +
    '<td class="c"><button class="x edit-only" type="button" data-act="delAction" data-id="' +
    esc(a.id) + '" aria-label="Delete ' + actionLabel(a) + '"' + dis(env) + '>\u00d7</button></td>' +
    '</tr>';
}

/**
 * Where the action came from, as a link to it.
 *
 * `parentText` resolved this for the meeting summary and the register lost the use
 * of it in the port (board.html:1119 had it). Scanning forty actions, the origin is
 * the column that tells you whether a thing still matters.
 */
function originCell(snap, a) {
  const ref = parentRef(snap, a);
  if (!ref) return '<span class="k">\u2014</span>';

  if (ref.type === 'issue') {
    return '<button type="button" class="linkbtn" data-act="openIssue" data-id="' +
      esc(a.tab) + '" data-v="iss-' + esc(ref.id) + '">' + esc(ref.issue.text) + '</button>';
  }
  return '<button type="button" class="linkbtn" data-act="openProject" data-id="' +
    esc(ref.id) + '">' + esc(projectTitle(ref.project)) + '</button>';
}

/**
 * Why the list is short, naming the control responsible.
 *
 * It used to say "Nothing here." for every reason, which sends people looking for
 * the wrong problem - the same complaint as a filter chip that lies about its count.
 */
function emptyMessage(ui, scopedCount, narrowedCount) {
  if (narrowedCount === 0 && scopedCount > 0) {
    if (ui.actQuery) return 'No actions match that search.';
    if (ui.projFilter !== 'all') return 'No actions on that project.';
  }
  if (narrowedCount > 0) return 'No actions match this filter.';
  if (ui.regTab !== 'all') return 'No actions in this meeting.';
  if (ui.person !== 'all') return 'No actions owned by this person.';
  return 'No actions yet.';
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
