// @ts-check
/**
 * The curated pick-lists read in alphabetical order, wherever they appear.
 *
 * Fields, Project types, Products, Focus and Potential resources are stored in the
 * order they were added. They used to be SHOWN in that order too on the settings
 * screen and in three of the places you pick from them - while the Field and Project
 * type dropdowns sorted, so the same list could read two different ways on two
 * screens.
 */

import { group, test, eq, ok } from './harness.js';
import { alphabetically } from '../src/lib/seq.js';
import { pickList } from '../src/domain/queries.js';
import { valueOptions } from '../src/domain/projects.js';
import { blankSnapshot } from '../src/adapters/DataStore.js';
import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { loadUi } from '../src/ui.js';

const MODES = { content: 'live', settings: 'live', details: 'live' };

function withList(key, items) {
  const s = blankSnapshot();
  s.settings[key] = { items: items };
  return s;
}

group('The order people read a list in');

test('Case does not decide the order', () => {
  eq(['scale', 'Corrosion', 'pipeline'].sort(alphabetically),
    ['Corrosion', 'pipeline', 'scale']);
});

test('Numbers sort as numbers, not as text', () => {
  // Plain text comparison puts "Resin 10" before "Resin 2".
  eq(['Resin 10', 'Resin 2', 'Resin 1'].sort(alphabetically),
    ['Resin 1', 'Resin 2', 'Resin 10']);
});

test('The order never depends on how the list was stored', () => {
  // Two values equal but for case still land in a fixed order, so reordering the
  // saved list cannot reorder what is shown.
  const one = ['b', 'B', 'a'].sort(alphabetically);
  const two = ['B', 'a', 'b'].sort(alphabetically);
  eq(one, two);
});

group('Reading a pick-list');

test('It comes back alphabetical', () => {
  eq(pickList(withList('focus', ['Scale', 'Corrosion', 'Rod Pumps', 'Pipeline']), 'focus'),
    ['Corrosion', 'Pipeline', 'Rod Pumps', 'Scale']);
});

test('The saved list is not reordered in place', () => {
  // Sorted on read. Sorting the stored array would reorder it on every addition and
  // change what gets written back.
  const snap = withList('products', ['Zeta', 'Alpha']);
  pickList(snap, 'products');
  eq(snap.settings.products.items, ['Zeta', 'Alpha'], 'the stored order is untouched');
});

test('An absent or empty list is simply empty', () => {
  eq(pickList(blankSnapshot(), 'resources'), []);
  eq(pickList(withList('field', []), 'field'), []);
});

test('The Field suggestions use the same rule', () => {
  // valueOptions already sorted, by its own comparison. It now shares the one rule,
  // so a dropdown and its settings panel cannot disagree.
  const opts = valueOptions([], ['Resin 10', 'coatings', 'Resin 2', 'Adhesives'], 'field');
  eq(opts.map(function (o) { return o.label; }),
    ['Adhesives', 'coatings', 'Resin 2', 'Resin 10']);
});

group('Every place the lists appear');

test('The settings screen lists each one alphabetically', () => {
  const snap = demoBoard('2026-09-29');
  snap.settings.focus = { items: ['Scale', 'Corrosion', 'Pipeline'] };
  const html = renderApp(snap, Object.assign({}, loadUi(), { view: 'people' }),
    { today: '2026-09-29', modes: MODES, identity: { kind: 'local', personId: 'p1' } });
  const c = html.indexOf('Corrosion'), p = html.indexOf('Pipeline'), s = html.indexOf('Scale');
  ok(c >= 0 && p > c && s > p, 'Corrosion, then Pipeline, then Scale');
});

test('The picker on a project page offers them alphabetically', () => {
  const snap = demoBoard('2026-09-29');
  snap.settings.products = { items: ['Zinc Guard', 'Aqua Shield', 'Maxi Flow'] };
  const html = renderApp(snap,
    Object.assign({}, loadUi(), { view: 'project', project: 'pr1' }),
    { today: '2026-09-29', modes: MODES, identity: { kind: 'local', personId: 'p1' } });
  const a = html.indexOf('>Aqua Shield<'), m = html.indexOf('>Maxi Flow<'),
    z = html.indexOf('>Zinc Guard<');
  ok(a >= 0 && m > a && z > m, 'Aqua, Maxi, Zinc');
});

test('The opportunity form offers Focus alphabetically', () => {
  const snap = demoBoard('2026-09-29');
  snap.settings.focus = { items: ['Scale', 'Corrosion', 'Pipeline'] };
  const html = renderApp(snap,
    Object.assign({}, loadUi(), { view: 'tab', tab: 't1', steps: { t1: 1 }, open: 'opp' }),
    { today: '2026-09-29', modes: MODES, identity: { kind: 'local', personId: 'p1' } });
  const form = /<form[^>]*data-form="opp"[\s\S]*?<\/form>/.exec(html);
  ok(form, 'the form rendered');
  if (!form) return;
  const c = form[0].indexOf('Corrosion'), p = form[0].indexOf('Pipeline'),
    s = form[0].indexOf('Scale');
  ok(c >= 0 && p > c && s > p, 'Corrosion, then Pipeline, then Scale');
});
