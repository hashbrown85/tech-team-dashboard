// @ts-check
/**
 * The SharePoint-specific behaviour the shared contract tests cannot cover.
 *
 * adapterContract.test.js proves the adapter behaves like a DataStore. This file
 * proves it copes with the things SharePoint actually does: assigning its own ids,
 * throttling, half-failing a batch, and rejecting a stale write.
 *
 * All of it runs against tests/fakeGraph.js. None of it needs a tenant, which is the
 * point — when the real site exists, this is config, not code.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { createGraphAdapter } from '../src/adapters/graphAdapter.js';
import { createFakeGraph } from './fakeGraph.js';
import { createStore } from '../src/store.js';
import {
  SCHEMA, KEY_COLUMN, COUNTER_LIST, COUNTER_COLUMN, COUNTER_KEY,
  toFields, fromFields, columnsFor, SP_FIELD_TYPE
} from '../src/adapters/sharepointSchema.js';
import { areaOf } from '../src/adapters/DataStore.js';

const SITE = 'contoso.sharepoint.com,site-guid,web-guid';

/** An adapter over a fresh fake Graph. */
function make(options) {
  const graph = createFakeGraph(options || {});
  const adapter = createGraphAdapter({
    siteId: SITE,
    getToken: async function () { return 'fake-token'; },
    fetch: graph.fetch,
    wait: async function () {}
  });
  return { graph: graph, adapter: adapter };
}

/* ---------------------------------------------------------------- the ids */

group('Graph: the id problem');

test('A create lets SharePoint assign the item id, and remembers it', async () => {
  const { graph, adapter } = make();
  await adapter.set('projects', 'my-app-id', { tab: 't1', name: 'x', status: 'on' });

  const rows = graph.items(SCHEMA.projects.list);
  eq(rows.length, 1);
  eq(rows[0].fields[KEY_COLUMN], 'my-app-id', 'the app id went into the key column');
  ok(rows[0].id !== 'my-app-id', 'while SharePoint kept its own integer id: ' + rows[0].id);
});

test('A second write finds the same row instead of creating another', async () => {
  const { graph, adapter } = make();
  await adapter.set('projects', 'pr1', { tab: 't1', name: 'first', status: 'on' });
  const firstItemId = graph.items(SCHEMA.projects.list)[0].id;

  await adapter.set('projects', 'pr1', { tab: 't1', name: 'second', status: 'off' });
  const rows = graph.items(SCHEMA.projects.list);

  eq(rows.length, 1, 'no duplicate row');
  eq(rows[0].id, firstItemId, 'same SharePoint item');
  eq(rows[0].fields.ProjectName, 'second');
});

test('A record created by somebody else is found by key, not duplicated', async () => {
  // The map is built at load time. Anything created since has to be looked up.
  const { graph, adapter } = make();
  graph.seedList(SCHEMA.issues.list, [
    toFields('issues', 'i-from-elsewhere', { tab: 't1', text: 'theirs', status: 'open', rank: 1 })
  ]);

  await adapter.update('issues', 'i-from-elsewhere', { status: 'resolved' });

  const rows = graph.items(SCHEMA.issues.list);
  eq(rows.length, 1, 'found it rather than creating a second');
  eq(rows[0].fields.Status, 'resolved');
});

test('An id containing a quote does not break the lookup', async () => {
  // Naive string interpolation into an OData filter would produce a 400 here, and
  // the fake rejects malformed filters rather than shrugging.
  const { graph, adapter } = make();
  const awkward = "id-with-'-quote";
  await adapter.set('issues', awkward, { tab: 't1', text: 'x', status: 'open', rank: 1 });
  await adapter.update('issues', awkward, { status: 'resolved' });

  const rows = graph.items(SCHEMA.issues.list);
  eq(rows.length, 1);
  eq(rows[0].fields.Status, 'resolved');
});

