// @ts-check
/**
 * Copilot by copy and paste, and the meeting's Discussed topics.
 *
 * Requested: after a meeting, Copilot's recap becomes suggested board changes that
 * Kevin approves, and the summary gets a Discussed section for topics that did
 * not change the board. The board cannot call Copilot, so the prompt and reply go
 * through the clipboard - see src/domain/copilot.js.
 *
 * The demo board's Northern meeting (t1) on 21 Sep: projects pr1 (on track), pr2
 * (off track), pr3 (on hold); pr4 waiting on the Horizon; open issues i1, i2.
 * pr5 belongs to Southern and must never be reachable from Northern.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';
import {
  copilotPrompt, readReply, personFor, proposalsFrom, planFrom
} from '../src/domain/copilot.js';
import {
  setDiscussed, discussedTopics, getMeeting, meetingSummary, memoryKey
} from '../src/domain/meetings.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';
import { byId } from '../src/lib/seq.js';

const DAY = '2026-09-22';
const MEETING = '2026-09-21';
const LIVE = { content: 'live', settings: 'live', details: 'live' };

function t1(snap) { return byId(snap.tabs, 't1'); }

function find(list, key) {
  return list.filter(function (p) { return p.key === key; })[0];
}

group('The prompt');

test('It names the meeting, its people, projects, Horizon and open issues by id', () => {
  const snap = demoBoard(DAY);
  const p = copilotPrompt(snap, t1(snap), MEETING);
  ok(p.indexOf('"Northern Area" meeting on Mon, Sep 21, 2026') >= 0);
  ok(p.indexOf('- Alex Morgan') >= 0, 'people by name');
  ok(p.indexOf('- pr1 | Meridian Coatings - Coating additive trial | On track') >= 0, 'projects by id');
  ok(p.indexOf('- pr4 | Low-odour thinner for the flooring range') >= 0, 'the Horizon');
  ok(p.indexOf('- i1 | ') >= 0, 'open issues');
  ok(p.indexOf('"discussed"') >= 0, 'and asks for discussed topics');
});

test('Nothing from another meeting is offered', () => {
  const snap = demoBoard(DAY);
  const p = copilotPrompt(snap, t1(snap), MEETING);
  notOk(p.indexOf('- pr5 |') >= 0, 'Southern’s project');
  notOk(/- i4 \|/.test(p), 'Southern’s issue');
});

group('Reading the reply');

test('JSON wrapped in a code fence, with a sentence before it', () => {
  const r = readReply('Here are the changes:\n```json\n{"discussed": ["Pricing"]}\n```\nHope that helps.');
  ok(r.ok);
  eq(r.data, { discussed: ['Pricing'] });
});

test('Something that is not JSON says so plainly', () => {
  notOk(readReply('Sorry, I could not find a transcript.').ok);
  ok(readReply('no braces here').error.indexOf('no JSON') >= 0);
  notOk(readReply('{ broken: ').ok);
  notOk(readReply('[1, 2]').ok, 'a list is not the reply shape');
});

test('Names: full name or a unique first name, never a guess', () => {
  const snap = demoBoard(DAY);
  eq(personFor(snap, t1(snap), 'alex morgan').id, 'p1', 'any case');
  eq(personFor(snap, t1(snap), 'Priya').id, 'p2', 'a first name only one person has');
  snap.people.push({ id: 'p9', name: 'Priya Okonjo' });
  eq(personFor(snap, t1(snap), 'Priya').id, 'p2', 'two Priyas: the one in this meeting');
  snap.people.push({ id: 'p10', name: 'Priya Third' });
  snap.tabs[0].optional = (snap.tabs[0].optional || []).concat(['p10']);
  eq(personFor(snap, t1(snap), 'Priya'), null, 'two in this meeting: no match');
  eq(personFor(snap, t1(snap), 'Somebody Else'), null);
});

group('Checking each suggestion against the board');

const REPLY = {
  wins_losses: [
    { kind: 'win', person: 'Alex', text: 'Trial passed', why: 'Prepped well' },
    { kind: 'loss', person: 'Priya Raman', text: 'Lost the bid', why: 'Price' }
  ],
  new_opportunities: [{ customer: 'Demo Quartz', title: 'Scale squeeze', owner: 'Sam Okafor', mission: 'Cut scale' }],
  opportunity_decisions: [{ id: 'pr4', decision: 'promoted' }, { id: 'pr1', decision: 'promoted' }],
  status_changes: [
    { id: 'pr1', status: 'off' }, { id: 'pr5', status: 'done' },
    { id: 'pr2', status: 'off' }, { id: 'pr3', status: 'finished' }
  ],
  issues: [{ text: 'No lab capacity', owner: 'Ravi', severity: 'risk' }],
  actions: [
    { text: 'Book the rheometer', owner: 'Alex Morgan', due: '2026-09-25', related_id: 'i1' },
    { text: 'Call them', owner: 'Nobody Here', due: '2026-09-25' },
    { text: 'Send data', owner: 'Priya', due: 'Friday' },
    { text: 'Chase', owner: 'Priya', due: '2026-09-30', related_id: 'pr5' }
  ],
  discussed: ['Holiday cover', '  ']
};

test('Good suggestions are ready to apply', () => {
  const snap = demoBoard(DAY);
  const ps = proposalsFrom(snap, t1(snap), MEETING, REPLY);
  ['wins_losses.0', 'new_opportunities.0', 'opportunity_decisions.0', 'status_changes.0',
    'issues.0', 'actions.0', 'discussed.0'].forEach(function (k) {
    ok(find(ps, k).ok, k + ' is fine');
  });
  ok(find(ps, 'actions.0').text.indexOf('re No rheometer time') > 0, 'the action says what it is about');
});

test('Anything that does not match the board is held back, with the reason', () => {
  const snap = demoBoard(DAY);
  const ps = proposalsFrom(snap, t1(snap), MEETING, REPLY);
  const why = function (k) { const p = find(ps, k); return p.ok ? '(applies)' : p.reason; };
  ok(why('wins_losses.1').indexOf('what we will do differently') >= 0, 'a loss with no change');
  ok(why('opportunity_decisions.1').indexOf('No opportunity') >= 0, 'pr1 is not an opportunity');
  ok(why('status_changes.1').indexOf('No current project') >= 0, 'pr5 is another meeting’s');
  ok(why('status_changes.2').indexOf('already') >= 0, 'pr2 is already off track');
  ok(why('status_changes.3').indexOf('Not a status') >= 0, '"finished" is not a status');
  ok(why('actions.1').indexOf('Nobody on the roster') >= 0, 'an unknown owner');
  ok(why('actions.2').indexOf('YYYY-MM-DD') >= 0, '"Friday" is not a date');
  ok(why('actions.3').indexOf('Nothing in this meeting') >= 0, 'a related id from elsewhere');
  notOk(find(ps, 'discussed.1').ok, 'a blank topic');
});

test('Applying writes what the board’s own buttons would, and skips what was unticked', () => {
  const snap = demoBoard(DAY);
  const ps = proposalsFrom(snap, t1(snap), MEETING, REPLY);
  let n = 0;
  const plan = planFrom(snap, t1(snap), MEETING, ps, ['wins_losses.0'], function () { return 'n' + (n++); });
  const sets = plan.ops.map(function (o) { return o.col + ':' + o.id; });
  notOk(plan.ops.some(function (o) { return o.col === 'entries' && o.data.text === 'Trial passed'; }),
    'the unticked win is left out');
  ok(sets.indexOf('projects:pr1') >= 0, 'the status change');
  eq(byId(plan.ops.filter(function (o) { return o.col === 'projects'; }).map(function (o) {
    return Object.assign({ id: o.id }, o.data || o.patch);
  }), 'pr1').status, 'off');
  ok(plan.ops.some(function (o) { return o.id === 'pr4' && o.patch && o.patch.oppStage === 'promoted'; }),
    'the promotion, through decideOpportunity');
  ok(plan.ops.some(function (o) { return o.col === 'projects' && o.data && o.data.name === 'Scale squeeze' &&
    o.data.customer === 'Demo Quartz'; }), 'the new opportunity');
  eq(plan.actions.length, 1, 'actions come back separately, for numbering');
  eq(plan.actions[0].parent, { type: 'issue', id: 'i1' });
  eq(plan.discussed, ['Holiday cover']);
});

group('Through the panel');

async function app() {
  const store = createStore(createMemoryAdapter({ seed: demoBoard(DAY), startActionNum: 20 }), {});
  await store.load();
  const ui = Object.assign(loadUi(), { view: 'tab', tab: 't1', dates: { t1: MEETING }, copilotShow: true });
  const copied = [];
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: ui, render: function () {}, today: function () { return DAY; }
  }));
  return { store: store, ui: ui, H: H, copied: copied,
    html: function () { return renderApp(store.snapshot(), ui, { today: DAY, modes: LIVE,
      identity: { kind: 'demo', personId: 'p1' } }); } };
}

function settle() { return new Promise(function (r) { setTimeout(r, 40); }); }

test('A Copilot button on every meeting, opening the two steps', () => {
  const html = renderApp(demoBoard(DAY), Object.assign(loadUi(), { view: 'tab', tab: 't1', copilotShow: true }),
    { today: DAY, modes: LIVE, identity: { kind: 'demo', personId: 'p1' } });
  ok(html.indexOf('data-act="toggleCopilot" aria-expanded="true">Copilot') > 0);
  ok(html.indexOf('data-act="copilotPrompt">Copy prompt') > 0);
  ok(html.indexOf('data-form="copilotReply"') > 0);
});

test('Paste, read, untick one, apply: the board changes and the panel clears', async () => {
  const a = await app();
  a.H.forms.copilotReply(new Map([['reply', '```json\n' + JSON.stringify(REPLY) + '\n```']]));
  ok(a.ui.copilotReply, 'the reply was read');
  const html = a.html();
  ok(html.indexOf('Can’t apply: No current project') > 0, 'held-back ones say why');
  ok(/data-v="status_changes.1" disabled/.test(html), 'and cannot be ticked');

  a.H.edits.copilotPick(/** @type {any} */ ({ dataset: { v: 'issues.0' }, checked: false }));
  eq(a.ui.copilotSkip, ['issues.0']);

  a.H.clicks.copilotApply(null, '', '');
  await settle();
  const snap = a.store.snapshot();
  eq(byId(snap.projects, 'pr1').status, 'off', 'status applied');
  eq(byId(snap.projects, 'pr4').oppStage, 'promoted', 'promotion applied');
  notOk(snap.issues.some(function (i) { return i.text === 'No lab capacity'; }), 'the unticked issue was not');
  const act = snap.actions.filter(function (x) { return x.text === 'Book the rheometer'; })[0];
  ok(act, 'the action was created');
  if (act) {
    eq(act.owner, 'Alex Morgan', 'owner by name, as actions store it');
    ok(act.num >= 20, 'with a real number');
    eq(act.parent, { type: 'issue', id: 'i1' });
  }
  eq(getMeeting(snap, 't1', MEETING).discussed, 'Holiday cover', 'discussed added');
  eq(a.ui.copilotReply, null, 'the draft is cleared');
});

