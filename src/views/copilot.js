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
import { proposalsFrom, PROPOSAL_GROUPS } from '../domain/copilot.js';

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
    'transcript; anywhere else, paste the recap after it.</span></li>' +
    '<li><span class="why">Paste Copilot’s whole reply here:</span>' +
    '<form class="add" data-form="copilotReply">' +
    '<textarea class="fld full" name="reply" rows="4" required ' +
    'placeholder="Copilot’s reply - the JSON, braces and all"></textarea>' +
    '<button class="btn sm" type="submit">Read reply</button></form></li>' +
    '</ol>';

  const error = ui.copilotError
    ? '<p class="scope-note">' + esc(ui.copilotError) + '</p>' : '';

  const list = ui.copilotReply ? checklist(snap, ui, tab, d, ro) : '';

  return '<section class="panel" aria-label="Copilot"><div class="pan-h">' +
    '<h2>Copilot</h2><span class="sub">Suggested changes from the meeting</span>' +
    '<div class="r"><button class="btn ghost sm" type="button" data-act="toggleCopilot">Close</button>' +
    '</div></div>' + (list ? '' : steps) + error + list + '</section>';
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

  const groups = PROPOSAL_GROUPS.map(function (g) {
    const mine = all.filter(function (p) { return p.kind === g[0]; });
    if (!mine.length) return '';
    return '<div class="lbl">' + g[1] + '</div><ul class="cpl">' + mine.map(function (p) {
      const on = p.ok && skip.indexOf(p.key) < 0;
      return '<li class="cpi' + (p.ok ? '' : ' no') + '"><label>' +
        '<input type="checkbox" data-edit="copilotPick" data-v="' + esc(p.key) + '"' +
        (on ? ' checked' : '') + (p.ok && !ro ? '' : ' disabled') + '> ' +
        '<span>' + esc(p.text) + '</span></label>' +
        (p.ok ? '' : '<span class="why">Can’t apply: ' + esc(p.reason) + '</span>') +
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
