// @ts-check
/**
 * Copilot, by copy and paste: turn a meeting recap into proposed board changes.
 *
 * The board cannot call Copilot - it is a page in a browser, and Copilot lives in
 * Microsoft 365. So the round trip goes through the clipboard:
 *
 *   1. copilotPrompt() builds a prompt holding this meeting's people, projects,
 *      Horizon and open issues, and asks for one JSON reply in a fixed shape.
 *   2. Kevin pastes it into Copilot (ideally the Teams meeting chat, which already
 *      has the transcript) and pastes the reply back.
 *   3. readReply() pulls the JSON out of whatever Copilot wrapped it in.
 *   4. proposalsFrom() checks every suggestion against the board as it is NOW and
 *      returns a list to tick through. Anything that names a project, issue or
 *      person the board does not have is shown with the reason and cannot be
 *      applied - Copilot is guessing from a transcript and will garble names.
 *   5. planFrom() turns the ticked ones into the same writes the board's own
 *      buttons make, so nothing here has its own idea of what a status change is.
 *
 * The prompt and the reply shape are also what the automated version will use
 * once the board is on SharePoint: a flow sends this prompt with the transcript
 * and drops the reply where the board can find it. Only the transport changes.
 *
 * Pure: no DOM, no store. The handler applies what planFrom returns.
 */

import { byId } from '../lib/seq.js';
import { attendeeIds, issueItems, isOpportunity, oppStage } from './queries.js';
import { STATUSES, STATUS_LABELS, SEVERITIES } from './constants.js';
import { projectTitle, newOpportunity, statusChange } from './projects.js';
import { decisionsFor, decideOpportunity, horizonFor } from './opportunities.js';
import { newIssue } from './issues.js';
import { fmtLong } from '../lib/dates.js';

/**
 * @typedef {import('./queries.js').Snapshot} Snapshot
 *
 * @typedef {object} Proposal
 * @property {string} key - stable within one reply: '<section>.<index>'
 * @property {string} kind - win | loss | opportunity | decision | status | issue | action | discussed
 * @property {string} text - what it would do, in words
 * @property {boolean} ok - false when it cannot be applied as given
 * @property {string} reason - why not, when ok is false
 * @property {any} payload - what planFrom needs
 */

/**
 * What a meeting offers Copilot by name or id - and, the same lists, what the
 * Edit form offers as dropdowns when a suggestion needs correcting. One source,
 * so a correction can only pick something the prompt could have named.
 *
 *   people    this meeting's first, then everyone else
 *   projects  live current projects (not opportunities)
 *   horizon   opportunities still undecided or on hold
 *   issues    open issues
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @param {string} d
 */
export function meetingLists(snap, tab, d) {
  const ids = attendeeIds(tab);
  return {
    people: snap.people.filter(function (p) { return ids.indexOf(p.id) >= 0; })
      .concat(snap.people.filter(function (p) { return ids.indexOf(p.id) < 0; })),
    projects: snap.projects.filter(function (p) {
      return p.tab === tab.id && !isOpportunity(p) &&
        ['new', 'on', 'off', 'hold'].indexOf(p.status) >= 0;
    }),
    horizon: horizonFor(snap, tab.id, d).filter(function (p) {
      const s = oppStage(p);
      return s === 'open' || s === 'hold';
    }),
    issues: snap.issues.filter(function (i) { return i.tab === tab.id && i.status === 'open'; })
  };
}

/**
 * The fields of each reply section a correction may set. Anything else in a
 * submitted form is ignored - the form comes off the page and is not trusted.
 */
export const FIX_FIELDS = {
  wins_losses: ['kind', 'person', 'text', 'why', 'change'],
  new_opportunities: ['customer', 'title', 'owner', 'mission'],
  opportunity_decisions: ['id', 'decision'],
  status_changes: ['id', 'status'],
  issues: ['text', 'owner', 'severity'],
  actions: ['text', 'owner', 'due', 'related_id']
};

/**
 * The reply with one suggestion corrected - a new object; the old one is left
 * alone. `key` is a proposal key ('<section>.<index>'); `values` maps field to
 * new value. A Discussed topic is a plain string and takes `values.text`.
 *
 * Returns the reply unchanged when the key does not name a suggestion in it.
 *
 * @param {any} reply
 * @param {string} key
 * @param {Record<string, any>} values
 * @returns {any}
 */
