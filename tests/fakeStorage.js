// @ts-check
/**
 * A stand-in for `window.localStorage`, so storage-backed code can be tested in
 * Node — and, more usefully, so a storage that FAILS can be tested at all.
 *
 * A real localStorage cannot be made to throw on demand, which would leave the one
 * behaviour that matters most untested: a save that fails has to reject the write
 * rather than swallow it, or somebody types a whole meeting into a board that is
 * keeping none of it.
 *
 * @param {object} [opts]
 * @param {(key: string, value: string) => (Error | null)} [opts.failWrite]
 */
export function fakeStorage(opts) {
  const o = opts || {};
  /** @type {Record<string, string>} */
  const cells = {};

  return /** @type {any} */ ({
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(cells, k) ? cells[k] : null;
    },
    setItem: function (k, v) {
      if (o.failWrite) {
        const err = o.failWrite(k, String(v));
        if (err) throw err;
      }
      cells[k] = String(v);
    },
    removeItem: function (k) { delete cells[k]; },
    clear: function () { Object.keys(cells).forEach(function (k) { delete cells[k]; }); },
    get length() { return Object.keys(cells).length; },
    key: function (i) { return Object.keys(cells)[i] || null; },

    /** Everything held, for assertions. */
    _all: function () { return Object.assign({}, cells); }
  });
}
