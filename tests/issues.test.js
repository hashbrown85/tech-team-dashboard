// @ts-check
/**
 * Tests for raising, ranking, resolving and reordering issues.
 *
 * Written against rules 1 and 6 in docs/BUSINESS_RULES.md.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { issueItems } from '../src/domain/queries.js';
import {
  nextIssueRank,
  newIssue,
  resolveIssue,
  reopenIssue,
  reorderQueue,
  queueKey,
  REOPENED_RANK
} from '../src/domain/issues.js';

const MEETING = '2026-09-14';

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

const idsIn = (items) => items.map((it) => it.o.id);

/** Write a new issue into the snapshot the way the store would. */
function raise(snap, { text, sev, id }) {
  const doc = newIssue({
    snap, tab: 't1', personId: 'p1', text: text || 'x', sev, meetingDate: MEETING
  });
  snap.issues.push(Object.assign({ id: id || 'new' }, doc));
  return doc;
}

/* ---------- rule 6: where a new issue lands ---------- */

group('Rule 6 — where a newly raised issue lands');

test('An ordinary issue goes to the bottom of the queue', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }), anIssue({ id: 'i2', rank: 2 }));

  eq(nextIssueRank(snap, 't1', 'risk'), 3, 'queue length plus one');

  raise(snap, { sev: 'risk', id: 'i3' });
  eq(idsIn(issueItems(snap, 't1')), ['i1', 'i2', 'i3']);
});

test('19. A show-stopper goes in above the ordinary issues', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }), anIssue({ id: 'i2', rank: 2 }));

  const doc = raise(snap, { sev: 'stopper', id: 'i3' });

  eq(doc.rank, 0.5, 'no stoppers yet, so it goes to the very top');
  eq(idsIn(issueItems(snap, 't1')), ['i3', 'i1', 'i2']);
});

test('A second show-stopper queues below the first, not above it', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }));

  raise(snap, { sev: 'stopper', id: 's1' });
  const second = raise(snap, { sev: 'stopper', id: 's2' });

  eq(second.rank, 1, 'inserted after the existing stopper at 0.5');
  eq(idsIn(issueItems(snap, 't1')), ['s1', 's2', 'i1'], 'first in, first up');
});

test('Fractional ranks let a stopper be inserted without renumbering anything', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }), anIssue({ id: 'i2', rank: 2 }));
  const before = snap.issues.map((i) => i.rank);

  raise(snap, { sev: 'stopper', id: 's1' });

  eq(snap.issues.slice(0, 2).map((i) => i.rank), before, 'existing ranks untouched');
});

test('Severity defaults to show-stopper, as the form does', () => {
  const snap = emptyBoard();
  const doc = newIssue({ snap, tab: 't1', personId: 'p1', text: 'x', meetingDate: MEETING });

  eq(doc.sev, 'stopper');
  eq(doc.status, 'open');
  eq(doc.meeting, MEETING);
});

test('Ranking ignores issues that already have an owner', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }), anIssue({ id: 'i2', rank: 2 }));
  snap.actions.push({
    id: 'a1', num: 1, tab: 't1', text: 'handled', owner: 'Someone', due: MEETING,
    status: 'open', parent: { type: 'issue', id: 'i2' }, meeting: MEETING
  });

  eq(nextIssueRank(snap, 't1', 'risk'), 2, 'only i1 is still in the queue');
});

test('Known edge, preserved: a ranked-less stopper yields NaN', () => {
  // Documented in BUSINESS_RULES.md rule 6 rather than fixed, because the port
  // changes no behaviour. This test pins it so the day someone DOES fix it, they
  // find this test and update it deliberately.
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', sev: 'stopper', rank: undefined }));

  ok(Number.isNaN(nextIssueRank(snap, 't1', 'stopper')), 'undefined + 0.5 is NaN');
});

/* ---------- resolving and reopening ---------- */

group('Rule 2 — resolving and reopening by hand');

test('A manual resolve does NOT set the auto-resolved marker', () => {
  const issue = anIssue({ id: 'i1', rank: 3 });
  const out = resolveIssue(issue, MEETING);

  eq(out.status, 'resolved');
  eq(out.resolvedMeeting, MEETING);
  eq('autoResolved' in out, false, 'this is a human decision, and must stay one');
  eq(out.rank, 3, 'and the rank is left alone');
  eq('id' in out, false);
});

test('A manual reopen sends the issue to the bottom of the queue', () => {
  const snap = emptyBoard();
  snap.issues.push(
    anIssue({ id: 'i1', rank: 1 }),
    anIssue({ id: 'i2', status: 'resolved', resolvedMeeting: MEETING,
              autoResolved: true, rank: 0.5 })
  );

  const out = reopenIssue(snap.issues[1]);
  snap.issues[1] = Object.assign({ id: 'i2' }, out);

  eq(out.status, 'open');
  eq('resolvedMeeting' in out, false);
  eq('autoResolved' in out, false, 'reopening makes it a human decision again');
  eq(out.rank, REOPENED_RANK);
  eq(idsIn(issueItems(snap, 't1')), ['i1', 'i2'], 're-enters at the end, not the front');
});

test('Clearing autoResolved on reopen stops a later action toggle re-resolving it', () => {
  // The two flags working together: reopen clears the marker, so the auto-resolve
  // path in actions.js no longer recognises this issue as one it closed.
  const out = reopenIssue(anIssue({ status: 'resolved', autoResolved: true }));
  notOk(out.autoResolved);
});

test('Resolving or reopening nothing produces no write', () => {
  eq(resolveIssue(null, MEETING), null);
  eq(reopenIssue(null), null);
});

/* ---------- reordering ---------- */

group('Rule 6 — reordering the queue');

test('18. Moving a row swaps its rank with its neighbour', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }), anIssue({ id: 'i2', rank: 2 }));

  const writes = reorderQueue(snap, 't1', 'i:i2', -1);

  eq(writes.length, 2);
  eq(writes[0], { col: 'issues', id: 'i2', patch: { rank: 1 } });
  eq(writes[1], { col: 'issues', id: 'i1', patch: { rank: 2 } });
});

test('Applying the swap actually changes the visible order', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }), anIssue({ id: 'i2', rank: 2 }));

  reorderQueue(snap, 't1', 'i:i2', -1).forEach(function (w) {
    const target = snap.issues.find((i) => i.id === w.id);
    Object.assign(target, w.patch);
  });

  eq(idsIn(issueItems(snap, 't1')), ['i2', 'i1']);
});

test('Off-track projects share the queue, so writes name their own collection', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }));
  snap.projects.push({
    id: 'pr1', tab: 't1', personId: 'p1', name: 'p', status: 'off', rank: 2
  });

  const writes = reorderQueue(snap, 't1', 'p:pr1', -1);

  eq(writes[0], { col: 'projects', id: 'pr1', patch: { rank: 1 } });
  eq(writes[1], { col: 'issues', id: 'i1', patch: { rank: 2 } });
});

test('Moving past either end does nothing', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }), anIssue({ id: 'i2', rank: 2 }));

  eq(reorderQueue(snap, 't1', 'i:i1', -1), null, 'already at the top');
  eq(reorderQueue(snap, 't1', 'i:i2', 1), null, 'already at the bottom');
});

test('Reordering an unknown row does nothing', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }));

  eq(reorderQueue(snap, 't1', 'i:nope', 1), null);
});

test('The queue key distinguishes an issue from a project with the same id', () => {
  eq(queueKey({ type: 'i', o: { id: 'x' } }), 'i:x');
  eq(queueKey({ type: 'p', o: { id: 'x' } }), 'p:x');
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
