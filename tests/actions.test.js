// @ts-check
/**
 * Tests for the auto-resolve rule and action creation.
 *
 * Written against rule 2 in docs/BUSINESS_RULES.md. Several of these exist
 * specifically to stop a future contributor "tidying up" behaviour that is
 * deliberate — test 9 in particular.
 *
 * Numbering matches the test list in the porting plan.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { issueItems, actionedItems } from '../src/domain/queries.js';
import {
  actionLabel,
  parseParentRef,
  wouldGainPath,
  newAction,
  toggleDone,
  changeDue,
  orphanActionsOf
} from '../src/domain/actions.js';

const MEETING = '2026-09-14';
const TODAY = '2026-09-16';
const WHEN = { today: TODAY, issueMeetingDate: MEETING };

function emptyBoard() {
  return {
    people: [], tabs: [], entries: [], projects: [], issues: [],
    actions: [], meetings: {}, settings: {}
  };
}

function anIssue(over) {
  return Object.assign(
    { id: 'i1', tab: 't1', personId: 'p1', text: 'an issue', sev: 'risk',
      status: 'open', meeting: '2026-09-07', rank: 1 },
    over
  );
}

function anAction(over) {
  return Object.assign(
    { id: 'a1', num: 1, tab: 't1', text: 'do the thing', owner: 'Someone',
      support: '', due: '2026-09-21', status: 'open', parent: null,
      meeting: MEETING },
    over
  );
}

/** Apply a toggle to the snapshot the way the store would, and hand back the result. */
function tick(snap, action, done) {
  const out = toggleDone(snap, action, done, WHEN);

  const ai = snap.actions.findIndex((a) => a.id === action.id);
  if (ai >= 0) snap.actions[ai] = Object.assign({ id: action.id }, out.action);

  if (out.issue) {
    const ii = snap.issues.findIndex((i) => i.id === out.issue.id);
    if (ii >= 0) snap.issues[ii] = Object.assign({ id: out.issue.id }, out.issue.doc);
  }
  return out;
}

const idsIn = (items) => items.map((it) => it.o.id);

/* ---------- rule 2: auto-resolve ---------- */

group('Rule 2 — closing the last action resolves the issue');

test('6. Closing the last open action auto-resolves the issue', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'issue', id: 'i1' } }));

  const out = tick(snap, snap.actions[0], true);

  eq(out.effect, 'resolved');
  eq(out.action.status, 'done');
  eq(out.action.doneOn, TODAY, 'stamped with today, not the meeting date');
  eq(out.issue.doc.status, 'resolved');
  eq(out.issue.doc.resolvedMeeting, MEETING, 'but the issue records the meeting');
  eq(out.issue.doc.autoResolved, true, 'marked so unticking can undo it');
  eq(idsIn(issueItems(snap, 't1')), [], 'and it is out of the queue');
});

test('7. Unticking that action reopens the issue, and clears the marker', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'issue', id: 'i1' } }));

  tick(snap, snap.actions[0], true);
  const out = tick(snap, snap.actions[0], false);

  eq(out.effect, 'reopened');
  eq(out.issue.doc.status, 'open');
  eq('resolvedMeeting' in out.issue.doc, false);
  eq('autoResolved' in out.issue.doc, false);
  eq('doneOn' in out.action, false, 'and the action is open again');

  // Note it does NOT go back into the unpathed queue: the action is open again, so
  // the issue has a path again. It reappears as "moved, now tracked as actions".
  eq(idsIn(issueItems(snap, 't1')), [], 'not in the queue - it has an open action');
  eq(idsIn(actionedItems(snap, 't1')), ['i1'], 'shown as having a path again');
});

test('An auto-reopen keeps the issue where it was in the queue', () => {
  // Deliberately unlike a MANUAL reopen, which sends it to the bottom. Nothing
  // about the issue changed here — someone just unticked a box.
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 3 }));
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'issue', id: 'i1' } }));

  tick(snap, snap.actions[0], true);
  const out = tick(snap, snap.actions[0], false);

  eq(out.issue.doc.rank, 3, 'not 1e6');
});

