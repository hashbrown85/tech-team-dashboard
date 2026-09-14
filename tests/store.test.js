// @ts-check
/**
 * Tests for the store.
 *
 * The one that matters most is "two quick edits" below: it is the regression test
 * for the silent data-loss bug that appears the moment realtime updates go away.
 * Everything else here is about staying in step with the backing store, and about
 * what happens when a write is refused.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { createStore, applyToSnapshot } from '../src/store.js';
import { createMemoryAdapter } from '../src/data/memoryAdapter.js';
import { blankSnapshot, memoryKeyFor, areaOf, describeWriteFailure } from '../src/data/DataStore.js';
import { deleteProject } from '../src/domain/cascade.js';

const MEETING = '2026-09-14';

function seed() {
  return {
    people: [{ id: 'p1', name: 'First Person', title: 'Lead', home: 'North' }],
    tabs: [{ id: 't1', name: 'North Area', kind: 'area', weekday: 1, lengthMin: 60,
             members: ['p1'], support: [], optional: [] }],
    entries: [],
    projects: [{ id: 'pr1', tab: 't1', personId: 'p1', name: 'a project',
                 status: 'on', due: '', added: MEETING }],
    issues: [],
    actions: [{ id: 'a1', num: 1, tab: 't1', text: 'do it', owner: 'First Person',
                support: '', due: MEETING, status: 'open',
                parent: { type: 'project', id: 'pr1' }, meeting: MEETING }],
    meetings: { 't1|2026-09-14': { ratings: { p1: 4 }, note: 'a note' } },
    settings: { chemistries: { items: ['one', 'two'] } }
  };
}

/** A store over a fresh in-memory adapter, already loaded. */
async function ready(options) {
  const messages = [];
  let renders = 0;
  const adapter = createMemoryAdapter(Object.assign({ seed: seed() }, options || {}));
  const store = createStore(adapter, {
    onMessage: (m) => messages.push(m),
    onChange: () => { renders++; }
  });
  await store.load();
  return { store, adapter, messages, renders: () => renders };
}

/* ---------- the bug this file exists for ---------- */

group('The lost-update bug');

test('Two quick edits to the same record BOTH survive', async () => {
  // This is the regression test. The original app did read-modify-write against a
  // local copy kept fresh by a live subscription. Without realtime, the second edit
  // would read a stale copy and write it over the first - silently.
  //
  // Both edits happen here without awaiting in between, which is exactly what two
  // fast clicks look like.
  const { store, adapter } = await ready();

  const first = store.mutate('projects', 'pr1', (p) => { p.estValue = 50000; });
  const second = store.mutate('projects', 'pr1', (p) => { p.winPct = 60; });
  await Promise.all([first, second]);

  const stored = adapter._peek().projects.find((p) => p.id === 'pr1');
  eq(stored.estValue, 50000, 'the first edit must not be clobbered');
  eq(stored.winPct, 60, 'and the second must land too');
  eq(stored.name, 'a project', 'with the rest of the record intact');
});

test('Three edits in a row all survive', async () => {
  const { store, adapter } = await ready();

  await Promise.all([
    store.mutate('projects', 'pr1', (p) => { p.estValue = 1; }),
    store.mutate('projects', 'pr1', (p) => { p.winPct = 2; }),
    store.mutate('projects', 'pr1', (p) => { p.winReason = 'three'; })
  ]);

  const stored = adapter._peek().projects.find((p) => p.id === 'pr1');
  eq([stored.estValue, stored.winPct, stored.winReason], [1, 2, 'three']);
});

test('A write shows up locally before the adapter has finished', async () => {
  // This is what makes the UI feel instant, and it is the same mechanism that keeps
  // the local copy current.
  const { store } = await ready();

  const pending = store.set('issues', 'i9', {
    tab: 't1', personId: 'p1', text: 'brand new', sev: 'risk',
    status: 'open', meeting: MEETING, rank: 1
  });

  eq(store.snapshot().issues.length, 1, 'visible immediately, not after the await');
  await pending;
  eq(store.snapshot().issues.length, 1, 'and still there afterwards');
});

test('mutate gives the mutator a copy with no id, and stores what it leaves', async () => {
  const { store, adapter } = await ready();
  let seenId = 'not checked';

  await store.mutate('projects', 'pr1', (p) => {
    seenId = 'id' in p ? 'present' : 'absent';
    p.status = 'hold';
  });

  eq(seenId, 'absent', 'the id is not part of the document body');
  eq(adapter._peek().projects.find((p) => p.id === 'pr1').status, 'hold');
  eq(store.snapshot().projects.find((p) => p.id === 'pr1').id, 'pr1',
    'but the local record still has its id');
});

test('mutating something that is not there does nothing', async () => {
  const { store, adapter } = await ready();
  await store.mutate('projects', 'nope', (p) => { p.status = 'off'; });
  eq(adapter._peek().projects.length, 1);
});

/* ---------- loading ---------- */

group('Loading and status');

