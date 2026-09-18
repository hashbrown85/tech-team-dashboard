// @ts-check
/**
 * One set of tests, run against EVERY adapter.
 *
 * This is the file that makes swapping the backing store safe. The contract in
 * DataStore.js is prose; this turns it into something that fails. Any new adapter
 * gets added to the list at the bottom and inherits every check.
 *
 * The three requirements that break things silently are all here:
 *   - a `set` writes the id it is given (undo depends on it)
 *   - action numbers are gapless and unique (they get read aloud in meetings)
 *   - `load` returns the app's shape, not the store's
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createLocalAdapter } from '../src/adapters/localAdapter.js';
import { fakeStorage } from './fakeStorage.js';
import { createGraphAdapter } from '../src/adapters/graphAdapter.js';
import { createFakeGraph } from './fakeGraph.js';
import { blankSnapshot } from '../src/adapters/DataStore.js';
import { createStore } from '../src/store.js';
import { demoBoard } from '../src/demo-data.js';
import { SCHEMA, KEY_COLUMN, toFields } from '../src/adapters/sharepointSchema.js';
import { deleteTab, deleteProject } from '../src/domain/cascade.js';

/* ------------------------------------------------------------ the adapters */

/** Seed the fake Graph's lists from a board snapshot, as a real import would. */
function seedGraphFrom(snap) {
  const seed = {};
  Object.keys(SCHEMA).forEach(function (col) {
    const listName = SCHEMA[col].list;
    seed[listName] = [];
    if (col === 'meetings') {
      Object.keys(snap.meetings).forEach(function (memKey) {
        const at = memKey.indexOf('|');
        const storedId = memKey.slice(0, at) + '@' + memKey.slice(at + 1);
        seed[listName].push(toFields('meetings', storedId, snap.meetings[memKey]));
      });
    } else if (col === 'settings') {
      Object.keys(snap.settings).forEach(function (k) {
        seed[listName].push(toFields('settings', k, snap.settings[k]));
      });
    } else {
      snap[col].forEach(function (rec) {
        seed[listName].push(toFields(col, rec.id, rec));
      });
    }
  });
  return seed;
}

/** Each entry builds a fresh adapter, optionally seeded with a board. */
const ADAPTERS = [
  {
    name: 'memory',
    make: function (snap) {
      return createMemoryAdapter({ seed: snap || blankSnapshot(), startActionNum: 1 });
    }
  },
  {
    name: 'local',
    make: function (snap) {
      // A fresh store each time, so the seed is what the adapter starts from.
      return createLocalAdapter({
        storage: fakeStorage(), seed: snap || blankSnapshot()
      });
    }
  },
  {
    name: 'graph',
    make: function (snap) {
      const graph = createFakeGraph({ seed: snap ? seedGraphFrom(snap) : {} });
      const adapter = createGraphAdapter({
        siteId: 'contoso.sharepoint.com,site-guid,web-guid',
        getToken: async function () { return 'fake-token'; },
        fetch: graph.fetch,
        wait: async function () {}   // no real waiting in tests
      });
      /** @type {any} */ (adapter)._graph = graph;
      return adapter;
    }
  }
];

/* ------------------------------------------------------------- the checks */

