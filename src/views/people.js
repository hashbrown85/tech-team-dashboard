// @ts-check
/**
 * The roster: who is on the team, which meetings set their area, and who is an
 * admin. The pick-lists and the board file moved to Board settings (views/config.js)
 * - one page per question.
 *
 * There is no "who can see project value" column any more. That used to be a
 * per-person, per-area checkbox enforced in the browser, which hid the numbers
 * without protecting them. It is now decided by the permissions on the
 * BoardProjectDetails list, so the answer lives in SharePoint rather than here.
 *
 * From board.html:1189-1222.
 */

import { esc } from '../lib/dom.js';
import { rosterGaps } from '../identity.js';
import { areasFor } from '../domain/queries.js';
import { adminsOf } from '../domain/scope.js';
import { ROLES } from '../domain/constants.js';
import { byName } from '../lib/seq.js';
import { pageHeader } from './shell.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

function dis(env) {
  return env.areaReadonly ? ' disabled' : '';
}

/** Which role someone holds in a meeting, if any. */
function roleIn(tab, personId) {
  if ((tab.members || []).indexOf(personId) >= 0) return 'Reporting';
  if ((tab.support || []).indexOf(personId) >= 0) return 'Supporting';
  if ((tab.optional || []).indexOf(personId) >= 0) return 'Optional';
  return '';
}

/**
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 */
export function renderPeople(snap, ui, env) {
  const people = snap.people.slice().sort(byName);
  const readonly = env.areaReadonly;

  const rows = people.map(function (p) {
    const memberships = snap.tabs.map(function (t) {
      const role = roleIn(t, p.id);
      if (!role) return '';
      return '<span class="pchip' + (role === 'Reporting' ? ' m' : role === 'Optional' ? ' o' : '') +
        '" title="' + role + ' in ' + esc(t.name) + '">' + esc(t.name) + '</span>';
    }).join('') || '<span class="muted sm">No meetings</span>';

    return '<tr>' +
      '<td><input class="fld" type="text" value="' + esc(p.name) +
      '" data-edit="personName" data-id="' + esc(p.id) + '" aria-label="Name"' + dis(env) + '></td>' +
      '<td><input class="fld" type="text" value="' + esc(p.title || '') +
      '" data-edit="personTitle" data-id="' + esc(p.id) + '" aria-label="Title"' + dis(env) + '></td>' +
      // Worked out, not typed: the area meetings they attend. It used to be a free
      // text box that nothing read, so it could say one thing while their meetings
      // said another. To move somebody, change who is in the meeting.
      '<td>' + areaCell(snap, p.id) + '</td>' +
      // Editable here, not only on the add form. It went in once and could never be
      // seen or corrected - and it is the only thing that will match this person to
      // their Microsoft sign-in.
      '<td><input class="fld" type="email" value="' + esc(p.upn || '') +
      '" data-edit="personUpn" data-id="' + esc(p.id) +
      '" placeholder="none" aria-label="Work email"' + dis(env) + '></td>' +
      '<td><div class="mchips">' + memberships + '</div></td>' +
      // Shows who gets the settings controls. It is not the lock - see adminNote.
      '<td class="c"><input type="checkbox" data-edit="personAdmin" data-id="' + esc(p.id) +
      '" aria-label="' + esc(p.name) + ' is an admin"' + (p.admin ? ' checked' : '') +
      dis(env) + '></td>' +
      '<td>' + (readonly ? '' : '<button class="x" type="button" data-act="delPerson" data-id="' + esc(p.id) +
        '" aria-label="Remove ' + esc(p.name) + '">×</button>') + '</td></tr>';
  }).join('');

  /*
   * What would stop somebody being recognised when they sign in. Only rendered when
   * there is something to say - a clean roster gets no line at all, so the note
   * means "look at this" rather than becoming furniture.
   */
  const gaps = rosterGaps(snap);
  const notes = [];
  if (gaps.missing.length) {
    notes.push(gaps.missing.length + ' of ' + gaps.total +
      ' have no work email, so they will not match a sign-in later.');
  }
  gaps.duplicates.forEach(function (d) {
    notes.push(d.people.length + ' people share <b>' + esc(d.key) +
      '</b> — only the first would be recognised.');
  });
  const rosterNote = notes.length
    ? '<p class="scope-note">' + notes.join(' ') + '</p>'
    : '';

  const table = '<div class="tbl-scroll"><table class="t">' +
    '<thead><tr><th>Name</th><th>Title</th><th>Area</th><th>Work email</th>' +
    '<th>In meetings</th><th class="c">Admin</th><th></th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="7"><p class="none">Nobody on the roster yet.</p></td></tr>') +
    '</tbody></table></div>';

  const addForm = ui.open === 'person'
    ? '<form class="add" data-form="person">' +
      '<input class="fld" name="name" type="text" placeholder="Name" required>' +
      '<input class="fld" name="title" type="text" placeholder="Title">' +
      // Optional, and worth the extra box: this is what matches somebody to their
      // Microsoft sign-in later. The column has always existed in the schema; the
      // form never collected it, so every person typed in now would have to be
      // hand-matched when SharePoint arrives.
      '<input class="fld" name="upn" type="email" placeholder="Work email (optional)">' +
      firstMeetings(snap) +
      '<button class="btn" type="submit">Add</button>' +
      '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
    : '<button class="btn ghost add-btn edit-only" type="button" data-act="openForm" data-v="person"' + dis(env) + '>+ Person</button>';

  return pageHeader('People', 'Who is on the team, and who may change the board') +
    rosterNote + adminNote(snap, env) + table + addForm;
}

