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
import { issueItems, actionedItems, actsOf, projVisible } from '../src/domain/queries.js';
import { meetingDate } from '../src/domain/meetings.js';
import {
  byPriority, projectTitle, confidencePoints
} from '../src/domain/projects.js';
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

/**
 * The ids of one person's projects in a meeting, in the order they render.
 *
 * Visibility matters and used to be missing here. `reorderProjects` moves a project
 * among the ones actually SHOWN, and a project starting next week is not shown - so
 * this helper's idea of the order disagreed with the product's on any Monday, when
 * the demo board's `pr4` starts the following week rather than this one. The tests
 * then failed on the one morning somebody would want to trust them.
 */
function orderOf(a, tabId, personId) {
  return orderIn(a, a.snap().projects, tabId, personId);
}

/** The same rule, applied to any list of projects - so no test can use a different one. */
function orderIn(a, projects, tabId, personId) {
  const tab = a.snap().tabs.filter(function (t) { return t.id === tabId; })[0];
  const d = meetingDate(tab, today(), a.ui.dates[tabId]);
  return projects
    .filter(function (p) {
      return p.tab === tabId && p.personId === personId && projVisible(p, tabId, d);
    })
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
  eq(orderIn(a, shuffled, 't1', 'p1'), once,
    'same order from a differently-ordered snapshot');
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

  a.H.forms.project(fields([['name', 'Brand new thing'], ['due', ''], ['who', 'p1']]));
  await settle();

  const after = orderOf(a, 't1', 'p1');
  const added = a.snap().projects.find(function (p) { return p.name === 'Brand new thing'; });
  ok(added, 'it was created');
  eq(after[after.length - 1], added.id, 'and it is last, not first');
});

group('Correcting a project title');

test('Renaming a project writes the new name', async () => {
  const a = await app();
  a.H.edits.projName(/** @type {any} */ ({
    dataset: { id: 'pr1' }, value: '  Coating additive trial, phase 2  '
  }));
  await settle();

  eq(a.snap().projects.find(function (p) { return p.id === 'pr1'; }).name,
    'Coating additive trial, phase 2', 'trimmed');
});

test('A blank name is refused rather than written', async () => {
  // An empty name leaves a project row with nothing to click on and a heading with
  // nothing in it. Clearing the box is almost always the first half of retyping.
  const a = await app();
  const before = a.snap().projects.find(function (p) { return p.id === 'pr1'; }).name;

  a.H.edits.projName(/** @type {any} */ ({ dataset: { id: 'pr1' }, value: '   ' }));
  await settle();
  eq(a.snap().projects.find(function (p) { return p.id === 'pr1'; }).name, before);

  a.H.edits.projName(/** @type {any} */ ({ dataset: { id: 'pr1' }, value: '' }));
  await settle();
  eq(a.snap().projects.find(function (p) { return p.id === 'pr1'; }).name, before);
});

test('Renaming a project does not orphan its actions', async () => {
  // Actions point at a project by id, so this needs no cascade - unlike renaming a
  // PERSON, which has to rewrite every action they own because those store a name.
  const a = await app();
  const before = actsOf(a.snap(), 'pr2').map(function (x) { return x.id; });
  ok(before.length > 0, 'pr2 has an action');

  a.H.edits.projName(/** @type {any} */ ({
    dataset: { id: 'pr2' }, value: 'Renamed entirely'
  }));
  await settle();

  eq(actsOf(a.snap(), 'pr2').map(function (x) { return x.id; }), before,
    'the same actions still point at it');
});

test('Correcting the customer changes the title but nothing else', async () => {
  const a = await app();
  a.H.edits.projCustomer(/** @type {any} */ ({
    dataset: { id: 'pr1' }, value: 'Meridian Coatings Ltd'
  }));
  await settle();

  const p = a.snap().projects.find(function (x) { return x.id === 'pr1'; });
  eq(p.customer, 'Meridian Coatings Ltd');
  eq(projectTitle(p), 'Meridian Coatings Ltd - Coating additive trial');
  eq(p.status, 'on', 'nothing else moved');
});

group('Raising an opportunity, through the handlers');

