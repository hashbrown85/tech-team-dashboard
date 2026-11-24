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
  copilotPrompt, readReply, personFor, proposalsFrom, planFrom, correctReply, retypeReply, overrideLegal
} from '../src/domain/copilot.js';
import {
  setDiscussed, discussedTopics, getMeeting, meetingSummary, memoryKey
} from '../src/domain/meetings.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';
import { byId } from '../src/lib/seq.js';
import { lastOn } from '../src/lib/dates.js';

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

group('Correcting a suggestion before applying it');

const GARBLED = {
  wins_losses: [{ kind: 'loss', person: 'Pria Ramon', text: 'Lost the bid', why: 'Price' }],
  status_changes: [{ id: 'pr 1', status: 'off' }],
  actions: [{ text: 'Book the rheometer', owner: 'Alex Morgan', due: 'Thursday' }],
  discussed: ['Holliday cover']
};

test('A correction replaces only that suggestion, and only allowed fields', () => {
  const fixed = correctReply(GARBLED, 'wins_losses.0',
    { person: 'Priya Raman', change: 'Quote earlier', secret: 'ignored' });
  eq(fixed.wins_losses[0], { kind: 'loss', person: 'Priya Raman', text: 'Lost the bid',
    why: 'Price', change: 'Quote earlier' });
  eq(GARBLED.wins_losses[0].person, 'Pria Ramon', 'the original is left alone');
  eq(fixed.status_changes, GARBLED.status_changes, 'other suggestions untouched');
  eq(correctReply(GARBLED, 'discussed.0', { text: ' Holiday cover ' }).discussed, ['Holiday cover']);
  ok(correctReply(GARBLED, 'nonsense', { text: 'x' }) === GARBLED, 'a bad key changes nothing');
  ok(correctReply(GARBLED, 'actions.9', { text: 'x' }) === GARBLED, 'nor one past the end');
});

test('The Edit form offers the real roster and the meeting’s projects as dropdowns', () => {
  const ui = Object.assign(loadUi(), { view: 'tab', tab: 't1', dates: { t1: MEETING },
    copilotShow: true, copilotReply: GARBLED, open: 'cpfix:wins_losses.0' });
  const html = renderApp(demoBoard(DAY), ui, { today: DAY, modes: LIVE,
    identity: { kind: 'demo', personId: 'p1' } });
  const form = /<form class="add cpfix" data-form="copilotFix" data-v="wins_losses.0">[\s\S]*?<\/form>/.exec(html);
  ok(form, 'the row is a form');
  if (!form) return;
  ok(form[0].indexOf('<option value="Pria Ramon" selected>Pria Ramon (not on the board)</option>') > 0,
    'what Copilot heard is shown for what it is');
  ok(form[0].indexOf('<option value="Priya Raman">Priya Raman</option>') > 0, 'the real name is a pick');

  ui.open = 'cpfix:status_changes.0';
  const html2 = renderApp(demoBoard(DAY), ui, { today: DAY, modes: LIVE,
    identity: { kind: 'demo', personId: 'p1' } });
  ok(html2.indexOf('<option value="pr1">Meridian Coatings - Coating additive trial</option>') > 0,
    'projects by their full title');
  notOk(html2.indexOf('<option value="pr5">') > 0, 'not another meeting’s');
});

test('Every row offers Edit, held back or not', () => {
  const ui = Object.assign(loadUi(), { view: 'tab', tab: 't1', dates: { t1: MEETING },
    copilotShow: true, copilotReply: GARBLED });
  const html = renderApp(demoBoard(DAY), ui, { today: DAY, modes: LIVE,
    identity: { kind: 'demo', personId: 'p1' } });
  ['wins_losses.0', 'status_changes.0', 'actions.0', 'discussed.0'].forEach(function (k) {
    ok(html.indexOf('data-act="copilotEdit" data-v="' + k + '"') > 0, k);
  });
});

