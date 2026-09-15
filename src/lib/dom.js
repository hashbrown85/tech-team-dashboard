// @ts-check
/**
 * The small amount of browser this app actually needs.
 *
 * Kept in one place so every other file can stay testable. `esc` is pure and gets
 * used by every view; the rest touch the page and are no-ops when there isn't one,
 * so importing this in Node is safe.
 *
 * From board.html:528, 600, 627, 664-676, 1290-1294.
 */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape text for putting inside HTML.
 *
 * The views build markup by joining strings, so EVERY piece of board content has to
 * come through here. A project name with an ampersand in it would otherwise break the
 * page, and one with a script tag in it would be worse.
 *
 * @param {any} s
 * @returns {string}
 */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ENTITIES[c]; });
}

/**
 * Seconds as m:ss, for the agenda clock.
 * @param {number} sec
 */
export function clock(sec) {
  const n = Math.max(0, Math.round(sec));
  const s = n % 60;
  return Math.floor(n / 60) + ':' + (s < 10 ? '0' : '') + s;
}

/**
 * Minutes in words, for the segment budgets: '45s', '2 min', '7.5 min'.
 * @param {number} m
 */
export function minutes(m) {
  if (m < 1) return Math.round(m * 60) + 's';
  const r = Math.round(m * 2) / 2;
  return (r % 1 ? r.toFixed(1) : String(r)) + ' min';
}

/* ---------- things that touch the page ---------- */

function doc() {
  return typeof document === 'undefined' ? null : document;
}

/** Respect a reduced-motion preference. */
export function scrollBehavior() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'auto';
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/**
 * Scroll something into view and flash it, for "here is the thing you clicked
 * through to". board.html:627.
 * @param {Element | null} el
 */
export function flash(el) {
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: /** @type {any} */ (scrollBehavior()) });
  el.classList.remove('flash');
  void /** @type {HTMLElement} */ (el).offsetWidth; // force the animation to restart
  el.classList.add('flash');
}

/**
 * Focus the first text field of a freshly opened form. board.html:1290-1294.
 * @param {Element | null} [root]
 */
export function focusFirst(root) {
  const d = doc();
  if (!d) return;
  const scope = root || d.getElementById('root');
  if (!scope) return;
  const el = scope.querySelector('form input[type="text"], form textarea, form select');
  if (el) /** @type {HTMLElement} */ (el).focus();
}

let toastTimer = null;

/**
 * Tell the user something, briefly.
 *
 * An undoable message stays up longer, because reading it and deciding to undo takes
 * longer than reading it. board.html:664-676.
 *
 * @param {string} message
 * @param {object} [options]
 * @param {() => void} [options.onUndo] - show an Undo button that calls this
 */
export function toast(message, options) {
  const d = doc();
  if (!d) return;

  let el = d.getElementById('toast');
  if (!el) {
    el = d.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    d.body.appendChild(el);
  }

  const undoable = !!(options && options.onUndo);
  el.innerHTML = esc(message) + (undoable ? ' <button type="button" data-toast-undo>Undo</button>' : '');
  el.classList.add('show');

  if (undoable) {
    const btn = el.querySelector('[data-toast-undo]');
    if (btn) {
      btn.addEventListener('click', function () {
        hideToast();
        if (options && options.onUndo) options.onUndo();
      });
    }
  }

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undoable ? 7000 : 4200);
}

export function hideToast() {
  const d = doc();
  const el = d && d.getElementById('toast');
  if (el) el.classList.remove('show');
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}
