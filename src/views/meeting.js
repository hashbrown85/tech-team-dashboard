// @ts-check
/**
 * The meeting view: the agenda stepper, the current segment, and the side rail.
 *
 * This is the screen the app exists for — the one that's on a shared display while
 * the meeting runs. Everything about it is built for reading aloud in a room: one
 * segment at a time, the coaching rule for that segment always visible, and a clock
 * that says whether you're on pace.
 *
 * The step numbers in the timer are advisory. The clock never moves the agenda on for
 * you and never writes anything — being told you're over is useful, being dragged to
 * the next topic mid-sentence is not.
 *
 * From board.html:766-1043.
 */

import { esc, clock, minutes } from '../lib/dom.js';
import { fmt, fmtDay, fmtLong, rel, nextOn, addDays } from '../lib/dates.js';
import { byId } from '../lib/seq.js';
import { pickerControl } from './pickers.js';
import { spark } from './spark.js';
import {
  issueItems, actionedItems, actsOf, projVisible, openActsFor,
  personName, person, attendeeIds, isOpen, pickList
} from '../domain/queries.js';
import { byPriority, confidencePoints } from '../domain/projects.js';
import { dueClass, dueLabel, isOverdue } from '../domain/dueness.js';
import {
  MEETING_KINDS, WEEKDAYS, SEVERITY_LABELS, SEVERITIES, STATUS_LABELS, STATUSES,
  ACTIVE_STATUSES, segmentsFor, TECHDIR_TAB_ID
} from '../domain/constants.js';
import {
  meetingDate, nextMeetingAfter, ratingInfo, getMeeting, trendPoints, meetingSummary
} from '../domain/meetings.js';
import { actionLabel } from '../domain/actions.js';
import { stepOf } from '../ui.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

/** Disabled attribute when the current area is read-only. */
function dis(env) {
  return env.areaReadonly ? ' disabled' : '';
}

/**
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 * @param {any} tab
 */
export function renderMeeting(snap, ui, env, tab) {
  const today = env.today;
  const d = meetingDate(tab, today, ui.dates[tab.id]);
  const upcoming = nextOn(today, Number(tab.weekday));
  const length = Number(tab.lengthMin) || 30;
  const step = stepOf(ui, tab.id);
  const segs = segmentsFor(tab);
  // Off unless a meeting deliberately turns it on. A clock is a commitment to
  // pace, and that is a decision for the group rather than a default.
  const showTimer = !!tab.showTimer;

  /* --- who's here --- */

  const reporting = (tab.members || []).filter(function (id) { return person(snap, id); });
  const supporting = (tab.support || []).filter(function (id) { return person(snap, id); });
  const optional = (tab.optional || []).filter(function (id) { return person(snap, id); });

  const chips = reporting.map(function (id) {
    const p = person(snap, id);
    return '<span class="pchip m" title="' + esc(p.title || '') + '">' + esc(p.name) + '</span>';
  }).join('') || '<span class="muted sm">No one reporting yet</span>';

  const extras = (supporting.length || optional.length)
    ? '<details><summary>+ ' + supporting.length + ' supporting' +
      (optional.length ? ', ' + optional.length + ' optional' : '') + '</summary><div class="names">' +
      supporting.map(function (id) { return '<span class="pchip">' + esc(personName(snap, id)) + '</span>'; }).join('') +
      optional.map(function (id) { return '<span class="pchip o">' + esc(personName(snap, id)) + '</span>'; }).join('') +
      '</div></details>'
    : '';

  const att = '<div class="att">' + chips + extras + '</div>';

  /* --- header --- */

  const right = '<div class="datenav">' +
    '<button class="icon" type="button" data-act="prevMeeting" aria-label="Previous meeting">‹</button>' +
    '<div class="d"><b>' + fmtLong(d) + '</b><span>' + rel(d, today) + '</span></div>' +
    '<button class="icon" type="button" data-act="nextMeeting" aria-label="Next meeting">›</button></div>' +
    (d !== upcoming ? '<button class="btn ghost sm" type="button" data-act="thisMeeting">Upcoming</button>' : '') +
    '<button class="btn ghost sm" type="button" data-act="openSettings">Settings</button>';

  const head = '<header class="ph"><div><div class="lbl">' +
    MEETING_KINDS[tab.kind] + ' · ' + WEEKDAYS[tab.weekday] + ' · ' + length + ' min</div>' +
    '<h1>' + esc(tab.name) + '</h1>' + att + '</div>' +
    '<div class="ph-r">' + right + '</div></header>';

  /* --- stepper --- */

  const ents = snap.entries.filter(function (e) { return e.tab === tab.id && e.meeting === d; });
  const counts = [
    ents.filter(function (e) { return e.kind === 'win' || e.kind === 'loss'; }).length,
    ents.filter(function (e) { return e.kind === 'opp'; }).length,
    snap.projects.filter(function (x) {
      return projVisible(x, tab.id, d) && ACTIVE_STATUSES.indexOf(x.status) >= 0;
    }).length,
    issueItems(snap, tab.id).length,
    ratingInfo(snap, tab.id, d).n
  ];

  const steps = segs.map(function (s, i) {
    return '<button type="button" class="st' + (i === step ? ' cur' : '') + (i === 3 ? ' main' : '') +
      '" id="st-' + i + '" data-act="step" data-v="' + i + '"' +
      (i === step ? ' aria-current="step"' : '') + '>' +
      '<span class="st-n">' + (i + 1) + '</span>' +
      '<span class="st-t">' + esc(s.short) + '</span>' +
      '<span class="st-y">' + esc(s.tiny) + '</span>' +
      (showTimer
        ? '<span class="st-b">' + minutes(length * s.f) +
          (counts[i] ? ' · <b>' + counts[i] + '</b>' : '') + '</span>' +
          '<i class="st-p" id="stp-' + i + '"></i>'
        : '') +
      '</button>';
  }).join('');

  const stepper = '<div class="stepper">' +
    '<div class="steps" role="tablist" aria-label="Meeting segments">' + steps + '</div>' +
    (showTimer
      ? '<div class="tmr" id="tmr"><span class="t-el" id="t-el">0:00</span>' +
        '<span class="t-of">/ ' + clock(length * 60) + '</span>' +
        '<button class="ib go" type="button" data-act="timerToggle" id="t-btn" aria-label="Start meeting clock">▶</button>' +
        '<button class="ib" type="button" data-act="timerReset" aria-label="Reset meeting clock">↺</button>' +
        '</div>'
      : '') +
    '</div>' + (showTimer ? '<div class="t-hint" id="t-hint"></div>' : '');

  return head + stepper + '<div class="mgrid">' +
    '<section class="panel stage" aria-live="polite">' +
    renderStage(snap, ui, env, tab, step, d, ents, segs) +
    '</section><aside class="rail">' + renderRail(snap, ui, env, tab, step, d) + '</aside></div>';
}

