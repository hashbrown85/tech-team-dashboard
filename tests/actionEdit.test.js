// @ts-check
/**
 * Editing an action where it is listed.
 *
 * Requested: actions editable on the Action items page and in the meeting's side
 * rail. They are listed on a project's page too, so all three get the same Edit
 * button and the same editor - text, owner, support, due date.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';
import { byId } from '../src/lib/seq.js';

const DAY = '2026-09-22';
const LIVE = { content: 'live', settings: 'live', details: 'live' };

function screen(ui, opts) {
  const o = opts || {};
  return renderApp(o.snap || demoBoard(DAY), Object.assign(loadUi(), ui),
    { today: DAY, modes: o.modes || LIVE, identity: { kind: 'demo', personId: 'p1' } });
}

const PLACES = {
  'the Action items table': { view: 'actions', filter: 'all' },
  'the meeting side rail': { view: 'tab', tab: 't1', steps: { t1: 3 } },
  'a project page': { view: 'project', project: 'pr2' }
};

/** The editor for one action, if open on this screen. */
function editorFor(html, id) {
  const m = new RegExp('<form class="add" data-form="editAction" data-id="' + id +
    '">[\\s\\S]*?</form>').exec(html);
  return m ? m[0] : '';
}

group('Every place an action is listed can edit it');

Object.keys(PLACES).forEach(function (where) {
  test('An Edit button in ' + where, () => {
    ok(screen(PLACES[where]).indexOf('data-act="editAction" data-id="a1"') >= 0);
  });

  test('Pressing it opens the same editor in ' + where, () => {
    const html = screen(Object.assign({}, PLACES[where], { open: 'act:a1' }));
    const form = editorFor(html, 'a1');
    ok(form, 'the editor is open');
    ok(form.indexOf('value="Send the freeze-thaw data to the formulation group"') >= 0,
      'holding what it says now');
    ok(/<select[^>]*name="owner"[\s\S]*?<option value="Priya Raman" selected>/.test(form),
      'its owner chosen');
    ok(form.indexOf('name="due" type="date" value="2026-09-18"') >= 0, 'and its due date');
    notOk(html.indexOf('data-act="editAction" data-id="a1"') >= 0, 'in place of the row');
  });
});

test('Only the one opened is edited', () => {
  const html = screen({ view: 'actions', filter: 'all', open: 'act:a1' });
  ok(editorFor(html, 'a1'));
  notOk(editorFor(html, 'a2'), 'a2 is still a row');
  ok(html.indexOf('data-act="editAction" data-id="a2"') >= 0);
});

test('Its support person is chosen too', () => {
  const form = editorFor(screen({ view: 'actions', filter: 'all', open: 'act:a2' }), 'a2');
  ok(/<select[^>]*name="support"[\s\S]*?<option value="Ravi Chandra" selected>/.test(form));
});

test('An owner no longer on the roster is kept, not silently replaced', () => {
  // Otherwise Save would quietly hand the action to whoever sorts first.
  const snap = demoBoard(DAY);
  byId(snap.actions, 'a1').owner = 'Somebody Who Left';
  const form = editorFor(screen({ view: 'actions', filter: 'all', open: 'act:a1' },
    { snap: snap }), 'a1');
  ok(form.indexOf('<option value="Somebody Who Left" selected>Somebody Who Left (not on the roster)') >= 0);
});

test('A read-only board offers Edit to nobody', () => {
  const html = screen({ view: 'actions', filter: 'all' },
    { modes: { content: 'readonly', settings: 'live', details: 'live' } });
  const btn = /<button[^>]*data-act="editAction" data-id="a1"[^>]*>/.exec(html);
  ok(btn, 'the button is drawn (CSS hides edit-only on a read-only board)');
  if (btn) {
    ok(btn[0].indexOf('edit-only') >= 0, 'marked edit-only');
    ok(btn[0].indexOf('disabled') >= 0, 'and disabled');
  }
});

group('Saving an edit');

async function app() {
  const store = createStore(createMemoryAdapter({ seed: demoBoard(DAY) }), {});
  await store.load();
  const ui = Object.assign(loadUi(), { view: 'actions' });
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: ui, render: function () {}, today: function () { return DAY; }
  }));
  return { store: store, ui: ui, H: H };
}

function settle() {
  return new Promise(function (r) { setTimeout(r, 25); });
}

function form(id) {
  return /** @type {any} */ ({ dataset: { id: id } });
}

test('Edit opens it; Save writes every field and closes it', async () => {
  const a = await app();
  a.H.clicks.editAction(null, 'a1', '');
  eq(a.ui.open, 'act:a1');

  a.H.forms.editAction(new Map([
    ['text', '  Send the freeze-thaw data to Priya  '], ['owner', 'Alex Morgan'],
    ['support', 'Ravi Chandra'], ['due', '2026-10-09']
  ]), form('a1'));
  await settle();

  const saved = byId(a.store.snapshot().actions, 'a1');
  eq(saved.text, 'Send the freeze-thaw data to Priya', 'text, trimmed');
  eq(saved.owner, 'Alex Morgan');
  eq(saved.support, 'Ravi Chandra');
  eq(saved.due, '2026-10-09');
  eq(saved.num, 1, 'and its number is untouched');
  eq(a.ui.open, null, 'editor closed');
});

test('Clearing the supporting person is allowed', async () => {
  const a = await app();
  a.H.forms.editAction(new Map([
    ['text', 'Book lab time'], ['owner', 'Alex Morgan'], ['support', ''], ['due', '2026-09-25']
  ]), form('a2'));
  await settle();
  eq(byId(a.store.snapshot().actions, 'a2').support, '');
});

test('A blank text or owner is refused, and nothing changes', async () => {
  const a = await app();
  const before = JSON.stringify(byId(a.store.snapshot().actions, 'a1'));
  a.H.forms.editAction(new Map([['text', '   '], ['owner', 'Alex Morgan']]), form('a1'));
  a.H.forms.editAction(new Map([['text', 'Something'], ['owner', '']]), form('a1'));
  await settle();
  eq(JSON.stringify(byId(a.store.snapshot().actions, 'a1')), before);
});

test('An action that no longer exists is left alone', async () => {
  const a = await app();
  const before = a.store.snapshot().actions.length;
  a.H.forms.editAction(new Map([['text', 'x'], ['owner', 'Alex Morgan']]), form('gone'));
  await settle();
  eq(a.store.snapshot().actions.length, before, 'no action conjured into being');
});
