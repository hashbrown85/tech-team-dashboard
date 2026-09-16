// @ts-check
/**
 * Tests for the project status lifecycle and how projects are created.
 *
 * Written against rules 3, 4 and 5 in docs/BUSINESS_RULES.md. If one of these fails,
 * assume a rule was broken rather than that the test is stale — these encode
 * behaviour that exists nowhere else.
 *
 * Numbering matches the test list in the porting plan.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { issueItems, projVisible } from '../src/domain/queries.js';
import {
  statusChange,
  nextOffTrackRank,
  newProject,
  newOpportunity,
  linkedProjectGoesToo,
  projectTitle
} from '../src/domain/projects.js';

const MEETING = '2026-09-14';
const NEXT_MEETING = '2026-09-21';

function emptyBoard() {
  return {
    people: [], tabs: [], entries: [], projects: [], issues: [],
    actions: [], meetings: {}, settings: {}
  };
}

function aProject(over) {
  return Object.assign(
    { id: 'pr1', tab: 't1', personId: 'p1', name: 'a project', status: 'on',
      added: '2026-09-07' },
    over
  );
}

function anIssue(over) {
  return Object.assign(
    { id: 'i1', tab: 't1', personId: 'p1', text: 'an issue', sev: 'risk',
      status: 'open', meeting: '2026-09-07', rank: 1 },
    over
  );
}

/** Apply a status change and hand back the stored result, for chaining. */
function change(snap, project, to, meetingDate) {
  const doc = statusChange(snap, project, to, 't1', meetingDate || MEETING);
  if (!doc) return project;
  // Mirror what the store does: write the doc back under its existing id.
  const stored = Object.assign({ id: project.id }, doc);
  const i = snap.projects.findIndex((p) => p.id === project.id);
  if (i >= 0) snap.projects[i] = stored;
  return stored;
}

/* ---------- rule 3: the status lifecycle ---------- */

group('Rule 3 — status changes record one step of history');

test('Clicking the status a project already has does nothing', () => {
  const snap = emptyBoard();
  const p = aProject({ status: 'on' });
  snap.projects.push(p);

  eq(statusChange(snap, p, 'on', 't1', MEETING), null, 'no document to write');
});

test('A missing project produces no write rather than throwing', () => {
  const snap = emptyBoard();
  eq(statusChange(snap, null, 'off', 't1', MEETING), null);
});

test('10. Going off track records where it came from, and joins the queue', () => {
  const snap = emptyBoard();
  const p = aProject({ status: 'on' });
  snap.projects.push(p);

  const out = change(snap, p, 'off');

  eq(out.status, 'off');
  eq(out.prevStatus, 'on', 'the summary needs to say what it was before');
  eq(out.statusMeeting, MEETING);
  eq(out.rank, 1000, 'bottom of an empty queue');
  eq(idsIn(issueItems(snap, 't1')), ['pr1'], 'and it is now in the Issues queue');
});

test('11. Going straight back in the same meeting erases the record entirely', () => {
  const snap = emptyBoard();
  let p = aProject({ status: 'on' });
  snap.projects.push(p);

  p = change(snap, p, 'off');
  p = change(snap, p, 'on');

  eq(p.status, 'on');
  eq('prevStatus' in p, false, 'a mis-click should not show up as a change');
  eq('statusMeeting' in p, false);
  eq('rank' in p, false, 'and it drops out of the queue ordering');
  eq(idsIn(issueItems(snap, 't1')), []);
});

test('12. A second change in the same meeting keeps the ORIGINAL starting status', () => {
  const snap = emptyBoard();
  let p = aProject({ status: 'on' });
  snap.projects.push(p);

  p = change(snap, p, 'off');
  p = change(snap, p, 'hold');

  eq(p.status, 'hold');
  eq(p.prevStatus, 'on', 'not "off" — the team hears what it was at the start');
  eq(p.statusMeeting, MEETING);
  eq('rank' in p, false, 'no longer off track, so no queue position');
});

test('13. A change in a LATER meeting records the new starting point', () => {
  const snap = emptyBoard();
  let p = aProject({ status: 'on' });
  snap.projects.push(p);

  p = change(snap, p, 'off', MEETING);
  eq(p.prevStatus, 'on');

  p = change(snap, p, 'on', NEXT_MEETING);
  eq(p.prevStatus, 'off', 'a fresh meeting starts a fresh history entry');
  eq(p.statusMeeting, NEXT_MEETING);
});

test('Three changes in one meeting still report the original status', () => {
  const snap = emptyBoard();
  let p = aProject({ status: 'on' });
  snap.projects.push(p);

  p = change(snap, p, 'off');
  p = change(snap, p, 'hold');
  p = change(snap, p, 'done');

  eq(p.prevStatus, 'on');
  eq(p.statusMeeting, MEETING);
});

test('14. done/cancelled stamp doneMeeting, and leaving clears it', () => {
  const snap = emptyBoard();
  let p = aProject({ status: 'on' });
  snap.projects.push(p);

  p = change(snap, p, 'done');
  eq(p.doneMeeting, MEETING);

  p = change(snap, p, 'on');
  eq('doneMeeting' in p, false, 'reopened work is not closed work');
});