test('8. A MANUALLY resolved issue stays resolved when an action is unticked', () => {
  // This is the guard that `autoResolved` exists for. Without it, unticking a box
  // would silently overturn a human's decision to close an issue.
  const snap = emptyBoard();
  snap.issues.push(
    anIssue({ id: 'i1', status: 'resolved', resolvedMeeting: MEETING })
    // note: no autoResolved flag — a person closed this one
  );
  snap.actions.push(
    anAction({ id: 'a1', status: 'done', doneOn: TODAY, parent: { type: 'issue', id: 'i1' } })
  );

  const out = tick(snap, snap.actions[0], false);

  eq(out.effect, null, 'nothing happens to the issue');
  eq(out.issue, null);
  eq(snap.issues[0].status, 'resolved', 'the human decision stands');
});

test('9. An off-track PROJECT is never auto-resolved — this asymmetry is deliberate', () => {
  // A project is only back on track when someone says so in the meeting. If you
  // "fix" this to match issues, projects start quietly marking themselves healthy
  // the moment their last action closes.
  const snap = emptyBoard();
  snap.projects.push({
    id: 'pr1', tab: 't1', personId: 'p1', name: 'a project', status: 'off', rank: 1000
  });
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'project', id: 'pr1' } }));

  const out = tick(snap, snap.actions[0], true);

  eq(out.effect, null, 'no side effect on the project');
  eq(out.issue, null);
  eq(snap.projects[0].status, 'off', 'still off track');
  eq(idsIn(issueItems(snap, 't1')), ['pr1'], 'and back in the queue needing a new path');
});

test('It is the parent TYPE that decides, not just the id', () => {
  // `parent` is polymorphic - it points into either issues or projects - so the
  // type field is what disambiguates it. Here an issue and a project deliberately
  // share an id, which real uid()s would never do. The action points at the
  // PROJECT, so nothing may happen to the identically-named issue.
  //
  // This is the test that fails if someone removes the parent.type check and
  // relies on "the id won't be found in issues anyway". It would be found here.
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'shared', status: 'open' }));
  snap.projects.push({
    id: 'shared', tab: 't1', personId: 'p1', name: 'a project', status: 'off',
    rank: 1000
  });
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'project', id: 'shared' } }));

  const out = tick(snap, snap.actions[0], true);

  eq(out.effect, null, 'a project parent must never resolve anything');
  eq(out.issue, null);
  eq(snap.issues[0].status, 'open', 'the issue sharing the id is untouched');
});

test('With another action still open, closing one resolves nothing', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.actions.push(
    anAction({ id: 'a1', parent: { type: 'issue', id: 'i1' } }),
    anAction({ id: 'a2', parent: { type: 'issue', id: 'i1' } })
  );

  const out = tick(snap, snap.actions[0], true);

  eq(out.effect, null, 'work remains, so the issue is not resolved');
  eq(snap.issues[0].status, 'open');
  eq(idsIn(actionedItems(snap, 't1')), ['i1'], 'still shown as having a path');
});

test('Closing the second of two actions does resolve it', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.actions.push(
    anAction({ id: 'a1', parent: { type: 'issue', id: 'i1' } }),
    anAction({ id: 'a2', parent: { type: 'issue', id: 'i1' } })
  );

  tick(snap, snap.actions[0], true);
  const out = tick(snap, snap.actions[1], true);

  eq(out.effect, 'resolved');
  eq(snap.issues[0].autoResolved, true);
});

test('An action with no parent resolves nothing', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.actions.push(anAction({ id: 'a1', parent: null }));

  const out = tick(snap, snap.actions[0], true);
  eq(out.effect, null);
  eq(out.action.status, 'done', 'the action still closes normally');
});

test('An action pointing at a deleted issue closes without throwing', () => {
  const snap = emptyBoard();
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'issue', id: 'gone' } }));

  const out = tick(snap, snap.actions[0], true);
  eq(out.effect, null);
  eq(out.action.status, 'done');
});

