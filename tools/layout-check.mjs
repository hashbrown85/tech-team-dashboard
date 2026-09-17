// @ts-check
/**
 * Checks the markup against the stylesheet. Run by hand; prints and exits.
 *
 *     node tools/layout-check.mjs
 *     node tools/layout-check.mjs --counts    (report child counts, assert nothing)
 *
 * ## Why this is not in tests/all.test.js
 *
 * It reads `assets/theme.css` and `index.html` from disk, and that suite also runs in
 * a browser via `tests/tests.html` — so nothing it imports may touch `node:fs`.
 * Putting this in `tools/` makes that structural rather than a rule somebody has to
 * remember. `provision.mjs` set the same contract: a node script, run by hand, that
 * prints and changes nothing.
 *
 * ## What it is for
 *
 * Every defect in this project was found by a person using it, never by the suite.
 * The suite checks HTML-string shape and domain rules; it is blind to CSS. Five of
 * those defects were one class of mistake — markup that is valid but wrongly classed,
 * or the wrong number of children for a grid — and that class IS mechanically
 * checkable. This checks it.
 *
 * Four checks, each earning its place by having already shipped as a bug:
 *
 *   a. `overflow-wrap: anywhere` is gone and stays gone. It reduces min-content width
 *      to one character, so any track floored at zero can collapse onto it and render
 *      text one letter per line. That shipped; the fix was swept through the whole
 *      stylesheet, and this keeps it swept.
 *   b. Every class the views emit is defined SOMEWHERE. `.tgl`, `.sel`, `.block`,
 *      `.dtl` and `.done-row` all shipped as classes nothing styled.
 *   c. Grid containers have the number of children their layout assumes. `.mv` on a
 *      26px button, a fourth child in a three-column row: neither errors, neither
 *      looks wrong in the markup, both wreck the screen.
 *   d. The two hand-duplicated dark palettes still match.
 *
 * It renders through the real views, so what it inspects is what the browser gets.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { blankSnapshot } from '../src/adapters/DataStore.js';
import { bigBoard } from './bigboard.mjs';
import { loadUi } from '../src/ui.js';
import { today } from '../src/lib/dates.js';
import { STATUSES, SEVERITIES } from '../src/domain/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = function (p) { return readFileSync(join(ROOT, p), 'utf8'); };

const THEME = read('assets/theme.css');
const INDEX = read('index.html');
const STYLE_BLOCK = (/<style>([\s\S]*?)<\/style>/.exec(INDEX) || ['', ''])[1];

const failures = [];
const notes = [];
function fail(what, detail) { failures.push({ what: what, detail: detail }); }

/* ------------------------------------------------------------------ the CSS */

/** Every class name either stylesheet defines. */
function definedClasses() {
  const out = new Set();
  // Strip comments first, or a class name mentioned in prose counts as defined.
  const css = (THEME + '\n' + STYLE_BLOCK).replace(/\/\*[\s\S]*?\*\//g, '');
  let m;
  const re = /\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g;
  while ((m = re.exec(css))) out.add(m[1]);
  return out;
}

/* ----------------------------------------------------------- the HTML reader */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * Walk the tags of a generated HTML string.
 *
 * Only safe because the views GENERATE this: attributes are always double-quoted,
 * text is always escaped, and tests/views.test.js already asserts the tags balance.
 * It is not a parser and must not be pointed at arbitrary HTML.
 */
function* tags(html) {
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|[^>])*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const name = m[2].toLowerCase();
    const kind = m[1] ? 'close' : (m[4] || VOID.has(name)) ? 'void' : 'open';
    yield { kind: kind, name: name, attrs: m[3], at: m.index };
  }
}

/** Does this open tag carry `cls` in its class attribute? */
function hasClass(attrs, cls) {
  const m = /class="([^"]*)"/.exec(attrs);
  if (!m) return false;
  return m[1].split(/\s+/).indexOf(cls) >= 0;
}

/**
 * How many direct element children each element with this class has.
 *
 * @returns {number[]} one entry per occurrence
 */
