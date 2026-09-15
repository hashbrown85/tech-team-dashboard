// @ts-check
/**
 * The timeline: the next six weeks of dated work, as swimlanes.
 *
 * One row per meeting (or per person), with a dot for every action and project due
 * date placed along a shared time axis. Overdue work gets its own column at the left
 * and anything beyond the six weeks collapses to a count at the right, so the middle
 * stays readable rather than being squeezed by outliers.
 *
 * ## The layout is dictated by the stylesheet, not chosen here
 *
 * `.tl` is ONE grid of rows, four columns wide: the lane label, the overdue bucket,
 * the axis, and the later bucket. Each lane contributes exactly four children, in
 * that order. Inside the axis column, `.tl-in` is `position:absolute` and the dots
 * are placed with a `left` percentage.
 *
 * An earlier version of this file invented a different layout — week columns, each
 * holding a list — which collided with all of that. Every `.tl-in` became absolutely
 * positioned and they stacked on top of each other, so only the topmost item could
 * be clicked and the page overflowed sideways far enough to push the sidebar out of
 * reach. Hence the rule: read the CSS first, and give it what it expects.
 *
 * Dots that fall close together are staggered over three rows rather than overlapping
 * (see `place`), because two dots on the same day would otherwise hide each other.
 *
 * From board.html:1139-1187.
 */

import { esc } from '../lib/dom.js';
import { fmt, fmtDay, addDays, diffDays, nextOn } from '../lib/dates.js';
import { isOpen, personName } from '../domain/queries.js';
import { dueClass, personOk, stats } from '../domain/dueness.js';
import { actionLabel } from '../domain/actions.js';
import { pageHeader } from './shell.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

/** How far ahead the axis runs. Six weeks is what a weekly meeting can act on. */
const SPAN_DAYS = 42;

/** How many rows dots stagger over before they start sharing one. */
const STAGGER_ROWS = 3;

/** Minimum gap, as a percentage of the axis, before two dots may share a row. */
const MIN_GAP_PCT = 2.6;