export function correctReply(reply, key, values) {
  const m = /^([a-z_]+)\.(\d+)$/.exec(String(key || ''));
  if (!reply || !m) return reply;
  const section = m[1];
  const i = Number(m[2]);
  const list = Array.isArray(reply[section]) ? reply[section] : null;
  if (!list || i >= list.length) return reply;

  let item;
  if (section === 'discussed') {
    item = values.text != null ? str(values.text) : list[i];
  } else if (FIX_FIELDS[section]) {
    item = Object.assign({}, typeof list[i] === 'object' && list[i] ? list[i] : {});
    FIX_FIELDS[section].forEach(function (f) {
      if (values[f] != null) item[f] = str(values[f]);
    });
  } else {
    return reply;
  }
  const out = Object.assign({}, reply);
  out[section] = list.slice();
  out[section][i] = item;
  return out;
}

/**
 * The types a suggestion can be switched between, in the order the dropdown
 * offers them. Opportunity decisions and status changes are not here: they are
 * about one record by its id, and mean nothing as anything else.
 */
export const RETYPES = [
  ['win', 'Win'], ['loss', 'Loss'], ['issue', 'Issue'], ['action', 'Action'],
  ['opportunity', 'New opportunity'], ['discussed', 'Discussed topic']
];

const TYPE_SECTION = {
  win: 'wins_losses', loss: 'wins_losses', issue: 'issues', action: 'actions',
  opportunity: 'new_opportunities', discussed: 'discussed'
};

/**
 * What type a suggestion is now, for the dropdown - or '' when it cannot be
 * switched.
 *
 * @param {any} reply
 * @param {string} key
 * @returns {string}
 */
export function typeOf(reply, key) {
  const m = /^([a-z_]+)\.(\d+)$/.exec(String(key || ''));
  if (!m || !reply || !Array.isArray(reply[m[1]])) return '';
  const item = reply[m[1]][Number(m[2])];
  if (m[1] === 'wins_losses') return str(item && item.kind).toLowerCase() === 'loss' ? 'loss' : 'win';
  const t = Object.keys(TYPE_SECTION).filter(function (k) {
    return k !== 'win' && k !== 'loss' && TYPE_SECTION[k] === m[1];
  });
  return t.length ? t[0] : '';
}

/**
 * Switch one suggestion to another type: an issue that was really a loss, a
 * discussed topic that should have been an action, a "win" that was only talk.
 *
 * The form's current values are applied first, so nothing typed is lost. Then
 * what carries across does: the words (text, or an opportunity's title), the
 * person (whoever it was about, or owned it), and any field both types share.
 * What the new type needs and the old did not have - a loss's "what we will do
 * differently", an action's due date - is left blank, so it shows as held back
 * until filled in.
 *
 * The old slot is emptied, not removed, so every other suggestion keeps its key;
 * the moved one goes on the end of its new list and gets a new key, returned so
 * the form can stay open on it.
 *
 * @param {any} reply
 * @param {string} key - '<section>.<index>'
 * @param {string} type - one of RETYPES
 * @param {Record<string, any>} values - the form's current values
 * @returns {{reply: any, key: string}}
 */
export function retypeReply(reply, key, type, values) {
  const m = /^([a-z_]+)\.(\d+)$/.exec(String(key || ''));
  const target = TYPE_SECTION[type];
  if (!reply || !m || !target || !typeOf(reply, key)) return { reply: reply, key: key };
  const section = m[1];
  const i = Number(m[2]);
  const base = correctReply(reply, key, values || {});
  const item = base[section][i];

  if (section === target) {
    if (section !== 'wins_losses') return { reply: base, key: key };
    const out = Object.assign({}, base);
    out[section] = base[section].slice();
    out[section][i] = Object.assign({}, item, { kind: type });
    return { reply: out, key: key };
  }

  const o = typeof item === 'object' && item ? item : {};
  const text = typeof item === 'string' ? str(item) : str(o.text || o.title);
  const who = str(o.person || o.owner);
  let moved;
  if (target === 'wins_losses') {
    moved = { kind: type, person: who, text: text, why: str(o.why), change: str(o.change) };
  } else if (target === 'issues') {
    moved = { text: text, owner: who, severity: str(o.severity) || 'stopper' };
  } else if (target === 'actions') {
    moved = { text: text, owner: who, due: str(o.due), related_id: str(o.related_id) };
  } else if (target === 'new_opportunities') {
    moved = { customer: str(o.customer), title: text, owner: who, mission: str(o.mission || o.why) };
  } else {
    moved = text;
  }

  const out = Object.assign({}, base);
  out[section] = base[section].slice();
  out[section][i] = null;
  out[target] = (Array.isArray(base[target]) ? base[target] : []).concat([moved]);
  return { reply: out, key: target + '.' + (out[target].length - 1) };
}

