// @ts-check
/**
 * Who sees which meetings, and who gets the settings controls.
 *
 * Read domain/scope.js first: this is what the SCREEN draws, not yet protection.
 * These tests pin the rules so that when the store can enforce them, it enforces
 * the same ones - and so the screens are known to cope with a trimmed board before
 * a trimmed board is the only kind there is.
 *
 * The fixture: the demo board with Dana (p4) switched on as the one admin.
 *   Priya  (p2)  reports in Northern only           -> Northern
 *   Ravi   (p5)  supports in Northern and Southern  -> both areas, not Tech Directors
 *   Sam    (p3)  optional in Tech Directors         -> everything (the tech team)
 *   Dana   (p4)  admin                              -> everything
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';
import {
  scopeBoard, meetingsInScope, isAdmin, viewerIsAdmin, adminsOf
} from '../src/domain/scope.js';
import { boardIsComplete } from '../src/domain/queries.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';
import { byId } from '../src/lib/seq.js';

const DAY = '2026-09-22';
const LIVE = { content: 'live', settings: 'live', details: 'live' };

function board() {
  const snap = demoBoard(DAY);
  byId(snap.people, 'p4').admin = true;
  return snap;
}

function as(personId) {
  return { kind: 'signed-in', personId: personId, displayName: personId };
}

function ids(list) {
  return list.map(function (r) { return r.id; }).sort();
}

function screen(snap, who, ui, modes) {
  return renderApp(snap, Object.assign({}, loadUi(), ui || {}),
    { today: DAY, modes: modes || LIVE, identity: who });
}

group('Which meetings somebody sees');

test('Somebody in one area sees that area', () => {
  eq(meetingsInScope(board(), as('p2')), ['t1']);
});

test('Somebody in two areas sees both, and nothing else', () => {
  eq(meetingsInScope(board(), as('p5')), ['t1', 't2']);
});

test('The tech team sees everything, in any role', () => {
  // Sam is only optional in Tech Directors, and that is enough.
  eq(meetingsInScope(board(), as('p3')), null);
});

test('An admin sees everything, because they have to set meetings up', () => {
  eq(meetingsInScope(board(), as('p4')), null);
});

test('Signed in but not on the roster: nothing', () => {
  eq(meetingsInScope(board(), { kind: 'unknown-user', personId: null }), []);
});

test('A board with no admin yet hides nothing, even from a stranger', () => {
  // Otherwise the first person into a fresh board sees nothing and can fix nothing.
  const snap = demoBoard(DAY);
  eq(adminsOf(snap).length, 0, 'the plain demo board has no admin');
  eq(meetingsInScope(snap, { kind: 'unknown-user', personId: null }), null);
  eq(meetingsInScope(snap, as('p2')), null);
});

test('The demo, and a local board with nobody chosen, show everything', () => {
  eq(meetingsInScope(board(), { kind: 'demo', personId: 'p2' }), null);
  eq(meetingsInScope(board(), { kind: 'local', personId: null }), null);
});

test('A local board with somebody chosen previews what they would see', () => {
  eq(meetingsInScope(board(), { kind: 'local', personId: 'p2' }), ['t1']);
});

group('The trimmed board');

test('Everything filed against another meeting is left out', () => {
  const s = scopeBoard(board(), as('p2'));
  eq(ids(s.tabs), ['t1']);
  eq(ids(s.projects), ['pr1', 'pr2', 'pr3', 'pr4'], 'no Southern or Tech Directors project');
  eq(ids(s.issues), ['i1', 'i2', 'i3']);
  eq(ids(s.actions), ['a1', 'a2', 'a3', 'a4', 'a7']);
  eq(Object.keys(s.meetings).sort(), ['t1|2026-09-14', 't1|2026-09-21']);
});

test('Notes and values follow their project', () => {
  const s = scopeBoard(board(), as('p2'));
  eq(ids(s.projectDetails), ['pr1'], 'Southern’s project value is gone');
  eq(ids(s.projectNotes), ['n1', 'n2', 'n3', 'n4']);
  const r = scopeBoard(board(), { kind: 'unknown-user', personId: null });
  eq(r.projectNotes.length + r.projectDetails.length, 0, 'nothing for nobody');
});

test('The roster and the pick-lists are kept whole', () => {
  const full = board();
  const s = scopeBoard(full, as('p2'));
  eq(s.people.length, full.people.length);
  eq(s.settings, full.settings);
});

test('A trimmed board says so; a full one is untouched', () => {
  const full = board();
  const s = scopeBoard(full, as('p2'));
  eq(s.scopedTo, ['t1']);
  notOk(boardIsComplete(s), 'totals must not claim "all meetings"');
  ok(scopeBoard(full, as('p4')) === full, 'unscoped returns the same board, not a copy');
  eq(full.projects.length, 6, 'and trimming never touches the original');
});

group('What a scoped person is shown');

test('The sidebar lists only their meetings', () => {
  const html = screen(board(), as('p2'));
  ok(html.indexOf('data-id="t1"') > 0, 'Northern');
  notOk(html.indexOf('data-id="t2"') >= 0, 'not Southern');
  notOk(html.indexOf('data-id="techdir"') >= 0, 'not Tech Directors');
});

test('The overview says which meetings it is showing', () => {
  const html = screen(board(), as('p2'));
  ok(html.indexOf('Showing only the meetings you attend: <b>Northern Area</b>') > 0);
  ok(html.indexOf('across what you can see') > 0, 'and the totals do not claim all');
});

test('Somebody in no meeting is told why the board is empty', () => {
  const html = screen(board(), { kind: 'unknown-user', personId: null });
  ok(html.indexOf('You are not in any meeting yet') > 0);
});

test('Another area’s project cannot be opened by id', () => {
  const html = screen(board(), as('p2'), { view: 'project', project: 'pr5' });
  notOk(html.indexOf('data-edit="projName"') >= 0, 'no project page');
  ok(html.indexOf('<h1>Overview</h1>') > 0, 'the overview instead');
});

test('The Projects list holds only their meetings’ projects', () => {
  const full = board();
  const pr5 = byId(full.projects, 'pr5');
  const html = screen(full, as('p2'), { view: 'projects', projFilter: 'all' });
  notOk(html.indexOf('data-id="pr5"') >= 0, pr5.name + ' is not listed');
  ok(html.indexOf('data-id="pr1"') > 0, 'their own are');
});

group('The admin switch');

test('With no admins, everybody is one', () => {
  ok(isAdmin(demoBoard(DAY), 'p2'));
  ok(viewerIsAdmin(demoBoard(DAY), { kind: 'unknown-user', personId: null }));
});

test('Once there is one, only admins are', () => {
  ok(isAdmin(board(), 'p4'));
  notOk(isAdmin(board(), 'p2'));
  notOk(viewerIsAdmin(board(), { kind: 'unknown-user', personId: null }));
});

test('The People page has an Admin column showing who is one', () => {
  const html = screen(board(), as('p4'), { view: 'people' });
  ok(html.indexOf('<th class="c">Admin</th>') > 0);
  ok(/data-edit="personAdmin" data-id="p4"[^>]*checked/.test(html), 'Dana is ticked');
  notOk(/data-edit="personAdmin" data-id="p2"[^>]*checked/.test(html), 'Priya is not');
});

test('A non-admin gets the settings drawn read-only, and is told who to ask', () => {
  const html = screen(board(), as('p3'), { view: 'people' });
  const boxes = html.match(/<input[^>]*data-edit="personName"[^>]*>/g) || [];
  ok(boxes.length > 0);
  boxes.forEach(function (b) { ok(b.indexOf('disabled') > 0, 'roster locked'); });
  ok(html.indexOf('Only admins can change the roster and board settings: <b>Dana Whitfield</b>') > 0);
  notOk(html.indexOf('data-act="addTab"') >= 0, 'and no + to add a meeting');
});

test('A non-admin sees meeting settings but cannot change them', () => {
  const html = screen(board(), as('p3'), { view: 'tab', tab: 't1', settings: true });
  ok(/class="app ro/.test(html), 'the screen is read-only');
});

test('Board settings is admin-only too', () => {
  const html = screen(board(), as('p3'), { view: 'config' });
  ok(/class="app ro/.test(html));
});

test('An admin whose saves SharePoint refused is told why', () => {
  const html = screen(board(), as('p4'), { view: 'people' },
    { content: 'live', settings: 'readonly', details: 'live' });
  ok(html.indexOf('SharePoint refused your change') > 0);
});

test('A fresh board says nobody is an admin yet', () => {
  const html = screen(demoBoard(DAY), as('p2'), { view: 'people' });
  ok(html.indexOf('Nobody is an admin yet') > 0);
});

/** Store and handlers, as a given person, answering any question with `answer`. */
async function app(snap, personId, answer) {
  const store = createStore(createMemoryAdapter({ seed: snap }), {});
  await store.load();
  const asked = [];
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: loadUi(), render: function () {},
    today: function () { return DAY; },
    identity: function () { return as(personId); },
    confirm: function (q) { asked.push(q); return answer; }
  }));
  return { store: store, H: H, asked: asked };
}