/**
 * Form data with repeated values, the way a browser really sends checkboxes.
 *
 * The plain Map the other tests use cannot express two values under one name, and
 * the focus checkboxes need exactly that. This is the smallest thing that answers
 * both get and getAll.
 */
function multiFields(pairs) {
  const m = new Map();
  pairs.forEach(function (pair) {
    const list = m.get(pair[0]) || [];
    list.push(pair[1]);
    m.set(pair[0], list);
  });
  return {
    get: function (k) { const v = m.get(k); return v ? v[0] : null; },
    getAll: function (k) { return (m.get(k) || []).slice(); }
  };
}

group('Correcting a work email');

test('Editing it in place stores it lower-cased', async () => {
  // identify() matches on the lower-cased value, so storing it any other way means
  // the roster reads one way and matches another.
  const a = await app();
  a.H.edits.personUpn(/** @type {any} */ ({
    dataset: { id: 'p1' }, value: '  Alex.Morgan@EXAMPLE.invalid '
  }));
  await settle();
  const p = a.snap().people.find(function (x) { return x.id === 'p1'; });
  eq(p.upn, 'alex.morgan@example.invalid', 'trimmed and folded');
});

test('Clearing it leaves a blank rather than undefined', async () => {
  const a = await app();
  a.H.edits.personUpn(/** @type {any} */ ({ dataset: { id: 'p1' }, value: '' }));
  await settle();
  const p = a.snap().people.find(function (x) { return x.id === 'p1'; });
  eq(p.upn, '', 'a blank, which reads as "none" rather than as the word undefined');
});

group('An item always has an owner');

/*
 * The owner used to be implied by which person's block the "+" button sat in, so it
 * could not be missing. Now it is a field, and a field can be empty - which would
 * create a project or an entry belonging to nobody, showing up in no person's block
 * and reachable only from the Projects list.
 */
test('A project with no owner is not created', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  const before = a.snap().projects.length;
  a.H.forms.project(fields([['name', 'Ownerless'], ['due', ''], ['who', '']]));
  await settle();
  eq(a.snap().projects.length, before, 'nothing was written');
});

test('A win with no owner is not created', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 0 } });
  const before = a.snap().entries.length;
  a.H.forms.wl(fields([['kind', 'win'], ['text', 'Ownerless'], ['why', 'x'], ['who', '']]));
  await settle();
  eq(a.snap().entries.length, before, 'nothing was written');
});

test('An opportunity with no owner is not created', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 1 } });
  const before = a.snap().projects.length;
  a.H.forms.opp(multiFields([['text', 'Ownerless'], ['who', '']]));
  await settle();
  eq(a.snap().projects.length, before, 'no project, and so no entry either');
});

test('A supporting person is optional, and stored when given', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  a.H.forms.project(fields([['name', 'With a second'], ['due', ''],
    ['who', 'p1'], ['support', 'p2']]));
  await settle();
  const made = a.snap().projects.find(function (p) { return p.name === 'With a second'; });
  ok(made, 'it was created');
  if (made) eq(made.support, 'p2', 'and remembers who is helping');

  a.H.forms.project(fields([['name', 'On my own'], ['due', ''], ['who', 'p1']]));
  await settle();
  const solo = a.snap().projects.find(function (p) { return p.name === 'On my own'; });
  ok(solo, 'and one without is fine');
  if (solo) eq(solo.support, '', 'with a blank rather than undefined');
});

test('A new project takes a customer, which leads its title', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  a.H.forms.project(fields([['customer', '  Demo Quartz Works '], ['name', 'Resin swap'],
    ['due', ''], ['who', 'p1']]));
  await settle();
  const made = a.snap().projects.find(function (p) { return p.name === 'Resin swap'; });
  ok(made, 'it was created');
  if (made) {
    eq(made.customer, 'Demo Quartz Works', 'trimmed and stored');
    eq(projectTitle(made), 'Demo Quartz Works - Resin swap', 'and it leads the title');
  }

  a.H.forms.project(fields([['name', 'Internal tidy-up'], ['due', ''], ['who', 'p1']]));
  await settle();
  const internal = a.snap().projects.find(function (p) { return p.name === 'Internal tidy-up'; });
  if (internal) eq(internal.customer, '', 'none given is a blank, not undefined');
});

