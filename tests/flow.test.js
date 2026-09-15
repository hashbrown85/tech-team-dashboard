// @ts-check
/**
 * One meeting, end to end, through the real handlers and the real store.
 *
 * Everything else in this suite tests a rule in isolation. This drives the app the
 * way a person does — raise an issue, give it an owner, close the action, watch the
 * issue resolve itself — and checks the pieces line up. It is the test that would
 * catch a handler wired to the wrong domain function, which no unit test can.
 *
 * The handlers touch a little DOM (focus, flash, toasts), so a minimal stub is
 * installed below. That stub is an honest measure of how much browser the app
 * actually needs, which is: almost none.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { demoBoard } from '../src/demo-data.js';
import { createHandlers } from '../src/handlers.js';
import { loadUi } from '../src/ui.js';
import { today } from '../src/lib/dates.js';
import { issueItems, actionedItems } from '../src/domain/queries.js';
import { renderApp } from '../src/views/render.js';

/** Just enough DOM for the handlers to run outside a browser. */
function stubDom() {
  if (typeof globalThis.document === 'undefined' || !globalThis.document.createElement) {
    globalThis.document = /** @type {any} */ ({
      getElementById: function () { return null; },
      createElement: function () {
        return {
          style: {},
          select: function () {},
          setAttribute: function () {},
          addEventListener: function () {},
          classList: { add: function () {}, remove: function () {}, toggle: function () {} },
          querySelector: function () { return null; }
        };
      },
      body: { appendChild: function () {}, removeChild: function () {} },
      addEventListener: function () {}
    });
  }
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = /** @type {any} */ ({
      scrollTo: function () {},
      matchMedia: function () { return { matches: false }; },
      addEventListener: function () {},
      setInterval: function () {},
      clearInterval: function () {}
    });
  }
}

/** A running app: store loaded, handlers wired, pointed at the demo board. */
async function app(uiOverrides) {
  stubDom();
  const adapter = createMemoryAdapter({ seed: demoBoard(), startActionNum: 8 });
  const ui = Object.assign(
    loadUi(),
    { view: 'tab', tab: 't1', steps: { t1: 3 } },
    uiOverrides || {}
  );
  const store = createStore(adapter, {});
  await store.load();
  const handlers = createHandlers({
    store: store,
    ui: ui,
    render: function () {},
    today: today
  });
  return {
    store: store,
    ui: ui,
    H: handlers,
    snap: function () { return store.snapshot(); }
  };
}

/** Give queued store writes a turn to settle. */
function settle() {
  return new Promise(function (r) { setTimeout(r, 25); });
}

/** Form data in the shape the handlers receive it. */
function fields(pairs) {
  return new Map(pairs);
}

function queueIds(snap, tid) {
  return issueItems(snap, tid).map(function (it) { return it.o.id; });
}

function movedIds(snap, tid) {
  return actionedItems(snap, tid).map(function (it) { return it.o.id; });
}

group('A meeting, end to end');

test('The starting queue holds only what nobody owns', async () => {
  const a = await app();
  eq(queueIds(a.snap(), 't1'), ['i1', 'i2']);
  // pr2 is off track, but an action already points at it, so it has a path and
  // belongs in the "moved" list. That is rule 1 working, not a gap.
  ok(movedIds(a.snap(), 't1').indexOf('pr2') >= 0, 'the owned off-track project shows as moved');
});

test('Raising a show-stopper puts it above the ordinary issues', async () => {
  const a = await app();
  a.H.forms.issue(fields([
    ['text', 'Extruder die needs replacing'], ['sev', 'stopper'], ['who', 'p2']
  ]));
  await settle();

  const raised = a.snap().issues.find(function (i) {
    return i.text === 'Extruder die needs replacing';
  });
  ok(raised, 'it was stored');
  eq(queueIds(a.snap(), 't1')[1], raised.id, 'below the existing stopper, above the risk');
});

test('Giving an issue an owner moves it out of the queue', async () => {
  const a = await app();
  const before = queueIds(a.snap(), 't1').length;

  a.H.forms.action(
    fields([
      ['text', 'Order the replacement die'], ['owner', 'Priya Raman'],
      ['support', ''], ['due', today()], ['rel', 'i:i1']
    ]),
    /** @type {any} */ ({ dataset: { tab: 't1' } })
  );
  await settle();

  eq(queueIds(a.snap(), 't1').length, before - 1, 'one fewer without a path');
  ok(movedIds(a.snap(), 't1').indexOf('i1') >= 0, 'now tracked as an action');

  const created = a.snap().actions.find(function (x) {
    return x.text === 'Order the replacement die';
  });
  eq(created.num, 8, 'and it took the next action number');
});

