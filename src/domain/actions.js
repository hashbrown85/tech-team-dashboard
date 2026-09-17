// @ts-check
/**
 * Action rules: creating an action, closing it, and what closing it does to the issue
 * it was attached to.
 *
 * See the folder rules at the top of queries.js — no DOM, no store, pure functions.
 *
 * The important rule here is rule 2 in docs/BUSINESS_RULES.md: closing the last open
 * action on an issue resolves that issue automatically, and unticking it reopens it —
 * but ONLY if the issue was auto-resolved in the first place. And off-track projects
 * are deliberately NOT treated the same way. Read the rule before editing; the
 * asymmetry looks like an oversight and is not.
 *
 * Lifted from board.html: F.action (1601-1615), C.actionDone (1634-1648),
 * C.actionDue (1655), H.delAction (1415-1421).
 */

import { isOpen, openActsFor, issueItems } from './queries.js';

/**
 * @typedef {import('./queries.js').Snapshot} Snapshot
 */

/**
 * How an action is referred to out loud in a meeting: "A-047".
 *
 * Zero-padded to three digits, which is why the action counter has to be sequential
 * with no gaps — see nextActionNum in the store. board.html:534.
 *
 * @param {{num?: number}} action
 * @returns {string}
 */
export function actionLabel(action) {
  return 'A-' + String((action && action.num) || 0).padStart(3, '0');
}

/**
 * Turn the form's parent dropdown value into a `parent` pointer.
 *
 * The form encodes the choice as one string: "p:" plus an id for a project, "i:" plus
 * an id for an issue. Anything that doesn't resolve to a record that actually exists
 * becomes null rather than a dangling pointer. board.html:1603-1604.
 *
 * @param {Snapshot} snap
 * @param {string} [ref]
 * @returns {{type: 'issue'|'project', id: string} | null}
 */
export function parseParentRef(snap, ref) {
  if (!ref) return null;
  const type = ref.charAt(0) === 'p' ? 'project' : 'issue';
  const id = ref.slice(2);
  const pool = type === 'project' ? snap.projects : snap.issues;
  if (!pool.some(function (x) { return x.id === id; })) return null;
  return { type: /** @type {'issue'|'project'} */ (type), id: id };
}

/**
 * Would creating this action give an unpathed queue item its path?
 *
 * Used only to word the confirmation message — "Path and owner set. Moved to Action
 * items" rather than just "added". Worth keeping: it tells the room that the thing
 * they were staring at has actually moved. board.html:1605.
 *
 * Must be asked BEFORE the action is written, while the item is still unpathed.
 *
 * @param {Snapshot} snap
 * @param {string} tid - tab id
 * @param {{id: string} | null} parent
 * @returns {boolean}
 */
export function wouldGainPath(snap, tid, parent) {
  if (!parent) return false;
  return issueItems(snap, tid).some(function (it) { return it.o.id === parent.id; });
}

/**
 * A new action.
 *
 * `num` is passed in because it comes from the shared counter, which is the one piece
 * of this that isn't a pure function.
 *
 * Note `owner` and `support` are person NAMES, not ids — that's what the form submits
 * and what gets stored. It's fragile (see DATA_MODEL.md) and slated to change, but
 * changing it here would be a behaviour change mid-port.
 *
 * @param {object} args
 * @param {number} args.num
 * @param {string} args.tab
 * @param {string} args.text
 * @param {string} args.owner - a person's name
 * @param {string} [args.support] - a person's name
 * @param {string} args.due
 * @param {{type: 'issue'|'project', id: string} | null} [args.parent]
 * @param {string} args.meetingDate
 * @returns {any} the document to write
 */
export function newAction({ num, tab, text, owner, support, due, parent, meetingDate }) {
  return {
    num: num,
    tab: tab,
    text: text,
    owner: owner,
    support: support || '',
    due: due,
    status: 'open',
    parent: parent || null,
    meeting: meetingDate
  };
}

/**
 * Tick or untick an action, and work out what that does to its issue.
 *
 * Returns up to two documents to write, because closing an action can resolve an
 * issue in the same gesture: the action itself, optionally an issue, and a note of
 * which effect fired.
 *
 * The rules, in order (board.html:1634-1648):
 *
 *  - The action's own status always changes. `doneOn` is stamped with TODAY, not the
 *    meeting date — inconsistent with the rest of the app, and recorded as a defect
 *    rather than fixed here.
 *  - If the action points at an ISSUE, and that issue is still open, and no other
 *    open action points at it, the issue auto-resolves and is marked `autoResolved`.
 *  - Unticking reopens the issue only if it is resolved AND `autoResolved`. A
 *    manually resolved issue stays resolved — that guard is the whole reason the flag
 *    exists.
 *  - Unlike a manual reopen, this does NOT send the issue to the bottom of the queue.
 *    It goes back exactly where it was, which is right: nothing about it changed, the
 *    action just got unticked.
 *  - If the action points at a PROJECT, none of this happens. A project is only back
 *    on track when a human says so in the meeting. This asymmetry is deliberate.
 *
 * @param {Snapshot} snap
 * @param {any} action - the action as it is now
 * @param {boolean} done - the checkbox's new state
 * @param {object} when
 * @param {string} when.today - today's date, for `doneOn`
 * @param {string} [when.issueMeetingDate] - the meeting date to stamp on a resolved
 *   issue. The original uses the issue's own tab's current meeting date, falling back
 *   to today when that tab has gone.
 * @returns {{action: any, issue: {id: string, doc: any} | null, effect: 'resolved'|'reopened'|null}}
 */
