// @ts-check
/**
 * Sorting and filtering the Projects table.
 *
 * This is the first sortable table in the app — there was no `aria-sort`, no
 * clickable header and no sort CSS anywhere before it — so the rules it sets are the
 * ones every later table will copy. Three of them are worth defending here.
 *
 * **A project with no value sorts last, in BOTH directions.** No `estValue` means
 * nobody priced it; no `winPct` means nobody judged it. Sorting those as zero
 * asserts the project is worth nothing and certain to be lost. It is also the
 * existing "undated sorts last" rule generalised, and that rule exists because an
 * empty string compares below every real date as text.
 *
 * **The tiebreak is never reversed.** If it were, a descending sort over ten
 * unpriced projects would list them backwards from the ascending one, which is churn
 * with no meaning.
 *
 * **A remembered sort on a column you cannot see is ignored.** Otherwise the list is
 * ordered by something invisible.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import {
  SORT_COLUMNS, firstDirFor, byTitleThenId, sortKey, projectSorter,
  matchesQuery, matchesValue, distinctValues
} from '../src/domain/projects.js';
import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { loadUi } from '../src/ui.js';
import { today } from '../src/lib/dates.js';

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

function orderOf(html) {
  return (html.match(/data-act="openProject" data-id="([a-zA-Z0-9]+)"/g) || [])
    .map(function (m) { return /data-id="([a-zA-Z0-9]+)"/.exec(m)[1]; });
}

/** A board where only value and win% differ, so a sort has one explanation. */
function board() {
  return {
    people: [{ id: 'p1', name: 'Alex Morgan' }],
    tabs: [{ id: 't1', name: 'North', kind: 'area', members: ['p1'] }],
    entries: [], issues: [], actions: [], projectNotes: [], meetings: {}, settings: {},
    projects: [
      { id: 'a', tab: 't1', personId: 'p1', name: 'Alpha', status: 'on',
        winPct: 20, due: '2026-10-01' },
      { id: 'b', tab: 't1', personId: 'p1', name: 'Bravo', status: 'on',
        winPct: 80, due: '2026-09-01' },
      { id: 'c', tab: 't1', personId: 'p1', name: 'Charlie', status: 'on',
        due: '2026-11-01' }              // no winPct, no value
    ],
    projectDetails: [
      { id: 'a', estValue: 50000 },
      { id: 'b', estValue: 10000 }
      // 'c' has none
    ]
  };
}

function sorted(col, dir) {
  const snap = board();
  return snap.projects.slice().sort(projectSorter(snap, col, dir))
    .map(function (p) { return p.id; });
}

group('The sort keys');

test('Value comes from the separate restricted collection', () => {
  const snap = board();
  eq(sortKey(snap, 'value', snap.projects[0]), 50000);
});

test('Absent reads as null, not as zero', () => {
  const snap = board();
  const c = snap.projects[2];
  eq(sortKey(snap, 'value', c), null, 'no details record');
  eq(sortKey(snap, 'win', c), null, 'no winPct');
});

test('Zero is a real value and not absence', () => {
  const snap = board();
  snap.projects[0].winPct = 0;
  snap.projectDetails[0].estValue = 0;
  eq(sortKey(snap, 'win', snap.projects[0]), 0);
  eq(sortKey(snap, 'value', snap.projects[0]), 0);
});

test('A non-numeric value reads as absent rather than NaN', () => {
  // A hand-edited SharePoint cell reading "TBC" would otherwise make every
  // comparison false, which makes the comparator non-transitive and the order
  // genuinely arbitrary rather than just odd.
  //
  // Asserted with === rather than eq(), because eq() compares by JSON and
  // JSON.stringify(NaN) is the string "null" - so eq(NaN, null) passes and the
  // test would not notice the bug it exists for.
  const snap = board();
  snap.projects[0].winPct = 'TBC';
  snap.projectDetails[0].estValue = 'about 50k';

  ok(sortKey(snap, 'win', snap.projects[0]) === null, 'win is exactly null');
  ok(sortKey(snap, 'value', snap.projects[0]) === null, 'value is exactly null');
});

