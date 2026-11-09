// @ts-check
/**
 * Mission & challenges: one box where there used to be two.
 *
 * Requested: combine Mission and Major challenge and move them into the Project
 * section. The challenge was stored as `note` (where the opportunity form always
 * put it), the mission as `mission`. They are shown as one text; the first save
 * writes the combined text to `mission` and clears `note`, so an old challenge
 * is folded in once and never appears twice.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';
import { newProject, missionText, projectSummary } from '../src/domain/projects.js';
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

/** The Mission & challenges box's contents, on a project's page. */
function box(html, id) {
  const m = new RegExp('<textarea[^>]*data-edit="projMission" data-id="' + id + '"[^>]*>([^<]*)</textarea>')
    .exec(html);
  return m ? m[1] : null;
}

group('Mission & challenges is one box');

test('Folding the two together: mission first, the old challenge under it', () => {
  eq(missionText({ mission: 'Prove it at 40 ppm', note: 'Their lab is slow' }),
    'Prove it at 40 ppm\n\nTheir lab is slow');
  eq(missionText({ mission: 'Prove it at 40 ppm', note: '' }), 'Prove it at 40 ppm');
  eq(missionText({ note: 'Their lab is slow' }), 'Their lab is slow', 'only a challenge');
  eq(missionText({}), '', 'neither');
});

test('It is in the Project section, and the separate panels are gone', () => {
  const html = screen(board(), { view: 'project', project: 'pr4' });
  eq(box(html, 'pr4'), 'Their lab is slow', 'an old challenge is shown in it');
  notOk(html.indexOf('<h2>Major challenge</h2>') >= 0, 'no Major challenge panel');
  notOk(html.indexOf('<h2>Mission</h2>') >= 0, 'no separate Mission panel');
  notOk(html.indexOf('data-edit="projChallenge"') >= 0, 'and no second box');
});

test('On a project that never was an opportunity too', () => {
  const snap = board();
  byId(snap.projects, 'pr1').mission = 'Qualify the additive';
  ok(box(screen(snap, { view: 'project', project: 'pr1' }), 'pr1') === 'Qualify the additive');
});

test('Saving it folds the old challenge in for good, without redrawing mid-sentence', async () => {
  const store = createStore(createMemoryAdapter({ seed: board() }), {});
  await store.load();
  let redraws = 0;
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: loadUi(), render: function () { redraws++; },
    today: function () { return DAY; }
  }));
  H.edits.projMission(/** @type {any} */ ({
    dataset: { id: 'pr4' }, value: 'Prove it at 40 ppm\n\nTheir lab is slow'
  }));
  await new Promise(function (r) { setTimeout(r, 25); });
  const p = byId(store.snapshot().projects, 'pr4');
  eq(p.mission, 'Prove it at 40 ppm\n\nTheir lab is slow');
  eq(p.note, '', 'the separate challenge is cleared');
  eq(missionText(p), 'Prove it at 40 ppm\n\nTheir lab is slow', 'so it is shown once, not twice');
  eq(redraws, 0, 'silent, like every other free-text box');
});

test('The copied summary carries it as one section', () => {
  const snap = board();
  const text = projectSummary(snap, byId(snap.projects, 'pr4'), DAY, true);
  ok(text.indexOf('MISSION & CHALLENGES\nTheir lab is slow') >= 0);
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

test('Given, it is stored as the mission; left blank, nothing is', () => {
  const base = { tab: 't1', personId: 'p1', name: 'x', meetingDate: DAY };
  eq(newProject(Object.assign({ mission: 'Supply' }, base)).mission, 'Supply');
  notOk('mission' in newProject(base), 'no empty field written');
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
  if (made) notOk('note' in made, 'and nothing in the old challenge field');
});
