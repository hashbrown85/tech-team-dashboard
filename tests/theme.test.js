// @ts-check
/**
 * Choosing light or dark.
 *
 * The dark palette always existed but only the operating system could turn it on.
 * The choice is per person and per browser: it must never reach the shared board.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { validTheme, applyTheme, THEMES } from '../src/lib/theme.js';
import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { loadUi } from '../src/ui.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';

const DAY = '2026-09-22';

function page(theme) {
  return renderApp(demoBoard(DAY), Object.assign(loadUi(), { theme: theme }),
    { today: DAY, modes: { content: 'live', settings: 'live', details: 'live' },
      identity: { kind: 'demo', personId: 'p1', displayName: 'Alex Morgan' } });
}

/** An element that records its data-theme attribute. */
function htmlTag() {
  const attrs = {};
  return {
    attrs: attrs,
    setAttribute: function (k, v) { attrs[k] = v; },
    removeAttribute: function (k) { delete attrs[k]; }
  };
}

group('Choosing light or dark');

test('Three choices, starting from whatever Windows says', () => {
  eq(THEMES.map(function (t) { return t[0]; }), ['auto', 'light', 'dark']);
  eq(loadUi().theme, 'auto');
});

test('Anything unrecognised means Match Windows', () => {
  eq(validTheme('dark'), 'dark');
  eq(validTheme('purple'), 'auto');
  eq(validTheme(null), 'auto');
});

test('Light and dark set the attribute the stylesheet reads; auto removes it', () => {
  const tag = htmlTag();
  applyTheme(tag, 'dark');
  eq(tag.attrs['data-theme'], 'dark');
  applyTheme(tag, 'light');
  eq(tag.attrs['data-theme'], 'light');
  applyTheme(tag, 'auto');
  notOk('data-theme' in tag.attrs, 'no attribute, so prefers-color-scheme decides');
});

test('The sidebar offers it, with the current choice marked', () => {
  const html = page('dark');
  const sel = /<select[^>]*data-edit="theme"[\s\S]*?<\/select>/.exec(html);
  ok(sel, 'the picker is there');
  if (sel) {
    ok(sel[0].indexOf('value="dark" selected') > 0, 'Dark is marked');
    eq((sel[0].match(/ selected/g) || []).length, 1, 'and only Dark');
  }
});

test('Choosing one changes the view and writes nothing to the board', async () => {
  const store = createStore(createMemoryAdapter({ seed: demoBoard(DAY) }), {});
  await store.load();
  const before = JSON.stringify(store.snapshot());
  const ui = loadUi();
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: ui, render: function () {},
    today: function () { return DAY; }
  }));
  H.edits.theme(/** @type {any} */ ({ value: 'dark' }));
  eq(ui.theme, 'dark');
  H.edits.theme(/** @type {any} */ ({ value: '<script>' }));
  eq(ui.theme, 'auto', 'a value off the page is never trusted');
  eq(JSON.stringify(store.snapshot()), before, 'the shared board is untouched');
});
