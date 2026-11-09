// @ts-check
/**
 * The major challenge, and an opportunity's details matching a project's.
 *
 * Requested: a major challenge on projects and opportunities, and an opportunity's
 * details exactly like a project's - promotion changes the section it is listed
 * in, nothing about what it records.
 *
 * The challenge is stored as `note`, which is where the opportunity form has
 * always put it. Before this it could be typed once, on the opportunity form, and
 * never changed or even seen on the project's own page.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';
import { newProject } from '../src/domain/projects.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';
import { byId } from '../src/lib/seq.js';

const DAY = '2026-09-22';
const RAISED = '2026-09-21';     // pr4, the demo's opportunity, was raised here
const LIVE = { content: 'live', settings: 'live', details: 'live' };

function board() {
  const snap = demoBoard(DAY);
  byId(snap.projects, 'pr4').note = 'Their lab is slow';
  byId(snap.projects, 'pr4').winReason = 'Only ones with the data';
  return snap;
}

function screen(snap, ui) {
  return renderApp(snap, Object.assign(loadUi(), ui),
    { today: DAY, modes: LIVE, identity: { kind: 'demo', personId: 'p1' } });
}

/** The details panel for one record, wherever it is drawn. */
function panel(html, id) {
  const m = new RegExp('<details class="dtl" data-details="' + id + '"[\\s\\S]*?</details>').exec(html);
  return m ? m[0] : '';
}

/** The panel with what differs by design taken out: its heading. */
function contents(html) {
  return html.replace(/<summary class="lbl">[^<]*<\/summary>/, '');
}

group('The major challenge can be seen and changed');

test('On the project page', () => {
  const html = screen(board(), { view: 'project', project: 'pr4' });
  ok(html.indexOf('<h2>Major challenge</h2>') >= 0);
  ok(/<textarea[^>]*data-edit="projChallenge" data-id="pr4"[^>]*>Their lab is slow<\/textarea>/.test(html));
});

test('On a project that never was an opportunity too', () => {
  const html = screen(board(), { view: 'project', project: 'pr1' });
  ok(html.indexOf('data-edit="projChallenge" data-id="pr1"') >= 0);
});

test('Editing it writes the challenge, without redrawing mid-sentence', async () => {
  const store = createStore(createMemoryAdapter({ seed: board() }), {});
  await store.load();
  let redraws = 0;
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: loadUi(), render: function () { redraws++; },
    today: function () { return DAY; }
  }));
  H.edits.projChallenge(/** @type {any} */ ({ dataset: { id: 'pr4' }, value: 'Lab booked to March' }));
  await new Promise(function (r) { setTimeout(r, 25); });
  eq(byId(store.snapshot().projects, 'pr4').note, 'Lab booked to March');
  eq(redraws, 0, 'silent, like every other free-text box');
});

group('Tiles carry no details panel any more');

test('Neither a Horizon tile nor a Current project tile has one', () => {
  // Details are entered on the project's page; the meeting list stays a list.
  const html = screen(board(), { view: 'tab', tab: 't1', steps: { t1: 0 }, dates: { t1: RAISED } });
  ok(html.indexOf('id="proj-pr1"') >= 0 && html.indexOf('id="opp-pr4"') >= 0, 'both kinds are on screen');
  notOk(html.indexOf('class="dtl"') >= 0, 'no details dropdown on either');
});

group('A project or an opportunity can be started with Mission & challenges');

test('Both add forms ask, optionally', () => {
  ['project', 'opp'].forEach(function (f) {
    const html = screen(board(), { view: 'tab', tab: 't1', steps: { t1: 0 }, open: f });
    const form = html.slice(html.indexOf('<form class="add" data-form="' + f + '">'));
    ok(form.length && /name="mission"[^>]*placeholder="Mission &amp; challenges \(optional\)"/
      .test(form.slice(0, form.indexOf('</form>'))), f);
  });
});

test('Given, it is stored where an opportunity stores it; left blank, nothing is', () => {
  const base = { tab: 't1', personId: 'p1', name: 'x', meetingDate: DAY };
  eq(newProject(Object.assign({ note: 'Supply' }, base)).note, 'Supply');
  notOk('note' in newProject(base), 'no empty field written');
});

test('Through the form', async () => {
  const store = createStore(createMemoryAdapter({ seed: board() }), {});
  await store.load();
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: Object.assign(loadUi(), { view: 'tab', tab: 't1' }),
    render: function () {}, today: function () { return DAY; }
  }));
  H.forms.project(new Map([['name', 'Resin swap'], ['who', 'p1'], ['mission', '  Supply  ']]));
  await new Promise(function (r) { setTimeout(r, 25); });
  const made = store.snapshot().projects.filter(function (p) { return p.name === 'Resin swap'; })[0];
  ok(made);
  if (made) eq(made.mission, 'Supply', 'trimmed, into Mission & challenges');
});
