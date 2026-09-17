// @ts-check
/**
 * Every project, across every meeting, in one list.
 *
 * Until this existed the only way to find a project was to remember which meeting
 * it belonged to and open that meeting's Current Projects segment. That is fine
 * while you are running the meeting and useless the rest of the week, which is the
 * gap that started this whole set of changes.
 *
 * ## Why a table rather than the tile the meeting uses
 *
 * A meeting's project row is a control surface: status buttons, priority arrows,
 * a details panel. That is right when you are working through one person's list and
 * wrong when you are scanning forty projects for the one you half-remember. This is
 * for scanning, so it is a table, and the only thing you can do to a row is open it.
 *
 * It sits inside `.tbl-scroll`, which scrolls sideways on a narrow screen instead of
 * forcing the page wider than the window. That is not a detail: forcing the page
 * wider is exactly how the timeline became unusable, with the sidebar pushed off
 * the edge and no way back.
 *
 * ## The order
 *
 * Off track first, then by due date, soonest first, undated last. That is the order
 * you would work down it. Projects carry a `priority` too, but it is per person per
 * meeting — two people's lists are numbered independently — so it cannot order a
 * list that spans both. It is used within a person's block in the meeting, and
 * deliberately ignored here.
 */

import { esc } from '../lib/dom.js';
import { fmt } from '../lib/dates.js';
import { byId } from '../lib/seq.js';
import { personName, openActsFor, detailsArrived } from '../domain/queries.js';
import { STATUS_LABELS, ACTIVE_STATUSES } from '../domain/constants.js';
import {
  projectTitle, byTitleThenId, projectSorter, matchesQuery, matchesValue,
  distinctValues, SORT_COLUMNS
} from '../domain/projects.js';
import { pageHeader, kpi, sortableTh } from './shell.js';
import { moneyShort } from './project.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

/**
 * The status filters, in the order they are offered.
 *
 * 'live' leads and is the default because a list of everything ever cancelled is
 * not what anybody opens this for. 'all' is there so nothing is unreachable.
 */
const FILTERS = [
  ['live', 'Live'],
  ['off', 'Off track'],
  ['on', 'On track'],
  ['hold', 'On hold'],
  ['new', 'New'],
  ['done', 'Done'],
  ['cancelled', 'Cancelled'],
  ['all', 'All']
];

/**
 * Does this project pass the status filter?
 *
 * @param {any} p
 * @param {string} filter
 */
export function matchesStatus(p, filter) {
  if (filter === 'all') return true;
  if (filter === 'live') return ACTIVE_STATUSES.indexOf(p.status) >= 0;
  return p.status === filter;
}

/**
 * Order for working down: off track first, then soonest due, undated last.
 *
 * @param {any} a
 * @param {any} b
 */
export function byWorkOrder(a, b) {
  const off = function (p) { return p.status === 'off' ? 0 : 1; };
  if (off(a) !== off(b)) return off(a) - off(b);

  const due = function (p) { return p.due || '9999-99-99'; };
  if (due(a) !== due(b)) return due(a) < due(b) ? -1 : 1;

  // Stable and predictable when everything else ties, so the list does not
  // reshuffle between renders. Shared with every sorted order, so they all end
  // the same way.
  return byTitleThenId(a, b);
}

/**
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 * @returns {string}
 */
