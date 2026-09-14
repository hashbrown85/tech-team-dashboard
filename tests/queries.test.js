// @ts-check
/**
 * Tests for the board's rules.
 *
 * These are written against docs/BUSINESS_RULES.md. If one of them fails, the
 * question to ask is "did I break a rule?" not "is this test stale" — the rules
 * were derived from the working app, and nothing else records them.
 *
 * Numbering matches the test list in the porting plan, so gaps are expected while
 * the extraction is still in progress.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import {
  isOpen,
  openActsFor,
  issueItems,
  actionedItems,
  actsOf,
  projVisible
} from '../src/domain/queries.js';

/* ---------- helpers for building test data ---------- */

/**
 * An empty board. Same shape as blank() in board.html.
 * @returns {import('../src/domain/queries.js').Snapshot}
 */
function emptyBoard() {
  return {
    people: [],
    tabs: [],
    entries: [],
    projects: [],
    issues: [],
    actions: [],
    meetings: {},
    settings: {}
  };
}

function anIssue(over) {
  return Object.assign(
    { id: 'i1', tab: 't1', personId: 'p1', text: 'an issue', sev: 'risk',
      status: 'open', meeting: '2026-09-07', rank: 1 },
    over
  );
}

function aProject(over) {
  return Object.assign(
    { id: 'pr1', tab: 't1', personId: 'p1', name: 'a project', status: 'on',
      added: '2026-09-07' },
    over
  );
}

function anAction(over) {
  return Object.assign(
    { id: 'a1', num: 1, tab: 't1', text: 'do the thing', owner: 'Someone',
      support: '', due: '2026-09-21', status: 'open', parent: null,
      meeting: '2026-09-07' },
    over
  );
}

/** Just the ids in the queue, which is what most assertions care about. */
function idsIn(items) {
  return items.map((it) => it.o.id);
}

/* ---------- rule 1: an issue has a path if an open action points at it ---------- */

group('Rule 1 — "has a path" is derived from open actions, not a flag');

test('1. An open issue with no actions sits in the queue', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));

  eq(idsIn(issueItems(snap, 't1')), ['i1']);
  eq(idsIn(actionedItems(snap, 't1')), [], 'and is not in the "moved" list');
});

test('2. Pointing an open action at it removes it from the queue', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'issue', id: 'i1' } }));

  eq(idsIn(issueItems(snap, 't1')), [], 'it now has a path, so it leaves the queue');
  eq(idsIn(actionedItems(snap, 't1')), ['i1'], 'and shows as "moved to actions"');
});

test('3. Deleting that action brings the issue back into the queue', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'issue', id: 'i1' } }));

  // Delete it the way the app does — remove the record entirely.
  snap.actions = snap.actions.filter((a) => a.id !== 'a1');

  eq(idsIn(issueItems(snap, 't1')), ['i1'], 'the problem reappears in front of the team');
  eq(idsIn(actionedItems(snap, 't1')), []);
});

test('4. A DONE action is not a path — which is why closing one must resolve the issue', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', status: 'open' }));
  snap.actions.push(
    anAction({ id: 'a1', status: 'done', doneOn: '2026-09-14', parent: { type: 'issue', id: 'i1' } })
  );

  // At the query level, a closed action counts for nothing. So an issue left
  // 'open' with only closed actions pops straight back into the queue. That is
  // exactly why C.actionDone flips the issue to 'resolved' when the last action
  // closes (rule 2) — without that, closing work would re-raise the problem.
  eq(idsIn(issueItems(snap, 't1')), ['i1']);

  snap.issues[0].status = 'resolved';
  snap.issues[0].autoResolved = true;
  eq(idsIn(issueItems(snap, 't1')), [], 'once resolved it is gone from both lists');
  eq(idsIn(actionedItems(snap, 't1')), []);
});

