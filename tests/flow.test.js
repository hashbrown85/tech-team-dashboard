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
import { byPriority } from '../src/domain/projects.js';
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
    today: today,
    identity: function () {
      return { kind: 'signed-in', personId: (uiOverrides || {}).asPerson || 'p1' };
    }
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

group('Picking products, focus and resources');

/** Choose something from one of the dropdowns. */
function add(a, projectId, field, value) {
  a.H.edits.projAdd(/** @type {any} */ ({
    dataset: { f: field, id: projectId }, value: value
  }));
}

/** Click the x on a chosen chip. */
function drop(a, projectId, field, value) {
  a.H.clicks.projDrop(/** @type {any} */ ({ dataset: { f: field } }), projectId, value);
}

function proj(a, id) {
  return a.snap().projects.find(function (p) { return p.id === id; });
}

test('Choosing a product adds it without disturbing the others', async () => {
  const a = await app();
  const before = (proj(a, 'pr1').products || []).slice();
  ok(before.length >= 2, 'pr1 starts with a couple');

  add(a, 'pr1', 'products', 'Demo-Seal HT');
  await settle();

  const after = proj(a, 'pr1').products;
  ok(after.indexOf('Demo-Seal HT') >= 0, 'the new one is on');
  before.forEach(function (v) { ok(after.indexOf(v) >= 0, v + ' is still chosen'); });
  eq(after.length, before.length + 1, 'exactly one added');
});

test('The placeholder option adds nothing', async () => {
  // The dropdown sits at "+ Add a product" until something is picked, and that
  // fires a change of its own in some browsers.
  const a = await app();
  const before = (proj(a, 'pr1').products || []).slice();

  add(a, 'pr1', 'products', '');
  await settle();

  eq(proj(a, 'pr1').products, before, 'untouched');
});

test('Removing a chip takes off that one and only that one', async () => {
  const a = await app();
  const before = proj(a, 'pr1').products.slice();

  drop(a, 'pr1', 'products', before[0]);
  await settle();

  const after = proj(a, 'pr1').products;
  notOk(after.indexOf(before[0]) >= 0, 'the one clicked is off');
  eq(after.length, before.length - 1, 'and nothing else moved');
});

test('Adding something already chosen changes nothing', async () => {
  // The dropdown only offers what is not yet chosen, so this is unreachable from
  // the page - but add must not quietly toggle if it is reached another way.
  const a = await app();
  const before = proj(a, 'pr1').products.slice();

  add(a, 'pr1', 'products', before[0]);
  await settle();

  eq(proj(a, 'pr1').products, before, 'still there, not removed');
});

test('Removing something that is not chosen changes nothing', async () => {
  const a = await app();
  const before = proj(a, 'pr1').products.slice();

  drop(a, 'pr1', 'products', 'Demo-Seal HT');
  await settle();

  eq(proj(a, 'pr1').products, before);
});

test('Focus and resources are separate lists', async () => {
  const a = await app();
  add(a, 'pr1', 'focus', 'Pipeline');
  await settle();

  const p = proj(a, 'pr1');
  ok(p.focus.indexOf('Pipeline') >= 0, 'focus area added');
  notOk((p.resources || []).indexOf('Pipeline') >= 0, 'and not to resources');
  notOk((p.products || []).indexOf('Pipeline') >= 0, 'nor to products');
});

test('A field name that is not one of the three is refused', async () => {
  // data-f comes off the page, so it is worth not trusting. Without the guard this
  // writes an arbitrary key onto the project - here, one that would cancel it.
  const a = await app();
  add(a, 'pr1', 'status', 'cancelled');
  await settle();

  eq(proj(a, 'pr1').status, 'on', 'the project is untouched');
});

test('Picking on a project that is not there does nothing', async () => {
  const a = await app();
  add(a, 'no-such-project', 'products', 'Demo-Seal HT');
  await settle();
  ok(true, 'did not throw');
});

group('Only the value is restricted');

test('Confidence writes to the project, not the restricted list', async () => {
  const a = await app();
  a.H.edits.pdWin(/** @type {any} */ ({ dataset: { id: 'pr1' }, value: '80' }));
  await settle();

  eq(proj(a, 'pr1').winPct, 80);
  const d = a.snap().projectDetails.find(function (x) { return x.id === 'pr1'; });
  notOk(d && 'winPct' in d, 'nothing landed on the restricted record');
});

test('Why we win writes to the project too', async () => {
  const a = await app();
  a.H.edits.pdReason(/** @type {any} */ ({ dataset: { id: 'pr1' }, value: 'Best data' }));
  await settle();

  eq(proj(a, 'pr1').winReason, 'Best data');
});

