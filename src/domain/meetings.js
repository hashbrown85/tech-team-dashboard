// @ts-check
/**
 * Meeting occurrences: their composite key, ratings, and the summary you paste into
 * an email afterwards.
 *
 * See the folder rules at the top of queries.js — no DOM, no store, pure functions.
 *
 * A "meeting" record only exists once someone rates the meeting or writes a note.
 * Meeting *dates* are derived, not stored (rule 10) — there is no calendar to keep.
 *
 * Lifted from board.html: mkey/dbMeetingId/meet (547-549), ratingInfo (551-555),
 * lastScore (556-564), meetingSummary (875-897), H.setRating (1422-1428),
 * C.meetingNote (1656-1659), trendSvg's data half (1046-1047).
 */

import { byId } from '../lib/seq.js';
import { fmt, fmtDay, fmtLong, nextOn } from '../lib/dates.js';
import {
  isOpen,
  issueItems,
  personName,
  person,
  attendeeIds,
  parentText
} from './queries.js';
import { STATUS_LABELS } from './constants.js';
import { actionLabel } from './actions.js';

/**
 * @typedef {import('./queries.js').Snapshot} Snapshot
 */

/* ---------- the composite key ---------- */
/*
 * A meeting is identified by a tab plus a date, and that pair is spelled TWO ways.
 * Getting them mixed up is an easy and silent mistake, so both live here.
 */

/** The in-memory key: 'tabId|2026-09-14'. board.html:547. */
export function memoryKey(tid, d) {
  return tid + '|' + d;
}

/** The stored document id: 'tabId@2026-09-14'. board.html:548. */
export function documentId(tid, d) {
  return tid + '@' + d;
}

/**
 * Split a stored document id back into its parts.
 *
 * Splits at the FIRST '@' — a tab id can't contain one, but being explicit costs
 * nothing and a wrong split would silently file data against the wrong meeting.
 *
 * @param {string} id
 * @returns {{tab: string, date: string}}
 */
export function parseDocumentId(id) {
  const i = String(id).indexOf('@');
  return { tab: id.slice(0, i), date: id.slice(i + 1) };
}

/**
 * The meeting record for a tab and date, or an empty one.
 *
 * The original version of this wrote the empty record into local state as a side
 * effect (board.html:549), which is why it couldn't be a pure function. This just
 * returns the blank and leaves the caller's data alone.
 *
 * @param {Snapshot} snap
 * @param {string} tid
 * @param {string} d
 * @returns {{ratings: Record<string, number>, note: string}}
 */
export function getMeeting(snap, tid, d) {
  const m = snap.meetings[memoryKey(tid, d)];
  if (!m) return { ratings: {}, note: '' };
  return { ratings: m.ratings || {}, note: m.note || '' };
}

/**
 * Which meeting occurrence a tab is showing: the caller's chosen date, else the next
 * occurrence of that tab's weekday on or after today. Rule 10. board.html:546.
 *
 * @param {any} tab
 * @param {string} today
 * @param {string} [override] - the user's prev/next navigation, if any
 * @returns {string}
 */
export function meetingDate(tab, today, override) {
  return override || nextOn(today, Number(tab.weekday));
}

/* ---------- ratings ---------- */

/**
 * How many people rated a meeting, and the average.
 *
 * Only counts ratings from people who still exist — a rating left behind by someone
 * who has since been removed from the roster would otherwise drag the average.
 * board.html:551-555.
 *
 * @param {Snapshot} snap
 * @param {string} tid
 * @param {string} d
 * @returns {{n: number, avg: number | null}}
 */
export function ratingInfo(snap, tid, d) {
  const m = snap.meetings[memoryKey(tid, d)];
  const vals = [];
  if (m && m.ratings) {
    Object.keys(m.ratings).forEach(function (k) {
      if (person(snap, k)) vals.push(Number(m.ratings[k]));
    });
  }
  return {
    n: vals.length,
    avg: vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null
  };
}

/**
 * Set or clear one person's score for a meeting.
 *
 * Clicking the score someone already gave REMOVES it — the buttons toggle, so a
 * mis-click is undone by clicking the same number again. board.html:1425.
 *
 * Returns the whole meeting document, because that is how it is stored: both writers
 * replace the record rather than patching it. That's also why a rating and a note
 * saved at the same moment can clobber each other (a recorded defect).
 *
 * @param {Snapshot} snap
 * @param {string} tid
 * @param {string} d
 * @param {string} personId
 * @param {number} score - 1 to 5
 * @returns {{ratings: Record<string, number>, note: string}}
 */
export function toggleRating(snap, tid, d, personId, score) {
  const m = getMeeting(snap, tid, d);
  const ratings = Object.assign({}, m.ratings);
  if (Number(ratings[personId]) === Number(score)) delete ratings[personId];
  else ratings[personId] = Number(score);
  return { ratings: ratings, note: m.note || '' };
}

/**
 * Set the "one change for next time" note, preserving the ratings alongside it.
 * board.html:1658.
 *
 * @param {Snapshot} snap
 * @param {string} tid
 * @param {string} d
 * @param {string} note
 * @returns {{ratings: Record<string, number>, note: string}}
 */
export function setNote(snap, tid, d, note) {
  const m = getMeeting(snap, tid, d);
  return { ratings: m.ratings || {}, note: note };
}

/**
 * The most recent RATED meeting for a tab, for the overview card.
 *
 * Unrated meetings are skipped rather than counting as zero. board.html:556-564.
 *
 * @param {Snapshot} snap
 * @param {string} tid
 * @returns {{d: string, avg: number, n: number} | null}
 */