test('Garbled in, corrected, applied: the reported case', async () => {
  const a = await app();
  a.H.forms.copilotReply(new Map([['reply', JSON.stringify(GARBLED)]]));
  const before = proposalsFrom(a.store.snapshot(), byId(a.store.snapshot().tabs, 't1'), MEETING, a.ui.copilotReply);
  ok(before.every(function (p) { return p.key === 'discussed.0' ? p.ok : !p.ok; }),
    'everything but the topic is held back at first');

  a.H.clicks.copilotEdit(null, '', 'wins_losses.0');
  eq(a.ui.open, 'cpfix:wins_losses.0');
  const form = /** @type {any} */ ({ dataset: { v: 'wins_losses.0' } });
  a.H.forms.copilotFix(new Map([['kind', 'loss'], ['person', 'Priya Raman'], ['text', 'Lost the bid'],
    ['why', 'Price'], ['change', 'Quote earlier']]), form);
  eq(a.ui.open, null, 'the form closes');
  a.H.forms.copilotFix(new Map([['id', 'pr1'], ['status', 'off']]),
    /** @type {any} */ ({ dataset: { v: 'status_changes.0' } }));
  a.H.forms.copilotFix(new Map([['text', 'Book the rheometer'], ['owner', 'Alex Morgan'],
    ['due', '2026-09-24'], ['related_id', 'i1']]), /** @type {any} */ ({ dataset: { v: 'actions.0' } }));

  const after = proposalsFrom(a.store.snapshot(), byId(a.store.snapshot().tabs, 't1'), MEETING, a.ui.copilotReply);
  ok(after.every(function (p) { return p.ok; }), 'all of them can apply now');

  a.H.clicks.copilotApply(null, '', '');
  await settle();
  const snap = a.store.snapshot();
  ok(snap.entries.some(function (e) { return e.kind === 'loss' && e.personId === 'p2' && e.change === 'Quote earlier'; }),
    'the loss, credited to the right person');
  eq(byId(snap.projects, 'pr1').status, 'off');
  ok(snap.actions.some(function (x) { return x.text === 'Book the rheometer' && x.due === '2026-09-24' &&
    x.parent && x.parent.id === 'i1'; }), 'the action, dated and attached');
});

test('Correcting a row someone had unticked ticks it again', async () => {
  const a = await app();
  a.H.forms.copilotReply(new Map([['reply', JSON.stringify({ discussed: ['Pricing'] })]]));
  a.H.edits.copilotPick(/** @type {any} */ ({ dataset: { v: 'discussed.0' }, checked: false }));
  eq(a.ui.copilotSkip, ['discussed.0']);
  a.H.forms.copilotFix(new Map([['text', 'Pricing review']]), /** @type {any} */ ({ dataset: { v: 'discussed.0' } }));
  eq(a.ui.copilotSkip, []);
});

group('Switching a suggestion to another type');

test('An issue becomes a loss: words and person carried, the rest of the list untouched', () => {
  const r = retypeReply(REPLY, 'issues.0', 'loss', {});
  eq(r.key, 'wins_losses.2', 'on the end of the wins and losses');
  eq(r.reply.wins_losses[2], { kind: 'loss', person: 'Ravi', text: 'No lab capacity', why: '', change: '' });
  eq(r.reply.issues[0], null, 'its old slot emptied, not removed');
  eq(r.reply.actions, REPLY.actions, 'nothing else moves, so every other key - and tick - holds');
  eq(REPLY.issues.length, 1, 'the original reply is not changed');

  const ps = proposalsFrom(demoBoard(DAY), t1(demoBoard(DAY)), MEETING, r.reply);
  notOk(ps.some(function (p) { return p.key === 'issues.0'; }), 'the issue row is gone');
  const loss = find(ps, 'wins_losses.2');
  eq(loss.kind, 'loss');
  eq(loss.reason, 'A loss needs what we will do differently.', 'held back until that is filled in');
});

test('What was typed in the form before switching is kept', () => {
  const r = retypeReply(REPLY, 'issues.0', 'action', { text: 'Rent lab time', owner: 'Ravi Chandra' });
  eq(r.reply.actions[4], { text: 'Rent lab time', owner: 'Ravi Chandra', due: '', related_id: '' });
});

test('Every way round: win to loss in place, topic to action, opportunity to discussed', () => {
  const w = retypeReply(REPLY, 'wins_losses.0', 'loss', {});
  eq(w.key, 'wins_losses.0', 'win and loss are one list, so it stays put');
  eq(w.reply.wins_losses[0].kind, 'loss');

  const t = retypeReply(REPLY, 'discussed.0', 'action', {});
  eq(t.reply.actions[4].text, 'Holiday cover');

  const o = retypeReply(REPLY, 'new_opportunities.0', 'discussed', {});
  eq(o.reply.discussed[2], 'Scale squeeze');
});