test('And such a project still sorts last rather than anywhere', () => {
  const snap = board();
  snap.projects[1].winPct = 'TBC';          // 'b' had 80
  const order = snap.projects.slice().sort(projectSorter(snap, 'win', 'desc'))
    .map(function (x) { return x.id; });
  eq(order, ['a', 'b', 'c'], 'a keeps its 20; b and c are both unjudged');
});

group('Sorting');

test('Value sorts highest first, then lowest', () => {
  eq(sorted('value', 'desc'), ['a', 'b', 'c']);
  eq(sorted('value', 'asc'), ['b', 'a', 'c']);
});

test('Win sorts highest first, then lowest', () => {
  eq(sorted('win', 'desc'), ['b', 'a', 'c']);
  eq(sorted('win', 'asc'), ['a', 'b', 'c']);
});

test('Due sorts soonest first, then latest', () => {
  eq(sorted('due', 'asc'), ['b', 'a', 'c']);
  eq(sorted('due', 'desc'), ['c', 'a', 'b']);
});

test('A project with no value sorts last BOTH ways round', () => {
  // The rule that matters most. Ascending with unknowns first would put every
  // unjudged project on top of the handful genuinely at risk.
  eq(sorted('value', 'desc')[2], 'c', 'descending');
  eq(sorted('value', 'asc')[2], 'c', 'ascending');
  eq(sorted('win', 'desc')[2], 'c', 'descending');
  eq(sorted('win', 'asc')[2], 'c', 'ascending');
});

test('The tiebreak is never reversed', () => {
  // Two projects with nothing to tell them apart must come out in the same order
  // whichever way the column points, or a block of unpriced work shuffles between
  // one click and the next for no reason.
  const snap = board();
  snap.projects.forEach(function (p) { delete p.winPct; });

  const desc = snap.projects.slice().sort(projectSorter(snap, 'win', 'desc'))
    .map(function (p) { return p.id; });
  const asc = snap.projects.slice().sort(projectSorter(snap, 'win', 'asc'))
    .map(function (p) { return p.id; });

  eq(desc, asc, 'same order both ways');
  eq(desc, ['a', 'b', 'c'], 'and it is the title order');
});

test('The comparator is total, so the order survives a reshuffled snapshot', () => {
  // Array.sort being stable only preserves the INPUT order, and the input is
  // rebuilt by the adapter on every 60-second poll.
  const snap = board();
  const forward = snap.projects.slice().sort(projectSorter(snap, 'win', 'desc'))
    .map(function (p) { return p.id; });
  const backward = snap.projects.slice().reverse()
    .sort(projectSorter(snap, 'win', 'desc')).map(function (p) { return p.id; });
  eq(forward, backward);
});

test('Numbers go descending first, dates ascending', () => {
  eq(firstDirFor('value'), 'desc');
  eq(firstDirFor('win'), 'desc');
  eq(firstDirFor('due'), 'asc');
});

test('byTitleThenId orders by the full title, then the id', () => {
  ok(byTitleThenId({ id: 'x', name: 'Alpha' }, { id: 'a', name: 'Bravo' }) < 0);
  ok(byTitleThenId({ id: 'a', name: 'Same' }, { id: 'b', name: 'Same' }) < 0);
});

group('The sortable headers');

test('Only the sorted column carries aria-sort', () => {
  // aria-sort="none" on the others would advertise sortability that Project,
  // Meeting, Owner, Status and Open do not have.
  const html = page({ ui: { projSort: 'value', projSortDir: 'desc' } });
  eq((html.match(/aria-sort=/g) || []).length, 1);
  ok(/<th class="sortable" aria-sort="descending">/.test(html));
});

test('Ascending says ascending', () => {
  const html = page({ ui: { projSort: 'win', projSortDir: 'asc' } });
  ok(/aria-sort="ascending"/.test(html));
});

test('Nothing carries aria-sort in the default order', () => {
  notOk(/aria-sort=/.test(page()));
});

