// @ts-check
/**
 * One project, on its own page.
 *
 * The board was built around a meeting - how it flows, segment by segment. This is
 * the same data looked at the other way round: everything about one project in one
 * place, for the weeks between meetings when nobody is running an agenda.
 *
 * ## Built on what the stylesheet already provides
 *
 * `.kpis` for the numbers strip, `.rp` rows for labelled fields, `.stat` for the
 * status control, `.alist`/`.arow` for actions. Only the notes needed anything new,
 * and that lives with the other page-specific rules in index.html.
 *
 * Two shapes here are dictated by the stylesheet rather than chosen, and breaking
 * either silently wrecks the layout:
 *
 * - `.rp` is `grid-template-columns:170px minmax(0,1fr)`, so a row is EXACTLY two
 *   children: `.rp-h` then `.rp-b`. That is what `row()` guarantees.
 * - `.arow` is a four-column grid, so an action row is EXACTLY four children. The
 *   action register emits seven and lets them wrap; this page keeps to four.
 *
 * ## What is deliberately not here
 *
 * No percent-complete: it invites false precision and nobody maintains it honestly.
 * The open and closed action counts say more and keep themselves current. No
 * sub-tasks either - actions already do that job, and a second hierarchy would
 * compete with the one people already use.
 */

import { esc } from '../lib/dom.js';
import { fmt, fmtDay, diffDays, fmtWhen, rel } from '../lib/dates.js';
import { byId } from '../lib/seq.js';
import { isOpen, actsOf, personName, detailsArrived } from '../domain/queries.js';
import { dueClass, dueLabel, isOverdue } from '../domain/dueness.js';
import { STATUS_LABELS, STATUSES } from '../domain/constants.js';
import { actionLabel } from '../domain/actions.js';
import { notesFor, notesOpen, canEditNote } from '../domain/notes.js';
import {
  projectTitle, confidencePoints, valueOptions
} from '../domain/projects.js';
import { pageHeader, kpi } from './shell.js';
import { pickerControl } from './pickers.js';
import { spark } from './spark.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

function dis(env) {
  return env.areaReadonly ? ' disabled' : '';
}

/**
 * Money abbreviated, for the KPI strip: 180000 -> "$180k", 1250000 -> "$1.2M".
 *
 * `.kpi .n` is 30px monospace in a quarter-width column, so a fully written out
 * figure overflows it. The exact number is one row further down the page.
 */
export function moneyShort(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '—';
  const v = Math.round(Number(n));
  const a = Math.abs(v);
  if (a >= 1000000) return '$' + (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1000) return '$' + Math.round(v / 1000) + 'k';
  return '$' + v;
}

/**
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 * @param {any} p - the project
 */
