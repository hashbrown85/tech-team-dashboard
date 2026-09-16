// @ts-check
/**
 * Project rules: the status lifecycle, and how projects come into existence.
 *
 * See the folder rules at the top of queries.js — no DOM, no store, pure functions.
 *
 * The status lifecycle (rule 3 in docs/BUSINESS_RULES.md) is the most intricate logic
 * in the app and the easiest to break, because four separate things happen on a single
 * status click and two of them are scoped to "this meeting" rather than to the change
 * itself. Read the rule before editing.
 *
 * Lifted from board.html: H.projStatus (1360-1373), F.opp (1577-1585),
 * F.project (1586-1591).
 */

import { issueItems, personName, actsOf, isOpen } from './queries.js';
import { addDays, fmtLong, fmtDay, fmtStamp } from '../lib/dates.js';
import { byId } from '../lib/seq.js';
import { actionLabel } from './actions.js';
import { notesFor } from './notes.js';
import { STATUS_LABELS } from './constants.js';

// The status vocabulary lives in constants.js — re-exported here because callers
// dealing with project status shouldn't have to know that.
export { STATUSES, ACTIVE_STATUSES, STATUS_LABELS } from './constants.js';

/**
 * @typedef {import('./queries.js').Snapshot} Snapshot
 */

/**
 * Where a newly off-track project goes in the issue queue: below everything already
 * queued.
 *
 * Two details worth preserving. It scans `issueItems`, which is the *unpathed* queue
 * only — items that already have an open action aren't counted, so their ranks don't
 * push the new arrival further down. And the +1000 gap leaves room for the fractional
 * inserts that new show-stoppers use (rule 6), so nothing has to be renumbered.
 *
 * Call this BEFORE changing the project's status, so the project can't count itself.
 *
 * @param {Snapshot} snap
 * @param {string} tid - tab id
 * @returns {number}
 */
export function nextOffTrackRank(snap, tid) {
  let maxRank = 0;
  issueItems(snap, tid).forEach(function (it) {
    if ((it.o.rank || 0) > maxRank) maxRank = it.o.rank;
  });
  return maxRank + 1000;
}

/**
 * Work out the new project record for a status change.
 *
 * Returns the document to store — WITHOUT its `id`, matching how the original
 * `mutateDoc` wrote it (board.html:645-649) — or `null` when there is nothing to do.
 *
 * Four things happen, and the order matters:
 *
 *  1. One step of history, scoped to the meeting. The FIRST change in a given meeting
 *     records what it changed from. A later change in the same meeting leaves that
 *     alone, so `on -> off -> hold` still reports "was on track". But changing all the
 *     way back to where it started erases the record, so a mis-click doesn't appear in
 *     the meeting summary as a real change.
 *  2. `doneMeeting` is stamped on done/cancelled and cleared otherwise. That single
 *     field is what makes closed work visible in the meeting it was closed in and
 *     invisible the week after (rule 4).
 *  3. Going off-track joins the issue queue at the bottom.
 *  4. Leaving off-track drops out of the queue entirely.
 *
 * @param {Snapshot} snap
 * @param {any} project - the project as it is now
 * @param {string} newStatus - one of STATUSES
 * @param {string} tid - tab id, for ranking
 * @param {string} meetingDate - the meeting this change is happening in, 'YYYY-MM-DD'
 * @returns {any | null} the document to write, or null if nothing changed
 */
export function statusChange(snap, project, newStatus, tid, meetingDate) {
  // Clicking the status a project already has does nothing at all — no history
  // entry, no re-stamp. board.html:1361.
  if (!project || project.status === newStatus) return null;

  const x = JSON.parse(JSON.stringify(project));
  delete x.id;

  const was = x.status;
  x.status = newStatus;

  // 1. One step of history, scoped to the meeting.
  if (x.statusMeeting !== meetingDate) {
    x.prevStatus = was;
    x.statusMeeting = meetingDate;
  } else if (x.prevStatus === newStatus) {
    delete x.prevStatus;
    delete x.statusMeeting;
  }

  // 2. Closure stamp.
  if (newStatus === 'done' || newStatus === 'cancelled') {
    x.doneMeeting = meetingDate;
  } else {
    delete x.doneMeeting;
  }

  // 3 and 4. Queue position, held only while off-track.
  if (newStatus === 'off' && was !== 'off') {
    x.rank = nextOffTrackRank(snap, tid);
  } else if (newStatus !== 'off') {
    delete x.rank;
  }

  return x;
}

/**
 * A project entered directly in the Current Projects segment. Starts on track and
 * visible immediately. board.html:1589.
 *
 * @param {object} args
 * @param {string} args.tab
 * @param {string} args.personId
 * @param {string} args.name
 * @param {string} [args.due]
 * @param {string} args.meetingDate
 * @returns {any} the document to write
 */
export function newProject({ tab, personId, name, due, meetingDate }) {
  return {
    tab: tab,
    personId: personId,
    name: name,
    status: 'on',
    due: due || '',
    added: meetingDate
  };
}

