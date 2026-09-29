// @ts-check
/**
 * Light, dark, or whatever Windows is set to.
 *
 * The dark palette has always been in assets/theme.css; until now the only way to
 * get it was the operating system's setting. This lets each person choose.
 *
 * Kept in localStorage, not with the rest of the view state in sessionStorage:
 * a theme is a preference you set once, and sessionStorage forgets it with the tab.
 * It is per browser and never touches the shared board - one person's dark screen
 * must not become everybody's.
 *
 * The same key is read by a few lines in index.html's <head>, before the page
 * paints, so a dark-mode user does not see a white flash on every load. If the key
 * or the values change, change them there too.
 */

export const THEME_KEY = 'techops-board:theme';

/** [value, label] - 'auto' leaves the choice to the operating system. */
export const THEMES = [['auto', 'Match Windows'], ['light', 'Light'], ['dark', 'Dark']];

/**
 * A theme value, or 'auto' for anything unrecognised.
 * @param {any} v
 */
export function validTheme(v) {
  return THEMES.some(function (t) { return t[0] === v; }) ? String(v) : 'auto';
}

function store() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch (e) {
    return null;   // private windows and blocked site data throw on access
  }
}

/** The saved choice, or 'auto'. */
export function readTheme() {
  const s = store();
  try {
    return validTheme(s ? s.getItem(THEME_KEY) : null);
  } catch (e) {
    return 'auto';
  }
}

/**
 * Put a theme on an element - the <html> tag - the way theme.css expects: no
 * attribute for 'auto', so its prefers-color-scheme block decides.
 *
 * @param {any} el
 * @param {string} theme
 */
export function applyTheme(el, theme) {
  if (!el || typeof el.setAttribute !== 'function') return;
  const v = validTheme(theme);
  if (v === 'auto') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', v);
}

/**
 * Remember a choice and show it now. Quietly does only the parts it can: outside a
 * browser there is no document, and a blocked localStorage just means the choice
 * lasts until the page is closed.
 *
 * @param {string} theme
 */
export function setTheme(theme) {
  const v = validTheme(theme);
  const s = store();
  try {
    if (s) s.setItem(THEME_KEY, v);
  } catch (e) { /* see above */ }
  if (typeof document !== 'undefined') applyTheme(document.documentElement, v);
  return v;
}
