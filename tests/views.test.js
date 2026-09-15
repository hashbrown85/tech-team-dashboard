// @ts-check
/**
 * Smoke tests for the views.
 *
 * Views are pure functions from (snapshot, ui, env) to an HTML string, which is what
 * makes this possible without a browser: render every screen and check the output is
 * sane. These catch the mistakes that are otherwise invisible until someone opens the
 * page - a missing field printing "undefined", a number coming out "NaN", an
 * unclosed tag wrecking the layout below it.
 *
 * They deliberately do NOT check wording or styling. That is what looking at it is
 * for. These check it does not fall over.
 */

import { group, test, ok, notOk, eq } from './harness.js';
import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { blankSnapshot } from '../src/adapters/DataStore.js';
import { today } from '../src/lib/dates.js';
import { loadUi } from '../src/ui.js';

const MODES = { content: 'live', settings: 'live' };
const snap = demoBoard();
const base = loadUi();

function render(uiOverrides, modes) {
  return renderApp(snap, Object.assign({}, base, uiOverrides), {
    today: today(),
    modes: modes || MODES
  });
}

/** Anything that means a value failed to arrive. */
function leaks(html) {
  return ['undefined', 'NaN', '[object Object]']
    .filter(function (bad) { return html.indexOf(bad) >= 0; });
}

/** Crude tag balance on the containers that break a layout when unclosed. */
function unbalanced(html) {
  const out = [];
  [['<div', '</div>'], ['<section', '</section>'], ['<ul', '</ul>'],
   ['<button', '</button>'], ['<table', '</table>'], ['<form', '</form>']]
    .forEach(function (pair) {
      const opens = (html.match(new RegExp(pair[0] + '[ >]', 'g')) || []).length;
      const closes = (html.match(new RegExp(pair[1], 'g')) || []).length;
      if (opens !== closes) out.push(pair[0] + ' ' + opens + ' vs ' + pair[1] + ' ' + closes);
    });
  return out;
}

const SCREENS = [
  ['the overview', { view: 'overview' }],
  ['wins and losses', { view: 'tab', tab: 't1', steps: { t1: 0 } }],
  ['new opportunities', { view: 'tab', tab: 't1', steps: { t1: 1 } }],
  ['current projects', { view: 'tab', tab: 't1', steps: { t1: 2 } }],
  ['the issues queue', { view: 'tab', tab: 't1', steps: { t1: 3 } }],
  ['rate the meeting', { view: 'tab', tab: 't1', steps: { t1: 4 } }],
  ['the tech directors business review', { view: 'tab', tab: 'techdir', steps: { techdir: 1 } }],
  ['meeting settings', { view: 'tab', tab: 't1', settings: true } ],
  ['the action register', { view: 'actions' }],
  ['the register filtered to overdue', { view: 'actions', filter: 'over' }],
  ['the follow-up text', { view: 'actions', follow: true }],
  ['the timeline', { view: 'timeline' }],
  ['the timeline by person', { view: 'timeline', tlGroup: 'person' }],
  ['the roster', { view: 'people' }],
  ['project details, when visible', { view: 'tab', tab: 't1', steps: { t1: 2 }, iam: 'p1' }],
  ['the summary preview', { view: 'tab', tab: 't1', steps: { t1: 4 }, sumShow: true }]
];

group('Every screen renders');

SCREENS.forEach(function (screen) {
  test(screen[0] + ' renders without holes', function () {
    const html = render(screen[1]);
    ok(html.length > 1000, 'produced ' + html.length + ' characters');
    eq(leaks(html), [], 'no missing values in the output');
    eq(unbalanced(html), [], 'tags balance');
  });
});

group('Screens that could reasonably crash');

test('An empty board renders rather than throwing', function () {
  const html = renderApp(blankSnapshot(), base, { today: today(), modes: MODES });
  ok(html.indexOf('No meetings yet') >= 0, 'and says there is nothing yet');
  eq(leaks(html), []);
});

