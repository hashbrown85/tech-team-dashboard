// @ts-check
/**
 * Project notes: the running commentary that belongs to a project rather than to
 * one meeting.
 *
 * Two rules here are worth defending. Only the author may change a note, which stops
 * people rewriting each other's words — though it is a courtesy and not a control,
 * for the reason set out in notes.js. And once a project is done or cancelled its
 * notes lock, so the record of how it went survives rather than continuing to drift.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { notesFor, notesOpen, canEditNote, newNote, editNote } from '../src/domain/notes.js';
import { demoBoard } from '../src/demo-data.js';
import { nowIso, fmtWhen, fmtStamp } from '../src/lib/dates.js';

const NOW = '2026-09-16T14:32:05.000Z';

function board() {
  return demoBoard();
}

function project(snap, id) {
  return snap.projects.find(function (p) { return p.id === id; });
}

group('Reading notes');

test('Notes come back newest first', () => {
  // The page is glanced at more than it is read, and what happened most recently is
  // almost always what you want without scrolling.
  const snap = board();
  const notes = notesFor(snap, 'pr2');

  ok(notes.length >= 2, 'the demo board has a few');
  for (let i = 1; i < notes.length; i++) {
    ok(notes[i - 1].created >= notes[i].created,
      notes[i - 1].created + ' should not be older than ' + notes[i].created);
  }
});

test('Only that project\'s notes come back', () => {
  const snap = board();
  eq(notesFor(snap, 'pr2').every(function (n) { return n.projectId === 'pr2'; }), true);
  eq(notesFor(snap, 'nothing-here'), []);
});

test('A board with no notes at all does not throw', () => {
  const snap = board();
  delete snap.projectNotes;
  eq(notesFor(snap, 'pr2'), [], 'an absent collection reads as none');
});

group('Writing notes');

test('A new note records who wrote it and when', () => {
  const doc = newNote({ projectId: 'pr1', text: 'Samples shipped', authorId: 'p1', now: NOW });

  eq(doc.projectId, 'pr1');
  eq(doc.text, 'Samples shipped');
  eq(doc.authorId, 'p1');
  eq(doc.created, NOW);
  notOk('edited' in doc, 'not edited until it is');
});

test('Empty or blank text writes nothing', () => {
  eq(newNote({ projectId: 'pr1', text: '   ', authorId: 'p1', now: NOW }), null);
  eq(newNote({ projectId: 'pr1', text: '', authorId: 'p1', now: NOW }), null);
});

test('Surrounding whitespace is trimmed', () => {
  eq(newNote({ projectId: 'pr1', text: '  spaced  ', authorId: 'p1', now: NOW }).text, 'spaced');
});

test('Somebody not on the roster can still write a note', () => {
  // They have no person id, so they cannot come back and edit it - which is right,
  // because two such people cannot be told apart.
  const doc = newNote({ projectId: 'pr1', text: 'from a visitor', authorId: null, now: NOW });
  eq(doc.authorId, '');
});

test('Editing keeps the original time and stamps the change', () => {
  const note = { id: 'n1', projectId: 'pr1', text: 'first', authorId: 'p1', created: NOW };
  const later = '2026-09-16T16:00:00.000Z';
  const doc = editNote(note, 'second', later);

  eq(doc.text, 'second');
  eq(doc.created, NOW, 'the note is still from when it was written');
  eq(doc.edited, later, 'and says it was changed');
  notOk('id' in doc, 'the id is not part of the stored document');
});

test('Editing to the same text changes nothing', () => {
  // Otherwise clicking into a note and out of it would mark it edited.
  const note = { id: 'n1', projectId: 'pr1', text: 'unchanged', authorId: 'p1', created: NOW };
  eq(editNote(note, 'unchanged', '2026-09-16T16:00:00.000Z'), null);
  eq(editNote(note, '  unchanged  ', '2026-09-16T16:00:00.000Z'), null, 'trimmed, too');
});

test('Editing to nothing is refused rather than blanking the note', () => {
  const note = { id: 'n1', projectId: 'pr1', text: 'something', authorId: 'p1', created: NOW };
  eq(editNote(note, '   ', '2026-09-16T16:00:00.000Z'), null);
});

group('Who may change a note');

test('The author may; nobody else may', () => {
  const snap = board();
  const p = project(snap, 'pr2');
  const note = notesFor(snap, 'pr2').find(function (n) { return n.authorId === 'p2'; });

  ok(canEditNote(note, 'p2', p), 'its author');
  notOk(canEditNote(note, 'p1', p), 'a colleague');
  notOk(canEditNote(note, null, p), 'somebody not on the roster');
});

test('Nobody may once the project is finished', () => {
  const snap = board();
  const note = notesFor(snap, 'pr2')[0];

  ['done', 'cancelled'].forEach(function (status) {
    const finished = Object.assign({}, project(snap, 'pr2'), { status: status });
    notOk(canEditNote(note, note.authorId, finished), 'not even the author, once ' + status);
  });
});

test('Notes are open while a project is live, and locked when it is not', () => {
  const snap = board();
  ['new', 'on', 'off', 'hold'].forEach(function (status) {
    ok(notesOpen(Object.assign({}, project(snap, 'pr1'), { status: status })), status);
  });
  ['done', 'cancelled'].forEach(function (status) {
    notOk(notesOpen(Object.assign({}, project(snap, 'pr1'), { status: status })), status);
  });
  notOk(notesOpen(null), 'and a project that is not there is not open');
});

group('Timestamps');

test('Recent moments read relatively, older ones by date', () => {
  const at = function (secondsAgo) {
    return new Date(Date.parse(NOW) - secondsAgo * 1000).toISOString();
  };

  eq(fmtWhen(at(10), NOW), 'just now');
  eq(fmtWhen(at(1200), NOW), '20 minutes ago');
  eq(fmtWhen(at(3600), NOW), '1 hour ago', 'singular');
  eq(fmtWhen(at(7200), NOW), '2 hours ago');
  ok(fmtWhen(at(200000), NOW).indexOf(',') > 0, 'over a day becomes a date and time');
});

test('A malformed or missing timestamp reads as empty, not as a crash', () => {
  eq(fmtWhen(''), '');
  eq(fmtWhen('not a date'), '');
  eq(fmtStamp('not a date'), '');
});

test('A timestamp in the future falls back to showing the date', () => {
  // Clock skew between two machines is real; "in -3 minutes" helps nobody.
  const ahead = new Date(Date.parse(NOW) + 60000).toISOString();
  ok(fmtWhen(ahead, NOW).indexOf(',') > 0);
});

test('nowIso produces something the formatters accept', () => {
  const now = nowIso();
  ok(/^\d{4}-\d{2}-\d{2}T/.test(now), 'ISO 8601');
  eq(fmtWhen(now, now), 'just now', 'and round-trips');
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
