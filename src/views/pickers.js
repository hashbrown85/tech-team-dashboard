// @ts-check
/**
 * The control for a project's multi-value fields: products, focus, resources.
 *
 * Shared because it is used in two places with different surroundings — the project
 * page wraps it in a `.rp` row, the meeting's project tile puts a `.lbl` above it —
 * so the control returns just its own markup and lets the caller frame it.
 *
 * ## Why a dropdown rather than togglable chips
 *
 * The first version was a grid of chips you clicked on and off, which is fine for
 * four demo products. The real product list lives in Dataverse and will be far
 * longer than a line, and a picker that renders every option is unusable at that
 * size. This one only renders what is chosen, plus a dropdown of what is not — so
 * it survives the switch instead of having to be rebuilt after it.
 *
 * ## Both halves already existed in the stylesheet
 *
 * `.pchip` with an `.x` is what the Board settings screen uses for exactly this,
 * and `select.fld` is the dropdown used everywhere else. Nothing new was needed.
 */

import { esc } from '../lib/dom.js';
import { pickList } from '../domain/queries.js';

/** The select value that means "let me type a new one", not a value to store. */
export const NEW_VALUE = '__new__';

/** Chips for what is chosen, each with its remove button. */
function chosenChips(env, p, field, chosen) {
  return chosen.length
    ? '<div class="mchips">' + chosen.map(function (v) {
        return '<span class="pchip">' + esc(v) +
          (env.areaReadonly ? ''
            : '<button class="x" type="button" data-act="projDrop" data-id="' + esc(p.id) +
              '" data-f="' + field + '" data-v="' + esc(v) +
              '" aria-label="Remove ' + esc(v) + '">\u00d7</button>') +
          '</span>';
      }).join('') + '</div>'
    : '<span class="why">None chosen yet.</span>';
}

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

/**
 * Chips for what is chosen, and a dropdown to add from what is not.
 *
 * @param {Snapshot} snap
 * @param {any} env
 * @param {any} p - the project
 * @param {string} field - 'products' | 'systems'
 * @param {string} noun - singular, for the add prompt: "product", "system"
 * @param {{allowNew?: boolean, ui?: any}} [opts] - allowNew offers "+ New ..." so a
 *   value missing from the list can be added on the spot (see forms.newPickValue)
 * @returns {string}
 */
export function pickerControl(snap, env, p, field, noun, opts) {
  const o = opts || {};
  const chosen = p[field] || [];
  const options = pickList(snap, field);
  const allowNew = !!o.allowNew && !env.areaReadonly;

  // The inline "new value" form, when it is the one open.
  if (allowNew && o.ui && o.ui.open === 'newval:' + field + ':' + p.id) {
    return chosenChips(env, p, field, chosen) +
      '<form class="add listval" data-form="newPickValue" data-id="' + esc(p.id) +
      '" data-key="' + field + '">' +
      '<input class="fld" name="value" type="text" placeholder="New ' + noun +
      '" aria-label="New ' + noun + '" required>' +
      '<button class="btn sm" type="submit">Add</button>' +
      '<button class="btn ghost sm" type="button" data-act="closeForm">Cancel</button></form>';
  }

  if (!options.length && !allowNew) {
    return '<span class="why">Nothing in this list yet — it is maintained on ' +
      'the Board settings screen.</span>';
  }

  const chips = chosenChips(env, p, field, chosen);

  // Only what is not already on. Offering a chosen value again would either do
  // nothing or silently take it off, and neither is what picking it looks like.
  const available = options.filter(function (v) { return chosen.indexOf(v) < 0; });

  let add = '';
  if (!env.areaReadonly) {
    add = available.length || allowNew
      ? '<select class="fld" data-edit="projAdd" data-id="' + esc(p.id) +
        '" data-f="' + field + '" aria-label="Add a ' + noun + '">' +
        // A blank first option, or the select shows a value that is not chosen as
        // though it were.
        '<option value="">+ Add a ' + noun + '</option>' +
        available.map(function (v) {
          return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
        }).join('') +
        // Last, and not a value: it opens a box to type one that is not listed.
        (allowNew ? '<option value="' + NEW_VALUE + '">+ New ' + noun + '\u2026</option>' : '') +
        '</select>'
      : '<span class="why">Every ' + noun + ' on the list is chosen.</span>';
  }

  return chips + add;
}
