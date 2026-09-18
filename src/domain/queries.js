// @ts-check
/**
 * Pure read-only questions about the board's data.
 *
 * RULES FOR THIS FOLDER (src/domain/):
 *   - No DOM. Never touch document, window, or the page.
 *   - No imports from ../views/ or ../data/.
 *   - Every function takes the data it needs as an argument and returns a value.
 *
 * Why: these are the functions that encode the board's actual rules, so they need
 * to be testable without a browser, a database, or a meeting in progress. See
 * docs/BUSINESS_RULES.md for what the rules mean and why they are the way they are.
 *
 * These were lifted from board.html (the original single-file app) with one change:
 * the original read a module-level `state` variable directly, and these take a
 * `snap` argument instead. Behaviour is otherwise identical, deliberately — if you
 * spot something here that looks wrong, check BUSINESS_RULES.md before changing it.
 * At least one oddity is intentional.
 *
 * @typedef {object} Snapshot
 * @property {any[]} people
 * @property {any[]} tabs
 * @property {any[]} entries
 * @property {any[]} projects
 * @property {any[]} issues
 * @property {any[]} actions
 * @property {Record<string, any>} meetings
 * @property {Record<string, any>} settings
 */

import { byId } from '../lib/seq.js';

/**
 * Did the restricted project-details collection actually arrive?
 *
 * This is the gate for anything showing estimated value, confidence or why-we-win.
 *
 * It must NOT be `Array.isArray(snap.projectDetails)`. A person refused that list
 * gets an empty array plus a note in `snap.denied`, so the array is always present
 * and that test always passes - which is how the panel came to be drawn for
 * everybody. Asking `denied` is the difference between a panel that is absent
 * because nothing was sent and one the browser merely chose not to draw.
 *
 * @param {Snapshot} snap
 * @returns {boolean}
 */
export function detailsArrived(snap) {
  return (snap.denied || []).indexOf('projectDetails') < 0;
}

/**
 * A person by id, or null.
 *
 * @param {Snapshot} snap
 * @param {string} [id]
 * @returns {any | null}
 */
export function person(snap, id) {
  return byId(snap.people, id);
}

/**
 * A person's name for display, or 'Unassigned' when the id points at nobody.
 *
 * The fallback matters: people get deleted while their work lives on, so this is
 * reached in normal use, not just in error cases. board.html:533.
 *
 * @param {Snapshot} snap
 * @param {string} [id]
 * @returns {string}
 */
export function personName(snap, id) {
  const p = person(snap, id);
  return p ? p.name : 'Unassigned';
}

/**
 * Everyone invited to a meeting, in role order: reporting, supporting, optional.
 *
 * Note this can include ids of people who have since been deleted — callers that
 * need real people filter with `person()`. board.html:550.
 *
 * @param {any} tab
 * @returns {string[]}
 */
export function attendeeIds(tab) {
  return (tab.members || []).concat(tab.support || [], tab.optional || []);
}

/**
 * What an action is about, in words — the issue text, or the project name with
 * "(project)" after it so the two are distinguishable in a flat list.
 *
 * An action whose parent has been deleted reads as empty rather than broken.
 * board.html:575-579.
 *
 * @param {Snapshot} snap
 * @param {any} action
 * @returns {string}
 */
export function parentText(snap, action) {
  if (!action.parent) return '';
  if (action.parent.type === 'issue') {
    const i = byId(snap.issues, action.parent.id);
    return i ? i.text : '';
  }
  const p = byId(snap.projects, action.parent.id);
  return p ? p.name + ' (project)' : '';
}

/**
 * What an action came from, resolved to the record itself.
 *
 * Returns the RECORD rather than a formatted label on purpose. A project's display
 * name is `projectTitle` (customer and name together), which lives in
 * domain/projects.js - and projects.js already imports from this file, so importing
 * it back would be a cycle. The caller formats; this only answers "which one".
 *
 * `parentText` beside this stays as it is: it builds a one-line plain-text label for
 * the meeting summary, where "(project)" disambiguates in a way a table column does
 * not need.
 *
 * @param {Snapshot} snap
 * @param {any} action
 * @returns {{type: string, id: string, issue: any, project: any} | null}
 */
