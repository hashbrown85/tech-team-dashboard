// @ts-check
/**
 * The roster, and the two managed pick-lists.
 *
 * Note the "Project details" checkboxes here are what gate the value and confidence
 * fields in a meeting — and they are a display preference, not a control. Anyone can
 * see those numbers by picking a different name from the "I am" dropdown. If they
 * genuinely need protecting, that has to happen in the data store.
 *
 * From board.html:1189-1222.
 */

import { esc } from '../lib/dom.js';
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

    const detailBoxes = snap.tabs.map(function (t) {
      const on = Array.isArray(p.detailAreas) && p.detailAreas.indexOf(t.id) >= 0;
      return '<label class="lg-o"><input type="checkbox" data-edit="personArea" data-id="' + esc(p.id) +
        '" data-v="' + esc(t.id) + '"' + (on ? ' checked' : '') + dis(env) + '> ' + esc(t.name) + '</label>';
    }).join('');

    return '<tr>' +
      '<td><input class="fld" type="text" value="' + esc(p.name) +
      '" data-edit="personName" data-id="' + esc(p.id) + '" aria-label="Name"' + dis(env) + '></td>' +
      '<td><input class="fld" type="text" value="' + esc(p.title || '') +
      '" data-edit="personTitle" data-id="' + esc(p.id) + '" aria-label="Title"' + dis(env) + '></td>' +
      '<td><input class="fld" type="text" value="' + esc(p.home || '') +
      '" data-edit="personHome" data-id="' + esc(p.id) + '" aria-label="Area"' + dis(env) + '></td>' +
      '<td><div class="mchips">' + memberships + '</div></td>' +
      '<td><div class="legend">' + (detailBoxes || '<span class="muted sm">No meetings yet</span>') + '</div></td>' +
      '<td>' + (readonly ? '' : '<button class="x" type="button" data-act="delPerson" data-id="' + esc(p.id) +
        '" aria-label="Remove ' + esc(p.name) + '">×</button>') + '</td></tr>';
  }).join('');

  const table = '<div class="tbl-scroll"><table class="tbl">' +
    '<thead><tr><th>Name</th><th>Title</th><th>Area</th><th>In meetings</th>' +
    '<th>Project details access</th><th></th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="6"><p class="none">Nobody on the roster yet.</p></td></tr>') +
    '</tbody></table></div>';

  const addForm = ui.open === 'person'
    ? '<form class="add" data-form="person">' +
      '<input class="fld" name="name" type="text" placeholder="Name" required>' +
      '<input class="fld" name="title" type="text" placeholder="Title">' +
      '<input class="fld" name="home" type="text" placeholder="Area">' +
      '<button class="btn" type="submit">Add</button>' +
      '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>'
    : '<button class="btn ghost add-btn edit-only" type="button" data-act="openForm" data-v="person"' + dis(env) + '>+ Person</button>';

  return pageHeader('People', 'Who is in which meeting, and who can see project value') +
    table + addForm +
    managedList(snap, ui, env, 'chemistries', 'Chemistries', 'chem') +
    managedList(snap, ui, env, 'resources', 'Potential resources', 'resource');
}

/**
 * One of the two pick-lists used by Project details.
 *
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 * @param {string} key - the settings document id
 * @param {string} title
 * @param {string} formName
 */
function managedList(snap, ui, env, key, title, formName) {
  const items = (snap.settings[key] && snap.settings[key].items) || [];

  const chips = items.length
    ? '<div class="mchips">' + items.map(function (v) {
        return '<span class="pchip">' + esc(v) +
          (env.areaReadonly ? '' : '<button class="x" type="button" data-act="del' +
            (formName === 'chem' ? 'Chem' : 'Resource') + '" data-v="' + esc(v) +
            '" aria-label="Remove ' + esc(v) + '">×</button>') + '</span>';
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
    '<span class="sub">Used by Project details</span></div>' + chips + form + '</section>';
}
