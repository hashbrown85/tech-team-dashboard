// @ts-check
/**
 * The Wins & Losses form keeps its loss-only box across a redraw.
 *
 * Reported: entering a loss, the "What we will do differently" box disappeared
 * after about a minute. Choosing Loss unhid it in the DOM and nowhere else, so the
 * idle redraw drew it hidden again - with the text still in it, invisible, and a
 * loss cannot be saved without it. The choice now lives in ui.wlKind.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';

const DAY = '2026-09-22';

function form(ui) {
  const html = renderApp(demoBoard(DAY), Object.assign(loadUi(),
    { view: 'tab', tab: 't1', steps: { t1: 0 }, open: 'wl' }, ui),
    { today: DAY, modes: { content: 'live', settings: 'live', details: 'live' },
      identity: { kind: 'demo', personId: 'p1' } });
  const m = /<form class="add" data-form="wl">[\s\S]*?<\/form>/.exec(html);
  return m ? m[0] : '';
}

function changeBox(html) {
  const m = /<input[^>]*name="change"[^>]*>/.exec(html);
  return m ? m[0] : '';
}

/** A select as the handler sees it, inside a form holding the change box. */
function select(value, box) {
  return /** @type {any} */ ({
    value: value,
    form: { querySelector: function () { return box; } }
  });
}

async function app() {
  const store = createStore(createMemoryAdapter({ seed: demoBoard(DAY) }), {});
  await store.load();
  const ui = Object.assign(loadUi(), { view: 'tab', tab: 't1', steps: { t1: 0 } });
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: ui, render: function () {}, today: function () { return DAY; }
  }));
  return { store: store, ui: ui, H: H };
}

group('The loss-only box survives a redraw');

test('A fresh form is a win, with the box hidden', () => {
  const f = form({});
  ok(f.indexOf('<option value="win" selected>') >= 0);
  ok(/\shidden/.test(changeBox(f)), 'hidden');
});

test('The reported case: choose Loss, then the page redraws', async () => {
  const a = await app();
  a.H.clicks.openForm(null, '', 'wl');
  const box = { hidden: true, focus: function () {} };
  a.H.edits.wlKind(select('loss', box));
  notOk(box.hidden, 'unhidden at once, as before');

  // The redraw is a fresh render from ui - which is all the idle poll does.
  const f = form({ wlKind: a.ui.wlKind });
  notOk(/\shidden/.test(changeBox(f)), 'still showing after the redraw');
  ok(f.indexOf('<option value="loss" selected>') >= 0, 'with Loss still chosen');
});

test('Switching back to Win hides it again, and keeps it hidden', async () => {
  const a = await app();
  const box = { hidden: false, focus: function () {} };
  a.H.edits.wlKind(select('win', box));
  ok(box.hidden);
  ok(/\shidden/.test(changeBox(form({ wlKind: a.ui.wlKind }))));
});

test('Anything but loss off the page counts as a win', async () => {
  const a = await app();
  a.H.edits.wlKind(select('<script>', { hidden: true, focus: function () {} }));
  eq(a.ui.wlKind, 'win');
});

test('Opening the form again starts it as a win', async () => {
  const a = await app();
  a.ui.wlKind = 'loss';
  a.H.clicks.openForm(null, '', 'wl');
  eq(a.ui.wlKind, 'win');
});

test('Saving a loss resets it for the next entry', async () => {
  const a = await app();
  a.ui.wlKind = 'loss';
  a.H.forms.wl(new Map([['kind', 'loss'], ['text', 'Lost the tender'],
    ['why', 'Price'], ['change', 'Quote earlier'], ['who', 'p1']]));
  await new Promise(function (r) { setTimeout(r, 25); });
  eq(a.ui.wlKind, 'win');
  ok(a.store.snapshot().entries.some(function (e) { return e.change === 'Quote earlier'; }),
    'and the loss was saved');
});