function childCounts(html, cls) {
  const out = [];
  const all = Array.from(tags(html));

  all.forEach(function (t, i) {
    if (t.kind !== 'open' || !hasClass(t.attrs, cls)) return;

    let depth = 0;
    let n = 0;
    for (let j = i + 1; j < all.length; j++) {
      const k = all[j];
      if (k.kind === 'void') { if (depth === 0) n++; continue; }
      if (k.kind === 'open') { if (depth === 0) n++; depth++; continue; }
      if (depth === 0) break;          // the container's own closing tag
      depth--;
    }
    out.push(n);
  });

  return out;
}

/** Every class actually emitted, and whether any element got an empty one. */
function emittedClasses(html, into, empties) {
  let m;
  const re = /class="([^"]*)"/g;
  while ((m = re.exec(html))) {
    const raw = m[1];
    if (!raw.trim()) { empties.push(m[0]); continue; }
    raw.trim().split(/\s+/).forEach(function (c) { into.add(c); });
  }
}

/* --------------------------------------------------------------- the matrix */

const TODAY = today();
const LIVE = { content: 'live', settings: 'live' };
const base = loadUi();

/** A board carrying every status, severity and dueness state. */
function fullBoard() {
  const s = demoBoard();

  // The demo board has four of six statuses. Every `.proj.ps-*` and `.chip.ps-*`
  // variant needs to render or check (b) never sees it.
  STATUSES.concat(['new']).forEach(function (st, i) {
    if (s.projects[i]) s.projects[i].status = st;
  });

  SEVERITIES.forEach(function (sev, i) {
    if (s.issues[i]) s.issues[i].sev = sev;
  });
  if (s.issues[0]) { s.issues[0].status = 'resolved'; s.issues[0].autoResolved = true; }

  // Dueness: overdue, soon, none, done.
  if (s.actions[0]) s.actions[0].due = '2020-01-01';
  if (s.actions[1]) s.actions[1].due = TODAY;
  if (s.actions[2]) s.actions[2].due = '';
  if (s.actions[3]) { s.actions[3].status = 'done'; s.actions[3].doneOn = TODAY; }

  return s;
}

function refusedBoard() {
  const s = fullBoard();
  s.denied = ['projectDetails'];
  s.projectDetails = [];
  return s;
}

