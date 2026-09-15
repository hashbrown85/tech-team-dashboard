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
