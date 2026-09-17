// @ts-check
/**
 * Tests for meeting occurrences: the composite key, ratings, and the summary.
 *
 * The summary is what actually lands in someone's inbox, so the tests check exact
 * text rather than just "contains something about wins".
 */

import { group, test, eq, ok, notOk } from './harness.js';
import {
  memoryKey,
  documentId,
  parseDocumentId,
  getMeeting,
  meetingDate,
  ratingInfo,
  toggleRating,
  setNote,
  lastScore,
  trendPoints,
  meetingSummary, nextMeetingAfter
} from '../src/domain/meetings.js';

const MEETING = '2026-09-14';

function board() {
  return {
    people: [
      { id: 'p1', name: 'First Person', title: 'Lead', home: 'North' },
      { id: 'p2', name: 'Second Person', title: 'Tech', home: 'North' }
    ],
    tabs: [
      { id: 't1', name: 'North Area', kind: 'area', weekday: 1, lengthMin: 60,
        members: ['p1', 'p2'], support: [], optional: [] }
    ],
    entries: [],
    projects: [],
    issues: [],
    actions: [],
    meetings: {},
    settings: {}
  };
}

const TAB = () => board().tabs[0];

/* ---------- the composite key ---------- */

group('The meeting key, spelled two ways');

test('In memory it is tab|date; stored it is tab@date', () => {
  eq(memoryKey('t1', MEETING), 't1|2026-09-14');
  eq(documentId('t1', MEETING), 't1@2026-09-14');
});

test('A stored id splits back into its parts', () => {
  eq(parseDocumentId('t1@2026-09-14'), { tab: 't1', date: '2026-09-14' });
});

test('It splits at the first @, so a date is never mangled', () => {
  eq(parseDocumentId('techdir@2026-09-14').tab, 'techdir');
  eq(parseDocumentId('techdir@2026-09-14').date, '2026-09-14');
});

test('A missing meeting reads as empty rather than undefined', () => {
  const snap = board();
  eq(getMeeting(snap, 't1', MEETING), { ratings: {}, note: '' });
});

test('Reading a missing meeting does not create one', () => {
  // The original version of this wrote the blank into local state as a side effect,
  // which is why it could not be a pure function.
  const snap = board();
  getMeeting(snap, 't1', MEETING);
  eq(Object.keys(snap.meetings), [], 'the board is untouched');
});

/* ---------- rule 10: dates are derived ---------- */

group('Rule 10 — meeting dates are derived, not stored');

test('With no override it is the next occurrence of the tab weekday', () => {
  // 2026-09-16 is a Wednesday; the tab meets on Mondays (weekday 1).
  eq(meetingDate(TAB(), '2026-09-16'), '2026-09-21');
});

test('On the meeting day itself, it is today', () => {
  eq(meetingDate(TAB(), '2026-09-14'), '2026-09-14', 'not next week');
});

test('An override wins, which is how prev/next navigation works', () => {
  eq(meetingDate(TAB(), '2026-09-16', '2026-09-07'), '2026-09-07');
});

/* ---------- ratings ---------- */

group('Meeting ratings');

test('Averages only the scores of people who still exist', () => {
  const snap = board();
  snap.meetings[memoryKey('t1', MEETING)] = { ratings: { p1: 4, p2: 5 }, note: '' };

  eq(ratingInfo(snap, 't1', MEETING), { n: 2, avg: 4.5 });
});

test('A score left behind by someone since removed is ignored', () => {
  const snap = board();
  snap.meetings[memoryKey('t1', MEETING)] = { ratings: { p1: 4, ghost: 1 }, note: '' };

  eq(ratingInfo(snap, 't1', MEETING), { n: 1, avg: 4 },
    'the departed 1 must not drag the average');
});

test('An unrated meeting has no average rather than a zero', () => {
  const snap = board();
  eq(ratingInfo(snap, 't1', MEETING), { n: 0, avg: null });
});

test('Clicking a score sets it', () => {
  const snap = board();
  eq(toggleRating(snap, 't1', MEETING, 'p1', 4).ratings, { p1: 4 });
});

