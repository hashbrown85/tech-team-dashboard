// @ts-check
/**
 * Tiny list helpers. Nothing here knows anything about the board.
 *
 * From board.html:529-530 and the byName comparator used by the name dropdowns.
 */

/**
 * Find a record by id, or null.
 *
 * Returns null rather than undefined because every caller in the original checked
 * truthiness, and null is the clearer "looked and found nothing".
 *
 * @template {{id?: string}} T
 * @param {T[]} arr
 * @param {string} [id]
 * @returns {T | null}
 */
export function byId(arr, id) {
  for (let i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
  return null;
}

/**
 * Sort comparator for anything with a `name`, case-insensitive.
 * @param {{name?: string}} a
 * @param {{name?: string}} b
 */
export function byName(a, b) {
  const x = String(a.name || '').toLowerCase();
  const y = String(b.name || '').toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * A short random id, the same shape the app has always generated.
 *
 * Not cryptographically random and doesn't need to be — it just has to not collide
 * within one board. board.html:529.
 *
 * @returns {string}
 */
export function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