test('Every sortable header is a real button, not a clickable th', () => {
  // A th is not focusable and has no Enter or Space behaviour.
  const html = page();
  const heads = html.match(/<th[^>]*class="[^"]*sortable[^"]*"[^>]*>[\s\S]*?<\/th>/g) || [];
  eq(heads.length, 3, 'due, win and value');
  heads.forEach(function (h) {
    ok(h.indexOf('<button type="button"') > 0, 'a real button: ' + h.slice(0, 50));
    ok(/data-act="projSort" data-v="(due|win|value)"/.test(h), 'and names its column');
  });
});

test('The label says what the next click will do', () => {
  // The only place the third-click-resets rule is discoverable.
  const first = page({ ui: { projSort: 'value', projSortDir: 'desc' } });
  ok(first.indexOf('Sort lowest first.') > 0, 'second click reverses');

  const second = page({ ui: { projSort: 'value', projSortDir: 'asc' } });
  ok(second.indexOf('Return to the default order.') > 0, 'third click resets');
});

test('A remembered sort on a column this reader cannot see is ignored', () => {
  // The header going missing is not the point - it would be absent anyway. The
  // point is that the ROWS must fall back to the work order rather than being
  // ordered by a column nobody can see.
  const snap = demoBoard();
  snap.denied = ['projectDetails'];
  snap.projectDetails = [];

  const sorted = page({ snap: snap, ui: { projSort: 'value', projSortDir: 'desc' } });
  const plain = page({ snap: snap });

  notOk(/data-v="value"/.test(sorted), 'the column is not there');
  notOk(/aria-sort=/.test(sorted), 'and nothing claims to be sorted by it');
  eq(orderOf(sorted), orderOf(plain), 'and the rows are in the default order');
});

test('A sort on a column that IS visible still applies', () => {
  // The guard must be about the value column specifically, not about sorting.
  const snap = demoBoard();
  snap.denied = ['projectDetails'];
  snap.projectDetails = [];

  const byWin = page({ snap: snap, ui: { projSort: 'win', projSortDir: 'desc' } });
  ok(/aria-sort="descending"/.test(byWin), 'win is still sortable');
  notOk(eqArrays(orderOf(byWin), orderOf(page({ snap: snap }))),
    'and it really reorders');
});

/** Shallow array comparison, for asserting two orders DIFFER. */
function eqArrays(a, b) {
  return a.length === b.length && a.every(function (x, i) { return x === b[i]; });
}

group('Searching');

test('It matches customer, name and owner', () => {
  const snap = demoBoard();
  const p = snap.projects.find(function (x) { return x.id === 'pr1'; });

  ok(matchesQuery(snap, p, 'meridian'), 'customer');
  ok(matchesQuery(snap, p, 'additive'), 'name');
  ok(matchesQuery(snap, p, 'morgan'), 'owner');
  notOk(matchesQuery(snap, p, 'nonesuch'));
});

test('It matches Field and Project Type, and not only through the other fields', () => {
  /*
   * This needs terms that appear NOWHERE else on the project, which pr1 cannot
   * provide: its customer is "Meridian Coatings" so 'coatings' matches the customer,
   * and its name is "Coating additive trial" so 'trial' matches the name. Searching
   * those proved nothing - dropping field and projectType from the haystack left the
   * test passing.
   *
   * pr5 is clean: customer "Internal", name "Line 3 throughput uplift", field
   * "Process", type "Trial". Neither term can match any other way.
   */
  const snap = demoBoard();
  const p = snap.projects.find(function (x) { return x.id === 'pr5'; });

  eq(p.field, 'Process');
  eq(p.projectType, 'Trial');
  notOk((p.customer + ' ' + p.name).toLowerCase().indexOf('process') >= 0,
    'the term is not hiding in the customer or name');
  notOk((p.customer + ' ' + p.name).toLowerCase().indexOf('trial') >= 0);

  ok(matchesQuery(snap, p, 'process'), 'field is searched');
  ok(matchesQuery(snap, p, 'trial'), 'project type is searched');
});