export function parentRef(snap, action) {
  const p = action && action.parent;
  if (!p || !p.id) return null;
  if (p.type === 'issue') {
    const i = byId(snap.issues, p.id);
    return i ? { type: 'issue', id: p.id, issue: i, project: null } : null;
  }
  const pj = byId(snap.projects, p.id);
  return pj ? { type: 'project', id: p.id, issue: null, project: pj } : null;
}

/**
 * Does this action match what somebody typed into the search box?
 *
 * Multi-term AND over one joined haystack, so "psi rig" finds the action owned by
 * Psi Redding about rig time. The separator keeps a term from matching across the
 * join between two fields. No regex is built from user input.
 *
 * Searches the text, the owner, the support person and the ORIGIN - the issue or
 * project it came from - because that is the column people scan a long list by.
 *
 * @param {Snapshot} snap
 * @param {any} a
 * @param {string} query
 * @returns {boolean}
 */
export function matchesActionQuery(snap, a, query) {
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;

  const ref = parentRef(snap, a);
  const hay = [
    a.text || '',
    a.owner || '',
    a.support || '',
    ref ? (ref.type === 'issue' ? ref.issue.text : ref.project.name) : ''
  ].join('\u0001').toLowerCase();

  return terms.every(function (t) { return hay.indexOf(t) >= 0; });
}

/**
 * Is this action still outstanding?
 *
 * Note: anything that isn't the exact string 'done' counts as open, including an
 * action with no status at all. That's intentional — a half-written record should
 * show up as work to do, not silently vanish.
 *
 * @param {{status?: string}} a
 * @returns {boolean}
 */
export function isOpen(a) {
  return a.status !== 'done';
}

/**
 * How many open actions point at this issue or project?
 *
 * This single count is what decides whether something "has a path" — see rule 1 in
 * docs/BUSINESS_RULES.md. There is no flag on the issue itself.
 *
 * @param {Snapshot} snap
 * @param {string} id - an issue id or a project id
 * @param {string} [excludeActionId] - ignore this action (used when toggling one)
 * @returns {number}
 */
export function openActsFor(snap, id, excludeActionId) {
  return snap.actions.filter(function (a) {
    return a.parent && a.parent.id === id && a.id !== excludeActionId && isOpen(a);
  }).length;
}

/**
 * Every action attached to this issue or project, open ones first, then by due date.
 *
 * @param {Snapshot} snap
 * @param {string} id
 * @returns {any[]}
 */
export function actsOf(snap, id) {
  return snap.actions
    .filter(function (a) { return a.parent && a.parent.id === id; })
    .sort(actionHistoryOrder);
}

/**
 * One project's actions, as a conversation: what is outstanding, then what was
 * most recently finished.
 *
 * Open first, soonest deadline at the top. Then closed, MOST RECENTLY FINISHED
 * FIRST - so the last thing accomplished sits directly under the open block,
 * where the eye already is. Reading down goes backwards in time.
 *
 * The closed half used to sort by DUE date, which says nothing about a finished
 * thing: it put whatever happened to have the earliest deadline at the top, which
 * is usually the oldest win. "What did we just get done" was at the bottom of a
 * twenty-row list, or off the end of the 340px rail entirely.
 *
 * Absent sorts last within each half - an open action with no date has had no
 * commitment made, and a closed one with no `doneOn` cannot be placed in time.
 *
 * Total, and the tiebreak is never flipped by the block it is in. The previous
 * comparator returned 1 for ties, which is not transitive, so it leaned on
 * Array.sort being stable over an array the adapter rebuilds every 60 seconds -
 * stability preserves the INPUT order, and the input is not stable.
 *
 * @param {any} a
 * @param {any} b
 */
export function actionHistoryOrder(a, b) {
  const ao = isOpen(a);
  if (ao !== isOpen(b)) return ao ? -1 : 1;

  if (ao) {
    const da = a.due || '';
    const db = b.due || '';
    if (!da !== !db) return da ? -1 : 1;
    if (da !== db) return da < db ? -1 : 1;
    return byActionNum(a, b, 1);
  }

  const ca = a.doneOn || '';
  const cb = b.doneOn || '';
  if (!ca !== !cb) return ca ? -1 : 1;
  if (ca !== cb) return ca > cb ? -1 : 1;
  // Newest number first among same-day completions, matching the block it is in.
  return byActionNum(a, b, -1);
}