/**
 * The prompt to paste into Copilot.
 *
 * Written for Copilot, not for a person: exact shape, exact ids, and an explicit
 * "leave it out if unsure", because a missing suggestion costs nothing and a
 * wrong one costs a correction.
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @param {string} d - the meeting date
 * @returns {string}
 */
export function copilotPrompt(snap, tab, d) {
  const L = [];
  L.push('You are helping update a meeting board after the "' + tab.name +
    '" meeting on ' + fmtLong(d) + '.');
  L.push('Read the meeting transcript or recap (it is already available to you, attached ' +
    'as a file, or pasted below this prompt) - all of it, start to finish - and suggest ' +
    'changes to the board.');
  L.push('');
  L.push('Reply with ONE JSON object and nothing else, in exactly this shape. Leave out any ' +
    'list that has nothing in it. Only suggest something if the meeting clearly said it; ' +
    'if unsure, leave it out.');
  L.push('');
  L.push('{');
  L.push('  "wins_losses": [{"kind": "win or loss", "person": "name", "text": "what happened", ' +
    '"why": "why it happened", "change": "for a loss: what we will do differently"}],');
  L.push('  "new_opportunities": [{"customer": "", "title": "", "owner": "name", ' +
    '"mission": "what it is for and what could stop it"}],');
  L.push('  "opportunity_decisions": [{"id": "an id from HORIZON", ' +
    '"decision": "promoted or hold or cancelled"}],');
  L.push('  "status_changes": [{"id": "an id from CURRENT PROJECTS", ' +
    '"status": "on or off or hold or cancelled or done"}],');
  L.push('  "issues": [{"text": "", "owner": "name", "severity": "stopper or risk"}],');
  L.push('  "actions": [{"text": "", "owner": "name", "due": "YYYY-MM-DD", ' +
    '"related_id": "an id from CURRENT PROJECTS, HORIZON or OPEN ISSUES; or, for a new ' +
    'opportunity or new issue in this same reply, its place in that list counting from 0, ' +
    'like new_opportunities.0 or issues.1; or empty"}],');
  L.push('  "discussed": ["a short line for each topic talked through that is not one of ' +
    'the changes above"]');
  L.push('}');
  L.push('');
  L.push('Rules: use ids and names exactly as listed below. status "on" means on track, ' +
    '"off" means off track. Severity "stopper" is urgent, "risk" is important. Dates as ' +
    'YYYY-MM-DD; if a due date was said as a weekday, give the next one after ' + d + '.');
  L.push('');
  const lists = meetingLists(snap, tab, d);
  L.push('PEOPLE');
  lists.people.forEach(function (p) { L.push('- ' + p.name); });
  L.push('');
  L.push('CURRENT PROJECTS (id | name | status)');
  if (!lists.projects.length) L.push('- none');
  lists.projects.forEach(function (p) {
    L.push('- ' + p.id + ' | ' + projectTitle(p) + ' | ' + (STATUS_LABELS[p.status] || p.status));
  });
  L.push('');
  L.push('HORIZON - opportunities waiting for a decision (id | name)');
  if (!lists.horizon.length) L.push('- none');
  lists.horizon.forEach(function (p) {
    L.push('- ' + p.id + ' | ' + projectTitle(p) + (oppStage(p) === 'hold' ? ' (on hold)' : ''));
  });
  L.push('');
  L.push('OPEN ISSUES (id | issue)');
  if (!lists.issues.length) L.push('- none');
  lists.issues.forEach(function (i) { L.push('- ' + i.id + ' | ' + i.text); });
  L.push('');
  L.push('MEETING RECAP OR TRANSCRIPT (if not already available to you):');
  L.push('');
  return L.join('\n');
}