/* ---------- the stage frame ---------- */

function stageHead(segs, i, extra) {
  return '<div class="stg-h"><span class="segno">' + (i + 1) + '</span>' +
    '<div class="tt"><h2>' + esc(segs[i].name) + '</h2>' +
    '<p class="rule">' + segs[i].rule + '</p></div>' + (extra || '') + '</div>';
}

function stageFoot(i, last) {
  return '<div class="stg-f">' +
    (i > 0 ? '<button class="btn ghost" type="button" data-act="step" data-v="' + (i - 1) + '">‹ Back</button>' : '<span></span>') +
    (i < last ? '<button class="btn" type="button" data-act="step" data-v="' + (i + 1) + '">Next ›</button>' : '<span></span>') +
    '</div>';
}

/* ---------- the five stages ---------- */

function renderStage(snap, ui, env, tab, step, d, ents, segs) {
  const body = step === 0 ? stageWins(snap, ui, env, tab, d, ents)
    : step === 1 ? stageOpportunities(snap, ui, env, tab, d, ents)
    : step === 2 ? stageProjects(snap, ui, env, tab, d)
    : step === 3 ? stageIssues(snap, ui, env, tab, d)
    : stageRate(snap, ui, env, tab, d);

  return stageHead(segs, step) + '<div class="stg-body">' + body + '</div>' + stageFoot(step, segs.length - 1);
}

/**
 * One person's turn, as the agenda goes round the room.
 *
 * `.rp` is the stylesheet's record row: a fixed-width heading column and a content
 * column. `.rp-h` holds the name and their title, `.rp-b` everything they said.
 *
 * It previously used `.block`, which the stylesheet does not define at all, and
 * `.pname`, which is the clickable PROJECT name button — so neither did anything
 * like what was intended.
 */
/**
 * Who owns this, and who is helping.
 *
 * These three segments used to be grouped into a block per person, with the name as
 * a heading - so the owner was never written on the item itself. The blocks are gone
 * and the lists are flat, so every row carries its own name or there is no way to
 * tell whose it is.
 *
 * @param {Snapshot} snap
 * @param {any} record - an entry or a project
 * @returns {string} plain text, not markup
 */
function ownerLine(snap, record) {
  const owner = personName(snap, record && record.personId);
  const helper = record && record.support ? person(snap, record.support) : null;
  return helper ? owner + ' \u00b7 with ' + helper.name : owner;
}

/* --- 0: Wins & Losses --- */

function stageWins(snap, ui, env, tab, d, ents) {
  const mine = ents.filter(function (e) {
    return e.kind === 'win' || e.kind === 'loss';
  });

  const list = mine.length
      ? '<ul class="items">' + mine.map(function (e) {
          return '<li class="item ' + (e.kind === 'win' ? 'win' : 'loss') + '">' +
            '<span class="chip ' + (e.kind === 'win' ? 'good' : 'crit') + '">' +
            (e.kind === 'win' ? 'Win' : 'Loss') + '</span>' +
            '<span class="it-t">' + esc(e.text) + '</span>' +
            '<span class="it-s">' + esc(ownerLine(snap, e)) + '</span>' +
            (e.why ? '<span class="why">Why: ' + esc(e.why) + '</span>' : '') +
            (e.change ? '<span class="it-c">' + (e.kind === 'loss' ? 'Doing differently: ' : 'Keep doing: ') + esc(e.change) + '</span>' : '') +
            '<button class="x edit-only" type="button" data-act="delEntry" data-id="' + esc(e.id) + '" aria-label="Remove"' + dis(env) + '>×</button>' +
            '</li>';
        }).join('') + '</ul>'
      : '<p class="none">Nothing recorded yet.</p>';

  // One form for the segment, at the bottom, the way Issues has always worked.
  const addForm = ui.open === 'wl'
    ? '<form class="add" data-form="wl">' +
      '<select class="fld" name="kind" data-edit="wlKind" aria-label="Win or loss">' +
      '<option value="win">Win</option><option value="loss">Loss</option></select>' +
      '<input class="fld" name="text" type="text" placeholder="What happened" required>' +
      '<input class="fld" name="why" type="text" placeholder="Why did it happen" required>' +
      '<input class="fld ifloss" name="change" type="text" placeholder="What we will do differently" hidden>' +
      whoFields(snap, tab, false) +
      '<button class="btn" type="submit">Add</button>' +
      '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
    : '<button class="btn ghost add-btn edit-only" type="button" data-act="openForm" data-v="wl"' +
      dis(env) + '>+ Win or loss</button>';

  return list + addForm;
}

/* --- 1: New Opportunities, or the Tech Directors business review --- */

