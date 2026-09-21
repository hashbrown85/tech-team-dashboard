// @ts-check
/**
 * Areas, permission groups, and being honest about a board you cannot fully see.
 *
 * None of this restricts anything — that has to be the store refusing to send rows,
 * the way `projectDetails` already does. These are the concepts an eventual real
 * restriction needs, plus the parts of the app that would quietly report a wrong
 * number if one ever arrived.
 *
 * `detailAreas` was a per-person, per-area read gate of exactly this shape and was
 * retired because it was enforced in the browser and therefore cosmetic. Keep these
 * honest about what they are.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import {
  areasFor, seesAllAreas, areaOfRecord, boardIsComplete, withheld, withheldLabels,
  openActsFor
} from '../src/domain/queries.js';
import { stats } from '../src/domain/dueness.js';
import { renderApp } from '../src/views/render.js';
import { blankSnapshot } from '../src/adapters/DataStore.js';
import { loadUi } from '../src/ui.js';
import { areaReadonly } from '../src/views/render.js';
import { connPill } from '../src/views/shell.js';

/** Two areas, one cross-area meeting, and people spread across them. */
function board() {
  return Object.assign(blankSnapshot(), {
    people: [
      { id: 'north', name: 'Nora North' },
      { id: 'south', name: 'Sam South' },
      { id: 'both', name: 'Bo Both' },
      { id: 'boss', name: 'Tess Director' },
      { id: 'nobody', name: 'Newly Hired' }
    ],
    tabs: [
      { id: 'n', name: 'Northern Area', kind: 'area',
        members: ['north'], support: ['both'], optional: [] },
      { id: 's', name: 'Southern Area', kind: 'area',
        members: ['south', 'both'], support: [], optional: [] },
      { id: 'techdir', name: 'Tech Directors', kind: 'internal',
        members: ['boss'], support: [], optional: [] },
      { id: 'other', name: 'Some Initiative', kind: 'internal',
        members: ['north'], support: [], optional: [] }
    ],
    projects: [{ id: 'pr1', tab: 'n', name: 'A northern project', status: 'on' }]
  });
}

const names = function (tabs) { return tabs.map(function (t) { return t.id; }).sort(); };

group('Which areas somebody belongs to');

test('An area is a meeting, and you belong by being on its list', () => {
  // No separate area entity and no field to keep in step - the roster and the areas
  // are the same thing, so they cannot drift apart.
  const b = board();
  eq(names(areasFor(b, 'north')), ['n']);
  eq(names(areasFor(b, 'south')), ['s']);
});

test('Any attendance role counts, not just reporting', () => {
  // Somebody supporting a meeting still sits in that room and hears that work.
  eq(names(areasFor(board(), 'both')), ['n', 's'], 'supporting one, reporting in the other');
});

test('Internal meetings are not areas', () => {
  // 'north' is also on "Some Initiative", which is internal. That is not an area.
  eq(names(areasFor(board(), 'north')), ['n'], 'the initiative does not count');
  eq(areasFor(board(), 'boss').length, 0, 'Tech Directors is not an area either');
});

test('Somebody on no meeting at all belongs to no area', () => {
  eq(areasFor(board(), 'nobody'), []);
  eq(areasFor(board(), null), [], 'and neither does nobody');
});

group('Who reaches across areas');

test('Tech Directors is what makes somebody cross-area', () => {
  ok(seesAllAreas(board(), 'boss'));
  notOk(seesAllAreas(board(), 'north'));
});

test('Being in two areas is not the same as seeing them all', () => {
  // A distinction worth keeping: 'both' sees two areas because they attend two
  // meetings, not because they have any standing to see the rest.
  eq(names(areasFor(board(), 'both')), ['n', 's']);
  notOk(seesAllAreas(board(), 'both'), 'two is not all');
});

test('Nobody is cross-area by default', () => {
  notOk(seesAllAreas(board(), 'nobody'));
  notOk(seesAllAreas(board(), null));
});

group('Which area a record belongs to');

test('A record belongs to the area of its meeting', () => {
  const b = board();
  eq(areaOfRecord(b, { tab: 'n' }).id, 'n');
});

test('A record in an internal meeting has no area', () => {
  // The Tech Directors meeting is not an area, so its actions belong to none.
  eq(areaOfRecord(board(), { tab: 'techdir' }), null);
});

test('Things reached only through a project have no area of their own', () => {
  // projectDetails and projectNotes carry no `tab` - they hang off a project, and
  // have to be asked about via that project. Worth pinning, because getting this
  // wrong would leak the very fields that are already restricted.
  eq(areaOfRecord(board(), { projectId: 'pr1', text: 'a note' }), null);
  eq(areaOfRecord(board(), {}), null);
  eq(areaOfRecord(board(), null), null);
});

group('Being honest about a board you cannot fully see');

test('A whole board says so', () => {
  ok(boardIsComplete(blankSnapshot()));
  eq(withheld(blankSnapshot()), []);
});

test('A board with something withheld says that too', () => {
  const b = Object.assign(blankSnapshot(), { denied: ['projectDetails'] });
  notOk(boardIsComplete(b));
  eq(withheld(b), ['projectDetails']);
});

