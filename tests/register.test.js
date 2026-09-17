// @ts-check
/**
 * The Action items table.
 *
 * Written with the change set that turned the register from a list of seven-child
 * grid rows into a table. Before that it was the least-pinned view in the app:
 * nothing anywhere asserted its markup, its columns or its ordering, which is why
 * an invalid comparator sat in it unnoticed (see `byActionWorkOrder`).
 *
 * The bar here is the one `tests/projectsList.test.js` and `tests/sorting.test.js`
 * set for the Projects table, because the two screens should behave identically.
 */

import { group, test, ok, notOk, eq } from './harness.js';
import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { today } from '../src/lib/dates.js';
import { loadUi } from '../src/ui.js';
import {
  ACTION_SORT_COLUMNS, actionSorter, actionSortKey, byActionWorkOrder, firstActionDirFor
} from '../src/domain/actions.js';
import { parentRef, matchesActionQuery } from '../src/domain/queries.js';

const MODES = { content: 'live', settings: 'live' };
const snap = demoBoard();
const base = loadUi();

function page(over, modes) {
  return renderApp(snap, Object.assign({}, base, { view: 'actions', filter: 'all' }, over),
    { today: today(), modes: modes || MODES, identity: { personId: 'p1' } });
}

/* ---------------------------------------------------------------- the table */

group('The Action items table');

test('It is a table that can scroll sideways rather than widening the page', () => {
  // Same strategy as the Projects list: there is no media query for `table.t` at
  // all, so a narrow window scrolls the table, not the whole board. A page wider
  // than the window puts the sidebar off the edge with no way back to it.
  const html = page();
  ok(html.indexOf('<div class="tbl-scroll"><table class="t">') >= 0);
});

test('Every column the list used to show is still there, plus Origin', () => {
  const head = /<thead>[\s\S]*?<\/thead>/.exec(page());
  ok(head, 'a header row rendered');
  if (!head) return;
  ['Action', 'Origin', 'Meeting'].forEach(function (h) {
    ok(head[0].indexOf('>' + h + '<') >= 0, h + ' has a column');
  });
  ['num', 'owner', 'due'].forEach(function (c) {
    ok(head[0].indexOf('data-v="' + c + '"') >= 0, c + ' is sortable');
  });
});

test('Each row keeps its row- id, which is what focusAction flashes', () => {
  // Arriving from the Overview or the Timeline scrolls to the action and flashes
  // it. Rename the id and that lands on the register with nothing highlighted.
  const rows = page().match(/<tr id="row-[^"]+"/g) || [];
  ok(rows.length > 0, 'rows carry an id');
});

test('A done row is marked, so it does not read as still outstanding', () => {
  const html = page();
  ok(/<tr id="row-[^"]*" class="done">/.test(html), 'done rows carry the class');
  ok(/<tr id="row-[^"]*">/.test(html), 'and open rows do not');
});

/* --------------------------------------------------------------- the origin */

group('Where an action came from');

test('An issue origin links back to the issue it came from', () => {
  const html = page();
  const cell = (html.match(/<td class="orig">[\s\S]*?<\/td>/g) || [])
    .filter(function (c) { return c.indexOf('openIssue') >= 0; })[0];
  ok(cell, 'at least one action came from an issue');
  if (!cell) return;
  ok(/data-id="[^"]+"/.test(cell), 'it carries the meeting to open');
  ok(/data-v="iss-[^"]+"/.test(cell), 'and the issue to scroll to');
});

test('A project origin uses the same name the Projects table uses', () => {
  // parentText says `name + " (project)"`; the Projects table says customer AND
  // name. Two screens disagreeing about a project's name is how people conclude
  // they are looking at two different projects.
  const html = page();
  const cell = (html.match(/<td class="orig">[\s\S]*?<\/td>/g) || [])
    .filter(function (c) { return c.indexOf('openProject') >= 0; })[0];
  ok(cell, 'at least one action came from a project');
  if (!cell) return;
  const pj = snap.projects.filter(function (p) { return cell.indexOf('data-id="' + p.id + '"') >= 0; })[0];
  ok(pj, 'the link names a real project');
  if (pj && pj.customer) ok(cell.indexOf(pj.customer) >= 0, 'the customer is in the label');
});

test('An action raised on its own says so quietly', () => {
  const html = page();
  ok(/<td class="orig"><span class="k">/.test(html), 'a dash, not an empty cell');
});