function stageOpportunities(snap, ui, env, tab, d, ents) {
  if (tab.id === TECHDIR_TAB_ID) return businessReview(snap, tab);

  const mine = ents.filter(function (e) { return e.kind === 'opp'; });

  const list = mine.length
      ? '<ul class="items">' + mine.map(function (e) {
          const pj = e.projectId ? byId(snap.projects, e.projectId) : null;
          // The customer lives on the project the opportunity created, so a correction
          // made on the project page shows here too. Same "Customer - name" order as
          // a Current Projects tile; the name stays what was SAID, from the entry.
          const customer = pj ? String(pj.customer || '').trim() : '';
          return '<li class="item opp">' +
            '<span class="chip">Opportunity</span>' +
            '<span class="it-t">' + (customer ? esc(customer) + ' - ' : '') + esc(e.text) + '</span>' +
            '<span class="it-s">' + esc(ownerLine(snap, e)) + '</span>' +
            (e.why ? '<span class="why">Challenge: ' + esc(e.why) + '</span>' : '') +
            (pj && pj.start ? '<span class="it-c">Joins Current Projects ' + fmtDay(pj.start) + '</span>' : '') +
            '<button class="x edit-only" type="button" data-act="delEntry" data-id="' + esc(e.id) + '" aria-label="Remove"' + dis(env) + '>×</button>' +
            '</li>';
        }).join('') + '</ul>'
      : '<p class="none">Nothing raised yet.</p>';

  const addForm = ui.open === 'opp'
    ? opportunityForm(snap, env, tab)
    : '<button class="btn ghost add-btn edit-only" type="button" data-act="openForm" data-v="opp"' +
      dis(env) + '>+ Opportunity</button>';

  return list + addForm;
}

/** Every active project across every meeting — what the Tech Directors group reviews. */
function businessReview(snap, tab) {
  const groups = snap.tabs.filter(function (t) { return t.id !== tab.id; }).map(function (t) {
    const live = snap.projects.filter(function (p) {
      return p.tab === t.id && ACTIVE_STATUSES.indexOf(p.status) >= 0;
    });
    if (!live.length) return '';
    return '<div class="mgroup"><div class="lbl">' + esc(t.name) + '</div><ul class="items">' +
      live.map(function (p) {
        return '<li class="item"><span class="chip ps-' + esc(p.status) + '">' +
          STATUS_LABELS[p.status] + '</span>' +
          '<span class="it-t">' + esc(p.name) + '</span>' +
          '<span class="why">' + esc(personName(snap, p.personId)) + '</span></li>';
      }).join('') + '</ul></div>';
  }).join('');

  return groups || '<p class="none">No active projects in any other meeting yet.</p>';
}

/* --- 2: Current Projects, or Tech-Projects --- */

function stageProjects(snap, ui, env, tab, d) {
  /*
   * One list for the meeting, not one per person. Priority is therefore meeting-wide
   * too: the arrows move a project among ALL of them, where they used to move it
   * only within its owner's block. That follows from the list being flat - there is
   * no way to read a per-person order out of a single list - and it suits a segment
   * that is worked down from the top.
   */
  const mine = snap.projects
    .filter(function (p) { return projVisible(p, tab.id, d); })
    .sort(byPriority);

  const list = mine.length
      ? '<ul class="items">' + mine.map(function (p, i) {
          return projectRow(snap, ui, env, p, i, mine.length);
        }).join('') + '</ul>'
      : '<p class="none">No current projects.</p>';

  const addForm = ui.open === 'project'
    ? '<form class="add" data-form="project">' +
      // Customer first: the title reads "Customer - Project name". Optional, because
      // internal work has none.
      '<input class="fld" name="customer" type="text" placeholder="Customer (optional)">' +
      '<input class="fld" name="name" type="text" placeholder="Project name" required>' +
      '<input class="fld" name="due" type="date" aria-label="Due date">' +
      whoFields(snap, tab, true) +
      '<button class="btn" type="submit">Add</button>' +
      '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
    : '<button class="btn ghost add-btn edit-only" type="button" data-act="openForm" data-v="project"' +
      dis(env) + '>+ Project</button>';

  return list + addForm;
}

/**
 * One project in the Current Projects segment.
 *
 * The markup is dictated by the stylesheet, and getting it wrong is how the status
 * control ended up invisible:
 *
 *   - `.proj` is the grid. It also needs `ps-<status>` for the per-status treatment
 *     (a gold outline while new, struck through when cancelled) and `sel` — not
 *     `sel` — when this project's actions are being shown in the rail.
 *   - `.pname` is the clickable name button, holding `.it-t` and `.meta`.
 *   - `.stat` is the status control: plain buttons, each carrying `data-v` and
 *     `aria-pressed`. The colour of the selected status comes from a CSS rule that
 *     matches on BOTH of those attributes, so a button that omits either simply
 *     never looks selected.
 *
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 * @param {any} p
 * @param {number} idx - where it sits in its owner's list, for the move arrows
 * @param {number} count - how many that owner has on screen
 */
