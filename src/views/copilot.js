// @ts-check
/**
 * The Copilot panel on a meeting: copy the prompt, paste the reply, tick through
 * what it suggests, apply. See domain/copilot.js for how the round trip works and
 * why it goes through the clipboard.
 *
 * The parsed reply is kept in ui (ui.copilotReply), not on the board: it is a
 * draft until applied, and belongs to whoever is holding the clipboard. Proposals
 * are worked out again on every render, so the list always reflects the board as
 * it is now.
 */

import { esc } from '../lib/dom.js';
import {
  proposalsFrom, PROPOSAL_GROUPS, meetingLists, RETYPES, typeOf, pendingOf, legalReview
} from '../domain/copilot.js';
import { projectTitle } from '../domain/projects.js';
import { STATUSES, STATUS_LABELS, SEVERITY_LABELS } from '../domain/constants.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

/**
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {any} env
 * @param {any} tab
 * @param {string} d
 */
export function copilotPanel(snap, ui, env, tab, d) {
  const ro = env.areaReadonly;
  const steps =
    '<ol class="cp-steps">' +
    '<li><button class="btn sm" type="button" data-act="copilotPrompt">Copy prompt</button> ' +
    '<span class="why">Paste it into Copilot - in the Teams meeting chat it already has the ' +
    'transcript; anywhere else, attach the transcript file (.docx) to the same message.</span></li>' +
    '<li><span class="why">Paste Copilot’s whole reply here:</span>' +
    '<form class="add" data-form="copilotReply">' +
    '<textarea class="fld full" name="reply" rows="4" required ' +
    'placeholder="Copilot’s reply - the JSON, braces and all"></textarea>' +
    '<button class="btn sm" type="submit">Read reply</button></form></li>' +
    '</ol>';

  const error = ui.copilotError
    ? '<p class="scope-note">' + esc(ui.copilotError) + '</p>' : '';

  const list = ui.copilotReply ? checklist(snap, ui, tab, d, ro) + legalNote(ui.copilotReply) : '';

  return '<section class="panel" aria-label="Copilot"><div class="pan-h">' +
    '<h2>Copilot</h2><span class="sub">Suggested changes from the meeting</span>' +
    '<div class="r"><button class="btn ghost sm" type="button" data-act="toggleCopilot">Close</button>' +
    '</div></div>' + (list ? '' : steps) + error + list + '</section>';
}

/**
 * What Copilot set aside for a Legal check - subjects only. Never applied; it is
 * there so nothing is dropped without anyone knowing.
 */
function legalNote(reply) {
  const items = legalReview(reply);
  if (!items.length) return '';
  return '<div class="cp-legal"><div class="lbl">Set aside for a check with Legal</div>' +
    '<p class="why">Copilot left these off the board under the legal rules in the prompt. ' +
    'Nothing here is applied; raise them with Legal if they need following up.</p>' +
    '<ul class="cpl">' + items.map(function (x) {
      return '<li class="cpi no"><span>' + esc(x.topic) + '</span>' +
        (x.reason ? '<span class="why">' + esc(x.reason) + '</span>' : '') + '</li>';
    }).join('') + '</ul></div>';
}