test('Deleting forgets the mapping, so a later create makes a new row', async () => {
  const { graph, adapter } = make();
  await adapter.set('actions', 'a1', { num: 1, tab: 't1', text: 'x', status: 'open' });
  await adapter.remove('actions', 'a1');
  eq(graph.items(SCHEMA.actions.list).length, 0);

  await adapter.set('actions', 'a1', { num: 1, tab: 't1', text: 'again', status: 'open' });
  eq(graph.items(SCHEMA.actions.list).length, 1, 'recreated cleanly');
});

/* ---------------------------------------------------------------- reading */

group('Graph: reading');

test('It follows nextLink rather than stopping at the first page', async () => {
  // A board with real history is many pages. Assuming one page would silently
  // load a partial board, which is the worst kind of bug.
  const { graph, adapter } = make();
  const many = [];
  for (let i = 0; i < 450; i++) {
    many.push(toFields('entries', 'e' + i, {
      tab: 't1', meeting: '2026-09-14', personId: 'p1', kind: 'win', text: 'entry ' + i
    }));
  }
  graph.seedList(SCHEMA.entries.list, many);

  const snap = await adapter.load();
  eq(snap.entries.length, 450, 'every page was read');
});

test('A row with no key is skipped rather than loaded as a broken record', async () => {
  const { graph, adapter } = make();
  graph.seedList(SCHEMA.projects.list, [
    toFields('projects', 'pr1', { tab: 't1', name: 'good', status: 'on' }),
    { ProjectName: 'orphan with no key', Status: 'on' }
  ]);

  const snap = await adapter.load();
  eq(snap.projects.length, 1, 'the keyless row was ignored');
  eq(snap.projects[0].id, 'pr1');
});

test('Malformed JSON in a column does not take the board down', async () => {
  // Somebody will edit a list in the browser eventually.
  const { graph, adapter } = make();
  graph.seedList(SCHEMA.tabs.list, [
    Object.assign(toFields('tabs', 't1', {
      name: 'North', kind: 'area', weekday: 1, lengthMin: 60,
      members: ['p1'], support: [], optional: []
    }), { MembersJson: '{not json' })
  ]);

  const snap = await adapter.load();
  eq(snap.tabs.length, 1, 'the board still loads');
  notOk('members' in snap.tabs[0], 'the unreadable field is simply absent');
});

/* -------------------------------------------------------------- batching */

group('Graph: batching');

test('A cascade goes out in batches, not one request per write', async () => {
  const { graph, adapter } = make();
  const ops = [];
  for (let i = 0; i < 25; i++) {
    await adapter.set('entries', 'e' + i, {
      tab: 't1', meeting: '2026-09-14', personId: 'p1', kind: 'win', text: 'x'
    });
    ops.push({ op: 'remove', col: 'entries', id: 'e' + i });
  }

  graph.reset();
  await adapter.batch(ops);

  eq(graph.batchCount(), 2, '25 writes in two batches of at most 20');
  eq(graph.items(SCHEMA.entries.list).length, 0, 'and all of them applied');
});

test('A refusal inside a batch is reported as denied', async () => {
  const { adapter } = make({
    intercept: function (req) {
      if (req.method === 'PATCH') return { status: 403, body: { error: { message: 'nope' } } };
      return null;
    }
  });
  await adapter.set('projects', 'pr1', { tab: 't1', name: 'x', status: 'on' });

  let code = null;
  await adapter.batch([{ op: 'update', col: 'projects', id: 'pr1', patch: { status: 'off' } }])
    .catch(function (e) { code = e.code; });

  eq(code, 'denied', 'so the store turns that area read-only');
});

