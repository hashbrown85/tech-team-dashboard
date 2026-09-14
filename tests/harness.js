// @ts-check
/**
 * A very small test runner. No npm, no framework.
 *
 * It collects results as tests run and paints them into the page, so you can see
 * what passed by looking at it. Failures say what was expected and what happened,
 * because a test that just says "FAIL" wastes your time.
 */

/** @type {{name: string, group: string, ok: boolean, detail: string}[]} */
const results = [];
let currentGroup = 'ungrouped';

/** Start a named group of tests. Purely for readable output. */
export function group(name) {
  currentGroup = name;
}

/**
 * Define and immediately run one test.
 * @param {string} name - what this test proves, in plain language
 * @param {() => void} fn - throws on failure (use the check helpers below)
 */
export function test(name, fn) {
  try {
    fn();
    results.push({ name, group: currentGroup, ok: true, detail: '' });
  } catch (err) {
    results.push({
      name,
      group: currentGroup,
      ok: false,
      detail: err && err.message ? err.message : String(err)
    });
  }
}

/** Fail unless `actual` deep-equals `expected`. */
export function eq(actual, expected, because) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(
      (because ? because + '\n    ' : '') + 'expected ' + e + '\n    but got  ' + a
    );
  }
}

/** Fail unless `value` is truthy. */
export function ok(value, because) {
  if (!value) throw new Error(because || 'expected a truthy value, got ' + JSON.stringify(value));
}

/** Fail if `value` is truthy. */
export function notOk(value, because) {
  if (value) throw new Error(because || 'expected a falsy value, got ' + JSON.stringify(value));
}

/**
 * Write every result into the page and log a one-line summary.
 * @param {HTMLElement | null} into
 */
export function report(into) {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  if (into) {
    const groups = [...new Set(results.map((r) => r.group))];
    into.innerHTML =
      '<p class="total ' + (failed ? 'bad' : 'good') + '">' +
      passed + ' passed' + (failed ? ', <strong>' + failed + ' failed</strong>' : '') +
      '</p>' +
      groups
        .map(function (g) {
          const rows = results
            .filter((r) => r.group === g)
            .map(function (r) {
              return (
                '<li class="' + (r.ok ? 'pass' : 'fail') + '">' +
                '<span class="mark">' + (r.ok ? 'PASS' : 'FAIL') + '</span> ' +
                escapeHtml(r.name) +
                (r.detail ? '<pre>' + escapeHtml(r.detail) + '</pre>' : '') +
                '</li>'
              );
            })
            .join('');
          return '<h2>' + escapeHtml(g) + '</h2><ul>' + rows + '</ul>';
        })
        .join('');
  }

  // Also print it, so running this in a headless browser or CI is useful later.
  results.filter((r) => !r.ok).forEach((r) => console.error('FAIL: ' + r.name + '\n  ' + r.detail));
  console.log(passed + ' passed, ' + failed + ' failed');
  return { passed, failed };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