test('Decisions and status changes cannot be switched', () => {
  eq(retypeReply(REPLY, 'status_changes.0', 'issue', {}).reply, REPLY);
  eq(retypeReply(REPLY, 'opportunity_decisions.0', 'win', {}).reply, REPLY);
});

test('The form offers Type; switching keeps it open on the moved suggestion, ticked', async () => {
  const a = await app();
  a.H.forms.copilotReply(new Map([['reply', JSON.stringify(REPLY)]]));
  a.H.clicks.copilotEdit(null, '', 'issues.0');
  const html = a.html();
  ok(/<select class="fld" name="type"[^>]*data-edit="copilotType" data-v="issues.0"/.test(html));
  ok(html.indexOf('<option value="issue" selected>Issue</option>') >= 0);

  a.ui.copilotSkip = ['issues.0'];
  a.H.edits.copilotType(/** @type {any} */ ({ dataset: { v: 'issues.0' }, value: 'loss', form: null }));
  eq(a.ui.open, 'cpfix:wins_losses.2', 'the form stays open, on the loss now');
  eq(a.ui.copilotSkip, []);
  ok(a.html().indexOf('<option value="loss" selected>Loss</option>') >= 0);

  a.H.forms.copilotFix(new Map([['type', 'loss'], ['person', 'Ravi Chandra'], ['text', 'No lab capacity'],
    ['why', 'Booked out'], ['change', 'Book a month ahead']]),
    /** @type {any} */ ({ dataset: { v: 'wins_losses.2' } }));
  a.H.clicks.copilotApply(null, '', '');
  await settle();
  const snap = a.store.snapshot();
  ok(snap.entries.some(function (e) { return e.kind === 'loss' && e.text === 'No lab capacity' &&
    e.change === 'Book a month ahead'; }), 'applied as a loss');
  notOk(snap.issues.some(function (i) { return i.text === 'No lab capacity'; }), 'and not as an issue');
});

group('Actions tied to a new opportunity or issue in the same reply');

const LINKED = {
  new_opportunities: [{ customer: 'Demo Quartz', title: 'Scale squeeze', owner: 'Sam Okafor', mission: '' }],
  issues: [{ text: 'Loads cancelled', owner: 'Alex Morgan', severity: 'stopper' }],
  actions: [
    { text: 'Send the proposal', owner: 'Sam Okafor', due: '2026-09-25', related_id: 'new_opportunities.0' },
    { text: 'Call dispatch', owner: 'Alex Morgan', due: '2026-09-24', related_id: 'issues.0' }
  ]
};

test('The prompt tells Copilot how to point at something new in the same reply', () => {
  const snap = demoBoard(DAY);
  ok(copilotPrompt(snap, t1(snap), MEETING).indexOf('new_opportunities.0 or issues.1') >= 0);
});

test('They are ready to apply, and say what they are tied to', () => {
  const snap = demoBoard(DAY);
  const ps = proposalsFrom(snap, t1(snap), MEETING, LINKED);
  const opp = find(ps, 'actions.0');
  ok(opp.ok, opp.reason);
  ok(opp.text.indexOf('re Opportunity: Demo Quartz - Scale squeeze (new, above)') >= 0, opp.text);
  ok(find(ps, 'actions.1').text.indexOf('re Issue: Loads cancelled (new, above)') >= 0);
});

test('Applied: each action is tied to the opportunity or issue just made', async () => {
  const a = await app();
  a.H.forms.copilotReply(new Map([['reply', JSON.stringify(LINKED)]]));
  a.H.clicks.copilotApply(null, '', '');
  await settle();
  const snap = a.store.snapshot();
  const opp = snap.projects.filter(function (p) { return p.name === 'Scale squeeze'; })[0];
  const iss = snap.issues.filter(function (i) { return i.text === 'Loads cancelled'; })[0];
  const send = snap.actions.filter(function (x) { return x.text === 'Send the proposal'; })[0];
  const call = snap.actions.filter(function (x) { return x.text === 'Call dispatch'; })[0];
  eq(send.parent, { type: 'project', id: opp.id }, 'on the opportunity, not yet promoted');
  eq(call.parent, { type: 'issue', id: iss.id }, 'and on the issue - so it has its path');
});