export function renderProject(snap, ui, env, p) {
  const today = env.today;
  const tab = byId(snap.tabs, p.tab);
  const details = byId(snap.projectDetails, p.id);

  // The commercial block appears only when the details collection actually arrived.
  // For somebody without access to that list it is absent because the numbers were
  // never sent, not because the browser chose not to draw them. See detailsArrived().
  const canSeeCommercial = detailsArrived(snap);

  // One reading is a number, not a trend. The line appears once the figure has
  // actually been revisited in a later meeting.
  const points = confidencePoints(p);

  const acts = actsOf(snap, p.id);
  const open = acts.filter(isOpen);
  const overdue = open.filter(function (a) { return isOverdue(a, today); });

  /* ------------------------------------------------------------------ header */

  // Customer and project name together are the title. The customer is no longer
  // repeated in the line underneath, which leaves it saying who owns this and where
  // it is discussed.
  const sub = esc(personName(snap, p.personId)) +
    (tab ? ' · ' + esc(tab.name) : '');

  const back = tab
    ? '<button class="btn ghost sm" type="button" data-act="go" data-v="tab" data-id="' +
      esc(tab.id) + '">‹ ' + esc(tab.name) + '</button>'
    : '<button class="btn ghost sm" type="button" data-act="go" data-v="overview">' +
      '‹ Overview</button>';

  const head = pageHeader(esc(projectTitle(p)), sub,
    back +
    '<button class="btn ghost sm" type="button" data-act="copyProject" data-id="' +
    esc(p.id) + '">Copy summary</button>',
    'Project');

  /* --------------------------------------------- what the project is, in short */

  // Straight under the heading, because the first two fields ARE the heading, and
  // because a project frequently gets entered mid-meeting against the wrong
  // customer or with a placeholder name. Somewhere to correct that has to be the
  // first thing you find, not a row buried under the status control.
  const identity = '<section class="panel"><div class="pan-h"><h2>Project</h2></div>' +
    row('Customer',
      '<input class="fld wide" type="text" value="' + esc(p.customer || '') +
      '" data-edit="projCustomer" data-id="' + esc(p.id) +
      '" placeholder="Who it is for" aria-label="Customer"' + dis(env) + '>') +
    row('Project',
      '<input class="fld wide" type="text" value="' + esc(p.name || '') +
      '" data-edit="projName" data-id="' + esc(p.id) +
      '" placeholder="What it is" aria-label="Project name"' + dis(env) + '>') +
    row('Field',
      '<input class="fld wide" type="text" list="dl-field" value="' + esc(p.field || '') +
      '" data-edit="projField" data-id="' + esc(p.id) +
      '" placeholder="e.g. Coatings" aria-label="Field"' + dis(env) + '>') +
    row('Project Type',
      '<input class="fld wide" type="text" list="dl-ptype" value="' +
      esc(p.projectType || '') +
      '" data-edit="projType" data-id="' + esc(p.id) +
      '" placeholder="e.g. Trial" aria-label="Project type"' + dis(env) + '>') +
    /*
     * The suggestions behind those two boxes: the curated list from People &
     * settings, UNIONED with whatever is already in use on a project.
     *
     * Neither source alone works. The curated list alone loses every value typed
     * before it existed, so a project holding one would not offer it and the next
     * person retypes it - the exact fragmentation these suggestions prevent. Values
     * in use alone means an entry added on the settings screen and never yet used is
     * never offered, which makes that screen decorative.
     *
     * Pure markup: no script, no listener, survives the innerHTML replace.
     */
    datalist('dl-field',
      valueOptions(snap.projects, itemsOf(snap, 'field'), 'field')) +
    datalist('dl-ptype',
      valueOptions(snap.projects, itemsOf(snap, 'projectType'), 'projectType')) +
    '</section>';

  /* ---------------------------------------------------- the numbers up front */

  // How long it has sat where it is. A project marked on track and untouched for
  // three months is telling you something, and nothing else in the board says it.
  const since = p.statusMeeting || p.added || p.start;
  const daysInStatus = since ? Math.max(diffDays(since, today), 0) : null;

  const nextDue = open
    .filter(function (a) { return a.due; })
    .map(function (a) { return a.due; })
    .sort()[0];

  /*
   * `.kpis` is `repeat(4, minmax(0,1fr))` - four slots, no more. A fifth stat does
   * not error, it wraps onto a second row and leaves three empty cells.
   *
   * Value and confidence are shown SEPARATELY and never multiplied together here.
   * The product of dollars and a percentage is not dollars, and printing it with a
   * $ in front invites somebody to add a column of them up and quote the total as
   * money. Whoever wants a risk-adjusted pipeline figure can weight it themselves,
   * in the roll-up where the convention can be stated once - see Power BI report 8
   * in the port plan.
   *
   * Days in status loses its slot to them: the Status panel header a few lines below
   * already says "34 days as off track", so nothing is actually lost.
   */
  const numbers = '<section class="kpis" aria-label="At a glance">' +
    kpi('', open.length, 'Open actions',
      acts.length ? (acts.length - open.length) + ' closed' : 'none yet') +
    kpi(overdue.length ? 'crit' : 'good', overdue.length, 'Overdue',
      overdue.length ? 'past their date' : 'nothing late') +
    // Only the value slot is conditional. Confidence sits on the project and is
    // shown to everyone, so it keeps its place either way.
    (canSeeCommercial
      ? kpi('', details && details.estValue != null ? moneyShort(details.estValue) : '—',
          'Annual value', 'dollars per year')
      : kpi(daysInStatus != null && daysInStatus > 60 ? 'warn' : '',
          daysInStatus == null ? '—' : daysInStatus, 'Days in status',
          STATUS_LABELS[p.status] || p.status)) +
    kpi('', p.winPct != null ? p.winPct + '%' : '—',
      'Win confidence', 'how likely we are to land it') +
    '</section>';

  /* --------------------------------------------------- status, dates, origin */

  const statusButtons = STATUSES.map(function (v) {
    return '<button type="button" data-act="projStatus" data-id="' + esc(p.id) +
      '" data-v="' + v + '" aria-pressed="' + (p.status === v) + '"' + dis(env) + '>' +
      STATUS_LABELS[v] + '</button>';
  }).join('');

  // Where it came from. Nothing else in the board answers this months later.
  let origin = p.added ? 'Added ' + fmtDay(p.added) : '';
  if (p.fromOpp) {
    const entry = byId(snap.entries, p.fromOpp);
    origin = 'Raised as an opportunity' +
      (entry && entry.meeting ? ' on ' + fmtDay(entry.meeting) : '') +
      (entry && entry.personId ? ' by ' + esc(personName(snap, entry.personId)) : '');
  }

  const statusPanel = '<section class="panel">' +
    '<div class="pan-h"><h2>Status</h2><span class="sub">' +
    (daysInStatus == null
      ? 'set in this meeting'
      : daysInStatus + ' days as ' + (STATUS_LABELS[p.status] || p.status).toLowerCase()) +
    '</span></div>' +
    row('Status',
      '<div class="stat" role="group" aria-label="Status of ' + esc(p.name) + '">' +
      statusButtons + '</div>' +
      (p.status === 'off' && !open.length
        ? '<p class="why"><b class="warnt">Off track with no action yet</b> — it is ' +
          'sitting in the Issues queue until somebody owns a next step.</p>'
        : '')) +
    row('Due',
      '<input class="fld" type="date" value="' + esc(p.due || '') +
      '" data-edit="projDue" data-id="' + esc(p.id) + '" aria-label="Due date"' +
      dis(env) + '>' +
      (p.due ? '<span class="why">' + rel(p.due, today) + '</span>' : '')) +
    (p.start ? row('Starts', '<span class="why">' + fmtDay(p.start) + '</span>') : '') +
    (origin ? row('Origin', '<span class="why">' + origin + '</span>') : '') +
    '</section>';

  /* ----------------------------------------------------------------- mission */

  const mission = '<section class="panel"><div class="pan-h"><h2>Mission</h2>' +
    '<span class="sub">What this project is for</span></div>' +
    '<textarea class="fld" rows="3" data-edit="projMission" data-id="' + esc(p.id) +
    '" placeholder="Why this project exists, in a sentence or two."' + dis(env) + '>' +
    esc(p.mission || '') + '</textarea></section>';

  /* -------------------------------------------------------------- commercial */

  /*
   * One panel, two permission levels.
   *
   * The dollar value comes from the restricted list and may simply not be here.
   * Everything else - confidence, why we win, products, focus, resources -
   * lives on the project and is the team's. Those were all restricted until it was
   * pointed out that the value is the only part anyone needs to protect, and hiding
   * the rest merely stopped people discussing their own projects.
   *
   * A refused reader gets a line saying the value is restricted rather than a gap.
   * That is not a leak: it reveals that projects have values, which they plainly do.
   * It is better than a missing row nobody can account for.
   */
  const commercial = '<section class="panel"><div class="pan-h"><h2>Commercial</h2>' +
    '<span class="sub">Only the annual value is restricted</span></div>' +
    row('Annual value', canSeeCommercial
      ? '<input class="fld pnum" type="number" step="1000" value="' +
        esc(details && details.estValue != null ? details.estValue : '') +
        '" data-edit="pdValue" data-id="' + esc(p.id) + '" aria-label="Annual value"' +
        dis(env) + '><span class="why">Dollars per year</span>'
      : '<span class="why">Not shown — project value is kept to the people who ' +
        'have access to it.</span>') +
    row('Win confidence',
      '<input class="fld pnum" type="number" min="0" max="100" value="' +
      esc(p.winPct == null ? '' : p.winPct) +
      '" data-edit="pdWin" data-id="' + esc(p.id) + '" aria-label="Win confidence percent"' +
      dis(env) + '><span class="why">Per cent</span>') +
    (points.length >= 2
      ? row('Confidence over time',
          spark(points, {
            min: 0, max: 100, grid: [0, 50, 100],
            label: 'Win confidence across ' + points.length + ' meetings, now ' +
              points[points.length - 1].v + ' per cent'
          }) +
          '<span class="why">' + points[0].v + '% when it was first judged, ' +
          points[points.length - 1].v + '% now.</span>')
      : '') +
    row('Why we win',
      '<textarea class="fld" rows="2" data-edit="pdReason" data-id="' + esc(p.id) +
      '" placeholder="What makes this ours to lose."' + dis(env) + '>' +
      esc(p.winReason || '') + '</textarea>') +
    picker(snap, env, p, 'products', 'Product selection', 'product') +
    picker(snap, env, p, 'focus', 'Focus', 'focus area') +
    picker(snap, env, p, 'resources', 'Resources', 'resource') +
    '</section>';

  /* ----------------------------------------------------------------- actions */

  const closed = acts.filter(function (a) { return !isOpen(a); });

  const actionsPanel = '<section class="panel"><div class="pan-h"><h2>Actions</h2>' +
    '<span class="sub">' + open.length + ' open' +
    (closed.length ? ', ' + closed.length + ' closed' : '') + '</span>' +
    '<div class="r"><button class="btn ghost sm" type="button" data-act="showProjActions" ' +
    'data-id="' + esc(p.id) + '">Open in register</button></div></div>' +
    (open.length
      ? actionRows(open, today, env)
      : '<p class="none">Nothing open on this project.</p>') +
    (closed.length
      ? '<details class="dtl"' +
        (ui.openDetails && ui.openDetails['closed-' + p.id] ? ' open' : '') +
        ' data-details="closed-' + esc(p.id) + '">' +
        '<summary class="lbl">' + closed.length + ' closed</summary>' +
        actionRows(closed, today, env) + '</details>'
      : '') +
    '</section>';

  return head + identity + numbers + statusPanel + mission + commercial +
    actionsPanel + renderNotes(snap, ui, env, p);
}

