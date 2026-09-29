// @ts-check
/**
 * Saving the board to the browser.
 *
 * The shared contract suite (adapterContract.test.js) already runs this adapter
 * through everything every adapter must do. This file is only about the part that
 * is its own: that the data is still there afterwards, and that when it cannot be
 * saved somebody is told.
 *
 * These matter more than usual. The board is about to be somebody's only record of
 * a real meeting, and every failure here is silent by nature — you find out you
 * were not saving at the point where you needed what you did not save.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import {
  createLocalAdapter, nextActionNumFor, looksLikeSnapshot, LOCAL_KEY
} from '../src/adapters/localAdapter.js';
import { blankSnapshot } from '../src/adapters/DataStore.js';
import { fakeStorage } from './fakeStorage.js';

/** Build a board on a given store, as a page load would. */
function boardOn(storage, seed) {
  return createLocalAdapter({ storage: storage, key: 'test:board', seed: seed });
}

group('The board survives a reload');

test('What was written is there after the page is thrown away', async () => {
  // The whole point. Everything below is detail; if this fails, Monday fails.
  const storage = fakeStorage();

  const before = boardOn(storage);
  await before.set('people', 'p1', { name: 'A real person', title: 'Chemist' });
  await before.set('projects', 'pr1', { tab: 't1', name: 'A real project', status: 'on' });

  // A new adapter on the same storage is what a reload actually is.
  const after = boardOn(storage);
  const snap = await after.load();

  eq(snap.people.length, 1, 'the person is still there');
  eq(snap.people[0].name, 'A real person', 'with what was typed');
  eq(snap.projects.length, 1, 'and so is the project');
});

test('A removal survives too, rather than coming back', async () => {
  const storage = fakeStorage();
  const a = boardOn(storage);
  await a.set('people', 'p1', { name: 'Leaver' });
  await a.remove('people', 'p1');

  eq((await boardOn(storage).load()).people.length, 0, 'still gone after a reload');
});

test('Action numbers resume instead of restarting', async () => {
  // They get read aloud in meetings. Restarting at 1 after a reload would hand out
  // a second A-003 in the same week.
  const storage = fakeStorage();
  const a = boardOn(storage);
  eq(await a.nextActionNum(), 1);
  await a.set('actions', 'a1', { tab: 't1', num: 1, text: 'First', status: 'open' });
  await a.set('actions', 'a2', { tab: 't1', num: 2, text: 'Second', status: 'open' });

  eq(await boardOn(storage).nextActionNum(), 3, 'one past the highest, not back to 1');
});

test('The counter comes from the data, so a gap does not rewind it', () => {
  eq(nextActionNumFor(blankSnapshot()), 1, 'an empty board starts at 1');
  eq(nextActionNumFor({ actions: [{ num: 7 }, { num: 3 }] }), 8, 'one past the highest');
  eq(nextActionNumFor({ actions: [{ num: NaN }, { num: 2 }] }), 3, 'a bad number is not a high one');
  eq(nextActionNumFor({ actions: [] }), 1);
});

test('An empty store starts from the seed, not from nothing', async () => {
  const seed = Object.assign(blankSnapshot(), { people: [{ id: 'p1', name: 'Seeded' }] });
  const snap = await boardOn(fakeStorage(), seed).load();
  eq(snap.people.length, 1, 'the seed is used when there is nothing saved');
});

test('Saved data wins over the seed, so a reload does not overwrite the meeting', async () => {
  // If the seed won, every reload would wipe the board back to its starting state -
  // which is the exact failure this adapter exists to prevent.
  const storage = fakeStorage();
  await boardOn(storage).set('people', 'real', { name: 'Typed in the meeting' });

  const seed = Object.assign(blankSnapshot(), { people: [{ id: 'p1', name: 'Seeded' }] });
  const snap = await boardOn(storage, seed).load();

  eq(snap.people.length, 1);
  eq(snap.people[0].name, 'Typed in the meeting', 'what was typed, not the seed');
});

