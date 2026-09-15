// @ts-check
/**
 * Whether work is late, and how to say so.
 *
 * See the folder rules at the top of queries.js — no DOM, no store, pure functions.
 *
 * Every function here takes `today` as an argument rather than reading the clock.
 * That is what makes "3d overdue" testable, and it is also the seam through which the
 * overnight-stale-date defect gets fixed: the original read a module-level TODAY
 * captured once at startup (board.html:510), so a board left open past midnight never
 * noticed the day had turned over.
 *
 * Lifted from board.html:535-544, 566-574, 600.
 */

import { diffDays, fmt } from '../lib/dates.js';
import { isOpen, openActsFor } from './queries.js';

/**
 * @typedef {import('./queries.js').Snapshot} Snapshot
 */

/**
 * Open, with a due date that has passed.
 * @param {any} a - an action
 * @param {string} today
 */
export function isOverdue(a, today) {
  return isOpen(a) && !!a.due && a.due < today;
}

/**
 * Open, due within the next week including today.
 * @param {any} a
 * @param {string} today
 */
export function isDueSoon(a, today) {
  return isOpen(a) && !!a.due && a.due >= today && diffDays(today, a.due) <= 7;
}

/**
 * The CSS class for an action's due state: 'done', 'over', 'soon', or none.
 *
 * Returned as a class name rather than a colour, so the stylesheet stays in charge of
 * what late looks like.
 *
 * @param {any} a
 * @param {string} today
 * @returns {string}
 */
export function dueClass(a, today) {
  if (!isOpen(a)) return 'done';
  if (!a.due) return '';
  if (a.due < today) return 'over';
  if (diffDays(today, a.due) <= 7) return 'soon';
  return '';
}

/**
 * An action's due state in words: '3d overdue', 'Due today', 'Due Sep 28'.
 *
 * Deliberately terse — it sits in a dense list and gets scanned, not read.
 *
 * @param {any} a
 * @param {string} today
 * @returns {string}
 */
export function dueLabel(a, today) {
  if (!isOpen(a)) return 'Done' + (a.doneOn ? ' ' + fmt(a.doneOn) : '');
  if (!a.due) return 'No date';
  const n = diffDays(today, a.due);
  if (n < 0) return -n + 'd overdue';
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  return 'Due ' + fmt(a.due);
}

/**
 * Is this record in scope for a tab filter? 'all' means every meeting.
 * @param {{tab?: string}} x
 * @param {string} tid
 */
export function inScope(x, tid) {
  return tid === 'all' || x.tab === tid;
}

/**
 * Does this action involve the person being filtered on? 'all' means everyone.
 *
 * Compares NAMES, because that is what actions store. See DATA_MODEL.md — this is
 * the function that breaks if two people share a name.
 *
 * @param {any} a
 * @param {string} personName - a name, or 'all'
 */
export function personOk(a, personName) {
  return personName === 'all' || a.owner === personName || a.support === personName;
}

/**
 * The headline numbers: how much is open, late, due soon, off track, and urgent.
 *
 * `stop` counts only show-stoppers that nobody has picked up yet — an urgent issue
 * with an owner is being dealt with, so it does not belong on an alarm counter.
 *
 * @param {Snapshot} snap
 * @param {string} tid - a tab id, or 'all'
 * @param {string} today
 * @returns {{open: number, over: number, soon: number, off: number, stop: number}}
 */
export function stats(snap, tid, today) {
  const open = snap.actions.filter(function (a) { return inScope(a, tid) && isOpen(a); });
  return {
    open: open.length,
    over: open.filter(function (a) { return isOverdue(a, today); }).length,
    soon: open.filter(function (a) { return isDueSoon(a, today); }).length,
    off: snap.projects.filter(function (p) { return inScope(p, tid) && p.status === 'off'; }).length,
    stop: snap.issues.filter(function (i) {
      return inScope(i, tid) && i.status === 'open' && i.sev === 'stopper' && !openActsFor(snap, i.id);
    }).length
  };
}

/**
 * May this person see a project's value and win percentage in this meeting?
 *
 * BE CLEAR ABOUT WHAT THIS IS: a display preference, not a security control. The
 * person id it checks comes from a dropdown the viewer picks themselves, so anyone
 * can select another name and see the numbers. Closing that properly needs the data
 * behind separate permissions, not a client-side check. board.html:516.
 *
 * @param {Snapshot} snap
 * @param {string} personId
 * @param {string} tabId
 */
export function canSeeDetails(snap, personId, tabId) {
  const p = snap.people.find(function (x) { return x.id === personId; });
  return !!(p && Array.isArray(p.detailAreas) && p.detailAreas.indexOf(tabId) >= 0);
}