/**
 * The JSON in Copilot's reply, wherever it is.
 *
 * Copilot tends to wrap JSON in a ```json fence, or put a sentence before it.
 * Everything from the first "{" to the last "}" is tried, which handles both.
 *
 * @param {string} text
 * @returns {{ok: boolean, data: any, error: string}}
 */
export function readReply(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) {
    return { ok: false, data: null, error: 'There is no JSON in that reply. Ask Copilot to ' +
      'reply with the JSON only, using the prompt.' };
  }
  try {
    const data = JSON.parse(s.slice(a, b + 1));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return { ok: true, data: data, error: '' };
  } catch (e) {
    return { ok: false, data: null, error: 'That reply is not readable JSON (' +
      String(e && e.message || e) + '). Copy the whole reply, including the braces.' };
  }
}

/**
 * A roster person from a name Copilot wrote.
 *
 * Exact full name first, ignoring case. Then a first name, but only when exactly
 * one person has it - preferring the meeting's own people. Anything else is no
 * match, never a guess.
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @param {any} name
 * @returns {any | null}
 */
export function personFor(snap, tab, name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  const exact = snap.people.filter(function (p) { return String(p.name).toLowerCase() === want; });
  if (exact.length === 1) return exact[0];
  const first = function (p) { return String(p.name).split(/\s+/)[0].toLowerCase(); };
  const ids = attendeeIds(tab);
  const inMeeting = snap.people.filter(function (p) { return ids.indexOf(p.id) >= 0 && first(p) === want; });
  if (inMeeting.length === 1) return inMeeting[0];
  const anyone = snap.people.filter(function (p) { return first(p) === want; });
  return anyone.length === 1 ? anyone[0] : null;
}

/** A list from the reply, or empty when it is missing or not a list. */
function listOf(data, key) {
  return data && Array.isArray(data[key]) ? data[key] : [];
}

/*
 * Each item of one list, with its index - skipping the empty slot a suggestion
 * leaves when it is moved to another type (see retypeReply). The slot is left
 * rather than removed so every other suggestion keeps its key, and with it its
 * tick.
 */
function each(data, key, fn) {
  listOf(data, key).forEach(function (x, i) { if (x !== null) fn(x, i); });
}

/**
 * An action's related_id, when it points at a new opportunity or new issue in
 * the same reply ("new_opportunities.0", "issues.1"): its key, and how to name
 * it - or no label when that slot is empty (moved to another type).
 *
 * @param {any} data - the reply
 * @param {string} rel
 * @returns {{key: string, label: string}}
 */
export function pendingOf(data, rel) {
  const m = /^(new_opportunities|issues)\.(\d+)$/.exec(rel || '');
  if (!m) return { key: '', label: '' };
  const item = listOf(data, m[1])[Number(m[2])];
  if (!item || typeof item !== 'object') return { key: rel, label: '' };
  return { key: rel, label: m[1] === 'issues'
    ? 'Issue: ' + (str(item.text) || '?')
    : 'Opportunity: ' + [str(item.customer), str(item.title)].filter(Boolean).join(' - ') };
}

function str(v) {
  return String(v == null ? '' : v).trim();
}

/** A real calendar date as YYYY-MM-DD, or ''. */
function dateOf(v) {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const t = new Date(s + 'T00:00:00Z');
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s ? s : '';
}

/**
 * Every suggestion in the reply, checked against the board as it is now.
 *
 * Checked at render, not when pasted: if somebody promotes an opportunity by hand
 * while the checklist is open, the suggestion to promote it turns into "already
 * decided" rather than applying twice.
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @param {string} d
 * @param {any} data - the reply, from readReply
 * @returns {Proposal[]}
 */
