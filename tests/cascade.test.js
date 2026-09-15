// @ts-check
/**
 * Tests for deleting things and taking it back.
 *
 * Written against rule 7 and rule 8 in docs/BUSINESS_RULES.md.
 *
 * The important ones here are the round trips: apply the writes, then apply the
 * undo, then check the board is byte-for-byte what it was. Undo is the only
 * rollback this app has, so "it mostly puts it back" is not good enough.
 */

import { group, test, eq, ok } from './harness.js';
import {
  deleteAction,
  deleteEntry,
  deleteProject,
  deleteIssue,
  deletePerson,
  deleteTab
} from '../src/domain/cascade.js';
import { memoryKey } from '../src/domain/meetings.js';

const MEETING = '2026-09-14';

/**
 * A board with one meeting and one of everything hanging off it, so a cascade has
 * something to cascade through.
 */
function board() {
  return {
    people: [
      { id: 'p1', name: 'First Person', title: 'Lead', home: 'North', detailAreas: ['t1'] },
      { id: 'p2', name: 'Second Person', title: 'Tech', home: 'South' }
    ],
    tabs: [
      { id: 't1', name: 'North Area', kind: 'area', weekday: 1, lengthMin: 60,
        members: ['p1', 'p2'], support: [], optional: ['p2'] },
      { id: 't2', name: 'Other Area', kind: 'area', weekday: 2, lengthMin: 30,
        members: ['p1'], support: [], optional: [] }
    ],
    entries: [
      { id: 'e1', tab: 't1', meeting: MEETING, personId: 'p1', kind: 'win', text: 'a win', why: 'luck' },
      { id: 'e2', tab: 't1', meeting: MEETING, personId: 'p1', kind: 'opp', text: 'an opp', why: 'hard', projectId: 'pr2' },
      { id: 'e3', tab: 't2', meeting: MEETING, personId: 'p1', kind: 'win', text: 'elsewhere' }
    ],
    projectDetails: [
      { id: 'pr1', estValue: 250000, winPct: 70, winReason: 'sensitive' },
      { id: 'pr3', estValue: 10000, winPct: 20, winReason: 'also sensitive' }
    ],
    projects: [
      { id: 'pr1', tab: 't1', personId: 'p1', name: 'live project', status: 'off', rank: 1000 },
      { id: 'pr2', tab: 't1', personId: 'p1', name: 'an opp', status: 'new', start: '2026-09-21', fromOpp: 'e2' },
      { id: 'pr3', tab: 't2', personId: 'p1', name: 'elsewhere', status: 'on' }
    ],
    issues: [
      { id: 'i1', tab: 't1', personId: 'p1', text: 'an issue', sev: 'stopper', status: 'open', meeting: MEETING, rank: 0.5 },
      { id: 'i2', tab: 't2', personId: 'p1', text: 'elsewhere', sev: 'risk', status: 'open', meeting: MEETING, rank: 1 }
    ],
    actions: [
      { id: 'a1', num: 1, tab: 't1', text: 'on the issue', owner: 'First Person', support: '', due: '2026-09-21', status: 'open', parent: { type: 'issue', id: 'i1' }, meeting: MEETING },
      { id: 'a2', num: 2, tab: 't1', text: 'on the project', owner: 'Second Person', support: '', due: '2026-09-21', status: 'open', parent: { type: 'project', id: 'pr1' }, meeting: MEETING },
      { id: 'a3', num: 3, tab: 't1', text: 'unattached', owner: 'First Person', support: '', due: '2026-09-28', status: 'open', parent: null, meeting: MEETING },
      { id: 'a4', num: 4, tab: 't2', text: 'elsewhere', owner: 'First Person', support: '', due: '2026-09-21', status: 'open', parent: null, meeting: MEETING }
    ],
    meetings: {
      't1|2026-09-14': { ratings: { p1: 4, p2: 5 }, note: 'go faster' },
      't1|2026-09-07': { ratings: { p1: 3 }, note: '' },
      't2|2026-09-14': { ratings: { p1: 5 }, note: 'elsewhere' }
    },
    settings: {}
  };
}

