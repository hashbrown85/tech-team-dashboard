// @ts-check
/**
 * The meeting rail says where each action came from.
 *
 * Requested: under each action's text, the company and project it is tied to, or
 * the issue it was raised from. A line under the text rather than grouping the
 * rail under headers: the rail is ordered soonest-due first in a narrow column,
 * and "Filter actions" on a project tile already gathers one project's actions.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';

const DAY = '2026-09-22';

function rail(snap, ui) {
  const html = renderApp(snap, Object.assign(loadUi(),
    { view: 'tab', tab: 't1', steps: { t1: 0 } }, ui || {}),
    { today: DAY, modes: { content: 'live', settings: 'live', details: 'live' },
      identity: { kind: 'demo', personId: 'p1' } });
  return html;
}

/** One action's row in the rail. */
function row(html, id) {
  const at = html.indexOf('<li class="arow');
  const start = html.indexOf('id="row-' + id + '"', at);
  return start < 0 ? '' : html.slice(start, html.indexOf('</li>', start));
}

function board() {
  const snap = demoBoard(DAY);
  snap.actions.push(
    { id: 'ai', num: 20, tab: 't1', text: 'Ask the lab for rheometer time', owner: 'Alex Morgan',
      due: '2026-10-01', status: 'open', parent: { type: 'issue', id: 'i1' }, meeting: DAY },
    { id: 'ao', num: 21, tab: 't1', text: 'Call them on Thursday', owner: 'Alex Morgan',
      due: '2026-10-02', status: 'open', parent: { type: 'project', id: 'pr4' }, meeting: DAY });
  return snap;
}

group('Each action in the rail names where it came from');

test('A project action: the company and the project, as the tile names it', () => {
  const r = row(rail(board()), 'a1');
  ok(r.indexOf('<span class="aorig">Project · ') >= 0);
  ok(r.indexOf('data-act="openProject" data-id="pr2">Halden Industrial - Sealant reformulation</button>') >= 0,
    'a link to the project, customer first');
});

test('It sits under the action text, inside the same cell', () => {
  const r = row(rail(board()), 'a1');
  ok(/<span class="atext">[^<]*Send the freeze-thaw data[\s\S]*?<span class="aorig">[\s\S]*?<\/span><\/span>/.test(r));
});

test('A project with no customer is named by its name alone', () => {
  ok(row(rail(board()), 'a4').indexOf('>Pigment supplier qualification</button>') >= 0);
});

test('An issue action names the issue, and links to it in Issues', () => {
  const snap = board();
  const issue = snap.issues.filter(function (i) { return i.id === 'i1'; })[0];
  const r = row(rail(snap), 'ai');
  ok(r.indexOf('<span class="aorig">Issue · ') >= 0);
  ok(r.indexOf('data-act="openIssue" data-id="t1" data-v="iss-i1">' + issue.text + '</button>') >= 0);
});

test('An opportunity action says it is an opportunity, not a project', () => {
  ok(row(rail(board()), 'ao').indexOf('<span class="aorig">Opportunity · ') >= 0);
});

test('An action raised on its own has no line at all', () => {
  const r = row(rail(board()), 'a2');
  ok(r, 'a2 is in the rail');
  notOk(r.indexOf('aorig') >= 0, 'no empty or "none" line');
});

test('Filtered to one project, the line is left off - it would repeat on every row', () => {
  const html = rail(board(), { railProj: 'pr2' });
  ok(row(html, 'a1'), 'a1 is shown');
  notOk(row(html, 'a1').indexOf('aorig') >= 0);
  ok(html.indexOf('<h2>Halden Industrial - Sealant reformulation</h2>') >= 0,
    'and the rail heading names the project in full');
});
