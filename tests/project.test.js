// @ts-check
/**
 * The project page.
 *
 * The board was built around a meeting; this page is the same data looked at the
 * other way round, one project at a time. Three things here are worth defending with
 * tests rather than by eye.
 *
 * **The grid shapes.** `.rp` is a two-column grid and `.arow` a four-column one.
 * Emitting the wrong number of children does not error and does not look broken in
 * the HTML - it silently wraps, which is how the "Moved" section came out vertical
 * and the timeline came out sideways. Both counts are pinned below.
 *
 * **The commercial gate.** It must key off `snap.denied`, not off whether the
 * `projectDetails` array exists, because a refused reader gets an empty array and
 * that test always passes. That was a real defect in the meeting view.
 *
 * **Who may change a note.** Offered to its author only, and to nobody once the
 * project is finished.
 */

import { group, test, ok, notOk, eq } from './harness.js';
import { renderApp } from '../src/views/render.js';
import { moneyShort } from '../src/views/project.js';
import { projectSummary } from '../src/domain/projects.js';
import { demoBoard } from '../src/demo-data.js';
import { loadUi } from '../src/ui.js';
import { today, addDays } from '../src/lib/dates.js';

const MODES = { content: 'live', settings: 'live' };
const TODAY = today();
const base = loadUi();

/** The page for one project, as the whole app frame would render it. */
function page(projectId, opts) {
  const o = opts || {};
  const snap = o.snap || demoBoard();
  const ui = Object.assign({}, base, { view: 'project', project: projectId }, o.ui || {});
  return renderApp(snap, ui, {
    today: TODAY,
    modes: o.modes || MODES,
    identity: o.identity === undefined ? { personId: 'p1', displayName: 'Alex Morgan' } : o.identity
  });
}

function project(snap, id) {
  return snap.projects.find(function (p) { return p.id === id; });
}

group('The project page renders');

test('Every project in the demo board renders without a hole in it', () => {
  const snap = demoBoard();
  snap.projects.forEach(function (p) {
    const html = page(p.id, { snap: snap });
    ['undefined', 'NaN', '[object Object]'].forEach(function (bad) {
      notOk(html.indexOf(bad) >= 0, p.id + ' leaks "' + bad + '"');
    });
  });
});

test('Tags balance on every project page', () => {
  const snap = demoBoard();
  snap.projects.forEach(function (p) {
    const html = page(p.id, { snap: snap });
    [['<div', '</div>'], ['<section', '</section>'], ['<ul', '</ul>'],
     ['<button', '</button>'], ['<form', '</form>'], ['<textarea', '</textarea>']]
      .forEach(function (pair) {
        const opens = (html.match(new RegExp(pair[0] + '[ >]', 'g')) || []).length;
        const closes = (html.match(new RegExp(pair[1], 'g')) || []).length;
        eq(opens, closes, p.id + ': ' + pair[0] + ' vs ' + pair[1]);
      });
  });
});

test('A project that no longer exists falls back to the overview', () => {
  // A remembered id outlives the project it points at. An empty page with no way
  // out would be worse than landing somewhere useful.
  const html = page('no-such-project');
  ok(html.indexOf('<h1>') > 0, 'something rendered');
  notOk(/data-act="copyProject"/.test(html), 'but not a project page');
});

test('The page carries the project name, its customer and its owner', () => {
  const html = page('pr1');
  ok(html.indexOf('Meridian Coatings') > 0, 'the customer, per the agreed change');
  ok(html.indexOf('Alex Morgan') > 0, 'the owner');
});

group('The shapes the stylesheet dictates');

test('Every .rp row has exactly two children', () => {
  // `.rp` is `grid-template-columns:170px minmax(0,1fr)`. A third child wraps under
  // the label instead of beside it, and the whole page looks ragged.
  const html = page('pr1');
  const rows = html.match(/<div class="rp">[^]*?(?=<div class="rp">|<\/section>)/g) || [];
  ok(rows.length >= 3, 'found rows to check, got ' + rows.length);
  rows.forEach(function (r) {
    const heads = (r.match(/<div class="rp-h">/g) || []).length;
    const bodies = (r.match(/<div class="rp-b">/g) || []).length;
    eq(heads, 1, 'one .rp-h per row');
    eq(bodies, 1, 'one .rp-b per row');
  });
});

