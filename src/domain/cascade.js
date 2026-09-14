// @ts-check
/**
 * Deleting things, and being able to take it back.
 *
 * See the folder rules at the top of queries.js — no DOM, no store, pure functions.
 *
 * Every function here returns the same shape, so the caller never has to know which
 * kind of delete it is doing:
 *
 *   {
 *     writes:  [ ...operations to apply now ],
 *     undo:    [ ...operations that put it all back ],
 *     message: 'what to tell the user'
 *   }
 *
 * An operation is `{op: 'remove'|'set'|'update', col, id}` plus `data` for a set or
 * `patch` for an update. That maps straight onto a store's batch write.
 *
 * TWO THINGS THE STORE MUST HONOUR, or undo silently breaks:
 *
 *  1. A `set` must write the id it is given. Undo re-creates deleted records under
 *     their ORIGINAL ids, because other records point at them by id. A store that
 *     assigns its own ids on insert would restore the data as orphans.
 *  2. There are no transactions. A cascade is many writes and some can fail while
 *     others succeed. Undo is the only rollback there is — which is why it is built
 *     here rather than left to the caller.
 *
 * The rule these all follow is rule 7 in docs/BUSINESS_RULES.md: deleting a parent
 * keeps the work. Actions are detached rather than deleted, because someone
 * committed to doing them and removing the prompt doesn't release them.
 *
 * Lifted from board.html: H.delEntry (1384-1394), H.delProject (1395-1404),
 * H.delIssue (1405-1414), H.delAction (1415-1421), H.delTab (1447-1470),
 * H.delPerson (1471-1485).
 */

import { byId } from '../lib/seq.js';
import { actionLabel } from './actions.js';
import { documentId, memoryKey } from './meetings.js';
import { linkedProjectGoesToo } from './projects.js';

/**
 * @typedef {import('./queries.js').Snapshot} Snapshot
 * @typedef {{op: 'remove'|'set'|'update', col: string, id: string, data?: any, patch?: any}} Op
 * @typedef {{writes: Op[], undo: Op[], message: string}} Cascade
 */

/** A record as it should be stored: everything except its id. */
function docOf(record) {
  const c = JSON.parse(JSON.stringify(record));
  delete c.id;
  return c;
}

/** The empty result, for "there was nothing to delete". */
function nothing() {
  return { writes: [], undo: [], message: '' };
}

/**
 * Delete one action.
 *
 * The simplest case — nothing points at an action, so nothing cascades.
 * board.html:1415-1421.
 *
 * @param {Snapshot} snap
 * @param {string} id
 * @returns {Cascade}
 */
export function deleteAction(snap, id) {
  const a = byId(snap.actions, id);
  if (!a) return nothing();

  return {
    writes: [{ op: 'remove', col: 'actions', id: id }],
    undo: [{ op: 'set', col: 'actions', id: id, data: docOf(a) }],
    message: actionLabel(a) + ' deleted.'
  };
}

/**
 * Delete a win/loss/opportunity log entry.
 *
 * If it was an opportunity whose project nobody has touched yet, the project goes
 * too — otherwise you would be left with a project nobody remembers proposing. Once
 * someone HAS touched it, the project stays. See rule 5. board.html:1387.
 *
 * @param {Snapshot} snap
 * @param {string} id
 * @returns {Cascade}
 */
export function deleteEntry(snap, id) {
  const e = byId(snap.entries, id);
  if (!e) return nothing();

  /** @type {Op[]} */
  const writes = [{ op: 'remove', col: 'entries', id: id }];
  /** @type {Op[]} */
  const undo = [{ op: 'set', col: 'entries', id: id, data: docOf(e) }];

  if (linkedProjectGoesToo(snap, e)) {
    const pj = byId(snap.projects, e.projectId);
    if (pj) {
      writes.push({ op: 'remove', col: 'projects', id: pj.id });
      undo.push({ op: 'set', col: 'projects', id: pj.id, data: docOf(pj) });
    }
  }

  return { writes: writes, undo: undo, message: 'Entry removed.' };
}

/**
 * Detach every action pointing at a record, and the undo that reattaches them.
 *
 * The undo restores each action's ORIGINAL parent object, not null — so undoing a
 * delete puts the relationships back, not just the record.
 *
 * @param {Snapshot} snap
 * @param {string} parentId
 * @returns {{writes: Op[], undo: Op[]}}
 */
function detachActions(snap, parentId) {
  const affected = snap.actions.filter(function (a) {
    return a.parent && a.parent.id === parentId;
  });
  return {
    writes: affected.map(function (a) {
      return { op: /** @type {'update'} */ ('update'), col: 'actions', id: a.id, patch: { parent: null } };
    }),
    undo: affected.map(function (a) {
      return { op: /** @type {'update'} */ ('update'), col: 'actions', id: a.id, patch: { parent: a.parent } };
    })
  };
}

/**
 * Delete a project. Its actions survive, detached. board.html:1395-1404.
 *
 * @param {Snapshot} snap
 * @param {string} id
 * @returns {Cascade}
 */
