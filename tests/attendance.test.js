// @ts-check
/**
 * Which area somebody is in, and how they get into meetings.
 *
 * A person's area used to be a free-text box that nothing read, sitting beside the
 * meetings they actually attend - two answers to one question, with nothing keeping
 * them agreeing. Now the area IS the area meetings they attend, and the add form can
 * put a new starter into several meetings at once.
 *
 * Both the add form and meeting settings set a role through withRole(), so these
 * tests hold the one rule that matters most: a person holds at most one role in a
 * meeting, however they got there.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { loadUi } from '../src/ui.js';
import { withRole } from '../src/domain/meetings.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';
import { byId } from '../src/lib/seq.js';

const MODES = { content: 'live', settings: 'live', details: 'live' };
const DAY = '2026-09-22';

function peopleScreen(snap, over) {
  return renderApp(snap, Object.assign({}, loadUi(), { view: 'people' }, over || {}),
    { today: DAY, modes: MODES,
      identity: { kind: 'local', displayName: 'Alex', person: null, personId: 'p1' } });
}

/** The demo board with one person placed as each test needs. */
function boardWith(personId, placements) {
  const snap = demoBoard(DAY);
  snap.tabs.forEach(function (t) {
    ['members', 'support', 'optional'].forEach(function (r) {
      t[r] = (t[r] || []).filter(function (x) { return x !== personId; });
    });
    const role = placements[t.id];
    if (role) t[role] = t[role].concat([personId]);
  });
  return snap;
}

/** The Area cell of one person's row. */
function areaCellFor(html, personId) {
  // The row is found by its email box, which carries the person's id.
  const at = html.indexOf('data-edit="personUpn" data-id="' + personId + '"');
  const rowStart = html.lastIndexOf('<tr>', at);
  const cells = html.slice(rowStart, at).split('<td>');
  // Name, Title, Area, then the email cell we anchored on.
  return cells[3] ? cells[3].replace('</td>', '') : '';
}

/** In which list(s) of a meeting this person appears. */
function rolesIn(tab, personId) {
  return ['members', 'support', 'optional'].filter(function (r) {
    return (tab[r] || []).indexOf(personId) >= 0;
  });
}

group('Area is worked out from meetings');

test('Somebody in two area meetings is listed in both', () => {
  const snap = boardWith('p1', { t1: 'members', t2: 'optional' });
  const cell = areaCellFor(peopleScreen(snap), 'p1');
  ok(cell.indexOf('Northern Area') >= 0, 'the one they report in');
  ok(cell.indexOf('Southern Area') >= 0, 'and the one they only sit in on');
});

test('Internal meetings are not areas', () => {
  // Tech Directors is a meeting, not a place. It still shows in "In meetings".
  const snap = boardWith('p1', { t1: 'members', techdir: 'members' });
  const html = peopleScreen(snap);
  const cell = areaCellFor(html, 'p1');
  ok(cell.indexOf('Northern Area') >= 0);
  notOk(cell.indexOf('Tech Directors') >= 0, 'not in the Area column');
});

test('Nobody in an area meeting gets a dash, not a blank', () => {
  const snap = boardWith('p1', { techdir: 'support' });
  eq(areaCellFor(peopleScreen(snap), 'p1'), '<span class="muted sm">—</span>');
});

test('There is no Area box to type into any more', () => {
  const html = peopleScreen(demoBoard(DAY), { open: 'person' });
  notOk(html.indexOf('personHome') >= 0, 'not in the table');
  notOk(html.indexOf('name="home"') >= 0, 'not on the add form');
});

group('Adding somebody straight into meetings');

test('The add form offers every meeting, each starting at Not in', () => {
  const snap = demoBoard(DAY);
  const html = peopleScreen(snap, { open: 'person' });
  snap.tabs.forEach(function (t) {
    const sel = new RegExp('<select name="role:' + t.id + '"[\\s\\S]*?</select>').exec(html);
    ok(sel, 'a role picker for ' + t.name);
    if (!sel) return;
    ok(/<option value="none" selected>/.test(sel[0]), t.name + ' defaults to Not in');
    eq((sel[0].match(/<option/g) || []).length, 4, 'Reporting, Supporting, Optional, Not in');
  });
});