test('It is case-insensitive and ignores surrounding space', () => {
  const snap = demoBoard();
  const p = snap.projects.find(function (x) { return x.id === 'pr1'; });
  ok(matchesQuery(snap, p, '  MERIDIAN  '));
});

test('Several terms are ANDed across fields, not within one', () => {
  // "meridian coating" must find the project whose CUSTOMER is Meridian Coatings
  // and whose NAME is Coating additive trial, though neither holds both words.
  const snap = demoBoard();
  const p = snap.projects.find(function (x) { return x.id === 'pr1'; });

  ok(matchesQuery(snap, p, 'meridian additive'), 'customer word + name word');
  notOk(matchesQuery(snap, p, 'meridian nonesuch'), 'every term must match');
});

test('An empty query matches everything', () => {
  const snap = demoBoard();
  snap.projects.forEach(function (p) {
    ok(matchesQuery(snap, p, ''), p.id);
    ok(matchesQuery(snap, p, '   '), p.id + ' whitespace');
    ok(matchesQuery(snap, p, null), p.id + ' null');
  });
});

test('Mission is deliberately not searched', () => {
  // Widening this later is easy; narrowing it once people rely on it is not.
  const snap = demoBoard();
  const p = snap.projects.find(function (x) { return x.id === 'pr1'; });
  ok(p.mission.indexOf('adhesion') > 0, 'the word is in the mission');
  notOk(matchesQuery(snap, p, 'adhesion'), 'and not searched');
});

test('The search narrows the table and says so', () => {
  const snap = demoBoard();
  const html = page({ snap: snap, ui: { projQuery: 'meridian' } });

  eq(orderOf(html), ['pr1']);
  ok(html.indexOf('Showing 1 of') > 0, 'and reports what it did');
});

test('The box renders what state says, so it survives leaving and coming back', () => {
  const html = page({ ui: { projQuery: 'meridian' } });
  ok(/data-input="projQuery" value="meridian"/.test(html));
});

test('The box is inside a form, which is what saves the caret', () => {
  // captureForms/restoreForms only walk form[data-form]. Without the wrapper the
  // caret is lost on the first keystroke, because every keystroke redraws.
  const html = page();
  ok(/<form class="psearch" data-form="projSearch"/.test(html));
});

group('The Field and Project Type filters');

test('Options are the values actually in use, counted', () => {
  const snap = demoBoard();
  const html = page({ snap: snap });

  ok(/<option value="coatings"[^>]*>Coatings \(2\)<\/option>/.test(html),
    'two projects share Coatings');
  ok(html.indexOf('>All fields</option>') > 0);
  ok(html.indexOf('>All types</option>') > 0);
});

test('Differently-cased spellings become one option, not three', () => {
  // The single failure mode of a free-text field feeding a filter.
  const values = distinctValues([
    { f: 'Coatings' }, { f: 'coatings' }, { f: ' COATINGS ' }, { f: 'Sealants' }
  ], 'f');

  eq(values.length, 2);
  eq(values[0].value, 'coatings');
  eq(values[0].n, 3, 'all three counted together');
  eq(values[0].label, 'Coatings', 'labelled with the first spelling seen');
});

test('Blank values are not offered as something to filter by', () => {
  eq(distinctValues([{ f: '' }, { f: '  ' }, { f: null }, {}], 'f'), []);
});

test('Matching ignores case and surrounding space', () => {
  ok(matchesValue({ field: ' Coatings ' }, 'field', 'coatings'));
  ok(matchesValue({ field: 'COATINGS' }, 'field', 'coatings'));
  notOk(matchesValue({ field: 'Sealants' }, 'field', 'coatings'));
  ok(matchesValue({ field: 'anything' }, 'field', 'all'), 'all matches everything');
  ok(matchesValue({}, 'field', 'all'), 'even with no value');
});

