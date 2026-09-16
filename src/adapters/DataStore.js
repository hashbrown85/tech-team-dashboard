// @ts-check
/**
 * The contract every backing store must satisfy.
 *
 * This file is documentation plus two small shared helpers. The adapters are the
 * implementations: memoryAdapter.js (tests and the local demo), claudeAdapter.js
 * (the artifact the board runs in today), and graphAdapter.js (SharePoint, later).
 *
 * Everything above this line — the domain, the views, the handlers — talks only to
 * store.js, which talks only to an adapter through this contract. That is what makes
 * swapping the backing store an afternoon rather than a rewrite.
 *
 * ## The contract
 *
 *   capabilities: { realtime, batch, llm }   what this adapter can actually do
 *
 *   load(filter?)      -> Promise<Snapshot>  every collection, reshaped for the app
 *   watch(onChange)    -> unsubscribe | null realtime adapters only; null otherwise
 *
 *   set(col, id, data) -> Promise<void>      create or replace, AT THIS ID
 *   update(col, id, patch) -> Promise<void>  merge fields into an existing record
 *   remove(col, id)    -> Promise<void>
 *   batch(ops)         -> Promise<void>      many writes; see Op below
 *
 *   nextActionNum()    -> Promise<number>    the shared, gapless action counter
 *   newId()            -> string             a fresh record id
 *
 * ## Three things an adapter MUST get right
 *
 * 1. **`set` writes the id it is given.** Undo restores deleted records under their
 *    ORIGINAL ids, because everything else points at them by id. An adapter that
 *    lets the backing store assign its own ids will restore data as orphans. If the
 *    store insists on its own keys, keep a private map from app id to store key and
 *    translate — do not leak the store's keys upwards.
 *
 * 2. **The action counter is gapless.** Numbers get read aloud in meetings ("A-047"),
 *    so they must be sequential with no holes, which rules out reusing an
 *    auto-increment row id that leaves gaps when rows are deleted. Two people
 *    creating an action in the same second must get different numbers — the original
 *    implementation was a read-then-write with a real race, so any adapter doing
 *    better than that is an improvement.
 *
 * 3. **`load` returns the app's shape, not the store's.** Six collections are arrays;
 *    `meetings` and `settings` are objects keyed as described below. All the
 *    reshaping lives in the adapter so nothing above it learns how a particular store
 *    spells things.
 *
 * ## Shapes
 *
 * A Snapshot is what `blankSnapshot()` returns:
 *   people, tabs, entries, projects, issues, actions   arrays of records with `id`
 *   meetings                                           keyed 'tabId|YYYY-MM-DD'
 *   settings                                           keyed by document id
 *
 * Note the two spellings of a meeting key. In memory it is `tab|date`; stored it is
 * `tab@date`. Writes use the STORED form, because that is the document id. See
 * memoryKeyFor() below, which is the one place that translation lives.
 *
 * An Op, for batch() and for the cascade helpers:
 *   { op: 'set',    col, id, data }
 *   { op: 'update', col, id, patch }
 *   { op: 'remove', col, id }
 *
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 * @typedef {{op: 'set'|'update'|'remove', col: string, id: string, data?: any, patch?: any}} Op
 * @typedef {{realtime: boolean, batch: boolean, llm: boolean}} Capabilities
 */

/** The collections the app loads and subscribes to. board.html:1729. */
export const COLLECTIONS = [
  'people', 'tabs', 'entries', 'projects', 'projectDetails', 'projectNotes',
  'issues', 'actions', 'meetings', 'settings'
];

/**
 * Collections a person may legitimately be refused.
 *
 * A 403 on one of these yields an empty collection rather than failing the whole
 * load — being denied project values is a normal state for most of the team, not
 * an error. A 403 anywhere else is a real problem and still fails.
 */
export const OPTIONAL_COLLECTIONS = ['projectDetails'];

/** The two collections held as keyed objects rather than arrays. */
export const KEYED_COLLECTIONS = ['meetings', 'settings'];

/**
 * An empty board. The same shape as `blank()` in board.html:513.
 * @returns {Snapshot}
 */
export function blankSnapshot() {
  return {
    people: [],
    tabs: [],
    entries: [],
    projects: [],
    projectDetails: [],
    projectNotes: [],
    issues: [],
    actions: [],
    meetings: {},
    settings: {}
  };
}

/**
 * The in-memory key for a stored document id.
 *
 * Only `meetings` differs: stored as 'tab@date', held as 'tab|date'. Everything else
 * is keyed by its plain id. Isolated here because getting it wrong files data against
 * the wrong meeting and nothing complains.
 *
 * @param {string} col
 * @param {string} id - the STORED document id
 * @returns {string}
 */
export function memoryKeyFor(col, id) {
  if (col !== 'meetings') return id;
  const at = String(id).indexOf('@');
  if (at < 0) return id;
  return id.slice(0, at) + '|' + id.slice(at + 1);
}

/**
 * Which permission area a collection belongs to.
 *
 * Three of them, and each maps onto a group of SharePoint lists:
 *
 *   settings - the roster, the meetings list, the pick-lists. The owner's to change.
 *   details  - project value and confidence. Its own area precisely so that being
 *              refused a write here cannot turn the REST of the board read-only:
 *              somebody who may read those figures but not edit them should lose
 *              nothing else.
 *   content  - everything the team works on week to week.
 *
 * board.html:631, extended.
 *
 * @param {string} col
 * @returns {'settings'|'content'|'details'}
 */
export function areaOf(col) {
  if (col === 'people' || col === 'tabs' || col === 'settings') return 'settings';
  if (col === 'projectDetails') return 'details';
  return 'content';
}

/**
 * Turn a store error into what the user should be told, and whether their access
 * just turned out to be read-only.
 *
 * The board discovers its permissions by being refused, not by asking up front — so
 * a rejected write is how the UI learns to go read-only. board.html:632-641.
 *
 * `code` is the adapter's job to normalise: 'denied' for a refusal, 'rate_limit' for
 * too many writes, 'full' for out of space, anything else for a general failure.
 *
 * @param {string} col
 * @param {{code?: string} | null} err
 * @returns {{area: 'settings'|'content'|'details', readonly: boolean, message: string}}
 */
export function describeWriteFailure(col, err) {
  const area = areaOf(col);
  const code = (err && err.code) || '';

  if (code === 'denied') {
    const message = area === 'settings'
      ? 'Only the board owner can change settings.'
      : area === 'details'
        ? 'You can see these figures but not change them.'
        : 'You have view-only access here.';
    return { area: area, readonly: true, message: message };
  }
  if (code === 'rate_limit') {
    return { area: area, readonly: false, message: 'Too many changes at once — try again in a moment.' };
  }
  if (code === 'full') {
    return { area: area, readonly: false, message: 'This board is full — delete some old items first.' };
  }
  return { area: area, readonly: false, message: 'Couldn’t save that change. Please try again.' };
}
