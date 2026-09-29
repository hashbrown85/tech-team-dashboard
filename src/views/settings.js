// @ts-check
/**
 * One meeting's settings: name, kind, day, length, and who attends in what role.
 *
 * The attendance grid is the important part. Reporting members are the ones the
 * agenda walks round — they each get a block in Wins & Losses, Opportunities and
 * Current Projects. Supporting and Optional attend and can be given actions but are
 * not gone round. "Not in meeting" is the absence of all three rather than a stored
 * value, which is why the fourth radio writes nothing but removal.
 *
 * From board.html:1062-1081.
 */

import { esc } from '../lib/dom.js';
import { byName } from '../lib/seq.js';
import { MEETING_KINDS, WEEKDAYS, ROLES } from '../domain/constants.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

function dis(env) {
  return env.areaReadonly ? ' disabled' : '';
}

/** Which role someone currently holds: a ROLES key, or 'none'. */
function currentRole(tab, personId) {
  if ((tab.members || []).indexOf(personId) >= 0) return 'members';
  if ((tab.support || []).indexOf(personId) >= 0) return 'support';
  if ((tab.optional || []).indexOf(personId) >= 0) return 'optional';
  return 'none';
}

/**
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 * @param {any} tab
 */
export function renderMeetingSettings(snap, ui, env, tab) {
  const people = snap.people.slice().sort(byName);

  const kindOpts = Object.keys(MEETING_KINDS).map(function (k) {
    return '<option value="' + k + '"' + (tab.kind === k ? ' selected' : '') + '>' +
      MEETING_KINDS[k] + '</option>';
  }).join('');

  const dayOpts = WEEKDAYS.map(function (label, i) {
    return '<option value="' + i + '"' + (Number(tab.weekday) === i ? ' selected' : '') + '>' +
      label + '</option>';
  }).join('');

  const fields = '<section class="panel"><div class="pan-h"><h2>This meeting</h2></div>' +
    '<div class="sgrid">' +
    '<label class="lbl">Name<input class="fld" type="text" value="' + esc(tab.name) +
    '" data-edit="tabName"' + dis(env) + '></label>' +
    '<label class="lbl">Kind<select class="fld" data-edit="tabKind"' + dis(env) + '>' + kindOpts + '</select></label>' +
    '<label class="lbl">Runs on<select class="fld" data-edit="tabWeekday"' + dis(env) + '>' + dayOpts + '</select></label>' +
    '<label class="lbl">Length (minutes)<input class="fld" type="number" min="5" max="480" value="' +
    esc(Number(tab.lengthMin) || 30) + '" data-edit="tabLength"' + dis(env) + '></label>' +
    '</div>' +
    // Off by default. A running clock is a commitment to pace, and that is the
    // group's decision to make rather than something the tool imposes on them.
    '<label class="lg-o"><input type="checkbox" data-edit="tabTimer"' +
    (tab.showTimer ? ' checked' : '') + dis(env) + '> Show the agenda clock</label>' +
    '<p class="sm muted">Adds a running timer and a time budget on each segment. ' +
    'Leave it off unless the group wants to work to time.</p>' +
    '</section>';

  const grid = people.length
    ? '<div class="tbl-scroll"><table class="t"><thead><tr><th>Person</th>' +
      ROLES.map(function (r) { return '<th>' + r[1] + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      people.map(function (p) {
        const role = currentRole(tab, p.id);
        return '<tr><td><b>' + esc(p.name) + '</b>' +
          (p.title ? '<span class="muted sm"> · ' + esc(p.title) + '</span>' : '') + '</td>' +
          ROLES.map(function (r) {
            const id = 'r-' + esc(p.id) + '-' + r[0];
            return '<td><label class="lg-a" for="' + id + '">' +
              '<input type="radio" id="' + id + '" name="role-' + esc(p.id) + '"' +
              ' data-edit="tabRole" data-id="' + esc(p.id) + '" data-v="' + r[0] + '"' +
              (role === r[0] ? ' checked' : '') + dis(env) +
              '><span class="sr-only">' + r[1] + '</span></label></td>';
          }).join('') + '</tr>';
      }).join('') +
      '</tbody></table></div>'
    : '<p class="none">Add people on the People screen first.</p>';

  const attendance = '<section class="panel"><div class="pan-h"><h2>Who attends</h2>' +
    '<span class="sub">Reporting members are the ones the agenda goes round</span></div>' +
    grid + '</section>';

  const danger = env.areaReadonly
    ? ''
    : '<section class="panel"><div class="pan-h"><h2>Delete this meeting</h2>' +
      '<span class="sub">Removes it and everything filed under it</span></div>' +
      '<p class="warnt">Every win, loss, opportunity, project, issue, action and score for ' +
      '<b>' + esc(tab.name) + '</b> goes with it. You can undo it straight away, but not later.</p>' +
      '<button class="btn danger" type="button" data-act="delTab">Delete ' + esc(tab.name) + '</button></section>';

  const head = '<header class="ph"><div><div class="lbl">Settings</div>' +
    '<h1>' + esc(tab.name) + '</h1></div><div class="ph-r">' +
    '<button class="btn ghost" type="button" data-act="closeSettings">‹ Back to meeting</button>' +
    '</div></header>';

  return head + fields + attendance + danger;
}
