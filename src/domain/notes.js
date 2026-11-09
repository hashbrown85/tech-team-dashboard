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
 * **Anybody who can edit the board may edit any note**, and every edit keeps the
 * wording it replaced - who wrote it and when - in `history`, newest first. So a
 * correction never loses what was there: the page offers "show earlier". It used
 * to be author-only, and on a board with nobody chosen under "You are" that meant
 * nobody at all could edit a note.
 *
 * **Removing** a note is still its author's alone, because removing takes the
 * history with it. Both rules are courtesies, not controls: SharePoint cannot
 * express per-item authorship, so anyone with Contribute on the list could still
 * change it directly.
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
 * May this note be edited? By anybody, while the project is still live - the
 * history keeps what each edit replaced. See the note at the top.
 *
 * @param {any} note
 * @param {any} project
 * @returns {boolean}
 */
export function canEditNote(note, project) {
  return !!note && notesOpen(project);
}

/**
 * May this person remove this note? Its author only, while the project is live:
 * removing it takes its history with it. Somebody not on the roster has no person
 * id, so cannot remove anything - we cannot tell two such people apart.
 *
 * @param {any} note
 * @param {string | null} personId
 * @param {any} project
 * @returns {boolean}
 */
export function canRemoveNote(note, personId, project) {
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
 * `edited` / `editedBy` are stamped, so the page can say a note was changed and by
 * whom. The wording being replaced goes onto `history` (newest first) with when it
 * was written and by whom, which is what the page's "show earlier" lists.
 *
 * @param {any} note
 * @param {string} text
 * @param {string} now
 * @returns {any | null} the document to write, or null if nothing should change
 */
export function editNote(note, text, now, editorId) {
  if (!note) return null;
  const body = String(text == null ? '' : text).trim();
  if (!body) return null;
  if (body === note.text) return null;   // nothing changed; do not stamp an edit

  const doc = JSON.parse(JSON.stringify(note));
  delete doc.id;
  doc.history = [{
    text: note.text,
    at: note.edited || note.created || '',
    by: (note.edited ? note.editedBy : note.authorId) || ''
  }].concat(note.history || []);
  doc.text = body;
  doc.edited = now;
  doc.editedBy = editorId || '';
  return doc;
}
