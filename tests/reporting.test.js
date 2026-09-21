// @ts-check
/**
 * Entering a win, an opportunity or a project.
 *
 * These three segments used to carry one "+" button inside each person's block, so
 * the owner was whoever's block you clicked in — the only place in the app where an
 * owner was implied by position rather than chosen. You could not enter somebody
 * else's item, and nothing on the form said whose it was.
 *
 * They ask now, the way the Issues segment always has. Opportunities and projects
 * also take a supporting person; wins and losses do not.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { loadUi } from '../src/ui.js';
import { newProject, newOpportunity } from '../src/domain/projects.js';

const MODES = { content: 'live', settings: 'live', details: 'live' };
const base = loadUi();

/** A meeting segment, with a form open if asked for. */
function seg(step, open) {
  const snap = demoBoard('2026-09-22');
  return renderApp(snap, Object.assign({}, base, {
    view: 'tab', tab: 't1', steps: { t1: step }, open: open || null
  }), { today: '2026-09-22', modes: MODES, identity: { kind: 'local', personId: 'p1' } });
}

/** One rendered form. */
function formOf(html, name) {
  return (new RegExp('<form[^>]*data-form="' + name + '"[\\s\\S]*?</form>')).exec(html);
}

const SEGMENTS = [
  ['wl', 0, 'Win or loss', false],
  ['opp', 1, 'Opportunity', true],
  ['project', 2, 'Project', true]
];

group('Every reporting segment asks whose item it is');

SEGMENTS.forEach(function (s) {
  const key = s[0];
  const step = s[1];
  const withSupport = s[3];

  test('The ' + key + ' form has an owner field', () => {
    const f = formOf(seg(step, key), key);
    ok(f, 'the form rendered');
    if (!f) return;
    ok(/name="who"[^>]*required/.test(f[0]), 'owner is asked for, and required');
    ok(f[0].indexOf('<option value="p1"') >= 0, 'offering the people on the board');
  });

  test('The ' + key + ' form ' + (withSupport ? 'takes' : 'does not take') +
    ' a supporting person', () => {
    const f = formOf(seg(step, key), key);
    ok(f, 'the form rendered');
    if (!f) return;
    const has = f[0].indexOf('name="support"') >= 0;
    eq(has, withSupport, withSupport ? 'it asks' : 'it does not ask');
    if (withSupport) {
      ok(/name="support"[\s\S]*?<option value=""/.test(f[0]),
        'and supporting is optional - there is a blank');
      notOk(/name="support"[^>]*required/.test(f[0]), 'never required');
    }
  });

  test('There is one ' + key + ' form for the segment, not one per person', () => {
    // The old shape rendered a button inside every person's block. The form key
    // carried the person id, which is what made the owner implicit.
    const html = seg(step);
    const buttons = html.match(
      new RegExp('data-act="openForm" data-v="' + key + '[^"]*"', 'g')) || [];
    eq(buttons.length, 1, 'exactly one way in');
    ok(buttons[0].indexOf('data-v="' + key + '"') >= 0, 'and it is not keyed by person');
  });
});

group('Who is supporting, once it is entered');

test('An opportunity row says who is helping', () => {
  const snap = demoBoard('2026-09-22');
  const opp = snap.entries.filter(function (e) { return e.kind === 'opp'; })[0];
  ok(opp, 'the demo board has an opportunity');
  if (!opp) return;
  opp.support = 'p2';

  const html = renderApp(snap, Object.assign({}, base, {
    view: 'tab', tab: 't1', steps: { t1: 1 }, dates: { t1: opp.meeting }
  }), { today: '2026-09-22', modes: MODES, identity: { kind: 'local', personId: 'p1' } });

  ok(html.indexOf('class="it-s"') >= 0, 'on its own line under the title');
  // Owner first, then the helper - the line carries both now that the per-person
  // heading is gone and the row is the only place either name appears.
  ok(/class="it-s">[^<]+ · with [A-Z]/.test(html), 'naming them, not showing an id');
});

test('A project row says who is helping, without gaining a grid child', () => {
  // `.proj` is a two-column grid whose child count tools/layout-check.mjs asserts.
  // The supporter is folded into the meta line rather than added beside it.
  const snap = demoBoard('2026-09-22');
  const p = snap.projects.filter(function (x) { return x.tab === 't1'; })[0];
  p.support = 'p2';

  const html = renderApp(snap, Object.assign({}, base, {
    view: 'tab', tab: 't1', steps: { t1: 2 }
  }), { today: '2026-09-22', modes: MODES, identity: { kind: 'local', personId: 'p1' } });

  ok(/with [A-Z][a-z]+ [A-Z]/.test(html), 'the name is on the row');
  const row = new RegExp('<li class="proj[^"]*" id="proj-' + p.id + '"[\\s\\S]*?</li>')
    .exec(html);
  if (row) notOk(row[0].indexOf('class="it-s"') >= 0, 'not as an extra child');
});

test('No supporter means nothing extra is rendered', () => {
  // Every project on the demo board starts without one, so this is the normal case.
  const html = seg(2);
  notOk(/with undefined|with Unassigned/.test(html), 'and certainly not a placeholder');
});

group('What gets stored');

test('A project keeps its supporting person', () => {
  const p = newProject({
    tab: 't1', personId: 'p1', support: 'p2', name: 'A thing',
    due: '', meetingDate: '2026-09-21'
  });
  eq(p.personId, 'p1');
  eq(p.support, 'p2');
});

test('Support is a person id, not a name', () => {
  // Actions store their owner by NAME, which is the wart the owner-id migration
  // exists to remove. Nothing new should copy it: a rename would orphan it.
  const p = newProject({
    tab: 't1', personId: 'p1', support: 'p2', name: 'A thing',
    due: '', meetingDate: '2026-09-21'
  });
  ok(/^p\d+$/.test(p.support), 'an id, so renaming the person cannot break it');
});

test('Leaving support blank stores a blank, not undefined', () => {
  // `undefined` would round-trip through the schema as the string "undefined".
  const p = newProject({
    tab: 't1', personId: 'p1', name: 'A thing', due: '', meetingDate: '2026-09-21'
  });
  eq(p.support, '');
});

test('An opportunity carries its supporter onto both records it creates', () => {
  // It writes two documents - the log entry and the project - and both need it, or
  // the supporter disappears the week it becomes a current project.
  const built = newOpportunity({
    entryId: 'e9', projectId: 'pr9', tab: 't1', personId: 'p1', support: 'p2',
    text: 'A new thing', why: '', meetingDate: '2026-09-21',
    customer: '', winPct: '', winReason: '', focus: []
  });
  eq(built.entry.support, 'p2', 'on the entry');
  eq(built.project.support, 'p2', 'and on the project it becomes');
});