/**
 * What the Admin column means for whoever is looking. At most one line.
 *
 * The switch decides who is SHOWN the roster and settings controls. Once the board
 * is on SharePoint, what actually lets a change save is membership of the site's
 * admin group - so the two can disagree, and when they do this says so rather than
 * leaving somebody with controls that fail.
 *
 * @param {Snapshot} snap
 * @param {any} env
 */
function adminNote(snap, env) {
  const admins = adminsOf(snap);
  const signedIn = !!env.identity && env.identity.kind === 'signed-in';
  let msg = '';
  if (!admins.length) {
    msg = 'Nobody is an admin yet, so everybody can change the roster and settings. ' +
      'Tick <b>Admin</b> for yourself first.';
  } else if (!env.admin) {
    msg = 'Only admins can change the roster and board settings: <b>' +
      esc(admins.map(function (p) { return p.name; }).join(', ')) + '</b>.';
  } else if (env.settingsRefused && signedIn) {
    msg = 'You are an admin here, but SharePoint refused your change. Ask whoever ' +
      'manages the site to add you to its admin group.';
  } else if (signedIn) {
    msg = 'Ticking Admin shows somebody the settings controls. They also need adding ' +
      'to the site’s admin group in SharePoint, which is what lets their changes save.';
  }
  return msg ? '<p class="scope-note">' + msg + '</p>' : '';
}

/**
 * The Area cell: every area meeting this person attends, in any role.
 *
 * Internal meetings (Tech Directors, initiatives) are not areas and are left out;
 * they still show, with the role, in the "In meetings" column beside it.
 *
 * @param {Snapshot} snap
 * @param {string} personId
 */
function areaCell(snap, personId) {
  const names = areasFor(snap, personId).map(function (t) { return esc(t.name); });
  return names.length ? names.join(', ') : '<span class="muted sm">—</span>';
}

/**
 * On the add form: which meetings the new person joins, and as what.
 *
 * Every meeting, defaulting to "Not in", grouped as the sidebar groups them. This is
 * the one place outside a meeting's own settings that sets attendance, because a new
 * starter has to land somewhere; after this, meeting settings owns it. Both go
 * through withRole(), so they cannot disagree about what a role means.
 *
 * The number of selects follows the number of meetings. restoreForms abandons a
 * form whose field count changed, so adding a meeting while this form is open clears
 * it - rare enough to accept, and the alternative is restoring values into the
 * wrong boxes.
 *
 * @param {Snapshot} snap
 */
function firstMeetings(snap) {
  const areas = snap.tabs.filter(function (t) { return t.kind === 'area'; });
  const other = snap.tabs.filter(function (t) { return t.kind !== 'area'; });

  function pick(t) {
    const opts = ROLES.map(function (r) {
      return '<option value="' + r[0] + '"' + (r[0] === 'none' ? ' selected' : '') + '>' +
        esc(r[1]) + '</option>';
    }).join('');
    return '<label class="fchk">' + esc(t.name) +
      ' <select name="role:' + esc(t.id) + '" aria-label="Role in ' + esc(t.name) + '">' +
      opts + '</select></label>';
  }
  function group(title, tabs) {
    if (!tabs.length) return '';
    return '<fieldset class="oppf"><legend class="lbl">' + title + '</legend>' +
      tabs.map(pick).join('') + '</fieldset>';
  }
  return group('Area meetings — sets their area', areas) +
    group('Internal &amp; initiatives', other);
}