test('Area meetings come first, under their own heading', () => {
  const html = peopleScreen(demoBoard(DAY), { open: 'person' });
  const areaAt = html.indexOf('role:t1');
  const internalAt = html.indexOf('role:techdir');
  ok(areaAt > 0 && internalAt > areaAt, 'areas before internal meetings');
  ok(html.indexOf('Area meetings — sets their area') >= 0, 'and says what choosing one does');
});

/** A running store and handlers on the demo board. */
async function app() {
  const store = createStore(createMemoryAdapter({ seed: demoBoard(DAY) }), {});
  await store.load();
  const ui = Object.assign(loadUi(), { view: 'tab', tab: 't1' });
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: ui, render: function () {},
    today: function () { return DAY; },
    identity: function () { return { kind: 'local', personId: 'p1' }; }
  }));
  return { store: store, ui: ui, H: H };
}

function settle() {
  return new Promise(function (r) { setTimeout(r, 25); });
}

function newcomer(snap) {
  return snap.people.filter(function (p) { return p.name === 'New Starter'; })[0];
}

test('The chosen roles are applied, exactly', async () => {
  const a = await app();
  a.H.forms.person(new Map([
    ['name', 'New Starter'], ['title', 'Chemist'], ['upn', ' New@Example.invalid '],
    ['role:t1', 'members'], ['role:t2', 'optional'], ['role:techdir', 'none']
  ]));
  await settle();
  const snap = a.store.snapshot();
  const p = newcomer(snap);
  ok(p, 'the person was added');
  if (!p) return;
  eq(p.upn, 'new@example.invalid', 'email trimmed and lower-cased');
  eq(rolesIn(byId(snap.tabs, 't1'), p.id), ['members'], 'reporting in Northern');
  eq(rolesIn(byId(snap.tabs, 't2'), p.id), ['optional'], 'optional in Southern');
  eq(rolesIn(byId(snap.tabs, 'techdir'), p.id), [], 'Not in means not in');
});

test('Leaving every meeting at Not in adds only the person', async () => {
  const a = await app();
  const before = JSON.stringify(a.store.snapshot().tabs);
  a.H.forms.person(new Map([['name', 'New Starter']]));
  await settle();
  ok(newcomer(a.store.snapshot()), 'added');
  eq(JSON.stringify(a.store.snapshot().tabs), before, 'no meeting touched');
});

test('A role that is not a role is ignored, not stored', async () => {
  // The value comes off the page; it is never trusted as a field name.
  const a = await app();
  a.H.forms.person(new Map([['name', 'New Starter'], ['role:t1', '__proto__']]));
  await settle();
  const p = newcomer(a.store.snapshot());
  ok(p);
  if (p) eq(rolesIn(byId(a.store.snapshot().tabs, 't1'), p.id), []);
});

test('Existing attendees are left where they were', async () => {
  const a = await app();
  const t1 = byId(a.store.snapshot().tabs, 't1');
  const before = { members: t1.members.slice(), support: (t1.support || []).slice() };
  a.H.forms.person(new Map([['name', 'New Starter'], ['role:t1', 'support']]));
  await settle();
  const after = byId(a.store.snapshot().tabs, 't1');
  eq(after.members, before.members, 'reporting list unchanged');
  eq(after.support.slice(0, -1), before.support, 'supporters kept, newcomer added at the end');
});

group('One rule for setting a role');

test('withRole moves somebody, rather than adding a second role', () => {
  const tab = { members: ['a', 'b'], support: ['c'], optional: [] };
  const patch = withRole(tab, 'a', 'optional');
  eq(patch.members, ['b'], 'gone from where they were');
  eq(patch.optional, ['a'], 'and in the new one');
  eq(patch.support, ['c'], 'nobody else moved');
});

test('withRole to none takes them out of every list', () => {
  const patch = withRole({ members: ['a'], support: ['a'], optional: ['a'] }, 'a', 'none');
  eq([patch.members, patch.support, patch.optional], [[], [], []]);
});

test('withRole on a meeting with missing lists still returns all three', () => {
  const patch = withRole({}, 'a', 'members');
  eq(patch, { members: ['a'], support: [], optional: [] });
});

test('Meeting settings still changes a role, through the same rule', async () => {
  const a = await app();
  const t1 = byId(a.store.snapshot().tabs, 't1');
  const who = t1.members[0];
  a.H.edits.tabRole(/** @type {any} */ ({ dataset: { id: who, v: 'support' } }));
  await settle();
  eq(rolesIn(byId(a.store.snapshot().tabs, 't1'), who), ['support'], 'one role, the new one');
});