test('Every action row has exactly four children', () => {
  // `.arow` is a four-column grid. Five children start a second row mid-list.
  const html = page('pr2');   // pr2 is a project that actually has an action
  const rows = html.match(/<li class="arow [^]*?<\/li>/g) || [];
  ok(rows.length > 0, 'pr2 has actions to show');
  rows.forEach(function (r) {
    const kids = (r.match(/<(?:label|span)[ >]/g) || []).length -
      (r.match(/<span class="aid">/g) || []).length;  // .aid sits inside the label
    eq(kids, 4, 'four grid children in ' + r.slice(0, 60));
  });
});

test('Status buttons carry both attributes the colour rule needs', () => {
  // .stat button[aria-pressed="true"][data-v="on"] - miss either and the selected
  // status never looks selected.
  const html = page('pr1');
  const buttons = html.match(/<button[^>]*data-act="projStatus"[^>]*>/g) || [];
  ok(buttons.length >= 5, 'a button per status');
  buttons.forEach(function (b) {
    ok(b.indexOf('data-v="') > 0, 'has data-v: ' + b);
    ok(b.indexOf('aria-pressed="') > 0, 'has aria-pressed: ' + b);
  });
  ok(/aria-pressed="true"/.test(html), 'and one of them is the current status');
});

group('The commercial block is a permission, not a preference');

test('It appears when the details collection arrived', () => {
  const html = page('pr1');   // pr1 has a details record
  ok(html.indexOf('Commercial') > 0, 'the block is there');
  ok(/data-edit="pdValue"/.test(html), 'and its fields');
});

test('Only the VALUE is absent when that list was refused', () => {
  // The adapter hands back an EMPTY ARRAY plus a note in snap.denied when the list
  // is refused - so the array is always there. Gating on the array is the bug this
  // test exists to prevent: it would show the value to everyone.
  //
  // And what the refusal hides is deliberately narrow. Confidence, why-we-win and
  // the product/focus/resource pickers are the team's and stay put.
  const snap = demoBoard();
  snap.denied = ['projectDetails'];
  const html = page('pr1', { snap: snap });

  notOk(/data-edit="pdValue"/.test(html), 'no way to read or write the value');
  ok(html.indexOf('project value is kept to the people') > 0, 'and it says why');

  ok(/data-edit="pdWin"/.test(html), 'confidence survives');
  ok(/data-edit="pdReason"/.test(html), 'why we win survives');
  ok(/data-f="products"/.test(html), 'and the product picker');
});

test('The numbers themselves never reach a refused page', () => {
  const snap = demoBoard();
  const value = snap.projectDetails.find(function (d) { return d.id === 'pr1'; }).estValue;
  snap.denied = ['projectDetails'];
  const html = page('pr1', { snap: snap });

  notOk(html.indexOf(String(value)) > 0, 'the estimated value is not in the HTML');
});

test('Value and confidence are shown separately, never multiplied', () => {
  // The product of dollars and a percentage is not dollars. Printing "$175,000" for
  // 250k at 70% invites somebody to add a column of them up and quote the total as
  // money. Anyone wanting a risk-adjusted pipeline number can weight it in the
  // roll-up, where the convention gets stated once.
  const snap = demoBoard();
  snap.projectDetails.find(function (x) { return x.id === 'pr1'; }).estValue = 250000;
  project(snap, 'pr1').winPct = 70;
  const html = page('pr1', { snap: snap });

  ok(/<span class="l">Annual value<\/span>/.test(html), 'the dollars, on their own');
  ok(html.indexOf('$250k') > 0, 'abbreviated to fit the KPI cell');
  ok(/<span class="l">Win confidence<\/span>/.test(html), 'the percentage, on its own');
  ok(html.indexOf('>70%<') > 0, 'shown as a percentage');

  notOk(html.indexOf('175,000') > 0, 'and no weighted dollar figure');
  notOk(html.indexOf('$175k') > 0, 'not abbreviated either');
  notOk(html.indexOf('Weighted') > 0, 'nor the label');
});

test('The copy summary carries no weighted figure either', () => {
  const snap = demoBoard();
  snap.projectDetails.find(function (x) { return x.id === 'pr1'; }).estValue = 250000;
  project(snap, 'pr1').winPct = 70;
  const text = projectSummary(snap, project(snap, 'pr1'), TODAY, true);

  ok(text.indexOf('250,000') >= 0, 'the value is there');
  ok(text.indexOf('70%') >= 0, 'and the confidence');
  notOk(text.indexOf('175,000') >= 0, 'but not the product of them');
  notOk(text.indexOf('Weighted') >= 0, 'nor the label');
});

test('The strip shows the four stats its grid has room for, and no more', () => {
  // `.kpis` is repeat(4, minmax(0,1fr)). A fifth does not error - it wraps onto a
  // second row and leaves three empty cells.
  eq((page('pr1').match(/<div class="kpi /g) || []).length, 4, 'with commercial access');
  const snap = demoBoard();
  snap.denied = ['projectDetails'];
  eq((page('pr1', { snap: snap }).match(/<div class="kpi /g) || []).length, 4, 'without');
});

test('Without commercial access only the value slot changes', () => {
  // Confidence is the team's, so it keeps its place. Days in status takes the slot
  // the value gave up, rather than the strip showing a blank.
  const snap = demoBoard();
  project(snap, 'pr1').winPct = 65;
  snap.denied = ['projectDetails'];
  const html = page('pr1', { snap: snap });

  // The Commercial panel has a row labelled "Annual value" either way - it is the
  // KPI that goes. So this looks for the stat label specifically.
  notOk(/<span class="l">Annual value<\/span>/.test(html), 'no value stat');
  ok(/<span class="l">Win confidence<\/span>/.test(html), 'confidence is still a stat');
  ok(html.indexOf('>65%<') > 0, 'with its number');
  ok(html.indexOf('Days in status') > 0, 'and days in status takes the free slot');
});

group('Product selection, focus and resources');

test('Chosen values are chips, and the dropdown offers the rest', () => {
  // pr1 picks Testex 12 clear and Demo-Bond 7 out of four products.
  const snap = demoBoard();
  const html = page('pr1', { snap: snap });
  const chosen = project(snap, 'pr1').products;

  chosen.forEach(function (v) {
    ok(html.indexOf('>' + v + '<button class="x"') > 0, v + ' is a chip');
  });
  snap.settings.products.items
    .filter(function (v) { return chosen.indexOf(v) < 0; })
    .forEach(function (v) {
      ok(html.indexOf('<option value="' + v + '">') > 0, v + ' is offered');
    });
});

test('The dropdown never offers something already chosen', () => {
  // Picking it again would either do nothing or silently take it off, and neither
  // is what choosing it looks like.
  const snap = demoBoard();
  const html = page('pr1', { snap: snap });

  project(snap, 'pr1').products.forEach(function (v) {
    notOk(html.indexOf('<option value="' + v + '">') > 0, v + ' is not in the list');
  });
});

test('The dropdown leads with an add prompt, not a real value', () => {
  // Without a blank first option the select shows a product that is not chosen,
  // which reads as though it were.
  const html = page('pr1');
  ok(/<option value="">\+ Add a product<\/option>/.test(html), 'products');
  ok(/<option value="">\+ Add a focus area<\/option>/.test(html), 'focus');
  ok(/<option value="">\+ Add a resource<\/option>/.test(html), 'resources');
});

test('Every control names the field it writes to, and the project', () => {
  // data-v carries the value on a chip, so the field rides on data-f. Miss it and
  // the handler silently does nothing.
  const html = page('pr1');

  const adders = html.match(/<select[^>]*data-edit="projAdd"[^>]*>/g) || [];
  eq(adders.length, 3, 'one dropdown per list');
  adders.forEach(function (el) {
    ok(/data-f="(products|focus|resources)"/.test(el), 'names its field: ' + el);
    ok(el.indexOf('data-id="pr1"') > 0, 'and its project: ' + el);
  });

  const droppers = html.match(/<button[^>]*data-act="projDrop"[^>]*>/g) || [];
  ok(droppers.length > 0, 'found chips to remove');
  droppers.forEach(function (el) {
    ok(/data-f="(products|focus|resources)"/.test(el), 'names its field: ' + el);
    ok(el.indexOf('data-v="') > 0, 'and its value: ' + el);
  });
});

test('A field with nothing chosen says so rather than showing an empty row', () => {
  const snap = demoBoard();
  project(snap, 'pr1').products = [];
  const html = page('pr1', { snap: snap });

  ok(html.indexOf('None chosen yet') > 0, 'says none');
  ok(html.indexOf('+ Add a product') > 0, 'and still offers the dropdown');
});

test('When everything is chosen the dropdown goes rather than sitting empty', () => {
  const snap = demoBoard();
  project(snap, 'pr1').products = snap.settings.products.items.slice();
  const html = page('pr1', { snap: snap });

  ok(html.indexOf('Every product on the list is chosen') > 0, 'says so');
  notOk(/data-f="products"[^>]*>\s*<option value="">/.test(html), 'no empty dropdown');
});

test('An empty list says where to fill it in rather than showing nothing', () => {
  const snap = demoBoard();
  snap.settings.products = { items: [] };
  const html = page('pr1', { snap: snap });

  ok(html.indexOf('Product selection') > 0, 'the row is still there');
  ok(html.indexOf('maintained on the People') > 0, 'and says where the list lives');
});

test('A read-only board offers no way to change any of them', () => {
  const html = page('pr1', { modes: { content: 'read', settings: 'read' } });

  notOk(/data-edit="projAdd"/.test(html), 'no dropdown');
  notOk(/data-act="projDrop"/.test(html), 'and no remove buttons');
  ok(html.indexOf('Testex 12 clear') > 0, 'but the chosen values still read');
});

group('Notes on the page');group('Notes on the page');

test('Notes show newest first, with author and time', () => {
  const html = page('pr2');   // pr2 is the project with several notes
  ok(html.indexOf('Third batch mixing Thursday') > 0, 'the newest note');
  ok(html.indexOf('Second pilot batch cracked') > 0, 'and the oldest');
  ok(html.indexOf('Third batch mixing Thursday') < html.indexOf('Second pilot batch cracked'),
    'newest appears first in the page');
});

test('An edited note says so', () => {
  const html = page('pr2');
  ok(html.indexOf('edited') > 0);
});

test('Only the author is offered edit and remove', () => {
  const snap = demoBoard();

  // p2 wrote n1 and n3; p1 wrote n2.
  const asP2 = page('pr2', { snap: snap, identity: { personId: 'p2' } });
  const p2Tools = (asP2.match(/data-act="editNote"/g) || []).length;
  eq(p2Tools, 2, 'p2 may edit their own two notes');

  const asP1 = page('pr2', { snap: snap, identity: { personId: 'p1' } });
  eq((asP1.match(/data-act="editNote"/g) || []).length, 1, 'p1 may edit their one');

  const asStranger = page('pr2', { snap: snap, identity: { personId: 'p5' } });
  eq((asStranger.match(/data-act="editNote"/g) || []).length, 0, 'and a colleague none');
});

test('Somebody not on the roster may write a note but not edit one', () => {
  const snap = demoBoard();
  const html = page('pr2', { snap: snap, identity: { personId: null } });

  ok(/data-form="note"/.test(html), 'the add form is there');
  eq((html.match(/data-act="editNote"/g) || []).length, 0, 'but nothing to edit');
});

test('Notes lock once the project is done or cancelled', () => {
  ['done', 'cancelled'].forEach(function (status) {
    const snap = demoBoard();
    project(snap, 'pr2').status = status;
    const html = page('pr2', { snap: snap, identity: { personId: 'p2' } });

    notOk(/data-form="note"/.test(html), 'no add form once ' + status);
    eq((html.match(/data-act="editNote"/g) || []).length, 0,
      'and not even the author may edit, once ' + status);
    ok(html.indexOf('can no longer be changed') > 0, 'and it says why');
    ok(html.indexOf('Second pilot batch cracked') > 0, 'but the notes are still there');
  });
});

test('A read-only board offers no way to add a note', () => {
  const html = page('pr2', { modes: { content: 'read', settings: 'read' } });
  notOk(/data-form="note"/.test(html), 'no add form');
});

test('A project with no notes says so rather than showing an empty list', () => {
  const html = page('pr6');
  ok(html.indexOf('No notes yet') > 0);
});

group('Copying a project out');

test('The summary carries the project, its actions and its notes', () => {
  const snap = demoBoard();
  const text = projectSummary(snap, project(snap, 'pr2'), TODAY, true);

  ok(text.indexOf('Halden Industrial') >= 0, 'the customer');
  ok(text.indexOf('OPEN ACTIONS') >= 0, 'an actions section');
  ok(text.indexOf('LATEST NOTES') >= 0, 'a notes section');
  ok(text.indexOf('Third batch mixing Thursday') >= 0, 'and a note in it');
  notOk(/undefined|NaN|\[object Object\]/.test(text), 'nothing failed to arrive');
});

test('The summary withholds the value from a reader who cannot see it', () => {
  // Otherwise Copy summary would hand out in plain text exactly what the page
  // withheld. Only the dollar figure is withheld - the rest is the team's.
  const snap = demoBoard();
  snap.projectDetails.find(function (x) { return x.id === 'pr1'; }).estValue = 250000;
  project(snap, 'pr1').winPct = 65;

  const withValue = projectSummary(snap, project(snap, 'pr1'), TODAY, true);
  ok(withValue.indexOf('250,000') >= 0, 'included when it may be');
  ok(withValue.indexOf('VALUE') >= 0, 'under its own heading');

  const without = projectSummary(snap, project(snap, 'pr1'), TODAY, false);
  notOk(without.indexOf('250,000') >= 0, 'and absent when it may not');
  notOk(without.indexOf('VALUE') >= 0, 'no empty heading either');
  ok(without.indexOf('65%') >= 0, 'but confidence still travels');
  ok(without.indexOf('Product selection') >= 0, 'and the products');
});

test('Every project summarises without a hole in it', () => {
  const snap = demoBoard();
  snap.projects.forEach(function (p) {
    const text = projectSummary(snap, p, TODAY, true);
    notOk(/undefined|NaN|\[object Object\]/.test(text), p.id + ': ' + text.slice(0, 120));
  });
});

group('The rest of the page');

test('Days in status is counted, and never negative', () => {
  // Meetings are routinely viewed a week or two ahead of today, so the date a status
  // was set really can be in the future. "-14 days as on track" helps nobody - the
  // same mistake that put work due in three days into "Already Owed".
  //
  // It reads in the Status panel header rather than the KPI strip, which only has
  // four slots and gives two of them to value and confidence.
  const snap = demoBoard();
  project(snap, 'pr1').statusMeeting = addDays(TODAY, 14);
  const html = page('pr1', { snap: snap });

  ok(/\d+ days as /.test(html), 'the count is on the page');
  notOk(/-\d+ days as /.test(html), 'a meeting in the future does not make it negative');
  ok(html.indexOf('0 days as ') > 0, 'it reads zero instead');
});

test('Days in status is still counted when it is a KPI', () => {
  const snap = demoBoard();
  snap.denied = ['projectDetails'];
  project(snap, 'pr1').statusMeeting = addDays(TODAY, 14);
  const html = page('pr1', { snap: snap });

  ok(html.indexOf('Days in status') > 0, 'the stat is there');
  notOk(/<span class="n">-\d+<\/span>/.test(html), 'and not negative there either');
});

test('A project raised as an opportunity says where it came from', () => {
  const snap = demoBoard();
  const fromOpp = snap.projects.find(function (p) { return p.fromOpp; });
  ok(fromOpp, 'the demo board has one');
  const html = page(fromOpp.id, { snap: snap });
  ok(html.indexOf('Raised as an opportunity') > 0);
});

test('An off-track project with no action says it is stuck in Issues', () => {
  const snap = demoBoard();
  const p = project(snap, 'pr2');
  p.status = 'off';
  snap.actions = snap.actions.filter(function (a) {
    return !(a.parent && a.parent.id === 'pr2');
  });
  const html = page('pr2', { snap: snap });
  ok(html.indexOf('Off track with no action yet') > 0);
});

test('Read-only disables the controls rather than hiding them', () => {
  const html = page('pr1', { modes: { content: 'read', settings: 'read' } });
  const statusButtons = html.match(/<button[^>]*data-act="projStatus"[^>]*>/g) || [];
  ok(statusButtons.length > 0, 'the buttons are still shown');
  statusButtons.forEach(function (b) {
    ok(b.indexOf('disabled') > 0, 'and disabled: ' + b);
  });
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
