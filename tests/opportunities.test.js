// @ts-check
/**
 * An opportunity is not a project until somebody decides it is.
 *
 * Requested: opportunities and projects separated by a manual step, with three
 * decisions - Promote to project, Put on hold, Cancel. An opportunity can carry
 * actions meanwhile, but stays out of Current Projects and the Projects list.
 *
 * The demo board's pr4 is one: raised at Northern on 21 Sep (entry e3), never
 * decided. These tests take it through each decision.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';
import { oppStage, isOpportunity, projVisible } from '../src/domain/queries.js';
import {
  decideOpportunity, decisionsFor, carriedOpportunities
} from '../src/domain/opportunities.js';
import { linkedProjectGoesToo } from '../src/domain/projects.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';
import { byId } from '../src/lib/seq.js';

const DAY = '2026-09-22';        // a Tuesday; Northern meets Mondays
const RAISED = '2026-09-21';     // the meeting pr4 was raised at
const NEXT = '2026-09-28';
const LIVE = { content: 'live', settings: 'live', details: 'live' };

function screen(snap, ui) {
  return renderApp(snap, Object.assign(loadUi(), ui),
    { today: DAY, modes: LIVE, identity: { kind: 'demo', personId: 'p1' } });
}

function opps(snap, week) {
  return screen(snap, { view: 'tab', tab: 't1', steps: { t1: 1 }, dates: { t1: week } });
}

function currentProjects(snap, week) {
  return screen(snap, { view: 'tab', tab: 't1', steps: { t1: 2 }, dates: { t1: week } });
}

function decided(stage, on) {
  const snap = demoBoard(DAY);
  Object.assign(byId(snap.projects, 'pr4'), { oppStage: stage, oppDecided: on },
    stage === 'promoted' ? { promotedOn: on } : {});
  return snap;
}

group('Where an opportunity stands');

test('Untouched opportunities on an older board count as undecided', () => {
  const snap = demoBoard(DAY);
  eq(oppStage(byId(snap.projects, 'pr4')), 'open');
  ok(isOpportunity(byId(snap.projects, 'pr4')));
});

test('One somebody already gave a status was being run as a project', () => {
  eq(oppStage({ fromOpp: 'e1', status: 'on' }), 'promoted');
  notOk(isOpportunity({ fromOpp: 'e1', status: 'on' }));
});

test('A project that never was an opportunity has no stage', () => {
  eq(oppStage(byId(demoBoard(DAY).projects, 'pr1')), null);
  notOk(isOpportunity(byId(demoBoard(DAY).projects, 'pr1')));
});

test('The decisions offered follow where it stands', () => {
  const names = function (p) { return decisionsFor(p).map(function (d) { return d[1]; }); };
  eq(names({ fromOpp: 'e', status: 'new' }), ['Promote to project', 'Put on hold', 'Cancel']);
  eq(names({ fromOpp: 'e', status: 'new', oppStage: 'hold' }), ['Promote to project', 'Cancel']);
  eq(names({ fromOpp: 'e', status: 'new', oppStage: 'promoted' }), []);
  eq(names({ fromOpp: 'e', status: 'new', oppStage: 'cancelled' }), []);
});

group('Making the decision');

test('Promoting dates it to the meeting that decided', () => {
  const r = decideOpportunity(demoBoard(DAY), 'pr4', 'promoted', NEXT);
  eq(r.writes[0].patch, { oppStage: 'promoted', oppDecided: NEXT, promotedOn: NEXT });
});

test('Holding and cancelling do not make it a project', () => {
  notOk('promotedOn' in decideOpportunity(demoBoard(DAY), 'pr4', 'hold', NEXT).writes[0].patch);
  notOk('promotedOn' in decideOpportunity(demoBoard(DAY), 'pr4', 'cancelled', NEXT).writes[0].patch);
});

test('A decision that is not on offer does nothing', () => {
  eq(decideOpportunity(decided('hold', RAISED), 'pr4', 'hold', NEXT).writes, []);
  eq(decideOpportunity(demoBoard(DAY), 'pr4', 'delete-everything', NEXT).writes, []);
  eq(decideOpportunity(demoBoard(DAY), 'pr1', 'promoted', NEXT).writes, [], 'not an opportunity');
});

test('Undo writes the old values back, as nulls where there were none', () => {
  // A merge ignores a missing key, so leaving it out would undo nothing.
  const r = decideOpportunity(demoBoard(DAY), 'pr4', 'promoted', NEXT);
  eq(r.undo[0].patch, { oppStage: null, oppDecided: null, promotedOn: null });
});

group('What each decision does to the board');

test('Undecided: in New Opportunities, nowhere a project would be', () => {
  const snap = demoBoard(DAY);
  notOk(currentProjects(snap, NEXT).indexOf('id="proj-pr4"') >= 0, 'not in Current Projects');
  notOk(screen(snap, { view: 'projects' }).indexOf('data-id="pr4"') >= 0, 'not in the Projects list');
  ok(opps(snap, NEXT).indexOf('From earlier meetings') >= 0, 'carried to the next meeting');
  ok(opps(snap, NEXT).indexOf('data-act="oppDecide" data-id="pr4" data-v="promoted"') >= 0,
    'with the decision on offer');
});

test('Raised today: decided on the spot, from its own tile', () => {
  const html = opps(demoBoard(DAY), RAISED);
  ok(html.indexOf('data-act="oppDecide" data-id="pr4" data-v="hold"') >= 0);
  notOk(html.indexOf('From earlier meetings') >= 0, 'not listed twice');
});

test('Promoted: a project from that meeting, and in the Projects list', () => {
  const snap = decided('promoted', NEXT);
  ok(currentProjects(snap, NEXT).indexOf('id="proj-pr4"') >= 0, 'in Current Projects');
  notOk(currentProjects(snap, RAISED).indexOf('id="proj-pr4"') >= 0, 'not before');
  ok(screen(snap, { view: 'projects' }).indexOf('data-id="pr4"') >= 0, 'and the list');
  ok(opps(snap, NEXT).indexOf('Promoted to Current Projects') >= 0, 'seen where it was decided');
  notOk(opps(snap, '2026-10-05').indexOf('data-id="pr4"') >= 0, 'and gone from it after');
});

test('On hold: stays under New Opportunities, offering Promote and Cancel', () => {
  const snap = decided('hold', NEXT);
  const html = opps(snap, '2026-10-05');
  ok(html.indexOf('<span class="chip ps-hold">On hold</span>') >= 0);
  ok(html.indexOf('data-id="pr4" data-v="promoted"') >= 0);
  notOk(html.indexOf('data-id="pr4" data-v="hold"') >= 0, 'not hold again');
  notOk(currentProjects(snap, '2026-10-05').indexOf('id="proj-pr4"') >= 0);
});

test('Cancelled: shown where it was cancelled, then gone', () => {
  const snap = decided('cancelled', NEXT);
  ok(opps(snap, NEXT).indexOf('<span class="chip ps-cancelled">Cancelled</span>') >= 0);
  notOk(opps(snap, '2026-10-05').indexOf('data-id="pr4"') >= 0);
  notOk(currentProjects(snap, '2026-10-05').indexOf('id="proj-pr4"') >= 0);
});

test('Carried oldest first, and only from this meeting', () => {
  const snap = demoBoard(DAY);
  snap.projects.push({ id: 'o2', tab: 't1', fromOpp: 'x', status: 'new', raisedOn: '2026-09-14' });
  snap.projects.push({ id: 'o3', tab: 't2', fromOpp: 'y', status: 'new', raisedOn: '2026-09-14' });
  eq(carriedOpportunities(snap, 't1', NEXT).map(function (p) { return p.id; }), ['o2', 'pr4']);
});

group('An opportunity carries work before it is a project');

test('Actions can be attached to it, under its own heading', () => {
  const html = screen(demoBoard(DAY), { view: 'tab', tab: 't1', steps: { t1: 3 }, open: 'rail' });
  const group = /<optgroup label="Opportunities">[\s\S]*?<\/optgroup>/.exec(html);
  ok(group, 'an Opportunities group in Related to');
  if (group) ok(group[0].indexOf('value="p:pr4"') >= 0, 'offering pr4');
  const projects = /<optgroup label="Projects">[\s\S]*?<\/optgroup>/.exec(html);
  if (projects) notOk(projects[0].indexOf('p:pr4') >= 0, 'and not as a project');
});

test('A cancelled one is not offered', () => {
  const html = screen(decided('cancelled', RAISED),
    { view: 'tab', tab: 't1', steps: { t1: 3 }, open: 'rail' });
  notOk(html.indexOf('value="p:pr4"') >= 0);
});

test('Its page says Opportunity and offers the decision, not a project status', () => {
  const html = screen(demoBoard(DAY), { view: 'project', project: 'pr4' });
  ok(html.indexOf('<h2>Opportunity</h2>') >= 0);
  ok(html.indexOf('data-act="oppDecide" data-id="pr4" data-v="promoted"') >= 0);
  notOk(html.indexOf('data-act="projStatus" data-id="pr4"') >= 0, 'no On track / Off track');
});

test('Promoted, its page is a project page again', () => {
  const html = screen(decided('promoted', NEXT), { view: 'project', project: 'pr4' });
  ok(html.indexOf('data-act="projStatus" data-id="pr4"') >= 0);
  notOk(html.indexOf('<h2>Opportunity</h2>') >= 0);
});

test('Deleting the entry of one that was decided leaves the project alone', () => {
  const snap = decided('hold', RAISED);
  notOk(linkedProjectGoesToo(snap, byId(snap.entries, 'e3')));
  ok(linkedProjectGoesToo(demoBoard(DAY), byId(demoBoard(DAY).entries, 'e3')),
    'an undecided, untouched one still goes with it');
});

test('Undecided opportunities are left out of the Timeline and Business Review', () => {
  const snap = demoBoard(DAY);
  byId(snap.projects, 'pr4').due = '2026-10-30';
  notOk(screen(snap, { view: 'timeline' }).indexOf('Low-odour thinner') >= 0, 'timeline');
  notOk(screen(snap, { view: 'tab', tab: 'techdir', steps: { techdir: 1 } })
    .indexOf('Low-odour thinner') >= 0, 'business review');
});

test('Through the page: promote, see it in Current Projects, undo', async () => {
  const store = createStore(createMemoryAdapter({ seed: demoBoard(DAY) }), {});
  await store.load();
  const ui = Object.assign(loadUi(), { view: 'tab', tab: 't1', dates: { t1: NEXT } });
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: ui, render: function () {}, today: function () { return DAY; }
  }));
  H.clicks.oppDecide(null, 'pr4', 'promoted');
  await new Promise(function (r) { setTimeout(r, 25); });
  const p = byId(store.snapshot().projects, 'pr4');
  eq(p.promotedOn, NEXT, 'dated to the week on screen');
  ok(projVisible(p, 't1', NEXT));

  await store.undo();
  ok(isOpportunity(byId(store.snapshot().projects, 'pr4')), 'undone: an opportunity again');
});