function projectRow(snap, ui, env, p, idx, count) {
  const open = openActsFor(snap, p.id);
  const selected = ui.railProj === p.id;

  // Focus reads on the collapsed row rather than only under the caret: the point of
  // it is to see at a glance whether we are pointed at what the customer actually
  // cares about. `.pchip` is inline, so these flow in the meta line as they are.
  const focus = (p.focus || []).length
    ? (p.focus || []).map(function (v) {
        return '<span class="pchip">' + esc(v) + '</span>';
      }).join(' ') + ' \u00b7 '
    : '';

  /*
   * The owner leads and is the bold thing on the row. The block heading that used to
   * carry the name is gone, so this is the only place it appears - and it is what
   * you scan for. Folded into the meta line rather than added as another child:
   * `.proj` is a two-column grid whose child count the checker asserts.
   */
  const meta =
    '<b>' + esc(ownerLine(snap, p)) + '</b> \u00b7 ' +
    (p.customer ? esc(p.customer) + ' \u00b7 ' : '') + focus +
    (p.status === 'new'
      ? '<span class="chip new">New</span> ' +
        (p.fromOpp
          ? 'From ' + (p.start ? fmt(addDays(p.start, -7)) : 'last week') +
            '’s opportunities · set a status'
          : 'Set a status') + ' · '
      : '') +
    (p.due ? 'Due <span class="mono">' + fmt(p.due) + '</span>' : 'No due date') +
    ' · ' + (open ? open + ' open action' + (open > 1 ? 's' : '') : 'no open actions') +
    (p.status === 'off'
      ? (open ? ' · recovery underway' : ' · <b class="warnt">no path yet, in Issues</b>')
      : '') +
    (p.note ? '<br>Challenge: ' + esc(p.note) : '');

  const status = STATUSES.map(function (v) {
    return '<button type="button" data-act="projStatus" data-id="' + esc(p.id) +
      '" data-v="' + v + '" aria-pressed="' + (p.status === v) + '"' + dis(env) + '>' +
      STATUS_LABELS[v] + '</button>';
  }).join('');

  return '<li class="proj ps-' + esc(p.status) + (selected ? ' sel' : '') +
    '" id="proj-' + esc(p.id) + '">' +
    '<div class="pname">' +
    '<button type="button" class="it-t pname-open" data-act="openProject" data-id="' +
    esc(p.id) + '" title="Open this project">' + esc(p.name) + '</button>' +
    '<span class="meta">' + meta + ' · ' +
    '<button type="button" class="linkbtn pfilter" data-act="selectProject" data-id="' +
    esc(p.id) + '" aria-pressed="' + selected + '">' +
    (selected ? 'Show all actions' : 'Filter actions') + '</button>' +
    '</span></div>' +
    // `.proj` is a TWO-column grid, and `.stat` spans both onto its own row - so a
    // row has exactly three children. The arrows share the tools cell with the
    // delete button rather than becoming a fourth, which would not error and would
    // not look wrong in the markup: it would silently wrap onto its own line and
    // push the status control out of alignment. tools/layout-check.mjs counts them.
    '<div class="ptools edit-only">' +
    '<button class="mv" type="button" data-act="movePriority" data-id="' + esc(p.id) +
    '" data-v="-1" aria-label="Raise priority of ' + esc(p.name) + '"' +
    (idx === 0 ? ' disabled' : dis(env)) + '>▲</button>' +
    '<button class="mv" type="button" data-act="movePriority" data-id="' + esc(p.id) +
    '" data-v="1" aria-label="Lower priority of ' + esc(p.name) + '"' +
    (idx === count - 1 ? ' disabled' : dis(env)) + '>▼</button>' +
    '<button class="x" type="button" data-act="delProject" data-id="' + esc(p.id) +
    '" aria-label="Remove project"' + dis(env) + '>×</button>' +
    '</div>' +
    '<div class="stat" role="group" aria-label="Status of ' + esc(p.name) + '">' + status + '</div>' +
    projectDetailsPanel(snap, ui, env, p) +
    '</li>';
}

/**
 * What sits under the caret on a project's row in a meeting.
 *
 * **Nothing here is restricted, so there is no permission check.** The annual value
 * used to live here and was the only reason this panel had a gate at all; it now
 * appears on the project's own page and nowhere else. Confidence, why-we-win and
 * focus belong to the team, so the caret and everything under it works for anyone
 * who can see the project.
 *
 * Focus is editable here as well as readable on the collapsed row above, because
 * "actually, they care more about scale than corrosion" is a thing said during the
 * meeting, and walking to the project page to record it loses the moment.
 */
function projectDetailsPanel(snap, ui, env, p) {
  // Whether this was open is remembered, because a render can happen at any moment -
  // the background poll alone would otherwise shut the panel every minute while
  // somebody was still typing in it.
  const isOpen = !!(ui.openDetails && ui.openDetails[p.id]);
  return '<details class="dtl" data-details="' + esc(p.id) + '"' + (isOpen ? ' open' : '') +
    '><summary class="lbl">Project details</summary>' +
    '<div class="sgrid">' +
    '<label class="lbl">Win confidence %' +
    '<input class="fld n" type="number" min="0" max="100" data-edit="pdWin" data-id="' +
    esc(p.id) + '" value="' + esc(p.winPct == null ? '' : p.winPct) + '"' + dis(env) +
    '></label>' +
    '</div>' +
    '<label class="lbl">Why we win' +
    '<textarea class="fld" rows="2" data-edit="pdReason" data-id="' + esc(p.id) + '"' + dis(env) + '>' +
    esc(p.winReason || '') + '</textarea></label>' +
    confidenceTrend(p, true) +
    '<div class="lbl pfoc">Focus</div>' +
    pickerControl(snap, env, p, 'focus', 'focus area') +
    '</details>';
}

/* --- 3: Issues --- */

/**
 * Outstanding commitments, shown at the top of the Issues segment.
 *
 * It sits here rather than at the start of the meeting on purpose: this is the
 * moment the group is about to agree NEW actions, so it is the moment to see what
 * is already owed.
 *
 * ## What "already owed" measures against
 *
 * Today, not the meeting date — with one exception. The meeting date is usually in
 * the FUTURE (the next occurrence of that weekday), so measuring against it would
 * sweep in work that is not due yet: on a Tuesday, with the meeting on Monday, an
 * action due Friday is three days away and nobody owes it yet. That was a real bug.
 *
 * The exception is looking back at a PAST meeting, where "already owed" should mean
 * what was owed at the time, not what is owed now. So the cut-off is whichever of
 * the two is earlier.
 *
 * Deliberately quiet — it is context for the conversation that follows, not another
 * list to work through. It renders nothing at all when there is nothing outstanding.
 */

