// @ts-check
/**
 * When an opportunity becomes a current project.
 *
 * First reported as a gap: meetings moved to Monday, and that week's opportunities
 * left New Opportunities without arriving in Current Projects, because they waited
 * on a date seven days out. Then the rule itself changed: an opportunity becomes a
 * project only when somebody promotes it - a decision, not the calendar.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { projVisible, raisedOn } from '../src/domain/queries.js';
import { newOpportunity } from '../src/domain/projects.js';

const THURSDAY = '2026-10-01';
const MONDAY = '2026-10-05';

function raised(on) {
  return newOpportunity({
    entryId: 'e1', projectId: 'x1', tab: 't1', personId: 'p1', text: 'Trial',
    meetingDate: on
  }).project;
}

group('An opportunity becomes a project when somebody promotes it');

function promoted(on, at) {
  return Object.assign(raised(on), { oppStage: 'promoted', promotedOn: at });
}

test('It records the meeting it was raised in', () => {
  eq(raised(THURSDAY).raisedOn, THURSDAY);
});

test('Undecided, it is never in Current Projects, however long it waits', () => {
  notOk(projVisible(raised(THURSDAY), 't1', THURSDAY), 'not where it was raised');
  notOk(projVisible(raised(THURSDAY), 't1', MONDAY), 'not at the next meeting');
  notOk(projVisible(raised(THURSDAY), 't1', '2026-12-28'), 'not months later');
});

test('Promoted, it is a project from the meeting that decided it', () => {
  // The reported case was a meeting moving weekday. With a decision instead of a
  // date, the weekday cannot strand anything.
  const p = promoted(THURSDAY, MONDAY);
  ok(projVisible(p, 't1', MONDAY), 'the meeting it was promoted in');
  ok(projVisible(p, 't1', '2026-10-12'), 'and after');
  notOk(projVisible(p, 't1', THURSDAY), 'not before');
});

test('Promoted at the meeting it was raised in, it is a project at once', () => {
  ok(projVisible(promoted(THURSDAY, THURSDAY), 't1', THURSDAY));
});

test('An older opportunity nobody touched is undecided', () => {
  // Only `start` and status `new`: never worked on, so it waits for a decision.
  const old = { tab: 't1', status: 'new', fromOpp: 'e1', start: '2026-10-08' };
  eq(raisedOn(old), THURSDAY, 'its raised date is worked back from start');
  notOk(projVisible(old, 't1', MONDAY));
});

test('An older one somebody gave a status to was already a project', () => {
  const run = { tab: 't1', status: 'on', fromOpp: 'e1', start: '2026-10-08' };
  ok(projVisible(run, 't1', MONDAY), 'so it stays in Current Projects');
});

test('A project that did not start as an opportunity still waits for its start', () => {
  const planned = { tab: 't1', status: 'on', start: '2026-10-12' };
  eq(raisedOn(planned), '');
  notOk(projVisible(planned, 't1', MONDAY));
  ok(projVisible(planned, 't1', '2026-10-12'));
});

/* ------------------------------------------------- moving a project's meeting */

import { moveProject } from '../src/domain/cascade.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';
import { byId } from '../src/lib/seq.js';

group('Moving a project to another meeting');

test('The project moves, and so do its action items', () => {
  const snap = demoBoard('2026-09-22');
  const r = moveProject(snap, 'pr2', 't2');
  const by = function (col, id) {
    return r.writes.filter(function (w) { return w.col === col && w.id === id; })[0];
  };
  eq(by('projects', 'pr2').patch.tab, 't2');
  eq(by('actions', 'a1').patch.tab, 't2', 'a1 belongs to pr2, so it goes too');
  notOk(by('actions', 'a2'), 'an action of nothing stays put');
  notOk(by('actions', 'a4'), 'another project’s action stays put');
  ok(r.message.indexOf('Southern Area') >= 0, 'and says where it went');
});

test('It joins the bottom of the new list rather than keeping an old position', () => {
  const snap = demoBoard('2026-09-22');
  byId(snap.projects, 'pr2').priority = 0;
  eq(moveProject(snap, 'pr2', 't2').writes[0].patch.priority, null);
});

test('Undo puts everything back where it was', () => {
  const snap = demoBoard('2026-09-22');
  byId(snap.projects, 'pr2').priority = 3;
  const r = moveProject(snap, 'pr2', 't2');
  const undo = function (col, id) {
    return r.undo.filter(function (w) { return w.col === col && w.id === id; })[0];
  };
  eq(undo('projects', 'pr2').patch, { tab: 't1', priority: 3 });
  eq(undo('actions', 'a1').patch, { tab: 't1' });
});

test('Choosing the meeting it is already in, or one that does not exist, does nothing', () => {
  const snap = demoBoard('2026-09-22');
  eq(moveProject(snap, 'pr2', 't1').writes, []);
  eq(moveProject(snap, 'pr2', 'nowhere').writes, []);
});

test('The project page offers every meeting, with its own selected', () => {
  const html = renderApp(demoBoard('2026-09-22'),
    Object.assign(loadUi(), { view: 'project', project: 'pr2' }),
    { today: '2026-09-22', modes: { content: 'live', settings: 'live', details: 'live' },
      identity: { kind: 'demo', personId: 'p1' } });
  const sel = /<select[^>]*data-edit="projTab"[\s\S]*?<\/select>/.exec(html);
  ok(sel, 'there is a Meeting picker');
  if (!sel) return;
  ok(sel[0].indexOf('<option value="t1" selected>') > 0, 'Northern is chosen');
  ok(sel[0].indexOf('value="t2"') > 0 && sel[0].indexOf('value="techdir"') > 0, 'the others offered');
});

test('Through the page: it moves, shows in the new meeting, and can be undone', async () => {
  const store = createStore(createMemoryAdapter({ seed: demoBoard('2026-09-22') }), {});
  await store.load();
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: loadUi(), render: function () {},
    today: function () { return '2026-09-22'; }
  }));
  H.edits.projTab(/** @type {any} */ ({ dataset: { id: 'pr2' }, value: 't2' }));
  await new Promise(function (r) { setTimeout(r, 25); });
  eq(byId(store.snapshot().projects, 'pr2').tab, 't2');
  eq(byId(store.snapshot().actions, 'a1').tab, 't2');
  ok(projVisible(byId(store.snapshot().projects, 'pr2'), 't2', '2026-09-22'),
    'it is a current project there');

  await store.undo();
  eq(byId(store.snapshot().projects, 'pr2').tab, 't1', 'undone');
  eq(byId(store.snapshot().actions, 'a1').tab, 't1');
});