test('Cancelled stamps doneMeeting the same way done does', () => {
  const snap = emptyBoard();
  const p = aProject({ status: 'on' });
  snap.projects.push(p);

  eq(change(snap, p, 'cancelled').doneMeeting, MEETING);
});

test('EVERY move away from closed clears doneMeeting, not just going back on track', () => {
  // A lingering doneMeeting on a live project is stale data: it says "this was
  // closed on the 14th" about something that is currently in flight, which the
  // meeting summary and any report over this field would then get wrong.
  ['on', 'off', 'hold'].forEach(function (to) {
    ['done', 'cancelled'].forEach(function (from) {
      const snap = emptyBoard();
      const p = aProject({ status: from, doneMeeting: MEETING });
      snap.projects.push(p);

      const out = change(snap, p, to);
      eq('doneMeeting' in out, false, from + ' -> ' + to + ' should clear doneMeeting');
    });
  });
});

test('Going off track from "new" also ranks it', () => {
  const snap = emptyBoard();
  const p = aProject({ status: 'new', start: '2026-09-07' });
  snap.projects.push(p);

  const out = change(snap, p, 'off');
  eq(out.prevStatus, 'new');
  eq(out.rank, 1000);
});

test('Every non-off status clears the rank', () => {
  ['on', 'hold', 'done', 'cancelled'].forEach(function (to) {
    const snap = emptyBoard();
    const p = aProject({ status: 'off', rank: 4000 });
    snap.projects.push(p);

    const out = change(snap, p, to);
    eq('rank' in out, false, to + ' should not keep a queue position');
  });
});

/* ---------- off-track ranking ---------- */

group('Rule 3 — where a newly off-track project lands in the queue');

test('It goes below everything already queued', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }), anIssue({ id: 'i2', rank: 2500 }));
  const p = aProject({ id: 'pr1', status: 'on' });
  snap.projects.push(p);

  eq(nextOffTrackRank(snap, 't1'), 3500, 'highest queued rank plus 1000');

  change(snap, p, 'off');
  eq(idsIn(issueItems(snap, 't1')), ['i1', 'i2', 'pr1'], 'last in the queue');
});

test('An empty queue puts the first off-track project at 1000', () => {
  const snap = emptyBoard();
  const p = aProject({ id: 'pr1', status: 'on' });
  snap.projects.push(p);

  eq(change(snap, p, 'off').rank, 1000);
});

test('The rank reads the queue as it was, excluding the project being changed', () => {
  const snap = emptyBoard();
  // A stale rank on a project that is NOT off track. This shouldn't arise through
  // the UI — leaving 'off' deletes the rank — but setting it deliberately is what
  // pins the ordering: if the rank were worked out AFTER the status flipped to
  // 'off', this project would see its own 5000 and land at 6000.
  const p = aProject({ id: 'pr1', status: 'on', rank: 5000 });
  snap.projects.push(p);

  eq(change(snap, p, 'off').rank, 1000, 'its own stale rank must not count');
});

test('Items that already have an owner do not push it further down', () => {
  const snap = emptyBoard();
  // A high-ranked issue, but it already has an open action, so it is not in the
  // unpathed queue and must not influence the ranking.
  snap.issues.push(anIssue({ id: 'i1', rank: 90000 }));
  snap.actions.push({
    id: 'a1', num: 1, tab: 't1', text: 'handled', owner: 'Someone', due: MEETING,
    status: 'open', parent: { type: 'issue', id: 'i1' }, meeting: MEETING
  });
  const p = aProject({ id: 'pr1', status: 'on' });
  snap.projects.push(p);

  eq(nextOffTrackRank(snap, 't1'), 1000, 'the pathed issue is ignored');
});

test('Ranking is per meeting — another tab\'s queue is irrelevant', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', tab: 't2', rank: 50000 }));
  const p = aProject({ id: 'pr1', tab: 't1', status: 'on' });
  snap.projects.push(p);

  eq(nextOffTrackRank(snap, 't1'), 1000);
});

test('The gap left is big enough for fractional show-stopper inserts', () => {
  const snap = emptyBoard();
  snap.issues.push(anIssue({ id: 'i1', rank: 1 }));
  ok(nextOffTrackRank(snap, 't1') - 1 > 1, 'room to insert between');
});

/* ---------- rule 5: opportunities become projects next week ---------- */

group('Rule 5 — an opportunity becomes a project next week');

test('16. It creates two linked records, starting a week out', () => {
  const { entry, project, startsOn } = newOpportunity({
    entryId: 'e1',
    projectId: 'pr1',
    tab: 't1',
    personId: 'p1',
    text: 'a new opportunity',
    why: 'the tricky part',
    meetingDate: MEETING
  });

  eq(entry.kind, 'opp');
  eq(entry.projectId, 'pr1', 'entry points at the project');
  eq(project.fromOpp, 'e1', 'and the project points back at the entry');

  eq(project.status, 'new');
  eq(project.name, 'a new opportunity', 'the text becomes the project name');
  eq(project.note, 'the tricky part', 'and the challenge becomes the note');
  eq(startsOn, NEXT_MEETING);
  eq(project.start, NEXT_MEETING, 'seven days on');
});