test('A meeting id that no longer exists falls back to the overview', function () {
  const html = render({ view: 'tab', tab: 'deleted-meeting' });
  ok(html.indexOf('Overview') >= 0, 'rather than showing a broken meeting');
  eq(leaks(html), []);
});

test('Filtering to one person does not empty the frame', function () {
  const html = render({ view: 'actions', person: 'Alex Morgan' });
  ok(html.indexOf('Alex Morgan') >= 0);
  eq(leaks(html), []);
});

group('Read-only rendering');

test('A read-only area disables its controls and says so', function () {
  const html = render({ view: 'people' }, { content: 'live', settings: 'readonly' });
  ok(html.indexOf('disabled') >= 0, 'controls are disabled');
  ok(html.indexOf('View only') >= 0, 'and the pill explains why');
});

test('Read-only in one area leaves the other alone', function () {
  const html = render({ view: 'actions' }, { content: 'live', settings: 'readonly' });
  ok(html.indexOf('View only') < 0, 'content is still editable');
});

group('Where the due-since-last-meeting block lives');

test('It sits at the top of Issues, not in Wins & Losses', () => {
  // It is a list of outstanding commitments, so it belongs immediately before the
  // group agrees new ones - not at the start of the meeting.
  const wins = render({ view: 'tab', tab: 't1', steps: { t1: 0 } });
  const issues = render({ view: 'tab', tab: 't1', steps: { t1: 3 } });

  notOk(wins.indexOf('duechk') >= 0, 'gone from Wins & Losses');
  ok(issues.indexOf('duechk') >= 0, 'present in Issues');
  ok(issues.indexOf('duechk') < issues.indexOf('class="issue'), 'above the queue');
});

test('It is absent entirely when nothing is outstanding', () => {
  const clean = demoBoard();
  clean.actions = clean.actions.filter(function (a) { return a.status === 'done'; });
  const html = renderApp(clean, Object.assign({}, base, {
    view: 'tab', tab: 't1', steps: { t1: 3 }
  }), { today: today(), modes: MODES });

  notOk(html.indexOf('duechk') >= 0, 'no empty panel taking up space');
});

group('The agenda clock is off unless a meeting asks for it');

/** The demo board with the clock switched on for the first meeting. */
function withClock() {
  const snap = demoBoard();
  snap.tabs.find(function (t) { return t.id === 't1'; }).showTimer = true;
  return snap;
}

function meetingHtml(snap) {
  return renderApp(snap, Object.assign({}, base, { view: 'tab', tab: 't1', steps: { t1: 3 } }),
    { today: today(), modes: MODES });
}

test('By default there is no clock, no hint and no step badge', () => {
  // Deliberate: rolling this out should not start by timing people.
  const html = meetingHtml(demoBoard());
  notOk(html.indexOf('class="tmr"') >= 0, 'no timer');
  notOk(html.indexOf('t-hint') >= 0, 'no pacing hint');
  notOk(html.indexOf('st-b') >= 0, 'no per-step time budget or count');
});

test('Switching it on for a meeting brings all of it back', () => {
  const html = meetingHtml(withClock());
  ok(html.indexOf('class="tmr"') >= 0, 'timer');
  ok(html.indexOf('t-hint') >= 0, 'pacing hint');
  ok(html.indexOf('st-b') >= 0, 'per-step budget');
  ok(html.indexOf('data-act="timerToggle"') >= 0, 'start/pause');
  ok(html.indexOf('data-act="timerReset"') >= 0, 'reset');
});

test('It is per meeting, so one can have a clock and another not', () => {
  const snap = withClock();
  const t1 = renderApp(snap, Object.assign({}, base, { view: 'tab', tab: 't1' }),
    { today: today(), modes: MODES });
  const t2 = renderApp(snap, Object.assign({}, base, { view: 'tab', tab: 't2' }),
    { today: today(), modes: MODES });

  ok(t1.indexOf('class="tmr"') >= 0, 'the meeting that asked for it has one');
  notOk(t2.indexOf('class="tmr"') >= 0, 'the one that did not, does not');
});

