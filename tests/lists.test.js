// @ts-check
/**
 * The lists a project picks values from, and what keeps them clean.
 *
 * Fields and Project types **grow on their own**: type a value that is not on the
 * list and it joins it, so the next person is offered it. That is only survivable
 * because of two things, and both are what this file defends.
 *
 * **Canonicalising.** Typing "coatings" when the list holds "Coatings" must use the
 * list's spelling and must not add a second entry. Without it the list fragments into
 * case variants of itself, and each one hides most of the rows behind the filter.
 *
 * **Renaming, with a cascade.** A slip becomes shared vocabulary the moment it is
 * typed, so the only honest answer is correcting it everywhere in one action. There
 * is a precedent: renaming a person rewrites every action they own, because actions
 * store an owner by name. Projects store these values the same way.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import {
  canonicalValue, valueKey, valueOptions, countUsing, RENAMEABLE_LISTS
} from '../src/domain/projects.js';
import { renameListValue } from '../src/domain/cascade.js';
import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { loadUi } from '../src/ui.js';
import { today } from '../src/lib/dates.js';

const MODES = { content: 'live', settings: 'live' };
const base = loadUi();

function page(opts) {
  const o = opts || {};
  const snap = o.snap || demoBoard();
  return renderApp(snap, Object.assign({}, base, { view: o.view || 'config' }, o.ui || {}), {
    today: today(),
    modes: o.modes || MODES,
    identity: { personId: 'p1', displayName: 'Alex Morgan' }
  });
}

function project(snap, id) {
  return snap.projects.find(function (p) { return p.id === id; });
}

/** Apply a cascade's writes the way the store would, so the result can be read. */
function apply(snap, writes) {
  writes.forEach(function (w) {
    if (w.col === 'settings') snap.settings[w.id] = w.data;
    if (w.col === 'projects') {
      Object.assign(project(snap, w.id), w.patch);
    }
  });
}

group('Settling a typed value against the list');

test('An exact match uses the list entry', () => {
  eq(canonicalValue(['Coatings'], 'Coatings'), { value: 'Coatings', add: null });
});

test('A different spelling adopts the list\'s, and adds nothing', () => {
  // The whole point. Otherwise the list grows a case variant of itself, and each
  // copy hides most of the rows behind the filter.
  eq(canonicalValue(['Coatings'], 'coatings'), { value: 'Coatings', add: null });
  eq(canonicalValue(['Coatings'], '  COATINGS  '), { value: 'Coatings', add: null });
});

test('A genuinely new value is stored and added', () => {
  eq(canonicalValue(['Coatings'], 'Polymers'), { value: 'Polymers', add: 'Polymers' });
});

test('It is trimmed on the way in', () => {
  eq(canonicalValue([], '  Polymers  '), { value: 'Polymers', add: 'Polymers' });
});

test('Clearing the box is allowed, and never grows the list', () => {
  // Unlike a project's name, a blank Field is a real state to be in.
  eq(canonicalValue(['Coatings'], ''), { value: '', add: null });
  eq(canonicalValue(['Coatings'], '   '), { value: '', add: null });
  eq(canonicalValue(['Coatings'], null), { value: '', add: null });
});

test('An empty list takes whatever is typed', () => {
  eq(canonicalValue([], 'Polymers'), { value: 'Polymers', add: 'Polymers' });
  eq(canonicalValue(undefined, 'Polymers'), { value: 'Polymers', add: 'Polymers' });
});

test('The comparison key is the same one the table filter uses', () => {
  // If these ever drift, a canonicalised value stops being findable by its own
  // filter, which is the kind of bug nobody thinks to look for.
  eq(valueKey('  Coatings  '), 'coatings');
  eq(valueKey(null), '');
  eq(valueKey(undefined), '');
});

group('Suggestions: the list, plus what is in use');

test('A curated entry nobody uses is still offered', () => {
  // Otherwise adding a value on the settings screen does nothing visible, and the
  // screen is decorative.
  const opts = valueOptions([], ['Polymers'], 'field');
  eq(opts.length, 1);
  eq(opts[0].label, 'Polymers');
  eq(opts[0].n, 0);
});

test('A value in use but not on the list is still offered', () => {
  // The legacy tail: everything typed before the list existed. Dropping it would
  // make the next person retype it, which is the fragmentation this prevents.
  const opts = valueOptions([{ field: 'Legacy' }], [], 'field');
  eq(opts.length, 1);
  eq(opts[0].label, 'Legacy');
  eq(opts[0].n, 1);
});

test('Where both have it, the curated spelling wins', () => {
  // The list is the authority on how a value is written.
  const opts = valueOptions([{ field: 'coatings' }], ['Coatings'], 'field');
  eq(opts.length, 1, 'one option, not two');
  eq(opts[0].label, 'Coatings', 'spelled the list\'s way');
  eq(opts[0].n, 1, 'and counted');
});

test('Options are sorted, and blanks are not offered', () => {
  const opts = valueOptions([{ field: '' }, { field: '  ' }], ['Zeta', 'alpha'], 'field');
  eq(opts.map(function (o) { return o.label; }), ['alpha', 'Zeta']);
});