export function toggleDone(snap, action, done, { today, issueMeetingDate }) {
  const a = JSON.parse(JSON.stringify(action));
  delete a.id;
  a.status = done ? 'done' : 'open';
  if (done) a.doneOn = today;
  else delete a.doneOn;

  /** @type {{action: any, issue: {id: string, doc: any} | null, effect: 'resolved'|'reopened'|null}} */
  const result = { action: a, issue: null, effect: null };

  // Only issues participate. Projects are left alone on purpose.
  if (!action.parent || action.parent.type !== 'issue') return result;

  const issue = snap.issues.find(function (x) { return x.id === action.parent.id; });
  if (!issue) return result;

  const othersOpen = openActsFor(snap, issue.id, action.id);

  if (done && issue.status === 'open' && othersOpen === 0) {
    const doc = JSON.parse(JSON.stringify(issue));
    delete doc.id;
    doc.status = 'resolved';
    doc.resolvedMeeting = issueMeetingDate || today;
    doc.autoResolved = true;
    result.issue = { id: issue.id, doc: doc };
    result.effect = 'resolved';
  } else if (!done && issue.status === 'resolved' && issue.autoResolved) {
    const doc = JSON.parse(JSON.stringify(issue));
    delete doc.id;
    doc.status = 'open';
    delete doc.resolvedMeeting;
    delete doc.autoResolved;
    result.issue = { id: issue.id, doc: doc };
    result.effect = 'reopened';
  }

  return result;
}

/**
 * Change an action's due date. board.html:1655.
 *
 * @param {any} action
 * @param {string} due
 * @returns {any | null}
 */
/**
 * The sortable columns on the Action items table.
 *
 * Same shape as SORT_COLUMNS in domain/projects.js, and here for the same reason:
 * the handler validates against it and the header markup reads its labels, and
 * handlers never import from views/.
 */
export const ACTION_SORT_COLUMNS = {
  num: { first: 'asc', label: 'Number', asc: 'oldest first', desc: 'newest first' },
  owner: { first: 'asc', label: 'Owner', asc: 'A to Z', desc: 'Z to A' },
  due: { first: 'asc', label: 'Due', asc: 'soonest first', desc: 'latest first' }
};

/**
 * Which way an actions column sorts on the first click.
 *
 * @param {string} col
 * @returns {string}
 */
export function firstActionDirFor(col) {
  return ACTION_SORT_COLUMNS[col] ? ACTION_SORT_COLUMNS[col].first : 'asc';
}

/**
 * One column's value, or null when the action has none.
 *
 * null is "nobody has said", not zero and not the empty string - see actionSorter.
 *
 * @param {any} a
 * @param {string} col
 * @returns {number | string | null}
 */
export function actionSortKey(a, col) {
  if (col === 'num') return typeof a.num === 'number' && !isNaN(a.num) ? a.num : null;
  if (col === 'owner') return a.owner ? String(a.owner).trim().toLowerCase() : null;
  if (col === 'due') return a.due || null;
  return null;
}

/**
 * The last resort when everything else ties. Never reversed, whatever the
 * direction - see actionSorter.
 *
 * @param {any} a
 * @param {any} b
 */
export function byNum(a, b) {
  const na = typeof a.num === 'number' ? a.num : 0;
  const nb = typeof b.num === 'number' ? b.num : 0;
  if (na !== nb) return na < nb ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : 1;
}

/**
 * The default order: open work first, then by due date, then by number.
 *
 * This lived in views/actions.js and was NOT a valid comparator - it returned 1 for
 * ties, which is not transitive, and so leaned on Array.sort being stable over an
 * array the adapter rebuilds on every 60-second poll. Stability preserves the INPUT
 * order; the input is not stable. Same argument as projectSorter.
 *
 * @param {any} a
 * @param {any} b
 */
export function byActionWorkOrder(a, b) {
  if (isOpenAction(a) !== isOpenAction(b)) return isOpenAction(a) ? -1 : 1;
  const da = a.due || '';
  const db = b.due || '';
  // No date sorts last among open work, the same rule the columns use.
  if (!da !== !db) return da ? -1 : 1;
  if (da !== db) return da < db ? -1 : 1;
  return byNum(a, b);
}

function isOpenAction(a) {
  return a.status !== 'done';
}

/**
 * A total comparator for one column and direction.
 *
 * Absent values sort last in BOTH directions: no owner means nobody has been asked,
 * and no date means nobody has committed - neither is a small value. Direction
 * applies only among actions that have one.
 *
 * @param {string} col
 * @param {string} dir - 'asc' | 'desc'
 * @returns {(a: any, b: any) => number}
 */
export function actionSorter(col, dir) {
  const flip = dir === 'desc' ? -1 : 1;

  return function (a, b) {
    const ka = actionSortKey(a, col);
    const kb = actionSortKey(b, col);

    if (ka == null || kb == null) {
      if (ka != null) return -1;
      if (kb != null) return 1;
    } else if (ka !== kb) {
      return (ka < kb ? -1 : 1) * flip;
    }

    return byNum(a, b);
  };
}

export function changeDue(action, due) {
  if (!action) return null;
  const x = JSON.parse(JSON.stringify(action));
  delete x.id;
  x.due = due;
  return x;
}

/**
 * Detach every action hanging off a parent that is being deleted.
 *
 * Returns the writes needed to orphan them rather than delete them — committed work
 * survives the thing that prompted it (rule 7). board.html:1401.
 *
 * @param {Snapshot} snap
 * @param {string} parentId
 * @returns {{col: string, id: string, patch: {parent: null}}[]}
 */
export function orphanActionsOf(snap, parentId) {
  return snap.actions
    .filter(function (a) { return a.parent && a.parent.id === parentId; })
    .map(function (a) { return { col: 'actions', id: a.id, patch: { parent: null } }; });
}

// Re-exported so callers working with actions don't need two imports for the obvious
// questions about them.
export { isOpen, openActsFor };
