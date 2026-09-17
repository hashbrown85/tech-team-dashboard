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
import {
  linkedProjectGoesToo, RENAMEABLE_LISTS, valueKey
} from './projects.js';

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
 * The writes that remove a project's sensitive details, and the undo that restores
 * them.
 *
 * Easy to forget, and the consequence of forgetting is the worst kind: the value
 * and confidence figures would outlive the project they described, sitting in a
 * list nobody is looking at any more.
 *
 * @param {Snapshot} snap
 * @param {string} projectId
 * @returns {{writes: Op[], undo: Op[]}}
 */
function removeDetailsFor(snap, projectId) {
  const details = byId(snap.projectDetails || [], projectId);
  if (!details) return { writes: [], undo: [] };
  return {
    writes: [{ op: /** @type {'remove'} */ ('remove'), col: 'projectDetails', id: projectId }],
    undo: [{ op: /** @type {'set'} */ ('set'), col: 'projectDetails', id: projectId, data: docOf(details) }]
  };
}

/**
 * The writes that remove a project's notes, and the undo that restores them.
 *
 * Notes belong to the project for its whole life, so they go when it does -
 * otherwise a page of commentary survives with nothing left to describe.
 *
 * @param {Snapshot} snap
 * @param {string} projectId
 * @returns {{writes: Op[], undo: Op[]}}
 */
function removeNotesFor(snap, projectId) {
  const notes = (snap.projectNotes || []).filter(function (n) {
    return n.projectId === projectId;
  });
  return {
    writes: notes.map(function (n) {
      return { op: /** @type {'remove'} */ ('remove'), col: 'projectNotes', id: n.id };
    }),
    undo: notes.map(function (n) {
      return { op: /** @type {'set'} */ ('set'), col: 'projectNotes', id: n.id, data: docOf(n) };
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
export function deleteNote(snap, id) {
  const n = byId(snap.projectNotes, id);
  if (!n) return nothing();

  return {
    writes: [{ op: 'remove', col: 'projectNotes', id: id }],
    undo: [{ op: 'set', col: 'projectNotes', id: id, data: docOf(n) }],
    message: 'Note removed.'
  };
}

/**
 * Remove a project.
 *
 * @param {Snapshot} snap
 * @param {string} id
 */
export function deleteProject(snap, id) {
  const p = byId(snap.projects, id);
  if (!p) return nothing();

  const actions = detachActions(snap, id);
  const details = removeDetailsFor(snap, id);
  const notes = removeNotesFor(snap, id);
  return {
    writes: [{ op: 'remove', col: 'projects', id: id }]
      .concat(details.writes).concat(notes.writes).concat(actions.writes),
    undo: [{ op: 'set', col: 'projects', id: id, data: docOf(p) }]
      .concat(details.undo).concat(notes.undo).concat(actions.undo),
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

        // A project's value, confidence and notes go with it, or they would
        // outlive the meeting entirely.
        if (col === 'projects') {
          [removeDetailsFor(snap, x.id), removeNotesFor(snap, x.id)].forEach(function (r) {
            r.writes.forEach(function (w) { writes.push(w); });
            r.undo.forEach(function (w) { undo.push(w); });
          });
        }
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

/**
 * Rename one value of a settings list, everywhere it is used.
 *
 * This is what makes a self-growing list safe to have. Anybody typing a new Field on
 * a project adds it to the shared list, so a slip becomes shared vocabulary - and the
 * only honest answer to that is being able to correct it in one action rather than
 * retyping it on every project that caught it.
 *
 * There is a precedent: renaming a PERSON rewrites every action they own, because
 * actions store an owner by name. Projects store these the same way, so the same
 * cascade is needed.
 *
 * ## Two shapes
 *
 * `field` and `projectType` hold a single string on a project; `focus` and
 * `resources` hold an array. Both are handled, and the array case de-duplicates:
 * a project tagged both "Coatngs" and "Coatings" must end up with one, not two.
 *
 * ## Merging is the point
 *
 * Renaming onto a value the list already holds is not an error to refuse - it is the
 * fix for a typo that has already spread. The old entry leaves the list, its projects
 * move across, and the message says how many did.
 *
 * @param {Snapshot} snap
 * @param {string} key - one of RENAMEABLE_LISTS
 * @param {string} from - the value as it is stored on the list
 * @param {string} to - what it should read instead
 * @returns {Cascade}
 */
export function renameListValue(snap, key, from, to) {
  const spec = RENAMEABLE_LISTS[key];
  if (!spec) return nothing();

  const target = String(to == null ? '' : to).trim();
  const fromKey = valueKey(from);
  if (!target || !fromKey) return nothing();

  const items = (snap.settings[key] && snap.settings[key].items) || [];

  // If the list already holds the target, adopt ITS spelling and merge into it.
  const existing = items.filter(function (x) {
    return valueKey(x) === valueKey(target) && valueKey(x) !== fromKey;
  })[0];
  const finalValue = existing == null ? target : String(existing);

  if (valueKey(finalValue) === fromKey && finalValue === String(from)) return nothing();

  const nextItems = [];
  items.forEach(function (x) {
    if (valueKey(x) === fromKey) {
      // The renamed entry, unless the target is already further down the list.
      if (existing == null) nextItems.push(finalValue);
      return;
    }
    nextItems.push(x);
  });

  /** @type {Op[]} */
  const writes = [{ op: 'set', col: 'settings', id: key, data: { items: nextItems } }];
  /** @type {Op[]} */
  const undo = [{ op: 'set', col: 'settings', id: key, data: { items: items.slice() } }];

  let moved = 0;
  (snap.projects || []).forEach(function (p) {
    const held = p[key];

    if (spec.multi) {
      const list = Array.isArray(held) ? held : [];
      if (!list.some(function (x) { return valueKey(x) === fromKey; })) return;

      // Rename in place, then drop any duplicate the merge just created.
      const seen = {};
      const next = [];
      list.forEach(function (x) {
        const v = valueKey(x) === fromKey ? finalValue : x;
        const k = valueKey(v);
        if (seen[k]) return;
        seen[k] = true;
        next.push(v);
      });

      // A project already holding the final spelling changes nothing. Writing it
      // anyway is harmless but the COUNT is not - "3 projects moved" when one did
      // is a message that cannot be checked against what you see.
      if (next.length === list.length &&
          next.every(function (v, i) { return v === list[i]; })) return;

      const patch = {};
      patch[key] = next;
      const before = {};
      before[key] = list.slice();
      writes.push({ op: 'update', col: 'projects', id: p.id, patch: patch });
      undo.push({ op: 'update', col: 'projects', id: p.id, patch: before });
      moved++;
      return;
    }

    if (valueKey(held) !== fromKey) return;
    if (held === finalValue) return;             // already spelled that way

    const patch = {};
    patch[key] = finalValue;
    const before = {};
    before[key] = held;
    writes.push({ op: 'update', col: 'projects', id: p.id, patch: patch });
    undo.push({ op: 'update', col: 'projects', id: p.id, patch: before });
    moved++;
  });

  const what = moved === 1 ? '1 project' : moved + ' projects';
  const message = existing == null
    ? 'Renamed to ' + finalValue + '. ' + what + ' updated.'
    : 'Merged into ' + finalValue + '. ' + what + ' moved.';

  return { writes: writes, undo: undo, message: message };
}