test('Choosing a field narrows the table', () => {
  const snap = demoBoard();
  const html = page({ snap: snap, ui: { projField: 'coatings' } });

  ok(orderOf(html).length > 0, 'some match');
  orderOf(html).forEach(function (id) {
    const p = snap.projects.find(function (x) { return x.id === id; });
    eq(String(p.field).toLowerCase(), 'coatings', id);
  });
});

test('The menus do not narrow each other', () => {
  // Two filters narrowing each other's options means you cannot change Field
  // without first resetting Type, because the option you want is gone.
  const snap = demoBoard();
  const html = page({ snap: snap, ui: { projField: 'sealants' } });

  ok(html.indexOf('>Trial (2)</option>') > 0,
    'Trial is still offered though no sealants project is one');
});

test('A selection no longer in the data still shows, rather than vanishing', () => {
  // Otherwise the select shows nothing selected while the filter still applies:
  // invisible, and the table looks empty for no reason.
  const html = page({ ui: { projField: 'gone' } });
  ok(html.indexOf('<option value="gone" selected>gone (0)</option>') > 0);
});

group('Reset');

test('It appears only when something is narrowing or reordering', () => {
  notOk(/data-act="projReset"/.test(page()), 'nothing to reset');
  ok(/data-act="projReset"/.test(page({ ui: { projQuery: 'x' } })), 'a search');
  ok(/data-act="projReset"/.test(page({ ui: { projField: 'coatings' } })), 'a filter');
  ok(/data-act="projReset"/.test(page({ ui: { projSort: 'win' } })), 'a sort');
});

test('It is not a filter chip, so it cannot look pressed', () => {
  const html = page({ ui: { projQuery: 'x' } });
  const chip = /<button[^>]*data-act="projReset"[^>]*>/.exec(html);
  ok(chip, 'found it');
  notOk(chip[0].indexOf('aria-pressed') > 0);
});

group('An empty list names the control responsible');

test('A search that matches nothing says so', () => {
  // "No projects" when a search emptied the list sends people looking for the
  // wrong problem.
  const html = page({ ui: { projQuery: 'nonesuch' } });
  ok(html.indexOf('No projects match that search') > 0);
});

test('A field or type with no members says which', () => {
  ok(page({ ui: { projField: 'nonesuch' } }).indexOf('No projects in that field') > 0);
  ok(page({ ui: { projType: 'nonesuch' } }).indexOf('No projects of that type') > 0);
});

group('Field and Project Type as project fields');

test('They are editable on the project page, in the sheet order', () => {
  const html = renderApp(demoBoard(),
    Object.assign({}, base, { view: 'project', project: 'pr1' }),
    { today: TODAY, modes: MODES, identity: { personId: 'p1' } });

  ok(/data-edit="projField"/.test(html));
  ok(/data-edit="projType"/.test(html));
  ok(html.indexOf('data-edit="projField"') < html.indexOf('data-edit="projType"'));
});

test('Each offers a datalist of what colleagues already typed', () => {
  // The one thing that stops Coatings, coatings and Coating becoming three filter
  // options that each hide most of the rows.
  const html = renderApp(demoBoard(),
    Object.assign({}, base, { view: 'project', project: 'pr1' }),
    { today: TODAY, modes: MODES, identity: { personId: 'p1' } });

  ok(/<datalist id="dl-field">/.test(html));
  ok(/<datalist id="dl-ptype">/.test(html));
  ok(/list="dl-field"/.test(html), 'and the input points at it');
  ok(/list="dl-ptype"/.test(html));
});

test('The panel no longer explains what the title is made of', () => {
  const html = renderApp(demoBoard(),
    Object.assign({}, base, { view: 'project', project: 'pr1' }),
    { today: TODAY, modes: MODES, identity: { personId: 'p1' } });
  notOk(html.indexOf('which together make the title') > 0);
});

test('They appear as columns in the table', () => {
  const html = page();
  ok(html.indexOf('<th>Field</th>') > 0);
  ok(html.indexOf('<th>Type</th>') > 0);
  ok(html.indexOf('<td class="k">Coatings</td>') > 0, 'and a value in a row');
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
