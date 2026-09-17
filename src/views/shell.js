// @ts-check
/**
 * The app frame: the sidebar, the phone-width nav, page headers and KPI tiles.
 *
 * ## How views work here
 *
 * A view is a pure function from (snapshot, ui) to an HTML string. No view touches
 * the DOM, reads the clock, or writes to the store — which means every one of them
 * can be rendered in a test and inspected.
 *
 * Buttons carry `data-act` (and sometimes `data-id` / `data-v`); fields carry
 * `data-edit`; forms carry `data-form`. One delegated listener at the root turns
 * those into handler calls, so nothing here needs to attach an event.
 *
 * EVERY piece of board content must go through `esc()`. The markup is built by
 * joining strings, so an unescaped project name containing an ampersand breaks the
 * page, and one containing a script tag is worse.
 *
 * From board.html:678-727.
 */

import { esc } from '../lib/dom.js';
import { ACTIVE_STATUSES } from '../domain/constants.js';
import { fmtShort } from '../lib/dates.js';
import { stats } from '../domain/dueness.js';
import { meetingDate } from '../domain/meetings.js';
import { byName } from '../lib/seq.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

/**
 * The connection indicator. Three states, and "view only" is the one worth being
 * clear about — it appears when a write has been refused, so it is telling the user
 * something that already happened.
 *
 * @param {{content: string, settings: string}} modes
 * @param {boolean} areaReadonly - is the area currently on screen read-only?
 */
export function connPill(modes, areaReadonly) {
  if (modes.content === 'connecting' || modes.settings === 'connecting') {
    return '<div class="savepill"><i class="dotc"></i><span>Connecting…</span></div>';
  }
  if (areaReadonly) {
    const partial = modes.content === 'live' || modes.settings === 'live';
    return '<div class="savepill ro"><i class="dotc"></i><span>View only' +
      (partial ? ' here' : '') + '</span></div>';
  }
  return '<div class="savepill ok"><i class="dotc"></i><span>Live</span></div>';
}

/**
 * A page header: optional eyebrow label, title, subtitle, and right-hand controls.
 * @param {string} title
 * @param {string} [sub]
 * @param {string} [right]
 * @param {string} [eyebrow]
 */
export function pageHeader(title, sub, right, eyebrow) {
  return '<header class="ph"><div>' +
    (eyebrow ? '<div class="lbl">' + eyebrow + '</div>' : '') +
    '<h1>' + title + '</h1>' +
    (sub ? '<div class="sub">' + sub + '</div>' : '') +
    '</div>' + (right ? '<div class="ph-r">' + right + '</div>' : '') + '</header>';
}

/**
 * One headline number. Becomes a button when `act` is given, so the numbers on the
 * overview are clickable routes into the thing they count.
 *
 * @param {string} cls - extra class: 'crit', 'warn', 'ok'
 * @param {number|string} n
 * @param {string} label
 * @param {string} sub
 * @param {string} [act] - handler name, making it clickable
 * @param {string} [v] - value passed to the handler
 */
export function kpi(cls, n, label, sub, act, v) {
  const tag = act ? 'button' : 'div';
  return '<' + tag + ' class="kpi ' + cls + '"' +
    (act ? ' type="button" data-act="' + act + '" data-v="' + esc(v || '') + '"' : '') +
    '><span class="l">' + label + '</span><span class="n">' + n + '</span>' +
    '<span class="s">' + sub + '</span></' + tag + '>';
}

/**
 * Who you are, in the sidebar.
 *
 * This used to be a dropdown you picked yourself, which meant the board believed
 * whatever it was told. It now reports what the sign-in says, so it is a statement
 * rather than a question.
 *
 * Two cases get a note rather than just a name: somebody not yet on the roster
 * needs to know why the board does not recognise them, and a demo board needs to be
 * impossible to mistake for the real one.
 *
 * @param {any} env
 */
export function whoAmI(env) {
  const who = env.identity;
  if (!who) return '';

  const name = '<div class="lbl">Signed in as</div>' +
    '<div class="iam-name">' + esc(who.displayName) + '</div>';

  if (who.kind === 'demo') {
    return '<div class="iam demo">' + name +
      '<div class="iam-note">Demo data — not the real board</div></div>';
  }
  if (who.kind === 'unknown-user') {
    return '<div class="iam warn">' + name +
      '<div class="iam-note">You are not on the roster yet</div></div>';
  }
  return '<div class="iam">' + name + '</div>';
}

/**
 * The sidebar, plus the narrow-screen dropdown that replaces it below 860px.
 *
 * Each meeting in the list shows one number, chosen by urgency: overdue actions if
 * there are any, else unowned show-stoppers, else just the next meeting date. One
 * number, because a row of competing counters gets ignored.
 *
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {object} env
 * @param {string} env.today
 * @param {{content: string, settings: string}} env.modes
 * @param {boolean} env.areaReadonly
 */
