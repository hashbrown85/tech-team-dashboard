// @ts-check
/**
 * The work email, and whether the roster is ready for a sign-in.
 *
 * The add-a-person form collected this from the day it existed, and the table never
 * showed it — so it went in once and could never be seen, checked or corrected. A
 * typo was invisible and anybody added before the field existed had no way to gain
 * one.
 *
 * It matters more than a missing column usually would: this is the ONLY link between
 * a roster entry and a Microsoft account, so it decides who can act as themselves
 * once SharePoint arrives.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { blankSnapshot } from '../src/adapters/DataStore.js';
import { loadUi } from '../src/ui.js';
import { identify, rosterGaps, upnKey } from '../src/identity.js';

const MODES = { content: 'live', settings: 'live', details: 'live' };
const base = loadUi();

function peopleScreen(snap, modes) {
  return renderApp(snap || demoBoard('2026-09-22'),
    Object.assign({}, base, { view: 'people' }),
    { today: '2026-09-22', modes: modes || MODES,
      identity: { kind: 'local', displayName: 'Alex', person: null, personId: 'p1' } });
}

function roster(list) {
  return Object.assign(blankSnapshot(), { people: list });
}

group('The work email can be seen and corrected');

test('It is a column in the table, not only on the add form', () => {
  const html = peopleScreen();
  ok(html.indexOf('<th>Work email</th>') >= 0, 'it has a column');
  ok(html.indexOf('data-edit="personUpn"') >= 0, 'and it is editable in place');
});

test('Every person gets one, including those who have none yet', () => {
  // The ones added before the field existed are exactly the ones that need fixing.
  const html = peopleScreen();
  const boxes = html.match(/data-edit="personUpn"/g) || [];
  eq(boxes.length, demoBoard('2026-09-22').people.length, 'one box per person');
});

test('The existing value is shown, so a typo is visible', () => {
  const snap = demoBoard('2026-09-22');
  const withOne = snap.people.filter(function (p) { return p.upn; })[0];
  ok(withOne, 'somebody on the demo board has an email');
  if (withOne) ok(peopleScreen(snap).indexOf(withOne.upn) >= 0, 'and it is on the page');
});

test('A read-only reader sees it but cannot change it', () => {
  const html = peopleScreen(null, { content: 'live', settings: 'readonly', details: 'live' });
  const boxes = html.match(/<input[^>]*data-edit="personUpn"[^>]*>/g) || [];
  ok(boxes.length > 0, 'still shown');
  boxes.forEach(function (b) { ok(b.indexOf('disabled') >= 0, 'but disabled'); });
});

test('The empty-roster row spans every column', () => {
  // Easy to miss when a column is added, and it renders a short row rather than an
  // error - so nothing would tell you.
  const html = peopleScreen(blankSnapshot());
  const cols = (/<thead><tr>([\s\S]*?)<\/tr>/.exec(html) || ['', ''])[1];
  const n = (cols.match(/<th/g) || []).length;
  ok(html.indexOf('colspan="' + n + '"') >= 0, 'colspan matches the header count');
});

group('Matching a person to their sign-in');

test('The key is trimmed and case-folded', () => {
  eq(upnKey('  SAM@Example.com '), 'sam@example.com');
  eq(upnKey(''), '');
  eq(upnKey(undefined), '', 'and nothing at all is not a key');
});

test('Sign-in matches regardless of how either side was typed', () => {
  const snap = roster([{ id: 'p9', name: 'Sam', upn: '  SAM@Example.com ' }]);
  const who = identify(snap, { username: 'sam@EXAMPLE.com' }, null);
  eq(who.kind, 'signed-in');
  eq(who.personId, 'p9');
});

test('Somebody with no email matches nobody, rather than the first blank', () => {
  // Two people with no email must not both "match" an empty username.
  const snap = roster([
    { id: 'p1', name: 'No Email' },
    { id: 'p2', name: 'Also None', upn: '' }
  ]);
  eq(identify(snap, { username: '   ' }, null).kind, 'unknown-user');
});

group('What would stop somebody being recognised');

test('A clean roster reports nothing', () => {
  const gaps = rosterGaps(roster([
    { id: 'p1', name: 'A', upn: 'a@x.invalid' },
    { id: 'p2', name: 'B', upn: 'b@x.invalid' }
  ]));
  eq(gaps.missing.length, 0);
  eq(gaps.duplicates.length, 0);
  eq(gaps.total, 2);
});

test('People with no email are counted', () => {
  const gaps = rosterGaps(roster([
    { id: 'p1', name: 'A', upn: 'a@x.invalid' },
    { id: 'p2', name: 'B' },
    { id: 'p3', name: 'C', upn: '   ' }
  ]));
  eq(gaps.missing.length, 2, 'blank and whitespace both count as missing');
  eq(gaps.total, 3);
  // And emphatically NOT a clash: two people with no email have nothing in common,
  // and reporting them as sharing an address would be nonsense on the screen.
  eq(gaps.duplicates.length, 0, 'having nothing is not sharing something');
});

test('Two people sharing an address are found, however it was typed', () => {
  // This is the quiet one: identify() takes the FIRST match, so one of them signs
  // in and silently becomes the other, notes and all.
  const gaps = rosterGaps(roster([
    { id: 'p1', name: 'A', upn: 'shared@x.invalid' },
    { id: 'p2', name: 'B', upn: '  SHARED@X.invalid ' },
    { id: 'p3', name: 'C', upn: 'c@x.invalid' }
  ]));
  eq(gaps.duplicates.length, 1, 'one clash');
  eq(gaps.duplicates[0].people.length, 2, 'between two people');
  eq(gaps.duplicates[0].key, 'shared@x.invalid', 'named by its folded key');
});

test('An empty roster is not a problem', () => {
  const gaps = rosterGaps(blankSnapshot());
  eq(gaps.missing.length, 0);
  eq(gaps.duplicates.length, 0);
  eq(gaps.total, 0);
});

group('Saying so on the screen');

test('The count appears when somebody has no email', () => {
  const html = peopleScreen(roster([
    { id: 'p1', name: 'A', upn: 'a@x.invalid' },
    { id: 'p2', name: 'B' }
  ]));
  ok(html.indexOf('1 of 2 have no work email') >= 0, 'says how many, of how many');
});

test('A clash is named, and says what will happen', () => {
  const html = peopleScreen(roster([
    { id: 'p1', name: 'A', upn: 'shared@x.invalid' },
    { id: 'p2', name: 'B', upn: 'shared@x.invalid' }
  ]));
  ok(html.indexOf('shared@x.invalid') >= 0, 'names the address');
  ok(html.indexOf('only the first would be recognised') >= 0, 'and the consequence');
});

test('A clean roster gets no note at all', () => {
  // So the note means "look at this" rather than becoming furniture.
  const html = peopleScreen(roster([
    { id: 'p1', name: 'A', upn: 'a@x.invalid' },
    { id: 'p2', name: 'B', upn: 'b@x.invalid' }
  ]));
  notOk(/no work email|would be recognised/.test(html));
});