/** A total last resort. Written here rather than imported: domain/actions.js
 *  already imports from this file, so the other direction would be a cycle. */
function byActionNum(a, b, dir) {
  const na = typeof a.num === 'number' && !isNaN(a.num) ? a.num : 0;
  const nb = typeof b.num === 'number' && !isNaN(b.num) ? b.num : 0;
  if (na !== nb) return (na < nb ? -1 : 1) * dir;
  return String(a.id) < String(b.id) ? -1 : 1;
}

/**
 * The Issues queue: things with no path yet, in the order to work through them.
 *
 * Two kinds of thing land here — open issues, and off-track projects (which get a
 * synthetic severity of 'offtrack'; no issue record ever actually stores that value).
 * Both are excluded the moment an open action points at them.
 *
 * Sort order: rank ascending (no rank sorts last), then show-stoppers first, then
 * oldest meeting first.
 *
 * @param {Snapshot} snap
 * @param {string} tid - tab id
 * @returns {{type: 'i'|'p', o: any, sev: string}[]}
 */
export function issueItems(snap, tid) {
  var items = snap.issues
    .filter(function (i) {
      return i.tab === tid && i.status === 'open' && !openActsFor(snap, i.id);
    })
    .map(function (i) { return { type: /** @type {'i'} */ ('i'), o: i, sev: i.sev }; })
    .concat(
      snap.projects
        .filter(function (p) {
          return p.tab === tid && p.status === 'off' && !openActsFor(snap, p.id);
        })
        .map(function (p) { return { type: /** @type {'p'} */ ('p'), o: p, sev: 'offtrack' }; })
    );

  items.sort(function (a, b) {
    var ra = a.o.rank == null ? 1e9 : a.o.rank;
    var rb = b.o.rank == null ? 1e9 : b.o.rank;
    if (ra !== rb) return ra - rb;
    var sa = a.sev === 'stopper' ? 0 : 1;
    var sb = b.sev === 'stopper' ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return (a.o.meeting || '') < (b.o.meeting || '') ? -1 : 1;
  });

  return items;
}

/**
 * The mirror image of issueItems: open issues and off-track projects that DO have
 * an open action. These render as "moved — now tracked as actions".
 *
 * @param {Snapshot} snap
 * @param {string} tid - tab id
 * @returns {{type: 'i'|'p', o: any, sev: string}[]}
 */
export function actionedItems(snap, tid) {
  return snap.issues
    .filter(function (i) {
      return i.tab === tid && i.status === 'open' && openActsFor(snap, i.id);
    })
    .map(function (i) { return { type: /** @type {'i'} */ ('i'), o: i, sev: i.sev }; })
    .concat(
      snap.projects
        .filter(function (p) {
          return p.tab === tid && p.status === 'off' && openActsFor(snap, p.id);
        })
        .map(function (p) { return { type: /** @type {'p'} */ ('p'), o: p, sev: 'offtrack' }; })
    );
}

/**
 * Should this project show up in a given meeting occurrence?
 *
 * Three conditions: right tab; hasn't started in the future; and is either still
 * active, or was closed on exactly this meeting date. That last clause is why
 * finished work stays visible in the meeting it was finished in and disappears the
 * week after. See rule 4 in docs/BUSINESS_RULES.md.
 *
 * @param {any} x - a project
 * @param {string} tid - tab id
 * @param {string} d - meeting date, 'YYYY-MM-DD'
 * @returns {boolean}
 */
export function projVisible(x, tid, d) {
  var active = x.status === 'new' || x.status === 'on' || x.status === 'off' || x.status === 'hold';
  var closedToday = (x.status === 'done' || x.status === 'cancelled') && x.doneMeeting === d;
  return x.tab === tid && (!x.start || x.start <= d) && (active || closedToday);
}