/**
 * The two answers to "this is overdue": push it, or give it a real date.
 *
 * Restored from board.html:870, which had exactly this inside the ancestor of
 * Already Owed. The port kept the block, dropped the control, and rewrote the tip
 * to mention only ticking things off - so the block has been asking a question it
 * could accept half the answers to.
 *
 * One emitter for both lists (Already Owed and the rail) so they cannot drift.
 *
 * `.afix` is placed in column 2 by the stylesheet rather than auto-placed. The rail
 * is a fixed 340px track and cannot hold another column of controls; on its own row
 * under the text, both fit at any width.
 *
 * The date box carries `id="due-<actionId>"`. That is what lets `edits.actionDue`
 * redraw instead of writing silently: renderPreservingForms re-finds a focused
 * element by id, so the caret survives and the dueness label keeps up.
 *
 * @param {any} a - the action
 * @param {any} tab
 * @param {string} d - the meeting being viewed
 * @param {object} env
 */
function dueControls(a, tab, d, env) {
  if (env.areaReadonly) return '';
  const next = nextMeetingAfter(tab, d);
  return '<span class="afix">' +
    '<button type="button" class="btn ghost sm" data-act="pushDue" data-id="' + esc(a.id) +
    '" data-v="' + esc(next) + '" title="Move it to ' + esc(fmtDay(next)) + '">' +
    '\u2192 next meeting</button>' +
    '<input class="fld dfix" type="date" id="due-' + esc(a.id) + '" value="' + esc(a.due || '') +
    '" data-edit="actionDue" data-id="' + esc(a.id) +
    '" aria-label="Move the due date for ' + actionLabel(a) + '"' + dis(env) + '>' +
    '</span>';
}

function dueSinceLastMeeting(snap, env, tab, d) {
  // Date strings are YYYY-MM-DD, so comparing them as text gives the earlier one.
  const asOf = d < env.today ? d : env.today;

  const due = snap.actions.filter(function (a) {
    return a.tab === tab.id && isOpen(a) && a.due && a.due <= asOf;
  }).sort(function (a, b) { return (a.due || '') < (b.due || '') ? -1 : 1; });

  if (!due.length) return '';

  return '<div class="duechk"><div class="dc-h">Already owed</div>' +
    '<ul class="alist">' + due.map(function (a) {
      return '<li class="arow"><span class="aid">' + actionLabel(a) + '</span>' +
        '<span class="atext">' + esc(a.text) + '</span>' +
        '<span class="adue ' + dueClass(a, env.today) + '">' + dueLabel(a, env.today) + '</span>' +
        '<span class="own">' + esc(a.owner || 'No owner') + '</span>' +
        dueControls(a, tab, d, env) + '</li>';
    }).join('') + '</ul>' +
    // board.html:872 said both halves of this. The port dropped the re-dating half
    // along with the control; it is back, so the sentence is again true.
    '<p class="dc-tip">Tick off what is done. Anything slipping gets a new date, and ' +
    'the owner says why in the round.</p></div>';
}