test('Already-resolved and re-ticked: no second resolve', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', status: 'resolved', autoResolved: true }));
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'issue', id: 'i1' } }));

  const out = tick(snap, snap.actions[0], true);
  eq(out.effect, null, 'the issue is not open, so there is nothing to resolve');
});

test('Falls back to today when the issue meeting date is unknown', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'issue', id: 'i1' } }));

  const out = toggleDone(snap, snap.actions[0], true, { today: TODAY });
  eq(out.issue.doc.resolvedMeeting, TODAY, 'when the tab has gone, use today');
});

/* ---------- creating actions ---------- */

group('Creating an action');

test('An action records its owner by name, and starts open', () => {
  const a = newAction({
    num: 47, tab: 't1', text: 'chase the supplier', owner: 'A Person',
    due: '2026-09-28', parent: null, meetingDate: MEETING
  });

  eq(a.num, 47);
  eq(a.status, 'open');
  eq(a.owner, 'A Person', 'a name, not an id — see DATA_MODEL.md');
  eq(a.support, '', 'absent support becomes an empty string');
  eq(a.parent, null);
  eq(a.meeting, MEETING);
});

test('Action numbers are spoken aloud, so they are zero-padded to three digits', () => {
  eq(actionLabel({ num: 7 }), 'A-007');
  eq(actionLabel({ num: 47 }), 'A-047');
  eq(actionLabel({ num: 1234 }), 'A-1234', 'and not truncated past three');
  eq(actionLabel({}), 'A-000', 'a record with no number still renders');
});

test('The parent dropdown value resolves to a typed pointer', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.projects.push({ id: 'pr1', tab: 't1', name: 'p', status: 'off' });

  eq(parseParentRef(snap, 'i:i1'), { type: 'issue', id: 'i1' });
  eq(parseParentRef(snap, 'p:pr1'), { type: 'project', id: 'pr1' });
  eq(parseParentRef(snap, ''), null);
  eq(parseParentRef(snap, undefined), null);
});

test('A parent that no longer exists becomes null, not a dangling pointer', () => {
  const snap = emptyBoard();
  eq(parseParentRef(snap, 'i:vanished'), null);
  eq(parseParentRef(snap, 'p:vanished'), null);
});

test('wouldGainPath is true only for something currently in the queue', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }), anIssue({ id: 'i2' }));
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'issue', id: 'i2' } }));

  ok(wouldGainPath(snap, 't1', { id: 'i1' }), 'i1 has no path yet');
  notOk(wouldGainPath(snap, 't1', { id: 'i2' }), 'i2 already has one');
  notOk(wouldGainPath(snap, 't1', null), 'and an action with no parent gains nothing');
});

test('Changing a due date leaves everything else alone', () => {
  const a = anAction({ id: 'a1', due: '2026-09-21', status: 'open' });
  const out = changeDue(a, '2026-10-05');

  eq(out.due, '2026-10-05');
  eq(out.status, 'open');
  eq('id' in out, false, 'the id is not part of the stored document');
});

/* ---------- rule 7: orphaning ---------- */

group('Rule 7 — deleting a parent keeps the work');

test('Actions are detached, not deleted, when their parent goes', () => {
  const snap = emptyBoard();
  snap.actions.push(
    anAction({ id: 'a1', parent: { type: 'project', id: 'pr1' } }),
    anAction({ id: 'a2', parent: { type: 'project', id: 'pr1' } }),
    anAction({ id: 'a3', parent: { type: 'issue', id: 'i1' } }),
    anAction({ id: 'a4', parent: null })
  );

  const writes = orphanActionsOf(snap, 'pr1');

  eq(writes.length, 2, 'only the two pointing at pr1');
  eq(writes.map((w) => w.id), ['a1', 'a2']);
  eq(writes[0].patch, { parent: null }, 'detached, and every write is to actions');
  eq(writes.every((w) => w.col === 'actions'), true);
});

test('A parent with no actions produces no writes', () => {
  const snap = emptyBoard();
  eq(orphanActionsOf(snap, 'pr1'), []);
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