test('It is deliberately NOT in Current Projects this week', () => {
  const { project } = newOpportunity({
    entryId: 'e1', projectId: 'pr1', tab: 't1', personId: 'p1',
    text: 'an opportunity', why: '', meetingDate: MEETING
  });
  const stored = Object.assign({ id: 'pr1' }, project);

  notOk(projVisible(stored, 't1', MEETING), 'not today — you are still discussing it');
  ok(projVisible(stored, 't1', NEXT_MEETING), 'but next week you own it');
});

test('It carries the faithful oddities: empty due, and no "added" field', () => {
  const { project } = newOpportunity({
    entryId: 'e1', projectId: 'pr1', tab: 't1', personId: 'p1',
    text: 'x', meetingDate: MEETING
  });

  eq(project.due, '', 'an empty string, not a missing field');
  eq('added' in project, false, 'unlike a directly-entered project');
});

test('A directly-entered project starts on track and visible today', () => {
  const p = newProject({
    tab: 't1', personId: 'p1', name: 'straight in', due: '2026-10-01',
    meetingDate: MEETING
  });

  eq(p.status, 'on');
  eq(p.added, MEETING);
  eq('start' in p, false, 'no start date means visible immediately');
  ok(projVisible(Object.assign({ id: 'pr9' }, p), 't1', MEETING));
});

test('A month boundary does not break the week-out start date', () => {
  const { startsOn } = newOpportunity({
    entryId: 'e1', projectId: 'pr1', tab: 't1', personId: 'p1',
    text: 'x', meetingDate: '2026-09-28'
  });
  eq(startsOn, '2026-10-05');
});

group('Rule 5 — deleting the entry only removes untouched projects');

test('An untouched opportunity project goes with its entry', () => {
  const snap = emptyBoard();
  snap.entries.push({ id: 'e1', tab: 't1', kind: 'opp', text: 'x', projectId: 'pr1' });
  snap.projects.push(aProject({ id: 'pr1', status: 'new' }));

  ok(linkedProjectGoesToo(snap, snap.entries[0]));
});

test('Once it has been worked on, the project stays', () => {
  const snap = emptyBoard();
  snap.entries.push({ id: 'e1', tab: 't1', kind: 'opp', text: 'x', projectId: 'pr1' });
  snap.projects.push(aProject({ id: 'pr1', status: 'on' }));

  notOk(linkedProjectGoesToo(snap, snap.entries[0]), 'status moved on from new');
});

test('An attached action keeps the project alive, even a closed one', () => {
  const snap = emptyBoard();
  snap.entries.push({ id: 'e1', tab: 't1', kind: 'opp', text: 'x', projectId: 'pr1' });
  snap.projects.push(aProject({ id: 'pr1', status: 'new' }));
  snap.actions.push({
    id: 'a1', num: 1, tab: 't1', text: 'done already', owner: 'Someone', due: MEETING,
    status: 'done', doneOn: MEETING, parent: { type: 'project', id: 'pr1' },
    meeting: MEETING
  });

  notOk(linkedProjectGoesToo(snap, snap.entries[0]), 'someone committed to something');
});

test('A plain win or loss entry has no project to remove', () => {
  const snap = emptyBoard();
  snap.entries.push({ id: 'e1', tab: 't1', kind: 'win', text: 'x' });

  notOk(linkedProjectGoesToo(snap, snap.entries[0]));
});

function idsIn(items) {
  return items.map((it) => it.o.id);
}

group('What a project is called');

test('Customer and name, joined by a hyphen', () => {
  eq(projectTitle({ customer: 'Meridian Coatings', name: 'Coating additive trial' }),
    'Meridian Coatings - Coating additive trial');
});

test('Internal work with no customer is just its name', () => {
  // A dangling "- " in front of every internal project would be worse than useless.
  eq(projectTitle({ name: 'Line 3 throughput uplift' }), 'Line 3 throughput uplift');
  eq(projectTitle({ customer: '', name: 'Line 3 throughput uplift' }),
    'Line 3 throughput uplift');
  eq(projectTitle({ customer: '   ', name: 'Line 3 throughput uplift' }),
    'Line 3 throughput uplift');
});

test('A customer with no name yet is better than nothing', () => {
  eq(projectTitle({ customer: 'Halden Industrial' }), 'Halden Industrial');
});

test('Neither still renders something clickable', () => {
  // A blank heading cannot be clicked on or talked about.
  eq(projectTitle({}), 'Untitled project');
  eq(projectTitle({ customer: '', name: '' }), 'Untitled project');
  eq(projectTitle(null), 'Project');
});

test('Surrounding whitespace does not become part of the title', () => {
  eq(projectTitle({ customer: '  Meridian Coatings  ', name: '  Trial  ' }),
    'Meridian Coatings - Trial');
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