export function proposalsFrom(snap, tab, d, data) {
  /** @type {Proposal[]} */
  const out = [];
  function add(key, kind, text, reason, payload) {
    out.push({ key: key, kind: kind, text: text, ok: !reason, reason: reason || '', payload: payload });
  }

  each(data, 'wins_losses', function (w, i) {
    const kind = str(w && w.kind).toLowerCase() === 'loss' ? 'loss' : 'win';
    const who = personFor(snap, tab, w && w.person);
    const text = str(w && w.text);
    const change = str(w && w.change);
    add('wins_losses.' + i, kind, (kind === 'win' ? 'Win' : 'Loss') + ' · ' +
      (who ? who.name : str(w && w.person) || '?') + ': ' + text +
      (str(w && w.why) ? '. Why: ' + str(w.why) : '') +
      (change ? (kind === 'loss' ? '. Doing differently: ' : '. Keep doing: ') + change : ''),
      !text ? 'Nothing to record.'
        : !who ? 'Nobody on the roster is called "' + str(w && w.person) + '".'
        : kind === 'loss' && !change ? 'A loss needs what we will do differently.' : '',
      { kind: kind, personId: who && who.id, text: text, why: str(w && w.why), change: change });
  });

  each(data, 'new_opportunities', function (o, i) {
    const who = personFor(snap, tab, o && o.owner);
    const title = str(o && o.title);
    const customer = str(o && o.customer);
    add('new_opportunities.' + i, 'opportunity', 'New opportunity · ' +
      (customer ? customer + ' - ' : '') + title + ' (' + (who ? who.name : str(o && o.owner) || '?') + ')',
      !title ? 'It has no title.'
        : !who ? 'Nobody on the roster is called "' + str(o && o.owner) + '".' : '',
      { personId: who && who.id, customer: customer, title: title, mission: str(o && o.mission) });
  });

  each(data, 'opportunity_decisions', function (o, i) {
    const p = byId(snap.projects, str(o && o.id));
    const decision = str(o && o.decision).toLowerCase();
    const label = { promoted: 'Promote', hold: 'Put on hold', cancelled: 'Cancel' }[decision] || decision;
    const allowed = p ? decisionsFor(p).some(function (x) { return x[0] === decision; }) : false;
    add('opportunity_decisions.' + i, 'decision', label + ' · ' + (p ? projectTitle(p) : str(o && o.id)),
      !p || p.tab !== tab.id || !isOpportunity(p) ? 'No opportunity "' + str(o && o.id) + '" in this meeting.'
        : !allowed ? 'Not possible from where it stands (' + oppStage(p) + ').' : '',
      { id: p && p.id, decision: decision });
  });

  each(data, 'status_changes', function (c, i) {
    const p = byId(snap.projects, str(c && c.id));
    const status = str(c && c.status).toLowerCase();
    add('status_changes.' + i, 'status', (p ? projectTitle(p) : str(c && c.id)) + ' → ' +
      (STATUS_LABELS[status] || status),
      !p || p.tab !== tab.id || isOpportunity(p) ? 'No current project "' + str(c && c.id) + '" in this meeting.'
        : STATUSES.indexOf(status) < 0 ? 'Not a status: "' + status + '".'
        : p.status === status ? 'It is already ' + STATUS_LABELS[status] + '.' : '',
      { id: p && p.id, status: status });
  });

  each(data, 'issues', function (s, i) {
    const who = personFor(snap, tab, s && s.owner);
    const text = str(s && s.text);
    const sev = SEVERITIES.indexOf(str(s && s.severity).toLowerCase()) >= 0 &&
      str(s && s.severity).toLowerCase() !== 'offtrack' ? str(s.severity).toLowerCase() : 'stopper';
    add('issues.' + i, 'issue', 'Issue · ' + text + (who ? ' (' + who.name + ')' : ''),
      !text ? 'It says nothing.' : '',
      { personId: who ? who.id : '', text: text, sev: sev });
  });

  each(data, 'actions', function (a, i) {
    const who = personFor(snap, tab, a && a.owner);
    const text = str(a && a.text);
    const due = dateOf(a && a.due);
    const rel = str(a && a.related_id);
    // Tied to something new in this same reply - an opportunity or issue that does
    // not exist yet. Linked on Apply, once it does (planFrom).
    const pend = pendingOf(data, rel);
    const proj = rel && !pend.key ? byId(snap.projects, rel) : null;
    const issue = rel && !pend.key && !proj ? byId(snap.issues, rel) : null;
    const parent = proj && proj.tab === tab.id ? { type: 'project', id: proj.id }
      : issue && issue.tab === tab.id ? { type: 'issue', id: issue.id } : null;
    add('actions.' + i, 'action', 'Action · ' + text + ' · ' + (who ? who.name : str(a && a.owner) || '?') +
      ' · due ' + (due || str(a && a.due) || '?') +
      (parent ? ' · re ' + (proj ? projectTitle(proj) : issue.text)
        : pend.label ? ' · re ' + pend.label + ' (new, above)' : ''),
      !text ? 'It says nothing.'
        : !who ? 'Nobody on the roster is called "' + str(a && a.owner) + '".'
        : !due ? 'It needs a due date as YYYY-MM-DD.'
        : pend.key && !pend.label ? 'What it was tied to has been changed to another type - pick again in Edit.'
        : rel && !parent && !pend.key ? 'Nothing in this meeting has the id "' + rel + '".' : '',
      { owner: who && who.name, text: text, due: due, parent: parent, pending: pend.label ? pend.key : '' });
  });

  each(data, 'discussed', function (t, i) {
    const line = str(typeof t === 'string' ? t : t && t.text);
    add('discussed.' + i, 'discussed', 'Discussed · ' + line, line ? '' : 'Empty.', { text: line });
  });

  return out;
}

