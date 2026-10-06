// @ts-check
/**
 * Deciding what happens to an opportunity.
 *
 * An opportunity is raised in a meeting and carries a project record from the
 * start - so it can hold notes, values and actions while it is being looked at -
 * but it is not a PROJECT until somebody decides it is. Three decisions:
 *
 *   Promote to project  it joins Current Projects at the meeting where that was
 *                       decided, and the Projects list
 *   Put on hold         parked; it stays under New Opportunities
 *   Cancel              not going ahead; it leaves the list after that meeting
 *
 * The stage itself, and the rule for boards from before it was recorded, live in
 * queries.js (oppStage), because projVisible needs them and this file needs
 * queries.js.
 */

import { byId } from '../lib/seq.js';
import { oppStage, raisedOn } from './queries.js';

/**
 * @typedef {import('./queries.js').Snapshot} Snapshot
 */

/** What each stage is called on a chip. */
export const OPP_STAGE_LABELS = {
  open: 'Opportunity',
  hold: 'On hold',
  cancelled: 'Cancelled',
  promoted: 'Promoted'
};

/** The chip class for each stage - all existing status colours. */
export const OPP_STAGE_CHIPS = {
  open: 'opp',
  hold: 'ps-hold',
  cancelled: 'ps-cancelled',
  promoted: 'ps-new'
};

/** The decisions, in the order they are offered. */
export const OPP_DECISIONS = [
  ['promoted', 'Promote to project'],
  ['hold', 'Put on hold'],
  ['cancelled', 'Cancel']
];

/**
 * The decisions that make sense from where it stands now. Putting a held one on
 * hold again does nothing, so it is not offered; a decided one offers nothing -
 * the toast's Undo is the way back from a slip.
 *
 * @param {any} p
 * @returns {string[][]}
 */
export function decisionsFor(p) {
  const s = oppStage(p);
  if (s === 'open') return OPP_DECISIONS;
  if (s === 'hold') return OPP_DECISIONS.filter(function (d) { return d[0] !== 'hold'; });
  return [];
}

const MESSAGES = {
  promoted: 'Promoted. It is in Current Projects from this meeting.',
  hold: 'Put on hold. It stays under New Opportunities.',
  cancelled: 'Cancelled.'
};

/**
 * Record a decision, in the cascade shape so it comes with an Undo.
 *
 * `d` is the meeting it was decided in. A promoted opportunity shows in Current
 * Projects from that meeting on (`promotedOn`, read by projVisible); `oppDecided`
 * is what keeps a decision visible in the meeting it was made in.
 *
 * Undo writes null rather than leaving a field out: a store merge ignores a key
 * that is not there, so leaving it out would undo nothing.
 *
 * @param {Snapshot} snap
 * @param {string} id - the opportunity's project record
 * @param {string} decision - 'promoted' | 'hold' | 'cancelled'
 * @param {string} d - the meeting date it is decided in
 * @returns {{writes: any[], undo: any[], message: string}}
 */
export function decideOpportunity(snap, id, decision, d) {
  const p = byId(snap.projects, id);
  const allowed = p ? decisionsFor(p).some(function (x) { return x[0] === decision; }) : false;
  if (!p || !allowed) return { writes: [], undo: [], message: '' };

  /** @type {any} */
  const patch = { oppStage: decision, oppDecided: d };
  if (decision === 'promoted') patch.promotedOn = d;

  return {
    writes: [{ op: 'update', col: 'projects', id: id, patch: patch }],
    undo: [{ op: 'update', col: 'projects', id: id, patch: {
      oppStage: p.oppStage == null ? null : p.oppStage,
      oppDecided: p.oppDecided == null ? null : p.oppDecided,
      promotedOn: p.promotedOn == null ? null : p.promotedOn
    } }],
    message: MESSAGES[decision]
  };
}

/**
 * The opportunities a meeting's New Opportunities segment carries, beyond the ones
 * raised at it: everything raised EARLIER in this meeting and still undecided or on
 * hold, plus anything decided at this meeting, so the decision can be seen where it
 * was made. Oldest first - the longest-waiting want deciding first.
 *
 * @param {Snapshot} snap
 * @param {string} tabId
 * @param {string} d - the meeting date being viewed
 * @returns {any[]} project records
 */
export function carriedOpportunities(snap, tabId, d) {
  return snap.projects.filter(function (p) {
    if (p.tab !== tabId) return false;
    const s = oppStage(p);
    if (s === null) return false;
    const raised = raisedOn(p);
    if (!raised || raised >= d) return false;
    return s === 'open' || s === 'hold' || p.oppDecided === d;
  }).sort(function (a, b) {
    const ra = raisedOn(a);
    const rb = raisedOn(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