group('Counting what uses a value');

test('It counts single-value fields', () => {
  const snap = demoBoard();
  eq(countUsing(snap, 'field', 'Coatings'), 2);
  eq(countUsing(snap, 'field', 'coatings'), 2, 'case-insensitively');
  eq(countUsing(snap, 'field', 'nothing'), 0);
});

test('And array fields, which the other lists use', () => {
  const snap = demoBoard();
  project(snap, 'pr1').focus = ['Corrosion', 'Scale'];
  project(snap, 'pr2').focus = ['Corrosion'];
  eq(countUsing(snap, 'focus', 'Corrosion'), 2);
  eq(countUsing(snap, 'focus', 'Scale'), 1);
});

group('Renaming a value, everywhere it is used');

test('The list entry changes, and so does every project holding it', () => {
  const snap = demoBoard();
  project(snap, 'pr3').field = 'Coatngs';
  snap.settings.field.items.push('Coatngs');

  const c = renameListValue(snap, 'field', 'Coatngs', 'Ceramics');
  apply(snap, c.writes);

  eq(project(snap, 'pr3').field, 'Ceramics');
  ok(snap.settings.field.items.indexOf('Ceramics') >= 0, 'on the list');
  notOk(snap.settings.field.items.indexOf('Coatngs') >= 0, 'and the old one gone');
  ok(c.message.indexOf('1 project') > 0, 'the message counts them: ' + c.message);
});

test('Projects are matched case-insensitively', () => {
  const snap = demoBoard();
  project(snap, 'pr3').field = 'COATNGS';
  snap.settings.field.items.push('Coatngs');

  apply(snap, renameListValue(snap, 'field', 'Coatngs', 'Ceramics').writes);
  eq(project(snap, 'pr3').field, 'Ceramics');
});

test('Renaming onto an existing entry merges the two', () => {
  // The case that matters: a typo that has already spread. Refusing it would leave
  // you retyping the value on every project that caught it.
  const snap = demoBoard();
  project(snap, 'pr3').field = 'Coatngs';
  snap.settings.field.items.push('Coatngs');

  const c = renameListValue(snap, 'field', 'Coatngs', 'Coatings');
  apply(snap, c.writes);

  eq(project(snap, 'pr3').field, 'Coatings');
  eq(snap.settings.field.items.filter(function (x) { return x === 'Coatings'; }).length, 1,
    'one entry, not two');
  notOk(snap.settings.field.items.indexOf('Coatngs') >= 0);
  ok(c.message.indexOf('Merged') === 0, c.message);
});

test('An array field renames in place', () => {
  const snap = demoBoard();
  project(snap, 'pr1').focus = ['Corrosion', 'Scale'];
  snap.settings.focus.items.push('Coatngs');
  project(snap, 'pr2').focus = ['Coatngs'];

  apply(snap, renameListValue(snap, 'focus', 'Coatngs', 'Ceramics').writes);
  eq(project(snap, 'pr2').focus, ['Ceramics']);
  eq(project(snap, 'pr1').focus, ['Corrosion', 'Scale'], 'untouched');
});

test('An array field de-duplicates when two values merge', () => {
  // A project tagged both the typo and the real one must end with ONE, not two.
  // This is the branch most likely to be got wrong.
  const snap = demoBoard();
  snap.settings.focus.items.push('Coatngs');
  project(snap, 'pr1').focus = ['Coatngs', 'Corrosion', 'Scale'];

  apply(snap, renameListValue(snap, 'focus', 'Coatngs', 'Corrosion').writes);
  eq(project(snap, 'pr1').focus, ['Corrosion', 'Scale']);
});

test('A project already spelled the target way is not counted', () => {
  // "3 projects moved" when one did is a message that cannot be checked against
  // what you see on screen.
  const snap = demoBoard();
  snap.settings.field.items.push('coatings');      // a duplicate key on the list
  const c = renameListValue(snap, 'field', 'coatings', 'Coatings');

  eq(c.writes.filter(function (w) { return w.col === 'projects'; }).length, 0,
    'nothing to change');
});

test('Undo restores the list and every project', () => {
  const snap = demoBoard();
  project(snap, 'pr3').field = 'Coatngs';
  snap.settings.field.items.push('Coatngs');
  const before = JSON.stringify([snap.settings.field.items, project(snap, 'pr3').field]);

  const c = renameListValue(snap, 'field', 'Coatngs', 'Coatings');
  apply(snap, c.writes);
  apply(snap, c.undo);

  eq(JSON.stringify([snap.settings.field.items, project(snap, 'pr3').field]), before);
});

test('A blank or unchanged target does nothing', () => {
  const snap = demoBoard();
  eq(renameListValue(snap, 'field', 'Coatings', '').writes, []);
  eq(renameListValue(snap, 'field', 'Coatings', '   ').writes, []);
  eq(renameListValue(snap, 'field', 'Coatings', 'Coatings').writes, []);
});

