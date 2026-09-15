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
import { fmt, fmtDay, fmtLong, rel, nextOn } from '../lib/dates.js';
import { byId } from '../lib/seq.js';
import {
  issueItems, actionedItems, actsOf, projVisible, openActsFor,
  personName, person, attendeeIds, isOpen
} from '../domain/queries.js';
import { dueClass, dueLabel, isOverdue, canSeeDetails } from '../domain/dueness.js';
import {
  MEETING_KINDS, WEEKDAYS, SEVERITY_LABELS, STATUS_LABELS, STATUSES,
  ACTIVE_STATUSES, segmentsFor
} from '../domain/constants.js';
import {
  meetingDate, ratingInfo, getMeeting, trendPoints, meetingSummary
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
      '<span class="st-b">' + minutes(length * s.f) +
      (counts[i] ? ' · <b>' + counts[i] + '</b>' : '') + '</span>' +
      '<i class="st-p" id="stp-' + i + '"></i></button>';
  }).join('');

  const stepper = '<div class="stepper">' +
    '<div class="steps" role="tablist" aria-label="Meeting segments">' + steps + '</div>' +
    '<div class="tmr" id="tmr"><span class="t-el" id="t-el">0:00</span>' +
    '<span class="t-of">/ ' + clock(length * 60) + '</span>' +
    '<button class="ib go" type="button" data-act="timerToggle" id="t-btn" aria-label="Start meeting clock">▶</button>' +
    '<button class="ib" type="button" data-act="timerReset" aria-label="Reset meeting clock">↺</button>' +
    '</div></div><div class="t-hint" id="t-hint"></div>';

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

/** A small "who is speaking" heading, used to walk round the room. */
function personBlock(snap, id, inner) {
  return '<div class="block"><div class="pname">' + esc(personName(snap, id)) + '</div>' + inner + '</div>';
}

/* --- 0: Wins & Losses --- */

function stageWins(snap, ui, env, tab, d, ents) {
  const reporting = (tab.members || []).filter(function (id) { return person(snap, id); });

  // Actions that came due since the last meeting: the natural way into the segment.
  const due = snap.actions.filter(function (a) {
    return a.tab === tab.id && isOpen(a) && a.due && a.due <= d;
  }).sort(function (a, b) { return (a.due || '') < (b.due || '') ? -1 : 1; });

  const dueCheck = due.length
    ? '<div class="duechk"><div class="dc-h">Due since the last meeting</div>' +
      '<ul class="alist">' + due.map(function (a) {
        return '<li class="arow"><span class="aid">' + actionLabel(a) + '</span>' +
          '<span class="atext">' + esc(a.text) + '</span>' +
          '<span class="adue ' + dueClass(a, env.today) + '">' + dueLabel(a, env.today) + '</span>' +
          '<span class="own">' + esc(a.owner || 'No owner') + '</span></li>';
      }).join('') + '</ul>' +
      '<p class="dc-tip">Close what is done as you go round — tick it in Action items.</p></div>'
    : '';

  const rows = reporting.map(function (id) {
    const mine = ents.filter(function (e) { return e.personId === id && (e.kind === 'win' || e.kind === 'loss'); });
    const list = mine.length
      ? '<ul class="items">' + mine.map(function (e) {
          return '<li class="item ' + (e.kind === 'win' ? 'win' : 'loss') + '">' +
            '<span class="chip ' + (e.kind === 'win' ? 'good' : 'crit') + '">' +
            (e.kind === 'win' ? 'Win' : 'Loss') + '</span>' +
            '<span class="it-t">' + esc(e.text) + '</span>' +
            (e.why ? '<span class="why">Why: ' + esc(e.why) + '</span>' : '') +
            (e.change ? '<span class="concl">' + (e.kind === 'loss' ? 'Doing differently: ' : 'Keep doing: ') + esc(e.change) + '</span>' : '') +
            '<button class="x edit-only" type="button" data-act="delEntry" data-id="' + esc(e.id) + '" aria-label="Remove"' + dis(env) + '>×</button>' +
            '</li>';
        }).join('') + '</ul>'
      : '<p class="none">Nothing recorded yet.</p>';

    const formKey = 'wl:' + id;
    const form = ui.open === formKey
      ? '<form class="add" data-form="wl" data-pid="' + esc(id) + '">' +
        '<select class="fld" name="kind" data-edit="wlKind" aria-label="Win or loss">' +
        '<option value="win">Win</option><option value="loss">Loss</option></select>' +
        '<input class="fld" name="text" type="text" placeholder="What happened" required>' +
        '<input class="fld" name="why" type="text" placeholder="Why did it happen" required>' +
        '<input class="fld ifloss" name="change" type="text" placeholder="What we will do differently" hidden>' +
        '<button class="btn" type="submit">Add</button>' +
        '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
      : '<button class="btn ghost sm add-btn edit-only" type="button" data-act="openForm" data-v="' + esc(formKey) + '"' + dis(env) + '>+ Win or loss</button>';

    return personBlock(snap, id, list + form);
  }).join('');

  return dueCheck + (rows || '<p class="none">Add people to this meeting in Settings first.</p>');
}