test('The add-project form asks for the customer, before the name', () => {
  const html = renderApp(demoBoard(), Object.assign(loadUi(),
    { view: 'tab', tab: 't1', steps: { t1: 2 }, open: 'project' }),
    { today: today(), modes: { content: 'live', settings: 'live', details: 'live' },
      identity: { personId: 'p1' } });
  const form = /<form class="add" data-form="project">[\s\S]*?<\/form>/.exec(html);
  ok(form, 'the form is open');
  if (!form) return;
  const c = form[0].indexOf('name="customer"');
  ok(c > 0, 'it has a customer box');
  ok(c < form[0].indexOf('name="name"'), 'ahead of the project name');
});

function raise(a, pairs) {
  // `who` comes from the form now, not from whose block the button sat in.
  a.H.forms.opp(multiFields(pairs.concat([['who', 'p1']])));
}

function newestProject(a) {
  const known = ['pr1', 'pr2', 'pr3', 'pr4', 'pr5', 'pr6'];
  return a.snap().projects.filter(function (p) { return known.indexOf(p.id) < 0; })[0];
}

test('An opportunity carries its project fields through to the project', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 1 } });
  raise(a, [
    ['customer', 'Halden Industrial'],
    ['text', 'Downhole scale trial'],
    ['why', 'Their lab is slow'],
    ['winPct', '40'],
    ['winReason', 'Only ones with the data'],
    ['focus', 'Scale'],
    ['focus', 'Pipeline']
  ]);
  await settle();

  const p = newestProject(a);
  ok(p, 'a project was created');
  eq(p.customer, 'Halden Industrial');
  eq(p.name, 'Downhole scale trial');
  eq(p.note, 'Their lab is slow');
  eq(p.winPct, 40);
  eq(p.winReason, 'Only ones with the data');
  eq(p.focus, ['Scale', 'Pipeline'], 'both boxes ticked');
  eq(p.status, 'new', 'and it joins as a new project');
});

/** The New Opportunities segment as it would be drawn now. */
function oppTiles(a) {
  const html = renderApp(a.snap(), a.ui, { today: today(),
    modes: { content: 'live', settings: 'live', details: 'live' }, identity: { personId: 'p1' } });
  return (html.match(/<li class="item opp">[\s\S]*?<\/li>/g) || []).join('');
}

test('The opportunity tile leads with its customer', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 1 } });
  raise(a, [['customer', 'Demo Quartz Works'], ['text', 'Downhole scale trial']]);
  await settle();
  ok(oppTiles(a).indexOf('<span class="it-t">Demo Quartz Works - Downhole scale trial</span>') >= 0,
    'customer, then what was said');
});

test('A corrected customer shows on the tile too', async () => {
  // It is read from the project, so fixing it on the project page fixes it here.
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 1 } });
  raise(a, [['customer', 'Demo Qaurtz'], ['text', 'Downhole scale trial']]);
  await settle();
  await a.store.update('projects', newestProject(a).id, { customer: 'Demo Quartz Works' });
  const tiles = oppTiles(a);
  ok(tiles.indexOf('Demo Quartz Works - Downhole scale trial') >= 0, 'the correction');
  notOk(tiles.indexOf('Qaurtz') >= 0, 'not the typo');
});

test('No customer, no dangling dash', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 1 } });
  raise(a, [['text', 'Just a thought']]);
  await settle();
  ok(oppTiles(a).indexOf('<span class="it-t">Just a thought</span>') >= 0);
});

test('Its confidence is seeded, so one revision later makes a trend', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 1 } });
  raise(a, [['text', 'Downhole scale trial'], ['winPct', '40']]);
  await settle();

  const p = newestProject(a);
  eq(confidencePoints(p).length, 1, 'one point to start from');
  eq(confidencePoints(p)[0].v, 40);
});

test('Only the title is needed - everything else may be blank', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 1 } });
  raise(a, [['text', 'Just a thought']]);
  await settle();

  const p = newestProject(a);
  ok(p, 'it was still created');
  eq(p.name, 'Just a thought');
  eq(p.customer, '');
  eq(p.focus, []);
  notOk('winPct' in p, 'an empty box is not a confidence of zero');
});

