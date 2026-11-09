// @ts-check
/**
 * System: the kinds of asset a project works on, several per project.
 *
 * Requested: "a selection based on the type(s) of systems the customer has" -
 * an H2S scavenger project might be scrubber tower and heat exchanger; a corrosion
 * project downhole, rod pump and gas lift. A list kept on Board settings that can
 * also be added to on the fly from a project's page.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';
import { byId } from '../src/lib/seq.js';
import { NEW_VALUE } from '../src/views/pickers.js';
import { SCHEMA } from '../src/adapters/sharepointSchema.js';

const DAY = '2026-09-22';
const LIVE = { content: 'live', settings: 'live', details: 'live' };

function page(ui, snap, modes) {
  return renderApp(snap || demoBoard(DAY), Object.assign(loadUi(), { view: 'project', project: 'pr1' }, ui || {}),
    { today: DAY, modes: modes || LIVE, identity: { kind: 'demo', personId: 'p1' } });
}

group('System on the project page');

test('Its chips, and a dropdown of the rest with "+ New system..." last', () => {
  const html = page();
  ok(html.indexOf('>Scrubber tower<button class="x"') > 0, 'chosen: a chip');
  ok(html.indexOf('>Heat exchanger<button class="x"') > 0);
  const sel = /<select[^>]*data-f="systems"[\s\S]*?<\/select>/.exec(html);
  ok(sel, 'the dropdown');
  if (!sel) return;
  ok(sel[0].indexOf('<option value="Downhole">') > 0, 'offers what is not chosen');
  notOk(sel[0].indexOf('<option value="Scrubber tower">') > 0, 'not what is');
  ok(/<option value="__new__">\+ New system…<\/option><\/select>$/.test(sel[0]), 'and new, last');
});

test('Products does not offer "+ New" - that list comes from Dataverse', () => {
  const sel = /<select[^>]*data-f="products"[\s\S]*?<\/select>/.exec(page());
  ok(sel);
  if (sel) notOk(sel[0].indexOf(NEW_VALUE) >= 0);
});

test('Choosing "+ New system..." opens a box to type one', () => {
  const html = page({ open: 'newval:systems:pr1' });
  ok(/<form class="add listval" data-form="newPickValue" data-id="pr1" data-key="systems">/.test(html));
  ok(html.indexOf('>Scrubber tower<button class="x"') > 0, 'the chips stay in view');
});

test('A read-only board offers neither the dropdown nor the box', () => {
  const html = page({ open: 'newval:systems:pr1' }, null, { content: 'readonly', settings: 'readonly', details: 'live' });
  notOk(/data-f="systems"[^>]*data-edit="projAdd"|data-edit="projAdd"[^>]*data-f="systems"/.test(html));
  notOk(html.indexOf('data-form="newPickValue"') >= 0);
});

test('Stored as a list in SharePoint', () => {
  eq(SCHEMA.projects.fields.systems, { col: 'SystemsJson', kind: 'json' });
});

group('Adding a system');

async function app(modes) {
  const store = createStore(createMemoryAdapter({ seed: demoBoard(DAY) }), {});
  await store.load();
  // As flow.test.js does: a reader the store knows it cannot write settings for.
  if (modes && modes.settings === 'readonly') {
    store.canWrite = function (col) { return col !== 'settings'; };
  }
  const ui = Object.assign(loadUi(), { view: 'project', project: 'pr1' });
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: ui, render: function () {}, today: function () { return DAY; }
  }));
  return { store: store, ui: ui, H: H };
}

function settle() {
  return new Promise(function (r) { setTimeout(r, 25); });
}

function form() {
  return /** @type {any} */ ({ dataset: { id: 'pr1', key: 'systems' } });
}

test('Picking one from the list adds it to the project', async () => {
  const a = await app();
  a.H.edits.projAdd(/** @type {any} */ ({ value: 'Gas lift', dataset: { id: 'pr1', f: 'systems' } }));
  await settle();
  eq(byId(a.store.snapshot().projects, 'pr1').systems, ['Scrubber tower', 'Heat exchanger', 'Gas lift']);
});

test('"+ New system..." opens the box rather than storing "__new__"', async () => {
  const a = await app();
  a.H.edits.projAdd(/** @type {any} */ ({ value: NEW_VALUE, dataset: { id: 'pr1', f: 'systems' } }));
  eq(a.ui.open, 'newval:systems:pr1');
  notOk((byId(a.store.snapshot().projects, 'pr1').systems || []).indexOf(NEW_VALUE) >= 0);
});

test('A new one goes on the project AND on the Board settings list', async () => {
  const a = await app();
  a.H.forms.newPickValue(new Map([['value', '  Flowline  ']]), form());
  await settle();
  const snap = a.store.snapshot();
  ok(byId(snap.projects, 'pr1').systems.indexOf('Flowline') >= 0, 'on the project, trimmed');
  ok(snap.settings.systems.items.indexOf('Flowline') >= 0, 'and on the list for next time');
  eq(a.ui.open, null, 'the box closes');
});

test('Typed in a different case, it snaps to the listed one - no duplicate', async () => {
  const a = await app();
  a.H.forms.newPickValue(new Map([['value', 'gas LIFT']]), form());
  await settle();
  const snap = a.store.snapshot();
  ok(byId(snap.projects, 'pr1').systems.indexOf('Gas lift') >= 0, 'the listed spelling');
  eq(snap.settings.systems.items.filter(function (v) { return v.toLowerCase() === 'gas lift'; }).length, 1);
});

test('Without settings access it goes on the project only', async () => {
  const a = await app({ settings: 'readonly' });
  a.H.forms.newPickValue(new Map([['value', 'Flowline']]), form());
  await settle();
  const snap = a.store.snapshot();
  ok(byId(snap.projects, 'pr1').systems.indexOf('Flowline') >= 0);
  notOk(snap.settings.systems.items.indexOf('Flowline') >= 0, 'the list is not touched');
});

test('Only System takes new values this way', async () => {
  const a = await app();
  const before = JSON.stringify(a.store.snapshot().settings);
  a.H.forms.newPickValue(new Map([['value', 'Made-up product']]),
    /** @type {any} */ ({ dataset: { id: 'pr1', key: 'products' } }));
  await settle();
  eq(JSON.stringify(a.store.snapshot().settings), before);
});

group('Systems on Board settings');

test('A Systems list, renameable like Fields', () => {
  const html = renderApp(demoBoard(DAY), Object.assign(loadUi(), { view: 'config' }),
    { today: DAY, modes: LIVE, identity: { kind: 'demo', personId: 'p1' } });
  ok(html.indexOf('<h2>Systems</h2>') > 0);
  ok(html.indexOf('data-act="editListVal" data-key="systems" data-v="Scrubber tower"') > 0);
  ok(html.indexOf('data-act="delSystemVal"') > 0, 'and removable');
});
