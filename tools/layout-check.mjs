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
 * Six checks, each earning its place by having already shipped as a bug:
 *
 *   a. `overflow-wrap: anywhere` is gone and stays gone. It reduces min-content width
 *      to one character, so any track floored at zero can collapse onto it. NOTE:
 *      removing it was NOT sufficient - see (e), which is the actual mechanism.
 *   b. Every class the views emit is defined SOMEWHERE. `.tgl`, `.sel`, `.block`,
 *      `.dtl` and `.done-row` all shipped as classes nothing styled.
 *   c. Grid containers have the number of children their layout assumes. `.mv` on a
 *      26px button, a fourth child in a three-column row: neither errors, neither
 *      looks wrong in the markup, both wreck the screen.
 *   d. The two hand-duplicated dark palettes still match.
 *   e. A wrapping-text child never shares its grid row with an uncapped `auto`
 *      sibling. See PLACEMENT.
 *   f. Free text that arrives as one long unbroken token lands somewhere that can
 *      break it. The customer name on a project tile could not, so it overflowed
 *      its column and overlapped the tools beside it.
 *
 * It renders through the real views, so what it inspects is what the browser gets.
 *
 * ## The limit worth knowing
 *
 * Coverage equals the matrix. Twice now a check has passed because the matrix never
 * reached the shape that breaks: `.item` reported `2, 3` for a whole change set while
 * Wins & Losses and New Opportunities rendered EMPTY, because the demo entries are
 * dated and the meeting a tab is viewed at moves with the calendar. A green run means
 * "nothing wrong in what was rendered", so when a bug is reported anyway, suspect
 * `matrix()` and `fullBoard()` before trusting the result.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderApp } from '../src/views/render.js';
import { demoBoard } from '../src/demo-data.js';
import { meetingDate } from '../src/domain/meetings.js';
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
function childShapes(html, cls) {
  const out = [];
  const all = Array.from(tags(html));

  all.forEach(function (t, i) {
    if (t.kind !== 'open' || !hasClass(t.attrs, cls)) return;

    let depth = 0;
    const kids = [];
    for (let j = i + 1; j < all.length; j++) {
      const k = all[j];
      if (k.kind === 'void') { if (depth === 0) kids.push(classesOf(k.attrs)); continue; }
      if (k.kind === 'open') { if (depth === 0) kids.push(classesOf(k.attrs)); depth++; continue; }
      if (depth === 0) break;          // the container's own closing tag
      depth--;
    }
    out.push(kids);
  });

  return out;
}

