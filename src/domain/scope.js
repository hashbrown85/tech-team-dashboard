// @ts-check
/**
 * Who may see which meetings, and who may change the board's settings.
 *
 * TWO THINGS THIS FILE IS NOT. Read before relying on it.
 *
 * 1. It is not protection. It trims what the SCREEN draws. Until the data store can
 *    refuse rows by area, the whole board still reaches every browser, and anyone
 *    determined can read it there. SharePoint cannot do that: its permissions are
 *    per list, and every area's projects share one list (see change set 12 in the
 *    plan). Dataverse can, or a site per area can.
 *
 * 2. It is not throwaway. When the store can enforce this, it hands over exactly
 *    the board `scopeBoard` produces - these meetings and what hangs off them, with
 *    `scopedTo` set - and every screen already knows how to draw that, because it
 *    has been drawing it all along. The rules here become the store's rules.
 *
 * The admin switch has the same shape. It decides who is SHOWN the settings
 * controls. What actually allows a change is being in the SharePoint admin group;
 * somebody switched on here but not there has their saves refused, and the People
 * page says why.
 */

import { byId } from '../lib/seq.js';
import { TECHDIR_TAB_ID } from './constants.js';

/**
 * @typedef {import('./queries.js').Snapshot} Snapshot
 * @typedef {{kind: string, personId: string | null}} Who
 */

const ROLE_KEYS = ['members', 'support', 'optional'];

/** Is this person in this meeting, in any role? */
function attends(tab, personId) {
  return ROLE_KEYS.some(function (r) { return (tab[r] || []).indexOf(personId) >= 0; });
}

/**
 * The people switched on as admins.
 *
 * @param {Snapshot} snap
 */
export function adminsOf(snap) {
  return snap.people.filter(function (p) { return !!p.admin; });
}

/**
 * May this person change the roster, the pick-lists and meeting settings?
 *
 * A board with NO admins treats everybody as one. Otherwise the first person to
 * open a fresh board could never name the first admin - and the handler refuses to
 * switch off the last one, so a board cannot drift back into that state by accident.
 *
 * @param {Snapshot} snap
 * @param {string | null} personId
 */
export function isAdmin(snap, personId) {
  const admins = adminsOf(snap);
  if (!admins.length) return true;
  return !!personId && admins.some(function (p) { return p.id === personId; });
}

/**
 * Does whoever is looking get the admin controls?
 *
 * - demo: yes. It is a showcase with invented data.
 * - local, nobody chosen: yes. One machine, no sign-in; nothing to decide by.
 * - local, somebody chosen: their switch - so choosing a colleague under "You are"
 *   previews what they would get.
 * - signed in: their switch.
 * - signed in but not on the roster: no, unless nobody is an admin yet.
 *
 * @param {Snapshot} snap
 * @param {Who | null | undefined} who
 */
export function viewerIsAdmin(snap, who) {
  if (!who || who.kind === 'demo') return true;
  if (who.kind === 'local' && !who.personId) return true;
  // Off the roster has no id, so this is "no" - unless nobody is an admin yet.
  return isAdmin(snap, who.personId);
}

/**
 * The meetings whoever is looking should see, or null for all of them.
 *
 * Everything for: the demo, a local board with nobody chosen, an admin (who has to
 * see a meeting to set it up), and the tech team - anyone in the Tech Directors
 * meeting, which exists to look across the areas.
 *
 * Otherwise: every meeting they attend, in any role. Area meetings are the point,
 * but an initiative meeting they sit in is theirs too, and hiding it would be
 * stranger than showing it.
 *
 * Signed in but not on the roster: nothing. The roster is how the board knows who
 * somebody is, so until they are on it there is nothing that is theirs. The one
 * exception is a board with no admin yet - see below.
 *
 * @param {Snapshot} snap
 * @param {Who | null | undefined} who
 * @returns {string[] | null} tab ids, or null meaning every meeting
 */
export function meetingsInScope(snap, who) {
  if (!who || who.kind === 'demo') return null;
  if (who.kind === 'local' && !who.personId) return null;
  // A board with no admin yet is being set up, and hides nothing - otherwise the
  // first person to sign in to a fresh board, before their email is on the roster,
  // would see nothing and could fix nothing.
  if (!adminsOf(snap).length) return null;
  const id = who.personId;
  if (!id) return [];
  if (isAdmin(snap, id)) return null;
  const techdir = byId(snap.tabs, TECHDIR_TAB_ID);
  if (techdir && attends(techdir, id)) return null;
  return snap.tabs.filter(function (t) { return attends(t, id); })
    .map(function (t) { return t.id; });
}

/**
 * The board, trimmed to what whoever is looking should see.
 *
 * Kept: the meetings in scope, and every entry, project, issue, action and meeting
 * record filed against one of them; notes and values follow their project. The
 * roster and the pick-lists are kept whole - names are needed to show who owns
 * what, and neither says anything about an area's work.
 *
 * When nothing is trimmed the SAME snapshot comes back, not a copy, so a full board
 * costs nothing. When something is, `scopedTo` names the meetings kept; anything
 * that totals across the board reads it through `boardIsComplete`.
 *
 * @param {Snapshot} snap
 * @param {Who | null | undefined} who
 * @returns {Snapshot}
 */
export function scopeBoard(snap, who) {
  const ids = meetingsInScope(snap, who);
  if (ids === null) return snap;

  const inScope = function (r) { return !!r && ids.indexOf(r.tab) >= 0; };
  const projects = snap.projects.filter(inScope);
  const projectIds = projects.map(function (p) { return p.id; });
  const ofProject = function (key) {
    return function (r) { return projectIds.indexOf(r[key]) >= 0; };
  };

  /** @type {any} */
  const meetings = {};
  Object.keys(snap.meetings || {}).forEach(function (k) {
    // 'tab|date' in memory; the tab is everything before the first separator.
    const tab = k.split(/[|@]/)[0];
    if (ids.indexOf(tab) >= 0) meetings[k] = snap.meetings[k];
  });

  return Object.assign({}, snap, {
    tabs: snap.tabs.filter(function (t) { return ids.indexOf(t.id) >= 0; }),
    entries: snap.entries.filter(inScope),
    projects: projects,
    issues: snap.issues.filter(inScope),
    actions: snap.actions.filter(inScope),
    projectNotes: (snap.projectNotes || []).filter(ofProject('projectId')),
    projectDetails: (snap.projectDetails || []).filter(ofProject('id')),
    meetings: meetings,
    scopedTo: ids.slice()
  });
}
