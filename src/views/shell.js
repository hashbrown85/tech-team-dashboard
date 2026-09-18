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
/**
 * A sortable column header.
 *
 * Lifted out of views/projects.js, which built the first sortable table and owned
 * this privately; the Action items table is the second, and two copies of the
 * aria-label wording would have drifted within a change set.
 *
 * `aria-sort` goes on the `th` and ONLY on the sorted column - `aria-sort="none"`
 * elsewhere would advertise sortability that the plain headers do not have. The
 * button is real, because a `th` is not focusable and has no Enter/Space behaviour,
 * and `type="button"` matters on a page that also has a form. The arrow is
 * decorative; the state and what the NEXT press does live in the aria-label, which
 * is where the three-click cycle becomes discoverable.
 *
 * @param {object} o
 * @param {any} o.columns - the SORT_COLUMNS map for this table
 * @param {string} o.col
 * @param {string} o.label
 * @param {string} [o.cls] - extra class on the th
 * @param {string | null} o.sortCol - the column currently sorted, if any
 * @param {string | null} o.dir - 'asc' | 'desc'
 * @param {string} o.act - the data-act the button carries
 */
export function sortableTh(o) {
  const spec = o.columns[o.col];
  const active = o.sortCol === o.col;
  const dir = active ? o.dir : null;

  let aria;
  let arrow;
  if (!active) {
    aria = 'Sort by ' + spec.label.toLowerCase() + ', ' + spec[spec.first];
    arrow = '\u2195';
  } else if (dir === spec.first) {
    // Second click reverses.
    const other = spec.first === 'asc' ? 'desc' : 'asc';
    aria = spec.label + ', sorted ' + spec[dir] + '. Sort ' + spec[other] + '.';
    arrow = dir === 'asc' ? '\u25b2' : '\u25bc';
  } else {
    // Third click goes back to the default order.
    aria = spec.label + ', sorted ' + spec[dir] + '. Return to the default order.';
    arrow = dir === 'asc' ? '\u25b2' : '\u25bc';
  }

  return '<th class="' + (o.cls ? o.cls + ' ' : '') + 'sortable"' +
    (active ? ' aria-sort="' + (dir === 'asc' ? 'ascending' : 'descending') + '"' : '') +
    '><button type="button" class="th-sort" data-act="' + o.act + '" data-v="' + o.col +
    '" aria-label="' + esc(aria) + '">' + o.label +
    '<span class="sarr" aria-hidden="true">' + arrow + '</span></button></th>';
}

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

  /*
   * The flag is what is left of this when the sidebar is collapsed to 56px. It is
   * not decoration: the demo warning exists so an invented board is never presented
   * to a room by mistake, and a collapse that quietly removed it would take the
   * safeguard away at exactly the moment it is needed. The full sentence stays as
   * the tooltip.
   */
  /*
   * A local board is REAL data with no sign-in. It must not carry the demo warning
   * - that exists so invented data is never shown to a room by mistake, and on a
   * real board it fires backwards - but it is still worth saying that this is not
   * yet the shared copy, because that is the difference between losing a meeting
   * and not.
   */
  if (who.kind === 'local') {
    return '<div class="iam local">' + name +
      '<div class="iam-note">Local board \u2014 this computer only</div>' +
      '<span class="iam-flag local" title="Local board \u2014 this computer only">LOCAL</span></div>';
  }

  if (who.kind === 'demo') {
    return '<div class="iam demo">' + name +
      '<div class="iam-note">Demo data — not the real board</div>' +
      '<span class="iam-flag" title="Demo data — not the real board">DEMO</span></div>';
  }
  if (who.kind === 'unknown-user') {
    return '<div class="iam warn">' + name +
      '<div class="iam-note">You are not on the roster yet</div>' +
      '<span class="iam-flag warn" title="You are not on the roster yet">?</span></div>';
  }
  return '<div class="iam">' + name + '</div>';
}


/*
 * The nav icons, for the collapsed sidebar.
 *
 * Drawn here rather than pulled from an icon font or a CDN: `docs/REHEARSAL.md`
 * already warns that the corporate network may block Google Fonts, and navigation
 * that disappears on the meeting-room network is worse than no icons at all. These
 * cost about 60 lines and cannot fail to load.
 *
 * Single stroke weight, currentColor, no fill, so they inherit the nav item's
 * colour including the selected and hover states.
 */
const ICONS = {
  overview: '<rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1"/>' +
    '<rect x="10" y="2.5" width="5.5" height="5.5" rx="1"/>' +
    '<rect x="2.5" y="10" width="5.5" height="5.5" rx="1"/>' +
    '<rect x="10" y="10" width="5.5" height="5.5" rx="1"/>',
  actions: '<rect x="2.5" y="2.5" width="13" height="13" rx="2.5"/>' +
    '<path d="M5.8 9.2l2.3 2.3 4.4-4.6"/>',
  projects: '<path d="M4 15.2V8.4M9 15.2V3.6M14 15.2v-4.4"/>',
  timeline: '<path d="M2.5 4.5h7M5.5 9h10M2.5 13.5h6"/>',
  people: '<circle cx="9" cy="6" r="3"/><path d="M3.4 15.4c0-3 2.5-4.9 5.6-4.9s5.6 1.9 5.6 4.9"/>',
  hide: '<path d="M11.5 4L6.5 9l5 5"/>',
  show: '<path d="M6.5 4l5 5-5 5"/>'
};

function icon(name) {
  return '<span class="nicon" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
    'stroke-linejoin="round">' + ICONS[name] + '</svg></span>';
}

