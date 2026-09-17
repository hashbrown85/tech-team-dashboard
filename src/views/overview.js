// @ts-check
/**
 * The overview: headline numbers, what needs attention, and a card per meeting.
 *
 * The "needs attention" list is the only place the app volunteers work at you.
 * It holds exactly two things — actions that are overdue, and issues nobody owns —
 * because those are the two failures the meeting format exists to prevent. It is
 * capped at ten, since a list of forty is a list nobody reads.
 *
 * From board.html:728-763.
 */

import { esc } from '../lib/dom.js';
import { fmt, fmtDay, addDays, rel } from '../lib/dates.js';
import { byId } from '../lib/seq.js';
import { issueItems, openActsFor, personName, person } from '../domain/queries.js';
import { stats, isOverdue, dueLabel, personOk } from '../domain/dueness.js';
import { lastScore, meetingDate } from '../domain/meetings.js';
import { SEVERITY_LABELS } from '../domain/constants.js';
import { pageHeader, kpi } from './shell.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

/**
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {object} env
 * @param {string} env.today
 */
export function renderOverview(snap, ui, env) {
  const today = env.today;
  const s = stats(snap, 'all', today);

  let html = pageHeader('Overview', 'Every meeting, action item and issue as of ' + fmtDay(today));

  html += '<section class="kpis" aria-label="Summary">' +
    kpi('', s.open, 'Open actions', 'across all meetings', 'showActions', 'open') +
    kpi(s.over ? 'crit' : 'good', s.over, 'Overdue',
      s.over ? 'past due date' : 'nothing late', 'showActions', 'over') +
    kpi(s.soon ? 'warn' : '', s.soon, 'Due in 7 days',
      'by ' + fmt(addDays(today, 7)), 'showActions', 'soon') +
    kpi(s.stop ? 'crit' : '', s.stop, 'Show-stoppers', 'open right now') +
    '</section>';

  /* --- needs attention --- */

  const rows = [];

  snap.actions
    .filter(function (a) { return isOverdue(a, today) && personOk(a, ui.person); })
    .sort(function (a, b) { return a.due < b.due ? -1 : 1; })
    .forEach(function (a) {
      const tab = byId(snap.tabs, a.tab);
      rows.push('<li><button type="button" data-act="focusAction" data-id="' + esc(a.id) + '">' +
        '<span class="duetag over">' + dueLabel(a, today) + '</span>' +
        '<span class="t">' + esc(a.text) + '</span>' +
        '<span class="m"><b>' + esc(a.owner || 'No owner') + '</b> · ' +
        esc(tab ? tab.name : '') + '</span></button></li>');
    });

  snap.tabs.forEach(function (t) {
    issueItems(snap, t.id).forEach(function (it) {
      const o = it.o;
      if (openActsFor(snap, o.id)) return;
      if (ui.person !== 'all' && personName(snap, o.personId) !== ui.person) return;
      const label = it.type === 'p' ? 'Off-track' : SEVERITY_LABELS[it.sev];
      rows.push('<li><button type="button" data-act="openIssue" data-id="' + esc(t.id) +
        '" data-v="iss-' + esc(o.id) + '">' +
        '<span class="chip ' + esc(it.sev) + '">' + label + '</span>' +
        '<span class="t">' + esc(o.text || o.name) + '</span>' +
        '<span class="m">' + esc(t.name) + ' · ' + esc(personName(snap, o.personId)) +
        ' · no action yet</span></button></li>');
    });
  });

  const attention = '<section class="panel"><div class="pan-h"><h2>Needs attention</h2>' +
    '<span class="sub">Overdue actions and issues nobody owns yet</span></div>' +
    (rows.length
      ? '<ul class="att-list">' + rows.slice(0, 10).join('') + '</ul>' +
        (rows.length > 10 ? '<p class="sm muted">…and ' + (rows.length - 10) + ' more</p>' : '')
      : '<p class="none">Nothing needs attention' +
        (ui.person !== 'all' ? ' for ' + esc(ui.person) : '') +
        '. No overdue actions and every issue has an owner.</p>') +
    '</section>';

  /* --- a card per meeting --- */

  function card(t) {
    const st = stats(snap, t.id, today);
    const ls = lastScore(snap, t.id);
    const d = meetingDate(t, today, ui.dates[t.id]);
    const reporting = (t.members || [])
      .filter(function (id) { return person(snap, id); })
      .map(function (id) { return personName(snap, id); })
      .join(', ');

    return '<button type="button" class="mc" data-act="go" data-v="tab" data-id="' + esc(t.id) + '">' +
      '<span class="nm">' + esc(t.name) + '</span>' +
      '<span class="dt">' + fmtDay(d) + ' · ' + rel(d, today) + '</span>' +
      '<span class="ppl">' + esc(reporting || 'No one reporting yet') + '</span>' +
      '<span class="row">' +
      '<span>Open<b>' + st.open + '</b></span>' +
      // No class attribute at all when the count is zero, rather than an empty
      // one: `class=""` is always a conditional that lost, and it is the shape
      // a broken class expression leaves behind.
      '<span>Overdue<b' + (st.over ? ' class="crit"' : '') + '>' + st.over + '</b></span>' +
      '<span>Stoppers<b' + (st.stop ? ' class="crit"' : '') + '>' + st.stop + '</b></span>' +
      '<span>Score<b>' + (ls ? ls.avg.toFixed(1) : '—') + '</b></span>' +
      '</span></button>';
  }

  const areas = snap.tabs.filter(function (t) { return t.kind === 'area'; });
  const other = snap.tabs.filter(function (t) { return t.kind !== 'area'; });

  const meetings = '<section class="panel"><div class="pan-h"><h2>Meetings</h2>' +
    '<span class="sub">Select one to run it</span></div>' +
    (areas.length ? '<div class="mgroup"><div class="lbl">Area meetings</div>' +
      '<div class="cards">' + areas.map(card).join('') + '</div></div>' : '') +
    (other.length ? '<div class="mgroup"><div class="lbl">Internal &amp; initiatives</div>' +
      '<div class="cards">' + other.map(card).join('') + '</div></div>' : '') +
    (!snap.tabs.length ? '<p class="none">No meetings yet. Add one from the sidebar.</p>' : '') +
    '</section>';

  return html + '<div class="ovgrid">' + attention + meetings + '</div>';
}