test('parentRef returns nothing for a parent that has been deleted', () => {
  // Actions outlive the thing that spawned it - delProject sets parent to null and
  // says so. A dangling id must not render as a link to nowhere.
  eq(parentRef(snap, { parent: { type: 'project', id: 'gone' } }), null, 'dangling');
  eq(parentRef(snap, { parent: null }), null, 'no parent');
  eq(parentRef(snap, {}), null, 'no parent field at all');
});

/* -------------------------------------------------------------- the sorting */

group('Sorting the Action items table');

test('aria-sort marks only the sorted column', () => {
  const html = page({ actSort: 'due', actSortDir: 'asc' });
  const heads = html.match(/<th[^>]*>/g) || [];
  const sorted = heads.filter(function (h) { return h.indexOf('aria-sort') >= 0; });
  eq(sorted.length, 1, 'exactly one column claims to be sorted');
  ok(sorted[0].indexOf('ascending') >= 0, 'and in the right direction');
});

test('Unsorted columns do not advertise sortability they do not have', () => {
  // aria-sort="none" on the plain columns would say they can be sorted.
  const html = page();
  notOk(html.indexOf('aria-sort="none"') >= 0);
});

test('The control is a real button, because a th is not focusable', () => {
  const html = page();
  ok(/<th class="sortable"><button type="button" class="th-sort"/.test(html));
});

test('Absent values sort last in BOTH directions', () => {
  // No owner means nobody has been asked and no date means nobody has committed.
  // Sorting those first asserts they are the smallest, which is the opposite of
  // what they mean.
  const rows = [
    { id: 'a', num: 1, due: '2026-10-01' },
    { id: 'b', num: 2, due: '' },
    { id: 'c', num: 3, due: '2026-09-01' }
  ];
  eq(rows.slice().sort(actionSorter('due', 'asc')).map(function (r) { return r.id; }),
    ['c', 'a', 'b'], 'soonest first, undated last');
  eq(rows.slice().sort(actionSorter('due', 'desc')).map(function (r) { return r.id; }),
    ['a', 'c', 'b'], 'latest first, undated STILL last');
});

test('The comparator is total, so a re-fetched array cannot reshuffle it', () => {
  // Array.sort being stable only preserves the INPUT order, and the adapter rebuilds
  // the input on every 60-second poll. The old register comparator returned 1 for
  // ties, which is not even transitive.
  const tied = [
    { id: 'z', num: 9, due: '2026-10-01' },
    { id: 'a', num: 2, due: '2026-10-01' },
    { id: 'm', num: 5, due: '2026-10-01' }
  ];
  const once = tied.slice().sort(actionSorter('due', 'asc')).map(function (r) { return r.id; });
  const twice = tied.slice().reverse().sort(actionSorter('due', 'asc')).map(function (r) { return r.id; });
  eq(once, twice, 'the same order whatever order it arrived in');
  eq(once, ['a', 'm', 'z'], 'tiebroken by action number');
});

test('The tiebreak is never flipped by the direction', () => {
  // Reversing it would shuffle a block of same-dated actions between one direction
  // and the other for no reason the reader can see.
  const tied = [
    { id: 'z', num: 9, due: '2026-10-01' },
    { id: 'a', num: 2, due: '2026-10-01' },
    { id: 'm', num: 5, due: '2026-10-01' }
  ];
  const asc = tied.slice().sort(actionSorter('due', 'asc')).map(function (r) { return r.id; });
  const desc = tied.slice().sort(actionSorter('due', 'desc')).map(function (r) { return r.id; });
  eq(asc, desc, 'equal dates keep the same order in both directions');
});

test('The default order puts open work first, then by date, then by number', () => {
  const rows = [
    { id: 'done', num: 1, due: '2026-08-01', status: 'done' },
    { id: 'late', num: 2, due: '2026-09-01' },
    { id: 'undated', num: 3, due: '' },
    { id: 'soon', num: 4, due: '2026-09-20' }
  ];
  eq(rows.slice().sort(byActionWorkOrder).map(function (r) { return r.id; }),
    ['late', 'soon', 'undated', 'done']);
});

test('Numbers and owners key on what they mean, not on their text', () => {
  eq(actionSortKey({ num: 7 }, 'num'), 7, 'a number, so 10 beats 9');
  eq(actionSortKey({ num: NaN }, 'num'), null, 'a hand-edited number is absent, not 0');
  eq(actionSortKey({ owner: '  Alex Morgan ' }, 'owner'), 'alex morgan', 'trimmed and folded');
  eq(actionSortKey({ owner: '' }, 'owner'), null, 'unowned is absent');
  eq(actionSortKey({ due: '' }, 'due'), null, 'undated is absent');
});