/**
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 */
export function renderTimeline(snap, ui, env) {
  const today = env.today;
  const end = addDays(today, SPAN_DAYS);

  /** Weekly tick marks, from the next Monday to the end of the span. */
  const ticks = [];
  for (let t = nextOn(addDays(today, 1), 1); t <= end; t = addDays(t, 7)) ticks.push(t);

  /** Where a date sits along the axis, as a percentage. */
  function pos(d) {
    return (diffDays(today, d) / SPAN_DAYS) * 100;
  }

  /* --- what goes on the timeline --- */

  const actions = snap.actions.filter(function (a) {
    return isOpen(a) && a.due && personOk(a, ui.person);
  }).map(function (a) {
    return {
      kind: 'a',
      id: a.id,
      due: a.due,
      tab: a.tab,
      who: a.owner || 'Unassigned',
      cls: dueClass(a, today),
      tip: actionLabel(a) + ' · ' + a.text + ' · ' + (a.owner || 'no owner') +
        (a.support ? ' (with ' + a.support + ')' : '') + ' · due ' + fmtDay(a.due)
    };
  });

  const projects = snap.projects.filter(function (p) {
    const live = p.status === 'on' || p.status === 'off' || p.status === 'new';
    const mine = ui.person === 'all' || personName(snap, p.personId) === ui.person;
    return live && p.due && mine;
  }).map(function (p) {
    return {
      kind: 'p',
      id: p.id,
      due: p.due,
      tab: p.tab,
      who: personName(snap, p.personId),
      cls: 'proj' + (p.status === 'off' ? ' off' : '') + (p.due < today ? ' over' : ''),
      tip: 'Project · ' + p.name + ' · ' + personName(snap, p.personId) + ' · ' +
        (p.status === 'off' ? 'off track' : 'due') + ' ' + fmtDay(p.due)
    };
  });

  /* --- lanes --- */

  const everything = actions.concat(projects);

  let lanes;
  if (ui.tlGroup === 'person') {
    /** @type {Record<string, any[]>} */
    const by = {};
    everything.forEach(function (it) {
      (by[it.who] = by[it.who] || []).push(it);
    });
    lanes = Object.keys(by).sort().map(function (name) {
      const person = snap.people.filter(function (x) { return x.name === name; })[0];
      return { label: name, sub: person ? (person.title || '') : '', items: by[name] };
    });
  } else {
    // A meeting with nothing dated gets no lane — an empty row is just noise.
    lanes = snap.tabs.map(function (t) {
      return {
        label: t.name,
        sub: stats(snap, t.id, today).open + ' open',
        items: everything.filter(function (it) { return it.tab === t.id; })
      };
    }).filter(function (lane) { return lane.items.length; });
  }

  /* --- the pieces of a row --- */

  function gridLines() {
    return '<i class="gl today" style="left:0"></i>' +
      ticks.map(function (d) {
        return '<i class="gl" style="left:' + pos(d).toFixed(2) + '%"></i>';
      }).join('');
  }

  function dot(item, style, extra) {
    return '<button type="button" class="dot ' + extra + '"' +
      (style ? ' style="' + style + '"' : '') +
      ' data-act="' + (item.kind === 'a' ? 'focusAction' : 'showProjActions') + '"' +
      ' data-id="' + esc(item.id) + '"' +
      ' title="' + esc(item.tip) + '"' +
      ' aria-label="' + esc(item.tip) + '"></button>';
  }

  /**
   * Stagger dots so two due on the same day do not sit on top of each other.
   * Falls back to the least recently used row once all three are crowded.
   */
  function place(items) {
    const lastAt = [];
    for (let i = 0; i < STAGGER_ROWS; i++) lastAt.push(-99);

    return items.map(function (item) {
      const x = pos(item.due);
      let row = -1;
      for (let i = 0; i < STAGGER_ROWS; i++) {
        if (x - lastAt[i] >= MIN_GAP_PCT) { row = i; break; }
      }
      if (row < 0) row = lastAt.indexOf(Math.min.apply(null, lastAt));
      lastAt[row] = x;
      return dot(item, 'left:' + x.toFixed(2) + '%;top:' + (8 + row * 11) + 'px', item.cls);
    }).join('');
  }

  /* --- the header row and the lanes --- */

  const head = '<div class="ax"></div>' +
    '<div class="ax tl-over">Overdue</div>' +
    '<div class="ax"><div class="tl-in">' +
    ticks.map(function (d) {
      return '<span class="tk" style="left:' + pos(d).toFixed(2) + '%">' + fmt(d) + '</span>';
    }).join('') +
    '</div></div>' +
    '<div class="ax tl-later">Later</div>';

  const body = lanes.map(function (lane) {
    const over = lane.items.filter(function (i) { return i.due < today; });
    const later = lane.items.filter(function (i) { return i.due > end; });
    const within = lane.items
      .filter(function (i) { return i.due >= today && i.due <= end; })
      .sort(function (a, b) { return a.due < b.due ? -1 : 1; });

    // Exactly four children per lane, in the order .tl's columns expect.
    return '<div class="tl-lab"><b>' + esc(lane.label) + '</b>' +
      '<span>' + esc(lane.sub || '') + '</span></div>' +
      '<div class="tl-over">' +
      over.map(function (i) { return dot(i, '', 'over' + (i.kind === 'p' ? ' proj' : '')); }).join('') +
      '</div>' +
      '<div><div class="tl-in">' + gridLines() + place(within) + '</div></div>' +
      '<div class="tl-later"' +
      (later.length ? ' title="' + esc(later.map(function (i) { return i.tip; }).join('\n')) + '"' : '') +
      '>' + (later.length ? '+' + later.length : '') + '</div>';
  }).join('');

  const empty = '<div class="tl-empty">Nothing with a due date yet' +
    (ui.person !== 'all' ? ' for ' + esc(ui.person) : '') +
    '. Action items and project due dates land here.</div>';

  const toggle = '<div class="seg-tgl" role="group" aria-label="Group by">' +
    '<button type="button" class="tgl' + (ui.tlGroup !== 'person' ? ' sel' : '') +
    '" data-act="tlGroup" data-v="meeting" aria-pressed="' + (ui.tlGroup !== 'person') + '">By meeting</button>' +
    '<button type="button" class="tgl' + (ui.tlGroup === 'person' ? ' sel' : '') +
    '" data-act="tlGroup" data-v="person" aria-pressed="' + (ui.tlGroup === 'person') + '">By person</button></div>';

  const legend = '<div class="legend">' +
    '<span><i class="lg-t"></i>Today</span>' +
    '<span><i class="lg-a"></i>Action</span>' +
    '<span><i class="lg-s"></i>Due in 7 days</span>' +
    '<span><i class="lg-o"></i>Overdue</span>' +
    '<span><i class="lg-p"></i>Project</span></div>';

  return pageHeader('Timeline', 'Open action items and project due dates · next six weeks', toggle) +
    '<section class="panel"><div class="pan-h">' + legend + '</div>' +
    '<div class="tl-scroll"><div class="tl">' + head + (lanes.length ? body : empty) +
    '</div></div></section>';
}