function stageIssues(snap, ui, env, tab, d) {
  const queue = issueItems(snap, tab.id);
  const moved = actionedItems(snap, tab.id);

  const resolvedHere = snap.issues.filter(function (i) {
    return i.tab === tab.id && i.status === 'resolved' && i.resolvedMeeting === d;
  });

  const cards = queue.map(function (it, idx) {
    const o = it.o;
    const isProject = it.type === 'p';
    const key = it.type + ':' + o.id;
    const formKey = 'act:' + o.id;

    const form = ui.open === formKey
      ? actionForm(snap, ui, env, tab, { relKey: (isProject ? 'p:' : 'i:') + o.id, d: d })
      : '<button class="btn sm edit-only" type="button" data-act="openForm" data-v="' + esc(formKey) + '"' + dis(env) + '>Give it an owner</button>';

    return '<article class="issue ' + esc(it.sev) + '" id="iss-' + esc(o.id) + '">' +
      '<div class="is-h">' +
      '<span class="rank">' + (idx + 1) + '</span>' +
      '<span class="chip ' + esc(it.sev) + '">' +
      SEVERITY_LABELS[isProject ? 'offtrack' : it.sev] + '</span>' +
      // `edit-only` hides the whole toolbar when the board is read-only, so these
      // do not each need disabling. The move buttons ARE disabled at the ends of
      // the list, which is clearer than a button that silently does nothing.
      '<div class="is-tools edit-only">' +
      '<button class="mv" type="button" data-act="moveIssue" data-id="' + esc(key) +
      '" data-v="-1" aria-label="Move up"' + (idx === 0 ? ' disabled' : '') + '>▲</button>' +
      '<button class="mv" type="button" data-act="moveIssue" data-id="' + esc(key) +
      '" data-v="1" aria-label="Move down"' + (idx === queue.length - 1 ? ' disabled' : '') + '>▼</button>' +
      (isProject
        ? ''
        : '<button class="btn ghost sm" type="button" data-act="resolveIssue" data-id="' +
          esc(o.id) + '">Resolved</button>' +
          '<button class="x" type="button" data-act="delIssue" data-id="' + esc(o.id) +
          '" aria-label="Remove issue">×</button>') +
      '</div></div>' +
      '<div class="is-body"><p class="is-sub">' + esc(o.text || o.name) + '</p>' +
      '<p class="meta">' + esc(personName(snap, o.personId)) +
      (o.meeting ? ' · raised ' + fmt(o.meeting) : '') + '</p>' + form + '</div></article>';
  }).join('');

  // The markup here is dictated by the stylesheet: `.moved li` is a two-column
  // grid whose first column is the severity chip and whose second holds the text
  // and the action lines. Do not add `.item` (a competing three-column grid) or
  // `.mv` (the 26px move button) — either one collapses the row.
  const movedBlock = moved.length
    ? '<div class="moved"><div class="lbl">Has a path and owner · now tracked as actions (' +
      moved.length + ')</div><ul>' +
      moved.map(function (it) {
        const acts = actsOf(snap, it.o.id).filter(isOpen);
        return '<li id="iss-' + esc(it.o.id) + '">' +
          '<span class="chip ' + esc(it.sev) + '">' +
          SEVERITY_LABELS[it.type === 'p' ? 'offtrack' : it.sev] + '</span>' +
          '<span class="mv-t">' + esc(it.o.text || it.o.name) + '</span>' +
          '<span class="mv-a">' + acts.map(function (a) {
            return '→ ' + actionLabel(a) + ' ' + esc(a.owner || 'No owner') +
              ' · ' + dueLabel(a, env.today);
          }).join('<br>') + '</span></li>';
      }).join('') + '</ul></div>'
    : '';

  const resolvedBlock = resolvedHere.length
    ? '<div class="resolved"><div class="lbl">Resolved in this meeting</div><ul class="items">' +
      resolvedHere.map(function (i) {
        return '<li class="item"><span class="it-t">' + esc(i.text) + '</span>' +
          (i.autoResolved ? '<span class="chip good">auto</span>' : '') +
          '<button class="btn ghost sm edit-only" type="button" data-act="reopenIssue" data-id="' + esc(i.id) + '"' + dis(env) + '>Reopen</button></li>';
      }).join('') + '</ul></div>'
    : '';

  const addForm = ui.open === 'issue'
    ? '<form class="add" data-form="issue">' +
      '<input class="fld" name="text" type="text" placeholder="What has no path yet" required>' +
      '<select class="fld" name="sev" aria-label="How urgent">' +
      severityOptions() + '</select>' +
      '<select class="fld" name="who" aria-label="Raised by">' + peopleOptions(snap, tab) + '</select>' +
      '<button class="btn" type="submit">Add</button>' +
      '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
    : '<button class="btn ghost add-btn edit-only" type="button" data-act="openForm" data-v="issue"' + dis(env) + '>+ Raise an issue</button>';

  return dueSinceLastMeeting(snap, env, tab, d) +
    (cards || '<p class="none">Nothing without a path. That is the goal.</p>') +
    movedBlock + resolvedBlock + addForm;
}

/* --- 4: Rate the Meeting --- */

function stageRate(snap, ui, env, tab, d) {
  const m = getMeeting(snap, tab.id, d);
  const info = ratingInfo(snap, tab.id, d);

  function groupRows(ids, label) {
    if (!ids.length) return '';
    return '<div class="rates"><div class="lbl">' + label + '</div>' +
      ids.map(function (id) {
        const mine = m.ratings[id];
        const scale = [1, 2, 3, 4, 5].map(function (v) {
          return '<button type="button" class="rb' + (Number(mine) === v ? ' sel' : '') +
            '" data-act="setRating" data-id="' + esc(id) + '" data-v="' + v + '"' +
            (Number(mine) === v ? ' aria-pressed="true"' : '') + dis(env) + '>' + v + '</button>';
        }).join('');
        return '<div class="ri"><span class="nm">' + esc(personName(snap, id)) + '</span>' +
          '<span class="scale" role="group" aria-label="Score for ' + esc(personName(snap, id)) + '">' +
          scale + '</span></div>';
      }).join('') + '</div>';
  }

  const reporting = (tab.members || []).filter(function (id) { return person(snap, id); });
  const supporting = (tab.support || []).filter(function (id) { return person(snap, id); });
  const optional = (tab.optional || []).filter(function (id) { return person(snap, id); });

  const score = '<div class="score"><span class="big">' +
    (info.n ? info.avg.toFixed(1) : '—') + '</span><span class="sub">' +
    (info.n ? 'average of ' + info.n : 'not rated yet') + '</span></div>';

  const points = trendPoints(snap, tab.id);
  const trend = points.length < 2
    ? '<p class="muted sm">A trend line appears after two rated meetings.</p>'
    : sparkline(points);

  const note = '<label class="lbl" for="f-note">One change for next time' +
    '<textarea class="fld" id="f-note" rows="2" data-edit="meetingNote"' + dis(env) + '>' +
    esc(m.note || '') + '</textarea></label>';

  const summary = '<div class="sumbox">' +
    '<button class="btn ghost sm" type="button" data-act="toggleSummary">' +
    (ui.sumShow ? 'Hide' : 'Preview') + ' summary</button>' +
    '<button class="btn sm" type="button" data-act="copySummary">Copy meeting summary</button>' +
    (ui.sumShow ? '<textarea class="fld mono" id="f-summary" rows="14" readonly>' +
      esc(meetingSummary(snap, tab, d)) + '</textarea>' : '') + '</div>';

  return score + trend +
    groupRows(reporting, 'Reporting') +
    groupRows(supporting, 'Supporting') +
    groupRows(optional, 'Optional') +
    note + summary;
}

/**
 * The rating trend, drawn inline. Data comes from the domain; only the shape is here.
 *
 * Ratings run 1-5 where confidence runs 0-100, which is the whole reason spark()
 * takes a scale rather than assuming one.
 */
function sparkline(points) {
  return spark(points.map(function (p) { return { d: p.d, v: p.avg }; }), {
    min: 1,
    max: 5,
    grid: [1, 3, 5],
    label: 'Meeting score trend over the last ' + points.length + ' meetings'
  });
}