group('When it cannot save, it says so');

test('A failing store rejects the write rather than swallowing it', async () => {
  // The worst outcome available is a silent failure: you keep typing into a board
  // that is keeping none of it, and find out when you need what you did not save.
  // Rejecting reaches store.handleFailure, which goes read-only and toasts.
  const storage = fakeStorage({
    failWrite: function () { return new Error('QuotaExceededError'); }
  });

  let rejected = false;
  try {
    await boardOn(storage).set('people', 'p1', { name: 'Will not fit' });
  } catch (e) {
    rejected = true;
  }
  ok(rejected, 'the write reports that it failed');
});

test('Unreadable saved data does not silently start you at empty', async () => {
  // Starting blank would be indistinguishable from having lost everything, and the
  // next save would overwrite whatever was actually there.
  const storage = fakeStorage();
  storage.setItem('test:board', '{ this is not json');

  let threw = null;
  try {
    boardOn(storage);
  } catch (e) {
    threw = e;
  }
  ok(threw, 'it refuses to start rather than pretending the board is empty');
  ok(String(threw.message).indexOf('could not be read') >= 0, 'and says so plainly');
});

test('The unreadable value is kept, so it can still be recovered', () => {
  const storage = fakeStorage();
  storage.setItem('test:board', '{ broken');
  try { boardOn(storage); } catch (e) { /* expected */ }

  const kept = Object.keys(storage._all()).filter(function (k) {
    return k.indexOf('test:board:unreadable:') === 0;
  });
  eq(kept.length, 1, 'a copy is put aside');
  eq(storage.getItem(kept[0]), '{ broken', 'byte for byte');
});

test('Something that is not a board at all is treated the same way', () => {
  const storage = fakeStorage();
  storage.setItem('test:board', '{"people": "not an array"}');
  let threw = false;
  try { boardOn(storage); } catch (e) { threw = true; }
  ok(threw, 'valid JSON of the wrong shape is still unreadable');
});

group('Recognising a board');

test('It accepts a board that predates a collection being added', () => {
  // Merging onto a blank snapshot means an older saved board still loads. This will
  // matter the first time a collection is added - which has happened twice already.
  const old = blankSnapshot();
  delete old.projectNotes;
  ok(looksLikeSnapshot(old), 'a missing collection is filled in, not rejected');
});

test('An object carrying none of the collections is not a board', () => {
  // Without a floor, every collection was "absent, and absent is fine", so any JSON
  // object at all passed - which made the import check decorative.
  notOk(looksLikeSnapshot({}), 'an empty object');
  notOk(looksLikeSnapshot({ not: 'a board' }), 'some other JSON file');
  notOk(looksLikeSnapshot({ people: [] }), 'one collection is not enough');
});

test('It rejects the shapes that would break later', () => {
  notOk(looksLikeSnapshot(null));
  notOk(looksLikeSnapshot([]), 'an array is not a board');
  notOk(looksLikeSnapshot('a string'));
  notOk(looksLikeSnapshot({ people: {} }), 'a list collection must be a list');
  notOk(looksLikeSnapshot({ settings: [] }), 'a keyed collection must not be a list');
  ok(looksLikeSnapshot(blankSnapshot()), 'and a real one passes');
});

test('The default key is the one the app uses', () => {
  // Named so it cannot drift from index.html silently.
  eq(LOCAL_KEY, 'techops-board:live');
});

/* ------------------------------------------------ loading a downloaded copy */

group('Loading a copy back');

/**
 * A running board on a local adapter, with handlers wired — enough to drive
 * `loadBoard`, which is the one path that can destroy a meeting's work.
 */