/**
 * A meeting's two or three letters, for the collapsed strip.
 *
 * Meetings cannot have icons - there are eight to twelve of them with names nobody
 * chose for a 56px column - so they get initials, the way a workspace switcher does.
 * A trailing number is kept whole, because "Northern Area 1" and "Northern Area 2"
 * differ only there and NA/NA would be useless.
 *
 * @param {string} name
 */
export function meetingInitials(name) {
  const parts = String(name || '').trim().split(/[\s\-_/&]+/).filter(Boolean);
  let out = '';
  for (let i = 0; i < parts.length && out.length < 3; i++) {
    out += /^\d+$/.test(parts[i])
      ? parts[i].slice(0, 3 - out.length)
      : parts[i].charAt(0).toUpperCase();
  }
  return out || '?';
}

/**
 * Who you are, on a board with no sign-in.
 *
 * This is the old "I am" dropdown, which was deliberately removed when real
 * sign-in was designed - a board that believes whatever it is told is not a
 * control. It comes back SCOPED TO LOCAL MODE only, because there something has
 * to say who is sitting here, and the alternative is what the demo does: quietly
 * decide you are whoever sorts first alphabetically, then open the board filtered
 * to their work and stamp your notes with their name.
 *
 * It renders nowhere else. Signed in, the answer comes from the sign-in; in the
 * demo it does not matter.
 *
 * @param {Snapshot} snap
 * @param {any} env
 * @param {any} ui
 */
function mePicker(snap, env, ui) {
  if (!env.identity || env.identity.kind !== 'local') return '';

  const opts = '<option value="">Not set</option>' +
    snap.people.slice().sort(byName).map(function (p) {
      return '<option value="' + esc(p.id) + '"' +
        (ui.meId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');

  return '<label class="lbl" for="f-me">You are</label>' +
    '<select class="fld" id="f-me" data-edit="meId">' + opts + '</select>';
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
      (isCurrent('tab', t.id) ? ' aria-current="page"' : '') +
      ' title="' + esc(t.name) + '">' +
      '<span class="nicon nini" aria-hidden="true">' + esc(meetingInitials(t.name)) + '</span>' +
      '<span class="ni-t">' + esc(t.name) + '</span>' + badge + '</button>';
  }

  /*
   * `label` is already HTML (People & settings carries an entity), so `title` takes
   * the plain text separately rather than being derived from it.
   */
  function item(view, label, title, extra) {
    return '<button type="button" class="ni" data-act="go" data-v="' + view + '"' +
      (isCurrent(view) ? ' aria-current="page"' : '') +
      ' title="' + esc(title) + '">' + icon(view) +
      '<span class="ni-t">' + label + '</span>' + (extra || '') + '</button>';
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

  /*
   * Collapsed is a CLASS, not different markup. Every button, every label and the
   * whole identity block are emitted either way and CSS decides what shows - so
   * collapsing cannot strand a control, and the six that live only here (Projects,
   * Timeline, People, the + above, the person filter, the demo-data marker) stay
   * reachable. It also keeps the accessible name on each button: the labels are
   * clipped, never `display:none`, which would leave a row of unnamed buttons.
   */
  const slim = !!ui.sideSlim;
  const tog = '<button type="button" class="side-tog" id="side-toggle" data-act="toggleSide"' +
    ' aria-expanded="' + (slim ? 'false' : 'true') + '"' +
    ' title="' + (slim ? 'Show the menu' : 'Hide the menu, for more room') + '"' +
    ' aria-label="' + (slim ? 'Show the menu' : 'Hide the menu') + '">' +
    icon(slim ? 'show' : 'hide') + '</button>';

  const side = '<aside class="side" aria-label="Navigation">' +
    '<div class="brand"><div class="mark"><span class="shield" aria-hidden="true"></span>' +
    '<div class="wm" role="img" aria-label="Perfex Chemical Solutions"><i class="pf"></i><i class="cs"></i></div></div>' +
    // The toggle shares a row with the app name rather than floating over the
    // brand block, where it sat on top of the wordmark.
    '<div class="brand-b"><div class="appname">Technical Operations<br>&amp; Innovation</div>' +
    tog + '</div></div>' +
    '<nav class="nav">' + item('overview', 'Overview', 'Overview') +
    (areas.length
      ? '<div class="ng ng-plain"><span class="ng-t">Area meetings</span></div>' +
        areas.map(meetItem).join('')
      : '') +
    '<div class="ng"><span class="ng-t">Internal &amp; initiatives</span>' + addTabBtn + '</div>' +
    other.map(meetItem).join('') +
    '<div class="nsep"></div>' +
    item('actions', 'Action items', 'Action items',
      s.over ? '<span class="cnt">' + s.over + '</span>' : '<span class="cnt n">' + s.open + '</span>') +
    item('projects', 'Projects', 'Projects',
      '<span class="cnt n">' + snap.projects.filter(function (p) {
        return ACTIVE_STATUSES.indexOf(p.status) >= 0;
      }).length + '</span>') +
    item('timeline', 'Timeline', 'Timeline') +
    item('people', 'People &amp; settings', 'People & settings') +
    '</nav>' +
    '<div class="side-foot">' + whoAmI(env) + mePicker(snap, env, ui) +
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
    // Was absent, so below 860px the Projects list could not be reached at all.
    opt('projects', 'Projects', ui.view === 'projects') +
    opt('timeline', 'Timeline', ui.view === 'timeline') +
    opt('people', 'People &amp; settings', ui.view === 'people') +
    '</optgroup>';

  const mnav = '<div class="mnav"><span class="shield" role="img" aria-label="Perfex"></span>' +
    '<select class="fld" id="f-nav" data-edit="navSelect" aria-label="Go to">' + navOpts + '</select>' +
    connPill(env.modes, env.areaReadonly) + '</div>';

  return side + mnav;
}