test('Clicking the SAME score again clears it — the buttons toggle', () => {
  const snap = board();
  snap.meetings[memoryKey('t1', MEETING)] = { ratings: { p1: 4, p2: 5 }, note: 'keep me' };

  const out = toggleRating(snap, 't1', MEETING, 'p1', 4);
  eq(out.ratings, { p2: 5 }, 'a mis-click is undone by clicking it again');
  eq(out.note, 'keep me', 'and the note survives');
});

test('Clicking a different score replaces it', () => {
  const snap = board();
  snap.meetings[memoryKey('t1', MEETING)] = { ratings: { p1: 4 }, note: '' };
  eq(toggleRating(snap, 't1', MEETING, 'p1', 2).ratings, { p1: 2 });
});

test('Writing the note keeps the ratings alongside it', () => {
  const snap = board();
  snap.meetings[memoryKey('t1', MEETING)] = { ratings: { p1: 4 }, note: 'old' };

  eq(setNote(snap, 't1', MEETING, 'new'), { ratings: { p1: 4 }, note: 'new' });
});

test('Both writers replace the whole record — which is the documented race', () => {
  // toggleRating and setNote each return a complete document, so whichever lands
  // second wins. Recorded in BUSINESS_RULES.md rather than fixed.
  const snap = board();
  snap.meetings[memoryKey('t1', MEETING)] = { ratings: { p1: 4 }, note: 'a note' };

  ok('ratings' in setNote(snap, 't1', MEETING, 'b') && 'note' in setNote(snap, 't1', MEETING, 'b'));
  ok('ratings' in toggleRating(snap, 't1', MEETING, 'p2', 3));
});

/* ---------- history ---------- */

group('Rating history');

test('lastScore finds the most recent RATED meeting', () => {
  const snap = board();
  snap.meetings['t1|2026-09-07'] = { ratings: { p1: 3 }, note: '' };
  snap.meetings['t1|2026-09-14'] = { ratings: { p1: 5 }, note: '' };
  snap.meetings['t1|2026-09-21'] = { ratings: {}, note: 'not rated' };

  eq(lastScore(snap, 't1'), { d: '2026-09-14', avg: 5, n: 1 },
    'the unrated later meeting is skipped, not counted as zero');
});

test('lastScore ignores other meetings', () => {
  const snap = board();
  snap.meetings['t2|2026-09-21'] = { ratings: { p1: 1 }, note: '' };
  eq(lastScore(snap, 't1'), null);
});

test('Trend points come back oldest first, unrated ones dropped', () => {
  const snap = board();
  snap.meetings['t1|2026-09-14'] = { ratings: { p1: 5 }, note: '' };
  snap.meetings['t1|2026-08-31'] = { ratings: { p1: 3 }, note: '' };
  snap.meetings['t1|2026-09-07'] = { ratings: {}, note: '' };

  eq(trendPoints(snap, 't1').map((p) => p.d), ['2026-08-31', '2026-09-14']);
});

test('Trend keeps only the last few meetings', () => {
  const snap = board();
  for (let i = 1; i <= 12; i++) {
    const d = '2026-09-' + String(i).padStart(2, '0');
    snap.meetings['t1|' + d] = { ratings: { p1: 4 }, note: '' };
  }

  eq(trendPoints(snap, 't1').length, 8, 'eight by default');
  eq(trendPoints(snap, 't1', 3).length, 3);
  eq(trendPoints(snap, 't1').map((p) => p.d)[0], '2026-09-05', 'the most recent eight');
});

/* ---------- the summary ---------- */

group('The meeting summary');

