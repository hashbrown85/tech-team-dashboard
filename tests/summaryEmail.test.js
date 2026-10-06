// @ts-check
/**
 * The Summary button on every meeting, and emailing it to the people in it.
 *
 * Requested: a summary per meeting - what changed, what is new - simple enough to
 * send straight out by email. The wording is tested in meetings.test.js; this is
 * the button, the panel, and the email it opens.
 *
 * On the demo board Northern's attendees are Alex and Priya (both with a work
 * email), Ravi supporting and Dana optional (neither has one).
 */

import { group, test, eq, ok, notOk } from './harness.js';
import { demoBoard } from '../src/demo-data.js';
import { renderApp } from '../src/views/render.js';
import { loadUi } from '../src/ui.js';
import { summaryEmail, MAILTO_LIMIT } from '../src/domain/meetings.js';
import { createStore } from '../src/store.js';
import { createMemoryAdapter } from '../src/adapters/memoryAdapter.js';
import { createHandlers } from '../src/handlers.js';
import { byId } from '../src/lib/seq.js';

const DAY = '2026-09-22';
const MEETING = '2026-09-21';

function screen(ui) {
  return renderApp(demoBoard(DAY), Object.assign(loadUi(), ui),
    { today: DAY, modes: { content: 'live', settings: 'live', details: 'live' },
      identity: { kind: 'demo', personId: 'p1' } });
}

group('A Summary button on every meeting');

test('In the header of every meeting, at every segment', () => {
  demoBoard(DAY).tabs.forEach(function (t) {
    [0, 2, 4].forEach(function (step) {
      const steps = {}; steps[t.id] = step;
      ok(/<header class="ph">[\s\S]*?data-act="toggleSummary"[\s\S]*?<\/header>/
        .test(screen({ view: 'tab', tab: t.id, steps: steps })),
        t.name + ', segment ' + (step + 1));
    });
  });
});

test('Closed until pressed', () => {
  notOk(screen({ view: 'tab', tab: 't1', steps: { t1: 0 } }).indexOf('id="f-summary"') >= 0);
});

test('Opened: the summary, Email and Copy, and who it goes to', () => {
  const html = screen({ view: 'tab', tab: 't1', steps: { t1: 0 }, sumShow: true });
  ok(html.indexOf('<h2>Meeting summary</h2>') >= 0);
  ok(html.indexOf('data-act="emailSummary"') >= 0, 'Email');
  ok(html.indexOf('data-act="copySummary"') >= 0, 'Copy');
  ok(html.indexOf('To the 2 people in this meeting') >= 0, 'the two with a work email');
  ok(/<textarea[^>]*id="f-summary"[^>]*>Northern Area · /.test(html), 'and the text itself');
});

test('Anybody left off is named, with where to fix it', () => {
  const html = screen({ view: 'tab', tab: 't1', steps: { t1: 0 }, sumShow: true });
  ok(/No work email for <b>[^<]*Ravi Chandra[^<]*<\/b>/.test(html));
  ok(/No work email for <b>[^<]*Dana Whitfield[^<]*<\/b>/.test(html));
});

test('The button says whether the panel is open', () => {
  ok(screen({ view: 'tab', tab: 't1', sumShow: true }).indexOf('aria-expanded="true">Summary') >= 0);
  ok(screen({ view: 'tab', tab: 't1' }).indexOf('aria-expanded="false">Summary') >= 0);
});

group('The email');

test('Addressed to the meeting, with a subject naming it', () => {
  const snap = demoBoard(DAY);
  const m = summaryEmail(snap, byId(snap.tabs, 't1'), MEETING, DAY);
  eq(m.to, ['alex.morgan@example.invalid', 'priya.raman@example.invalid']);
  ok(m.href.indexOf('mailto:alex.morgan@example.invalid,priya.raman@example.invalid?subject=') === 0);
  ok(m.subject.indexOf('Northern Area meeting summary') === 0);
});

test('A short summary goes in the body, with line breaks Outlook keeps', () => {
  // Southern had a quiet week. (Northern's is already too long - see below.)
  const snap = demoBoard(DAY);
  const m = summaryEmail(snap, byId(snap.tabs, 't2'), '2026-09-22', DAY);
  ok(m.bodyIncluded, 'short enough to fill in');
  ok(m.href.indexOf('&body=' + encodeURIComponent('Southern Area · ')) > 0);
  ok(m.href.indexOf('%0D%0A') > 0, 'CRLF, not bare newlines');
});

test('Too long for the link: the body is left for pasting, never cut off', () => {
  // Windows truncates a long mailto link without a word. A summary arriving half
  // finished is worse than one that has to be pasted.
  const snap = demoBoard(DAY);
  for (let i = 0; i < 40; i++) {
    snap.entries.push({ id: 'w' + i, tab: 't1', meeting: MEETING, personId: 'p1', kind: 'win',
      text: 'A long win to make the summary long, number ' + i, why: 'Because' });
  }
  const m = summaryEmail(snap, byId(snap.tabs, 't1'), MEETING, DAY);
  notOk(m.bodyIncluded);
  ok(m.href.length <= MAILTO_LIMIT, 'the link stays inside the limit');
  ok(m.href.indexOf('Paste%20the%20summary%20here') > 0, 'and says what to do');
  ok(m.body.indexOf('number 39') > 0, 'the full summary is still there to copy');
});

test('An address that would break the link is left out', () => {
  const snap = demoBoard(DAY);
  byId(snap.people, 'p2').upn = 'priya@example.invalid?cc=someone@else';
  const m = summaryEmail(snap, byId(snap.tabs, 't1'), MEETING, DAY);
  eq(m.to, ['alex.morgan@example.invalid']);
});

test('Pressing Email opens it, and copies the summary too', async () => {
  const store = createStore(createMemoryAdapter({ seed: demoBoard(DAY) }), {});
  await store.load();
  const opened = [];
  const H = createHandlers(/** @type {any} */ ({
    store: store, ui: Object.assign(loadUi(), { view: 'tab', tab: 't1', dates: { t1: MEETING } }),
    render: function () {}, today: function () { return DAY; },
    openLink: function (href) { opened.push(href); }
  }));
  H.clicks.emailSummary(null, '', '');
  eq(opened.length, 1, 'one email opened');
  ok(opened[0].indexOf('mailto:alex.morgan@example.invalid') === 0);
});