/** The class tokens on one tag, as an array. */
function classesOf(attrs) {
  const m = /class="([^"]*)"/.exec(attrs || '');
  if (!m || !m[1].trim()) return [];
  return m[1].trim().split(/\s+/);
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

  /*
   * Wins & Losses and New Opportunities rendered EMPTY on every run until now.
   * The demo board's entries are dated 2026-09-14, the meeting a tab is viewed at
   * is derived from today's date, and the two drift apart the moment the calendar
   * moves - so `renderMeeting` filtered every entry out and the tool reported
   * `.item 2, 3` from the rail and the business review alone. I read that as
   * reassurance. It was the hole the vertical-text bug lived in.
   *
   * Stamp them onto the date each tab is actually viewed at, so the stage renders
   * what a person sees, and cover the conditional children: `.item` emits two to
   * five and only the four- and five-child shapes collapse.
   */
  s.tabs.forEach(function (t) {
    const d = meetingDate(t, TODAY, null);
    const mine = s.entries.filter(function (e) { return e.tab === t.id; });
    mine.forEach(function (e, i) {
      e.meeting = d;
      if (e.kind === 'win' || e.kind === 'loss') {
        e.why = 'Why it went the way it did';
        if (i % 2) e.change = 'What we will do differently next time';
      }
      if (e.kind === 'opp') e.why = 'The challenge we still have to clear';
    });
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
    // bhz1 carries the planted hazards: a 73-character product code as its name and
    // a 62-character customer. bhz2 is long but breakable, so on its own it leaves
    // check (f) with nothing to find on this screen.
    ['big: project page, hazards', { view: 'project', project: 'bhz1' }],
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
   * These three vary with their content, which is why they were reported and not
   * asserted. That was a mistake: it is exactly how the vertical-text bug reached
   * a user twice. A varying count is still a KNOWN SET, and a number outside it
   * means somebody added a child without looking at the grid.
   *
   *   .arow  3, 4, 7 — the register emits seven into a four-column grid on purpose
   *                    and lets them wrap; the rail emits three, the project page
   *                    and the already-owed block four.
   *   .is-h  3       — but the CSS declares FOUR columns (auto auto minmax(0,1fr)
   *                    auto) and its mobile rules style `.is-h .it-t`, which is
   *                    never emitted inside .is-h: the title lives in a sibling
   *                    .is-body. So the toolbar sits in the flexible column rather
   *                    than being pushed right, and two rules target nothing.
   *   .item  2..5    — chip and title always; why, the conclusion and the delete
   *                    button conditionally.
   *
   * The count alone is NOT sufficient - the rail collapsed at three children in a
   * four-column grid. See PLACEMENT below for the check that catches that.
   */
  ['arow', [3, 4, 7], 'four-column grid; the register emits more and lets them wrap'],
  ['is-h', [3], 'declares four columns; emits three children — see above'],
  ['item', [2, 3, 4, 5], 'auto minmax(0,1fr) auto, with conditional children']
];


/*
 * (e) THE RULE, checked.
 *
 * A wrapping-text child in a zero-floored track - minmax(0,1fr) - collapses when
 * it shares its row with an UNCAPPED `auto` sibling, because grid grows auto
 * tracks to max-content before flexible tracks get anything at all. Squeezed far
 * enough, overflow-wrap breaks inside a word: one letter per line.
 *
 * Counting children does not catch this. The meeting rail collapsed at three
 * children in a four-column grid, which is a perfectly legal count. What matters
 * is what lands in the text child's ROW, so that is what this simulates.
 *
 * Hand-written, like GRID_CHILDREN, and for the same reason: in every one of
 * these bugs the CSS was right and the markup was wrong, so deriving the
 * expectation from the CSS would have caught none of them. Every `placed` and
 * `capped` claim below is verified against the stylesheet, so this table cannot
 * quietly outlive the rule it describes.
 *
 *   placed:N  pinned to column N by a grid-column rule
 *   capped    carries a max-width, which clamps the auto track's growth limit
 *   safe      short and non-wrapping: a chip, an id, a button, a fixed control
 *   text      the victim - the wrapping text in the zero-floored track
 */
const PLACEMENT = [
  {
    grid: 'item', cols: 3,
    kids: {
      chip:   'safe',
      'it-t': 'text placed:2',
      why:    'placed:2',
      'it-c': 'placed:2',
      x:      'placed:3'
    }
  },
  {
    grid: 'arow', cols: 4,
    kids: {
      ax:      'safe',
      aid:     'safe',
      atext:   'text placed:2',
      ameta:   'placed:2',
      own:     'capped',
      m:       'capped',
      adue:    'safe',
      fld:     'safe',
      x:       'safe'
    }
  }
];

/**
 * CSS rules as {selectors, body}. Innermost-first, so a rule inside @media is
 * found and its prelude ignored - deliberately over-permissive, because this
 * only ever asks "does a rule claiming this exist", never "does it win".
 */
function cssRules(text) {
  const out = [];
  let m;
  // Comments first, or the prose above a rule becomes part of its selector - and
  // a comma in that prose splits into fragments that match nothing. That failure
  // reads exactly like a missing rule, which cost a round trip to work out.
  const src = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  while ((m = re.exec(src))) {
    const sel = m[1].trim();
    if (sel.charAt(0) === '@') continue;
    out.push({ selectors: sel.split(',').map(function (x) { return x.trim(); }), body: m[2] });
  }
  return out;
}

/** Does the stylesheet pin `.grid > .cls` to a column, or cap its width? */
function claimIsReal(rules, grid, cls, want) {
  const re = new RegExp('\\.' + grid + '\\b[^,]*\\.' + cls + '\\b\\s*$');
  return rules.some(function (r) {
    if (!r.selectors.some(function (sel) { return re.test(sel); })) return false;
    return want.test(r.body);
  });
}

/**
 * Auto-placement for 1x1 items, per CSS Grid 8.5. Two passes: items locked to a
 * column, then everything else, both sparse. Returns a row number per child.
 */
function placeRows(kinds, cols) {
  const taken = {};
  const rows = new Array(kinds.length);
  const free = function (r, c) { return !taken[r + ':' + c]; };
  const take = function (r, c) { taken[r + ':' + c] = true; };

  let cr = 1, cc = 1;
  kinds.forEach(function (k, i) {
    if (k.col === null) return;
    if (k.col < cc) cr++;
    cc = k.col;
    while (!free(cr, cc)) cr++;
    take(cr, cc);
    rows[i] = cr;
  });

  cr = 1; cc = 1;
  kinds.forEach(function (k, i) {
    if (k.col !== null) return;
    while (!free(cr, cc)) {
      cc++;
      if (cc > cols) { cc = 1; cr++; }
    }
    take(cr, cc);
    rows[i] = cr;
  });

  return rows;
}

/*
 * (f) Free text that arrives as one long unbroken token must land somewhere that
 * can break it.
 *
 * This is the other half of the vertical-text family, and it shipped too: the
 * customer name on a project tile had no break rule at all, so it could not wrap,
 * overflowed column 1 and overlapped the tools. A track floor guarantees the
 * COLUMN is wide enough. It never guarantees the CONTENT fits in it.
 *
 * No hand-written list here - tools/bigboard.mjs already plants the hazards (a
 * 73-character product code, a 62-character customer), so the check finds where
 * they actually land. A new field carrying user text is covered the day someone
 * puts a planted value in it.
 *
 * `overflow-wrap` inherits, so an ancestor may provide the protection - which is
 * why this matches selectors against the whole element chain rather than against
 * a class name. Matching on the class alone reported the Projects table as safe
 * because `.att-list .t` exists and the table cells are `table.t`. Two unrelated
 * rules, one class name, and a green check over a real defect.
 */
const BREAKS = /(overflow-wrap|word-break)\s*:\s*(break-word|anywhere|break-all)/;

/** The shortest token worth worrying about. Real words do not reach this. */
const LONG_TOKEN = 35;

/** A compound like `table.t` or `.ph` -> {tag, classes}. Pseudos and attrs dropped. */
function compound(part) {
  const bare = part.replace(/::?[a-z-]+(\([^)]*\))?/g, '').replace(/\[[^\]]*\]/g, '');
  const classes = (bare.match(/\.[-\w]+/g) || []).map(function (c) { return c.slice(1); });
  const tag = /^[a-zA-Z][-\w]*/.exec(bare);
  return { tag: tag ? tag[0].toLowerCase() : null, classes: classes };
}