/* ---------- the rail ---------- */

function renderRail(snap, ui, env, tab, step, d) {
  const selected = ui.railProj ? byId(snap.projects, ui.railProj) : null;

  const quick = ui.open === 'rail'
    ? actionForm(snap, ui, env, tab, { d: d })
    : '<button class="btn sm edit-only" type="button" data-act="openForm" data-v="rail"' + dis(env) + '>+ Action</button>';

  const list = selected
    ? actsOf(snap, selected.id)
    : snap.actions.filter(function (a) { return a.tab === tab.id && isOpen(a); })
        .sort(function (a, b) { return (a.due || '9') < (b.due || '9') ? -1 : 1; });

  const rows = list.length
    ? '<ul class="alist">' + list.map(function (a) {
        return '<li class="arow ' + dueClass(a, env.today) + '" id="row-' + esc(a.id) + '">' +
          '<label class="ax"><input type="checkbox" data-edit="actionDone" data-id="' + esc(a.id) + '"' +
          (isOpen(a) ? '' : ' checked') + dis(env) + '><span class="aid">' + actionLabel(a) + '</span></label>' +
          '<span class="atext">' + esc(a.text) + '</span>' +
          '<span class="ameta">' + esc(a.owner || 'No owner') + ' · ' + dueLabel(a, env.today) + '</span>' +
          dueControls(a, tab, d, env) + '</li>';
      }).join('') + '</ul>'
    : '<p class="none">' + (selected ? 'No actions on this project yet.' : 'No open actions in this meeting.') + '</p>';

  const railHead = '<div class="pan-h"><h2>' +
    (selected ? esc(selected.name) : 'Open actions') + '</h2>' +
    (selected ? '<button class="btn ghost sm" type="button" data-act="clearProject">Show all</button>' : '') +
    '</div>';

  const issueShortlist = step !== 3
    ? (function () {
        const q = issueItems(snap, tab.id).slice(0, 4);
        if (!q.length) return '';
        return '<div class="rlist"><div class="lbl">Issues without a path</div><ul class="items">' +
          q.map(function (it) {
            return '<li class="item"><span class="chip ' + esc(it.sev) + '">' +
              (it.type === 'p' ? 'Off-track' : SEVERITY_LABELS[it.sev]) + '</span>' +
              '<span class="it-t">' + esc(it.o.text || it.o.name) + '</span></li>';
          }).join('') + '</ul>' +
          '<button class="btn ghost sm" type="button" data-act="step" data-v="3">Work through them</button></div>';
      })()
    : '';

  return railHead + quick + rows + issueShortlist;
}

/* ---------- shared bits ---------- */

/**
 * The severity choices, built from SEVERITIES so the list and the labels cannot
 * drift apart.
 *
 * @param {string} [selected]
 */
function severityOptions(selected) {
  return SEVERITIES.map(function (key) {
    return '<option value="' + key + '"' +
      (selected === key ? ' selected' : '') + '>' + SEVERITY_LABELS[key] + '</option>';
  }).join('');
}

/** Options of people, those in this meeting first. */
function peopleOptions(snap, tab, selectedName, blankLabel) {
  const ids = attendeeIds(tab).filter(function (id) { return person(snap, id); });
  const inMeeting = ids.map(function (id) { return person(snap, id); });
  const rest = snap.people.filter(function (p) { return ids.indexOf(p.id) < 0; });

  function opt(p, byName) {
    const value = byName ? p.name : p.id;
    return '<option value="' + esc(value) + '"' +
      (selectedName && p.name === selectedName ? ' selected' : '') + '>' + esc(p.name) + '</option>';
  }

  return (blankLabel ? '<option value="">' + blankLabel + '</option>' : '') +
    (inMeeting.length ? '<optgroup label="In this meeting">' +
      inMeeting.map(function (p) { return opt(p, false); }).join('') + '</optgroup>' : '') +
    (rest.length ? '<optgroup label="Everyone else">' +
      rest.map(function (p) { return opt(p, false); }).join('') + '</optgroup>' : '');
}

/**
 * Who it belongs to, and optionally who is helping.
 *
 * The three reporting segments used to have no owner control at all: each person's
 * block carried its own "+" button and the owner was whoever's block you clicked in.
 * That reads well going round the room and badly everywhere else - you cannot enter
 * somebody else's item, and it is the only place in the app where an owner is
 * implied by position rather than chosen. The Issues segment always asked; these
 * now do too.
 *
 * Both are person IDS. Actions store an owner by name and that is the wart the
 * owner-id migration exists to remove, so nothing new should copy it.
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @param {boolean} withSupport - opportunities and projects have one; wins do not
 */
function whoFields(snap, tab, withSupport) {
  return '<select class="fld" name="who" aria-label="Whose is this" required>' +
    peopleOptions(snap, tab) + '</select>' +
    (withSupport
      ? '<select class="fld" name="support" aria-label="Supporting (optional)">' +
        peopleOptions(snap, tab, '', 'Supporting\u2026 (optional)') + '</select>'
      : '');
}

