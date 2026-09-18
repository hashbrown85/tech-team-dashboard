// @ts-check
/**
 * A local board: real data, saved in this browser, with no sign-in.
 *
 * The board was built for two worlds — invented data with nobody signed in, and
 * real data with everybody signed in. Running a real meeting before SharePoint
 * exists is a third, and the two halves it borrows from are each wrong for it:
 * the demo's "this is not real" warning, and the demo's habit of deciding who you
 * are so the board has a point of view.
 *
 * Both of those are harmless on invented data and actively bad on a projector in
 * front of the team, which is what these tests hold in place.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { today } from '../src/lib/dates.js';
import { loadUi } from '../src/ui.js';
import { identify } from '../src/identity.js';

const MODES = { content: 'live', settings: 'live' };
const snap = demoBoard();
const base = loadUi();

function render(identity, over) {
  return renderApp(snap, Object.assign({}, base, over || {}),
    { today: today(), modes: MODES, identity: identity });
}

/** What main.js hands identify() on a local board. */
function asLocal(personId) {
  return identify(snap, null, { personId: personId || null });
}

group('Who you are on a board with no sign-in');

test('It does not decide you are somebody else', () => {
  // The demo borrows the first person alphabetically so the board has a point of
  // view. On real data that opens the board filtered to a colleague's work and
  // stamps your notes with their name.
  const me = asLocal(null);
  eq(me.kind, 'local');
  eq(me.personId, null, 'nobody, until somebody says');
  eq(me.person, null);
});

test('Once you say who you are, it believes you', () => {
  const p = snap.people[0];
  const me = asLocal(p.id);
  eq(me.personId, p.id);
  eq(me.displayName, p.name);
});

test('An id that matches nobody leaves you unset rather than guessing', () => {
  const me = asLocal('nobody-by-this-id');
  eq(me.personId, null);
  eq(me.displayName, 'Not set');
});

test('The demo still behaves exactly as it did', () => {
  // The third mode must not have quietly changed the other two.
  const demo = identify(snap, null, null);
  eq(demo.kind, 'demo', 'no local hint means demo');
  ok(demo.personId, 'and the demo still borrows a point of view');
});

test('A signed-in person is unaffected by any of this', () => {
  const withUpn = { people: [{ id: 'p9', name: 'Real', upn: 'real@x.com' }] };
  const who = identify(/** @type {any} */ (withUpn), { username: 'REAL@x.com ' }, { personId: 'p1' });
  eq(who.kind, 'signed-in', 'the sign-in wins over any local hint');
  eq(who.personId, 'p9');
});

group('What a local board says about itself');

test('It never calls real data a demo', () => {
  // This marker exists so invented data is never shown to a room by mistake. On a
  // real board, in front of the team, it fires backwards.
  const html = render(asLocal('p1'));
  notOk(html.indexOf('Demo data') >= 0, 'no demo warning');
  notOk(html.indexOf('>DEMO<') >= 0, 'and no demo badge');
});

test('It does say it is only on this computer', () => {
  // True, and the difference between losing a meeting and not.
  const html = render(asLocal('p1'));
  ok(html.indexOf('Local board') >= 0, 'the full sentence');
  ok(html.indexOf('>LOCAL<') >= 0, 'and a marker that fits the collapsed sidebar');
});

test('The demo board still warns, as loudly as before', () => {
  const html = render(identify(snap, null, null));
  ok(html.indexOf('Demo data — not the real board') >= 0);
});

test('The "You are" picker appears only on a local board', () => {
  ok(render(asLocal(null)).indexOf('data-edit="meId"') >= 0, 'local offers it');
  notOk(render(identify(snap, null, null)).indexOf('data-edit="meId"') >= 0,
    'the demo does not');
});

test('The picker offers everyone, and marks who is chosen', () => {
  const p = snap.people[1];
  const html = render(asLocal(p.id), { meId: p.id });
  const sel = /<select[^>]*data-edit="meId"[\s\S]*?<\/select>/.exec(html);
  ok(sel, 'the picker rendered');
  if (!sel) return;
  eq((sel[0].match(/<option/g) || []).length, snap.people.length + 1,
    'everybody, plus "Not set"');
  ok(sel[0].indexOf('value="' + p.id + '" selected') >= 0, 'the chosen one is marked');
});

group('Getting the board out of the browser');

test('A local board offers to download a copy', () => {
  // Browser storage is one address on one machine and a cleared cache away from
  // gone. The downloaded file is the only form that survives that.
  const html = render(asLocal('p1'), { view: 'people' });
  ok(html.indexOf('data-act="downloadBoard"') >= 0);
  ok(html.indexOf('data-edit="loadBoard"') >= 0, 'and to load one back');
});

test('It says what is on the board, so a load can be judged', () => {
  const html = render(asLocal('p1'), { view: 'people' });
  ok(html.indexOf(snap.projects.length + ' projects') >= 0, 'the counts are shown');
});

test('The demo board does not offer to save itself', () => {
  // There is nothing worth keeping, and offering would suggest otherwise.
  const html = render(identify(snap, null, null), { view: 'people' });
  notOk(html.indexOf('data-act="downloadBoard"') >= 0);
});

test('The file input is reachable by keyboard, not just by its label', () => {
  // It is visually hidden behind a styled label; hidden with .sr-only rather than
  // display:none precisely so it can still be focused and activated.
  const html = render(asLocal('p1'), { view: 'people' });
  const input = /<input[^>]*data-edit="loadBoard"[^>]*>/.exec(html);
  ok(input, 'the input is rendered');
  if (!input) return;
  ok(input[0].indexOf('class="sr-only"') >= 0, 'clipped, not removed');
  ok(html.indexOf('for="f-load"') >= 0 && input[0].indexOf('id="f-load"') >= 0,
    'and the label points at it');
});