ADAPTERS.forEach(function (impl) {
  group('Contract: ' + impl.name);

  test('[' + impl.name + '] An empty store loads an empty board of the right shape', async () => {
    const a = impl.make();
    const snap = await a.load();
    eq(snap.people, []);
    eq(snap.actions, []);
    eq(snap.meetings, {}, 'meetings is a keyed object, not an array');
    eq(snap.settings, {}, 'and so is settings');
  });

  test('[' + impl.name + '] A set writes at the id it is given', async () => {
    // The requirement undo depends on. A store that assigns its own ids fails here.
    const a = impl.make();
    await a.set('projects', 'my-own-id', {
      tab: 't1', personId: 'p1', name: 'A project', status: 'on'
    });

    const snap = await a.load();
    eq(snap.projects.length, 1);
    eq(snap.projects[0].id, 'my-own-id', 'the app id survived the round trip');
    eq(snap.projects[0].name, 'A project');
  });

  test('[' + impl.name + '] Setting the same id twice replaces rather than duplicates', async () => {
    const a = impl.make();
    await a.set('issues', 'i1', { tab: 't1', text: 'first', status: 'open', rank: 1 });
    await a.set('issues', 'i1', { tab: 't1', text: 'second', status: 'open', rank: 2 });

    const snap = await a.load();
    eq(snap.issues.length, 1, 'still one record');
    eq(snap.issues[0].text, 'second');
  });

  test('[' + impl.name + '] An update merges and leaves other fields alone', async () => {
    const a = impl.make();
    await a.set('projects', 'pr1', {
      tab: 't1', personId: 'p1', name: 'Keep me', status: 'on', note: 'Keep this too'
    });
    await a.update('projects', 'pr1', { status: 'off', rank: 1000 });

    const snap = await a.load();
    const p = snap.projects[0];
    eq(p.status, 'off', 'the patched field changed');
    eq(p.rank, 1000, 'a new field was added');
    eq(p.name, 'Keep me', 'and an untouched field survived');
    eq(p.note, 'Keep this too');
  });

  test('[' + impl.name + '] A remove removes, and is harmless when repeated', async () => {
    const a = impl.make();
    await a.set('actions', 'a1', { num: 1, tab: 't1', text: 'x', status: 'open' });
    await a.remove('actions', 'a1');
    eq((await a.load()).actions, []);
    await a.remove('actions', 'a1');  // must not throw
    eq((await a.load()).actions, []);
  });

  test('[' + impl.name + '] Arrays survive the round trip', async () => {
    const a = impl.make();
    await a.set('tabs', 't1', {
      name: 'North', kind: 'area', weekday: 1, lengthMin: 60,
      members: ['p1', 'p2'], support: [], optional: ['p3']
    });

    const t = (await a.load()).tabs[0];
    eq(t.members, ['p1', 'p2']);
    eq(t.support, [], 'an empty array stays an empty array');
    eq(t.optional, ['p3']);
  });

  test('[' + impl.name + '] The polymorphic action parent survives', async () => {
    const a = impl.make();
    await a.set('actions', 'a1', {
      num: 1, tab: 't1', text: 'on an issue', owner: 'X', status: 'open',
      parent: { type: 'issue', id: 'i7' }
    });
    await a.set('actions', 'a2', {
      num: 2, tab: 't1', text: 'unattached', owner: 'X', status: 'open', parent: null
    });

    const snap = await a.load();
    const a1 = snap.actions.find(function (x) { return x.id === 'a1'; });
    const a2 = snap.actions.find(function (x) { return x.id === 'a2'; });
    eq(a1.parent, { type: 'issue', id: 'i7' });
    eq(a2.parent, null, 'an unattached action reads back as null, not undefined');
  });

  test('[' + impl.name + '] Detaching a parent actually clears it', async () => {
    // rule 7: deleting a project orphans its actions rather than deleting them.
    const a = impl.make();
    await a.set('actions', 'a1', {
      num: 1, tab: 't1', text: 'x', owner: 'X', status: 'open',
      parent: { type: 'project', id: 'pr1' }
    });
    await a.update('actions', 'a1', { parent: null });

    eq((await a.load()).actions[0].parent, null);
  });

  test('[' + impl.name + '] The meeting composite key round-trips', async () => {
    const a = impl.make();
    await a.set('meetings', 't1@2026-09-14', { ratings: { p1: 4, p2: 5 }, note: 'go faster' });

    const snap = await a.load();
    eq(Object.keys(snap.meetings), ['t1|2026-09-14'], 'stored with @, held with |');
    eq(snap.meetings['t1|2026-09-14'].ratings, { p1: 4, p2: 5 });
    eq(snap.meetings['t1|2026-09-14'].note, 'go faster');
  });

  test('[' + impl.name + '] Settings documents round-trip by their own key', async () => {
    const a = impl.make();
    await a.set('settings', 'focus', { items: ['Corrosion', 'Pipeline'] });

    const snap = await a.load();
    eq(Object.keys(snap.settings), ['focus']);
    eq(snap.settings.focus.items, ['Corrosion', 'Pipeline']);
  });

  test('[' + impl.name + '] Action numbers are unique and gapless', async () => {
    // They get read aloud in meetings, so a gap or a repeat is a real problem.
    const a = impl.make();
    const nums = [];
    for (let i = 0; i < 5; i++) nums.push(await a.nextActionNum());

    eq(nums, [1, 2, 3, 4, 5]);
    eq(new Set(nums).size, 5, 'no repeats');
  });

  test('[' + impl.name + '] Concurrent action numbers do not collide', async () => {
    const a = impl.make();
    const nums = await Promise.all([
      a.nextActionNum(), a.nextActionNum(), a.nextActionNum()
    ]);
    eq(new Set(nums).size, 3, 'three requests, three different numbers: ' + nums.join(','));
  });

  test('[' + impl.name + '] newId gives a fresh id each time', async () => {
    const a = impl.make();
    const ids = [a.newId(), a.newId(), a.newId()];
    eq(new Set(ids).size, 3);
    ok(ids.every(function (x) { return typeof x === 'string' && x.length > 3; }));
  });

  test('[' + impl.name + '] A batch applies every operation', async () => {
    const a = impl.make();
    await a.set('projects', 'pr1', { tab: 't1', name: 'one', status: 'on' });
    await a.set('projects', 'pr2', { tab: 't1', name: 'two', status: 'on' });

    await a.batch([
      { op: 'update', col: 'projects', id: 'pr1', patch: { status: 'off' } },
      { op: 'remove', col: 'projects', id: 'pr2' },
      { op: 'set', col: 'issues', id: 'i1', data: { tab: 't1', text: 'new', status: 'open', rank: 1 } }
    ]);

    const snap = await a.load();
    eq(snap.projects.length, 1);
    eq(snap.projects[0].status, 'off');
    eq(snap.issues.length, 1, 'a create inside a batch works too');
    eq(snap.issues[0].id, 'i1', 'and keeps its given id');
  });

  test('[' + impl.name + '] Absent optional fields stay absent, not empty strings', async () => {
    // The app asks `"prevStatus" in project`, so '' and absent are different.
    const a = impl.make();
    await a.set('projects', 'pr1', { tab: 't1', name: 'x', status: 'on' });

    const p = (await a.load()).projects[0];
    notOk('prevStatus' in p, 'prevStatus was never set, so it must not appear');
    notOk('rank' in p, 'nor rank');
  });

  test('[' + impl.name + '] A number of zero survives as zero', async () => {
    const a = impl.make();
    await a.set('projects', 'pr1', {
      tab: 't1', name: 'x', status: 'on', rank: 0, winPct: 0
    });
    await a.set('projectDetails', 'pr1', { estValue: 0 });

    const snap = await a.load();
    eq(snap.projects[0].rank, 0, 'zero is a real value, not absence');
    eq(snap.projects[0].winPct, 0, 'nor is a confidence of zero');
    eq(snap.projectDetails[0].estValue, 0);
  });

  test('[' + impl.name + '] The autoResolved flag round-trips as a boolean', async () => {
    const a = impl.make();
    await a.set('issues', 'i1', {
      tab: 't1', text: 'x', status: 'resolved', rank: 1, autoResolved: true
    });
    await a.set('issues', 'i2', { tab: 't1', text: 'y', status: 'open', rank: 2 });

    const snap = await a.load();
    eq(snap.issues.find(function (i) { return i.id === 'i1'; }).autoResolved, true);
    notOk('autoResolved' in snap.issues.find(function (i) { return i.id === 'i2'; }),
      'and is absent rather than false when unset');
  });


  test('[' + impl.name + '] Project notes round-trip, timestamps and all', async () => {
    const a = impl.make();
    await a.set('projectNotes', 'n1', {
      projectId: 'pr1', text: 'Samples shipped', authorId: 'p1',
      created: '2026-09-16T14:32:05.000Z'
    });
    await a.set('projectNotes', 'n2', {
      projectId: 'pr1', text: 'Corrected', authorId: 'p1',
      created: '2026-09-16T14:32:05.000Z', edited: '2026-09-16T16:00:00.000Z'
    });

    const snap = await a.load();
    const n1 = snap.projectNotes.find(function (n) { return n.id === 'n1'; });
    const n2 = snap.projectNotes.find(function (n) { return n.id === 'n2'; });

    eq(n1.created, '2026-09-16T14:32:05.000Z', 'the instant survives exactly');
    notOk('edited' in n1, 'an unedited note has no edited stamp');
    eq(n2.edited, '2026-09-16T16:00:00.000Z');
    eq(n1.authorId, 'p1');
  });

  test('[' + impl.name + '] A project carries its customer and mission', async () => {
    const a = impl.make();
    await a.set('projects', 'pr1', {
      tab: 't1', personId: 'p1', name: 'A project', status: 'on',
      customer: 'Meridian Coatings',
      field: 'Coatings',
      projectType: 'Trial',
      mission: 'Two lines.\nSecond line.'
    });

    const p = (await a.load()).projects[0];
    eq(p.customer, 'Meridian Coatings');
    eq(p.field, 'Coatings');
    eq(p.projectType, 'Trial');
    eq(p.mission, 'Two lines.\nSecond line.', 'multi-line text survives');
  });

  test('[' + impl.name + '] A whole demo board round-trips intact', async () => {
    const original = demoBoard();
    const a = impl.make(original);
    const snap = await a.load();

    eq(snap.people.length, original.people.length, 'people');
    eq(snap.tabs.length, original.tabs.length, 'meetings');
    eq(snap.projects.length, original.projects.length, 'projects');
    eq(snap.issues.length, original.issues.length, 'issues');
    eq(snap.actions.length, original.actions.length, 'actions');
    eq(snap.projectDetails.length, original.projectDetails.length, 'project details');
    eq(snap.projectNotes.length, original.projectNotes.length, 'project notes');
    eq(Object.keys(snap.meetings).length, Object.keys(original.meetings).length, 'meeting records');
    eq(Object.keys(snap.settings).length, Object.keys(original.settings).length, 'settings');

    // Spot-check the records with the fiddliest shapes.
    const pr2 = snap.projects.find(function (p) { return p.id === 'pr2'; });
    eq(pr2.prevStatus, 'on', 'project status history');
    eq(pr2.rank, 1000);
    const a1 = snap.actions.find(function (x) { return x.id === 'a1'; });
    eq(a1.parent, { type: 'project', id: 'pr2' }, 'action parent');
    const t1 = snap.tabs.find(function (t) { return t.id === 't1'; });
    eq(t1.members, ['p1', 'p2'], 'role arrays');
  });

  group('Through the store: ' + impl.name);

  test('[' + impl.name + '] The store works over this adapter', async () => {
    const a = impl.make(demoBoard());
    const store = createStore(a, {});
    await store.load();

    eq(store.modes(), { content: 'live', settings: 'live', details: 'live' });
    ok(store.snapshot().projects.length > 0);
  });

  test('[' + impl.name + '] Two quick edits both survive through the store', async () => {
    // The lost-update regression, re-checked against each backing store.
    const a = impl.make(demoBoard());
    const store = createStore(a, {});
    await store.load();

    await Promise.all([
      store.mutate('projects', 'pr1', function (p) { p.note = 'first'; }),
      store.mutate('projects', 'pr1', function (p) { p.rank = 42; })
    ]);

    const fresh = await a.load();
    const p = fresh.projects.find(function (x) { return x.id === 'pr1'; });
    eq(p.note, 'first', 'the first edit survived');
    eq(p.rank, 42, 'and so did the second');
  });

  test('[' + impl.name + '] A delete cascade and its undo both work', async () => {
    const a = impl.make(demoBoard());
    const store = createStore(a, {});
    await store.load();

    await store.runCascade(deleteProject(store.snapshot(), 'pr3'));
    let fresh = await a.load();
    notOk(fresh.projects.some(function (p) { return p.id === 'pr3'; }), 'project gone');
    eq(fresh.actions.find(function (x) { return x.id === 'a4'; }).parent, null, 'action detached');

    await store.undo();
    fresh = await a.load();
    ok(fresh.projects.some(function (p) { return p.id === 'pr3'; }), 'restored');
    eq(fresh.actions.find(function (x) { return x.id === 'a4'; }).parent,
      { type: 'project', id: 'pr3' }, 'and reattached');
  });

  test('[' + impl.name + '] Deleting a whole meeting removes everything under it', async () => {
    const a = impl.make(demoBoard());
    const store = createStore(a, {});
    await store.load();

    const cascade = deleteTab(store.snapshot(), 't1');
    ok(cascade.writes.length > 10, cascade.writes.length + ' writes');
    await store.runCascade(cascade);

    const fresh = await a.load();
    notOk(fresh.tabs.some(function (t) { return t.id === 't1'; }));
    notOk(fresh.entries.some(function (e) { return e.tab === 't1'; }));
    notOk(fresh.projects.some(function (p) { return p.tab === 't1'; }));
    notOk(fresh.issues.some(function (i) { return i.tab === 't1'; }));
    notOk(fresh.actions.some(function (x) { return x.tab === 't1'; }));
    notOk(Object.keys(fresh.meetings).some(function (k) { return k.indexOf('t1|') === 0; }));
    ok(fresh.tabs.some(function (t) { return t.id === 't2'; }), 'other meetings untouched');
  });
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
