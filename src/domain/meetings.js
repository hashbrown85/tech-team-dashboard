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
import { fmt, fmtDay, fmtLong, nextOn, addDays } from '../lib/dates.js';
import {
  isOpen,
  issueItems,
  personName,
  person,
  attendeeIds,
  parentText,
  isOpportunity,
  oppStage,
  raisedOn
} from './queries.js';

import { STATUS_LABELS, SEVERITY_LABELS } from './constants.js';
import { actionLabel } from './actions.js';
import { projectTitle } from './projects.js';

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

/** The three attendance lists, in the order they are shown. */
export const ROLE_LISTS = ['members', 'support', 'optional'];

/**
 * The patch that puts a person in one role on a meeting, and in no other.
 *
 * Strips them from all three lists, then adds them to the one asked for - or to
 * none, for 'none'. The lists are meant to be exclusive and nothing else enforces
 * it, so this is the one place a role is set: meeting settings uses it, and so does
 * the add-person form. Two copies of this rule is how somebody ends up Reporting
 * and Optional at once.
 *
 * @param {any} tab
 * @param {string} personId
 * @param {string} role - 'members' | 'support' | 'optional' | 'none'
 * @returns {{members: string[], support: string[], optional: string[]}}
 */
export function withRole(tab, personId, role) {
  /** @type {any} */
  const patch = {};
  ROLE_LISTS.forEach(function (r) {
    const without = ((tab && tab[r]) || []).filter(function (x) { return x !== personId; });
    patch[r] = r === role ? without.concat([personId]) : without;
  });
  return patch;
}

/**
 * The meeting after `date` - what "push it to next time" means.
 *
 * From the meeting being looked at rather than from today, so pushing behaves the
 * same whether you opened this week's meeting or last week's. `nextOn` returns its
 * own argument when that day already IS the meeting weekday, so step past it first
 * or pushing from a meeting day would set the date to that same day.
 *
 * @param {any} tab
 * @param {string} date - 'YYYY-MM-DD', the meeting being viewed
 * @returns {string}
 */