export function lastScore(snap, tid) {
  let best = null;
  Object.keys(snap.meetings).forEach(function (k) {
    const i = k.indexOf('|');
    if (k.slice(0, i) !== tid) return;
    const d = k.slice(i + 1);
    const r = ratingInfo(snap, tid, d);
    if (r.n && (!best || d > best.d)) best = { d: d, avg: r.avg, n: r.n };
  });
  return best;
}

/**
 * The last N rated meetings for a tab, oldest first — the numbers behind the
 * sparkline. Drawing it is a view's job; working out the points is not.
 *
 * board.html:1046-1047.
 *
 * @param {Snapshot} snap
 * @param {string} tid
 * @param {number} [limit]
 * @returns {{d: string, n: number, avg: number}[]}
 */
export function trendPoints(snap, tid, limit) {
  const n = limit == null ? 8 : limit;
  return Object.keys(snap.meetings)
    .filter(function (k) { return k.indexOf(tid + '|') === 0; })
    .map(function (k) { return k.slice(tid.length + 1); })
    .sort()
    .map(function (d) {
      const r = ratingInfo(snap, tid, d);
      return { d: d, n: r.n, avg: /** @type {number} */ (r.avg) };
    })
    .filter(function (x) { return x.n > 0; })
    .slice(-n);
}

/* ---------- the summary ---------- */

/**
 * The plain-text meeting summary, for pasting into an email or a chat.
 *
 * Deliberately plain text, not HTML: it has to survive being pasted anywhere.
 *
 * Sections are always in the same order so it reads the same every week. Wins,
 * opportunities, status changes and actions always appear, saying "None" when empty,
 * because an empty section is itself worth seeing. Issues and the closing note appear
 * only when there is something to say.
 *
 * Kept byte-for-byte compatible with board.html:875-897 — the bullet character, the
 * separators and the uppercase headings included. If you change the wording, you
 * change what lands in someone's inbox.
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @param {string} d - meeting date
 * @returns {string}
 */
export function meetingSummary(snap, tab, d) {
  const r = ratingInfo(snap, tab.id, d);
  const total = attendeeIds(tab).filter(function (id) { return person(snap, id); }).length;
  const mt = snap.meetings[memoryKey(tab.id, d)] || {};

  const ents = snap.entries.filter(function (e) { return e.tab === tab.id && e.meeting === d; });
  const wl = ents.filter(function (e) { return e.kind === 'win' || e.kind === 'loss'; });
  const opps = ents.filter(function (e) { return e.kind === 'opp'; });

  /** @type {string[]} */
  const L = [];
  function sec(title, lines, empty) {
    L.push('', title.toUpperCase());
    if (lines.length) lines.forEach(function (x) { L.push('• ' + x); });
    else L.push('• ' + empty);
  }

  L.push(tab.name + ' · ' + fmtLong(d));
  L.push(
    'Meeting score: ' +
      (r.n ? r.avg.toFixed(1) + ' / 5 (' + r.n + ' of ' + total + ' rated)' : 'not rated')
  );

  sec('Wins & losses', wl.map(function (e) {
    return (e.kind === 'win' ? 'Win' : 'Loss') + ' · ' + personName(snap, e.personId) + ': ' + e.text +
      (e.why ? '. Why: ' + e.why : '') +
      (e.change ? (e.kind === 'loss' ? '. Doing differently: ' : '. Keep doing: ') + e.change : '');
  }), 'None recorded');

  sec('New opportunities', opps.map(function (e) {
    const pj = e.projectId ? byId(snap.projects, e.projectId) : null;
    return personName(snap, e.personId) + ': ' + e.text +
      (e.why ? ' (challenge: ' + e.why + ')' : '') +
      (pj && pj.start ? '. Joins Current Projects ' + fmtDay(pj.start) : '');
  }), 'None');

  const chg = snap.projects
    .filter(function (x) { return x.tab === tab.id && (x.statusMeeting === d || x.added === d); })
    .map(function (x) {
      const changed = x.statusMeeting === d && x.prevStatus && x.prevStatus !== x.status;
      return x.name + ' (' + personName(snap, x.personId) + '): ' +
        (changed
          ? STATUS_LABELS[x.prevStatus] + ' → ' + STATUS_LABELS[x.status]
          : 'added, ' + STATUS_LABELS[x.status]);
    });
  const still = snap.projects
    .filter(function (x) { return x.tab === tab.id && x.status === 'off' && x.statusMeeting !== d; })
    .map(function (x) { return x.name; });
  if (still.length) chg.push('Still off track: ' + still.join(', '));
  sec('Project status changes', chg, 'No changes');

  const na = snap.actions
    .filter(function (a) { return a.tab === tab.id && a.meeting === d; })
    .sort(function (a, b) { return a.num - b.num; });
  sec('New actions', na.map(function (a) {
    const pt = parentText(snap, a);
    return actionLabel(a) + ' ' + a.text +
      ' · Owner: ' + (a.owner || 'none') +
      (a.support ? ' (with ' + a.support + ')' : '') +
      ' · Due ' + (a.due ? fmtDay(a.due) : 'no date') +
      (pt ? ' · Re: ' + pt : '') +
      (isOpen(a) ? '' : ' · DONE');
  }), 'None');

  const res = snap.issues
    .filter(function (i) {
      return i.tab === tab.id && i.status === 'resolved' && i.resolvedMeeting === d;
    })
    .map(function (i) { return 'Resolved: ' + i.text; });
  const np = issueItems(snap, tab.id);
  if (np.length) {
    res.push('Still without a path (' + np.length + '): ' +
      np.map(function (it) { return it.o.text || it.o.name; }).join('; '));
  }
  if (res.length) sec('Issues', res, '');

  if (mt.note) sec('One change for next time', [mt.note], '');

  return L.join('\n') + '\n';
}

// Re-exported for callers that are already working with meetings.
export { fmt };