test('What was withheld is named the way a person would name it', () => {
  // "projectDetails" is a list name. Nobody being told what they cannot see should
  // be shown one.
  const b = Object.assign(blankSnapshot(), { denied: ['projectDetails'] });
  eq(withheldLabels(b), ['project values']);
});

test('An unknown collection falls back to its own name rather than vanishing', () => {
  const b = Object.assign(blankSnapshot(), { denied: ['somethingNew'] });
  eq(withheldLabels(b), ['somethingNew'], 'said awkwardly beats not said');
});

test('The Overview stops claiming a total it cannot know', () => {
  const base = loadUi();
  const env = {
    today: '2026-09-21',
    modes: { content: 'live', settings: 'live', details: 'live' },
    identity: { kind: 'local', displayName: 'Nora', person: null, personId: 'north' }
  };
  const whole = renderApp(board(), Object.assign({}, base, { view: 'overview' }), env);

  const partial = Object.assign(board(), { denied: ['projectDetails'] });
  const shown = renderApp(partial, Object.assign({}, base, { view: 'overview' }), env);

  ok(whole.indexOf('across all meetings') >= 0, 'a whole board says all meetings');
  notOk(whole.indexOf('not sent to you') >= 0, 'and explains nothing, correctly');

  ok(shown.indexOf('across what you can see') >= 0, 'a partial one does not claim all');
  ok(shown.indexOf('project values') >= 0, 'and says what is missing, in words');
});

group('The third permission group reaches the screen');

test('Project value can be read-only while the rest of the page is not', () => {
  // `details` is not a screen - the annual value sits among fields anybody may edit -
  // so it cannot be folded into areaReadonly. It went unwired when it was added, and
  // somebody allowed to read the money but not change it got a box that rejected the
  // click.
  const env = {
    today: '2026-09-21',
    modes: { content: 'live', settings: 'live', details: 'readonly' },
    identity: { kind: 'local', displayName: 'Nora', person: null, personId: 'north' }
  };
  const html = renderApp(board(),
    Object.assign({}, loadUi(), { view: 'project', project: 'pr1' }), env);

  const value = /<input[^>]*data-edit="pdValue"[^>]*>/.exec(html);
  ok(value, 'the annual value field rendered');
  if (value) ok(value[0].indexOf('disabled') >= 0, 'and it is disabled');

  const win = /<input[^>]*data-edit="pdWin"[^>]*>/.exec(html);
  ok(win, 'win confidence rendered');
  if (win) notOk(win[0].indexOf('disabled') >= 0, 'and is still editable - it is content');
});

test('areaReadonly is not confused by the third group', () => {
  const ui = { view: 'overview', settings: false };
  notOk(areaReadonly(ui, { content: 'live', settings: 'live', details: 'readonly' }),
    'the page is not read-only just because the money is');
  ok(areaReadonly(ui, { content: 'readonly', settings: 'live', details: 'live' }));
});

test('The save pill waits for all three groups before saying Live', () => {
  // It knew about two. A board still working out the third reported itself Live.
  ok(connPill({ content: 'live', settings: 'live', details: 'connecting' }, false)
    .indexOf('Connecting') >= 0, 'still connecting');
  ok(connPill({ content: 'live', settings: 'live', details: 'live' }, false)
    .indexOf('Live') >= 0, 'all three in, and only then');
});

group('What would go wrong on a partial board');

test('openActsFor counts what it was given, and that decides real behaviour', () => {
  // There is no flag saying an issue has an owner - it is derived by counting. Miss
  // the actions and an owned issue reads as ownerless, returns to the queue, and is
  // counted as a show-stopper. The same count drives auto-resolve, so this can change
  // what gets WRITTEN, not only what is shown. Pinned so that anyone adding filtering
  // has to come and read this.
  const withActions = Object.assign(blankSnapshot(), {
    issues: [{ id: 'i1', tab: 'n', status: 'open', sev: 'stopper' }],
    actions: [{ id: 'a1', tab: 'n', status: 'open', parent: { type: 'issue', id: 'i1' } }]
  });
  eq(openActsFor(withActions, 'i1'), 1, 'the issue has a path');

  const actionsMissing = Object.assign({}, withActions, { actions: [] });
  eq(openActsFor(actionsMissing, 'i1'), 0, 'and without them it silently has none');

  eq(stats(withActions, 'all', '2026-09-21').stop, 0, 'not a show-stopper');
  eq(stats(actionsMissing, 'all', '2026-09-21').stop, 1,
    'but it becomes one the moment its actions are out of view');
});

test('An action can point at an issue in another meeting', () => {
  // Which is why per-area filtering cannot simply be applied to actions: the action
  // that gives a northern issue its path may have been agreed in Tech Directors.
  const cross = Object.assign(blankSnapshot(), {
    issues: [{ id: 'i1', tab: 'n', status: 'open', sev: 'stopper' }],
    actions: [{ id: 'a1', tab: 'techdir', status: 'open', parent: { type: 'issue', id: 'i1' } }]
  });
  eq(openActsFor(cross, 'i1'), 1, 'the tab is not consulted, deliberately');
});