export function nextMeetingAfter(tab, date) {
  return nextOn(addDays(date, 1), Number(tab.weekday));
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

/** How a decided opportunity reads in the summary. */
const OPP_SUMMARY = {
  promoted: 'Promoted to project',
  hold: 'Put on hold',
  cancelled: 'Cancelled'
};

/**
 * The plain-text meeting summary, written to be emailed to the people in it.
 *
 * Plain text, not HTML: it has to survive being pasted into anything.
 *
 * Four sections, always in this order, so it reads the same every week:
 *
 *   WHAT CHANGED     decisions on opportunities, and project status changes
 *   NEW THIS MEETING wins and losses, opportunities, projects, issues, actions
 *   DONE             actions finished this week, issues resolved
 *   NEEDS ATTENTION  off track, without a path, overdue
 *
 * A section with nothing in it is left out, so a quiet week is short. If the
 * first three are all empty it says so in one line rather than looking broken.
 *
 * "This meeting" is the meeting date `d`: things decided, raised or changed at
 * it. "Done" is the week up to and including it. "Overdue" is as of `today`,
 * because that is when it is being read.
 *
 * Projects are named the way every screen names them - customer, then project -
 * so a name in the email matches what people see on the board.
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @param {string} d - meeting date
 * @param {string} [today] - for what is overdue; defaults to the meeting date
 * @returns {string}
 */
export function meetingSummary(snap, tab, d, today) {
  const now = today || d;
  const r = ratingInfo(snap, tab.id, d);
  const total = attendeeIds(tab).filter(function (id) { return person(snap, id); }).length;
  const mt = snap.meetings[memoryKey(tab.id, d)] || {};
  const here = function (x) { return x && x.tab === tab.id; };
  const who = function (id) { return personName(snap, id); };

  /** @type {string[]} */
  const L = [];
  function sec(title, lines) {
    if (!lines.length) return;
    L.push('', title.toUpperCase());
    lines.forEach(function (x) { L.push('• ' + x); });
  }

  L.push(tab.name + ' · ' + fmtLong(d));
  if (r.n) L.push('Meeting score: ' + r.avg.toFixed(1) + ' / 5 (' + r.n + ' of ' + total + ' rated)');

  /* What changed: decisions, then status changes. */
  const decided = snap.projects.filter(function (p) {
    return here(p) && p.oppDecided === d && OPP_SUMMARY[oppStage(p)];
  }).map(function (p) {
    return OPP_SUMMARY[oppStage(p)] + ': ' + projectTitle(p) + ' (' + who(p.personId) + ')';
  });
  const moved = snap.projects.filter(function (p) {
    return here(p) && !isOpportunity(p) && p.statusMeeting === d &&
      p.prevStatus && p.prevStatus !== p.status;
  }).map(function (p) {
    return projectTitle(p) + ' (' + who(p.personId) + '): ' +
      STATUS_LABELS[p.prevStatus] + ' → ' + STATUS_LABELS[p.status];
  });
  const changed = decided.concat(moved);

  /* New this meeting. */
  const ents = snap.entries.filter(function (e) { return here(e) && e.meeting === d; });
  const fresh = [];
  ents.filter(function (e) { return e.kind === 'win' || e.kind === 'loss'; }).forEach(function (e) {
    fresh.push((e.kind === 'win' ? 'Win' : 'Loss') + ' · ' + who(e.personId) + ': ' + e.text +
      (e.why ? '. Why: ' + e.why : '') +
      (e.change ? (e.kind === 'loss' ? '. Doing differently: ' : '. Keep doing: ') + e.change : ''));
  });
  ents.filter(function (e) { return e.kind === 'opp'; }).forEach(function (e) {
    const pj = e.projectId ? byId(snap.projects, e.projectId) : null;
    // The project record holds the customer and the challenge as they stand now.
    const challenge = pj && pj.note != null ? pj.note : e.why;
    fresh.push('Opportunity · ' + who(e.personId) + ': ' + (pj ? projectTitle(pj) : e.text) +
      (challenge ? '. Challenge: ' + challenge : ''));
  });
  snap.projects.filter(function (p) {
    return here(p) && !p.fromOpp && p.added === d;
  }).forEach(function (p) {
    fresh.push('Project · ' + who(p.personId) + ': ' + projectTitle(p));
  });
  snap.issues.filter(function (i) { return here(i) && i.meeting === d; }).forEach(function (i) {
    fresh.push('Issue · ' + who(i.personId) + ': ' + i.text +
      (SEVERITY_LABELS[i.sev] ? ' (' + SEVERITY_LABELS[i.sev] + ')' : ''));
  });
  const newActs = snap.actions
    .filter(function (a) { return here(a) && a.meeting === d; })
    .sort(function (a, b) { return a.num - b.num; });
  newActs.forEach(function (a) {
    const pt = parentText(snap, a);
    fresh.push(actionLabel(a) + ' ' + a.text +
      ' · Owner: ' + (a.owner || 'none') +
      (a.support ? ' (with ' + a.support + ')' : '') +
      ' · Due ' + (a.due ? fmtDay(a.due) : 'no date') +
      (pt ? ' · Re: ' + pt : '') +
      (isOpen(a) ? '' : ' · DONE'));
  });

  /* Done in the week up to the meeting. A new action already marked DONE above
     is not listed twice. */
  const weekStart = addDays(d, -7);
  const done = snap.actions.filter(function (a) {
    return here(a) && !isOpen(a) && a.doneOn && a.doneOn > weekStart && a.doneOn <= d &&
      a.meeting !== d;
  }).sort(function (a, b) { return a.num - b.num; }).map(function (a) {
    return actionLabel(a) + ' ' + a.text + ' (' + (a.owner || 'no owner') + ')';
  }).concat(snap.issues.filter(function (i) {
    return here(i) && i.status === 'resolved' && i.resolvedMeeting === d;
  }).map(function (i) { return 'Issue resolved: ' + i.text; }));

  /* Needs attention. */
  const attention = [];
  const still = snap.projects.filter(function (p) {
    return here(p) && !isOpportunity(p) && p.status === 'off' && p.statusMeeting !== d;
  }).map(projectTitle);
  if (still.length) attention.push('Still off track: ' + still.join(', '));
  const np = issueItems(snap, tab.id);
  if (np.length) {
    attention.push('Without a path (' + np.length + '): ' +
      np.map(function (it) { return it.o.text || projectTitle(it.o); }).join('; '));
  }
  snap.actions.filter(function (a) {
    return here(a) && isOpen(a) && a.due && a.due < now;
  }).sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : a.num - b.num; })
    .forEach(function (a) {
      attention.push('Overdue: ' + actionLabel(a) + ' ' + a.text + ' (' + (a.owner || 'no owner') +
        ', due ' + fmtDay(a.due) + ')');
    });

  sec('What changed', changed);
  sec('New this meeting', fresh);
  sec('Done', done);
  if (!changed.length && !fresh.length && !done.length) {
    L.push('', 'Nothing new recorded at this meeting.');
  }
  sec('Needs attention', attention);
  if (mt.note) sec('One change for next time', [mt.note]);

  return L.join('\n') + '\n';
}

