// @ts-check
/**
 * Who the board thinks you are.
 *
 * This replaced a dropdown the viewer picked themselves, which meant the board
 * believed whatever it was told. These tests pin the three cases that actually
 * happen, including the two that are easy to forget: somebody who has signed in but
 * is not on the roster yet, and a demo board with no sign-in at all.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { identify } from '../src/identity.js';
import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { loadUi } from '../src/ui.js';
import { today } from '../src/lib/dates.js';

const MODES = { content: 'live', settings: 'live' };

function sidebar(snap, account) {
  return renderApp(snap, Object.assign({}, loadUi(), { view: 'overview' }), {
    today: today(),
    modes: MODES,
    identity: identify(snap, account)
  });
}

group('Identity comes from the sign-in');

test('A signed-in person is matched to their roster record by UPN', () => {
  const snap = demoBoard();
  snap.people[0].upn = 'alex.morgan@example.com';

  const who = identify(snap, { username: 'alex.morgan@example.com', name: 'Alex Morgan' });
  eq(who.kind, 'signed-in');
  eq(who.personId, snap.people[0].id);
  eq(who.displayName, snap.people[0].name, 'the roster name wins over the sign-in name');
});

test('Matching ignores case and stray whitespace', () => {
  // Sign-in and a hand-typed roster entry disagree about capitalisation often
  // enough that an exact match would fail in real use.
  const snap = demoBoard();
  snap.people[0].upn = '  ALEX.Morgan@Example.com ';

  eq(identify(snap, { username: 'alex.morgan@example.com' }).kind, 'signed-in');
});

test('Somebody not on the roster still gets a name, and is told why', () => {
  const snap = demoBoard();
  const who = identify(snap, { username: 'new.person@example.com', name: 'New Person' });

  eq(who.kind, 'unknown-user');
  eq(who.displayName, 'New Person');
  eq(who.person, null, 'they are not any person record');
  eq(who.personId, null);

  ok(sidebar(snap, { username: 'new.person@example.com', name: 'New Person' })
    .indexOf('not on the roster') >= 0, 'and the sidebar says so');
});

test('A person with no UPN on the roster is not matched by accident', () => {
  const snap = demoBoard();   // nobody has a upn
  eq(identify(snap, { username: 'someone@example.com' }).kind, 'unknown-user');
});

test('Demo mode borrows a person and says plainly that it is demo data', () => {
  // A demo board must never be mistaken for the real one.
  const snap = demoBoard();
  const who = identify(snap, null);

  eq(who.kind, 'demo');
  ok(who.person, 'it still has a point of view, so the board is usable');
  ok(sidebar(snap, null).indexOf('Demo data') >= 0, 'and the sidebar is unambiguous');
});

test('An account with no username is treated as no sign-in', () => {
  eq(identify(demoBoard(), { name: 'Somebody' }).kind, 'demo');
});

test('An empty roster does not break the sign-in', () => {
  const snap = demoBoard();
  snap.people = [];

  const demo = identify(snap, null);
  eq(demo.kind, 'demo');
  eq(demo.person, null);
  eq(demo.displayName, 'Demo');
});

group('The "I am" dropdown is gone');

test('The sidebar reports who you are rather than asking', () => {
  const html = sidebar(demoBoard(), null);
  notOk(html.indexOf('data-edit="iam"') >= 0, 'no dropdown');
  notOk(html.indexOf('id="f-iam"') >= 0);
  ok(html.indexOf('Signed in as') >= 0, 'it is a statement now');
});

test('Project Details appears only when the data actually arrived', () => {
  // The gate is no longer a check in the browser. The sensitive fields live on
  // their own permissioned list, so somebody without access simply receives an
  // empty collection and there is nothing to draw. That is the difference between
  // hiding the numbers and protecting them.
  const withData = demoBoard();
  const withoutData = demoBoard();
  withoutData.projectDetails = [];   // what a refused load looks like

  const shown = renderApp(withData,
    Object.assign({}, loadUi(), { view: 'tab', tab: 't1', steps: { t1: 2 } }),
    { today: today(), modes: MODES, identity: identify(withData, null) });

  ok(shown.indexOf('data-edit="pdValue"') >= 0, 'the panel is there when the data is');
  ok(shown.indexOf('180000') >= 0, 'and shows the figure');

  const hidden = renderApp(withoutData,
    Object.assign({}, loadUi(), { view: 'tab', tab: 't1', steps: { t1: 2 } }),
    { today: today(), modes: MODES, identity: identify(withoutData, null) });

  notOk(hidden.indexOf('180000') >= 0, 'and the figure is nowhere in the page');
});

test('A refused collection leaves the rest of the board working', () => {
  const snap = demoBoard();
  snap.projectDetails = [];
  snap.denied = ['projectDetails'];

  const html = renderApp(snap, Object.assign({}, loadUi(), { view: 'overview' }),
    { today: today(), modes: MODES, identity: identify(snap, null) });

  ok(html.length > 3000, 'the board still renders');
  ok(html.indexOf('Northern Area') >= 0, 'with everything the person may see');
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