test('A half-failed batch reports the most serious problem', async () => {
  // A batch is not a transaction: one request can fail while others succeed. The
  // caller's undo is the only rollback, which is why cascade.js builds one.
  let seen = 0;
  const { adapter } = make({
    intercept: function (req) {
      if (req.method !== 'DELETE') return null;
      seen++;
      // Second delete is refused; the others go through.
      return seen === 2 ? { status: 403, body: { error: { message: 'no' } } } : null;
    }
  });
  for (const id of ['a1', 'a2', 'a3']) {
    await adapter.set('actions', id, { num: 1, tab: 't1', text: id, status: 'open' });
  }

  let code = null;
  await adapter.batch([
    { op: 'remove', col: 'actions', id: 'a1' },
    { op: 'remove', col: 'actions', id: 'a2' },
    { op: 'remove', col: 'actions', id: 'a3' }
  ]).catch(function (e) { code = e.code; });

  eq(code, 'denied', 'the refusal is reported, not the incidental failures');
});

test('Creates inside a batch happen individually, so their ids are captured', async () => {
  const { graph, adapter } = make();
  await adapter.batch([
    { op: 'set', col: 'issues', id: 'i1', data: { tab: 't1', text: 'one', status: 'open', rank: 1 } },
    { op: 'set', col: 'issues', id: 'i2', data: { tab: 't1', text: 'two', status: 'open', rank: 2 } }
  ]);

  const rows = graph.items(SCHEMA.issues.list);
  eq(rows.length, 2);
  eq(rows.map(function (r) { return r.fields[KEY_COLUMN]; }).sort(), ['i1', 'i2']);

  // And a following update must find them, which only works if the ids were kept.
  await adapter.update('issues', 'i1', { status: 'resolved' });
  eq(graph.items(SCHEMA.issues.list).length, 2, 'no duplicate created');
});

/* ------------------------------------------------------------ throttling */

group('Graph: throttling');

test('A 429 is retried, honouring Retry-After', async () => {
  let calls = 0;
  const waits = [];
  const graph = createFakeGraph({
    intercept: function (req) {
      if (req.method === 'POST' && req.url.indexOf('/items') >= 0) {
        calls++;
        if (calls === 1) return { status: 429, headers: { 'Retry-After': '3' } };
      }
      return null;
    }
  });
  const adapter = createGraphAdapter({
    siteId: SITE,
    getToken: async function () { return 't'; },
    fetch: graph.fetch,
    wait: async function (ms) { waits.push(ms); }
  });

  await adapter.set('projects', 'pr1', { tab: 't1', name: 'x', status: 'on' });

  eq(waits, [3000], 'waited the 3 seconds it was told to');
  eq(graph.items(SCHEMA.projects.list).length, 1, 'and the write landed on the retry');
});

test('Relentless throttling eventually gives up as rate_limit', async () => {
  const { adapter } = make({
    intercept: function () { return { status: 429, headers: { 'Retry-After': '1' } }; }
  });

  let code = null;
  await adapter.load().catch(function (e) { code = e.code; });
  eq(code, 'rate_limit', 'reported as temporary, so the board does not go read-only');
});

test('Status codes map onto the vocabulary the store understands', async () => {
  const cases = [[403, 'denied'], [401, 'denied'], [429, 'rate_limit'],
                 [503, 'rate_limit'], [507, 'full'], [400, 'failed']];

  for (const [status, expected] of cases) {
    const { adapter } = make({
      intercept: function () {
        return { status: status, headers: { 'Retry-After': '0' }, body: { error: { message: 'x' } } };
      }
    });
    let code = null;
    await adapter.load().catch(function (e) { code = e.code; });
    eq(code, expected, status + ' should read as ' + expected);
  }
});

/* -------------------------------------------- being refused a single list */

group('Graph: refused one list');

test('A 403 on project details empties that collection and loads everything else', async () => {
  // The whole point of splitting the sensitive fields out. Most of the team cannot
  // read project values, and that is a normal state - not a broken board.
  const { adapter } = make({
    intercept: function (req) {
      return req.url.indexOf(SCHEMA.projectDetails.list) >= 0
        ? { status: 403, body: { error: { message: 'no' } } }
        : null;
    }
  });

  const snap = await adapter.load();
  eq(snap.projectDetails, [], 'nothing arrived');
  eq(snap.denied, ['projectDetails'], 'and the app is told why');
  ok(Array.isArray(snap.projects), 'the rest of the board loaded normally');
});