/**
 * Who a meeting's summary goes to: everybody in it, in any role, who has a work
 * email - and who was left off for not having one, so it can be said rather than
 * discovered when somebody asks why they never got it.
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @returns {{to: string[], missing: string[]}}
 */
export function summaryRecipients(snap, tab) {
  const to = [];
  const missing = [];
  attendeeIds(tab).forEach(function (id) {
    const p = person(snap, id);
    if (!p) return;
    const upn = String(p.upn || '').trim();
    if (upn) { if (to.indexOf(upn) < 0) to.push(upn); } else missing.push(p.name);
  });
  return { to: to, missing: missing };
}

/**
 * The longest mailto link handed to the mail app with the body in it. Windows
 * passes a link to Outlook through a call that cuts it off at about 2,000
 * characters - so a long summary would arrive chopped mid-sentence, with nothing
 * to say so. Over this, the body is left out and the summary is pasted instead.
 */
export const MAILTO_LIMIT = 1900;

/** An address simple enough to put in a mailto link unencoded. */
const PLAIN_ADDRESS = /^[^\s@,;?&]+@[^\s@,;?&]+$/;

/**
 * Everything the Email button needs: who, subject, body, and the mailto link.
 *
 * `bodyIncluded` is false when the summary is too long for the link (see
 * MAILTO_LIMIT); the link then carries a line asking for it to be pasted, and the
 * caller copies it to the clipboard either way.
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @param {string} d
 * @param {string} [today]
 */
export function summaryEmail(snap, tab, d, today) {
  const rec = summaryRecipients(snap, tab);
  const to = rec.to.filter(function (a) { return PLAIN_ADDRESS.test(a); });
  const subject = tab.name + ' meeting summary, ' + fmtLong(d);
  const body = meetingSummary(snap, tab, d, today);
  const head = 'mailto:' + to.join(',') + '?subject=' + encodeURIComponent(subject);
  // CRLF: Outlook shows bare newlines in a mailto body as one long line.
  const full = head + '&body=' + encodeURIComponent(body.replace(/\n/g, '\r\n'));
  const fits = full.length <= MAILTO_LIMIT;
  return {
    to: to,
    missing: rec.missing,
    subject: subject,
    body: body,
    bodyIncluded: fits,
    href: fits ? full
      : head + '&body=' + encodeURIComponent('(Paste the summary here: it is on your clipboard.)')
  };
}

// Re-exported for callers that are already working with meetings.
export { fmt };
