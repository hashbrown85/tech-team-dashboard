// @ts-check
/**
 * The roster, and the lists a project picks values from.
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
import { pickList, areasFor } from '../domain/queries.js';
import { ROLES } from '../domain/constants.js';
import { byName } from '../lib/seq.js';
import { pageHeader } from './shell.js';
import { RENAMEABLE_LISTS, countUsing } from '../domain/projects.js';

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
    '<th>In meetings</th><th></th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="6"><p class="none">Nobody on the roster yet.</p></td></tr>') +
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

  /*
   * The lists a project picks from. Fields and Project types lead because they
   * are the two that GROW on their own - anyone typing a new value into a project
   * adds it here - so they are the ones that need looking at.
   */
  return pageHeader('People &amp; settings', 'The roster, and the lists projects pick from') +
    rosterNote + table + addForm +
    managedList(snap, ui, env, 'field', 'Fields', 'fieldVal', 'delFieldVal',
      'Grows on its own when somebody types a new one on a project.') +
    managedList(snap, ui, env, 'projectType', 'Project types', 'typeVal',
      'delTypeVal', 'Grows on its own when somebody types a new one on a project.') +
    managedList(snap, ui, env, 'products', 'Products', 'product', 'delProduct',
      'Stands in for the product list in Dataverse, until that is reachable.') +
    managedList(snap, ui, env, 'focus', 'Focus', 'focus', 'delFocus') +
    managedList(snap, ui, env, 'resources', 'Potential resources', 'resource',
      'delResource') +
    boardFile(snap, env);
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

/**
 * Getting the board out of this browser, and back in.
 *
 * Until SharePoint exists the board lives in one browser, at one address, on one
 * machine. That is enough to run a meeting from and not enough to rely on: site
 * data gets cleared, laptops get replaced, and browser storage is invisible to a
 * different address. A downloaded copy is the only form that survives any of that,
 * and it is the same file that will be loaded into SharePoint later.
 *
 * Only shown on a board that has somewhere to be saved to. On the demo there is
 * nothing worth keeping, and offering to save it would suggest otherwise.
 *
 * @param {Snapshot} snap
 * @param {any} env
 */
function boardFile(snap, env) {
  if (!env.identity || env.identity.kind !== 'local') return '';

  const counts = snap.people.length + ' people, ' + snap.projects.length +
    ' projects, ' + snap.actions.length + ' actions';

  return '<section class="panel"><div class="pan-h"><h2>This board</h2>' +
    '<span class="k">' + esc(counts) + '</span></div>' +
    '<p class="sub">Saved in this browser, at this address, on this computer — ' +
    'and nowhere else. Download a copy at the end of every meeting.</p>' +
    '<div class="filters">' +
    '<button class="btn" type="button" data-act="downloadBoard">Download a copy</button>' +
    // A plain button, NOT a label pointing at a hidden file input in the page.
    // The board redraws on a 60-second poll, and a file dialog is open for longer
    // than that - the input would be destroyed mid-choice and the pick would fire
    // on a detached element that nothing is listening to. The handler creates its
    // own input instead, which no redraw can touch.
    '<button class="btn ghost" type="button" data-act="loadBoard"' + dis(env) +
    '>Load a copy…</button>' +
    '</div>' +
    '<p class="sub">Loading replaces everything on this board. It asks first.</p>' +
    '</section>';
}

/**
 * One of the lists a project picks values from.
 *
 * Each chip carries **how many projects use it**, which is what makes a typo visible:
 * a slip reads `1` beside a real category's `14`. Spotting it is only half of it - the
 * four renameable lists let you click the value and correct it everywhere at once,
 * which is the other half. See renameListValue in domain/cascade.js.
 *
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 * @param {string} key - the settings document id, and the field on a project
 * @param {string} title
 * @param {string} formName - doubles as the ui.open sentinel and the data-form name
 * @param {string} delAct - the data-act for a chip's remove button
 * @param {string} [sub]
 */
function managedList(snap, ui, env, key, title, formName, delAct, sub) {
  const items = pickList(snap, key);
  const renameable = !!RENAMEABLE_LISTS[key];

  const chips = items.length
    ? '<div class="mchips">' + items.map(function (v) {
        return chip(snap, ui, env, key, v, delAct, renameable);
      }).join('') + '</div>'
    : '<p class="none">Nothing in this list yet.</p>';

  const form = ui.open === formName
    ? '<form class="add" data-form="' + formName + '">' +
      '<input class="fld" name="value" type="text" placeholder="Add to ' + title.toLowerCase() + '" required>' +
      '<button class="btn" type="submit">Add</button>' +
      '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
    : '<button class="btn ghost sm add-btn edit-only" type="button" data-act="openForm" data-v="' +
      formName + '"' + dis(env) + '>+ Add</button>';

  return '<section class="panel"><div class="pan-h"><h2>' + title + '</h2>' +
    '<span class="sub">' + (sub || 'Picked from on a project page') + '</span></div>' +
    chips + form + '</section>';
}

/**
 * One value in a managed list: what it is, how many projects use it, and the two
 * things you can do to it.
 *
 * Renaming is offered on the four lists whose values live on projects as free text.
 * **Products is deliberately not one of them** - that list is coming from Dataverse,
 * so renaming a value here would edit a copy of something this app does not own, and
 * the change would be silently undone the moment the real list is connected. Its
 * chips keep add and remove only.
 */
function chip(snap, ui, env, key, value, delAct, renameable) {
  const editing = ui.open === 'listval:' + key + ':' + value;

  if (editing) {
    return '<form class="add listval" data-form="renameListValue" data-key="' +
      esc(key) + '" data-v="' + esc(value) + '">' +
      '<input class="fld" name="value" type="text" value="' + esc(value) +
      '" aria-label="Rename ' + esc(value) + '" required>' +
      '<button class="btn sm" type="submit">Save</button>' +
      '<button class="btn ghost sm" type="button" data-act="closeForm">Cancel</button>' +
      '</form>';
  }

  const n = countUsing(snap, key, value);

  const label = renameable && !env.areaReadonly
    ? '<button type="button" class="linkbtn" data-act="editListVal" data-key="' +
      esc(key) + '" data-v="' + esc(value) + '" title="Rename ' + esc(value) +
      ' everywhere">' + esc(value) + '</button>'
    : esc(value);

  return '<span class="pchip">' + label +
    '<span class="cnt n" title="' + n +
    (n === 1 ? ' project uses' : ' projects use') + ' this value">' + n + '</span>' +
    (env.areaReadonly ? '' : '<button class="x" type="button" data-act="' + delAct +
      '" data-v="' + esc(value) + '" aria-label="Remove ' + esc(value) +
      ' from the list">×</button>') +
    '</span>';
}