test('The numbers are genuinely absent, not merely unrendered', async () => {
  // This is the assertion that proves it is a control rather than a hide: the
  // values never reach the browser at all.
  const seed = {};
  seed[SCHEMA.projectDetails.list] = [
    toFields('projectDetails', 'pr1', { estValue: 999999, winPct: 80 })
  ];
  const { adapter } = make({
    seed: seed,
    intercept: function (req) {
      return req.url.indexOf(SCHEMA.projectDetails.list) >= 0 ? { status: 403, body: {} } : null;
    }
  });

  const snap = await adapter.load();
  notOk(JSON.stringify(snap).indexOf('999999') >= 0, 'the figure is nowhere in what we received');
});

test('A refusal on any OTHER list still fails the load', async () => {
  // Being denied the roster is not a normal state; it means something is wrong
  // and quietly showing an empty board would be worse than failing.
  const { adapter } = make({
    intercept: function (req) {
      return req.url.indexOf(SCHEMA.people.list) >= 0 ? { status: 403, body: {} } : null;
    }
  });

  let code = null;
  await adapter.load().catch(function (e) { code = e.code; });
  eq(code, 'denied');
});

test('A non-403 failure on project details still fails the load', async () => {
  // Tolerating a refusal must not turn into swallowing every error.
  const { adapter } = make({
    intercept: function (req) {
      return req.url.indexOf(SCHEMA.projectDetails.list) >= 0 ? { status: 500, body: {} } : null;
    }
  });

  let failed = false;
  await adapter.load().catch(function () { failed = true; });
  ok(failed, 'a server error is not a permission decision');
});

/* --------------------------------------------------------- the counter */

group('Graph: the action counter');

test('It is created on first use and then counts up', async () => {
  const { graph, adapter } = make();

  eq(await adapter.nextActionNum(), 1);
  eq(await adapter.nextActionNum(), 2);
  eq(await adapter.nextActionNum(), 3);

  const rows = graph.items(COUNTER_LIST);
  eq(rows.length, 1, 'exactly one counter row');
  eq(Number(rows[0].fields[COUNTER_COLUMN]), 4, 'pointing at the next number');
});

test('It picks up from a provisioned counter row', async () => {
  const seed = {};
  seed[COUNTER_LIST] = [{ [KEY_COLUMN]: COUNTER_KEY, [COUNTER_COLUMN]: 48 }];
  const { adapter } = make({ seed: seed });

  eq(await adapter.nextActionNum(), 48, 'carries on where the board left off');
  eq(await adapter.nextActionNum(), 49);
});

test('A stale write is rejected and retried, so no number is issued twice', async () => {
  // Simulates another browser taking a number between our read and our write.
  const seed = {};
  seed[COUNTER_LIST] = [{ [KEY_COLUMN]: COUNTER_KEY, [COUNTER_COLUMN]: 10 }];
  const graph = createFakeGraph({ seed: seed });

  let firstPatch = true;
  const adapter = createGraphAdapter({
    siteId: SITE,
    getToken: async function () { return 't'; },
    fetch: async function (url, init) {
      const method = ((init && init.method) || 'GET').toUpperCase();
      if (method === 'PATCH' && String(url).indexOf(COUNTER_LIST) >= 0 && firstPatch) {
        firstPatch = false;
        // Somebody else wrote first: our ETag is now stale.
        graph.touch(COUNTER_LIST, COUNTER_KEY, KEY_COLUMN);
      }
      return graph.fetch(url, init);
    },
    wait: async function () {}
  });

  const num = await adapter.nextActionNum();
  ok(num >= 10, 'got a number: ' + num);
  const rows = graph.items(COUNTER_LIST);
  eq(rows.length, 1, 'still one counter row');
  ok(Number(rows[0].fields[COUNTER_COLUMN]) > num, 'and it advanced past what we took');
});