test('If what it is tied to is unticked, the row says so and the action goes on loose', async () => {
  const a = await app();
  a.H.forms.copilotReply(new Map([['reply', JSON.stringify(LINKED)]]));
  a.ui.copilotSkip = ['new_opportunities.0'];
  ok(a.html().indexOf('What it is tied to is not being added') >= 0);
  a.H.clicks.copilotApply(null, '', '');
  await settle();
  const send = a.store.snapshot().actions.filter(function (x) { return x.text === 'Send the proposal'; })[0];
  eq(send.parent, null);
});

test('If what it is tied to changes type, the action is held back to be re-pointed', () => {
  const snap = demoBoard(DAY);
  const moved = retypeReply(LINKED, 'issues.0', 'loss', {}).reply;
  const row = find(proposalsFrom(snap, t1(snap), MEETING, moved), 'actions.1');
  notOk(row.ok);
  ok(row.reason.indexOf('changed to another type') >= 0);
});

test('Edit offers the new opportunity and issue under Related to', async () => {
  const a = await app();
  a.H.forms.copilotReply(new Map([['reply', JSON.stringify(LINKED)]]));
  a.H.clicks.copilotEdit(null, '', 'actions.0');
  const html = a.html();
  ok(html.indexOf('<option value="new_opportunities.0" selected>New opportunity: Demo Quartz - Scale squeeze</option>') >= 0);
  ok(html.indexOf('<option value="issues.0">New issue: Loads cancelled</option>') >= 0);
});

group('Keeping Copilot within legal bounds');

test('The prompt carries the legal rules and asks for a legal_review list', () => {
  const snap = demoBoard(DAY);
  const text = copilotPrompt(snap, t1(snap), MEETING);
  ['Competitors may be named', 'confidential source', 'talking WITH a competitor',
    'personal matters', 'reword it to the plainly safe version or leave it out', '"legal_review"']
    .forEach(function (s) { ok(text.indexOf(s) >= 0, s); });
});