test('The value still writes to the restricted list, and only there', async () => {
  const a = await app();
  a.H.edits.pdValue(/** @type {any} */ ({ dataset: { id: 'pr2' }, value: '42000' }));
  await settle();

  eq(a.snap().projectDetails.find(function (x) { return x.id === 'pr2'; }).estValue, 42000);
  notOk('estValue' in proj(a, 'pr2'), 'and not onto the project');
});

group('Notes, through the handlers');

test('Adding a note stamps the author and the time', async () => {
  const a = await app({ asPerson: 'p3' });
  a.H.forms.note(fields([['text', '  Supplier sent the data sheets  ']]),
    /** @type {any} */ ({ dataset: { id: 'pr1' } }));
  await settle();

  const mine = a.snap().projectNotes.filter(function (n) { return n.authorId === 'p3'; });
  eq(mine.length, 1);
  eq(mine[0].text, 'Supplier sent the data sheets', 'trimmed');
  eq(mine[0].projectId, 'pr1');
  ok(/^\d{4}-\d{2}-\d{2}T/.test(mine[0].created), 'and timestamped');
});

test('An empty note is not written at all', async () => {
  const a = await app();
  const before = a.snap().projectNotes.length;
  a.H.forms.note(fields([['text', '   ']]),
    /** @type {any} */ ({ dataset: { id: 'pr1' } }));
  await settle();
  eq(a.snap().projectNotes.length, before, 'nothing added');
});

test('Only the author can remove a note, whatever the page offered', async () => {
  // The view only draws Remove for the author, but the handler is reachable by
  // anything that can dispatch an event, so the rule is checked there too.
  const a = await app({ asPerson: 'p1' });
  const theirs = a.snap().projectNotes.find(function (n) { return n.authorId === 'p2'; });
  ok(theirs, 'p2 wrote one');

  a.H.clicks.delNote(null, theirs.id);
  await settle();
  ok(a.snap().projectNotes.some(function (n) { return n.id === theirs.id; }),
    'somebody else could not remove it');

  const own = a.snap().projectNotes.find(function (n) { return n.authorId === 'p1'; });
  a.H.clicks.delNote(null, own.id);
  await settle();
  notOk(a.snap().projectNotes.some(function (n) { return n.id === own.id; }),
    'but the author could');
});

test('Nobody can remove a note once the project is finished', async () => {
  const a = await app({ asPerson: 'p1' });
  const own = a.snap().projectNotes.find(function (n) { return n.authorId === 'p1'; });
  a.H.clicks.projStatus(null, own.projectId, 'done');
  await settle();

  a.H.clicks.delNote(null, own.id);
  await settle();
  ok(a.snap().projectNotes.some(function (n) { return n.id === own.id; }),
    'the note survives, as the record of how it went');
});

test('Editing a note keeps its original time and stamps the change', async () => {
  const a = await app({ asPerson: 'p1' });
  const own = a.snap().projectNotes.find(function (n) { return n.authorId === 'p1'; });
  const was = own.created;

  a.H.forms.noteEdit(fields([['text', 'Rewritten']]),
    /** @type {any} */ ({ dataset: { id: own.id } }));
  await settle();

  const after = a.snap().projectNotes.find(function (n) { return n.id === own.id; });
  eq(after.text, 'Rewritten');
  eq(after.created, was, 'still from when it was written');
  ok(after.edited, 'and says it changed');
});

test('Somebody else cannot edit it either', async () => {
  const a = await app({ asPerson: 'p1' });
  const theirs = a.snap().projectNotes.find(function (n) { return n.authorId === 'p2'; });
  const was = theirs.text;

  a.H.forms.noteEdit(fields([['text', 'Not mine to change']]),
    /** @type {any} */ ({ dataset: { id: theirs.id } }));
  await settle();

  eq(a.snap().projectNotes.find(function (n) { return n.id === theirs.id; }).text, was);
});

group('Priority: each person orders their own projects');

/** The ids of one person's projects in a meeting, in the order they render. */
function orderOf(a, tabId, personId) {
  return a.snap().projects
    .filter(function (p) { return p.tab === tabId && p.personId === personId; })
    .sort(byPriority)
    .map(function (p) { return p.id; });
}

function moveProject(a, id, delta) {
  a.H.clicks.movePriority(null, id, String(delta));
}

test('Moving a project up swaps it with the one above', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  const before = orderOf(a, 't1', 'p1');
  ok(before.length >= 2, 'p1 has a couple in t1, got ' + before.length);

  moveProject(a, before[1], -1);
  await settle();

  const after = orderOf(a, 't1', 'p1');
  eq(after[0], before[1], 'the second one is now first');
  eq(after[1], before[0], 'and the first is second');
});