test('A list that cannot be renamed is refused', () => {
  // Products is coming from Dataverse; renaming a value here would edit a copy of
  // something this app does not own.
  const snap = demoBoard();
  eq(renameListValue(snap, 'products', 'Testex 12 clear', 'Testex 12').writes, []);
  notOk(RENAMEABLE_LISTS.products, 'and it is not on the list of renameable ones');
});

group('People, and Board settings');

test('The roster and the lists are two pages, each named for what it holds', () => {
  const people = page({ view: 'people' });
  const config = page();
  ok(people.indexOf('<h1>People</h1>') > 0, 'People has its own heading');
  ok(config.indexOf('<h1>Board settings</h1>') > 0, 'and so does Board settings');
  // Pinned to the label element, not to a character window after the attribute:
  // the nav items carry an inline icon now, and a distance-based match would go
  // vacuous the moment anything else is added between the two.
  ok(/data-v="people"[\s\S]{0,400}?<span class="ni-t">People<\/span>/.test(config),
    'the People nav item');
  ok(/data-v="config"[\s\S]{0,400}?<span class="ni-t">Board settings<\/span>/.test(people),
    'the Board settings nav item');
});

test('Each page holds only its own half', () => {
  const people = page({ view: 'people' });
  const config = page();
  ok(people.indexOf('data-edit="personName"') > 0, 'the roster is on People');
  notOk(people.indexOf('data-form="fieldVal"') >= 0 || people.indexOf('openForm" data-v="fieldVal"') >= 0,
    'the pick-lists are not');
  ok(config.indexOf('data-v="fieldVal"') > 0, 'they are on Board settings');
  notOk(config.indexOf('data-edit="personName"') >= 0, 'and the roster is not');
});

test('The route id is unchanged, so a remembered session still lands here', () => {
  // ui.view is persisted with no validation, and an unknown view silently falls
  // through to the Overview. Renaming the route would strand anyone mid-session.
  ok(/data-act="go" data-v="people"/.test(page()));
});

test('All five lists are there, with Fields and Project types leading', () => {
  const html = page();
  ['Fields', 'Project types', 'Products', 'Focus', 'Potential resources']
    .forEach(function (t) {
      ok(html.indexOf('<h2>' + t + '</h2>') > 0, t + ' has a panel');
    });
  ok(html.indexOf('<h2>Fields</h2>') < html.indexOf('<h2>Products</h2>'),
    'the self-growing ones come first');
});

test('Each value shows how many projects use it', () => {
  // What makes a typo visible: a slip reads 1 beside a real category's 14.
  const html = page();
  ok(/data-v="Coatings"[\s\S]{0,200}<span class="cnt n"[^>]*>2<\/span>/.test(html),
    'Coatings is used by two projects');
});

test('The four renameable lists offer it; Products does not', () => {
  const html = page();
  ['field', 'projectType', 'focus', 'resources'].forEach(function (k) {
    ok(html.indexOf('data-act="editListVal" data-key="' + k + '"') > 0, k + ' renameable');
  });
  notOk(html.indexOf('data-act="editListVal" data-key="products"') > 0,
    'products is not');
});

test('Clicking a value swaps that one chip for an editor', () => {
  const html = page({ ui: { open: 'listval:field:Coatings' } });
  ok(/<form class="add listval" data-form="renameListValue" data-key="field" data-v="Coatings">/
    .test(html));
  ok(html.indexOf('value="Coatings"') > 0, 'prefilled');
});

test('A read-only board offers neither rename nor remove', () => {
  const html = page({ modes: { content: 'live', settings: 'readonly' } });
  notOk(/data-act="editListVal"/.test(html), 'no rename');
  notOk(/data-act="delFieldVal"/.test(html), 'no remove');
  ok(html.indexOf('Coatings') > 0, 'but the values still read');
});

group('The project page picks from the list');

test('Its suggestions are the list plus what is in use', () => {
  const snap = demoBoard();
  snap.settings.field.items.push('Polymers');       // curated, unused
  project(snap, 'pr4').field = 'Legacy';            // used, uncurated

  const html = renderApp(snap,
    Object.assign({}, base, { view: 'project', project: 'pr1' }),
    { today: today(), modes: MODES, identity: { personId: 'p1' } });

  const dl = /<datalist id="dl-field">[\s\S]*?<\/datalist>/.exec(html);
  ok(dl, 'the datalist is there');
  ok(dl[0].indexOf('Polymers') > 0, 'a curated entry nobody uses');
  ok(dl[0].indexOf('Legacy') > 0, 'and a used value not on the list');
});

test('It is still a text box, so a new value can be typed', () => {
  // The point of the whole design: pick what is there, or add one.
  const html = renderApp(demoBoard(),
    Object.assign({}, base, { view: 'project', project: 'pr1' }),
    { today: today(), modes: MODES, identity: { personId: 'p1' } });

  ok(/<input[^>]*list="dl-field"[^>]*data-edit="projField"/.test(html));
  ok(/<input[^>]*list="dl-ptype"[^>]*data-edit="projType"/.test(html));
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