/**
 * An opportunity raised in the New Opportunities segment. Creates TWO records — the
 * log entry and a project — linked to each other in both directions.
 *
 * The project starts a week out (`start` = meeting + 7 days), which combined with
 * `projVisible` means it is deliberately NOT in Current Projects today. You discuss it
 * as an opportunity this week; next week it's something you're accountable for.
 * Rule 5 in docs/BUSINESS_RULES.md.
 *
 * Faithful oddities, both from board.html:1582 — the project gets `due: ''` rather
 * than no due date, and it gets no `added` field at all, unlike newProject above.
 *
 * @param {object} args
 * @param {string} args.entryId - pre-generated, because the two records reference each other
 * @param {string} args.projectId
 * @param {string} args.tab
 * @param {string} args.personId
 * @param {string} args.text - what the opportunity is; also becomes the project name
 * @param {string} [args.why] - the major challenge; also becomes the project note
 * @param {string} args.meetingDate
 * @returns {{entry: any, project: any, startsOn: string}} two documents to write
 */
export function newOpportunity({ entryId, projectId, tab, personId, text, why, meetingDate }) {
  const startsOn = addDays(meetingDate, 7);
  return {
    entry: {
      tab: tab,
      meeting: meetingDate,
      personId: personId,
      kind: 'opp',
      text: text,
      why: why || '',
      projectId: projectId
    },
    project: {
      tab: tab,
      personId: personId,
      name: text,
      status: 'new',
      due: '',
      start: startsOn,
      fromOpp: entryId,
      note: why || ''
    },
    startsOn: startsOn
  };
}

/**
 * When deleting a log entry, should its linked project go too?
 *
 * Only while nobody has acted on it — the project must still be untouched (`new`) and
 * have no actions attached at all, open or closed. Once someone has worked on it,
 * deleting the log entry leaves the project alone.
 *
 * Note this checks only that the entry HAS a `projectId`, not that its `kind` is
 * 'opp'. In practice only opportunities carry one, so it amounts to the same thing —
 * but that's what board.html:1387 tests, so it's what this tests.
 *
 * @param {Snapshot} snap
 * @param {any} entry
 * @returns {boolean}
 */
export function linkedProjectGoesToo(snap, entry) {
  if (!entry || !entry.projectId) return false;
  const p = snap.projects.find(function (x) { return x.id === entry.projectId; });
  if (!p || p.status !== 'new') return false;
  return !snap.actions.some(function (a) { return a.parent && a.parent.id === p.id; });
}


/**
 * One project as plain text, for pasting into an email.
 *
 * Same idea as the meeting summary: the board should never be the only place a
 * thing can be read. Plain text travels everywhere and needs no permission.
 *
 * The commercial block is included only when `withValue` says the reader actually
 * received those numbers - otherwise a person who cannot see them on the page could
 * copy them out of it, which would make the permission split pointless.
 *
 * @param {Snapshot} snap
 * @param {any} p - the project
 * @param {string} today
 * @param {boolean} withValue
 * @returns {string}
 */
export function projectSummary(snap, p, today, withValue) {
  const tab = byId(snap.tabs, p.tab);
  const details = byId(snap.projectDetails, p.id);
  const acts = actsOf(snap, p.id);
  const open = acts.filter(isOpen);

  /** @type {string[]} */
  const L = [];
  function sec(title, lines, empty) {
    L.push('', title.toUpperCase());
    if (lines.length) lines.forEach(function (x) { L.push('\u2022 ' + x); });
    else L.push('\u2022 ' + empty);
  }

  L.push(p.name);
  L.push([
    p.customer || null,
    personName(snap, p.personId),
    tab ? tab.name : null
  ].filter(Boolean).join(' \u00b7 '));
  L.push('Status: ' + (STATUS_LABELS[p.status] || p.status) +
    (p.due ? '  |  Due ' + fmtLong(p.due) : '  |  No due date'));

  if (p.mission) {
    L.push('', 'MISSION');
    L.push(p.mission);
  }

  if (withValue && details && (details.estValue != null || details.winPct != null)) {
    L.push('', 'COMMERCIAL');
    if (details.estValue != null) {
      L.push('\u2022 Estimated value: $' +
        Math.round(Number(details.estValue)).toLocaleString('en-US') + ' per year');
    }
    if (details.winPct != null) L.push('\u2022 Confidence: ' + details.winPct + '%');
    if (details.estValue != null && details.winPct != null) {
      L.push('\u2022 Weighted: $' +
        Math.round(Number(details.estValue) * Number(details.winPct) / 100)
          .toLocaleString('en-US'));
    }
    if (details.winReason) L.push('\u2022 Why we win: ' + details.winReason);
  }

  sec('Open actions', open.map(function (a) {
    return actionLabel(a) + ' ' + a.text +
      ' \u2014 ' + (a.owner || 'no owner') +
      (a.due ? ' \u2014 due ' + fmtDay(a.due) : '');
  }), 'None open');

  const notes = notesFor(snap, p.id).slice(0, 5);
  sec('Latest notes', notes.map(function (n) {
    return fmtStamp(n.created) + ' \u2014 ' + personName(snap, n.authorId) + ': ' + n.text;
  }), 'None');

  L.push('', 'As at ' + fmtLong(today) + '.');
  return L.join('\n');
}