/** The curated list for one settings key, however empty. */
function itemsOf(snap, key) {
  return (snap.settings[key] && snap.settings[key].items) || [];
}

/**
 * Suggestions for a free-text field: the curated list plus what is already in use.
 *
 * @param {string} id
 * @param {{label: string}[]} values
 */
function datalist(id, values) {
  if (!values.length) return '';
  return '<datalist id="' + id + '">' + values.map(function (v) {
    return '<option value="' + esc(v.label) + '"></option>';
  }).join('') + '</datalist>';
}

/** One labelled row. Exactly two children, because `.rp` is a two-column grid. */
function row(label, body) {
  return '<div class="rp"><div class="rp-h"><b>' + label + '</b></div>' +
    '<div class="rp-b">' + body + '</div></div>';
}

/** One of the project's multi-value fields, framed as a labelled row. */
function picker(snap, env, p, field, label, noun) {
  return row(label, pickerControl(snap, env, p, field, noun));
}

/**
 * Action rows. Exactly four children each, because `.arow` is a four-column grid.
 *
 * `dueClass` already returns 'done' for a closed action, and `.arow.done .atext` is
 * what strikes the text through - there is no separate class to add.
 */
function actionRows(list, today, env) {
  return '<ul class="alist">' + list.map(function (a) {
    return '<li class="arow ' + dueClass(a, today) + '" id="row-' + esc(a.id) + '">' +
      '<label class="ax"><input type="checkbox" data-edit="actionDone" data-id="' +
      esc(a.id) + '"' + (isOpen(a) ? '' : ' checked') + dis(env) +
      '><span class="aid">' + actionLabel(a) + '</span></label>' +
      '<span class="atext">' + esc(a.text) + '</span>' +
      '<span class="own">' + esc(a.owner || 'No owner') + '</span>' +
      '<span class="adue ' + dueClass(a, today) + '">' + dueLabel(a, today) + '</span>' +
      '</li>';
  }).join('') + '</ul>';
}

