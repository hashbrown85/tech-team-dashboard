// @ts-check
/**
 * The store: the app's local copy of the board, and the only thing that writes to it.
 *
 * Everything above this — views, handlers — reads `snapshot()` and calls the write
 * methods. Everything below is an adapter. Nothing else knows how the data is stored.
 *
 * ## Why this file exists at all
 *
 * The original app relied on realtime updates to stay correct, in a way that isn't
 * obvious. Several handlers did read-modify-write: take the record as it currently is
 * in local state, change one field, write the WHOLE record back (board.html:645-649).
 * That is only safe because the local copy was kept fresh by a live subscription
 * firing after every single write.
 *
 * Take realtime away — which is what moving to SharePoint does — and that becomes a
 * silent data-loss bug. Two quick edits to the same project and the second one writes
 * a stale copy over the first. No error, no warning, just a lost change.
 *
 * The fix is here: **every write updates the local copy immediately, before the
 * adapter is called.** So the local copy is always current, read-modify-write stays
 * safe, and the UI redraws instantly instead of waiting for a round trip.
 *
 * If the adapter then refuses the write, the local copy has to be put back — see
 * `revert` below.
 *
 * ## Keeping fresh without realtime
 *
 * Instead of a live subscription: an explicit refresh, a reload when the window
 * regains focus, and a slow poll while idle. With one person driving a meeting, that
 * is plenty. If an adapter DOES support realtime, it is used as well.
 */

import {
  blankSnapshot,
  memoryKeyFor,
  areaOf,
  describeWriteFailure,
  KEYED_COLLECTIONS
} from './adapters/DataStore.js';

/**
 * @typedef {import('./adapters/DataStore.js').Snapshot} Snapshot
 * @typedef {import('./adapters/DataStore.js').Op} Op
 */

/** How long between background reloads while the window sits idle. */
const IDLE_POLL_MS = 60000;

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

/**
 * Apply one operation to a snapshot, in place.
 *
 * This mirrors what an adapter does to the real store, and it is the reason a write
 * shows up on screen before the network has been anywhere near it.
 *
 * @param {Snapshot} snap
 * @param {Op} op
 */
export function applyToSnapshot(snap, op) {
  const col = op.col;

  if (KEYED_COLLECTIONS.indexOf(col) >= 0) {
    const key = memoryKeyFor(col, op.id);
    if (op.op === 'remove') delete snap[col][key];
    else if (op.op === 'set') snap[col][key] = clone(op.data);
    else snap[col][key] = Object.assign({}, snap[col][key], clone(op.patch));
    return;
  }

  const arr = snap[col];
  if (!arr) return;
  const i = arr.findIndex(function (x) { return x.id === op.id; });

  if (op.op === 'remove') {
    if (i >= 0) arr.splice(i, 1);
  } else if (op.op === 'set') {
    const doc = clone(op.data);
    delete doc.id;
    const record = Object.assign({ id: op.id }, doc);
    if (i >= 0) arr[i] = record; else arr.push(record);
  } else if (op.op === 'update') {
    if (i >= 0) Object.assign(arr[i], clone(op.patch));
  }
}

/**
 * Build a store over an adapter.
 *
 * @param {any} adapter - something satisfying the DataStore contract
 * @param {object} [hooks]
 * @param {(msg: string, undoable?: boolean) => void} [hooks.onMessage] - tell the user something
 * @param {() => void} [hooks.onChange] - the data changed; redraw
 * @param {(status: string) => void} [hooks.onStatus] - 'connecting' | 'live' | 'readonly'
 */