test('It starts empty and connecting, then goes live', async () => {
  const adapter = createMemoryAdapter({ seed: seed() });
  const store = createStore(adapter, {});

  eq(store.snapshot().projects, [], 'nothing before the first load');
  eq(store.modes(), { content: 'connecting', settings: 'connecting' });

  await store.load();

  eq(store.modes(), { content: 'live', settings: 'live' });
  eq(store.snapshot().projects.length, 1);
});

test('Both spellings of the meeting key survive a load', async () => {
  const { store } = await ready();
  eq(Object.keys(store.snapshot().meetings), ['t1|2026-09-14']);
});

test('A failed load leaves the board read-only and says so', async () => {
  const adapter = createMemoryAdapter({ seed: seed() });
  adapter.load = () => Promise.reject({ code: 'offline' });
  const messages = [];
  const store = createStore(adapter, { onMessage: (m) => messages.push(m) });

  let threw = false;
  await store.load().catch(() => { threw = true; });

  ok(threw, 'the caller learns it failed');
  eq(store.modes(), { content: 'readonly', settings: 'readonly' });
  ok(messages[0].indexOf('load the board') > 0);
});

test('Refreshing picks up a change made somewhere else', async () => {
  const { store, adapter } = await ready();

  adapter._pushExternalChange((data) => {
    data.projects.push({ id: 'pr2', tab: 't1', personId: 'p1', name: 'from elsewhere',
                         status: 'on', added: MEETING });
  });
  eq(store.snapshot().projects.length, 1, 'not seen yet - no realtime');

  await store.refresh();
  eq(store.snapshot().projects.length, 2, 'seen after a refresh');
});

/* ---------- refused writes ---------- */

group('When a write is refused');

test('A denied content write turns that area read-only and reverts', async () => {
  const { store, messages } = await ready({
    failWrites: (op) => (op.col === 'issues' ? { code: 'denied' } : null)
  });

  await store.set('issues', 'i9', { tab: 't1', text: 'nope', status: 'open' });

  eq(store.modes().content, 'readonly');
  eq(store.modes().settings, 'live', 'the other area is unaffected');
  ok(messages.some((m) => m.indexOf('view-only') >= 0));
  eq(store.snapshot().issues.length, 0, 'the local copy is put back in step');
});

test('A denied settings write reports the owner-only message', async () => {
  const { store, messages } = await ready({
    failWrites: (op) => (op.col === 'people' ? { code: 'denied' } : null)
  });

  await store.set('people', 'p2', { name: 'Someone New' });

  eq(store.modes().settings, 'readonly');
  eq(store.modes().content, 'live');
  ok(messages.some((m) => m.indexOf('board owner') >= 0));
});

test('canWrite reflects what we have learned', async () => {
  const { store } = await ready({
    failWrites: (op) => (op.col === 'projects' ? { code: 'denied' } : null)
  });

  ok(store.canWrite('projects'));
  await store.mutate('projects', 'pr1', (p) => { p.status = 'off'; });

  notOk(store.canWrite('projects'), 'content is read-only now');
  notOk(store.canWrite('issues'), 'and so is the rest of the content area');
  ok(store.canWrite('people'), 'but settings is untouched');
});

test('Rate limiting is reported without going read-only', async () => {
  const { store, messages } = await ready({
    failWrites: () => ({ code: 'rate_limit' })
  });

  await store.set('issues', 'i9', { tab: 't1', text: 'x' });

  eq(store.modes().content, 'live', 'a temporary problem is not a permission problem');
  ok(messages.some((m) => m.indexOf('Too many changes') >= 0));
});

test('An unrecognised failure still tells the user something', async () => {
  const { store, messages } = await ready({ failWrites: () => ({ code: 'weird' }) });
  await store.set('issues', 'i9', { tab: 't1', text: 'x' });
  ok(messages.some((m) => m.indexOf('Please try again') >= 0));
});

/* ---------- cascades and undo ---------- */

group('Cascades and undo through the store');

test('A cascade applies, reports, and can be undone', async () => {
  const { store, adapter, messages } = await ready();

  await store.runCascade(deleteProject(store.snapshot(), 'pr1'));

  eq(adapter._peek().projects.length, 0, 'the project is gone');
  eq(adapter._peek().actions[0].parent, null, 'its action survives, detached');
  ok(messages.some((m) => m.indexOf('stay in the list') > 0));
  ok(store.hasUndo());

  await store.undo();

  const back = adapter._peek();
  eq(back.projects.length, 1, 'restored');
  eq(back.projects[0].id, 'pr1', 'under its original id');
  eq(back.actions[0].parent, { type: 'project', id: 'pr1' }, 'and reattached');
  notOk(store.hasUndo(), 'the undo is spent');
});

test('Undo with nothing to undo is harmless', async () => {
  const { store } = await ready();
  notOk(store.hasUndo());
  await store.undo();
});

test('Only the most recent undo is kept', async () => {
  const { store } = await ready();

  await store.runCascade(deleteProject(store.snapshot(), 'pr1'));
  await store.remove('actions', 'a1');
  store.clearUndo();

  notOk(store.hasUndo());
});

