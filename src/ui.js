// @ts-check
/**
 * Where you are in the app: current view, which meeting week, filters, timers.
 *
 * All of this is PER PERSON and PER BROWSER. It lives in sessionStorage and never
 * goes near the shared board. That matters: if any of it were shared, two people
 * would fight over each other's navigation, and one person changing week would drag
 * everyone else's screen with them.
 *
 * The running agenda timers live here too, which is why reloading mid-meeting keeps
 * your clock but nobody else can see it.
 *
 * From board.html:465, 486-489, 523-525.
 */

const KEY = 'techops-board2:ui3';

/** The starting state, and the full list of what is remembered. */
function defaults() {
  return {
    view: 'overview',   // which screen
    // Mirrors lib/theme.js, which owns it (in localStorage); main.js sets it on load.
    theme: 'auto',
    tab: null,          // which meeting, when view === 'tab'
    settings: false,    // showing that meeting's settings
    dates: {},          // per-meeting week override: {tabId: 'YYYY-MM-DD'}
    steps: {},          // per-meeting agenda step: {tabId: 0-4}
    timers: {},         // per-meeting clock: {tabId: {acc, start}}
    filter: 'open',     // action register filter
    person: 'all',      // scope everything to one person's work
    regTab: 'all',      // action register meeting filter
    projFilter: 'all',  // action register project filter
    actQuery: '',       // Action items: the search box
    // Which column the Action items table is sorted by, or null for the default
    // work order. Two scalars, for the reason given above projSort.
    actSort: null,
    actSortDir: 'asc',
    projStatus: 'live', // Projects list: which statuses to show
    projTab: 'all',     // Projects list: meeting filter
    projQuery: '',      // Projects list: the search box
    projField: 'all',   // Projects list: Field filter, lower-cased, or 'all'
    projType: 'all',    // Projects list: Project Type filter, lower-cased, or 'all'
    // Which column the Projects list is sorted by, or null for the default work
    // order. Two scalars rather than one 'value:desc' string: loadUi merges with
    // Object.assign, and a stale composite would need parsing and validating.
    projSort: null,
    projSortDir: 'desc',
    railProj: null,     // project whose actions the meeting rail is filtered to
    project: null,      // the project whose own page is open (view === 'project')
    tlGroup: 'meeting', // timeline grouping
    follow: false,      // showing the copyable follow-up text
    sumShow: false,     // showing the meeting summary preview
    sideSlim: false,    // sidebar collapsed to the icon strip
    // On a local board there is no sign-in, so who you are has to be said. Kept
    // here rather than in the board itself because it is per person and per
    // browser - two people opening the same downloaded copy are not the same person.
    meId: null,
    open: null,         // which inline form is open
    openDetails: {}     // project ids whose details panel is expanded
    // Who you are is NOT remembered here any more - it comes from the sign-in.
  };
}

function storage() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch (e) {
    // Private windows and blocked site data both throw on access.
    return null;
  }
}

/**
 * Load the remembered state, falling back to defaults for anything missing or
 * corrupt. Never throws — a broken value is not worth failing to start over.
 *
 * @returns {any}
 */
export function loadUi() {
  const base = defaults();
  const s = storage();
  if (!s) return base;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    const merged = Object.assign(base, saved);
    // These must be objects; anything else would break lookups.
    ['dates', 'steps', 'timers', 'openDetails'].forEach(function (k) {
      if (!merged[k] || typeof merged[k] !== 'object') merged[k] = {};
    });
    return merged;
  } catch (e) {
    return base;
  }
}

/**
 * Remember the current state. Called after every render, and silently does nothing
 * when storage is unavailable.
 * @param {any} ui
 */
export function saveUi(ui) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(ui));
  } catch (e) {
    // Out of quota, or blocked. Not worth interrupting anyone over.
  }
}

/**
 * Which agenda step a meeting is on, clamped to a real segment.
 * @param {any} ui
 * @param {string} tabId
 */
export function stepOf(ui, tabId) {
  const s = ui.steps[tabId];
  return s >= 0 && s <= 4 ? s : 0;
}