/**
 * The writes for the ticked proposals.
 *
 * Built from the same domain functions the board's own buttons use. Actions are
 * returned separately: each needs the next action number, which only the store
 * can hand out, one at a time.
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @param {string} d
 * @param {Proposal[]} proposals
 * @param {string[]} skip - keys the reader unticked
 * @param {() => string} newId
 * @returns {{ops: any[], actions: any[], discussed: string[], count: number}}
 */
export function planFrom(snap, tab, d, proposals, skip, newId) {
  const take = proposals.filter(function (p) { return p.ok && skip.indexOf(p.key) < 0; });
  const ops = [];
  const actions = [];
  const discussed = [];

  // What each new opportunity and issue became, by its key in the reply, so an
  // action tied to one can be pointed at the real record.
  const made = {};

  take.forEach(function (p) {
    const x = p.payload;
    if (p.kind === 'win' || p.kind === 'loss') {
      ops.push({ op: 'set', col: 'entries', id: newId(), data: {
        tab: tab.id, meeting: d, personId: x.personId, kind: x.kind,
        text: x.text, why: x.why, change: x.change
      } });
    } else if (p.kind === 'opportunity') {
      const entryId = newId();
      const projectId = newId();
      const built = newOpportunity({
        entryId: entryId, projectId: projectId, tab: tab.id, personId: x.personId,
        text: x.title, customer: x.customer, mission: x.mission, meetingDate: d
      });
      ops.push({ op: 'set', col: 'entries', id: entryId, data: built.entry });
      ops.push({ op: 'set', col: 'projects', id: projectId, data: built.project });
      made[p.key] = { type: 'project', id: projectId };
    } else if (p.kind === 'decision') {
      decideOpportunity(snap, x.id, x.decision, d).writes.forEach(function (w) { ops.push(w); });
    } else if (p.kind === 'status') {
      const doc = statusChange(snap, byId(snap.projects, x.id), x.status, tab.id, d);
      if (doc) ops.push({ op: 'set', col: 'projects', id: x.id, data: doc });
    } else if (p.kind === 'issue') {
      const issueId = newId();
      made[p.key] = { type: 'issue', id: issueId };
      ops.push({ op: 'set', col: 'issues', id: issueId, data: newIssue({
        snap: snap, tab: tab.id, personId: x.personId, text: x.text, sev: x.sev, meetingDate: d
      }) });
    } else if (p.kind === 'action') {
      actions.push(x);
    } else if (p.kind === 'discussed') {
      discussed.push(x.text);
    }
  });

  // Tied to something new: linked if it is being added, otherwise no origin -
  // the checklist says so beforehand (views/copilot.js).
  const linked = actions.map(function (x) {
    if (!x.pending) return x;
    return Object.assign({}, x, { parent: made[x.pending] || null });
  });

  return { ops: ops, actions: linked, discussed: discussed, count: take.length };
}

/** Plain-language names for the checklist's groups, in the order shown. */
export const PROPOSAL_GROUPS = [
  ['win', 'Wins'], ['loss', 'Losses'], ['opportunity', 'New opportunities'],
  ['decision', 'Opportunity decisions'], ['status', 'Project status changes'],
  ['issue', 'Issues'], ['action', 'Actions'], ['discussed', 'Discussed']
];