/** Apply a list of cascade operations to a snapshot, the way a store would. */
function apply(snap, ops) {
  ops.forEach(function (op) {
    if (op.col === 'meetings') {
      // Stored as 'tab@date', held in memory as 'tab|date'.
      const at = op.id.indexOf('@');
      const key = op.id.slice(0, at) + '|' + op.id.slice(at + 1);
      if (op.op === 'remove') delete snap.meetings[key];
      else if (op.op === 'set') snap.meetings[key] = JSON.parse(JSON.stringify(op.data));
      else Object.assign(snap.meetings[key], op.patch);
      return;
    }
    const arr = snap[op.col];
    const i = arr.findIndex(function (x) { return x.id === op.id; });
    if (op.op === 'remove') {
      if (i >= 0) arr.splice(i, 1);
    } else if (op.op === 'set') {
      const doc = Object.assign({ id: op.id }, JSON.parse(JSON.stringify(op.data)));
      if (i >= 0) arr[i] = doc; else arr.push(doc);
    } else if (op.op === 'update') {
      if (i >= 0) Object.assign(arr[i], JSON.parse(JSON.stringify(op.patch)));
    }
  });
}

/**
 * Compare two boards ignoring the order records happen to sit in.
 *
 * Both the arrays AND the meetings object need sorting: deleting a meeting and
 * restoring it changes the object's key insertion order, which JSON.stringify
 * preserves, so an identical board would otherwise compare unequal.
 */
function normalise(snap) {
  const meetings = {};
  Object.keys(snap.meetings).sort().forEach(function (k) { meetings[k] = snap.meetings[k]; });
  const out = { meetings: meetings, settings: snap.settings };
  ['people', 'tabs', 'entries', 'projects', 'projectDetails', 'issues', 'actions'].forEach(function (col) {
    out[col] = snap[col].slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  });
  return JSON.parse(JSON.stringify(out));
}

/** Delete, then undo, then assert nothing changed. */
function roundTrip(fn, ...args) {
  const snap = board();
  const before = normalise(snap);
  const c = fn(snap, ...args);
  apply(snap, c.writes);
  apply(snap, c.undo);
  eq(normalise(snap), before, 'undo must restore the board exactly');
  return c;
}

const ids = (arr) => arr.map((x) => x.id).sort();

/* ---------- actions ---------- */

group('Deleting an action');

test('It goes, and nothing else does', () => {
  const snap = board();
  const c = deleteAction(snap, 'a3');
  apply(snap, c.writes);

  eq(c.writes.length, 1);
  eq(snap.actions.length, 3);
  eq(c.message, 'A-003 deleted.', 'the message names it the way the room does');
});

test('Undo restores it exactly', () => {
  roundTrip(deleteAction, 'a1');
});

test('Deleting something that is not there does nothing at all', () => {
  const snap = board();
  const c = deleteAction(snap, 'nope');
  eq(c.writes, []);
  eq(c.undo, []);
  eq(c.message, '');
});

/* ---------- rule 7: the work survives its parent ---------- */

group('Rule 7 — deleting a parent keeps the work');

test('20. Deleting a project detaches its actions rather than deleting them', () => {
  const snap = board();
  const c = deleteProject(snap, 'pr1');
  apply(snap, c.writes);

  eq(snap.projects.some((p) => p.id === 'pr1'), false, 'the project is gone');
  const a2 = snap.actions.find((a) => a.id === 'a2');
  ok(a2, 'but its action survives');
  eq(a2.parent, null, 'detached');
  ok(c.message.indexOf('stay in the list') > 0, 'and the message says so');
});

test('20b. Undo restores the project AND reattaches its actions', () => {
  const c = roundTrip(deleteProject, 'pr1');
  // The undo must restore the original parent object, not merely leave it null.
  const reattach = c.undo.find((op) => op.col === 'actions' && op.id === 'a2');
  eq(reattach.patch, { parent: { type: 'project', id: 'pr1' } });
});