/** Owner options, by NAME, because that is what an action stores. */
function ownerOptions(snap, tab, selected, blankLabel) {
  const ids = attendeeIds(tab).filter(function (id) { return person(snap, id); });
  const inMeeting = ids.map(function (id) { return person(snap, id); });
  const rest = snap.people.filter(function (p) { return ids.indexOf(p.id) < 0; });
  function opt(p) {
    return '<option value="' + esc(p.name) + '"' +
      (p.name === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>';
  }
  return (blankLabel ? '<option value="">' + blankLabel + '</option>' : '') +
    (inMeeting.length ? '<optgroup label="In this meeting">' + inMeeting.map(opt).join('') + '</optgroup>' : '') +
    (rest.length ? '<optgroup label="Everyone else">' + rest.map(opt).join('') + '</optgroup>' : '');
}

/** What an action can be attached to. */
function relatedOptions(snap, tab, selected) {
  const projects = snap.projects.filter(function (p) {
    return p.tab === tab.id && ACTIVE_STATUSES.indexOf(p.status) >= 0;
  });
  const open = snap.issues.filter(function (i) { return i.tab === tab.id && i.status === 'open'; });

  function opt(v, label) {
    return '<option value="' + esc(v) + '"' + (selected === v ? ' selected' : '') + '>' + label + '</option>';
  }

  return opt('', 'Related to: nothing specific') +
    (projects.length ? '<optgroup label="Projects">' + projects.map(function (p) {
      return opt('p:' + p.id, 'Project · ' + esc(p.name) +
        (p.status !== 'on' ? ' (' + STATUS_LABELS[p.status].toLowerCase() + ')' : ''));
    }).join('') + '</optgroup>' : '') +
    (open.length ? '<optgroup label="Open issues">' + open.map(function (i) {
      return opt('i:' + i.id, 'Issue · ' + esc(i.text));
    }).join('') + '</optgroup>' : '');
}

/**
 * The action form. One owner, optional support, a date, and what it relates to —
 * those four fields are the whole point of the Issues segment.
 */
function actionForm(snap, ui, env, tab, opts) {
  return '<form class="add acts-r" data-form="action" data-tab="' + esc(tab.id) + '">' +
    '<input class="fld" name="text" type="text" placeholder="What will be done" required>' +
    '<select class="fld" name="owner" aria-label="Owner" required>' +
    ownerOptions(snap, tab, '', 'Owner…') + '</select>' +
    '<select class="fld" name="support" aria-label="Support from">' +
    ownerOptions(snap, tab, '', 'Support from… (optional)') + '</select>' +
    '<input class="fld" name="due" type="date" required aria-label="Due date">' +
    '<select class="fld" name="rel" aria-label="Related to">' +
    relatedOptions(snap, tab, opts.relKey || '') + '</select>' +
    '<button class="btn" type="submit">Add action</button>' +
    '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>';
}

/**
 * How win confidence has moved, if it has moved at all.
 *
 * Nothing is drawn from a single reading - one point is a number, not a trend, and
 * the line only starts saying something once the figure has been revisited. So a
 * project whose confidence has never been touched shows nothing here rather than a
 * flat line implying steadiness nobody claimed.
 *
 * @param {any} p
 * @param {boolean} bare - drop the date labels, for the tile
 */
function confidenceTrend(p, bare) {
  const points = confidencePoints(p);
  if (points.length < 2) return '';

  return '<div class="ctrend">' +
    '<div class="lbl">Confidence over time</div>' +
    spark(points, {
      min: 0,
      max: 100,
      grid: [0, 50, 100],
      bare: bare,
      w: bare ? 200 : 240,
      h: bare ? 40 : 64,
      label: 'Win confidence across ' + points.length + ' meetings, now ' +
        points[points.length - 1].v + ' per cent'
    }) + '</div>';
}

/**
 * Raising an opportunity, in the shape a project is tracked in.
 *
 * It asks for customer, title, challenge, confidence, why we win and focus - the
 * same fields, in the same order, as the panel under a project's caret, because an
 * opportunity becomes a project a week later and anything not captured while it is
 * being discussed tends never to be captured at all.
 *
 * None of it is required except the title. A half-filled opportunity is better than
 * one nobody raised because the form looked like work.
 *
 * ## The optional first action
 *
 * Offered, and deliberately quiet about it: no highlight, no asterisk, and the form
 * submits perfectly well with it empty. Often the useful thing at the moment
 * somebody raises an opportunity is "and I'll call them on Thursday", and there is
 * currently nowhere to put that until the project exists a week later.
 */
function opportunityForm(snap, env, tab) {
  const focusOptions = pickList(snap, 'focus');

  const focusBoxes = focusOptions.length
    ? '<fieldset class="oppf"><legend class="lbl">Focus</legend>' +
      focusOptions.map(function (v) {
        return '<label class="fchk"><input type="checkbox" name="focus" value="' +
          esc(v) + '">' + esc(v) + '</label>';
      }).join('') + '</fieldset>'
    : '';

  return '<form class="add oppform" data-form="opp">' +
    whoFields(snap, tab, true) +
    '<input class="fld full" name="customer" type="text" placeholder="Customer">' +
    '<input class="fld full" name="text" type="text" ' +
    'placeholder="Project title - what the opportunity is" required>' +
    '<input class="fld full" name="why" type="text" ' +
    'placeholder="Major challenge, if there is one">' +
    '<input class="fld n" name="winPct" type="number" min="0" max="100" ' +
    'placeholder="Win %" aria-label="Win confidence per cent">' +
    '<input class="fld full" name="winReason" type="text" ' +
    'placeholder="Why we win">' +
    focusBoxes +
    '<div class="oppf-more">' +
    '<span class="why">Give it a first action now, if there is one. Optional.</span>' +
    '<input class="fld full" name="actionText" type="text" ' +
    'placeholder="First action" aria-label="First action">' +
    // ownerOptions, not peopleOptions: an action stores its owner as a NAME, and
    // peopleOptions emits ids. Both render identically, so getting this wrong shows
    // up as an action owned by "p3" rather than by anybody.
    '<select class="fld" name="actionOwner" aria-label="Action owner">' +
    ownerOptions(snap, tab, '', 'Owner') + '</select>' +
    '<input class="fld" name="actionDue" type="date" aria-label="Action due date">' +
    '</div>' +
    '<div class="acts-r">' +
    '<button class="btn" type="submit">Add</button>' +
    '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button>' +
    '</div></form>';
}
