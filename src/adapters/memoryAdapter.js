// @ts-check
/**
 * A DataStore that keeps everything in plain objects in memory.
 *
 * Two uses. It's what the tests run against — no network, no browser, deterministic.
 * And it backs the local demo, so the whole app can be clicked through outside the
 * Claude artifact and before any SharePoint exists.
 *
 * It is deliberately a little awkward in the same places a real store is: writes are
 * asynchronous, ids are honoured but not generated on insert, and `meetings` are
 * addressed by their stored 'tab@date' id while being held in memory as 'tab|date'.
 * If the app works against this, the shape of the real adapter is already right.
 *
 * It can also be told to fail on purpose, which is how the store's error handling and
 * the read-only fallback get tested.
 */

import {
  blankSnapshot,
  memoryKeyFor,
  KEYED_COLLECTIONS
} from './DataStore.js';
import { uid } from '../lib/seq.js';

/**
 * @typedef {import('./DataStore.js').Snapshot} Snapshot
 * @typedef {import('./DataStore.js').Op} Op
 */

/**
 * @param {object} [options]
 * @param {Snapshot} [options.seed] - starting data
 * @param {number} [options.startActionNum] - the next action number to hand out
 * @param {(op: Op) => ({code: string} | null)} [options.failWrites] - return an error
 *   to reject a write, or null to let it through. For testing failure paths.
 * @param {boolean} [options.realtime] - claim realtime support and notify watchers
 */
export function createMemoryAdapter(options) {
  const opts = options || {};
  let data = opts.seed ? clone(opts.seed) : blankSnapshot();
  let counter = opts.startActionNum == null ? 1 : opts.startActionNum;
  /** @type {((snap: Snapshot) => void)[]} */
  let watchers = [];

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  /** Apply one operation to the in-memory data. */
  function applyOp(op) {
    const col = op.col;

    if (KEYED_COLLECTIONS.indexOf(col) >= 0) {
      const key = memoryKeyFor(col, op.id);
      if (op.op === 'remove') {
        delete data[col][key];
      } else if (op.op === 'set') {
        data[col][key] = clone(op.data);
      } else {
        data[col][key] = Object.assign({}, data[col][key], clone(op.patch));
      }
      return;
    }

    const arr = data[col];
    const i = arr.findIndex(function (x) { return x.id === op.id; });

    if (op.op === 'remove') {
      if (i >= 0) arr.splice(i, 1);
    } else if (op.op === 'set') {
      // Honour the id we were given — undo depends on it. A document body should
      // never carry its own id; strip one if it somehow does.
      const doc = clone(op.data);
      delete doc.id;
      const record = Object.assign({ id: op.id }, doc);
      if (i >= 0) arr[i] = record; else arr.push(record);
    } else if (op.op === 'update') {
      if (i >= 0) Object.assign(arr[i], clone(op.patch));
    }
  }

  function notify() {
    if (!opts.realtime) return;
    const snap = clone(data);
    watchers.slice().forEach(function (fn) { fn(snap); });
  }

  /** Run a list of ops, rejecting the whole lot if any is refused. */
  function write(ops) {
    if (opts.failWrites) {
      for (let i = 0; i < ops.length; i++) {
        const err = opts.failWrites(ops[i]);
        if (err) return Promise.reject(err);
      }
    }
    ops.forEach(applyOp);
    notify();
    return Promise.resolve();
  }

  return {
    capabilities: { realtime: !!opts.realtime, batch: true, llm: false },

    load: function () {
      return Promise.resolve(clone(data));
    },

    watch: function (onChange) {
      if (!opts.realtime) return null;
      watchers.push(onChange);
      return function () {
        watchers = watchers.filter(function (f) { return f !== onChange; });
      };
    },

    set: function (col, id, doc) {
      return write([{ op: 'set', col: col, id: id, data: doc }]);
    },

    update: function (col, id, patch) {
      return write([{ op: 'update', col: col, id: id, patch: patch }]);
    },

    remove: function (col, id) {
      return write([{ op: 'remove', col: col, id: id }]);
    },

    batch: function (ops) {
      return write(ops);
    },

    nextActionNum: function () {
      const n = counter;
      counter = counter + 1;
      return Promise.resolve(n);
    },

    newId: function () {
      return uid();
    },

    /* --- test conveniences, not part of the contract --- */

    /** The raw data, for assertions. */
    _peek: function () {
      return clone(data);
    },

    /** Simulate a change arriving from somewhere else. */
    _pushExternalChange: function (fn) {
      fn(data);
      notify();
    }
  };
}