test('What was set aside is shown by subject, and never applied', async () => {
  const a = await app();
  a.H.forms.copilotReply(new Map([['reply', JSON.stringify({
    discussed: ['Holiday cover'],
    legal_review: [{ topic: 'A competitor conversation', reason: 'Talking with a competitor about bids' }, '  ']
  })]]));
  const html = a.html();
  ok(html.indexOf('Set aside for a check with Legal') >= 0);
  ok(html.indexOf('A competitor conversation') >= 0 && html.indexOf('Talking with a competitor about bids') >= 0);
  notOk(/data-edit="copilotPick" data-v="legal_review/.test(html), 'no tick box - it cannot be applied');
  eq(proposalsFrom(a.store.snapshot(), byId(a.store.snapshot().tabs, 't1'), MEETING, a.ui.copilotReply).length, 1,
    'only the topic is a suggestion');
});

test('No legal_review, no note', async () => {
  const a = await app();
  a.H.forms.copilotReply(new Map([['reply', JSON.stringify({ discussed: ['Holiday cover'] })]]));
  notOk(a.html().indexOf('Set aside for a check with Legal') >= 0);
});

test('Keep off marks it; Add anyway turns it into a suggestion to write, form open', async () => {
  const a = await app();
  a.H.forms.copilotReply(new Map([['reply', JSON.stringify({
    discussed: ['Holiday cover'],
    legal_review: [{ topic: 'Competitor pricing', reason: 'Confidential source' },
      { topic: 'A personal matter', reason: 'Personal' }]
  })]]));
  ok(a.html().indexOf('data-act="copilotLegalAdd" data-v="0"') >= 0);

  a.H.clicks.copilotLegalKeep(null, '', '1');
  eq(a.ui.copilotLegalOk, [1]);
  ok(a.html().indexOf('Kept off') >= 0);

  a.H.clicks.copilotLegalAdd(null, '', '0');
  eq(a.ui.copilotReply.discussed, ['Holiday cover', 'Competitor pricing']);
  eq(a.ui.copilotReply.legal_review[0], null, 'gone from the set-aside list');
  eq(a.ui.open, 'cpfix:discussed.1', 'its form open, to pick a type and write it');
  const html = a.html();
  ok(html.indexOf('A personal matter') >= 0, 'the other one stays');
  ok(/<select class="fld" name="type"[^>]*data-v="discussed.1"/.test(html), 'with Type to switch');

  a.H.edits.copilotType(/** @type {any} */ ({ dataset: { v: 'discussed.1' }, value: 'loss', form: null }));
  a.H.forms.copilotFix(new Map([['type', 'loss'], ['person', 'Alex Morgan'],
    ['text', 'Lost on price to the incumbent'], ['why', 'Customer said we were high'],
    ['change', 'Quote earlier']]), /** @type {any} */ ({ dataset: { v: a.ui.open.slice(6) } }));
  a.H.clicks.copilotApply(null, '', '');
  await settle();
  ok(a.store.snapshot().entries.some(function (e) { return e.text === 'Lost on price to the incumbent'; }),
    'written by the reader, applied like any other');
  eq(a.ui.copilotLegalOk, [], 'and the marks clear with the reply');
});

test('Nothing in legal_review can be added twice or out of range', () => {
  const r = { legal_review: ['Topic'] };
  eq(overrideLegal(r, 5).key, '');
  const once = overrideLegal(r, 0).reply;
  eq(overrideLegal(once, 0).key, '', 'already added');
});

group('Copilot and Summary use the meeting just held');

test('lastOn: the given weekday on or before a date', () => {
  eq(lastOn('2026-09-22', 1), '2026-09-21', 'Tuesday back to Monday');
  eq(lastOn('2026-09-21', 1), '2026-09-21', 'on the day itself');
  eq(lastOn('2026-09-20', 1), '2026-09-14', 'Sunday back a week');
});

test('Opened the day after, both move the meeting back to the one just held', async () => {
  for (const act of ['toggleCopilot', 'toggleSummary']) {
    const a = await app();
    a.ui.dates = {};
    a.ui.copilotShow = false;
    a.H.clicks[act](null, '', '');
    eq(a.ui.dates.t1, '2026-09-21', act + ': Tuesday the 22nd opens on Monday the 21st');
  }
});

test('A date picked with the arrows is kept', async () => {
  const a = await app();
  a.ui.dates = { t1: '2026-09-28' };
  a.ui.copilotShow = false;
  a.H.clicks.toggleCopilot(null, '', '');
  eq(a.ui.dates.t1, '2026-09-28');
});

test('Applied there: filed under the meeting just held, and the panels say which', async () => {
  const a = await app();
  a.ui.dates = {};
  a.ui.copilotShow = false;
  a.H.clicks.toggleCopilot(null, '', '');
  ok(a.html().indexOf('Suggested changes from the meeting on Mon, Sep 21') >= 0);
  a.H.forms.copilotReply(new Map([['reply', JSON.stringify({
    wins_losses: [{ kind: 'win', person: 'Alex Morgan', text: 'Held-meeting win', why: 'x' }] })]]));
  a.H.clicks.copilotApply(null, '', '');
  await settle();
  const e = a.store.snapshot().entries.filter(function (x) { return x.text === 'Held-meeting win'; })[0];
  eq(e.meeting, '2026-09-21', 'not next week');
  a.H.clicks.toggleSummary(null, '', '');
  ok(a.html().indexOf('For the meeting on Mon, Sep 21') >= 0);
});

test('Closing both panels puts the meeting forward again; an arrow-picked date stays', async () => {
  const a = await app();
  a.ui.dates = {};
  a.ui.copilotShow = false;
  a.H.clicks.toggleCopilot(null, '', '');
  a.H.clicks.toggleSummary(null, '', '');
  a.H.clicks.toggleCopilot(null, '', '');
  eq(a.ui.dates.t1, '2026-09-21', 'still back while the Summary is open');
  a.H.clicks.toggleSummary(null, '', '');
  eq(a.ui.dates.t1, undefined, 'both closed: back to showing the next meeting');

  a.ui.dates = { t1: '2026-09-14' };
  a.H.clicks.toggleCopilot(null, '', '');
  a.H.clicks.toggleCopilot(null, '', '');
  eq(a.ui.dates.t1, '2026-09-14', 'a date picked on purpose is left alone');
});