test('No title means nothing is created at all', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 1 } });
  const before = a.snap().projects.length;
  raise(a, [['customer', 'Halden Industrial'], ['winPct', '40']]);
  await settle();
  eq(a.snap().projects.length, before);
});

test('The optional first action is created and points at the new project', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 1 } });
  raise(a, [
    ['text', 'Downhole scale trial'],
    ['actionText', 'Call their lab manager'],
    ['actionOwner', 'Alex Morgan'],
    ['actionDue', '2026-09-30']
  ]);
  await settle();

  const p = newestProject(a);
  const acts = actsOf(a.snap(), p.id);
  eq(acts.length, 1, 'one action');
  eq(acts[0].text, 'Call their lab manager');
  eq(acts[0].owner, 'Alex Morgan', 'stored by name, as actions are');
  eq(acts[0].due, '2026-09-30');
  eq(acts[0].parent.type, 'project');
  eq(acts[0].parent.id, p.id, 'attached to the project it will become');
});

test('Leaving the action blank is the normal case, not an error', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 1 } });
  const before = a.snap().actions.length;
  raise(a, [['text', 'Downhole scale trial'], ['actionText', '   ']]);
  await settle();

  const p = newestProject(a);
  ok(p, 'the opportunity was still raised');
  eq(a.snap().actions.length, before, 'and no action was invented');
});

test('The entry keeps the record of what was said in the meeting', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 1 } });
  raise(a, [['text', 'Downhole scale trial'], ['why', 'Their lab is slow']]);
  await settle();

  const p = newestProject(a);
  const entry = a.snap().entries.find(function (e) { return e.projectId === p.id; });
  ok(entry, 'an entry was written too');
  eq(entry.kind, 'opp');
  eq(entry.text, 'Downhole scale trial');
  eq(entry.why, 'Their lab is slow');
});

group('Confidence recorded through the handler');

test('Editing confidence stamps the meeting, not today', async () => {
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  a.H.edits.pdWin(/** @type {any} */ ({ dataset: { id: 'pr2' }, value: '55' }));
  await settle();

  const p = a.snap().projects.find(function (x) { return x.id === 'pr2'; });
  eq(p.winPct, 55);
  const points = confidencePoints(p);
  eq(points[points.length - 1].v, 55);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(points[points.length - 1].d), 'against a meeting date');
});

test('Typing a number a digit at a time leaves one point, not three', async () => {
  // The field writes on every change. Without one-point-per-meeting, "8" then "80"
  // would leave a jagged line nobody drew.
  const a = await app({ view: 'tab', tab: 't1', steps: { t1: 2 } });
  const before = confidencePoints(
    a.snap().projects.find(function (x) { return x.id === 'pr1'; })).length;

  ['8', '80'].forEach(function (v) {
    a.H.edits.pdWin(/** @type {any} */ ({ dataset: { id: 'pr1' }, value: v }));
  });
  await settle();

  const p = a.snap().projects.find(function (x) { return x.id === 'pr1'; });
  const points = confidencePoints(p);
  eq(points[points.length - 1].v, 80, 'the number that was meant');
  ok(points.length <= before + 1, 'at most one new point, got ' + points.length);
});

group('Filtering the Projects list');

test('Typing in the search box changes ui state and nothing else', async () => {
  // It runs on every keystroke, so it must not write to the store. That is the
  // whole reason data-input is a separate map from data-edit.
  const a = await app();
  const before = JSON.stringify(a.snap());

  a.H.inputs.projQuery(/** @type {any} */ ({ value: 'meridian' }));
  await settle();

  eq(a.ui.projQuery, 'meridian');
  eq(JSON.stringify(a.snap()), before, 'the board is untouched');
});

test('Sorting cycles through direction and back to the default order', async () => {
  const a = await app();
  eq(a.ui.projSort, null, 'starts unsorted');

  a.H.clicks.projSort(null, '', 'value');
  eq(a.ui.projSort, 'value');
  eq(a.ui.projSortDir, 'desc', 'money starts highest first');

  a.H.clicks.projSort(null, '', 'value');
  eq(a.ui.projSortDir, 'asc', 'second click reverses');

  a.H.clicks.projSort(null, '', 'value');
  eq(a.ui.projSort, null, 'third click returns to the work order');
});