export function createStore(adapter, hooks) {
  const on = hooks || {};
  let snap = blankSnapshot();
  let contentMode = 'connecting';
  let settingsMode = 'connecting';
  /** @type {(() => void) | null} */
  let lastUndo = null;
  /** @type {(() => void) | null} */
  let unwatch = null;
  let pollTimer = null;
  let loading = false;

  function changed() {
    if (on.onChange) on.onChange();
  }

  function setMode(area, mode) {
    if (area === 'settings') settingsMode = mode;
    else contentMode = mode;
    if (on.onStatus) on.onStatus(mode);
  }

  /**
   * A write was refused. Tell the user, and if it was a permission problem, remember
   * that this part of the board is read-only from here on.
   */
  function handleFailure(col, err) {
    const info = describeWriteFailure(col, err);
    if (info.readonly) setMode(info.area, 'readonly');
    if (on.onMessage) on.onMessage(info.message);
    // The local copy is now ahead of the store, so re-sync rather than guess.
    return reload().catch(function () { /* already reported */ });
  }

  /**
   * Apply operations locally, then send them. On refusal, reload to get back in step.
   *
   * @param {Op[]} ops
   * @param {string} col - for permission reporting
   */
  function commit(ops, col) {
    if (!ops.length) return Promise.resolve();

    ops.forEach(function (op) { applyToSnapshot(snap, op); });
    changed();

    const send = ops.length === 1
      ? sendOne(ops[0])
      : (adapter.capabilities && adapter.capabilities.batch
          ? adapter.batch(ops)
          : ops.reduce(function (p, op) { return p.then(function () { return sendOne(op); }); }, Promise.resolve()));

    return send.catch(function (err) { return handleFailure(col, err); });
  }

  function sendOne(op) {
    if (op.op === 'set') return adapter.set(op.col, op.id, op.data);
    if (op.op === 'update') return adapter.update(op.col, op.id, op.patch);
    return adapter.remove(op.col, op.id);
  }

  /** Replace the local copy from the store. */
  function reload(filter) {
    if (loading) return Promise.resolve();
    loading = true;
    return adapter.load(filter).then(function (fresh) {
      loading = false;
      snap = fresh || blankSnapshot();
      if (contentMode === 'connecting') setMode('content', 'live');
      if (settingsMode === 'connecting') setMode('settings', 'live');
      changed();
    }, function (err) {
      loading = false;
      if (contentMode === 'connecting') setMode('content', 'readonly');
      if (settingsMode === 'connecting') setMode('settings', 'readonly');
      if (on.onMessage) on.onMessage('Couldn’t load the board. Try reloading.');
      changed();
      throw err;
    });
  }

  const store = {
    /** The current local copy. Treat as read-only. */
    snapshot: function () {
      return snap;
    },

    /** 'connecting' | 'live' | 'readonly' for each permission area. */
    modes: function () {
      return { content: contentMode, settings: settingsMode };
    },

    /** Can this collection be written to, as far as we know? */
    canWrite: function (col) {
      return (areaOf(col) === 'settings' ? settingsMode : contentMode) !== 'readonly';
    },

    capabilities: function () {
      return adapter.capabilities || { realtime: false, batch: false, llm: false };
    },

    /* --- reads --- */

    load: reload,
    refresh: function () { return reload(); },

    /* --- writes --- */

    set: function (col, id, data) {
      return commit([{ op: 'set', col: col, id: id, data: data }], col);
    },

    update: function (col, id, patch) {
      return commit([{ op: 'update', col: col, id: id, patch: patch }], col);
    },

    remove: function (col, id) {
      return commit([{ op: 'remove', col: col, id: id }], col);
    },

    /**
     * Apply many operations as one gesture.
     * @param {Op[]} ops
     */
    batch: function (ops) {
      return commit(ops, ops.length ? ops[0].col : 'content');
    },

    /**
     * Read-modify-write one record.
     *
     * Safe now that the local copy is always current — which it was not before this
     * file existed. The mutator receives a COPY with no id; whatever it leaves behind
     * is what gets stored.
     *
     * @param {string} col
     * @param {string} id
     * @param {(doc: any) => void} mutate
     */
    mutate: function (col, id, mutate) {
      const arr = snap[col];
      const current = arr && arr.find(function (x) { return x.id === id; });
      if (!current) return Promise.resolve();
      const copy = clone(current);
      delete copy.id;
      mutate(copy);
      return store.set(col, id, copy);
    },

    /* --- cascades and undo --- */

    /**
     * Run a cascade from src/domain/cascade.js: apply its writes, and remember how to
     * put it back.
     *
     * Only one undo is remembered at a time, which is what the original did — the
     * toast offers it for a few seconds and then it is gone.
     *
     * @param {{writes: Op[], undo: Op[], message: string}} cascade
     */
    runCascade: function (cascade) {
      if (!cascade.writes.length) return Promise.resolve();
      const undoOps = cascade.undo;
      const col = cascade.writes[0].col;

      lastUndo = function () {
        lastUndo = null;
        return commit(undoOps, col);
      };

      const p = commit(cascade.writes, col);
      if (cascade.message && on.onMessage) on.onMessage(cascade.message, true);
      return p;
    },

    hasUndo: function () {
      return !!lastUndo;
    },

    undo: function () {
      if (!lastUndo) return Promise.resolve();
      return lastUndo();
    },

    clearUndo: function () {
      lastUndo = null;
    },

    /* --- ids and counters --- */

    newId: function () {
      return adapter.newId();
    },

    nextActionNum: function () {
      return adapter.nextActionNum();
    },

    /* --- staying fresh --- */

    /**
     * Start keeping up to date: realtime if the adapter has it, plus a reload on
     * window focus and a slow poll while idle.
     *
     * @param {object} [w]
     * @param {any} [w.window] - injectable for tests
     */
    startWatching: function (w) {
      const win = (w && w.window) || (typeof window === 'undefined' ? null : window);

      if (adapter.watch) {
        unwatch = adapter.watch(function (fresh) {
          snap = fresh;
          changed();
        });
      }

      if (!win) return;

      win.addEventListener('focus', function () {
        reload().catch(function () {});
      });

      pollTimer = win.setInterval(function () {
        if (win.document && win.document.hidden) return;
        reload().catch(function () {});
      }, IDLE_POLL_MS);
    },

    stopWatching: function (w) {
      const win = (w && w.window) || (typeof window === 'undefined' ? null : window);
      if (unwatch) { unwatch(); unwatch = null; }
      if (pollTimer != null && win) { win.clearInterval(pollTimer); pollTimer = null; }
    }
  };

  return store;
}
