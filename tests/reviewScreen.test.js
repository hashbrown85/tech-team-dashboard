// @ts-check
/**
 * The meeting screen as a project review: one Projects step holding the Horizon
 * and Current projects, with Wins & Losses and Issues a click away.
 *
 * Requested: keep Projects, Wins & Losses and Issues; drop Rate and the separate
 * Opportunities segment; opportunities and current projects in one list, so the
 * meeting never has to flip between screens.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';
import { segmentsFor, stepIndex } from '../src/domain/constants.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';
import { byId } from '../src/lib/seq.js';

const DAY = '2026-09-22';
const RAISED = '2026-09-21';     // pr4, the demo's undecided opportunity, was raised here
const LIVE = { content: 'live', settings: 'live', details: 'live' };

function screen(ui, snap) {
  return renderApp(snap || demoBoard(DAY), Object.assign(loadUi(), ui),
    { today: DAY, modes: LIVE, identity: { kind: 'demo', personId: 'p1' } });
}

function buttons(html) {
  return (html.match(/<span class="st-t">[^<]*<\/span>/g) || []).map(function (m) {
    return m.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  });
}

group('Three segments, Projects first');

test('An area meeting has Projects, Wins & Losses and Issues - nothing else', () => {
  eq(buttons(screen({ view: 'tab', tab: 't1' })), ['Projects', 'Wins & Losses', 'Issues']);
});

test('Tech Directors keeps its Business Review beside its own Tech-Projects', () => {
  eq(buttons(screen({ view: 'tab', tab: 'techdir' })),
    ['Tech-Projects', 'Business Review', 'Wins & Losses', 'Issues']);
});

test('A meeting opens on Projects', () => {
  ok(screen({ view: 'tab', tab: 't1' }).indexOf('id="sec-horizon"') >= 0);
});

test('A step remembered from the old five-segment agenda still lands somewhere', () => {
  const html = screen({ view: 'tab', tab: 't1', steps: { t1: 4 } });
  ok(html.indexOf('id="sec-horizon"') >= 0, 'back on Projects, not a blank stage');
});

test('Rating is gone: no score buttons, no note for next time', () => {
  segmentsFor({ id: 't1' }).forEach(function (s, i) {
    const html = screen({ view: 'tab', tab: 't1', steps: { t1: i } });
    notOk(html.indexOf('data-act="setRating"') >= 0, s.short + ': no rating');
    notOk(html.indexOf('data-edit="meetingNote"') >= 0, s.short + ': no closing note');
  });
});

test('Links into Issues find it by name, on either agenda', () => {
  eq(stepIndex({ id: 't1' }, 'issues'), 2);
  eq(stepIndex({ id: 'techdir' }, 'issues'), 3);
  // The rail's "Work through them" button, from the Projects step:
  ok(screen({ view: 'tab', tab: 't1', steps: { t1: 0 } })
    .indexOf('data-act="step" data-v="2">Work through them') >= 0);
});

group('Horizon above Current projects, in one list');

test('Both sections, Horizon first', () => {
  const html = screen({ view: 'tab', tab: 't1', steps: { t1: 0 }, dates: { t1: RAISED } });
  const h = html.indexOf('id="sec-horizon"');
  const c = html.indexOf('id="sec-current"');
  ok(h > 0 && c > h, 'Horizon, then Current projects');
  ok(html.indexOf('id="opp-pr4"') > h && html.indexOf('id="opp-pr4"') < c, 'pr4 on the Horizon');
  ok(html.indexOf('id="proj-pr1"') > c, 'pr1 in Current projects');
});

test('A Horizon tile: full title as a link, owner, due, Filter actions, the decisions', () => {
  const snap = demoBoard(DAY);
  byId(snap.projects, 'pr4').customer = 'Demo Quartz';
  byId(snap.projects, 'pr4').due = '2026-11-30';
  const html = screen({ view: 'tab', tab: 't1', steps: { t1: 0 }, dates: { t1: RAISED } }, snap);
  const row = html.slice(html.indexOf('id="opp-pr4"'), html.indexOf('</li>', html.indexOf('id="opp-pr4"')));
  ok(row.indexOf('data-act="openProject" data-id="pr4"') >= 0, 'the title opens the page');
  ok(row.indexOf('Demo Quartz - Low-odour thinner') >= 0, 'customer first');
  ok(row.indexOf('Alex Morgan') >= 0, 'owner');
  ok(row.indexOf('Due <span class="mono">') >= 0, 'due date');
  ok(row.indexOf('data-act="selectProject" data-id="pr4"') >= 0, 'Filter actions');
  ['promoted', 'hold', 'cancelled'].forEach(function (d) {
    ok(row.indexOf('data-act="oppDecide" data-id="pr4" data-v="' + d + '"') >= 0, d);
  });
  notOk(row.indexOf('data-act="projStatus"') >= 0, 'no project status buttons yet');
});

test('A Current tile keeps the five status buttons and the priority arrows', () => {
  const html = screen({ view: 'tab', tab: 't1', steps: { t1: 0 } });
  const row = html.slice(html.indexOf('id="proj-pr1"'), html.indexOf('</li>', html.indexOf('id="proj-pr1"')));
  ['on', 'off', 'hold', 'cancelled', 'done'].forEach(function (v) {
    ok(row.indexOf('data-act="projStatus" data-id="pr1" data-v="' + v + '"') >= 0, v);
  });
  ok(row.indexOf('data-act="movePriority"') >= 0, 'arrows');
});

test('The Horizon heading counts what is waiting', () => {
  const html = screen({ view: 'tab', tab: 't1', steps: { t1: 0 }, dates: { t1: RAISED } });
  ok(/id="sec-horizon"[^>]*>[\s\S]*?Horizon <span class="cnt n">1<\/span>/.test(html));
});

test('Each section folds, says it is folded, and keeps its count', () => {
  const html = screen({ view: 'tab', tab: 't1', steps: { t1: 0 }, dates: { t1: RAISED }, hideHorizon: true });
  ok(/id="sec-horizon" aria-expanded="false"/.test(html), 'Horizon reports folded');
  notOk(html.indexOf('id="opp-pr4"') >= 0, 'its tiles are hidden');
  ok(/Horizon <span class="cnt n">1<\/span>/.test(html), 'the count still shows');
  ok(html.indexOf('id="proj-pr1"') >= 0, 'Current projects is unaffected');

  const cur = screen({ view: 'tab', tab: 't1', steps: { t1: 0 }, hideCurrent: true });
  ok(/id="sec-current" aria-expanded="false"/.test(cur));
  notOk(cur.indexOf('id="proj-pr1"') >= 0);
});

test('Tech Directors has no Horizon - it raises no opportunities', () => {
  const html = screen({ view: 'tab', tab: 'techdir', steps: { techdir: 0 } });
  notOk(html.indexOf('id="sec-horizon"') >= 0);
  ok(html.indexOf('id="sec-current"') >= 0);
});

group('Working the list');

async function app() {
  const store = createStore(createMemoryAdapter({ seed: demoBoard(DAY) }), {});
  await store.load();
  const ui = Object.assign(loadUi(), { view: 'tab', tab: 't1', steps: { t1: 0 }, dates: { t1: RAISED } });
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: ui, render: function () {}, today: function () { return DAY; }
  }));
  return { store: store, ui: ui, H: H, html: function () { return screen(ui, store.snapshot()); } };
}

function settle() {
  return new Promise(function (r) { setTimeout(r, 25); });
}

test('Folding is remembered in ui, not lost on the next redraw', async () => {
  const a = await app();
  a.H.clicks.toggleSection(null, '', 'horizon');
  ok(a.ui.hideHorizon);
  notOk(a.html().indexOf('id="opp-pr4"') >= 0, 'still folded on redraw');
  a.H.clicks.toggleSection(null, '', 'horizon');
  notOk(a.ui.hideHorizon);
  a.H.clicks.toggleSection(null, '', 'nonsense');
  notOk(a.ui.hideHorizon || a.ui.hideCurrent, 'an unknown section changes nothing');
});

test('Promoting moves the tile from Horizon down into Current projects', async () => {
  const a = await app();
  a.H.clicks.oppDecide(null, 'pr4', 'promoted');
  await settle();
  const html = a.html();
  const c = html.indexOf('id="sec-current"');
  ok(html.indexOf('id="proj-pr4"') > c, 'a Current projects tile now');
  ok(html.indexOf('Promoted to Current projects') > 0 && html.indexOf('Promoted to Current projects') < c,
    'and the Horizon says so, at the meeting that decided it');
});