test('Dates start soonest first rather than latest', async () => {
  const a = await app();
  a.H.clicks.projSort(null, '', 'due');
  eq(a.ui.projSortDir, 'asc');
});

test('Switching column starts that column afresh, not mid-cycle', async () => {
  const a = await app();
  a.H.clicks.projSort(null, '', 'value');
  a.H.clicks.projSort(null, '', 'value');     // now ascending
  a.H.clicks.projSort(null, '', 'due');

  eq(a.ui.projSort, 'due');
  eq(a.ui.projSortDir, 'asc', 'due opens on its own first direction');
});

test('A column name that is not sortable is refused', async () => {
  // It comes off the page, so it is checked rather than trusted.
  const a = await app();
  a.H.clicks.projSort(null, '', 'status');
  eq(a.ui.projSort, null);
});

test('Reset clears the search, both filters and the sort together', async () => {
  const a = await app();
  a.H.inputs.projQuery(/** @type {any} */ ({ value: 'meridian' }));
  a.H.edits.projFieldFilter(/** @type {any} */ ({ value: 'coatings' }));
  a.H.edits.projTypeFilter(/** @type {any} */ ({ value: 'trial' }));
  a.H.clicks.projSort(null, '', 'win');

  a.H.clicks.projReset();

  eq(a.ui.projQuery, '');
  eq(a.ui.projField, 'all');
  eq(a.ui.projType, 'all');
  eq(a.ui.projSort, null);
});

test('Reset leaves the sidebar person scope alone', async () => {
  // That is set outside this screen and applies to the whole board, so clearing it
  // from here would be reaching past what the button says it does.
  const a = await app();
  a.ui.person = 'Alex Morgan';
  a.H.clicks.projReset();
  eq(a.ui.person, 'Alex Morgan');
});

test('Editing Field and Project Type writes to the project', async () => {
  const a = await app();
  a.H.edits.projField(/** @type {any} */ ({
    dataset: { id: 'pr3' }, value: 'Sealants'
  }));
  a.H.edits.projType(/** @type {any} */ ({
    dataset: { id: 'pr3' }, value: 'Qualification'
  }));
  await settle();

  const p = a.snap().projects.find(function (x) { return x.id === 'pr3'; });
  eq(p.field, 'Sealants');
  eq(p.projectType, 'Qualification');
});

group('Fields and Project types grow as people type');

/** A project-page Field box, as the change event delivers it. */
function fieldBox(id, value) {
  return /** @type {any} */ ({ dataset: { id: id }, value: value });
}

function items(a, key) {
  const row = a.snap().settings[key];
  return (row && row.items) || [];
}

test('A new value is stored on the project and joins the list', async () => {
  const a = await app();
  const before = items(a, 'field').slice();
  notOk(before.indexOf('Polymers') >= 0, 'not there to begin with');

  a.H.edits.projField(fieldBox('pr3', 'Polymers'));
  await settle();

  eq(a.snap().projects.find(function (p) { return p.id === 'pr3'; }).field, 'Polymers');
  ok(items(a, 'field').indexOf('Polymers') >= 0, 'and the next person is offered it');
});

test('A different spelling adopts the list\'s and adds nothing', async () => {
  // Otherwise the list fragments into case variants of itself and each one hides
  // most of the rows behind the filter.
  const a = await app();
  const before = items(a, 'field').length;

  const el = fieldBox('pr3', '  COATINGS  ');
  a.H.edits.projField(el);
  await settle();

  eq(a.snap().projects.find(function (p) { return p.id === 'pr3'; }).field, 'Coatings');
  eq(items(a, 'field').length, before, 'the list did not grow');
  eq(el.value, 'Coatings', 'and the box was corrected on screen');
});

test('Clearing the box clears the project and leaves the list alone', async () => {
  const a = await app();
  const before = items(a, 'field').length;

  a.H.edits.projField(fieldBox('pr1', '   '));
  await settle();

  eq(a.snap().projects.find(function (p) { return p.id === 'pr1'; }).field, '');
  eq(items(a, 'field').length, before);
});