test('5. With two linked actions, closing one leaves the issue out of the queue', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.actions.push(
    anAction({ id: 'a1', status: 'done', parent: { type: 'issue', id: 'i1' } }),
    anAction({ id: 'a2', status: 'open', parent: { type: 'issue', id: 'i1' } })
  );

  eq(openActsFor(snap, 'i1'), 1, 'one action is still open');
  eq(idsIn(issueItems(snap, 't1')), [], 'so the issue still has a path');
  eq(idsIn(actionedItems(snap, 't1')), ['i1']);
});

test('openActsFor can ignore one action, for the mid-toggle case', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'issue', id: 'i1' } }));

  eq(openActsFor(snap, 'i1'), 1);
  eq(openActsFor(snap, 'i1', 'a1'), 0, 'excluding the one being toggled');
});

test('A resolved issue never appears in either list', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', status: 'resolved', resolvedMeeting: '2026-09-14' }));

  eq(idsIn(issueItems(snap, 't1')), []);
  eq(idsIn(actionedItems(snap, 't1')), []);
});

test('Issues from another meeting are not in this meeting\'s queue', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', tab: 't1' }), anIssue({ id: 'i2', tab: 't2' }));

  eq(idsIn(issueItems(snap, 't1')), ['i1']);
  eq(idsIn(issueItems(snap, 't2')), ['i2']);
});

/* ---------- off-track projects share the queue ---------- */

group('Rule 1 — off-track projects join the same queue');

test('An off-track project appears in the queue with severity "offtrack"', () => {
  const snap = emptyBoard();
  snap.projects.push(aProject({ id: 'pr1', status: 'off', rank: 5 }));

  const items = issueItems(snap, 't1');
  eq(idsIn(items), ['pr1']);
  eq(items[0].sev, 'offtrack', 'severity is synthetic — no project record stores it');
  eq(items[0].type, 'p', 'and the type marks it as a project, not an issue');
});

test('An off-track project with an open action leaves the queue, like an issue', () => {
  const snap = emptyBoard();
  snap.projects.push(aProject({ id: 'pr1', status: 'off', rank: 5 }));
  snap.actions.push(anAction({ id: 'a1', parent: { type: 'project', id: 'pr1' } }));

  eq(idsIn(issueItems(snap, 't1')), []);
  eq(idsIn(actionedItems(snap, 't1')), ['pr1']);
});

test('A project that is on track is not in the queue at all', () => {
  const snap = emptyBoard();
  snap.projects.push(aProject({ id: 'pr1', status: 'on' }));

  eq(idsIn(issueItems(snap, 't1')), []);
  eq(idsIn(actionedItems(snap, 't1')), [], 'only off-track projects are ever listed');
});

/* ---------- rule 6: queue ordering ---------- */

group('Rule 6 — queue order: rank, then show-stoppers, then oldest');

test('18a. Lower rank comes first', () => {
  const snap = emptyBoard();
  snap.issues.push(
    anIssue({ id: 'i1', rank: 3 }),
    anIssue({ id: 'i2', rank: 1 }),
    anIssue({ id: 'i3', rank: 2 })
  );

  eq(idsIn(issueItems(snap, 't1')), ['i2', 'i3', 'i1']);
});

test('18b. Fractional ranks sort correctly — they are normal, not a mistake', () => {
  const snap = emptyBoard();
  snap.issues.push(
    anIssue({ id: 'i1', rank: 1 }),
    anIssue({ id: 'i2', rank: 1.5, sev: 'stopper' }),
    anIssue({ id: 'i3', rank: 2 })
  );

  eq(idsIn(issueItems(snap, 't1')), ['i1', 'i2', 'i3']);
});

test('An item with no rank sorts last, not first', () => {
  const snap = emptyBoard();
  snap.issues.push(
    anIssue({ id: 'i1', rank: undefined }),
    anIssue({ id: 'i2', rank: 500 })
  );

  eq(idsIn(issueItems(snap, 't1')), ['i2', 'i1'], 'a missing rank is treated as 1e9');
});