test('Moving it back down restores the order', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  const before = orderOf(a, 't1', 'p1');

  moveProject(a, before[1], -1);
  await settle();
  moveProject(a, before[1], 1);
  await settle();

  eq(orderOf(a, 't1', 'p1'), before, 'back where it started');
});

test('The first click works on a board that has never been ordered', async () => {
  // Nothing starts with a priority. A pairwise SWAP would exchange two absent
  // values and do nothing at all, so the very first arrow click would look broken.
  // reorderProjects renumbers instead, which is the whole reason it does.
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  a.snap().projects.forEach(function (p) {
    notOk('priority' in p, p.id + ' starts with no priority');
  });

  const before = orderOf(a, 't1', 'p1');
  moveProject(a, before[1], -1);
  await settle();

  notOk(orderOf(a, 't1', 'p1')[0] === before[0], 'the order really changed');
});

test('Moving up from the top does nothing, and neither does down from the bottom', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  const before = orderOf(a, 't1', 'p1');

  moveProject(a, before[0], -1);
  await settle();
  eq(orderOf(a, 't1', 'p1'), before, 'top stays put');

  moveProject(a, before[before.length - 1], 1);
  await settle();
  eq(orderOf(a, 't1', 'p1'), before, 'bottom stays put');
});

test('One person reordering never moves anybody else work', async () => {
  // Priority is per person per meeting. Two people's lists are independent.
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  const others = a.snap().projects
    .filter(function (p) { return p.personId !== 'p1'; })
    .map(function (p) { return p.id + ':' + p.priority; });

  const mine = orderOf(a, 't1', 'p1');
  moveProject(a, mine[1], -1);
  await settle();

  const after = a.snap().projects
    .filter(function (p) { return p.personId !== 'p1'; })
    .map(function (p) { return p.id + ':' + p.priority; });
  eq(after, others, 'nobody else was renumbered');
});

test('Priority survives a project going off track and back', async () => {
  // `rank` is the off-track queue position, and statusChange sets it on the way out
  // and deletes it on the way back. Reusing it for priority would have meant a
  // status change silently scrambled somebody's order - this is that test.
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  const before = orderOf(a, 't1', 'p1');
  moveProject(a, before[1], -1);
  await settle();
  const ordered = orderOf(a, 't1', 'p1');

  a.H.clicks.projStatus(null, ordered[0], 'off');
  await settle();
  a.H.clicks.projStatus(null, ordered[0], 'on');
  await settle();

  eq(orderOf(a, 't1', 'p1'), ordered, 'the order is untouched');
});

test('An unordered list still renders the same way twice', async () => {
  // Without a tiebreak, a list nobody has ordered comes back in whatever order the
  // store returned, which can differ between a load and the poll - and rows appear
  // to shuffle on their own.
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  const once = orderOf(a, 't1', 'p1');
  const shuffled = a.snap().projects.slice().reverse();
  eq(shuffled.filter(function (p) { return p.tab === 't1' && p.personId === 'p1'; })
      .sort(byPriority).map(function (p) { return p.id; }),
    once, 'same order from a differently-ordered snapshot');
});

test('A project nobody has ordered sorts BELOW the ones somebody has', () => {
  // Every project starts with no priority, so a board where none is set cannot tell
  // "absent sorts last" from "absent sorts first" - both put them in the same order.
  // It takes a mixture to pin down, and the mixture is the normal case: somebody
  // orders their list, then adds a project.
  const ordered = { id: 'a', priority: 3, added: '2026-01-01' };
  const fresh = { id: 'b', added: '2026-01-01' };

  ok(byPriority(ordered, fresh) < 0, 'the ordered one comes first');
  ok(byPriority(fresh, ordered) > 0, 'and the fresh one after it, both ways round');

  const sorted = [fresh, ordered].sort(byPriority).map(function (x) { return x.id; });
  eq(sorted, ['a', 'b'], 'even a large priority beats no priority');
});

test('A newly added project lands at the bottom of an ordered list', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  const before = orderOf(a, 't1', 'p1');
  moveProject(a, before[1], -1);          // give the list real priorities
  await settle();

  a.H.forms.project(fields([['name', 'Brand new thing'], ['due', '']]),
    /** @type {any} */ ({ dataset: { pid: 'p1' } }));
  await settle();

  const after = orderOf(a, 't1', 'p1');
  const added = a.snap().projects.find(function (p) { return p.name === 'Brand new thing'; });
  ok(added, 'it was created');
  eq(after[after.length - 1], added.id, 'and it is last, not first');
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
