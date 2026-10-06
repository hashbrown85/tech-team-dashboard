// @ts-check
/**
 * Editing an action where it is shown.
 *
 * Actions are listed in three places - the Action items table, a meeting's side
 * rail, and a project's page - and all three open the SAME editor, from the same
 * Edit button, so they cannot drift into editing different things. It changes what
 * the action says, who owns it, who supports, and when it is due. What it is
 * related to is not here: moving an action between an issue and a project changes
 * whether that issue has a path, which is a decision for the Issues segment.
 *
 * One open at a time, through `ui.open = 'act:<id>'`, like every other inline form.
 */

import { esc } from '../lib/dom.js';
import { attendeeIds, person } from '../domain/queries.js';
import { actionLabel } from '../domain/actions.js';
import { byId } from '../lib/seq.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

/**
 * Options of people by NAME (actions record owners by name), those in this
 * meeting first.
 *
 * A name that is no longer on the roster - somebody renamed or removed since - is
 * kept as a selected option rather than silently becoming the first person in the
 * list, which would reassign the action the moment anyone pressed Save.
 *
 * @param {Snapshot} snap
 * @param {any} tab - may be null when the meeting is not on this board
 * @param {string} selected
 * @param {string} [blankLabel]
 */
export function ownerOptions(snap, tab, selected, blankLabel) {
  const ids = tab ? attendeeIds(tab).filter(function (id) { return person(snap, id); }) : [];
  const inMeeting = ids.map(function (id) { return person(snap, id); });
  const rest = snap.people.filter(function (p) { return ids.indexOf(p.id) < 0; });
  function opt(p) {
    return '<option value="' + esc(p.name) + '"' +
      (p.name === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>';
  }
  const known = !selected || snap.people.some(function (p) { return p.name === selected; });
  return (blankLabel ? '<option value="">' + blankLabel + '</option>' : '') +
    (known ? '' : '<option value="' + esc(selected) + '" selected>' + esc(selected) +
      ' (not on the roster)</option>') +
    (inMeeting.length ? '<optgroup label="In this meeting">' + inMeeting.map(opt).join('') + '</optgroup>' : '') +
    (rest.length ? '<optgroup label="Everyone else">' + rest.map(opt).join('') + '</optgroup>' : '');
}

/** Is this action's editor the one open? */
export function editingAction(ui, a) {
  return !!ui && ui.open === 'act:' + a.id;
}

/**
 * The Edit button, for beside an action's text. Hidden on a read-only board by
 * `edit-only`, like every other control that writes.
 *
 * @param {any} a
 * @param {any} env
 */
export function editButton(a, env) {
  return ' <button type="button" class="linkbtn edit-only" data-act="editAction" data-id="' +
    esc(a.id) + '" aria-label="Edit ' + actionLabel(a) + '"' +
    (env && env.areaReadonly ? ' disabled' : '') + '>Edit</button>';
}

/**
 * The editor itself. `data-id` makes it a different form from any other action's,
 * so a redraw puts half-typed changes back into the right one.
 *
 * @param {Snapshot} snap
 * @param {any} a
 */
export function actionEditor(snap, a) {
  const tab = byId(snap.tabs, a.tab);
  return '<form class="add" data-form="editAction" data-id="' + esc(a.id) + '">' +
    '<input class="fld full" name="text" type="text" value="' + esc(a.text || '') +
    '" aria-label="What ' + actionLabel(a) + ' is" required>' +
    '<select class="fld" name="owner" aria-label="Owner" required>' +
    ownerOptions(snap, tab, a.owner || '', 'Owner…') + '</select>' +
    '<select class="fld" name="support" aria-label="Support from">' +
    ownerOptions(snap, tab, a.support || '', 'Support from… (optional)') + '</select>' +
    '<input class="fld" name="due" type="date" value="' + esc(a.due || '') +
    '" aria-label="Due date" required>' +
    '<button class="btn" type="submit">Save ' + actionLabel(a) + '</button>' +
    '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>';
}