test('The setting is on the meeting settings screen and reflects its state', () => {
  const off = renderApp(demoBoard(), Object.assign({}, base, {
    view: 'tab', tab: 't1', settings: true
  }), { today: today(), modes: MODES });
  const on = renderApp(withClock(), Object.assign({}, base, {
    view: 'tab', tab: 't1', settings: true
  }), { today: today(), modes: MODES });

  ok(off.indexOf('data-edit="tabTimer"') >= 0, 'the checkbox is there');
  notOk(/data-edit="tabTimer" checked/.test(off), 'unticked by default');
  ok(/data-edit="tabTimer" checked/.test(on), 'ticked once switched on');
});

group('Markup the stylesheet dictates');

/*
 * These exist because of a real bug: the "now tracked as actions" rows were given
 * `class="item mv"`. `.mv` is the 26px move BUTTON, so every row was forced to 26px
 * wide and the text wrapped one character per line. `.item` added a second,
 * competing grid on top of the one `.moved li` already defines.
 *
 * The lesson is that a class name is not decoration - several of them carry a
 * layout, and picking one that looks plausible is not the same as picking the one
 * the stylesheet means. These pin the structures where that matters.
 */

/** The "moved" section for a board that has one. */
function movedSection() {
  const html = render({ view: 'tab', tab: 't1', steps: { t1: 3 } });
  const start = html.indexOf('class="moved"');
  ok(start > 0, 'the demo board has an item with a path, so the section is present');
  return html.slice(start, html.indexOf('</ul>', start));
}

test('A moved row carries no class that brings its own layout', () => {
  const section = movedSection();
  const row = /<li[^>]*>/.exec(section)[0];

  notOk(/item/.test(row), '.item is a three-column grid and would fight .moved li');
  notOk(/class="[^"]*mv/.test(row), '.mv is the 26px move button and would collapse the row');
  ok(/<li id="iss-/.test(row), 'and the row keeps an id, so it can be scrolled to');
});

test('A moved row is chip, then text, then the action lines', () => {
  // .moved li is a two-column grid: the chip sizes column one, everything else
  // sits in column two. Reordering these silently breaks the alignment.
  const section = movedSection();
  ok(/<li id="iss-[^"]*"><span class="chip /.test(section), 'chip comes first');
  ok(section.indexOf('class="mv-t"') > section.indexOf('class="chip'), 'then the text');
  ok(section.indexOf('class="mv-a"') > section.indexOf('class="mv-t"'), 'then the actions');
});

test('Each moved row names its action, owner and due date', () => {
  ok(/→ A-\d+ [^<·]+ · /.test(movedSection()),
    'so the room can see who picked it up and by when');
});

test('The issue toolbar uses the small button style throughout', () => {
  const html = render({ view: 'tab', tab: 't1', steps: { t1: 3 } });
  const bar = html.slice(html.indexOf('is-tools'), html.indexOf('</div>', html.indexOf('is-tools')));

  ok(/class="mv" type="button" data-act="moveIssue"/.test(bar), 'move buttons are .mv (26px)');
  notOk(/class="icon"/.test(bar), 'not .icon, which is the 32px date-nav chevron');
  ok(/is-tools edit-only/.test(html), 'and the whole toolbar hides when read-only');
});

test('Move buttons are disabled at the ends rather than doing nothing', () => {
  const html = render({ view: 'tab', tab: 't1', steps: { t1: 3 } });
  ok(/data-v="-1"[^>]*disabled/.test(html), 'the top row cannot move up');
  ok(/data-v="1"[^>]*disabled/.test(html), 'the bottom row cannot move down');
});

test('Dueness is measured against today, not the meeting being viewed', () => {
  // Navigating to another week must not change whether something is overdue.
  const thisWeek = render({ view: 'tab', tab: 't1', steps: { t1: 3 } });
  const nextWeek = render({
    view: 'tab', tab: 't1', steps: { t1: 3 }, dates: { t1: '2027-01-04' }
  });

  const overdueIn = (html) => (html.match(/\d+d overdue/g) || []).length;
  eq(overdueIn(nextWeek), overdueIn(thisWeek),
    'the same work is overdue whichever week you are looking at');
});