/** The suggestions, grouped, each with a tick box - or the reason it cannot apply. */
function checklist(snap, ui, tab, d, ro) {
  const all = proposalsFrom(snap, tab, d, ui.copilotReply);
  if (!all.length) {
    return '<p class="none">Copilot suggested nothing. ' +
      '<button class="linkbtn" type="button" data-act="copilotClear">Start again</button></p>';
  }
  const skip = ui.copilotSkip || [];
  const chosen = all.filter(function (p) { return p.ok && skip.indexOf(p.key) < 0; }).length;
  const blocked = all.filter(function (p) { return !p.ok; }).length;

  /** Is the suggestion with this key going to be applied? */
  function taking(key) {
    return all.some(function (p) { return p.key === key && p.ok && skip.indexOf(key) < 0; });
  }

  const groups = PROPOSAL_GROUPS.map(function (g) {
    const mine = all.filter(function (p) { return p.kind === g[0]; });
    if (!mine.length) return '';
    return '<div class="lbl">' + g[1] + '</div><ul class="cpl">' + mine.map(function (p) {
      // Being corrected: the row becomes its form. One at a time, like every
      // other inline editor on the board.
      if (!ro && ui.open === 'cpfix:' + p.key) {
        return '<li class="cpi">' + fixForm(snap, tab, d, p.key, ui.copilotReply) + '</li>';
      }
      const on = p.ok && skip.indexOf(p.key) < 0;
      return '<li class="cpi' + (p.ok ? '' : ' no') + '"><label>' +
        '<input type="checkbox" data-edit="copilotPick" data-v="' + esc(p.key) + '"' +
        (on ? ' checked' : '') + (p.ok && !ro ? '' : ' disabled') + '> ' +
        '<span>' + esc(p.text) + '</span></label>' +
        (ro ? '' : ' <button type="button" class="linkbtn" data-act="copilotEdit" data-v="' +
          esc(p.key) + '">Edit</button>') +
        (p.ok ? '' : '<span class="why">Can’t apply: ' + esc(p.reason) + '</span>') +
        (on && p.payload && p.payload.pending && !taking(p.payload.pending)
          ? '<span class="why">What it is tied to is not being added, so it will go on with ' +
            'no origin.</span>'
          : '') +
        '</li>';
    }).join('') + '</ul>';
  }).join('');

  return '<p class="sub">' + all.length + ' suggested' +
    (blocked ? ', ' + blocked + ' can’t be applied as given' : '') +
    '. Untick anything wrong, then apply.</p>' + groups +
    '<div class="acts-r">' +
    '<button class="btn" type="button" data-act="copilotApply"' +
    (chosen && !ro ? '' : ' disabled') + '>Apply ' + chosen + ' change' + (chosen === 1 ? '' : 's') +
    '</button> <button class="btn ghost" type="button" data-act="copilotClear">Discard</button></div>';
}

/**
 * Correcting one suggestion: the reply's own values, in a form.
 *
 * Anything that has to match the board - a person, a project, an opportunity,
 * an issue, a status, a severity - is a dropdown of what the board actually has,
 * so a name the audio garbled is a pick, not a retype. When the value Copilot
 * wrote matches nothing, the dropdown says so and starts on that, so saving it
 * unchanged keeps it held back rather than quietly picking somebody.
 *
 * @param {Snapshot} snap
 * @param {any} tab
 * @param {string} d
 * @param {string} key - '<section>.<index>'
 * @param {any} reply
 */