function compoundMatches(c, node) {
  if (c.tag && c.tag !== '*' && c.tag !== node.tag) return false;
  return c.classes.every(function (cl) { return node.classes.indexOf(cl) >= 0; });
}

/**
 * Does `selector` match the last node of `chain`? Right-to-left, with descendant
 * combinators allowed to skip and `>` required to be adjacent.
 */
function selectorMatches(selector, chain) {
  const parts = selector.trim().split(/\s*(>)\s*|\s+/).filter(Boolean);
  if (!parts.length) return false;

  let ci = chain.length - 1;
  let pi = parts.length - 1;
  if (!compoundMatches(compound(parts[pi]), chain[ci])) return false;
  pi--; ci--;

  while (pi >= 0) {
    const child = parts[pi] === '>';
    if (child) pi--;
    if (pi < 0) return false;
    const c = compound(parts[pi]);

    if (child) {
      if (ci < 0 || !compoundMatches(c, chain[ci])) return false;
      ci--;
    } else {
      while (ci >= 0 && !compoundMatches(c, chain[ci])) ci--;
      if (ci < 0) return false;
      ci--;
    }
    pi--;
  }
  return true;
}

/** Can this element, or anything it inherits from, break inside a word? */
function chainCanBreak(rules, chain) {
  for (let i = chain.length - 1; i >= 0; i--) {
    const sub = chain.slice(0, i + 1);
    const hit = rules.some(function (r) {
      if (!BREAKS.test(r.body)) return false;
      return r.selectors.some(function (sel) { return selectorMatches(sel, sub); });
    });
    if (hit) return true;
  }
  return false;
}

