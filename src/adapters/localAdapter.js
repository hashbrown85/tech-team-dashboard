// @ts-check
/**
 * A DataStore that saves to the browser, so a real meeting can be run before
 * SharePoint exists.
 *
 * The board has never needed saving: it ran on invented data, and losing it cost
 * nothing. The moment a real meeting is run from it, the memory adapter's one
 * property — that everything lives in a variable — becomes the worst bug in the
 * app. One reload and the meeting is gone.
 *
 * This wraps `memoryAdapter` rather than reimplementing it. That adapter already
 * owns applying an operation, honouring an id on `set`, and putting documents
 * through the schema; duplicating any of that would mean two places to keep right.
 * Here we only add: seed from storage on the way up, write the whole snapshot back
 * after every change.
 *
 * ## Two things this deliberately does loudly
 *
 * **A save that fails rejects the write.** Quota, a private window, a corporate
 * cleanup policy — whatever the reason, the rejection reaches `store.handleFailure`,
 * which flips the area read-only and toasts. When the board is somebody's only
 * record, a SILENT save failure is the worst available outcome: they keep typing
 * into something that is keeping none of it.
 *
 * **Unreadable saved data does not start you at empty.** That would look exactly
 * like the data loss this file exists to prevent. The unreadable value is copied
 * aside under its own key and the error names it, so it can be recovered rather
 * than quietly overwritten by the next save.
 *
 * ## The trap worth knowing
 *
 * Browser storage belongs to an exact address. What is saved at
 * `http://localhost:8010` cannot be seen at `:8011`, or at `127.0.0.1`. Always
 * start the server the same way. The downloadable copy is the portable form; this
 * is not.
 */

import { createMemoryAdapter } from './memoryAdapter.js';
import { blankSnapshot, COLLECTIONS, KEYED_COLLECTIONS } from './DataStore.js';

/**
 * @typedef {import('./DataStore.js').Snapshot} Snapshot
 */

/** Where the board lives, unless told otherwise. */
export const LOCAL_KEY = 'techops-board:live';

/**
 * The next action number, worked out from the data rather than stored beside it.
 *
 * Deriving it means there is no second thing to keep in step: a saved board always
 * resumes at one past its highest action, and A-numbers cannot restart at 1 after a
 * reload and collide with numbers already read aloud in a meeting.
 *
 * @param {Snapshot} snap
 * @returns {number}
 */
export function nextActionNumFor(snap) {
  const nums = (snap && snap.actions ? snap.actions : [])
    .map(function (a) { return typeof a.num === 'number' && !isNaN(a.num) ? a.num : 0; });
  return nums.length ? Math.max.apply(null, nums) + 1 : 1;
}

/**
 * Is this the shape of a board?
 *
 * Only the shape — every collection present and of the right kind. Merging onto a
 * blank snapshot first means a board saved before a collection existed still loads,
 * which will matter the first time one is added.
 *
 * @param {any} value
 * @returns {boolean}
 */
export function looksLikeSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  /*
   * At least these four must be there. Without a floor, an object carrying NONE of
   * the collections passed - every one was "absent, and absent is fine" - so any
   * JSON object at all was accepted as a board. These four have existed since the
   * beginning; the newer ones stay optional so an older saved board still loads.
   */
  const required = ['people', 'tabs', 'projects', 'actions'];
  if (!required.every(function (col) { return Array.isArray(value[col]); })) return false;

  return COLLECTIONS.every(function (col) {
    if (!(col in value)) return true;            // absent is fine; blank fills it
    const v = value[col];
    return KEYED_COLLECTIONS.indexOf(col) >= 0
      ? !!v && typeof v === 'object' && !Array.isArray(v)
      : Array.isArray(v);
  });
}

/**
 * @param {object} [options]
 * @param {Storage} [options.storage] - defaults to window.localStorage. Injectable
 *   so the shared contract tests can run this adapter in Node.
 * @param {string} [options.key]
 * @param {Snapshot} [options.seed] - used only when storage holds nothing yet
 */
export function createLocalAdapter(options) {
  const opts = options || {};
  const key = opts.key || LOCAL_KEY;
  const storage = opts.storage ||
    (typeof window === 'undefined' ? null : window.localStorage);

  if (!storage) {
    throw new Error(
      'No storage to save the board into. This adapter needs localStorage, or a ' +
      'storage object passed in.'
    );
  }

  const seed = readSaved(storage, key) || opts.seed || blankSnapshot();

  /*
   * Rebuilt, not mutated, when the whole board is replaced - that is the only way
   * the action counter can be re-derived from the new data. Every method below
   * therefore calls through `mem` at the time of the call rather than capturing it,
   * or a replaced board would keep answering from the old one.
   */
  let mem = build(seed);

  function build(from) {
    return createMemoryAdapter({ seed: from, startActionNum: nextActionNumFor(from) });
  }

  /** Write the whole board back. Rejects rather than swallowing — see the header. */
  function persist() {
    return mem.load().then(function (snap) {
      storage.setItem(key, JSON.stringify(snap));
    });
  }

  /** Every write persists before it is considered done. */
  function saving(p) {
    return p.then(persist);
  }

  return {
    capabilities: mem.capabilities,

    load: function () { return mem.load(); },
    watch: function (fn) { return mem.watch(fn); },
    newId: function () { return mem.newId(); },
    nextActionNum: function () { return mem.nextActionNum(); },

    set: function (col, id, doc) { return saving(mem.set(col, id, doc)); },
    update: function (col, id, patch) { return saving(mem.update(col, id, patch)); },
    remove: function (col, id) { return saving(mem.remove(col, id)); },
    batch: function (ops) { return saving(mem.batch(ops)); },

    /* --- not part of the contract --- */

    /**
     * Replace the whole board, after loading a downloaded copy.
     *
     * Saved BEFORE the swap: if writing fails, the board in front of you is still
     * the one that is saved, rather than a loaded one that is not.
     */
    _replaceAll: function (snap) {
      const fresh = Object.assign(blankSnapshot(), snap);
      storage.setItem(key, JSON.stringify(fresh));
      mem = build(fresh);
    }
  };
}

/**
 * Read the saved board, or null if there is none.
 *
 * Throws on a value that is there but unreadable, having first copied it aside.
 * Starting empty instead would be indistinguishable from losing everything.
 */
function readSaved(storage, key) {
  let raw;
  try {
    raw = storage.getItem(key);
  } catch (e) {
    throw new Error('Could not read the saved board: ' + (e && e.message));
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(keptAside(storage, key, raw));
  }
  if (!looksLikeSnapshot(parsed)) {
    throw new Error(keptAside(storage, key, raw));
  }

  return Object.assign(blankSnapshot(), parsed);
}

/** Put the unreadable value somewhere safe and say where. */
function keptAside(storage, key, raw) {
  const backup = key + ':unreadable:' + new Date().toISOString().slice(0, 19);
  try {
    storage.setItem(backup, raw);
  } catch (e) {
    return 'The saved board could not be read, and could not be backed up either. ' +
      'Do not save over it. Load your most recent downloaded copy instead.';
  }
  return 'The saved board could not be read. It has been kept under "' + backup +
    '" so nothing is lost. Load your most recent downloaded copy to carry on.';
}