test('An empty cascade does nothing at all', async () => {
  const { store, adapter } = await ready();
  const before = adapter._peek();
  await store.runCascade(deleteProject(store.snapshot(), 'does-not-exist'));
  eq(adapter._peek(), before);
});

/* ---------- batching ---------- */

group('Batching');

test('A batch is one adapter call when the adapter supports it', async () => {
  const { store, adapter } = await ready();
  let batches = 0;
  const realBatch = adapter.batch;
  adapter.batch = (ops) => { batches++; return realBatch(ops); };

  await store.batch([
    { op: 'update', col: 'projects', id: 'pr1', patch: { status: 'off' } },
    { op: 'update', col: 'actions', id: 'a1', patch: { due: '2026-10-01' } }
  ]);

  eq(batches, 1);
  eq(adapter._peek().projects[0].status, 'off');
  eq(adapter._peek().actions[0].due, '2026-10-01');
});

test('Without batch support the writes go one at a time, in order', async () => {
  const adapter = createMemoryAdapter({ seed: seed() });
  adapter.capabilities = { realtime: false, batch: false, llm: false };
  const order = [];
  adapter.update = ((orig) => (col, id, patch) => {
    order.push(col + '/' + id);
    return orig(col, id, patch);
  })(adapter.update);

  const store = createStore(adapter, {});
  await store.load();
  await store.batch([
    { op: 'update', col: 'projects', id: 'pr1', patch: { status: 'off' } },
    { op: 'update', col: 'actions', id: 'a1', patch: { due: '2026-10-01' } }
  ]);

  eq(order, ['projects/pr1', 'actions/a1'], 'order preserved');
});

/* ---------- realtime, when an adapter has it ---------- */

group('Realtime, where available');

test('An external change arrives without a refresh', async () => {
  const adapter = createMemoryAdapter({ seed: seed(), realtime: true });
  let renders = 0;
  const store = createStore(adapter, { onChange: () => { renders++; } });
  await store.load();
  store.startWatching({ window: null });

  adapter._pushExternalChange((data) => {
    data.issues.push({ id: 'i9', tab: 't1', text: 'from elsewhere', status: 'open', rank: 1 });
  });

  eq(store.snapshot().issues.length, 1, 'no refresh needed');
  ok(renders > 0);
  store.stopWatching({ window: null });
});

test('Watching a non-realtime adapter is a no-op, not an error', async () => {
  const { store } = await ready();
  eq(store.capabilities().realtime, false);
  store.startWatching({ window: null });
  store.stopWatching({ window: null });
});

/* ---------- the snapshot helper ---------- */

group('applyToSnapshot');

test('It handles arrays and keyed collections alike', () => {
  const snap = blankSnapshot();

  applyToSnapshot(snap, { op: 'set', col: 'projects', id: 'pr1', data: { name: 'one' } });
  eq(snap.projects, [{ id: 'pr1', name: 'one' }], 'id added to array records');

  applyToSnapshot(snap, { op: 'update', col: 'projects', id: 'pr1', patch: { status: 'off' } });
  eq(snap.projects[0].status, 'off');

  applyToSnapshot(snap, { op: 'set', col: 'meetings', id: 't1@2026-09-14',
                          data: { ratings: {}, note: 'hi' } });
  eq(Object.keys(snap.meetings), ['t1|2026-09-14'], 'stored id becomes the memory key');

  applyToSnapshot(snap, { op: 'remove', col: 'projects', id: 'pr1' });
  eq(snap.projects, []);
});

test('Updating a record that is not there does nothing', () => {
  const snap = blankSnapshot();
  applyToSnapshot(snap, { op: 'update', col: 'projects', id: 'nope', patch: { x: 1 } });
  eq(snap.projects, []);
});

test('A document body never keeps an inner id', () => {
  const snap = blankSnapshot();
  applyToSnapshot(snap, { op: 'set', col: 'projects', id: 'pr1',
                          data: { id: 'WRONG', name: 'one' } });
  eq(snap.projects[0].id, 'pr1', 'the operation id wins');
});

/* ---------- the shared helpers ---------- */

group('Store helpers');

test('Only meetings have a different memory key', () => {
  eq(memoryKeyFor('meetings', 't1@2026-09-14'), 't1|2026-09-14');
  eq(memoryKeyFor('projects', 'pr1'), 'pr1');
  eq(memoryKeyFor('meetings', 'no-at-sign'), 'no-at-sign', 'left alone if malformed');
});

test('The permission split matches the one in the original code', () => {
  ['people', 'tabs', 'settings'].forEach((c) => eq(areaOf(c), 'settings', c));
  ['entries', 'projects', 'issues', 'actions', 'meetings'].forEach((c) => eq(areaOf(c), 'content', c));
});

test('Only a refusal turns an area read-only', () => {
  eq(describeWriteFailure('issues', { code: 'denied' }).readonly, true);
  eq(describeWriteFailure('issues', { code: 'rate_limit' }).readonly, false);
  eq(describeWriteFailure('issues', { code: 'full' }).readonly, false);
  eq(describeWriteFailure('issues', null).readonly, false);
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