test('Deleting an issue behaves the same way', () => {
  const snap = board();
  const c = deleteIssue(snap, 'i1');
  apply(snap, c.writes);

  eq(snap.issues.some((i) => i.id === 'i1'), false);
  eq(snap.actions.find((a) => a.id === 'a1').parent, null);
  eq(snap.actions.length, 4, 'no action was deleted');
});

test('Undo of an issue delete round-trips', () => {
  roundTrip(deleteIssue, 'i1');
});

test('Unattached actions are left completely alone', () => {
  const snap = board();
  const c = deleteProject(snap, 'pr1');
  const touched = c.writes.filter((w) => w.col === 'actions').map((w) => w.id);
  eq(touched, ['a2'], 'only the action pointing at pr1');
});

/* ---------- rule 5: opportunity entries ---------- */

group('Deleting a log entry');

test('22. An untouched opportunity takes its project with it', () => {
  const snap = board();
  const c = deleteEntry(snap, 'e2');
  apply(snap, c.writes);

  eq(snap.entries.some((e) => e.id === 'e2'), false);
  eq(snap.projects.some((p) => p.id === 'pr2'), false, 'the unworked project goes too');
});

test('22b. And undo brings both back', () => {
  roundTrip(deleteEntry, 'e2');
});

test('A plain win takes nothing with it', () => {
  const snap = board();
  const c = deleteEntry(snap, 'e1');
  eq(c.writes.length, 1);
  eq(c.writes[0].col, 'entries');
});

test('An opportunity whose project has been worked on leaves the project alone', () => {
  const snap = board();
  snap.projects.find((p) => p.id === 'pr2').status = 'on';

  const c = deleteEntry(snap, 'e2');
  eq(c.writes.length, 1, 'only the entry');
  apply(snap, c.writes);
  ok(snap.projects.some((p) => p.id === 'pr2'), 'the project survives');
});

/* ---------- people ---------- */

group('Sensitive project details go with their project');

test('Deleting a project removes its value and confidence too', () => {
  // Otherwise the figures outlive the project they described, sitting in a list
  // nobody is looking at any more.
  const snap = board();
  const c = deleteProject(snap, 'pr1');
  apply(snap, c.writes);

  eq(snap.projectDetails.map(function (d) { return d.id; }), ['pr3'], 'pr1 details gone');
  ok(c.writes.some(function (w) { return w.col === 'projectDetails' && w.id === 'pr1'; }));
});

test('And undo brings them back', () => {
  roundTrip(deleteProject, 'pr1');
});

test('Deleting a meeting removes details for its projects, and only those', () => {
  const snap = board();
  const c = deleteTab(snap, 't1');
  apply(snap, c.writes);

  // pr1 belongs to t1 and goes; pr3 belongs to t2 and must not be touched.
  eq(snap.projectDetails.map(function (d) { return d.id; }), ['pr3'],
    'another meeting keeps its own figures');
});

test('And undo restores those too', () => {
  roundTrip(deleteTab, 't1');
});

test('A project with no details recorded deletes cleanly', () => {
  const snap = board();
  const c = deleteProject(snap, 'pr2');
  eq(c.writes.filter(function (w) { return w.col === 'projectDetails'; }), []);
});

group('Removing a person');

test('They leave every meeting they were in, but their work stays', () => {
  const snap = board();
  const c = deletePerson(snap, 'p2');
  apply(snap, c.writes);

  eq(snap.people.some((p) => p.id === 'p2'), false);
  const t1 = snap.tabs.find((t) => t.id === 't1');
  eq(t1.members, ['p1'], 'pulled out of members');
  eq(t1.optional, [], 'and out of optional');
  eq(snap.actions.length, 4, 'no action deleted');
  eq(
    snap.actions.find((a) => a.id === 'a2').owner,
    'Second Person',
    'their name stays on work they owned - actions store names, not ids'
  );
});

test('Only the tabs they were actually in are written to', () => {
  const snap = board();
  const c = deletePerson(snap, 'p2');
  const tabsTouched = c.writes.filter((w) => w.col === 'tabs').map((w) => w.id);
  eq(tabsTouched, ['t1'], 'p2 was never in t2');
});