async function loadableBoard(answer) {
  const { createStore } = await import('../src/store.js');
  const { createHandlers } = await import('../src/handlers.js');
  const { loadUi } = await import('../src/ui.js');
  const { today } = await import('../src/lib/dates.js');

  // The handler toasts, which reaches for a document.
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = /** @type {any} */ ({
      getElementById: function () { return null; },
      createElement: function () {
        return { style: {}, classList: { add: function () {}, remove: function () {} },
          setAttribute: function () {}, addEventListener: function () {},
          querySelector: function () { return null; } };
      },
      body: { appendChild: function () {}, removeChild: function () {} },
      addEventListener: function () {}
    });
  }

  const adapter = createLocalAdapter({ storage: fakeStorage(), key: 'test:board' });
  const store = createStore(adapter, {});
  await store.load();
  await store.set('projects', 'keep', { tab: 't1', name: 'Already here', status: 'on' });

  /** Every question the handler asked, so a test can read what it said. */
  const asked = [];
  const handlers = createHandlers({
    store: store, ui: loadUi(), render: function () {}, today: today,
    identity: function () { return { kind: 'local', personId: null }; },
    // Injected rather than global, so concurrent tests cannot answer for each other.
    confirm: function (q) { asked.push(q); return answer !== false; }
  });
  return { store: store, H: handlers, asked: asked };
}

/** A stand-in for the file input, holding one file with this text in it. */
function pickedFile(text) {
  return /** @type {any} */ ({
    value: 'c:\fake\board.json',
    files: [{ text: function () { return Promise.resolve(text); } }]
  });
}

function settle() {
  return new Promise(function (r) { setTimeout(r, 30); });
}

test('A file that is not a board changes nothing', async () => {
  // Picking the wrong file by mistake has to be free. The shape is checked BEFORE
  // anything is replaced, so there is nothing to undo.
  const a = await loadableBoard(true);   // yes: only the shape check may stop it
  a.H.edits.loadBoard(pickedFile('{"not":"a board"}'));
  await settle();
  eq(a.store.snapshot().projects.length, 1, 'the board is untouched');
  eq(a.store.snapshot().projects[0].name, 'Already here');
});

test('A file that is not even JSON changes nothing', async () => {
  const a = await loadableBoard(true);   // yes: only the shape check may stop it
  a.H.edits.loadBoard(pickedFile('this is a spreadsheet, not a board'));
  await settle();
  eq(a.store.snapshot().projects.length, 1, 'still untouched');
});

test('Valid JSON of the wrong shape is rejected too', async () => {
  // `{"people": {...}}` parses fine and would break every list in the app.
  const a = await loadableBoard(true);   // yes: only the shape check may stop it
  a.H.edits.loadBoard(pickedFile('{"people":{"p1":{"name":"Wrong shape"}}}'));
  await settle();
  eq(a.store.snapshot().projects.length, 1, 'still untouched');
});

test('A real board replaces what was there, and only if you agree', async () => {
  const incoming = Object.assign(blankSnapshot(), {
    projects: [{ id: 'pr9', tab: 't1', name: 'From the file', status: 'on' }]
  });
  const text = JSON.stringify(incoming);

  const said = await loadableBoard(false);
  said.H.edits.loadBoard(pickedFile(text));
  await settle();
  eq(said.store.snapshot().projects[0].name, 'Already here',
    'saying no keeps the board exactly as it was');

  const agreed = await loadableBoard(true);
  agreed.H.edits.loadBoard(pickedFile(text));
  await settle();
  eq(agreed.store.snapshot().projects.length, 1);
  eq(agreed.store.snapshot().projects[0].name, 'From the file', 'saying yes loads it');
});

test('The question counts people, so deleting one shows in it', async () => {
  // Reported: delete a person, load the earlier copy. The question counted only
  // projects and actions, so it read the same on both sides and said nothing about
  // what was about to change.
  const incoming = Object.assign(blankSnapshot(), {
    people: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }]
  });
  const b = await loadableBoard(false);
  b.H.edits.loadBoard(pickedFile(JSON.stringify(incoming)));
  await settle();
  eq(b.asked.length, 1, 'it asked');
  ok(b.asked[0].indexOf('0 people') >= 0, 'says the board has none');
  ok(b.asked[0].indexOf('2 people') >= 0, 'and the file has two');
});