test('19. At equal rank, a show-stopper outranks everything else', () => {
  const snap = emptyBoard();
  snap.issues.push(
    anIssue({ id: 'i1', rank: 1, sev: 'risk' }),
    anIssue({ id: 'i2', rank: 1, sev: 'stopper' })
  );

  eq(idsIn(issueItems(snap, 't1')), ['i2', 'i1']);
});

test('At equal rank and severity, the older issue comes first', () => {
  const snap = emptyBoard();
  snap.issues.push(
    anIssue({ id: 'i1', rank: 1, meeting: '2026-09-14' }),
    anIssue({ id: 'i2', rank: 1, meeting: '2026-08-31' })
  );

  eq(idsIn(issueItems(snap, 't1')), ['i2', 'i1'], 'oldest first — it has waited longest');
});

/* ---------- rule 4: what shows up in a given week ---------- */

group('Rule 4 — which projects show in which meeting');

test('An active project shows in its own meeting and not another', () => {
  const p = aProject({ status: 'on' });

  ok(projVisible(p, 't1', '2026-09-14'));
  notOk(projVisible(p, 't2', '2026-09-14'), 'wrong tab');
});

test('15a. A project closed this week shows this week and vanishes next week', () => {
  const p = aProject({ status: 'done', doneMeeting: '2026-09-14' });

  ok(projVisible(p, 't1', '2026-09-14'), 'visible in the meeting it was closed in');
  notOk(projVisible(p, 't1', '2026-09-21'), 'gone the following week');
  notOk(projVisible(p, 't1', '2026-09-07'), 'and was not visible before it existed as done');
});

test('A cancelled project behaves the same as a done one', () => {
  const p = aProject({ status: 'cancelled', doneMeeting: '2026-09-14' });

  ok(projVisible(p, 't1', '2026-09-14'));
  notOk(projVisible(p, 't1', '2026-09-21'));
});

test('15b. A future start date hides a project until that date', () => {
  const p = aProject({ status: 'new', start: '2026-09-21' });

  notOk(projVisible(p, 't1', '2026-09-14'), 'not yet');
  ok(projVisible(p, 't1', '2026-09-21'), 'from its start date');
  ok(projVisible(p, 't1', '2026-09-28'), 'and after');
});

test('All four active statuses are visible; done/cancelled without doneMeeting are not', () => {
  ['new', 'on', 'off', 'hold'].forEach(function (status) {
    ok(projVisible(aProject({ status }), 't1', '2026-09-14'), status + ' should be visible');
  });
  notOk(
    projVisible(aProject({ status: 'done' }), 't1', '2026-09-14'),
    'done with no doneMeeting is not visible in any meeting'
  );
});

/* ---------- small helpers ---------- */

group('Helpers');

test('isOpen treats anything that is not "done" as open', () => {
  ok(isOpen({ status: 'open' }));
  ok(isOpen({}), 'including a record with no status at all');
  notOk(isOpen({ status: 'done' }));
});

test('actsOf returns open actions first, then by due date', () => {
  const snap = emptyBoard();
  snap.actions.push(
    anAction({ id: 'a1', status: 'done', parent: { type: 'issue', id: 'i1' } }),
    anAction({ id: 'a2', status: 'open', due: '2026-10-01', parent: { type: 'issue', id: 'i1' } }),
    anAction({ id: 'a3', status: 'open', due: '2026-09-20', parent: { type: 'issue', id: 'i1' } }),
    anAction({ id: 'a4', status: 'open', parent: { type: 'issue', id: 'other' } })
  );

  eq(
    actsOf(snap, 'i1').map((a) => a.id),
    ['a3', 'a2', 'a1'],
    'open and soonest-due first, closed last, other parents excluded'
  );
});

test('An action with no parent belongs to nothing and blocks nothing', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1' }));
  snap.actions.push(anAction({ id: 'a1', parent: null }));

  eq(openActsFor(snap, 'i1'), 0);
  eq(idsIn(issueItems(snap, 't1')), ['i1'], 'an orphaned action does not give the issue a path');
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