test('Undo restores the person and every membership list', () => {
  roundTrip(deletePerson, 'p2');
});

test('Undo restores membership for someone in several meetings', () => {
  roundTrip(deletePerson, 'p1');
});

/* ---------- the big one ---------- */

group('Rule 7 — deleting a whole meeting');

test('21. Everything filed under that meeting goes', () => {
  const snap = board();
  const c = deleteTab(snap, 't1');
  apply(snap, c.writes);

  eq(snap.tabs.map((t) => t.id), ['t2'], 'the tab');
  eq(ids(snap.entries), ['e3'], 'its entries');
  eq(ids(snap.projects), ['pr3'], 'its projects');
  eq(ids(snap.issues), ['i2'], 'its issues');
  eq(ids(snap.actions), ['a4'], 'its actions, deleted outright rather than detached');
  eq(Object.keys(snap.meetings), ['t2|2026-09-14'], 'and every rated occurrence');
});

test('Both of that tab\'s rated occurrences are removed, not just the current one', () => {
  const snap = board();
  const c = deleteTab(snap, 't1');
  const meetingWrites = c.writes.filter((w) => w.col === 'meetings').map((w) => w.id).sort();

  eq(meetingWrites, ['t1@2026-09-07', 't1@2026-09-14'],
    'and written as tab@date, not the in-memory tab|date');
});

test('21b. Undo restores all of it, exactly', () => {
  const c = roundTrip(deleteTab, 't1');
  ok(c.writes.length >= 11, 'a real cascade: ' + c.writes.length + ' writes');
  eq(c.writes.length, c.undo.length, 'one undo for every write');
});

test('Another meeting is left untouched', () => {
  const snap = board();
  const c = deleteTab(snap, 't1');
  const other = c.writes.filter(function (w) {
    return ['e3', 'pr3', 'i2', 'a4', 't2'].indexOf(w.id) >= 0;
  });
  eq(other, [], 'nothing belonging to t2 is written');
});

test('The message names the meeting, in quotes', () => {
  const snap = board();
  eq(deleteTab(snap, 't1').message, '“North Area” deleted with its items.');
});

test('Deleting an empty meeting is just the one write', () => {
  const snap = board();
  snap.tabs.push({ id: 't3', name: 'Empty', kind: 'internal', weekday: 3,
                   lengthMin: 30, members: [], support: [], optional: [] });
  const c = deleteTab(snap, 't3');
  eq(c.writes.length, 1);
});

/* ---------- rule 8: what undo requires of the store ---------- */

group('Rule 8 — what undo requires of the store');

test('Every restoring write names the ORIGINAL id', () => {
  // If a store assigned its own ids on insert, undo would restore the records as
  // orphans: everything pointing at them points by id.
  const snap = board();
  const c = deleteTab(snap, 't1');

  const sets = c.undo.filter((op) => op.op === 'set');
  ok(sets.length > 0);
  ok(sets.every((op) => typeof op.id === 'string' && op.id.length > 0),
    'each set carries the id to write it back under');
});

test('Restored documents never carry an id inside the document body', () => {
  const snap = board();
  const c = deleteTab(snap, 't1');

  c.undo
    .filter((op) => op.op === 'set' && op.col !== 'meetings')
    .forEach(function (op) {
      eq('id' in op.data, false, op.col + '/' + op.id + ' should have no inner id');
    });
});

test('A cascade never writes the same record twice', () => {
  // Order of application would then matter, and a store batching them could apply
  // them in any order.
  const snap = board();
  ['t1'].forEach(function (tid) {
    const c = deleteTab(snap, tid);
    const keys = c.writes.map((w) => w.col + '/' + w.id);
    eq(keys.length, new Set(keys).size, 'no duplicate targets in writes');
    const undoKeys = c.undo.map((w) => w.col + '/' + w.id);
    eq(undoKeys.length, new Set(undoKeys).size, 'nor in undo');
  });
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
