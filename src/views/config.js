// @ts-check
/**
 * Board settings: the lists a project picks values from, and (on a local board)
 * the file that carries the whole board in and out of this browser.
 *
 * Split out of what was People & settings. The roster answers "who is on the
 * team"; this answers "how is the board set up" - and both are admin-only to
 * change, so they share the settings permission group but not a page.
 */

import { esc } from '../lib/dom.js';
import { pickList } from '../domain/queries.js';
import { pageHeader } from './shell.js';
import { RENAMEABLE_LISTS, countUsing } from '../domain/projects.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

function dis(env) {
  return env.areaReadonly ? ' disabled' : '';
}

/**
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 */
export function renderConfig(snap, ui, env) {
  /*
   * Fields and Project types lead because they are the two that GROW on their own
   * - anyone typing a new value into a project adds it here - so they are the ones
   * that need looking at.
   */
  return pageHeader('Board settings', 'The lists projects pick from') +
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