test('Each column starts in the direction that is useful first', () => {
  eq(firstActionDirFor('num'), 'asc', 'oldest action first');
  eq(firstActionDirFor('due'), 'asc', 'soonest deadline first');
  eq(firstActionDirFor('nonsense'), 'asc', 'an unknown column does not throw');
  ok(Object.keys(ACTION_SORT_COLUMNS).length >= 3);
});

/* ------------------------------------------------------------- the filtering */

group('Searching and filtering the register');

test('The search reads the origin, not just the action text', () => {
  // The action's own fields are deliberately nonsense that shares nothing with the
  // issue, so a match can ONLY have come from the origin. Picking a real action and
  // a word out of its issue proves less than it looks: the word is usually in the
  // action text too, and the assertion passes with the origin never consulted.
  const issue = snap.issues[0];
  ok(issue, 'the demo board has an issue');
  if (!issue) return;

  const word = issue.text.split(/\s+/).filter(function (w) { return w.length > 4; })[0];
  ok(word, 'with a word long enough to search for');

  const a = { text: 'qqqq', owner: 'wwww', support: '', parent: { type: 'issue', id: issue.id } };
  ok(matchesActionQuery(snap, a, word), 'found by a word only its issue contains');
  notOk(matchesActionQuery(snap, a, 'zzzznothing'), 'and not by one nothing contains');
});

test('Multi-term search is an AND across every field', () => {
  const a = { text: 'Book the rig', owner: 'Alex Morgan', parent: null };
  ok(matchesActionQuery(snap, a, 'rig alex'), 'one term from each field');
  notOk(matchesActionQuery(snap, a, 'rig nobody'), 'a term nothing matches fails it');
  ok(matchesActionQuery(snap, a, '   '), 'a blank search matches everything');
});

test('The chip counts move with the search', () => {
  // A chip promises "clicking me shows N". Counting before the search would make it
  // say 23 above a three-row table.
  function allCount(html) {
    const m = /data-act="filter" data-v="all"[^>]*>All<span class="cnt n">(\d+)</.exec(html);
    return m ? Number(m[1]) : null;
  }
  const before = allCount(page());
  const after = allCount(page({ actQuery: 'zzzznothingmatchesthis' }));
  ok(before !== null && after !== null, 'the All chip carries a count');
  ok(before > 0, 'there are actions to start with');
  eq(after, 0, 'and the count follows the search rather than ignoring it');
});

test('Reset appears only when something is actually on', () => {
  notOk(page().indexOf('data-act="actReset"') >= 0, 'nothing to reset yet');
  ok(page({ actQuery: 'rig' }).indexOf('data-act="actReset"') >= 0, 'a search offers it');
  ok(page({ actSort: 'due' }).indexOf('data-act="actReset"') >= 0, 'so does a sort');
});

test('A project filter arriving from a project page is visible and clearable', () => {
  // ui.projFilter is set by showProjActions and has had NO control since the port,
  // so the register silently showed one project's actions with nothing saying why.
  const pj = snap.projects[0];
  const html = page({ projFilter: pj.id });
  ok(html.indexOf('data-act="clearProjFilter"') >= 0, 'it can be cleared');
  ok(html.indexOf(pj.name) >= 0, 'and it names the project it is scoped to');
});

test('The empty message names the control responsible', () => {
  const html = page({ actQuery: 'zzzznothingmatchesthis' });
  ok(html.indexOf('No actions match that search.') >= 0,
    'not the old catch-all "Nothing here."');
});

test('The search box is one field, so restoreForms keeps the caret', () => {
  // restoreForms abandons a form whose field count changed, and the meeting select
  // beside it is built from data that does change.
  const form = /<form class="psearch" data-form="actSearch"[\s\S]*?<\/form>/.exec(page());
  ok(form, 'the search box is wrapped in a form');
  if (!form) return;
  eq((form[0].match(/<input|<select|<textarea/g) || []).length, 1, 'exactly one field');
});

/* ------------------------------------------------------------- permissions */

group('The register when you cannot write');

test('A read-only reader sees the table but no controls', () => {
  const html = page({}, { content: 'readonly', settings: 'live' });
  ok(html.indexOf('<table class="t">') >= 0, 'the actions are still readable');
  const boxes = html.match(/<input[^>]*data-edit="action(Done|Due)"[^>]*>/g) || [];
  ok(boxes.length > 0, 'the controls are rendered');
  boxes.forEach(function (b) {
    ok(b.indexOf('disabled') >= 0, 'but disabled: ' + b.slice(0, 60));
  });
});