test('Project Type behaves the same way', async () => {
  const a = await app();
  a.H.edits.projType(fieldBox('pr3', 'Scale-up'));
  await settle();

  eq(a.snap().projects.find(function (p) { return p.id === 'pr3'; }).projectType,
    'Scale-up');
  ok(items(a, 'projectType').indexOf('Scale-up') >= 0);
});

test('The Add form on the settings screen cannot create a case variant either', async () => {
  // The one door that does not go via a project. An exact-match de-dupe would let
  // "coatings" in beside "Coatings", which is the fragmentation this prevents.
  const a = await app();
  const before = items(a, 'field').length;

  a.H.forms.fieldVal(fields([['value', 'coatings']]));
  await settle();

  eq(items(a, 'field').length, before, 'no second entry');
});

test('The project write and the list growth are two calls, never a batch', async () => {
  /*
   * Structural, and worth it. store.batch reports a failure against ONE collection -
   * commit(ops, ops[0].col) - and a refusal marks that whole permission AREA
   * read-only. A projects-led batch refused because this person cannot write
   * settings would mark `content` read-only, and the board would stop being editable
   * because a list could not grow.
   *
   * The consequence is severe and awkward to provoke, so the decision is pinned here
   * instead.
   */
  const a = await app();
  let batches = 0;
  let updates = 0;
  let sets = 0;

  const realBatch = a.store.batch;
  const realUpdate = a.store.update;
  const realSet = a.store.set;
  a.store.batch = function () { batches++; return realBatch.apply(a.store, arguments); };
  a.store.update = function () { updates++; return realUpdate.apply(a.store, arguments); };
  a.store.set = function () { sets++; return realSet.apply(a.store, arguments); };

  a.H.edits.projField(fieldBox('pr3', 'Polymers'));
  await settle();

  eq(batches, 0, 'not batched');
  eq(updates, 1, 'one write to the project');
  eq(sets, 1, 'one write to the list, on its own');
});

test('Somebody who cannot write the lists still gets their project saved', async () => {
  /*
   * The value is stored and still reaches everyone through the suggestions, because
   * those union in what is already in use - it just never joins the curated list.
   *
   * Firing the write anyway would be worse than skipping it: a refusal calls
   * reload(), which replaces the snapshot and can land before the project write is
   * acknowledged, so the person watches their edit revert for an unrelated reason.
   */
  const a = await app();
  a.store.canWrite = function (col) { return col !== 'settings'; };
  const before = items(a, 'field').length;

  a.H.edits.projField(fieldBox('pr3', 'Polymers'));
  await settle();

  eq(a.snap().projects.find(function (p) { return p.id === 'pr3'; }).field, 'Polymers',
    'the project is saved');
  eq(items(a, 'field').length, before, 'and the list was left alone');
});

group('Renaming a list value through the handlers');

test('It renames the entry and every project using it, with undo', async () => {
  const a = await app();
  a.H.edits.projField(fieldBox('pr3', 'Coatngs'));
  await settle();
  ok(items(a, 'field').indexOf('Coatngs') >= 0, 'the typo is now shared vocabulary');

  a.H.forms.renameListValue(fields([['value', 'Coatings']]),
    /** @type {any} */ ({ dataset: { key: 'field', v: 'Coatngs' } }));
  await settle();

  eq(a.snap().projects.find(function (p) { return p.id === 'pr3'; }).field, 'Coatings');
  notOk(items(a, 'field').indexOf('Coatngs') >= 0, 'the typo is gone from the list');

  await a.store.undo();
  eq(a.snap().projects.find(function (p) { return p.id === 'pr3'; }).field, 'Coatngs',
    'and undo puts it all back');
});

test('It closes the editor', async () => {
  const a = await app({ open: 'listval:field:Coatings' });
  a.H.forms.renameListValue(fields([['value', 'Ceramics']]),
    /** @type {any} */ ({ dataset: { key: 'field', v: 'Coatings' } }));
  await settle();
  eq(a.ui.open, null);
});

test('Opening the editor targets one value on one list', async () => {
  const a = await app();
  a.H.clicks.editListVal(
    /** @type {any} */ ({ dataset: { key: 'field' } }), '', 'Coatings');
  eq(a.ui.open, 'listval:field:Coatings');
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
