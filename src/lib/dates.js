// @ts-check
/**
 * Date maths. Dates are plain 'YYYY-MM-DD' strings everywhere in this app, never
 * Date objects — that's what gets stored, compared and sorted.
 *
 * Because the format sorts correctly as text, most comparisons in the app are just
 * `a < b` on strings. That is deliberate and fine. These helpers exist for the cases
 * where you actually have to do arithmetic.
 *
 * Everything here works in LOCAL time on purpose. `new Date(y, m, d)` builds a local
 * midnight, so adding days never trips over a timezone or a daylight-saving change
 * the way UTC parsing of a bare date string does. Don't "fix" this by switching to
 * `new Date('2026-09-14')` — that parses as UTC and will shift the date by a day for
 * anyone west of Greenwich.
 *
 * Lifted verbatim from board.html:492-510.
 */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

/**
 * A Date object as a 'YYYY-MM-DD' string.
 * @param {Date} d
 * @returns {string}
 */
export function toStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * A 'YYYY-MM-DD' string as a Date at local midnight.
 * @param {string} s
 * @returns {Date}
 */
export function parseD(s) {
  const p = String(s).split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

/**
 * Today, as a date string.
 *
 * A function rather than a constant so tests don't have to wait for tomorrow. Note
 * that board.html read this ONCE at startup into a module-level `TODAY`
 * (board.html:510), so a board left open overnight still believed it was yesterday —
 * overdue actions wouldn't turn over at midnight. That's a real bug, but fixing it
 * means changing call sites, not this function, so it stays on the list rather than
 * being quietly fixed mid-port.
 *
 * @returns {string}
 */
export function today() {
  return toStr(new Date());
}

/**
 * n days after (or before, if negative) a date. Handles month and year ends.
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */
export function addDays(s, n) {
  const d = parseD(s);
  d.setDate(d.getDate() + n);
  return toStr(d);
}

/**
 * Whole days from `a` to `b`. Positive when b is later.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function diffDays(a, b) {
  return Math.round((Number(parseD(b)) - Number(parseD(a))) / 86400000);
}

/**
 * The next date on or after `s` that falls on weekday `wd` (Sunday = 0).
 *
 * If `s` is already that weekday you get `s` back, unchanged — "on or after", not
 * "strictly after". That's what makes a meeting show as today's meeting on the
 * morning it happens rather than jumping a week ahead.
 *
 * @param {string} s
 * @param {number} wd - 0 (Sunday) to 6 (Saturday)
 * @returns {string}
 */
export function nextOn(s, wd) {
  const d = parseD(s);
  d.setDate(d.getDate() + (((wd - d.getDay()) + 7) % 7));
  return toStr(d);
}

/* ---------- display formatting ---------- */

/** 'Sep 14' @param {string} s */
export function fmt(s) {
  const d = parseD(s);
  return MON[d.getMonth()] + ' ' + d.getDate();
}

/** 'Mon, Sep 14' @param {string} s */
export function fmtDay(s) {
  const d = parseD(s);
  return DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate();
}

/** 'Mon 9/14' @param {string} s */
export function fmtShort(s) {
  const d = parseD(s);
  return DOW[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
}

/** 'Mon, Sep 14, 2026' @param {string} s */
export function fmtLong(s) {
  return fmtDay(s) + ', ' + parseD(s).getFullYear();
}

/**
 * A date relative to another, in words: 'today', 'in 3 days', '2 weeks ago'.
 *
 * The original read a module-level TODAY; this takes the reference date as an
 * argument so it can be tested without waiting for tomorrow.
 *
 * @param {string} s - the date being described
 * @param {string} [from] - the reference date, defaulting to today
 * @returns {string}
 */
export function rel(s, from) {
  const n = diffDays(from || today(), s);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 0) return n < 14 ? 'in ' + n + ' days' : 'in ' + Math.round(n / 7) + ' weeks';
  return -n < 14 ? -n + ' days ago' : Math.round(-n / 7) + ' weeks ago';
}