test('A paste that is not readable shows why and changes nothing', async () => {
  const a = await app();
  const before = JSON.stringify(a.store.snapshot());
  a.H.forms.copilotReply(new Map([['reply', 'I could not access the transcript.']]));
  eq(a.ui.copilotReply, null);
  ok(a.html().indexOf('There is no JSON in that reply') > 0);
  eq(JSON.stringify(a.store.snapshot()), before);
});

group('Discussed');

test('One topic per line, with pasted bullets and numbers taken off', () => {
  eq(discussedTopics('- Holiday cover\n\n• Pricing review\n2. Lab move\n  plain  '),
    ['Holiday cover', 'Pricing review', 'Lab move', 'plain']);
});

test('Saving it keeps everything else the meeting record holds', () => {
  const snap = demoBoard(DAY);
  snap.meetings[memoryKey('t1', MEETING)] = { ratings: { p1: 4 }, note: 'kept' };
  eq(setDiscussed(snap, 't1', MEETING, 'Pricing'), { ratings: { p1: 4 }, note: 'kept', discussed: 'Pricing' });
});

test('The summary ends with DISCUSSED, and leaves it out when empty', () => {
  const snap = demoBoard(DAY);
  notOk(meetingSummary(snap, t1(snap), MEETING, DAY).indexOf('DISCUSSED') >= 0);
  snap.meetings[memoryKey('t1', MEETING)] = { ratings: {}, note: '', discussed: 'Holiday cover\nPricing' };
  const out = meetingSummary(snap, t1(snap), MEETING, DAY);
  ok(out.indexOf('DISCUSSED\n• Holiday cover\n• Pricing\n') >= 0);
  ok(out.indexOf('DISCUSSED') > out.indexOf('NEEDS ATTENTION'), 'last');
});

test('The box is in the Summary panel, and saves through its own handler', async () => {
  const a = await app();
  a.ui.sumShow = true;
  ok(/<textarea[^>]*id="f-discussed"[^>]*data-edit="meetingDiscussed"/.test(a.html()));
  a.H.edits.meetingDiscussed(/** @type {any} */ ({ value: 'Holiday cover' }));
  await settle();
  eq(getMeeting(a.store.snapshot(), 't1', MEETING).discussed, 'Holiday cover');
});
