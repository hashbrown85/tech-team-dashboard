// @ts-check
/**
 * Editing an action where it is shown.
 *
 * Actions are listed in three places - the Action items table, a meeting's side
 * rail, and a project's page - and all three open the SAME editor, from the same
 * Edit button, so they cannot drift into editing different things. It changes what
 * the action says, who owns it, who supports, when it is due, and what it is
 * related to - the last so an action raised loose (or by Copilot, before its issue
 * existed) can be tied to its issue, which gives that issue its path.
 *
 * One open at a time, through `ui.open = 'act:<id>'`, like every other inline form.
 */

import { esc } from '../lib/dom.js';
import { attendeeIds, person, parentRef, isOpportunity, oppStage } from '../domain/queries.js';
import { ACTIVE_STATUSES, STATUS_LABELS } from '../domain/constants.js';
import { projectTitle } from '../domain/projects.js';
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

/**
 * Where an action came from, as a line to sit under its text: the project (or
 * opportunity) by its full title, or the issue - a link to it either way. Empty
 * for an action raised on its own.
 *
 * A sub-line rather than grouping the list under headers: the meeting rail is a
 * 340px column ordered soonest-due first, and headers would break that order into
 * buckets of one or two. To see one project's actions together, its tile already
 * has "Filter actions".
 *
 * @param {Snapshot} snap
 * @param {any} a
 */
export function originLine(snap, a) {
  const ref = parentRef(snap, a);
  if (!ref) return '';
  if (ref.type === 'issue') {
    return '<span class="aorig">Issue · <button type="button" class="linkbtn" data-act="openIssue" ' +
      'data-id="' + esc(a.tab) + '" data-v="iss-' + esc(ref.id) + '">' + esc(ref.issue.text) +
      '</button></span>';
  }
  return '<span class="aorig">' + (isOpportunity(ref.project) ? 'Opportunity' : 'Project') +
    ' · <button type="button" class="linkbtn" data-act="openProject" data-id="' + esc(ref.id) +
    '">' + esc(projectTitle(ref.project)) + '</button></span>';
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
    '<select class="fld" name="rel" aria-label="Related to">' +
    relatedOptions(snap, tab, relKey(snap, a)) + '</select>' +
    '<button class="btn" type="submit">Save ' + actionLabel(a) + '</button>' +
    '<button class="btn ghost" type="button" data-act="closeForm">Cancel</button></form>';
}

/**
 * The dropdown value for what an action is related to now: "p:<id>", "i:<id>", or
 * "" for nothing (including a parent since deleted).
 *
 * @param {Snapshot} snap
 * @param {any} a
 */
export function relKey(snap, a) {
  const ref = parentRef(snap, a);
  return ref ? (ref.type === 'issue' ? 'i:' : 'p:') + ref.id : '';
}

/**
 * What an action can be attached to: the meeting's live projects, its open or
 * held opportunities, and its open issues. Shared by the add form and the editor.
 *
 * Whatever it is attached to NOW is always offered, even when it would not be (a
 * project since finished, an issue since resolved), so pressing Save on an
 * unrelated change does not quietly detach it.
 *
 * @param {Snapshot} snap
 * @param {any} tab - may be null when the meeting is not on this board
 * @param {string} selected - "p:<id>", "i:<id>" or ""
 */
export function relatedOptions(snap, tab, selected) {
  const tid = tab ? tab.id : null;
  const live = snap.projects.filter(function (p) {
    return p.tab === tid && ACTIVE_STATUSES.indexOf(p.status) >= 0;
  });
  // Opportunities carry actions too - "I'll call them Thursday" is often the first
  // thing said about one - so they are offered, but under their own heading: an
  // opportunity is not a project until somebody promotes it. A cancelled one is
  // not going anywhere and is left out.
  const projects = live.filter(function (p) { return !isOpportunity(p); });
  const opps = live.filter(function (p) {
    const s = oppStage(p);
    return s === 'open' || s === 'hold';
  });
  const open = snap.issues.filter(function (i) { return i.tab === tid && i.status === 'open'; });

  const offered = projects.concat(opps).map(function (p) { return 'p:' + p.id; })
    .concat(open.map(function (i) { return 'i:' + i.id; }));
  let current = '';
  if (selected && offered.indexOf(selected) < 0) {
    const id = selected.slice(2);
    const rec = selected.charAt(0) === 'i' ? byId(snap.issues, id) : byId(snap.projects, id);
    if (rec) {
      current = '<option value="' + esc(selected) + '" selected>' +
        (selected.charAt(0) === 'i' ? 'Issue · ' + esc(rec.text) : 'Project · ' + esc(projectTitle(rec))) +
        '</option>';
    }
  }

  function opt(v, label) {
    return '<option value="' + esc(v) + '"' + (selected === v ? ' selected' : '') + '>' + label + '</option>';
  }

  return opt('', 'Related to: nothing specific') + current +
    (projects.length ? '<optgroup label="Projects">' + projects.map(function (p) {
      return opt('p:' + p.id, 'Project · ' + esc(projectTitle(p)) +
        (p.status !== 'on' ? ' (' + STATUS_LABELS[p.status].toLowerCase() + ')' : ''));
    }).join('') + '</optgroup>' : '') +
    (opps.length ? '<optgroup label="Opportunities">' + opps.map(function (p) {
      return opt('p:' + p.id, 'Opportunity · ' + esc(projectTitle(p)) +
        (oppStage(p) === 'hold' ? ' (on hold)' : ''));
    }).join('') + '</optgroup>' : '') +
    (open.length ? '<optgroup label="Open issues">' + open.map(function (i) {
      return opt('i:' + i.id, 'Issue · ' + esc(i.text));
    }).join('') + '</optgroup>' : '');
}
