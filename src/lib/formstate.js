// @ts-check
/**
 * Keeping what somebody has typed, across a re-render.
 *
 * ## The problem this exists for
 *
 * The app draws itself with `root.innerHTML = renderApp(...)`, which is what makes
 * every view a pure function of the snapshot. But a form that has not been submitted
 * yet has no record behind it: what is in those boxes lives ONLY in the DOM. Replace
 * the HTML and it is gone.
 *
 * Nothing about that is obvious until a form is long enough to outlive the 60-second
 * idle poll — and then the fields empty themselves halfway through, at a different
 * point every time, for no reason the person typing can see. A reload on window
 * focus does the same thing the moment you alt-tab to check something.
 *
 * Fields carrying `data-edit` never had this problem: they write on change, so the
 * store already has the value and the next render puts it back. It is only the
 * creation forms — the ones where nothing has been saved yet — that lose anything.
 *
 * ## The approach
 *
 * Read the open forms before the replace, put them back after. That is preferable to
 * suppressing the redraw while somebody types, which would leave the board quietly
 * stale for as long as a form stayed open, and would still lose the contents on any
 * render that did happen.
 *
 * Both functions take the root and the focused element as arguments rather than
 * reaching for `document`, so they can be tested without a browser.
 */

/**
 * Replace a root's contents, keeping anything half-typed in its open forms.
 *
 * The capture and the restore are one call on purpose. As two statements around an
 * `innerHTML =` they are trivially separable, and dropping the second one silently
 * reintroduces the exact bug this file exists for — a form emptying itself mid-entry
 * whenever the idle poll fires. Here there is nothing to forget.
 *
 * @param {any} root
 * @param {string} html
 * @param {any} [active] - the focused element, if any
 */
export function renderPreservingForms(root, html, active) {
  /*
   * captureForms only looks inside `form[data-form]`, so a focused element anywhere
   * else - a toggle button, a nav item - is invisible to it and focus lands on
   * <body> after the redraw. For a button whose own click causes the redraw that is
   * a trap: press it by keyboard and you have to tab from the top of the page to
   * press it again.
   *
   * An id is the only stable handle a full-string render leaves behind, so that is
   * what we re-find it by. Elements without one are unchanged from before.
   */
  const focusId = idOf(active);
  const typed = captureForms(root, active);
  root.innerHTML = html;
  restoreForms(root, typed);
  if (focusId) refocusById(root, focusId);
}

/** A plain, selector-safe id. Anything else is not worth escaping for. */
function idOf(el) {
  const id = el && el.id ? String(el.id) : '';
  return /^[A-Za-z][\w-]*$/.test(id) ? id : '';
}

/**
 * Put focus back on the element that had it, unless restoreForms already placed it
 * somewhere - a form field always wins, because that is where a caret lives.
 */
function refocusById(root, id) {
  const doc = root && root.ownerDocument;
  const now = doc && doc.activeElement;
  if (now && doc.body && now !== doc.body && root.contains && root.contains(now)) return;
  const el = root.querySelector && root.querySelector('#' + id);
  if (el && typeof el.focus === 'function') el.focus();
}

/**
 * @typedef {object} SavedField
 * @property {string} name
 * @property {string} type
 * @property {string} value
 * @property {boolean} checked
 * @property {boolean} focused
 * @property {number} [start] - selection, so the caret does not jump to the end
 * @property {number} [end]
 */

/**
 * @typedef {object} SavedForm
 * @property {string} key
 * @property {SavedField[]} fields
 */

const FIELDS = 'input, select, textarea';

/**
 * Which form this is, stable across a re-render.
 *
 * The name alone is not enough: every person's block on a meeting screen can have a
 * form with the same `data-form`, and restoring one person's typing into another
 * person's form would be worse than losing it.
 *
 * @param {any} form
 * @returns {string}
 */
function keyOf(form) {
  const attrs = ['data-form', 'data-pid', 'data-id', 'data-tab'];
  return attrs.map(function (a) {
    return String(form.getAttribute(a) || '');
  }).join('|');
}

/** Selection range, where the element has one. Number and date inputs throw. */
function selectionOf(el) {
  try {
    if (typeof el.selectionStart !== 'number') return null;
    return { start: el.selectionStart, end: el.selectionEnd };
  } catch (e) {
    return null;
  }
}

/**
 * Read every open form's contents.
 *
 * @param {any} root - the element about to be replaced
 * @param {any} [active] - the focused element, if any
 * @returns {SavedForm[]}
 */
export function captureForms(root, active) {
  if (!root || !root.querySelectorAll) return [];

  /** @type {SavedForm[]} */
  const out = [];

  Array.prototype.forEach.call(root.querySelectorAll('form[data-form]'), function (form) {
    /** @type {SavedField[]} */
    const fields = [];

    Array.prototype.forEach.call(form.querySelectorAll(FIELDS), function (el) {
      const sel = el === active ? selectionOf(el) : null;
      fields.push({
        name: String(el.name || ''),
        type: String(el.type || ''),
        value: el.value == null ? '' : String(el.value),
        checked: !!el.checked,
        focused: el === active,
        start: sel ? sel.start : undefined,
        end: sel ? sel.end : undefined
      });
    });

    if (fields.length) out.push({ key: keyOf(form), fields: fields });
  });

  return out;
}

/**
 * Put those contents back into the freshly rendered forms.
 *
 * Matching is by form key and then by position within it, rather than by `name`,
 * because a form can legitimately repeat a name — the focus checkboxes all share
 * one, which is how a browser sends several values under it.
 *
 * A form that is no longer on the page is skipped, which is what happens after a
 * successful submit: the values are gone because the thing they described now
 * exists, and restoring them would put a ghost of it back.
 *
 * @param {any} root - the newly rendered element
 * @param {SavedForm[]} saved
 */
export function restoreForms(root, saved) {
  if (!root || !root.querySelectorAll || !saved || !saved.length) return;

  const byKey = {};
  saved.forEach(function (s) { byKey[s.key] = s; });

  Array.prototype.forEach.call(root.querySelectorAll('form[data-form]'), function (form) {
    const s = byKey[keyOf(form)];
    if (!s) return;

    const els = form.querySelectorAll(FIELDS);
    if (els.length !== s.fields.length) return;   // the form changed shape; leave it

    Array.prototype.forEach.call(els, function (el, i) {
      const f = s.fields[i];
      if (f.name !== String(el.name || '')) return;   // not the field we think it is

      /*
       * A field carrying `data-input` writes to ui state on every keystroke, so the
       * render that just happened already shows the right value. Only the caret was
       * lost, and putting the captured text back would actively break things.
       *
       * The case that matters: clicking Reset sets `ui.projQuery = ''` and redraws.
       * The click did not change the box, so capture reads the OLD text out of it and
       * would restore it over the blank one - Reset would appear not to work.
       *
       * This rule assumes the handler runs synchronously before the render. If the
       * input is ever debounced, revisit it: the render would then be behind the DOM
       * and would need the captured value after all.
       */
      const stateBacked = !!(el.getAttribute && el.getAttribute('data-input'));

      if (f.type === 'checkbox' || f.type === 'radio') el.checked = f.checked;
      else if (!stateBacked) el.value = f.value;

      if (!f.focused || typeof el.focus !== 'function') return;

      el.focus();
      if (f.start == null || typeof el.setSelectionRange !== 'function') return;
      try {
        el.setSelectionRange(f.start, f.end);
      } catch (e) {
        /* Some input types refuse a selection. Having focus back is the important
           half; the caret landing at the end is survivable. */
      }
    });
  });
}
