// @ts-check
/**
 * Notes on a project — the running commentary that nothing else in the board holds.
 *
 * See the folder rules at the top of queries.js — no DOM, no store, pure functions.
 *
 * ## Why these are not meeting entries
 *
 * A win, a loss or an opportunity belongs to ONE meeting: it is what somebody said
 * that week, and next week's meeting starts clean. A note belongs to the project for
 * its whole life. "Supplier finally sent the data sheets" is not a thing you said in
 * a meeting; it is a fact about the project that is still true next month.
 *
 * ## Who may change one
 *
 * Only its author, and that is a **courtesy, not a control**. It stops people
 * accidentally rewriting each other's notes. SharePoint cannot express per-item
 * authorship without item-level permissions, so anyone with Contribute on the list
 * could still edit it directly. Worth knowing before anyone treats these as a record
 * that cannot be altered — they are not.
 *
 * ## What "until it is completed" means
 *
 * Once a project is done or cancelled its notes lock: they stay on the page as the
 * history of how it went, but nothing new can be added and nothing existing changed.
 * The record of a finished project is usually the most useful part of it later, so it
 * is kept rather than tidied away.
 */

import { ACTIVE_STATUSES } from './constants.js';

/**
 * @typedef {import('./queries.js').Snapshot} Snapshot
 */

/**
 * Every note on a project, newest first.
 *
 * Newest first because the page is glanced at far more often than it is read: the
 * thing you almost always want is what happened most recently, without scrolling.
 *
 * @param {Snapshot} snap
 * @param {string} projectId
 * @returns {any[]}
 */
export function notesFor(snap, projectId) {
  return (snap.projectNotes || [])
    .filter(function (n) { return n.projectId === projectId; })
    .sort(function (a, b) { return (a.created || '') < (b.created || '') ? 1 : -1; });
}

/**
 * Can notes still be added to or changed on this project?
 *
 * False once it is done or cancelled. A missing project reads as locked, because
 * writing a note against something that is not there cannot be right.
 *
 * @param {any} project
 * @returns {boolean}
 */
export function notesOpen(project) {
  return !!project && ACTIVE_STATUSES.indexOf(project.status) >= 0;
}

/**
 * May this person edit or remove this note?
 *
 * Author only, and only while the project is still live. Somebody who is not on the
 * roster has no person id, so they can add notes but not go back and change them —
 * which is the right way round: we cannot tell two such people apart.
 *
 * Remember this is enforced in the browser only. See the note at the top.
 *
 * @param {any} note
 * @param {string | null} personId
 * @param {any} project
 * @returns {boolean}
 */
export function canEditNote(note, personId, project) {
  if (!note || !personId) return false;
  if (!notesOpen(project)) return false;
  return note.authorId === personId;
}

/**
 * A new note.
 *
 * @param {object} args
 * @param {string} args.projectId
 * @param {string} args.text
 * @param {string | null} args.authorId
 * @param {string} args.now - an ISO timestamp
 * @returns {any | null} the document to write, or null if there is nothing to say
 */
export function newNote({ projectId, text, authorId, now }) {
  const body = String(text == null ? '' : text).trim();
  if (!body) return null;

  return {
    projectId: projectId,
    text: body,
    authorId: authorId || '',
    created: now
  };
}

/**
 * A note with its text changed.
 *
 * `created` is left alone — the note is still from when it was written — and
 * `edited` is stamped, so the page can say a note was changed rather than quietly
 * presenting the new wording as the original.
 *
 * @param {any} note
 * @param {string} text
 * @param {string} now
 * @returns {any | null} the document to write, or null if nothing should change
 */
export function editNote(note, text, now) {
  if (!note) return null;
  const body = String(text == null ? '' : text).trim();
  if (!body) return null;
  if (body === note.text) return null;   // nothing changed; do not stamp an edit

  const doc = JSON.parse(JSON.stringify(note));
  delete doc.id;
  doc.text = body;
  doc.edited = now;
  return doc;
}
