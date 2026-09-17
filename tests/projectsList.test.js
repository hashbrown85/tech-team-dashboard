// @ts-check
/**
 * The Projects list: every project across every meeting.
 *
 * Until this existed, finding a project meant remembering which meeting it belonged
 * to. Three things here are worth defending with tests rather than by eye.
 *
 * **The order.** Off track first, then soonest due, undated last — the order you
 * would work down it. Getting this wrong is invisible: the list still looks like a
 * list.
 *
 * **What a filter hides.** An empty list has to say *why* it is empty, because
 * "no projects" while a filter quietly hides them is how somebody ends up entering
 * a duplicate.
 *
 * **The value column.** Same restricted collection as everywhere else, so a refused
 * reader must not receive the figures — not merely not see them.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { renderApp } from '../src/views/render.js';
import { matchesStatus, byWorkOrder } from '../src/views/projects.js';
import { demoBoard } from '../src/demo-data.js';
import { loadUi } from '../src/ui.js';
import { today, addDays } from '../src/lib/dates.js';

const MODES = { content: 'live', settings: 'live' };
const TODAY = today();
const base = loadUi();

function page(opts) {
  const o = opts || {};
  const snap = o.snap || demoBoard();
  return renderApp(snap, Object.assign({}, base, { view: 'projects' }, o.ui || {}), {
    today: TODAY,
    modes: o.modes || MODES,
    identity: { personId: 'p1', displayName: 'Alex Morgan' }
  });
}

/** The project ids in the order the table renders them. */
function orderOf(html) {
  return (html.match(/data-act="openProject" data-id="([a-zA-Z0-9]+)"/g) || [])
    .map(function (m) { return /data-id="([a-zA-Z0-9]+)"/.exec(m)[1]; });
}

function project(snap, id) {
  return snap.projects.find(function (p) { return p.id === id; });
}

group('The list renders');

test('Without a hole in it, and with its tags balanced', () => {
  const html = page();
  ['undefined', 'NaN', '[object Object]'].forEach(function (bad) {
    notOk(html.indexOf(bad) >= 0, 'leaks "' + bad + '"');
  });
  [['<table', '</table>'], ['<tr', '</tr>'], ['<td', '</td>'], ['<th', '</th>'],
   ['<div', '</div>'], ['<button', '</button>'], ['<form', '</form>'],
   ['<select', '</select>'], ['<option', '</option>']].forEach(function (pair) {
    const opens = (html.match(new RegExp(pair[0] + '[ >]', 'g')) || []).length;
    const closes = (html.match(new RegExp(pair[1], 'g')) || []).length;
    eq(opens, closes, pair[0] + ' vs ' + pair[1]);
  });
});

test('Every live project is there, each opening its own page', () => {
  const snap = demoBoard();
  const html = page({ snap: snap });
  const live = snap.projects.filter(function (p) {
    return ['new', 'on', 'off', 'hold'].indexOf(p.status) >= 0;
  });

  eq(orderOf(html).length, live.length);
  live.forEach(function (p) {
    ok(html.indexOf('data-id="' + p.id + '"') > 0, p.id + ' is listed');
  });
});

test('Rows lead with the full title, customer and all', () => {
  const html = page();
  ok(html.indexOf('Meridian Coatings - Coating additive trial') > 0);
});

test('The table can scroll sideways rather than widening the page', () => {
  // Forcing the page wider than the window is exactly how the timeline became
  // unusable, with the sidebar pushed off the edge and no way back to it.
  const html = page();
  ok(/<div class="tbl-scroll"><table class="t">/.test(html));
});

group('The order you would work down it');

test('The list is unsorted by default, so the work order is what shows', () => {
  // The three tests below only mean anything while this is true. If a future
  // change to defaults() picked a sort column, they would silently start
  // asserting that column's order instead.
  eq(base.projSort, null);
});