/** The board used for the summary tests: one of everything. */
function fullBoard() {
  const snap = board();
  snap.entries.push(
    { id: 'e1', tab: 't1', meeting: MEETING, personId: 'p1', kind: 'win',
      text: 'landed the trial', why: 'good prep' },
    { id: 'e2', tab: 't1', meeting: MEETING, personId: 'p2', kind: 'loss',
      text: 'lost the retender', why: 'price', change: 'quote earlier' },
    { id: 'e3', tab: 't1', meeting: MEETING, personId: 'p1', kind: 'opp',
      text: 'a new line', why: 'needs lab time', projectId: 'pr2' },
    { id: 'e9', tab: 't1', meeting: '2026-09-07', personId: 'p1', kind: 'win',
      text: 'last week', why: '' }
  );
  snap.projects.push(
    { id: 'pr1', tab: 't1', personId: 'p1', name: 'slipping one', status: 'off',
      prevStatus: 'on', statusMeeting: MEETING, rank: 1000 },
    { id: 'pr2', tab: 't1', personId: 'p1', name: 'a new line', status: 'new',
      start: '2026-09-21', fromOpp: 'e3' },
    { id: 'pr3', tab: 't1', personId: 'p2', name: 'long-term problem',
      status: 'off', statusMeeting: '2026-08-31', rank: 2000 }
  );
  snap.issues.push(
    { id: 'i1', tab: 't1', personId: 'p1', text: 'no capacity', sev: 'stopper',
      status: 'open', meeting: MEETING, rank: 0.5 },
    { id: 'i2', tab: 't1', personId: 'p2', text: 'sorted now', sev: 'risk',
      status: 'resolved', resolvedMeeting: MEETING, rank: 2 }
  );
  snap.actions.push(
    { id: 'a2', num: 2, tab: 't1', text: 'book the lab', owner: 'First Person',
      support: 'Second Person', due: '2026-09-21', status: 'open',
      parent: { type: 'project', id: 'pr1' }, meeting: MEETING },
    { id: 'a1', num: 1, tab: 't1', text: 'call the supplier', owner: 'Second Person',
      support: '', due: '', status: 'done', doneOn: MEETING, parent: null, meeting: MEETING }
  );
  snap.meetings[memoryKey('t1', MEETING)] = { ratings: { p1: 4, p2: 5 }, note: 'start on time' };
  return snap;
}

test('It opens with the meeting name, the full date and the score', () => {
  const snap = fullBoard();
  const lines = meetingSummary(snap, snap.tabs[0], MEETING).split('\n');

  eq(lines[0], 'North Area · Mon, Sep 14, 2026');
  eq(lines[1], 'Meeting score: 4.5 / 5 (2 of 2 rated)');
});

test('An unrated meeting says so rather than showing a zero', () => {
  const snap = board();
  const lines = meetingSummary(snap, snap.tabs[0], MEETING).split('\n');
  eq(lines[1], 'Meeting score: not rated');
});

test('Wins and losses read differently, and a loss shows what changes', () => {
  const snap = fullBoard();
  const out = meetingSummary(snap, snap.tabs[0], MEETING);

  ok(out.indexOf('• Win · First Person: landed the trial. Why: good prep') >= 0);
  ok(out.indexOf('• Loss · Second Person: lost the retender. Why: price. Doing differently: quote earlier') >= 0);
});

test('An opportunity says when it joins Current Projects', () => {
  const snap = fullBoard();
  const out = meetingSummary(snap, snap.tabs[0], MEETING);

  ok(out.indexOf('• First Person: a new line (challenge: needs lab time). Joins Current Projects Mon, Sep 21') >= 0);
});

test('A status change reads as an arrow between the two labels', () => {
  const snap = fullBoard();
  const out = meetingSummary(snap, snap.tabs[0], MEETING);

  ok(out.indexOf('• slipping one (First Person): On track → Off track') >= 0);
});

test('Projects still off track from earlier meetings get their own line', () => {
  const snap = fullBoard();
  const out = meetingSummary(snap, snap.tabs[0], MEETING);

  ok(out.indexOf('• Still off track: long-term problem') >= 0,
    'so nothing quietly stays broken across weeks');
});

test('Actions are listed by number, with owner, date and what they are about', () => {
  const snap = fullBoard();
  const out = meetingSummary(snap, snap.tabs[0], MEETING);
  const lines = out.split('\n');
  const first = lines.findIndex((l) => l.indexOf('A-001') >= 0);
  const second = lines.findIndex((l) => l.indexOf('A-002') >= 0);

  ok(first >= 0 && second > first, 'sorted by number, not insertion order');
  ok(out.indexOf('A-002 book the lab · Owner: First Person (with Second Person) · Due Mon, Sep 21 · Re: slipping one (project)') >= 0);
  ok(out.indexOf('A-001 call the supplier · Owner: Second Person · Due no date · DONE') >= 0,
    'a closed action is marked, and a missing date says so');
});