test('Closing the last action resolves the issue, and unticking reopens it', async () => {
  const a = await app();
  a.H.forms.action(
    fields([
      ['text', 'Order the die'], ['owner', 'Priya Raman'], ['support', ''],
      ['due', today()], ['rel', 'i:i1']
    ]),
    /** @type {any} */ ({ dataset: { tab: 't1' } })
  );
  await settle();
  const act = a.snap().actions.find(function (x) { return x.text === 'Order the die'; });

  a.H.edits.actionDone(/** @type {any} */ ({ dataset: { id: act.id }, checked: true }));
  await settle();
  let issue = a.snap().issues.find(function (i) { return i.id === 'i1'; });
  eq(issue.status, 'resolved');
  eq(issue.autoResolved, true, 'marked auto, so it can be undone');

  a.H.edits.actionDone(/** @type {any} */ ({ dataset: { id: act.id }, checked: false }));
  await settle();
  issue = a.snap().issues.find(function (i) { return i.id === 'i1'; });
  eq(issue.status, 'open');
  notOk('autoResolved' in issue, 'and the marker is cleared');
});

test('The project status lifecycle behaves through the handler', async () => {
  const a = await app({ steps: { t1: 2 } });

  a.H.clicks.projStatus(null, 'pr1', 'off');
  await settle();
  let p = a.snap().projects.find(function (x) { return x.id === 'pr1'; });
  eq(p.prevStatus, 'on', 'records where it came from');
  ok(queueIds(a.snap(), 't1').indexOf('pr1') >= 0, 'and joins the queue');

  a.H.clicks.projStatus(null, 'pr1', 'on');
  await settle();
  p = a.snap().projects.find(function (x) { return x.id === 'pr1'; });
  notOk('prevStatus' in p, 'toggling straight back erases the record');
  notOk(queueIds(a.snap(), 't1').indexOf('pr1') >= 0, 'and leaves the queue');
});

test('Rating a meeting stores a score, and clicking it again clears it', async () => {
  const a = await app({ steps: { t1: 4 } });

  a.H.clicks.setRating(null, 'p5', '5');
  await settle();
  ok(JSON.stringify(a.snap().meetings).indexOf('"p5":5') >= 0, 'recorded');

  a.H.clicks.setRating(null, 'p5', '5');
  await settle();
  notOk(JSON.stringify(a.snap().meetings).indexOf('"p5":5') >= 0, 'cleared by clicking again');
});

test('Deleting a project keeps its actions, and undo puts everything back', async () => {
  const a = await app();
  const actionCount = a.snap().actions.length;

  a.H.clicks.delProject(null, 'pr3');
  await settle();
  notOk(a.snap().projects.some(function (p) { return p.id === 'pr3'; }), 'the project went');
  eq(a.snap().actions.length, actionCount, 'no action was deleted');
  eq(a.snap().actions.find(function (x) { return x.id === 'a4'; }).parent, null, 'detached');

  await a.store.undo();
  ok(a.snap().projects.some(function (p) { return p.id === 'pr3'; }), 'undo restored it');
  eq(a.snap().actions.find(function (x) { return x.id === 'a4'; }).parent,
    { type: 'project', id: 'pr3' }, 'and reattached the action');
});

test('Renaming somebody carries their name across their actions', async () => {
  // Because actions store an owner by NAME. This cascade is the reason the
  // owner-id migration is planned — see DATA_MODEL.md.
  const a = await app({ view: 'people' });
  a.H.edits.personName(/** @type {any} */ ({
    dataset: { id: 'p2' }, value: 'Priya Raman-Clarke'
  }));
  await settle();

  eq(a.snap().people.find(function (p) { return p.id === 'p2'; }).name, 'Priya Raman-Clarke');
  eq(a.snap().actions.find(function (x) { return x.id === 'a1'; }).owner, 'Priya Raman-Clarke',
    'their existing action followed the rename');
});

test('Walking every agenda step leaves the app renderable', async () => {
  const a = await app();
  for (let step = 0; step <= 4; step++) {
    a.H.clicks.step(null, '', String(step));
    const html = renderApp(a.snap(), a.ui, { today: today(), modes: a.store.modes() });
    ok(html.length > 2000, 'step ' + step + ' renders');
    notOk(html.indexOf('undefined') >= 0, 'step ' + step + ' has no holes');
  }
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