test('Off track comes first, whatever its due date', () => {
  const snap = demoBoard();
  // Give the off-track one the latest date on the board, so only status can
  // explain it being first.
  project(snap, 'pr2').status = 'off';
  project(snap, 'pr2').due = addDays(TODAY, 300);

  eq(orderOf(page({ snap: snap }))[0], 'pr2');
});

test('Then by due date, soonest first', () => {
  const snap = demoBoard();
  snap.projects.forEach(function (p) { p.status = 'on'; });
  project(snap, 'pr1').due = addDays(TODAY, 30);
  project(snap, 'pr2').due = addDays(TODAY, 10);
  project(snap, 'pr3').due = addDays(TODAY, 20);

  const order = orderOf(page({ snap: snap }));
  ok(order.indexOf('pr2') < order.indexOf('pr3'), 'pr2 before pr3');
  ok(order.indexOf('pr3') < order.indexOf('pr1'), 'pr3 before pr1');
});

test('Undated projects sort last, not first', () => {
  // '' < any date as text, so the naive comparison puts everything undated at the
  // top - which buries the work that actually has a deadline.
  const snap = demoBoard();
  snap.projects.forEach(function (p) { p.status = 'on'; });
  project(snap, 'pr1').due = '';
  project(snap, 'pr2').due = addDays(TODAY, 40);

  const order = orderOf(page({ snap: snap }));
  ok(order.indexOf('pr2') < order.indexOf('pr1'), 'the dated one comes first');
});

test('The order is stable when everything ties', () => {
  // Without a tiebreak the list reshuffles between renders, including on the
  // 60-second poll, which looks like the board losing its mind.
  const a = { id: 'b', status: 'on', due: '', name: 'Same', customer: 'X' };
  const b = { id: 'a', status: 'on', due: '', name: 'Same', customer: 'X' };
  eq([a, b].sort(byWorkOrder).map(function (p) { return p.id; }), ['a', 'b']);
  eq([b, a].sort(byWorkOrder).map(function (p) { return p.id; }), ['a', 'b']);
});

group('Filters');

test('Live means live, and excludes what is finished', () => {
  ['new', 'on', 'off', 'hold'].forEach(function (s) {
    ok(matchesStatus({ status: s }, 'live'), s + ' is live');
  });
  ['done', 'cancelled'].forEach(function (s) {
    notOk(matchesStatus({ status: s }, 'live'), s + ' is not');
  });
});

test('All really means all', () => {
  ['new', 'on', 'off', 'hold', 'done', 'cancelled'].forEach(function (s) {
    ok(matchesStatus({ status: s }, 'all'), s);
  });
});

test('A single status shows only that one', () => {
  ok(matchesStatus({ status: 'off' }, 'off'));
  notOk(matchesStatus({ status: 'on' }, 'off'));
});

test('The list defaults to live, so a cancelled project is not in the way', () => {
  const snap = demoBoard();
  project(snap, 'pr3').status = 'cancelled';
  notOk(orderOf(page({ snap: snap })).indexOf('pr3') >= 0, 'hidden by default');

  const all = page({ snap: snap, ui: { projStatus: 'all' } });
  ok(orderOf(all).indexOf('pr3') >= 0, 'and reachable');
});

test('Each chip carries how many it would show', () => {
  const snap = demoBoard();
  const html = page({ snap: snap });
  const offCount = snap.projects.filter(function (p) { return p.status === 'off'; }).length;

  const chip = /<button[^>]*data-v="off"[^>]*>Off track<span class="cnt n">(\d+)<\/span>/.exec(html);
  ok(chip, 'the off-track chip is there');
  eq(Number(chip[1]), offCount);
});

test('Chip counts follow the search, because a chip promises what it will show', () => {
  // They used to count the whole scoped set. A chip saying 23 above a three-row
  // table is a control making a promise it will not keep.
  const snap = demoBoard();
  const all = page({ snap: snap });
  const searched = page({ snap: snap, ui: { projQuery: 'meridian' } });

  const countFor = function (html) {
    const m = /data-v="all"[^>]*>All<span class="cnt n">(\d+)</.exec(html);
    ok(m, 'found the All chip');
    return Number(m[1]);
  };

  ok(countFor(all) > countFor(searched), 'the count came down with the search');
  eq(countFor(searched), 1, 'one project matches "meridian"');
});