/** [label, uiOverrides, snapshot, modes, identity] */
function matrix() {
  const full = fullBoard();
  const out = [];

  const screens = [
    ['overview', { view: 'overview' }],
    ['wins', { view: 'tab', tab: 't1', steps: { t1: 0 } }],
    ['opportunities', { view: 'tab', tab: 't1', steps: { t1: 1 } }],
    ['opportunity form', { view: 'tab', tab: 't1', steps: { t1: 1 }, open: 'opp:p1' }],
    ['projects stage', { view: 'tab', tab: 't1', steps: { t1: 2 } }],
    ['projects stage, details open',
      { view: 'tab', tab: 't1', steps: { t1: 2 }, openDetails: { pr1: true } }],
    ['issues', { view: 'tab', tab: 't1', steps: { t1: 3 } }],
    ['rate', { view: 'tab', tab: 't1', steps: { t1: 4 } }],
    ['rate, summary shown', { view: 'tab', tab: 't1', steps: { t1: 4 }, sumShow: true }],
    ['techdir', { view: 'tab', tab: 'techdir', steps: { techdir: 1 } }],
    ['meeting settings', { view: 'tab', tab: 't1', settings: true }],
    ['register', { view: 'actions' }],
    ['register, overdue', { view: 'actions', filter: 'over' }],
    ['register, follow-up', { view: 'actions', follow: true }],
    ['timeline', { view: 'timeline' }],
    ['timeline by person', { view: 'timeline', tlGroup: 'person' }],
    ['people & settings', { view: 'people' }],
    ['people, renaming', { view: 'people', open: 'listval:field:Coatings' }],
    ['project page', { view: 'project', project: 'pr1' }],
    ['project page, note editor', { view: 'project', project: 'pr2', open: 'note:n1' }],
    ['projects list', { view: 'projects' }],
    ['projects list, searched', { view: 'projects', projQuery: 'coat' }],
    ['projects list, sorted', { view: 'projects', projSort: 'value', projSortDir: 'desc' }],
    ['projects list, all', { view: 'projects', projStatus: 'all' }]
  ];

  screens.forEach(function (s) {
    out.push([s[0], s[1], full, LIVE, { personId: 'p1', displayName: 'Alex Morgan' }]);
  });

  // The modes the suite has never rendered.
  out.push(['read-only content', { view: 'tab', tab: 't1', steps: { t1: 2 } }, full,
    { content: 'readonly', settings: 'live' }, { personId: 'p1' }]);
  out.push(['read-only settings', { view: 'people' }, full,
    { content: 'live', settings: 'readonly' }, { personId: 'p1' }]);
  out.push(['project value refused', { view: 'project', project: 'pr1' }, refusedBoard(),
    LIVE, { personId: 'p1' }]);
  out.push(['projects list, value refused', { view: 'projects' }, refusedBoard(),
    LIVE, { personId: 'p1' }]);

  // Identities that style themselves differently.
  out.push(['off the roster', { view: 'overview' }, full, LIVE,
    { kind: 'unknown-user', displayName: 'Someone Else', person: null, personId: null }]);
  out.push(['demo identity', { view: 'overview' }, full, LIVE,
    { kind: 'demo', displayName: 'Alex Morgan', personId: 'p1' }]);

  // An empty board still has to render.
  out.push(['empty board', { view: 'overview' }, blankSnapshot(), LIVE, { personId: null }]);

  /*
   * And the big board, on the screens where volume and long values actually bite.
   * The small demo board is too tidy to collapse anything: every layout bug found
   * so far needed either a long unbroken token or a lot of rows, and it has neither.
   */
  const big = bigBoard();
  [
    ['big: overview', { view: 'overview' }],
    ['big: projects stage', { view: 'tab', tab: 'bt0', steps: { bt0: 2 } }],
    ['big: issues', { view: 'tab', tab: 'bt0', steps: { bt0: 3 } }],
    ['big: rate', { view: 'tab', tab: 'bt0', steps: { bt0: 4 } }],
    ['big: register', { view: 'actions' }],
    ['big: timeline', { view: 'timeline' }],
    ['big: projects list', { view: 'projects', projStatus: 'all' }],
    ['big: project page', { view: 'project', project: 'bhz2' }],
    ['big: people & settings', { view: 'people' }],
    ['big: empty meeting', { view: 'tab', tab: 'techdir', steps: { techdir: 2 } }]
  ].forEach(function (s) {
    out.push([s[0], s[1], big, LIVE, { personId: 'bp0', displayName: 'Kappa Feldspar' }]);
  });

  return out;
}

/* ---------------------------------------------------------------- the checks */

/**
 * How many children each grid container is allowed.
 *
 * Hand-written, deliberately. Deriving them from the winning
 * `grid-template-columns` needs specificity, `!important`, source order across two
 * files and media queries — a CSS engine — and it would not have caught any of the
 * bugs that shipped, because in every one of them the CSS was right and the MARKUP
 * was wrong. These move the contract out of a prose comment and into something that
 * fails loudly.
 *
 * Several classes legitimately have more than one shape; the allowed set says so out
 * loud, so a NEW shape is a decision somebody makes rather than something that drifts
 * in.
 */
const GRID_CHILDREN = [
  ['kpis', [4], 'repeat(4, minmax(0,1fr)) — a fifth wraps and leaves three empty cells'],
  ['rp', [2], '170px + minmax(0,1fr): exactly .rp-h then .rp-b'],
  ['steps', [5], 'repeat(5,...) — one per agenda segment'],
  ['proj', [4], 'name, tools, status, details — see meeting.js projectRow'],

  /*
   * Reported, not asserted. These three legitimately vary with their content, and
   * pinning a set today would mostly record what the demo board happens to contain.
   * Their numbers are printed on every run so a change is visible, and two of them
   * are worth a human look during the rehearsal:
   *
   *   .arow  3, 4, 7 — the register emits seven into a four-column grid on purpose
   *                    and lets them wrap; the project page emits four.
   *   .is-h  3       — but the CSS declares FOUR columns (auto auto minmax(0,1fr)
   *                    auto) and its mobile rules style `.is-h .it-t`, which is
   *                    never emitted inside .is-h: the title lives in a sibling
   *                    .is-body. So the toolbar sits in the flexible column rather
   *                    than being pushed right, and two rules target nothing.
   *   .item  2, 3    — children are conditional (why, change, delete).
   */
  ['arow', null, 'four-column grid; the register emits more and lets them wrap'],
  ['is-h', null, 'declares four columns; emits three children — see above'],
  ['item', null, 'auto minmax(0,1fr) auto, with conditional children']
];