export function renderProjects(snap, ui, env) {
  const today = env.today;
  const showValue = detailsArrived(snap);

  /*
   * A sort remembered from a session where this person could see the money must not
   * be honoured now that they cannot - there would be a sorted-by column they cannot
   * see, ordering the list for reasons invisible to them.
   */
  const sortCol = (ui.projSort === 'value' && !showValue) ? null : ui.projSort;

  // The sidebar's "Show items for" scopes this too. Projects record an owner by
  // ID where actions record a NAME, so this compares the resolved name rather than
  // the raw field - see the owner-id migration in the port plan.
  const scoped = snap.projects.filter(function (p) {
    if (ui.projTab !== 'all' && p.tab !== ui.projTab) return false;
    if (ui.person !== 'all' && personName(snap, p.personId) !== ui.person) return false;
    return true;
  });

  /*
   * The dropdown menus are built from `scoped` - after the person and meeting scope,
   * and BEFORE the search, the status chips and each other.
   *
   * Each of those exclusions is a rule somebody would otherwise trip over. Options
   * drawn from the searched set vanish while you type. Options drawn from the
   * status-filtered set reshuffle when you touch an unrelated control. And two
   * filters narrowing each other's menus means you cannot change Field without
   * first resetting Type, because the option you want is no longer offered.
   *
   * The cost is that a combination can produce nothing. That is met with a count in
   * each label and an honest empty message, not by designing it away.
   */
  const fieldOpts = distinctValues(scoped, 'field');
  const typeOpts = distinctValues(scoped, 'projectType');

  const narrowed = scoped.filter(function (p) {
    return matchesQuery(snap, p, ui.projQuery) &&
      matchesValue(p, 'field', ui.projField) &&
      matchesValue(p, 'projectType', ui.projType);
  });

  // Counts come from `narrowed`, not `scoped`: a chip promises "clicking me shows
  // N", and 23 above a three-row table makes the control a liar.
  const counts = {};
  FILTERS.forEach(function (f) {
    counts[f[0]] = narrowed.filter(function (p) { return matchesStatus(p, f[0]); }).length;
  });

  const rows = narrowed
    .filter(function (p) { return matchesStatus(p, ui.projStatus); })
    .sort(sortCol ? projectSorter(snap, sortCol, ui.projSortDir) : byWorkOrder);

  /* ------------------------------------------------------------- the numbers */

  // The numbers describe the same set the table is drawn from, so they narrow with
  // it. "Live projects 23" over three rows is the same lie a wrong chip count is.
  const live = narrowed.filter(function (p) {
    return ACTIVE_STATUSES.indexOf(p.status) >= 0;
  });
  const offTrack = live.filter(function (p) { return p.status === 'off'; });
  const overdue = live.filter(function (p) { return p.due && p.due < today; });

  const valued = showValue
    ? live.reduce(function (sum, p) {
        const d = byId(snap.projectDetails, p.id);
        return sum + (d && d.estValue != null ? Number(d.estValue) : 0);
      }, 0)
    : null;

  const numbers = '<section class="kpis" aria-label="At a glance">' +
    kpi('', live.length, 'Live projects',
      narrowed.length - live.length
        ? (narrowed.length - live.length) + ' closed'
        : 'none closed') +
    kpi(offTrack.length ? 'warn' : 'good', offTrack.length, 'Off track',
      offTrack.length ? 'need a path' : 'all on track') +
    kpi(overdue.length ? 'crit' : '', overdue.length, 'Past due',
      overdue.length ? 'past their date' : 'none late') +
    (showValue
      ? kpi('', valued ? moneyShort(valued) : '—', 'Annual value', 'live projects, summed')
      : kpi('', live.filter(function (p) { return p.winPct != null; }).length,
          'Judged', 'have a confidence')) +
    '</section>';

  /* ------------------------------------------------------------- the filters */

  const chips = FILTERS.map(function (f) {
    return '<button type="button" class="fchip" data-act="projStatusFilter" data-v="' +
      f[0] + '" aria-pressed="' + (ui.projStatus === f[0]) + '">' +
      f[1] + '<span class="cnt n">' + counts[f[0]] + '</span></button>';
  }).join('');

  const tabOpts = '<option value="all">All meetings</option>' + snap.tabs.map(function (t) {
    return '<option value="' + esc(t.id) + '"' +
      (ui.projTab === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>';
  }).join('');

  /*
   * Two rows. The chips keep the first one to themselves - they are the most used
   * control and their position is muscle memory - and everything added here goes on
   * a second row rather than wrapping awkwardly onto the end of the first.
   *
   * The search box is wrapped in a form for ONE reason: captureForms/restoreForms
   * only walk `form[data-form]`, and without it the caret is lost on the first
   * keystroke, because every keystroke redraws the page. The form has no submit
   * handler and needs none - main.js preventDefaults any data-form submit, so Enter
   * is harmless. Keep it to a single field: restoreForms abandons a form whose field
   * count changed, and the two selects' option lists are data-derived and will.
   */
  const search = '<form class="psearch" data-form="projSearch" role="search">' +
    '<label class="sr-only" for="projq">Search projects</label>' +
    '<input id="projq" class="fld" type="search" autocomplete="off" ' +
    'data-input="projQuery" value="' + esc(ui.projQuery || '') + '" ' +
    'placeholder="Search customer, project, field, type, owner">' +
    '</form>';

  const anyNarrowing = !!(ui.projQuery) || ui.projField !== 'all' ||
    ui.projType !== 'all' || !!sortCol;

  const reset = anyNarrowing
    ? '<button type="button" class="fchip reset" data-act="projReset" ' +
      'aria-label="Clear the search, both filters and the sort">Reset</button>'
    : '';

  const filters = '<div class="filters">' + chips + '</div>' +
    '<div class="filters">' + search +
    '<select class="fld" data-edit="projTabFilter" aria-label="Filter by meeting">' +
    tabOpts + '</select>' +
    valueSelect('projFieldFilter', 'Filter by field', 'All fields',
      fieldOpts, ui.projField) +
    valueSelect('projTypeFilter', 'Filter by project type', 'All types',
      typeOpts, ui.projType) +
    '<span class="sp"></span>' + reset + '</div>';

  const showing = anyNarrowing && narrowed.length !== scoped.length
    ? '<p class="scope-note">Showing ' + narrowed.length + ' of ' + scoped.length +
      (ui.projQuery ? ' \u00b7 matching \u201c' + esc(ui.projQuery) + '\u201d' : '') +
      '</p>'
    : '';

  const scopeNote = ui.person !== 'all'
    ? '<p class="scope-note">Showing only projects owned by <b>' + esc(ui.person) +
      '</b>. <button type="button" class="linkbtn" data-act="clearPerson">' +
      'Show everyone</button></p>'
    : '';

  /* ---------------------------------------------------------------- the list */

  const head = pageHeader('Projects',
    rows.length + (rows.length === 1 ? ' project' : ' projects') +
    (ui.projStatus === 'all' ? '' : ' · ' + labelOf(ui.projStatus).toLowerCase()),
    '', 'Across every meeting');

  // The header emitter is shared with the Action items table (views/shell.js);
  // this binds the parts that are the same on every call.
  function th(col, label, cls) {
    return sortableTh({
      columns: SORT_COLUMNS, col: col, label: label, cls: cls,
      sortCol: sortCol, dir: ui.projSortDir, act: 'projSort'
    });
  }

  const table = rows.length
    ? '<div class="tbl-scroll"><table class="t">' +
      '<thead><tr>' +
      '<th>Project</th><th>Field</th><th>Type</th>' +
      '<th>Meeting</th><th>Owner</th><th>Status</th>' +
      th('due', 'Due', '') +
      '<th class="c">Open</th>' +
      th('win', 'Win', 'c') +
      (showValue ? th('value', 'Value', '') : '') +
      '</tr></thead><tbody>' +
      rows.map(function (p) { return projectRow(snap, env, p, showValue); }).join('') +
      '</tbody></table></div>'
    : '<p class="none">' +
      emptyMessage(ui, scoped.length, narrowed.length) + '</p>';

  return head + numbers + filters + scopeNote + showing + table;
}

/**
 * A dropdown of the values actually in use for a free-text field.
 *
 * A selection that is no longer among the options gets rendered anyway, at the end,
 * showing (0). Otherwise the select would show nothing selected while the filter was
 * still narrowing the list - invisible, and the table looks empty for no reason. A
 * view cannot write ui state, so it has to say what is going on instead.
 *
 * @param {string} edit - the data-edit handler name
 * @param {string} label
 * @param {string} allLabel
 * @param {{value: string, label: string, n: number}[]} options
 * @param {string} chosen
 */
function valueSelect(edit, label, allLabel, options, chosen) {
  const known = options.some(function (o) { return o.value === chosen; });

  const orphan = !known && chosen !== 'all'
    ? '<option value="' + esc(chosen) + '" selected>' + esc(chosen) + ' (0)</option>'
    : '';

  return '<select class="fld" data-edit="' + edit + '" aria-label="' + label + '">' +
    '<option value="all"' + (chosen === 'all' ? ' selected' : '') + '>' +
    allLabel + '</option>' +
    options.map(function (o) {
      return '<option value="' + esc(o.value) + '"' +
        (o.value === chosen ? ' selected' : '') + '>' +
        esc(o.label) + ' (' + o.n + ')</option>';
    }).join('') + orphan + '</select>';
}

function labelOf(value) {
  const found = FILTERS.filter(function (f) { return f[0] === value; })[0];
  return found ? found[1] : value;
}

/**
 * Why the list is empty, which is not always the same reason.
 *
 * "No projects" when a filter is hiding them all is the kind of message that has
 * people adding a duplicate because they believe the first one is gone.
 */
function emptyMessage(ui, scopedCount, narrowedCount) {
  // Name the control responsible, most specific first. "No projects" when a search
  // is what emptied the list sends people looking for the wrong problem.
  if (narrowedCount === 0 && scopedCount > 0) {
    if (ui.projQuery) return 'No projects match that search.';
    if (ui.projField !== 'all') return 'No projects in that field.';
    if (ui.projType !== 'all') return 'No projects of that type.';
  }
  if (scopedCount > 0) return 'No projects match this filter.';
  if (ui.projTab !== 'all') return 'No projects in this meeting.';
  if (ui.person !== 'all') return 'No projects owned by this person.';
  return 'No projects yet.';
}

function projectRow(snap, env, p, showValue) {
  const tab = byId(snap.tabs, p.tab);
  const open = openActsFor(snap, p.id);
  const overdue = p.due && p.due < env.today;
  const details = byId(snap.projectDetails, p.id);

  const focus = (p.focus || []).length
    ? '<div class="k">' + (p.focus || []).map(esc).join(' · ') + '</div>'
    : '';

  return '<tr>' +
    '<td><button type="button" class="linkbtn" data-act="openProject" data-id="' +
    esc(p.id) + '">' + esc(projectTitle(p)) + '</button>' + focus + '</td>' +
    '<td class="k">' + esc(p.field || '—') + '</td>' +
    '<td class="k">' + esc(p.projectType || '—') + '</td>' +
    '<td class="k">' + esc(tab ? tab.name : '—') + '</td>' +
    '<td class="k">' + esc(personName(snap, p.personId)) + '</td>' +
    '<td><span class="chip ps-' + esc(p.status) + '">' +
    (STATUS_LABELS[p.status] || p.status) + '</span></td>' +
    '<td class="mono' + (overdue ? ' overdue' : '') + '">' +
    (p.due ? fmt(p.due) : '—') + '</td>' +
    '<td class="c">' + (open || '—') + '</td>' +
    '<td class="c">' + (p.winPct == null ? '—' : p.winPct + '%') + '</td>' +
    (showValue
      ? '<td class="mono">' +
        (details && details.estValue != null ? moneyShort(details.estValue) : '—') +
        '</td>'
      : '') +
    '</tr>';
}