/* --- 1: New Opportunities, or the Tech Directors business review --- */

function stageOpportunities(snap, ui, env, tab, d, ents) {
  if (tab.id === 'techdir') return businessReview(snap, tab);

  const reporting = (tab.members || []).filter(function (id) { return person(snap, id); });

  const rows = reporting.map(function (id) {
    const mine = ents.filter(function (e) { return e.personId === id && e.kind === 'opp'; });
    const list = mine.length
      ? '<ul class="items">' + mine.map(function (e) {
          const pj = e.projectId ? byId(snap.projects, e.projectId) : null;
          return '<li class="item opp">' +
            '<span class="chip">Opportunity</span>' +
            '<span class="it-t">' + esc(e.text) + '</span>' +
            (e.why ? '<span class="why">Challenge: ' + esc(e.why) + '</span>' : '') +
            (pj && pj.start ? '<span class="concl">Joins Current Projects ' + fmtDay(pj.start) + '</span>' : '') +
            '<button class="x edit-only" type="button" data-act="delEntry" data-id="' + esc(e.id) + '" aria-label="Remove"' + dis(env) + '>×</button>' +
            '</li>';
        }).join('') + '</ul>'
      : '<p class="none">Nothing raised yet.</p>';

    const formKey = 'opp:' + id;
    const form = ui.open === formKey
      ? '<form class="add" data-form="opp" data-pid="' + esc(id) + '">' +
        '<input class="fld" name="text" type="text" placeholder="The opportunity" required>' +
        '<input class="fld" name="why" type="text" placeholder="Any major challenge (optional)">' +
        '<button class="btn" type="submit">Add</button>' +
        '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
      : '<button class="btn ghost sm add-btn edit-only" type="button" data-act="openForm" data-v="' + esc(formKey) + '"' + dis(env) + '>+ Opportunity</button>';

    return personBlock(snap, id, list + form);
  }).join('');

  return rows || '<p class="none">Add people to this meeting in Settings first.</p>';
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
  const reporting = (tab.members || []).filter(function (id) { return person(snap, id); });
  const seeDetails = canSeeDetails(snap, ui.iam, tab.id);

  const rows = reporting.map(function (id) {
    const mine = snap.projects.filter(function (p) {
      return p.personId === id && projVisible(p, tab.id, d);
    });

    const list = mine.length
      ? mine.map(function (p) {
          const buttons = STATUSES.map(function (v) {
            return '<button type="button" class="tgl' + (p.status === v ? ' sel' : '') +
              '" data-act="projStatus" data-id="' + esc(p.id) + '" data-v="' + v + '"' +
              (p.status === v ? ' aria-pressed="true"' : '') + dis(env) + '>' +
              STATUS_LABELS[v] + '</button>';
          }).join('');

          const acts = actsOf(snap, p.id);
          const selected = ui.proj === p.id;

          return '<div class="proj' + (selected ? ' psel' : '') + '" id="proj-' + esc(p.id) + '">' +
            '<div class="rrow">' +
            '<button type="button" class="linkbtn" data-act="selectProject" data-id="' + esc(p.id) + '">' +
            esc(p.name) + '</button>' +
            (p.due ? '<span class="duetag">' + fmt(p.due) + '</span>' : '') +
            (acts.length ? '<span class="chip">' + acts.filter(isOpen).length + ' open</span>' : '') +
            '</div>' +
            '<div class="seg-tgl" role="group" aria-label="Status for ' + esc(p.name) + '">' + buttons + '</div>' +
            (p.note ? '<p class="why">' + esc(p.note) + '</p>' : '') +
            (seeDetails ? projectDetails(snap, env, p) : '') +
            '</div>';
        }).join('')
      : '<p class="none">No current projects.</p>';

    const formKey = 'pj:' + id;
    const form = ui.open === formKey
      ? '<form class="add" data-form="project" data-pid="' + esc(id) + '">' +
        '<input class="fld" name="name" type="text" placeholder="Project name" required>' +
        '<input class="fld" name="due" type="date" aria-label="Due date">' +
        '<button class="btn" type="submit">Add</button>' +
        '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
      : '<button class="btn ghost sm add-btn edit-only" type="button" data-act="openForm" data-v="' + esc(formKey) + '"' + dis(env) + '>+ Project</button>';

    return personBlock(snap, id, list + form);
  }).join('');

  return rows || '<p class="none">Add people to this meeting in Settings first.</p>';
}