function checkStylesheets() {
  // (a) the foot-gun, swept and staying swept
  const stray = [];
  [['assets/theme.css', THEME], ['index.html', STYLE_BLOCK]].forEach(function (pair) {
    pair[1].replace(/\/\*[\s\S]*?\*\//g, '').split('\n').forEach(function (line, i) {
      if (/overflow-wrap\s*:\s*anywhere/.test(line)) {
        stray.push(pair[0] + ' line ' + (i + 1) + ': ' + line.trim().slice(0, 80));
      }
    });
  });
  if (stray.length) {
    fail('overflow-wrap: anywhere is back',
      stray.join('\n    ') +
      '\n    It reduces min-content width to one character, so any track floored at' +
      '\n    zero can collapse and render the text one letter per line. Use' +
      '\n    break-word: it still breaks an unbreakable string without moving' +
      '\n    min-content.');
  } else {
    notes.push('overflow-wrap: anywhere — none, as intended');
  }

  // (d) the two hand-duplicated dark palettes
  const dark = THEME.match(/@media \(prefers-color-scheme: ?dark\)\{([\s\S]*?)\n\}/);
  const attr = THEME.match(/:root\[data-theme="dark"\]\{([\s\S]*?)\}/);
  if (!dark || !attr) {
    fail('cannot find both dark palettes', 'the media-query block and the [data-theme] block');
  } else {
    // Last declaration wins, as CSS does. But a property declared twice in one
    // block is dead code, and it also HIDES drift: put a wrong value above the
    // right one and a naive comparison only ever sees the right one.
    const dupes = [];
    const vars = function (s, where) {
      const out = {};
      let m;
      const re = /(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi;
      while ((m = re.exec(s))) {
        if (out[m[1]] !== undefined) dupes.push(where + ' declares ' + m[1] + ' twice');
        out[m[1]] = m[2].trim();
      }
      return out;
    };
    const a = vars(dark[1], 'the @media block');
    const b = vars(attr[1], 'the [data-theme] block');
    const drift = Object.keys(a)
      .filter(function (k) { return b[k] !== undefined && b[k] !== a[k]; })
      .map(function (k) { return k + ': ' + a[k] + '  vs  ' + b[k]; });
    const missing = Object.keys(a).filter(function (k) { return b[k] === undefined; });

    if (drift.length || missing.length || dupes.length) {
      fail('the two dark palettes have drifted',
        drift
          .concat(missing.map(function (k) { return k + ' is missing from one block'; }))
          .concat(dupes)
          .join('\n    ') +
        '\n    They are duplicated by hand because one is inside @media and the other' +
        '\n    is not, so they cannot be one selector list. Keep them identical.');
    } else {
      notes.push('dark palettes — ' + Object.keys(a).length + ' properties, identical');
    }
  }
}