const VOID_TAG = /^(br|img|input|hr|meta|link|source|col|area|base|wbr)$/;

/** Long unbreakable tokens in rendered text, each with the element chain it sits in. */
function longTokens(html) {
  const out = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|[^>])*?)(\/?)>/g;
  const stack = [];
  let last = 0, m;

  while ((m = re.exec(html))) {
    const text = html.slice(last, m.index);
    last = re.lastIndex;

    if (text.trim() && stack.length) {
      // Split on every break opportunity a browser would take on its own.
      text.split(/[\s\u00b7]+/).forEach(function (tok) {
        const clean = tok.replace(/&[a-z]+;|&#\d+;/g, '');
        clean.split(/[-\u2013\u2014/\\]/).forEach(function (piece) {
          if (piece.length >= LONG_TOKEN) {
            out.push({ token: piece, chain: stack.slice() });
          }
        });
      });
    }

    const tag = m[2].toLowerCase();
    if (m[1]) { stack.pop(); continue; }
    if (m[4] || VOID_TAG.test(tag)) continue;
    const cm = /class="([^"]*)"/.exec(m[3]);
    stack.push({ tag: tag, classes: cm && cm[1].trim() ? cm[1].trim().split(/\s+/) : [] });
  }

  return out;
}

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
  const shapes = {};
  const unbreakable = new Map();
  GRID_CHILDREN.forEach(function (g) { observed[g[0]] = new Set(); });
  PLACEMENT.forEach(function (p) { shapes[p.grid] = new Map(); });

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
      childShapes(html, g[0]).forEach(function (kids) { observed[g[0]].add(kids.length); });
    });

    longTokens(html).forEach(function (t) {
      const sig = t.chain.map(function (n) {
        return n.tag + (n.classes.length ? '.' + n.classes.join('.') : '');
      }).join(' > ');
      if (!unbreakable.has(sig)) {
        unbreakable.set(sig, { token: t.token, chain: t.chain, where: label });
      }
    });

    // Distinct shapes only - the big board alone has hundreds of identical rows.
    PLACEMENT.forEach(function (p) {
      childShapes(html, p.grid).forEach(function (kids) {
        const sig = kids.map(function (c) { return c.join('.'); }).join(' | ');
        if (!shapes[p.grid].has(sig)) shapes[p.grid].set(sig, { kids: kids, where: label });
      });
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

  /* --- (e) the text child must not share its row with an uncapped sibling --- */
  const rules = cssRules(THEME + '\n' + STYLE_BLOCK);

  PLACEMENT.forEach(function (p) {
    if (!shapes[p.grid].size) {
      fail('.' + p.grid + ' is never rendered, so its placement is unchecked',
        'Add a state to the matrix that reaches it.');
      return;
    }

    // The table must not describe protection the stylesheet no longer provides.
    Object.keys(p.kids).forEach(function (cls) {
      const spec = p.kids[cls];
      const col = /placed:(\d+)/.exec(spec);
      if (col && !claimIsReal(rules, p.grid, cls, new RegExp('grid-column\\s*:\\s*' + col[1] + '\\b'))) {
        fail('PLACEMENT claims .' + cls + ' is pinned, and it is not',
          '.' + p.grid + ' > .' + cls + ' is listed as ' + spec + ', but no rule in the' +
          '\n    stylesheet puts it in column ' + col[1] + '. Either restore the rule or' +
          '\n    reclassify it here - silently, it is back to auto-placement.');
      }
      if (spec.indexOf('capped') >= 0 && !claimIsReal(rules, p.grid, cls, /max-width/)) {
        fail('PLACEMENT claims .' + cls + ' is capped, and it is not',
          '.' + p.grid + ' > .' + cls + ' has no max-width, so its auto track grows to' +
          '\n    max-content and takes the width from the text column beside it.');
      }
    });

    shapes[p.grid].forEach(function (inst, sig) {
      const unknown = [];
      const kinds = inst.kids.map(function (tokens) {
        const cls = tokens.filter(function (c) { return p.kids[c]; })[0];
        if (!cls) { unknown.push(tokens.join('.') || '(no class)'); return null; }
        const spec = p.kids[cls];
        const col = /placed:(\d+)/.exec(spec);
        return { cls: cls, col: col ? +col[1] : null, spec: spec };
      });

      if (unknown.length) {
        fail('.' + p.grid + ' has a child PLACEMENT does not know about',
          unknown.join(', ') + '  (seen on: ' + inst.where + ')' +
          '\n    Classify it in PLACEMENT: safe, capped, or placed. An unclassified' +
          '\n    child is auto-placed, and an auto-placed child beside the text is' +
          '\n    exactly how this row collapses.');
        return;
      }

      const rows = placeRows(kinds, p.cols);
      let ti = -1;
      kinds.forEach(function (k, i) { if (ti < 0 && k.spec.indexOf('text') >= 0) ti = i; });
      if (ti < 0) return;              // no text child in this shape; nothing to protect

      const bad = kinds.filter(function (k, i) {
        return i !== ti && rows[i] === rows[ti] &&
          k.spec.indexOf('safe') < 0 && k.spec.indexOf('capped') < 0;
      });

      if (bad.length) {
        fail('.' + p.grid + ' puts an uncapped sibling beside its text',
          '.' + kinds[ti].cls + ' shares row ' + rows[ti] + ' with ' +
          bad.map(function (k) { return '.' + k.cls; }).join(', ') +
          '\n    shape: ' + sig + '\n    seen on: ' + inst.where +
          '\n    The text sits in a track floored at zero; an auto sibling is sized to' +
          '\n    max-content FIRST and leaves it the crumbs. Place the sibling on its' +
          '\n    own row with grid-column, or give it a max-width. Do not floor the' +
          '\n    text track - that can force the page wider than the window.');
      }
    });
  });

  notes.push('grid placement \u2014 ' +
    PLACEMENT.map(function (p) { return '.' + p.grid + ' ' + shapes[p.grid].size; }).join(', ') +
    ' distinct shapes, text column never shared');

  /* --- (f) long unbroken text must land where it can break --- */
  if (!unbreakable.size) {
    fail('no long unbreakable token was rendered anywhere',
      'tools/bigboard.mjs plants them on purpose and the matrix should reach them.' +
      '\n    Either the big board stopped being rendered or plantHazards() changed.' +
      '\n    Without them this check proves nothing.');
  }

  const exposed = [];
  unbreakable.forEach(function (t, sig) {
    if (!chainCanBreak(rules, t.chain)) {
      exposed.push('.' + t.token.slice(0, 28) + '\u2026 (' + t.token.length + ' chars)' +
        '\n      on ' + t.where + '\n      in ' + sig);
    }
  });

  if (exposed.length) {
    fail('free text can arrive unbreakable, and this has nowhere to break',
      exposed.join('\n    ') +
      '\n    Nothing in the chain sets overflow-wrap: break-word, so the token cannot' +
      '\n    wrap. It overflows its column and overlaps whatever is beside it. A track' +
      '\n    floor guarantees the COLUMN is wide enough, never that the CONTENT fits.');
  } else {
    notes.push('unbreakable text \u2014 ' + unbreakable.size +
      ' site(s) reached, all able to break');
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
