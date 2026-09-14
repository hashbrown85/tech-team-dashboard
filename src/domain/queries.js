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
    .sort(function (a, c) {
      if (isOpen(a) === isOpen(c)) return (a.due || '9') < (c.due || '9') ? -1 : 1;
      return isOpen(a) ? -1 : 1;
    });
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