test('Only this meeting\'s entries and actions appear', () => {
  const snap = fullBoard();
  const out = meetingSummary(snap, snap.tabs[0], MEETING);
  notOk(out.indexOf('last week') >= 0, 'last week\'s win is not in this summary');
});

test('Resolved issues and the ones still without a path both show', () => {
  const snap = fullBoard();
  const out = meetingSummary(snap, snap.tabs[0], MEETING);

  ok(out.indexOf('• Resolved: sorted now') >= 0);

  // Counts issues and off-track projects together, since they share one queue -
  // but NOT pr1 ("slipping one"), which has an open action and therefore already
  // has a path. So: i1 the issue, and pr3 the project nobody has picked up.
  ok(out.indexOf('Still without a path (2): no capacity; long-term problem') >= 0,
    'in rank order, and only the ones with nobody on them');
});

test('The closing note appears only when there is one', () => {
  const snap = fullBoard();
  ok(meetingSummary(snap, snap.tabs[0], MEETING).indexOf('ONE CHANGE FOR NEXT TIME') >= 0);

  delete snap.meetings[memoryKey('t1', MEETING)].note;
  notOk(meetingSummary(snap, snap.tabs[0], MEETING).indexOf('ONE CHANGE FOR NEXT TIME') >= 0);
});

test('Empty sections say so, because an empty section is worth seeing', () => {
  const snap = board();
  const out = meetingSummary(snap, snap.tabs[0], MEETING);

  ok(out.indexOf('WINS & LOSSES\n• None recorded') >= 0);
  ok(out.indexOf('NEW OPPORTUNITIES\n• None') >= 0);
  ok(out.indexOf('PROJECT STATUS CHANGES\n• No changes') >= 0);
  ok(out.indexOf('NEW ACTIONS\n• None') >= 0);
  notOk(out.indexOf('ISSUES') >= 0, 'but the Issues section is omitted entirely');
});

test('It is plain text and ends with a newline', () => {
  const snap = fullBoard();
  const out = meetingSummary(snap, snap.tabs[0], MEETING);

  eq(out.slice(-1), '\n', 'so it pastes cleanly');
  notOk(/<[a-z]/i.test(out), 'no markup - it has to survive being pasted anywhere');
});

test('Sections always come in the same order', () => {
  const snap = fullBoard();
  const out = meetingSummary(snap, snap.tabs[0], MEETING);
  const order = ['WINS & LOSSES', 'NEW OPPORTUNITIES', 'PROJECT STATUS CHANGES',
                 'NEW ACTIONS', 'ISSUES', 'ONE CHANGE FOR NEXT TIME'];
  const found = order.map((h) => out.indexOf('\n' + h));

  found.forEach(function (at, i) {
    ok(at > 0, order[i] + ' should be present');
    if (i > 0) ok(at > found[i - 1], order[i] + ' comes after ' + order[i - 1]);
  });
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */


group('Pushing an action to the next meeting');

test('It lands on the meeting weekday after the one being viewed', () => {
  // 2026-09-21 is a Monday. A Monday meeting pushed from it must go to the 28th,
  // not stay on the 21st - nextOn returns its own argument when the day already
  // matches, which would make "push" a no-op on a meeting day.
  eq(nextMeetingAfter({ weekday: 1 }, '2026-09-21'), '2026-09-28');
});

test('Pushing from a past meeting still moves one meeting on', () => {
  // The date comes from the meeting on screen, not from today, so opening last
  // week's meeting and pushing does not skip to next week's.
  eq(nextMeetingAfter({ weekday: 1 }, '2026-09-14'), '2026-09-21');
});

test('It finds the next occurrence from a mid-week date', () => {
  eq(nextMeetingAfter({ weekday: 2 }, '2026-09-17'), '2026-09-22', 'Thursday -> Tuesday');
});