test('Two browsers reading the counter at once still get different numbers', async () => {
  // The case the ETag precondition exists for. Within one browser the adapter
  // queues its own requests, so this can only be reproduced with two adapters
  // sharing one site - which is exactly two people adding an action at once.
  //
  // The reads are forced to interleave: A reads, then B reads AND writes, then A
  // tries to write with an ETag that is now stale. Without If-Match, A would
  // happily write its stale value and both would return the same number.
  const seed = {};
  seed[COUNTER_LIST] = [{ [KEY_COLUMN]: COUNTER_KEY, [COUNTER_COLUMN]: 10 }];
  const graph = createFakeGraph({ seed: seed });

  let openGate = function () {};
  const gate = new Promise(function (resolve) { openGate = resolve; });
  let aHeldOnce = false;

  function adapterFor(holdFirstPatch) {
    return createGraphAdapter({
      siteId: SITE,
      getToken: async function () { return 't'; },
      wait: async function () {},
      fetch: async function (url, init) {
        const method = ((init && init.method) || 'GET').toUpperCase();
        const isCounterPatch = method === 'PATCH' && String(url).indexOf(COUNTER_LIST) >= 0;
        if (holdFirstPatch && isCounterPatch && !aHeldOnce) {
          aHeldOnce = true;
          await gate;            // let the other browser get in first
        }
        return graph.fetch(url, init);
      }
    });
  }

  const a = adapterFor(true);
  const b = adapterFor(false);

  const aNum = a.nextActionNum();
  // Give A time to read and reach its held PATCH before B starts.
  await new Promise(function (r) { setTimeout(r, 5); });
  const bNum = await b.nextActionNum();
  openGate();

  const nums = [await aNum, bNum];
  eq(new Set(nums).size, 2, 'two browsers, two numbers: ' + nums.join(','));
  eq(nums.slice().sort(function (x, y) { return x - y; }), [10, 11], 'and no number skipped');
  eq(graph.items(COUNTER_LIST).length, 1, 'still one counter row');
});

test('Numbers stay unique under a burst of concurrent requests', async () => {
  const { adapter } = make();
  const nums = await Promise.all([1, 2, 3, 4, 5, 6].map(function () {
    return adapter.nextActionNum();
  }));

  eq(new Set(nums).size, 6, 'six requests, six numbers: ' + nums.join(','));
  eq(nums.slice().sort(function (a, b) { return a - b; }), [1, 2, 3, 4, 5, 6], 'and no gaps');
});

/* --------------------------------------------------- through the store */

group('Graph: through the store');

test('A refused write turns the right area read-only', async () => {
  const messages = [];
  const { adapter } = make({
    intercept: function (req) {
      const isPeople = req.url.indexOf(SCHEMA.people.list) >= 0;
      return isPeople && req.method !== 'GET' ? { status: 403, body: {} } : null;
    }
  });
  const store = createStore(adapter, { onMessage: function (m) { messages.push(m); } });
  await store.load();

  await store.set('people', 'p9', { name: 'Someone' });

  eq(store.modes().settings, 'readonly');
  eq(store.modes().content, 'live', 'content is unaffected');
  ok(messages.some(function (m) { return m.indexOf('board owner') >= 0; }));
});

/* ---------------------------------------------------------- the schema */

group('The SharePoint schema');


test('Every list the provisioning script creates is named in a permissions group', () => {
  // This gap has already happened once: projectDetails - the sensitive list - was
  // created by the script and then mentioned in no group at all, so nobody was told
  // to protect it. The groups are derived from areaOf() now, and this asserts that
  // every schema collection really does land in one.
  const areas = Object.keys(SCHEMA).map(function (col) { return areaOf(col); });
  const unknown = areas.filter(function (a) {
    return ['settings', 'content', 'details'].indexOf(a) < 0;
  });

  eq(unknown, [], 'every collection belongs to a known permission area');
  eq(areas.length, Object.keys(SCHEMA).length, 'and every collection has one');
});

