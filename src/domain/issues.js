// @ts-check
/**
 * Issue rules: raising one, ranking it, resolving and reopening it, reordering the
 * queue.
 *
 * See the folder rules at the top of queries.js — no DOM, no store, pure functions.
 *
 * Whether an issue is *in* the queue is not decided here — that is derived from
 * whether an open action points at it (rule 1, see queries.js). This module is about
 * the issue records themselves.
 *
 * Lifted from board.html: F.issue (1592-1600), H.resolveIssue / H.reopenIssue
 * (1374-1375), H.moveIssue (1376-1383).
 */

import { issueItems } from './queries.js';

/**
 * @typedef {import('./queries.js').Snapshot} Snapshot
 */

/** Where a manually reopened issue lands: the bottom. board.html:1375. */
export const REOPENED_RANK = 1e6;

/**
 * The rank to give a newly raised issue.
 *
 * A show-stopper is inserted just below the show-stoppers already queued, using a
 * fractional rank so nothing else has to be renumbered. Anything else goes to the
 * bottom. Rule 6 in docs/BUSINESS_RULES.md.
 *
 * Careful: this reads the *unpathed* queue, so an issue that already has an owner
 * doesn't affect where a new one lands.
 *
 * Known edge, preserved deliberately: if the last queued show-stopper has no rank at
 * all, `rank + 0.5` is NaN. Only reachable from data predating the ranking logic or
 * from the notes-import path. board.html:1596 does exactly this.
 *
 * @param {Snapshot} snap
 * @param {string} tid - tab id
 * @param {string} sev - 'stopper' or 'risk'
 * @returns {number}
 */
export function nextIssueRank(snap, tid, sev) {
  const items = issueItems(snap, tid);
  if (sev !== 'stopper') return items.length + 1;

  const stoppers = items.filter(function (it) { return it.sev === 'stopper'; });
  if (!stoppers.length) return 0.5;
  return stoppers[stoppers.length - 1].o.rank + 0.5;
}

/**
 * A newly raised issue. board.html:1597.
 *
 * @param {object} args
 * @param {Snapshot} args.snap
 * @param {string} args.tab
 * @param {string} args.personId - who raised it
 * @param {string} args.text
 * @param {string} [args.sev] - defaults to 'stopper', as the form does
 * @param {string} args.meetingDate
 * @returns {any} the document to write
 */
export function newIssue({ snap, tab, personId, text, sev, meetingDate }) {
  const severity = sev || 'stopper';
  return {
    tab: tab,
    personId: personId,
    text: text,
    sev: severity,
    status: 'open',
    meeting: meetingDate,
    rank: nextIssueRank(snap, tab, severity)
  };
}

/**
 * Resolve an issue by hand, because someone decided it no longer needs a path.
 *
 * Note what this does NOT do: it doesn't set `autoResolved`. That flag is the marker
 * for "the system closed this because its last action closed", and its absence here is
 * what stops a later action being reopened from undoing a human's decision (rule 2).
 * It also leaves `rank` alone.
 *
 * @param {any} issue
 * @param {string} meetingDate
 * @returns {any | null} the document to write, or null if there is nothing to do
 */
export function resolveIssue(issue, meetingDate) {
  if (!issue) return null;
  const x = JSON.parse(JSON.stringify(issue));
  delete x.id;
  x.status = 'resolved';
  x.resolvedMeeting = meetingDate;
  return x;
}

/**
 * Reopen an issue by hand.
 *
 * Sends it to the bottom of the queue rather than back to where it was — if you are
 * reopening something, it re-enters the conversation at the end, not ahead of work
 * that has been waiting.
 *
 * Clearing `autoResolved` matters: a reopened issue is a human's decision again, so a
 * later action toggle must not silently re-resolve it.
 *
 * @param {any} issue
 * @returns {any | null}
 */
export function reopenIssue(issue) {
  if (!issue) return null;
  const x = JSON.parse(JSON.stringify(issue));
  delete x.id;
  x.status = 'open';
  delete x.resolvedMeeting;
  delete x.autoResolved;
  x.rank = REOPENED_RANK;
  return x;
}

/**
 * The key the UI uses to identify a row in the queue: 'i:<id>' for an issue,
 * 'p:<id>' for an off-track project. board.html:1377.
 *
 * @param {{type: string, o: {id: string}}} item
 */
export function queueKey(item) {
  return item.type + ':' + item.o.id;
}

/**
 * Move a queue row up or down by swapping its rank with its neighbour's.
 *
 * Swapping rather than renumbering keeps it to two writes, whatever the queue length.
 * Returns the writes to make, or null at the ends of the list.
 *
 * Both issues and off-track projects share this queue, so each write names its own
 * collection — that's why this returns `col` rather than assuming 'issues'.
 *
 * @param {Snapshot} snap
 * @param {string} tid - tab id
 * @param {string} key - from queueKey()
 * @param {number} dir - -1 to move up, +1 to move down
 * @returns {{col: string, id: string, patch: {rank: number}}[] | null}
 */
export function reorderQueue(snap, tid, key, dir) {
  const items = issueItems(snap, tid);
  const i = items.findIndex(function (it) { return queueKey(it) === key; });
  const j = i + Number(dir);
  if (i < 0 || j < 0 || j >= items.length) return null;

  const rankOf = function (it) { return it.o.rank == null ? 1e9 : it.o.rank; };
  const colOf = function (it) { return it.type === 'p' ? 'projects' : 'issues'; };

  return [
    { col: colOf(items[i]), id: items[i].o.id, patch: { rank: rankOf(items[j]) } },
    { col: colOf(items[j]), id: items[j].o.id, patch: { rank: rankOf(items[i]) } }
  ];
}