/**
 * The value and confidence panel.
 *
 * Only rendered when `canSeeDetails` says so — which, to be clear, is a display
 * preference and not a control: the identity it checks comes from a dropdown the
 * viewer sets themselves. See dueness.js.
 */
function projectDetails(snap, env, p) {
  return '<details class="dtl"><summary class="lbl">Project details</summary>' +
    '<div class="sgrid">' +
    '<label class="lbl">Estimated value' +
    '<input class="fld" type="number" data-edit="pdValue" data-id="' + esc(p.id) + '" value="' +
    esc(p.estValue == null ? '' : p.estValue) + '"' + dis(env) + '></label>' +
    '<label class="lbl">Confidence %' +
    '<input class="fld" type="number" min="0" max="100" data-edit="pdWin" data-id="' + esc(p.id) + '" value="' +
    esc(p.winPct == null ? '' : p.winPct) + '"' + dis(env) + '></label>' +
    '</div>' +
    '<label class="lbl">Why we win' +
    '<textarea class="fld" rows="2" data-edit="pdReason" data-id="' + esc(p.id) + '"' + dis(env) + '>' +
    esc(p.winReason || '') + '</textarea></label></details>';
}

/* --- 3: Issues --- */

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
      (isProject ? 'Off-track project' : SEVERITY_LABELS[it.sev]) + '</span>' +
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
          (it.type === 'p' ? 'Off-track project' : SEVERITY_LABELS[it.sev]) + '</span>' +
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
      '<option value="stopper">Urgent — show-stopper</option>' +
      '<option value="risk">Important</option></select>' +
      '<select class="fld" name="who" aria-label="Raised by">' + peopleOptions(snap, tab) + '</select>' +
      '<button class="btn" type="submit">Add</button>' +
      '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
    : '<button class="btn ghost add-btn edit-only" type="button" data-act="openForm" data-v="issue"' + dis(env) + '>+ Raise an issue</button>';

  return (cards || '<p class="none">Nothing without a path. That is the goal.</p>') +
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

/** The rating trend, drawn inline. Data comes from the domain; only the shape is here. */
function sparkline(points) {
  const W = 240, H = 64, px = 8, py = 8;
  const x = function (i) { return px + i * (W - 2 * px) / (points.length - 1); };
  const y = function (v) { return py + (5 - v) * (H - 2 * py) / 4; };
  const last = points[points.length - 1];

  return '<svg class="spark" viewBox="0 0 ' + W + ' ' + (H + 16) +
    '" role="img" aria-label="Meeting score trend over the last ' + points.length + ' meetings">' +
    [1, 3, 5].map(function (v) {
      return '<line class="sg" x1="' + px + '" x2="' + (W - px) + '" y1="' + y(v) + '" y2="' + y(v) + '"></line>';
    }).join('') +
    '<polyline class="sl" points="' + points.map(function (p, i) {
      return x(i).toFixed(1) + ',' + y(p.avg).toFixed(1);
    }).join(' ') + '"></polyline>' +
    '<circle class="se" cx="' + x(points.length - 1) + '" cy="' + y(last.avg) + '" r="3.5"></circle>' +
    '<text class="st" x="' + px + '" y="' + (H + 13) + '">' + fmt(points[0].d) + '</text>' +
    '<text class="st" x="' + (W - px) + '" y="' + (H + 13) + '" text-anchor="end">' + fmt(last.d) + '</text></svg>';
}

/* ---------- the rail ---------- */

function renderRail(snap, ui, env, tab, step, d) {
  const selected = ui.proj ? byId(snap.projects, ui.proj) : null;

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
          '<span class="ameta">' + esc(a.owner || 'No owner') + ' · ' + dueLabel(a, env.today) + '</span></li>';
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

/** Options of people, those in this meeting first. */
function peopleOptions(snap, tab, selectedName) {
  const ids = attendeeIds(tab).filter(function (id) { return person(snap, id); });
  const inMeeting = ids.map(function (id) { return person(snap, id); });
  const rest = snap.people.filter(function (p) { return ids.indexOf(p.id) < 0; });

  function opt(p, byName) {
    const value = byName ? p.name : p.id;
    return '<option value="' + esc(value) + '"' +
      (selectedName && p.name === selectedName ? ' selected' : '') + '>' + esc(p.name) + '</option>';
  }

  return (inMeeting.length ? '<optgroup label="In this meeting">' +
      inMeeting.map(function (p) { return opt(p, false); }).join('') + '</optgroup>' : '') +
    (rest.length ? '<optgroup label="Everyone else">' +
      rest.map(function (p) { return opt(p, false); }).join('') + '</optgroup>' : '');
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