test('Working notes are team content, not restricted and not owner-only', () => {
  // They are commentary, not commercial figures. Anything that should not be
  // widely read belongs in projectDetails instead.
  eq(areaOf('projectNotes'), 'content');
});

test('Every column name is a single word', () => {
  // A column called "Estimated Value" gets an internal name like
  // Estimated_x0020_Value, and Graph will not tell you the internal names.
  const bad = [];
  Object.keys(SCHEMA).forEach(function (col) {
    columnsFor(col).forEach(function (c) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(c.name)) bad.push(col + '.' + c.name);
    });
  });
  eq(bad, [], 'no spaces or punctuation in any column name');
});

test('Every field kind has a SharePoint type', () => {
  const missing = [];
  Object.keys(SCHEMA).forEach(function (col) {
    columnsFor(col).forEach(function (c) {
      if (!SP_FIELD_TYPE[c.kind]) missing.push(col + '.' + c.name + ' (' + c.kind + ')');
    });
  });
  eq(missing, []);
});

test('Dates are stored as text, so no timezone can shift them', () => {
  eq(SP_FIELD_TYPE.date, 'Text',
    'a real DateTime column could come back a day out and file work against the wrong meeting');
});

test('No column is a Yes/No field', () => {
  // The Power BI SharePoint connector surfaces booleans inconsistently.
  const flags = [];
  Object.keys(SCHEMA).forEach(function (col) {
    columnsFor(col).forEach(function (c) {
      if (c.kind === 'flag' && SP_FIELD_TYPE[c.kind] !== 'Number') flags.push(col + '.' + c.name);
    });
  });
  eq(flags, [], 'flags are stored as numbers');
});

test('Field mapping round-trips every collection', () => {
  const samples = {
    people: { name: 'A', title: 'B', home: 'C', upn: 'a@example.com' },
    tabs: { name: 'N', kind: 'area', weekday: 3, lengthMin: 45,
            members: ['p1'], support: [], optional: ['p2'] },
    entries: { tab: 't1', meeting: '2026-09-14', personId: 'p1', kind: 'loss',
               text: 'x', why: 'y', change: 'z' },
    projects: { tab: 't1', personId: 'p1', name: 'P', status: 'off', rank: 1000 },
    projectDetails: { estValue: 1000, winPct: 0, winReason: 'R',
                      resources: ['Rheometer'], chemistries: [] },
    issues: { tab: 't1', personId: 'p1', text: 'x', sev: 'stopper', status: 'resolved',
              meeting: '2026-09-14', rank: 0.5, autoResolved: true },
    actions: { num: 7, tab: 't1', text: 'x', owner: 'O', support: 'S', due: '2026-09-21',
               status: 'open', parent: { type: 'issue', id: 'i1' }, meeting: '2026-09-14' },
    meetings: { ratings: { p1: 4 }, note: 'n' },
    settings: { items: ['a', 'b'] }
  };

  Object.keys(samples).forEach(function (col) {
    const back = fromFields(col, toFields(col, 'the-id', samples[col]));
    eq(back.id, 'the-id', col + ': id survives');
    Object.keys(samples[col]).forEach(function (field) {
      eq(back[field], samples[col][field], col + '.' + field);
    });
  });
});

test('An update only writes the columns it mentions', async () => {
  // A full write would blank everything the patch omitted - which for an update is
  // exactly wrong, and would quietly erase fields.
  const { graph, adapter } = make();
  await adapter.set('projects', 'pr1', {
    tab: 't1', personId: 'p1', name: 'Keep', status: 'on', note: 'Keep this', rank: 5
  });
  graph.reset();

  await adapter.update('projects', 'pr1', { status: 'off' });

  const patch = graph.requests().filter(function (r) { return r.method === 'PATCH'; })[0];
  eq(Object.keys(patch.body), ['Status'], 'only Status was sent');
  const row = graph.items(SCHEMA.projects.list)[0];
  eq(row.fields.Note, 'Keep this', 'and the rest is untouched');
  eq(Number(row.fields.Rank), 5);
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
