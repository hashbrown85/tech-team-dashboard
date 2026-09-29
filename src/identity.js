// @ts-check
/**
 * Who is using the board.
 *
 * Until now this was a dropdown the viewer picked from — which meant the board
 * believed whatever it was told. It now comes from the Microsoft sign-in, matched
 * against the roster by UPN.
 *
 * ## The three cases, all of which happen
 *
 * **Signed in and on the roster.** The normal case. We know which person record you
 * are, so the board can show you your own work and know what you may see.
 *
 * **Signed in but not on the roster.** A colleague opens the link before anyone has
 * added them. They get their name from the sign-in and a quiet note. Nothing breaks;
 * they simply are not any person record yet, so nothing can be assigned to them by id.
 *
 * **Not signed in at all.** Demo mode. There is no Microsoft account, so the board
 * borrows the first person on the roster and labels itself clearly as demo data —
 * a demo board should never be mistaken for the real one.
 */

import { byName } from './lib/seq.js';

/**
 * @typedef {object} Identity
 * @property {'signed-in'|'unknown-user'|'local'|'demo'} kind
 * @property {string} displayName    what to show in the sidebar
 * @property {any | null} person     the matching roster record, if there is one
 * @property {string | null} personId
 */

/**
 * Work out who is using the board.
 *
 * Matching is on UPN, case-insensitively and trimmed, because sign-in and a
 * hand-typed roster entry disagree about capitalisation often enough to matter.
 *
 * @param {import('./domain/queries.js').Snapshot} snap
 * @param {{username?: string, name?: string} | null} account - from the sign-in, or null without one
 * @param {{personId?: string | null} | null} [local] - set on a local board: who the
 *   user has said they are. Its presence is what distinguishes a real local board
 *   from the demo, which is why it is a parameter rather than a lookup.
 * @returns {Identity}
 */
/**
 * The key a work email is matched on.
 *
 * One function, used by both the matcher and the warning below it. If the warning
 * compared differently - case-sensitively, say - it would cheerfully report a clean
 * roster while `identify` failed to match, which is worse than no warning at all.
 *
 * @param {string} [upn]
 * @returns {string}
 */
export function upnKey(upn) {
  return String(upn || '').trim().toLowerCase();
}

/**
 * What would stop somebody being recognised when they sign in.
 *
 * The work email is the ONLY link between a roster entry and a Microsoft account, so
 * a person without one cannot act as themselves: no point of view, nothing assignable
 * to them by id, and no editing their own notes.
 *
 * Duplicates are the quieter problem. `identify` takes the FIRST match, so if two
 * people share an address one of them signs in and silently becomes the other -
 * including for note authorship. Nothing about that is visible at the time.
 *
 * @param {import('./domain/queries.js').Snapshot} snap
 * @returns {{missing: any[], duplicates: {key: string, people: any[]}[], total: number}}
 */
export function rosterGaps(snap) {
  const people = (snap && snap.people) || [];
  const missing = people.filter(function (p) { return !upnKey(p.upn); });

  /** @type {Record<string, any[]>} */
  const byKey = {};
  people.forEach(function (p) {
    const k = upnKey(p.upn);
    if (!k) return;
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push(p);
  });

  const duplicates = Object.keys(byKey)
    .filter(function (k) { return byKey[k].length > 1; })
    .sort()
    .map(function (k) { return { key: k, people: byKey[k] }; });

  return { missing: missing, duplicates: duplicates, total: people.length };
}

export function identify(snap, account, local) {
  if (!account || !account.username) {
    /*
     * A local board is real data with no sign-in, so nothing can work out who is
     * sitting there - it has to be said. Until it is, the board has NO point of
     * view: no person, so it opens showing everyone's work rather than quietly
     * deciding you are whoever sorts first and filtering to them.
     */
    if (local) {
      const me = local.personId
        ? snap.people.find(function (p) { return p.id === local.personId; }) || null
        : null;
      return {
        kind: 'local',
        displayName: me ? me.name : 'Not set',
        person: me,
        personId: me ? me.id : null
      };
    }

    // Demo mode. Borrow the first person alphabetically so the board has a point
    // of view, and say plainly that this is not real.
    const first = snap.people.slice().sort(byName)[0] || null;
    return {
      kind: 'demo',
      displayName: first ? first.name : 'Demo',
      person: first,
      personId: first ? first.id : null
    };
  }

  const upn = upnKey(account.username);
  const match = snap.people.find(function (p) {
    return upnKey(p.upn) === upn && upnKey(p.upn) !== '';
  }) || null;

  if (match) {
    return {
      kind: 'signed-in',
      displayName: match.name,
      person: match,
      personId: match.id
    };
  }

  return {
    kind: 'unknown-user',
    displayName: account.name || account.username,
    person: null,
    personId: null
  };
}
