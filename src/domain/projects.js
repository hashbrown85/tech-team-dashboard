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
export function newOpportunity({
  entryId, projectId, tab, personId, text, why, meetingDate,
  customer, winPct, winReason, focus
}) {
  const startsOn = addDays(meetingDate, 7);
  const pct = winPct == null || winPct === '' || isNaN(Number(winPct))
    ? null
    : Number(winPct);

  /*
   * An opportunity is raised with the same shape a project is tracked in, because
   * it becomes one - and everything not captured in the meeting where it came up
   * tends never to be captured at all. The entry stays the record of what was SAID
   * that week; the project carries what is now known about it.
   */
  const project = {
    tab: tab,
    personId: personId,
    customer: customer || '',
    name: text,
    status: 'new',
    due: '',
    start: startsOn,
    fromOpp: entryId,
    note: why || '',
    winReason: winReason || '',
    focus: focus && focus.length ? focus.slice() : []
  };

  if (pct != null) {
    project.winPct = pct;
    // Seeded so the first revision a fortnight later makes two points, and the
    // trend line has something to draw from the beginning rather than from the
    // second time somebody happened to think about it.
    project.confidence = [{ m: meetingDate, p: pct }];
  }

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
    project: project,
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

  // The customer is part of the title now, so the line under it does not repeat it.
  L.push(projectTitle(p));
  L.push([
    personName(snap, p.personId),
    tab ? tab.name : null
  ].filter(Boolean).join(' \u00b7 '));
  L.push('Status: ' + (STATUS_LABELS[p.status] || p.status) +
    (p.due ? '  |  Due ' + fmtLong(p.due) : '  |  No due date'));

  if (p.mission) {
    L.push('', 'MISSION');
    L.push(p.mission);
  }

  // Only the dollar figure is withheld. Confidence, why-we-win and the product
  // selection are the team's and travel with the summary either way.
  if (withValue && details && details.estValue != null) {
    L.push('', 'VALUE');
    L.push('• Estimated value: $' +
      Math.round(Number(details.estValue)).toLocaleString('en-US') + ' per year');
  }

  if (p.winPct != null || p.winReason || (p.products && p.products.length)) {
    L.push('', 'COMMERCIAL');
    if (p.winPct != null) L.push('• Win confidence: ' + p.winPct + '%');
    if (p.winReason) L.push('• Why we win: ' + p.winReason);
    if (p.products && p.products.length) {
      L.push('• Product selection: ' + p.products.join(', '));
    }
    if (p.focus && p.focus.length) {
      L.push('• Focus: ' + p.focus.join(', '));
    }
    if (p.resources && p.resources.length) {
      L.push('• Resources: ' + p.resources.join(', '));
    }
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

/**
 * Order a person's projects: by priority, then by something stable.
 *
 * A project with no priority sorts last. The tiebreak matters more than it looks -
 * without it a list nobody has ordered comes back in whatever order the store
 * happened to return, which can differ between a load and the 60-second poll, and
 * rows appear to shuffle on their own.
 *
 * @param {any} a
 * @param {any} b
 */
export function byPriority(a, b) {
  const pa = a.priority == null ? 1e9 : a.priority;
  const pb = b.priority == null ? 1e9 : b.priority;
  if (pa !== pb) return pa - pb;

  const aa = String(a.added || '');
  const ab = String(b.added || '');
  if (aa !== ab) return aa < ab ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Move one project up or down its owner's list, and renumber.
 *
 * Priority is per person per meeting: two people's lists are ordered independently.
 *
 * Two things here are less obvious than they look.
 *
 * **It renumbers rather than swapping two values.** The issue queue swaps ranks,
 * which works because issues always have one. Projects start with no priority at
 * all, so a swap would exchange two absent values and do nothing - the first click
 * on a fresh board would appear broken.
 *
 * **It steps past the next VISIBLE project but renumbers the whole set.** A
 * person's list on screen is filtered by `projVisible`: a project finished last
 * week, or starting next week, is not shown. Stepping past something invisible
 * would look like nothing happened, and renumbering only the visible ones would
 * throw away the hidden ones' places. So the step is taken in the visible list and
 * written to the full one.
 *
 * @param {Snapshot} snap
 * @param {string} tabId
 * @param {string} personId
 * @param {string} projectId
 * @param {number} delta - negative to move up, positive to move down
 * @param {(p: any) => boolean} visible
 * @returns {{col: string, id: string, patch: {priority: number}}[] | null}
 */
export function reorderProjects(snap, tabId, personId, projectId, delta, visible) {
  const all = snap.projects
    .filter(function (p) { return p.tab === tabId && p.personId === personId; })
    .sort(byPriority);

  const shown = all.filter(visible);
  let at = -1;
  shown.forEach(function (p, i) { if (p.id === projectId) at = i; });
  if (at < 0) return null;

  const neighbour = shown[at + (delta < 0 ? -1 : 1)];
  if (!neighbour) return null;           // already at the end it is moving toward

  let from = -1;
  all.forEach(function (p, i) { if (p.id === projectId) from = i; });
  const moving = all[from];

  const moved = all.slice();
  moved.splice(from, 1);

  let to = -1;
  moved.forEach(function (p, i) { if (p.id === neighbour.id) to = i; });
  moved.splice(delta < 0 ? to : to + 1, 0, moving);

  /** @type {any[]} */
  const writes = [];
  moved.forEach(function (p, i) {
    if (p.priority !== i) {
      writes.push({ col: 'projects', id: p.id, patch: { priority: i } });
    }
  });
  return writes.length ? writes : null;
}

/**
 * What a project is called: the customer and the name, joined by a hyphen.
 *
 * "Meridian Coatings - Coating additive trial". Both halves are free text and both
 * are editable on the project page, because a project is often entered mid-meeting
 * against the wrong customer or with a placeholder name, and the correction has to
 * be possible later.
 *
 * Internal work has no customer, so it is just the name rather than a title with a
 * dangling hyphen. A project with neither is still given something to render, since
 * a blank heading is impossible to click on or talk about.
 *
 * Renaming needs no cascade: actions point at a project by id. That is the
 * difference between this and renaming a person, which has to rewrite every action
 * they own because those store a NAME. See the personName handler.
 *
 * @param {any} p
 * @returns {string}
 */
export function projectTitle(p) {
  if (!p) return 'Project';
  const customer = String(p.customer || '').trim();
  const name = String(p.name || '').trim();
  if (customer && name) return customer + ' - ' + name;
  return name || customer || 'Untitled project';
}

/**
 * Set win confidence, and remember what it was.
 *
 * "Was this 30% in June and 80% now, or the other way round?" is the question the
 * number alone cannot answer, and the one that tells you whether the work is going
 * anywhere. So every value it holds is kept, and the project page and tile draw the
 * line through them.
 *
 * Three rules keep the history honest rather than merely long:
 *
 * - A point is stamped with the **meeting date**, not today, like everything else
 *   on this board. A number revised while reviewing last week belongs to last week.
 * - **One point per meeting.** Editing twice in the same meeting replaces the
 *   point instead of adding another, which is also what makes this survive a field
 *   that writes on every keystroke: typing "6" then "65" leaves 65, not both.
 * - **No point when the value did not change.** Re-saving the same number is not a
 *   week of progress.
 *
 * Clearing the field sets it back to nothing but does NOT erase the history: the
 * number was believed for a while, and that happened.
 *
 * @param {any} project
 * @param {number | null} pct
 * @param {string} meetingDate
 * @returns {any} the patch to write
 */
export function recordConfidence(project, pct, meetingDate) {
  const value = pct == null || pct === '' || isNaN(Number(pct)) ? null : Number(pct);
  /** @type {any} */
  const patch = { winPct: value };
  if (value == null || !meetingDate) return patch;

  const history = ((project && project.confidence) || []).slice();

  let at = -1;
  history.forEach(function (h, i) { if (h && h.m === meetingDate) at = i; });

  if (at >= 0) {
    if (Number(history[at].p) === value) return patch;
    history[at] = { m: meetingDate, p: value };
  } else {
    const last = history[history.length - 1];
    if (last && Number(last.p) === value) return patch;
    history.push({ m: meetingDate, p: value });
  }

  patch.confidence = history;
  return patch;
}

/**
 * The confidence history as trend points, oldest first.
 *
 * Sorted by date rather than trusted in stored order, because a number can be
 * corrected against an earlier meeting and would otherwise draw a line that goes
 * backwards. Malformed rows are dropped rather than plotted as NaN.
 *
 * @param {any} project
 * @returns {{d: string, v: number}[]}
 */
export function confidencePoints(project) {
  return (((project && project.confidence) || [])
    .filter(function (h) {
      // The date shape is checked, not just its presence. This history is a JSON
      // column somebody can edit by hand in SharePoint, and fmt() of an unparseable
      // date renders the literal text "undefined NaN" onto the page.
      return h && typeof h.m === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.m) &&
        h.p != null && !isNaN(Number(h.p));
    })
    .slice()
    .sort(function (a, b) { return a.m < b.m ? -1 : a.m > b.m ? 1 : 0; })
    .map(function (h) { return { d: String(h.m), v: Number(h.p) }; }));
}


/* ------------------------------------------------------- sorting and searching */

/**
 * The columns the Projects table can be sorted by, and which way each goes first.
 *
 * The rule is: **numbers descending, dates ascending.** Nobody opens a money column
 * to find the smallest figure, and nobody opens a date column to find the one
 * furthest away. Due also sorts the way the default order already does, so clicking
 * it only removes the off-track-first grouping rather than jerking the list about.
 *
 * This lives in the domain rather than the view because the click handler and the
 * header markup both need it, and handlers never import from views/.
 */
export const SORT_COLUMNS = {
  value: { first: 'desc', label: 'Value', desc: 'highest first', asc: 'lowest first' },
  win: { first: 'desc', label: 'Win %', desc: 'highest first', asc: 'lowest first' },
  due: { first: 'asc', label: 'Due', desc: 'latest first', asc: 'soonest first' }
};

/**
 * Which way a column sorts on the first click.
 *
 * @param {string} col
 * @returns {string} 'asc' | 'desc'
 */
export function firstDirFor(col) {
  return SORT_COLUMNS[col] ? SORT_COLUMNS[col].first : 'desc';
}

/**
 * The last resort when every other comparison ties: title, then id.
 *
 * Extracted so the default order and every sorted order end the same way. It is
 * never reversed, whatever direction is in force - see projectSorter.
 *
 * @param {any} a
 * @param {any} b
 */
export function byTitleThenId(a, b) {
  const ta = projectTitle(a).toLowerCase();
  const tb = projectTitle(b).toLowerCase();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * What a project sorts by for one column, or null when it has no value at all.
 *
 * `NaN` is folded into null on purpose. A hand-edited SharePoint cell reading "TBC"
 * would otherwise produce a NaN key, and every comparison against NaN is false,
 * which makes the comparator non-transitive and the order genuinely arbitrary
 * rather than merely odd.
 *
 * Dates compare as text, as they do everywhere else here - see the note in
 * sharepointSchema.js on why they are stored that way.
 *
 * @param {Snapshot} snap
 * @param {string} col
 * @param {any} p
 * @returns {number | string | null}
 */
export function sortKey(snap, col, p) {
  if (col === 'value') {
    // The money lives in its own collection, which may be empty by permission.
    const d = byId(snap.projectDetails, p.id);
    const n = d && d.estValue != null ? Number(d.estValue) : NaN;
    return isFinite(n) ? n : null;
  }
  if (col === 'win') {
    const n = p.winPct == null ? NaN : Number(p.winPct);
    return isFinite(n) ? n : null;
  }
  if (col === 'due') return p.due || null;
  return null;
}

/**
 * Sort by one column, in one direction.
 *
 * **A project with no value sorts last, in BOTH directions.** Direction applies only
 * among those that have one. No estValue means nobody has priced it and no winPct
 * means nobody has judged it; sorting those as zero asserts the project is worth
 * nothing and certain to be lost, which the data does not say.
 *
 * It is the existing "undated sorts last" rule generalised. That rule exists because
 * an empty string compares below every real date as text, so the obvious comparison
 * buried everything with a deadline under everything without one. Ascending Win %
 * would do exactly the same with every unjudged project.
 *
 * The comparator is **total**: every pair either differs on the key or is settled by
 * byTitleThenId. That matters more than Array.sort being stable, because stability
 * only preserves the INPUT order, and the input is rebuilt by the adapter on every
 * 60-second poll.
 *
 * @param {Snapshot} snap
 * @param {string} col
 * @param {string} dir - 'asc' | 'desc'
 * @returns {(a: any, b: any) => number}
 */
export function projectSorter(snap, col, dir) {
  const flip = dir === 'desc' ? -1 : 1;

  return function (a, b) {
    const ka = sortKey(snap, col, a);
    const kb = sortKey(snap, col, b);

    if (ka == null || kb == null) {
      if (ka != null) return -1;        // having a value beats not having one,
      if (kb != null) return 1;         // whichever way the column is pointing
    } else if (ka !== kb) {
      return (ka < kb ? -1 : 1) * flip;
    }

    // Never flipped: reversing the tiebreak would shuffle a block of unpriced
    // projects alphabetically between one direction and the other, for no reason.
    return byTitleThenId(a, b);
  };
}

/**
 * Does this project match what somebody typed into the search box?
 *
 * Searches customer, name, field, project type and the owner's name. Several terms
 * are ANDed across the whole haystack rather than per field, so "meridian coating"
 * finds the project whose CUSTOMER is Meridian Coatings and whose NAME is Coating
 * additive trial - which is what a search box is expected to do.
 *
 * Mission, focus and products are deliberately not searched. Widening this later is
 * easy; narrowing it once people rely on it is not.
 *
 * @param {Snapshot} snap
 * @param {any} p
 * @param {string} query
 * @returns {boolean}
 */
export function matchesQuery(snap, p, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return true;

  const hay = [p.customer, p.name, p.field, p.projectType, personName(snap, p.personId)]
    .filter(Boolean)
    .join(' \u0001 ')                  // a separator no typed term can contain
    .toLowerCase();

  return q.split(/\s+/).every(function (term) { return hay.indexOf(term) >= 0; });
}

/**
 * Does this project match one of the free-text dropdown filters?
 *
 * Compared case- and whitespace-insensitively. With free text that is not a nicety:
 * it is the difference between a working filter and one that hides rows for no
 * visible reason because somebody typed "coatings" and somebody else "Coatings".
 *
 * @param {any} p
 * @param {string} key - 'field' | 'projectType'
 * @param {string} want - a lower-cased value, or 'all'
 * @returns {boolean}
 */
export function matchesValue(p, key, want) {
  if (want === 'all') return true;
  return String(p[key] == null ? '' : p[key]).trim().toLowerCase() === want;
}

/**
 * The values actually in use for a free-text field, for building a filter dropdown.
 *
 * Grouped case-insensitively, so "Coatings" and "coatings" are one option rather
 * than two that each hide most of the rows. The first spelling seen becomes the
 * label; the value is the lower-cased key, which is what matchesValue compares.
 *
 * The count rides along for the label. Two filters that can combine to show nothing
 * need to say how many each option would bring, rather than being designed around.
 *
 * @param {any[]} projects
 * @param {string} key
 * @returns {{value: string, label: string, n: number}[]}
 */
export function distinctValues(projects, key) {
  /** @type {Record<string, {value: string, label: string, n: number}>} */
  const seen = {};

  (projects || []).forEach(function (p) {
    // `field` and `projectType` hold a single string; `focus` and `resources` hold
    // an array. Both shapes come through here now that the settings screen counts
    // usages for all four.
    const held = Array.isArray(p[key]) ? p[key] : [p[key]];

    held.forEach(function (one) {
      const raw = String(one == null ? '' : one).trim();
      if (!raw) return;                // blank is not a value to filter by
      const lower = raw.toLowerCase();
      if (!seen[lower]) seen[lower] = { value: lower, label: raw, n: 0 };
      seen[lower].n++;
    });
  });

  return Object.keys(seen)
    .map(function (k) { return seen[k]; })
    .sort(function (a, b) {
      const la = a.label.toLowerCase();
      const lb = b.label.toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
}


/* ------------------------------------------------- the lists projects pick from */

/**
 * The value lists that can be renamed, and how a project stores them.
 *
 * `multi` is the whole reason this constant exists: `field` and `projectType` hold a
 * single string on a project, while `focus` and `resources` hold an array. A rename
 * has to handle both, and the array case has to de-duplicate when two values merge.
 *
 * **Products is deliberately absent.** That list is coming from Dataverse; renaming a
 * value here would edit a copy of something this app does not own, and the change
 * would be undone the moment the real list is connected.
 */
export const RENAMEABLE_LISTS = {
  field: { label: 'Field', multi: false },
  projectType: { label: 'Project type', multi: false },
  focus: { label: 'Focus', multi: true },
  resources: { label: 'Potential resource', multi: true }
};

/**
 * The key two values are considered the same by.
 *
 * Deliberately identical to what `matchesValue` and `distinctValues` compare on, so a
 * canonicalised value is always findable by the Projects-table filter. Collapsing
 * inner whitespace would be an improvement in isolation and is declined for exactly
 * that reason - the keys must not drift apart. The cost is a double space surviving.
 *
 * @param {any} v
 * @returns {string}
 */
export function valueKey(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

/**
 * Settle what somebody typed against the curated list.
 *
 * This is what makes a self-growing list survivable. Typing "coatings" when the list
 * already holds "Coatings" must use the list's spelling and must NOT add a second
 * entry - otherwise the list fragments into case variants of itself, and each one
 * hides most of the rows behind the filter.
 *
 * @param {string[]} items - the curated list, in its stored spelling
 * @param {string} raw - what was typed
 * @returns {{value: string, add: string | null}} the value to store, and the value to
 *   append to the list, or null when there is nothing to add
 */
export function canonicalValue(items, raw) {
  const v = String(raw == null ? '' : raw).trim();

  // Clearing the field is a real thing to do, and it never grows the list.
  if (!v) return { value: '', add: null };

  const key = valueKey(v);
  const found = (items || []).filter(function (x) { return valueKey(x) === key; })[0];

  if (found != null) return { value: String(found), add: null };
  return { value: v, add: v };
}

/**
 * How many projects use one value of a list.
 *
 * Shown on the chip in People & settings, where it is what makes a typo visible: a
 * slip reads 1 beside a real category's 14.
 *
 * @param {Snapshot} snap
 * @param {string} key
 * @param {string} value
 * @returns {number}
 */
export function countUsing(snap, key, value) {
  const want = valueKey(value);
  return (snap.projects || []).filter(function (p) {
    return holdsValue(p, key, want);
  }).length;
}

/**
 * Does this project hold a value for one of the lists? Copes with both shapes.
 *
 * @param {any} p
 * @param {string} key
 * @param {string} want - an already-keyed value
 */
function holdsValue(p, key, want) {
  const held = p[key];
  if (Array.isArray(held)) {
    return held.some(function (x) { return valueKey(x) === want; });
  }
  return valueKey(held) === want;
}

/**
 * Suggestions for a free-text list field: the curated list, plus whatever is already
 * in use.
 *
 * Neither source alone is enough. The curated list alone loses every value typed
 * before it existed, so a project holding one would not offer it and the next person
 * retypes it - the exact fragmentation the suggestions exist to prevent. Values in use
 * alone means an entry added on the settings screen and not yet used is never offered,
 * which makes that screen decorative.
 *
 * The curated spelling wins where both have one: the list is the authority on how a
 * value is written. With canonicalValue in play the two converge, and the union's
 * lasting job is the legacy tail and anyone who cannot write the settings list.
 *
 * @param {any[]} projects
 * @param {string[]} items
 * @param {string} key
 * @returns {{value: string, label: string, n: number}[]}
 */
export function valueOptions(projects, items, key) {
  /** @type {Record<string, {value: string, label: string, n: number}>} */
  const seen = {};

  (items || []).forEach(function (raw) {
    const k = valueKey(raw);
    if (!k) return;
    seen[k] = { value: k, label: String(raw).trim(), n: 0 };
  });

  distinctValues(projects, key).forEach(function (o) {
    if (seen[o.value]) seen[o.value].n = o.n;          // keep the curated spelling
    else seen[o.value] = o;
  });

  return Object.keys(seen)
    .map(function (k) { return seen[k]; })
    .sort(function (a, b) {
      const la = a.label.toLowerCase();
      const lb = b.label.toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
}