function main() {
  const reportOnly = process.argv.indexOf('--counts') >= 0;
  const defined = definedClasses();
  const emitted = new Set();
  const empties = [];
  const observed = {};
  GRID_CHILDREN.forEach(function (g) { observed[g[0]] = new Set(); });

  const states = matrix();
  const statuses = new Set();
  const severities = new Set();
  const modes = new Set();

  states.forEach(function (st) {
    const label = st[0];
    let html;
    try {
      html = renderApp(st[2], Object.assign({}, base, st[1]), {
        today: TODAY, modes: st[3], identity: st[4]
      });
    } catch (e) {
      fail('a screen threw while rendering', label + ': ' + e.message);
      return;
    }

    emittedClasses(html, emitted, empties);
    modes.add(st[3].content + '/' + st[3].settings);

    let m;
    const ps = /class="[^"]*\bps-([a-z]+)\b/g;
    while ((m = ps.exec(html))) statuses.add(m[1]);
    SEVERITIES.forEach(function (sv) {
      if (html.indexOf('class="chip ' + sv + '"') >= 0) severities.add(sv);
    });

    GRID_CHILDREN.forEach(function (g) {
      childCounts(html, g[0]).forEach(function (n) { observed[g[0]].add(n); });
    });
  });

  /* --- (b) emitted but styled nowhere --- */
  const undefinedClasses = Array.from(emitted)
    .filter(function (c) { return !defined.has(c); })
    .sort();

  if (undefinedClasses.length) {
    fail('classes emitted but styled nowhere',
      undefinedClasses.join(', ') +
      '\n    Checked against assets/theme.css AND the <style> block in index.html.' +
      '\n    A class nothing styles renders as an unstyled element, which is how' +
      '\n    .tgl, .sel, .block, .dtl and .done-row all shipped.');
  } else {
    notes.push('emitted classes — all ' + emitted.size + ' are defined');
  }

  if (empties.length) {
    fail('an element got an empty class attribute',
      empties.length + ' occurrence(s), e.g. ' + empties[0] +
      '\n    Always a conditional that lost. Emit no class attribute instead.');
  }

  /* --- (c) grid child counts --- */
  GRID_CHILDREN.forEach(function (g) {
    const cls = g[0];
    const allowed = g[1];
    const seen = Array.from(observed[cls]).sort(function (a, b) { return a - b; });

    if (!seen.length) {
      fail('never rendered, so its contract is unchecked', '.' + cls +
        '\n    The matrix does not reach it. Add a state that does, or remove it.');
      return;
    }
    if (!allowed) return;               // reported, not asserted

    const bad = seen.filter(function (n) { return allowed.indexOf(n) < 0; });
    if (bad.length) {
      fail('.' + cls + ' has the wrong number of children',
        'saw ' + seen.join(', ') + '; allowed ' + allowed.join(', ') +
        '\n    ' + g[2] +
        '\n    A wrong count does not error and does not look wrong in the markup:' +
        '\n    it silently wraps onto another line.');
    }
  });

  /* --- coverage, printed so a shrinking matrix is visible --- */
  console.log('Rendered ' + states.length + ' states.');
  console.log('  distinct classes seen : ' + emitted.size);
  console.log('  statuses rendered     : ' + Array.from(statuses).sort().join(' ') +
    '  (' + statuses.size + '/6)');
  console.log('  severities rendered   : ' + Array.from(severities).sort().join(' ') +
    '  (' + severities.size + '/' + SEVERITIES.length + ')');
  console.log('  modes rendered        : ' + Array.from(modes).sort().join('  '));
  console.log('  grid children seen    :');
  GRID_CHILDREN.forEach(function (g) {
    const seen = Array.from(observed[g[0]]).sort(function (a, b) { return a - b; });
    console.log('      .' + g[0].padEnd(8) + seen.join(', ') +
      (g[1] ? '   (allowed ' + g[1].join(', ') + ')' : '   (reported only)'));
  });

  if (statuses.size < 6) {
    fail('not every project status was rendered',
      'saw ' + Array.from(statuses).sort().join(' ') +
      '\n    A ps-* variant nobody renders is a variant nobody checks.');
  }
  if (severities.size < SEVERITIES.length) {
    fail('not every severity was rendered', 'saw ' + Array.from(severities).sort().join(' '));
  }

  checkStylesheets();

  console.log('');
  notes.forEach(function (n) { console.log('  ok  ' + n); });

  if (reportOnly) {
    console.log('\n--counts: reporting only, nothing asserted.');
    return;
  }

  if (!failures.length) {
    console.log('\nAll layout checks passed.');
    return;
  }

  console.log('');
  failures.forEach(function (f) {
    console.log('FAIL: ' + f.what + '\n    ' + f.detail + '\n');
  });
  console.log(failures.length + ' failure(s).');
  process.exitCode = 1;
}

main();