test('Exactly one chip is pressed', () => {
  const html = page();
  eq((html.match(/data-act="projStatusFilter"[^>]*aria-pressed="true"/g) || []).length, 1);
});

test('The meeting filter narrows to one meeting', () => {
  const snap = demoBoard();
  const html = page({ snap: snap, ui: { projTab: 't2' } });

  orderOf(html).forEach(function (id) {
    eq(project(snap, id).tab, 't2', id + ' belongs to t2');
  });
});

test('The sidebar person scope narrows it too', () => {
  const snap = demoBoard();
  const html = page({ snap: snap, ui: { person: 'Alex Morgan' } });

  ok(orderOf(html).length > 0, 'Alex owns some');
  orderOf(html).forEach(function (id) {
    eq(project(snap, id).personId, 'p1', id + ' is Alex\'s');
  });
  ok(html.indexOf('Showing only projects owned by') > 0, 'and it says so');
});

group('An empty list says why');

test('A filter hiding everything says so, rather than "no projects"', () => {
  // Otherwise somebody concludes their project is gone and enters it again.
  const snap = demoBoard();
  const html = page({ snap: snap, ui: { projStatus: 'cancelled' } });
  ok(html.indexOf('No projects match this filter') > 0);
});

test('An empty meeting says it is the meeting', () => {
  const snap = demoBoard();
  snap.projects = [];
  const html = page({ snap: snap, ui: { projTab: 't2' } });
  ok(html.indexOf('No projects in this meeting') > 0);
});

test('A board with no projects at all says just that', () => {
  const snap = demoBoard();
  snap.projects = [];
  ok(page({ snap: snap }).indexOf('No projects yet') > 0);
});

group('The value column is the same permission as everywhere else');

test('It appears when the restricted collection arrived', () => {
  const html = page();
  ok(/data-act="projSort" data-v="value"/.test(html), 'the column is there');
  ok(html.indexOf('Annual value') > 0, 'and the total');
});

test('It is absent, and its figures never sent, when refused', () => {
  const snap = demoBoard();
  const value = snap.projectDetails.find(function (d) { return d.id === 'pr1'; }).estValue;
  snap.denied = ['projectDetails'];
  snap.projectDetails = [];          // as the adapter really hands it back

  const html = page({ snap: snap });
  // Asserted against the sort control, not the literal '<th>Value</th>'. That
  // string stopped appearing the moment the header became a button, and this
  // assertion would then have passed whether or not the column leaked - a
  // permission test going quietly hollow is worse than no test.
  notOk(/data-v="value"/.test(html), 'no column');
  notOk(html.indexOf(String(value)) > 0, 'and the number is not in the markup');
  ok(html.indexOf('Judged') > 0, 'the stat falls back to something visible');
});

test('Win confidence is shown to everyone, because it is not restricted', () => {
  const snap = demoBoard();
  snap.denied = ['projectDetails'];
  snap.projectDetails = [];
  const html = page({ snap: snap });

  ok(/data-act="projSort" data-v="win"/.test(html), 'the column survives');
  ok(/<td class="c">65%<\/td>/.test(html), 'with its number');
});

group('Getting to it');

test('The sidebar offers Projects, with a count of the live ones', () => {
  const snap = demoBoard();
  const html = page({ snap: snap });
  const live = snap.projects.filter(function (p) {
    return ['new', 'on', 'off', 'hold'].indexOf(p.status) >= 0;
  }).length;

  const item = /<button[^>]*data-v="projects"[^>]*>[\s\S]*?<\/button>/.exec(html);
  ok(item, 'the nav item is there');
  ok(item[0].indexOf('>' + live + '<') > 0, 'showing ' + live);
});

test('It is marked as the current page when it is', () => {
  const html = page();
  ok(/<button[^>]*data-v="projects"[^>]*aria-current="page"/.test(html));
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