export function deleteProject(snap, id) {
  const p = byId(snap.projects, id);
  if (!p) return nothing();

  const actions = detachActions(snap, id);
  return {
    writes: [{ op: 'remove', col: 'projects', id: id }].concat(actions.writes),
    undo: [{ op: 'set', col: 'projects', id: id, data: docOf(p) }].concat(actions.undo),
    message: 'Project removed. Its action items stay in the list.'
  };
}

/**
 * Delete an issue. Its actions survive, detached. board.html:1405-1414.
 *
 * @param {Snapshot} snap
 * @param {string} id
 * @returns {Cascade}
 */
export function deleteIssue(snap, id) {
  const i = byId(snap.issues, id);
  if (!i) return nothing();

  const actions = detachActions(snap, id);
  return {
    writes: [{ op: 'remove', col: 'issues', id: id }].concat(actions.writes),
    undo: [{ op: 'set', col: 'issues', id: id, data: docOf(i) }].concat(actions.undo),
    message: 'Issue removed. Its action items stay in the list.'
  };
}

/**
 * Remove a person from the roster.
 *
 * Their work stays — actions record an owner by NAME, not by id, so an action keeps
 * saying who owned it after they have gone. That is the one upside of the
 * name-string design; everything else about it is a liability (see DATA_MODEL.md).
 *
 * What does cascade is meeting membership: they are pulled out of every tab's three
 * role lists.
 *
 * Undo writes those lists back WHOLESALE rather than re-adding just this person, so
 * if someone else changes a tab's membership between the delete and the undo, their
 * change is lost. Faithful to the original, and acceptable while one person drives
 * the board — but it is the kind of thing that starts to bite with several editors.
 * board.html:1471-1485.
 *
 * @param {Snapshot} snap
 * @param {string} id
 * @returns {Cascade}
 */
export function deletePerson(snap, id) {
  const p = byId(snap.people, id);
  if (!p) return nothing();

  const roles = ['members', 'support', 'optional'];
  const affected = snap.tabs.filter(function (t) {
    return roles.some(function (r) { return (t[r] || []).indexOf(id) >= 0; });
  });

  /** @type {Op[]} */
  const writes = [{ op: 'remove', col: 'people', id: id }];
  /** @type {Op[]} */
  const undo = [{ op: 'set', col: 'people', id: id, data: docOf(p) }];

  affected.forEach(function (t) {
    /** @type {any} */
    const without = {};
    /** @type {any} */
    const before = {};
    roles.forEach(function (r) {
      without[r] = (t[r] || []).filter(function (x) { return x !== id; });
      before[r] = (t[r] || []).slice();
    });
    writes.push({ op: 'update', col: 'tabs', id: t.id, patch: without });
    undo.push({ op: 'update', col: 'tabs', id: t.id, patch: before });
  });

  return { writes: writes, undo: undo, message: p.name + ' removed. Their items stay.' };
}

/**
 * Delete a whole meeting and everything filed under it.
 *
 * This is the big one: the tab, plus every entry, project, issue, action and rated
 * occurrence belonging to it. Fifty-plus writes on a board with any history.
 *
 * Note this does NOT detach actions the way deleting a project does — actions
 * belonging to a deleted meeting are deleted outright, because there is no longer a
 * meeting to review them in.
 *
 * With no transactions, a partial failure here leaves the board half-deleted, and
 * undo is the only way back. Worth wiring through a batched write and testing
 * against a meeting with real history. board.html:1447-1470.
 *
 * @param {Snapshot} snap
 * @param {string} tid
 * @returns {Cascade}
 */
export function deleteTab(snap, tid) {
  const t = byId(snap.tabs, tid);
  if (!t) return nothing();

  /** @type {Op[]} */
  const writes = [{ op: 'remove', col: 'tabs', id: tid }];
  /** @type {Op[]} */
  const undo = [{ op: 'set', col: 'tabs', id: tid, data: docOf(t) }];

  ['entries', 'projects', 'issues', 'actions'].forEach(function (col) {
    snap[col]
      .filter(function (x) { return x.tab === tid; })
      .forEach(function (x) {
        writes.push({ op: 'remove', col: col, id: x.id });
        undo.push({ op: 'set', col: col, id: x.id, data: docOf(x) });
      });
  });

  // Meetings are keyed 'tab|date' in memory but stored as 'tab@date', so each one
  // has to be translated rather than passed straight through.
  const prefix = tid + '|';
  Object.keys(snap.meetings)
    .filter(function (k) { return k.indexOf(prefix) === 0; })
    .forEach(function (k) {
      const date = k.slice(prefix.length);
      const id = documentId(tid, date);
      writes.push({ op: 'remove', col: 'meetings', id: id });
      undo.push({ op: 'set', col: 'meetings', id: id, data: snap.meetings[k] });
    });

  return {
    writes: writes,
    undo: undo,
    message: '“' + t.name + '” deleted with its items.'
  };
}

// Re-exported so cascade callers can build meeting keys without a second import.
export { documentId, memoryKey };