group('The Project Details panel stays where you left it');

/*
 * Reported as "the project details close after entering information into each box".
 * Two causes, and the second is worse than the reported symptom: every field edit
 * triggered a full redraw, AND the background poll redraws every sixty seconds, so
 * the panel would shut by itself while somebody was still typing in it.
 */

function projectsStep(uiOverrides) {
  return render(Object.assign({ view: 'tab', tab: 't1', steps: { t1: 2 } }, uiOverrides || {}));
}

test('It is closed until opened', () => {
  notOk(/data-details="pr1" open/.test(projectsStep()), 'not open by default');
});

test('Once opened, a redraw leaves it open', () => {
  // A render is not a reset. The user has not asked for anything to close.
  ok(/data-details="pr1" open/.test(projectsStep({ openDetails: { pr1: true } })));
});

test('Only the panel that was opened is open', () => {
  const html = projectsStep({ openDetails: { pr1: true } });
  eq((html.match(/ open>/g) || []).length, 1, 'opening one does not open them all');
});

test('Each panel is identifiable, so its state can be recorded', () => {
  ok(/data-details="pr1"/.test(projectsStep()), 'carries the project id');
});

group('Edits that only echo typing do not redraw');

test('Writing a project figure is silent', async () => {
  // The screen is already correct - the user typed it. Redrawing would throw away
  // their focus, their caret, and the panel they are working in.
  const { createStore } = await import('../src/store.js');
  const { createMemoryAdapter } = await import('../src/adapters/memoryAdapter.js');
  const { createHandlers } = await import('../src/handlers.js');

  const adapter = createMemoryAdapter({ seed: demoBoard() });
  let redraws = 0;
  const store = createStore(adapter, { onChange: function () { redraws++; } });
  await store.load();
  redraws = 0;

  const ui = Object.assign(loadUi(), { view: 'tab', tab: 't1' });
  const H = createHandlers({ store: store, ui: ui, render: function () { redraws++; }, today: today });

  H.edits.pdValue(/** @type {any} */ ({ dataset: { id: 'pr1' }, value: '250000' }));
  await new Promise(function (r) { setTimeout(r, 20); });

  eq(redraws, 0, 'no redraw at all');
  eq(store.snapshot().projectDetails.find(function (d) { return d.id === 'pr1'; }).estValue,
    250000, 'but the figure was still saved');
});

test('A change with consequences beyond the field still redraws', async () => {
  // Changing a meeting's weekday moves every date on the screen, so the screen is
  // NOT already correct and a redraw is exactly right.
  const { createStore } = await import('../src/store.js');
  const { createMemoryAdapter } = await import('../src/adapters/memoryAdapter.js');
  const { createHandlers } = await import('../src/handlers.js');

  const adapter = createMemoryAdapter({ seed: demoBoard() });
  const store = createStore(adapter, {});
  await store.load();

  let redraws = 0;
  const ui = Object.assign(loadUi(), { view: 'tab', tab: 't1', settings: true });
  const H = createHandlers({ store: store, ui: ui, render: function () { redraws++; }, today: today });

  H.edits.tabWeekday(/** @type {any} */ ({ value: '3' }));
  await new Promise(function (r) { setTimeout(r, 20); });

  ok(redraws > 0, 'the dates on screen have to catch up');
});

group('Escaping');

test('Board content is escaped, so a stray character cannot break the page', function () {
  const nasty = demoBoard();
  nasty.tabs[0].name = 'R&D <script>alert(1)</script> "quoted"';
  const html = renderApp(nasty, Object.assign({}, base, { view: 'overview' }),
    { today: today(), modes: MODES });

  ok(html.indexOf('<script>alert(1)</script>') < 0, 'no raw script tag survives');
  ok(html.indexOf('R&amp;D') >= 0, 'the ampersand is escaped');
  ok(html.indexOf('&lt;script&gt;') >= 0, 'and the angle brackets are');
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