function fixForm(snap, tab, d, key, reply) {
  const m = /^([a-z_]+)\.(\d+)$/.exec(key);
  const section = m ? m[1] : '';
  const raw = m && reply && Array.isArray(reply[section]) ? reply[section][Number(m[2])] : null;
  const v = function (f) {
    return raw && typeof raw === 'object' && raw[f] != null ? String(raw[f]) : '';
  };
  const lists = meetingLists(snap, tab, d);

  function text(name, label, value) {
    return '<input class="fld" type="text" name="' + name + '" value="' + esc(value) +
      '" placeholder="' + esc(label) + '" aria-label="' + esc(label) + '">';
  }
  /** A dropdown of [value, label] pairs, on `current` - or on a "not on the board" line. */
  function pick(name, label, pairs, current, blank) {
    const known = pairs.some(function (o) { return o[0] === current; });
    return '<select class="fld" name="' + name + '" aria-label="' + esc(label) + '">' +
      (blank != null
        ? '<option value=""' + (current === '' ? ' selected' : '') + '>' + esc(blank) + '</option>'
        : '') +
      (!known && current
        ? '<option value="' + esc(current) + '" selected>' + esc(current) +
          ' (not on the board)</option>'
        : '') +
      pairs.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === current ? ' selected' : '') + '>' +
          esc(o[1]) + '</option>';
      }).join('') + '</select>';
  }

  // People by NAME, because that is what the reply holds and personFor matches.
  const people = lists.people.map(function (p) { return [p.name, p.name]; });
  const projects = lists.projects.map(function (p) { return [p.id, projectTitle(p)]; });
  const horizon = lists.horizon.map(function (p) { return [p.id, projectTitle(p)]; });

  let fields = '';
  if (section === 'wins_losses') {
    fields = pick('person', 'Who', people, v('person'), 'Who…') +
      text('text', 'What happened', v('text')) + text('why', 'Why', v('why')) +
      text('change', 'For a loss: what we will do differently', v('change'));
  } else if (section === 'new_opportunities') {
    fields = text('customer', 'Customer', v('customer')) + text('title', 'Title', v('title')) +
      pick('owner', 'Owner', people, v('owner'), 'Owner…') +
      text('mission', 'Mission & challenges', v('mission'));
  } else if (section === 'opportunity_decisions') {
    fields = pick('id', 'Opportunity', horizon, v('id'), 'Opportunity…') +
      pick('decision', 'Decision', [['promoted', 'Promote to project'], ['hold', 'Put on hold'],
        ['cancelled', 'Cancel']], v('decision'));
  } else if (section === 'status_changes') {
    fields = pick('id', 'Project', projects, v('id'), 'Project…') +
      pick('status', 'Status',
        STATUSES.map(function (s) { return [s, STATUS_LABELS[s]]; }), v('status'));
  } else if (section === 'issues') {
    fields = text('text', 'The issue', v('text')) +
      pick('owner', 'Raised by', people, v('owner'), 'Nobody in particular') +
      pick('severity', 'Severity',
        [['stopper', SEVERITY_LABELS.stopper], ['risk', SEVERITY_LABELS.risk]],
        v('severity') === 'risk' ? 'risk' : 'stopper');
  } else if (section === 'actions') {
    // New opportunities and issues suggested in this same reply can be picked too:
    // the action is tied to them when they are added.
    const fresh = ['new_opportunities', 'issues'].reduce(function (acc, sec) {
      (Array.isArray(reply[sec]) ? reply[sec] : []).forEach(function (x, i) {
        const pend = pendingOf(reply, sec + '.' + i);
        if (pend.label) acc.push([pend.key, 'New ' + pend.label.charAt(0).toLowerCase() + pend.label.slice(1)]);
      });
      return acc;
    }, []);
    const related = projects.concat(horizon)
      .map(function (o) { return [o[0], 'Project · ' + o[1]]; })
      .concat(lists.issues.map(function (i) { return [i.id, 'Issue · ' + i.text]; }))
      .concat(fresh);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(v('due')) ? v('due') : '';
    fields = text('text', 'What will be done', v('text')) +
      pick('owner', 'Owner', people, v('owner'), 'Owner…') +
      '<input class="fld" type="date" name="due" value="' + esc(due) + '" aria-label="Due date">' +
      pick('related_id', 'Related to', related, v('related_id'), 'Related to: nothing specific');
  } else if (section === 'discussed') {
    fields = text('text', 'Topic', typeof raw === 'string' ? raw : '');
  }

  // The type, first: switching it redraws the form with the new type's fields,
  // carrying the words and the person across.
  const type = typeOf(reply, key);
  const typeSel = type
    ? '<select class="fld" name="type" aria-label="Type" data-edit="copilotType" data-v="' +
      esc(key) + '">' + RETYPES.map(function (t) {
        return '<option value="' + t[0] + '"' + (t[0] === type ? ' selected' : '') + '>' +
          t[1] + '</option>';
      }).join('') + '</select>'
    : '';

  return '<form class="add cpfix" data-form="copilotFix" data-v="' + esc(key) + '">' + typeSel + fields +
    '<button class="btn sm" type="submit">Save</button>' +
    '<button class="btn ghost sm" type="button" data-act="closeForm">Cancel</button></form>';
}