/**
 * The notes panel: the project's running commentary.
 *
 * Locked once the project is done or cancelled - the notes stay as the record of how
 * it went, but nothing more can be added or changed. Edit and remove are offered only
 * to a note's author, which stops people rewriting each other's words; it is a
 * courtesy rather than a control, for the reason set out in src/domain/notes.js.
 */
function renderNotes(snap, ui, env, p) {
  const me = (env.identity && env.identity.personId) || null;
  const live = notesOpen(p);
  const notes = notesFor(snap, p.id);

  let addForm;
  if (!live) {
    addForm = '<p class="why">This project is ' +
      (STATUS_LABELS[p.status] || p.status).toLowerCase() +
      '. Its notes are kept as the record of how it went and can no longer be changed.</p>';
  } else if (env.areaReadonly) {
    addForm = '';
  } else {
    addForm = '<form class="add pnote-add" data-form="note" data-id="' + esc(p.id) + '">' +
      '<textarea class="fld" name="text" rows="2" required ' +
      'placeholder="What happened, what changed, what you heard."></textarea>' +
      '<div class="acts-r"><button class="btn sm" type="submit">Add note</button></div></form>';
  }

  const list = notes.length
    ? '<ul class="notes">' + notes.map(function (n) {
        return ui.open === 'note:' + n.id
          ? noteEditor(n)
          : noteRow(snap, n, canEditNote(n, me, p));
      }).join('') + '</ul>'
    : '<p class="none">No notes yet.</p>';

  return '<section class="panel"><div class="pan-h"><h2>Notes</h2>' +
    '<span class="sub">' +
    (notes.length ? notes.length + ' so far' : 'kept for the life of the project') +
    '</span></div>' + addForm + list + '</section>';
}

function noteRow(snap, n, mine) {
  return '<li class="note">' +
    '<div class="note-h">' +
    '<b>' + esc(personName(snap, n.authorId) || 'Someone') + '</b>' +
    '<span class="note-t" title="' + esc(n.created || '') + '">' + fmtWhen(n.created) +
    (n.edited ? ' · edited' : '') + '</span>' +
    (mine
      ? '<span class="note-tools">' +
        '<button class="linkbtn" type="button" data-act="editNote" data-id="' +
        esc(n.id) + '">Edit</button>' +
        '<button class="linkbtn" type="button" data-act="delNote" data-id="' +
        esc(n.id) + '">Remove</button></span>'
      : '') +
    '</div><p class="note-b">' + esc(n.text) + '</p></li>';
}

function noteEditor(n) {
  return '<li class="note editing"><form data-form="noteEdit" data-id="' + esc(n.id) + '">' +
    '<textarea class="fld" name="text" rows="3" required>' + esc(n.text) + '</textarea>' +
    '<div class="note-tools">' +
    '<button class="btn sm" type="submit">Save</button>' +
    '<button class="btn ghost sm" type="button" data-act="closeForm">Cancel</button>' +
    '</div></form></li>';
}
