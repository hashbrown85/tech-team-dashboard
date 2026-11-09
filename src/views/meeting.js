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
import {
  issueItems, actionedItems, actsOf, projVisible, openActsFor,
  personName, person, attendeeIds, isOpen, isOpportunity, oppStage
} from '../domain/queries.js';
import { byPriority, projectTitle } from '../domain/projects.js';
import {
  OPP_STAGE_LABELS, OPP_STAGE_CHIPS, decisionsFor, horizonFor
} from '../domain/opportunities.js';
import { dueClass, dueLabel, isOverdue } from '../domain/dueness.js';
import {
  ownerOptions, actionEditor, editButton, editingAction, originLine
} from './actionEditor.js';
import {
  MEETING_KINDS, WEEKDAYS, SEVERITY_LABELS, SEVERITIES, STATUS_LABELS, STATUSES,
  ACTIVE_STATUSES, segmentsFor, stepIndex, TECHDIR_TAB_ID
} from '../domain/constants.js';
import {
  meetingDate, nextMeetingAfter, meetingSummary,
  summaryRecipients
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
  const segs = segmentsFor(tab);
  const step = Math.min(stepOf(ui, tab.id), segs.length - 1);
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
    // The summary is for any meeting, at any point in it - not only from the last
    // segment, where it used to live - so it sits in the header.
    '<button class="btn sm" type="button" data-act="toggleSummary" aria-expanded="' +
    (ui.sumShow ? 'true' : 'false') + '">Summary</button>' +
    '<button class="btn ghost sm" type="button" data-act="openSettings">Settings</button>';

  const head = '<header class="ph"><div><div class="lbl">' +
    MEETING_KINDS[tab.kind] + ' · ' + WEEKDAYS[tab.weekday] + ' · ' + length + ' min</div>' +
    '<h1>' + esc(tab.name) + '</h1>' + att + '</div>' +
    '<div class="ph-r">' + right + '</div></header>';

  /* --- stepper --- */

  const ents = snap.entries.filter(function (e) { return e.tab === tab.id && e.meeting === d; });
  const counts = {
    projects: snap.projects.filter(function (x) {
      return projVisible(x, tab.id, d) && ACTIVE_STATUSES.indexOf(x.status) >= 0;
    }).length + horizonFor(snap, tab.id, d).filter(function (p) {
      return oppStage(p) === 'open';
    }).length,
    wl: ents.filter(function (e) { return e.kind === 'win' || e.kind === 'loss'; }).length,
    issues: issueItems(snap, tab.id).length,
    review: 0
  };

  const steps = segs.map(function (s, i) {
    return '<button type="button" class="st' + (i === step ? ' cur' : '') + (s.key === 'issues' ? ' main' : '') +
      '" id="st-' + i + '" data-act="step" data-v="' + i + '"' +
      (i === step ? ' aria-current="step"' : '') + '>' +
      '<span class="st-n">' + (i + 1) + '</span>' +
      '<span class="st-t">' + esc(s.short) + '</span>' +
      '<span class="st-y">' + esc(s.tiny) + '</span>' +
      (showTimer
        ? '<span class="st-b">' + minutes(length * s.f) +
          (counts[s.key] ? ' · <b>' + counts[s.key] + '</b>' : '') + '</span>' +
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

  return head + (ui.sumShow ? summaryPanel(snap, env, tab, d) : '') + stepper +
    '<div class="mgrid">' +
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

/* ---------- the stages ---------- */

function renderStage(snap, ui, env, tab, step, d, ents, segs) {
  // By key, not position: the two agendas order their segments differently.
  const key = segs[step].key;
  const body = key === 'projects' ? stageProjects(snap, ui, env, tab, d)
    : key === 'wl' ? stageWins(snap, ui, env, tab, d, ents)
    : key === 'review' ? businessReview(snap, tab)
    : stageIssues(snap, ui, env, tab, d);

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

/* --- Wins & Losses --- */

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
  const loss = ui.wlKind === 'loss';
  const addForm = ui.open === 'wl'
    ? '<form class="add" data-form="wl">' +
      '<select class="fld" name="kind" data-edit="wlKind" aria-label="Win or loss">' +
      '<option value="win"' + (loss ? '' : ' selected') + '>Win</option>' +
      '<option value="loss"' + (loss ? ' selected' : '') + '>Loss</option></select>' +
      '<input class="fld" name="text" type="text" placeholder="What happened" required>' +
      '<input class="fld" name="why" type="text" placeholder="Why did it happen" required>' +
      // Shown from ui.wlKind, so every redraw draws it the way it was left. See
      // edits.wlKind.
      '<input class="fld ifloss" name="change" type="text" placeholder="What we will do differently"' +
      (loss ? '' : ' hidden') + '>' +
      whoFields(snap, tab, false) +
      '<button class="btn" type="submit">Add</button>' +
      '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
    : '<button class="btn ghost add-btn edit-only" type="button" data-act="openForm" data-v="wl"' +
      dis(env) + '>+ Win or loss</button>';

  return list + addForm;
}

/**
 * The meeting summary, ready to send: who it goes to, Email and Copy, and the text.
 *
 * Email opens a new message in the mail app to everybody in the meeting with a
 * work email, subject and body filled in (see handlers emailSummary). Anybody in
 * the meeting without one is named here, so nobody is left off silently.
 *
 * @param {Snapshot} snap
 * @param {any} env
 * @param {any} tab
 * @param {string} d
 */
function summaryPanel(snap, env, tab, d) {
  const rec = summaryRecipients(snap, tab);
  const to = rec.to.length
    ? 'To the ' + rec.to.length + (rec.to.length === 1 ? ' person' : ' people') + ' in this meeting'
    : 'Nobody in this meeting has a work email yet';
  const missing = rec.missing.length
    ? '<p class="scope-note">No work email for <b>' + esc(rec.missing.join(', ')) +
      '</b>, so the email will not include them. Add one on the People page.</p>'
    : '';
  return '<section class="panel" aria-label="Meeting summary"><div class="pan-h">' +
    '<h2>Meeting summary</h2><span class="sub">' + esc(to) + '</span>' +
    '<div class="r">' +
    '<button class="btn sm" type="button" data-act="emailSummary">Email</button> ' +
    '<button class="btn ghost sm" type="button" data-act="copySummary">Copy</button> ' +
    '<button class="btn ghost sm" type="button" data-act="toggleSummary">Close</button>' +
    '</div></div>' + missing +
    // Said up front, because it is the usual case: a link to the mail app can only
    // carry about two thousand characters, and most meetings' summaries are longer.
    '<p class="sub">Email opens a new message to them with the subject filled in. ' +
    'The summary is copied at the same time; if it is not already in the message, ' +
    'paste it in (Ctrl+V).</p>' +
    '<div class="sumbox"><textarea class="fld mono" id="f-summary" rows="18" readonly ' +
    'aria-label="Summary text">' + esc(meetingSummary(snap, tab, d, env.today)) +
    '</textarea></div></section>';
}

/** The chip on an opportunity tile: where it stands. */
function stageChip(p) {
  const s = oppStage(p) || 'open';
  return '<span class="chip ' + OPP_STAGE_CHIPS[s] + '">' + OPP_STAGE_LABELS[s] + '</span>';
}

/**
 * The decisions on an opportunity - Promote to project, Put on hold, Cancel - and a
 * way into its page, where its notes, values and actions are.
 *
 * Inside the tile's existing `.it-c` sub-line rather than as a new child: `.item`
 * is a grid whose child count the layout checker asserts, and the sub-line is
 * already placed in column 2 under the title.
 */
function decisionLine(p, env) {
  const s = oppStage(p);
  const done = s === 'promoted' ? 'Promoted to Current projects'
    : s === 'cancelled' ? 'Cancelled' : '';
  const buttons = decisionsFor(p).map(function (d) {
    return '<button type="button" class="linkbtn edit-only" data-act="oppDecide" data-id="' +
      esc(p.id) + '" data-v="' + d[0] + '"' + dis(env) + '>' + d[1] + '</button>';
  });
  if (!done && !buttons.length) return '';
  return '<span class="it-c">' + (done ? done + (buttons.length ? ' \u00b7 ' : '') : '') +
    buttons.join(' \u00b7 ') + '</span>';
}

/** Every active project across every meeting — what the Tech Directors group reviews. */
function businessReview(snap, tab) {
  const groups = snap.tabs.filter(function (t) { return t.id !== tab.id; }).map(function (t) {
    const live = snap.projects.filter(function (p) {
      return p.tab === t.id && ACTIVE_STATUSES.indexOf(p.status) >= 0 && !isOpportunity(p);
    });
    if (!live.length) return '';
    return '<div class="mgroup"><div class="lbl">' + esc(t.name) + '</div><ul class="items">' +
      live.map(function (p) {
        return '<li class="item"><span class="chip ps-' + esc(p.status) + '">' +
          STATUS_LABELS[p.status] + '</span>' +
          '<span class="it-t">' + esc(projectTitle(p)) + '</span>' +
          '<span class="why">' + esc(personName(snap, p.personId)) + '</span></li>';
      }).join('') + '</ul></div>';
  }).join('');

  return groups || '<p class="none">No active projects in any other meeting yet.</p>';
}

/* --- Projects & Horizon, or Tech-Projects --- */

function stageProjects(snap, ui, env, tab, d) {
  /*
   * Two sections of one list. Horizon - the opportunities, which are projects not
   * yet decided on - and below it Current projects, so promoting one visibly moves
   * it down from the first section into the second. Each section folds away under
   * its heading, remembered across redraws (ui.hideHorizon / ui.hideCurrent), and
   * says how many it holds while folded.
   *
   * Tech Directors has no opportunities, so its list is just its projects.
   */
  const horizon = tab.id === TECHDIR_TAB_ID ? '' : horizonSection(snap, ui, env, tab, d);

  /*
   * One list for the meeting, not one per person. Priority is meeting-wide: the
   * arrows move a tile among ALL of them.
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
    ? addProjectForm(snap, tab, 'project', 'name', 'Project title')
    : '<button class="btn ghost add-btn edit-only" type="button" data-act="openForm" data-v="project"' +
      dis(env) + '>+ Project</button>';

  return horizon +
    section('current', 'Current projects', mine.length, !!ui.hideCurrent, list + addForm);
}

/**
 * A heading that folds its section away. A real button (aria-expanded), so it
 * works from the keyboard; the count stays visible when folded, so a folded
 * section still says whether there is anything in it.
 *
 * @param {string} key - 'horizon' | 'current'
 * @param {string} title
 * @param {number} n
 * @param {boolean} hidden
 * @param {string} body
 */
function section(key, title, n, hidden, body) {
  return '<div class="psec">' +
    '<h3 class="psec-h"><button type="button" class="sec-tog" data-act="toggleSection" data-v="' +
    key + '" id="sec-' + key + '" aria-expanded="' + (hidden ? 'false' : 'true') + '">' +
    '<span class="caret" aria-hidden="true">' + (hidden ? '\u25b8' : '\u25be') + '</span>' +
    esc(title) + ' <span class="cnt n">' + n + '</span></button></h3>' +
    (hidden ? '' : body) + '</div>';
}

/** The Horizon: opportunities in this meeting that nobody has decided on yet. */
function horizonSection(snap, ui, env, tab, d) {
  const opps = horizonFor(snap, tab.id, d);
  const list = opps.length
    ? '<ul class="items">' + opps.map(function (p) {
        return horizonRow(snap, ui, env, p);
      }).join('') + '</ul>'
    : '<p class="none">Nothing on the horizon.</p>';

  const addForm = ui.open === 'opp'
    ? addProjectForm(snap, tab, 'opp', 'text', 'Opportunity title')
    : '<button class="btn ghost add-btn edit-only" type="button" data-act="openForm" data-v="opp"' +
      dis(env) + '>+ Opportunity</button>';

  const waiting = opps.filter(function (p) { return oppStage(p) === 'open' || oppStage(p) === 'hold'; });
  return section('horizon', 'Horizon', waiting.length, !!ui.hideHorizon, list + addForm);
}

/**
 * One opportunity on the Horizon. The same things a project tile shows - full
 * title (a link to its page), owner, due date, Filter actions - with the decision
 * in place of the status buttons.
 *
 * `.item` is a three-column grid the layout checker asserts: chip, title, x, and
 * the sub-lines pinned to column 2 under the title.
 */
function horizonRow(snap, ui, env, p) {
  const selected = ui.railProj === p.id;
  // `opp-`, not `proj-`: one promoted today is on screen twice - here, marked as
  // decided, and as a tile in Current projects - and an id may appear only once.
  return '<li class="item opp' + (selected ? ' sel' : '') + '" id="opp-' + esc(p.id) + '">' +
    stageChip(p) +
    '<span class="it-t"><button type="button" class="linkbtn pname-open" data-act="openProject" ' +
    'data-id="' + esc(p.id) + '" title="Open the details">' + esc(projectTitle(p)) +
    '</button></span>' +
    '<span class="it-s">' + esc(ownerLine(snap, p)) + ' \u00b7 ' +
    (p.due ? 'Due <span class="mono">' + fmt(p.due) + '</span>' : 'No due date') + ' \u00b7 ' +
    '<button type="button" class="linkbtn pfilter" data-act="selectProject" data-id="' +
    esc(p.id) + '" aria-pressed="' + selected + '">' +
    (selected ? 'Show all actions' : 'Filter actions') + '</button></span>' +
    decisionLine(p, env) +
    '<button class="x edit-only" type="button" data-act="delOpportunity" data-id="' + esc(p.id) +
    '" aria-label="Remove this opportunity"' + dis(env) + '>\u00d7</button>' +
    '</li>';
}

/**
 * The add form for an opportunity or a project: the same five things a tile shows,
 * plus Mission & challenges. Everything else is filled in on the project's page.
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @param {string} form - 'opp' | 'project', the data-form the handler keys on
 * @param {string} titleName - the title field's name, as each handler reads it
 * @param {string} titleLabel
 */
function addProjectForm(snap, tab, form, titleName, titleLabel) {
  return '<form class="add" data-form="' + form + '">' +
    // Customer first: the title reads "Customer - Project title". Optional, because
    // internal work has none.
    '<input class="fld" name="customer" type="text" placeholder="Customer (optional)">' +
    '<input class="fld" name="' + titleName + '" type="text" placeholder="' + titleLabel + '" required>' +
    '<input class="fld" name="due" type="date" aria-label="Due date">' +
    '<input class="fld full" name="mission" type="text" placeholder="Mission &amp; challenges (optional)">' +
    whoFields(snap, tab, true) +
    '<button class="btn" type="submit">Add</button>' +
    '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>';
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

  /*
   * The owner leads and is the bold thing on the row. The block heading that used to
   * carry the name is gone, so this is the only place it appears - and it is what
   * you scan for. Folded into the meta line rather than added as another child:
   * `.proj` is a two-column grid whose child count the checker asserts.
   */
  const meta =
    // No customer here: it leads the title above, so it would only say it twice.
    '<b>' + esc(ownerLine(snap, p)) + '</b> \u00b7 ' +
    (p.status === 'new'
      ? '<span class="chip new">New</span> ' + (p.fromOpp ? 'Promoted · set a status' : 'Set a status') + ' · '
      : '') +
    (p.due ? 'Due <span class="mono">' + fmt(p.due) + '</span>' : 'No due date') +
    ' · ' + (open ? open + ' open action' + (open > 1 ? 's' : '') : 'no open actions') +
    (p.status === 'off'
      ? (open ? ' · recovery underway' : ' · <b class="warnt">no path yet, in Issues</b>')
      : '');

  const status = STATUSES.map(function (v) {
    return '<button type="button" data-act="projStatus" data-id="' + esc(p.id) +
      '" data-v="' + v + '" aria-pressed="' + (p.status === v) + '"' + dis(env) + '>' +
      STATUS_LABELS[v] + '</button>';
  }).join('');

  return '<li class="proj ps-' + esc(p.status) + (selected ? ' sel' : '') +
    '" id="proj-' + esc(p.id) + '">' +
    '<div class="pname">' +
    '<button type="button" class="it-t pname-open" data-act="openProject" data-id="' +
    esc(p.id) + '" title="Open this project">' + esc(projectTitle(p)) + '</button>' +
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
    '</li>';
}

/* --- Issues --- *//* --- 3: Issues --- */

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
        // Being edited: the row becomes the editor. A plain <li>, not .arow - the
        // form is not one of that grid's children and must not be counted as one.
        if (editingAction(ui, a)) {
          return '<li id="row-' + esc(a.id) + '">' + actionEditor(snap, a) + '</li>';
        }
        return '<li class="arow ' + dueClass(a, env.today) + '" id="row-' + esc(a.id) + '">' +
          '<label class="ax"><input type="checkbox" data-edit="actionDone" data-id="' + esc(a.id) + '"' +
          (isOpen(a) ? '' : ' checked') + dis(env) + '><span class="aid">' + actionLabel(a) + '</span></label>' +
          // Where it came from, under the text - unless the rail is already showing
          // only that project's actions, where it would say the same thing on every row.
          '<span class="atext">' + esc(a.text) + editButton(a, env) +
          (selected ? '' : originLine(snap, a)) + '</span>' +
          '<span class="ameta">' + esc(a.owner || 'No owner') + ' · ' + dueLabel(a, env.today) + '</span>' +
          dueControls(a, tab, d, env) + '</li>';
      }).join('') + '</ul>'
    : '<p class="none">' + (selected ? 'No actions on this project yet.' : 'No open actions in this meeting.') + '</p>';

  const railHead = '<div class="pan-h"><h2>' +
    (selected ? esc(projectTitle(selected)) : 'Open actions') + '</h2>' +
    (selected ? '<button class="btn ghost sm" type="button" data-act="clearProject">Show all</button>' : '') +
    '</div>';

  const issueShortlist = segmentsFor(tab)[step] && segmentsFor(tab)[step].key !== 'issues'
    ? (function () {
        const q = issueItems(snap, tab.id).slice(0, 4);
        if (!q.length) return '';
        return '<div class="rlist"><div class="lbl">Issues without a path</div><ul class="items">' +
          q.map(function (it) {
            return '<li class="item"><span class="chip ' + esc(it.sev) + '">' +
              (it.type === 'p' ? 'Off-track' : SEVERITY_LABELS[it.sev]) + '</span>' +
              '<span class="it-t">' + esc(it.o.text || it.o.name) + '</span></li>';
          }).join('') + '</ul>' +
          '<button class="btn ghost sm" type="button" data-act="step" data-v="' +
          stepIndex(tab, 'issues') + '">Work through them</button></div>';
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

/** What an action can be attached to. */
function relatedOptions(snap, tab, selected) {
  const live = snap.projects.filter(function (p) {
    return p.tab === tab.id && ACTIVE_STATUSES.indexOf(p.status) >= 0;
  });
  // Opportunities carry actions too - "I'll call them Thursday" is often the first
  // thing said about one - so they are offered, but under their own heading: an
  // opportunity is not a project until somebody promotes it. A cancelled one is
  // not going anywhere and is left out.
  const projects = live.filter(function (p) { return !isOpportunity(p); });
  const opps = live.filter(function (p) {
    const s = oppStage(p);
    return s === 'open' || s === 'hold';
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
    (opps.length ? '<optgroup label="Opportunities">' + opps.map(function (p) {
      return opt('p:' + p.id, 'Opportunity · ' + esc(projectTitle(p)) +
        (oppStage(p) === 'hold' ? ' (on hold)' : ''));
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