function settle() {
  return new Promise(function (r) { setTimeout(r, 25); });
}

function box(id, checked) {
  return /** @type {any} */ ({ dataset: { id: id }, checked: checked });
}

test('Ticking somebody makes them an admin', async () => {
  const a = await app(board(), 'p4', true);
  a.H.edits.personAdmin(box('p2', true));
  await settle();
  ok(byId(a.store.snapshot().people, 'p2').admin, 'saved');
  eq(a.asked.length, 0, 'nothing to ask - Dana is still an admin');
});

test('The last admin cannot be switched off', async () => {
  const a = await app(board(), 'p4', true);
  const el = box('p4', false);
  a.H.edits.personAdmin(el);
  await settle();
  ok(byId(a.store.snapshot().people, 'p4').admin, 'still an admin');
  ok(el.checked, 'and the box is ticked again');
});

test('Switching yourself off asks first, and saying no changes nothing', async () => {
  const snap = board();
  byId(snap.people, 'p2').admin = true;
  const a = await app(snap, 'p4', false);
  const el = box('p4', false);
  a.H.edits.personAdmin(el);
  await settle();
  eq(a.asked.length, 1, 'it asked');
  ok(byId(a.store.snapshot().people, 'p4').admin, 'still an admin');
  ok(el.checked, 'box put back');
});

test('Naming somebody else as the first admin asks, because you lose the controls', async () => {
  const a = await app(demoBoard(DAY), 'p2', true);
  a.H.edits.personAdmin(box('p4', true));
  await settle();
  eq(a.asked.length, 1, 'it warned');
  ok(byId(a.store.snapshot().people, 'p4').admin, 'and, told yes, saved it');
});

test('Naming yourself as the first admin just does it', async () => {
  const a = await app(demoBoard(DAY), 'p2', false);
  a.H.edits.personAdmin(box('p2', true));
  await settle();
  eq(a.asked.length, 0);
  ok(byId(a.store.snapshot().people, 'p2').admin);
});