export function renderSide(snap, ui, env) {
  const areas = snap.tabs.filter(function (t) { return t.kind === 'area'; });
  const other = snap.tabs.filter(function (t) { return t.kind !== 'area'; });

  function isCurrent(view, id) {
    return ui.view === view && (view !== 'tab' || ui.tab === id);
  }

  function meetItem(t) {
    const s = stats(snap, t.id, env.today);
    let badge;
    if (s.over) {
      badge = '<span class="cnt" title="' + s.over + ' overdue">' + s.over + '</span>';
    } else if (s.stop) {
      badge = '<span class="cnt out" title="' + s.stop + ' show-stopper(s)">' + s.stop + '</span>';
    } else {
      badge = '<span class="ni-s">' + fmtShort(meetingDate(t, env.today, ui.dates[t.id])) + '</span>';
    }
    return '<button type="button" class="ni" data-act="go" data-v="tab" data-id="' + esc(t.id) + '"' +
      (isCurrent('tab', t.id) ? ' aria-current="page"' : '') + '>' +
      '<span class="ni-t">' + esc(t.name) + '</span>' + badge + '</button>';
  }

  function item(view, label, extra) {
    return '<button type="button" class="ni" data-act="go" data-v="' + view + '"' +
      (isCurrent(view) ? ' aria-current="page"' : '') +
      '><span class="ni-t">' + label + '</span>' + (extra || '') + '</button>';
  }

  const s = stats(snap, 'all', env.today);
  const names = snap.people.slice().sort(byName);

  const personSel = '<option value="all">Everyone</option>' + names.map(function (p) {
    return '<option value="' + esc(p.name) + '"' +
      (ui.person === p.name ? ' selected' : '') + '>' + esc(p.name) + '</option>';
  }).join('');

  const addTabBtn = env.modes.settings === 'live'
    ? '<button type="button" class="ng-add" data-act="addTab" aria-label="Add a meeting" title="Add a meeting">+</button>'
    : '';

  const side = '<aside class="side" aria-label="Navigation">' +
    '<div class="brand"><div class="mark"><span class="shield" aria-hidden="true"></span>' +
    '<div class="wm" role="img" aria-label="Perfex Chemical Solutions"><i class="pf"></i><i class="cs"></i></div></div>' +
    '<div class="appname">Technical Operations<br>&amp; Innovation</div></div>' +
    '<nav class="nav">' + item('overview', 'Overview') +
    (areas.length ? '<div class="ng">Area meetings</div>' + areas.map(meetItem).join('') : '') +
    '<div class="ng">Internal &amp; initiatives' + addTabBtn + '</div>' + other.map(meetItem).join('') +
    '<div class="nsep"></div>' +
    item('actions', 'Action items',
      s.over ? '<span class="cnt">' + s.over + '</span>' : '<span class="cnt n">' + s.open + '</span>') +
    item('projects', 'Projects',
      '<span class="cnt n">' + snap.projects.filter(function (p) {
        return ACTIVE_STATUSES.indexOf(p.status) >= 0;
      }).length + '</span>') +
    item('timeline', 'Timeline') + item('people', 'People &amp; settings') +
    '</nav>' +
    '<div class="side-foot">' + whoAmI(env) +
    '<label class="lbl" for="f-person">Show items for</label>' +
    '<select class="fld" id="f-person" data-edit="personFilter">' + personSel + '</select>' +
    connPill(env.modes, env.areaReadonly) + '</div></aside>';

  function opt(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + label + '</option>';
  }
  const navOpts = opt('overview', 'Overview', ui.view === 'overview') +
    (areas.length ? '<optgroup label="Area meetings">' + areas.map(function (t) {
      return opt('tab:' + t.id, esc(t.name), isCurrent('tab', t.id));
    }).join('') + '</optgroup>' : '') +
    (other.length ? '<optgroup label="Internal &amp; initiatives">' + other.map(function (t) {
      return opt('tab:' + t.id, esc(t.name), isCurrent('tab', t.id));
    }).join('') + '</optgroup>' : '') +
    '<optgroup label="Lists">' +
    opt('actions', 'Action items', ui.view === 'actions') +
    opt('timeline', 'Timeline', ui.view === 'timeline') +
    opt('people', 'People &amp; settings', ui.view === 'people') +
    '</optgroup>';

  const mnav = '<div class="mnav"><span class="shield" role="img" aria-label="Perfex"></span>' +
    '<select class="fld" id="f-nav" data-edit="navSelect" aria-label="Go to">' + navOpts + '</select>' +
    connPill(env.modes, env.areaReadonly) + '</div>';

  return side + mnav;
}
