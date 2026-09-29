// @ts-check
/**
 * The router: picks a view and wraps it in the app frame.
 *
 * Like every view, this is a pure function from (snapshot, ui, env) to an HTML
 * string, so the whole screen can be rendered in a test and inspected without a
 * browser. That is what makes the smoke tests in tests/views.test.js possible.
 *
 * From board.html:1275-1289.
 */

import { renderSide } from './shell.js';
import { renderOverview } from './overview.js';
import { renderMeeting } from './meeting.js';
import { renderActions } from './actions.js';
import { renderTimeline } from './timeline.js';
import { renderPeople } from './people.js';
import { renderConfig } from './config.js';
import { scopeBoard, viewerIsAdmin } from '../domain/scope.js';
import { renderMeetingSettings } from './settings.js';
import { renderProject } from './project.js';
import { renderProjects } from './projects.js';
import { byId } from '../lib/seq.js';

/**
 * @typedef {import('../domain/queries.js').Snapshot} Snapshot
 */

/**
 * Which permission area the screen currently on show belongs to.
 *
 * The roster and a meeting's settings are the owner's to change; everything else is
 * the team's. This decides whether the "view only" pill appears and whether the
 * controls on screen are disabled. board.html:601-605.
 *
 * @param {any} ui
 * @param {{content: string, settings: string, details: string}} modes
 */
export function areaReadonly(ui, modes) {
  if (ui.view === 'people' || ui.view === 'config') return modes.settings !== 'live';
  if (ui.view === 'tab' && ui.settings) return modes.settings !== 'live';
  return modes.content !== 'live';
}

/**
 * Render the whole page.
 *
 * @param {Snapshot} snap
 * @param {any} ui
 * @param {object} env
 * @param {string} env.today
 * @param {{content: string, settings: string, details: string}} env.modes
 * @returns {string}
 */
export function renderApp(snap, ui, env) {
  /*
   * Who is looking decides two things before any screen is drawn.
   *
   * Which meetings: the board is trimmed to theirs, so every screen - the sidebar,
   * the totals, the registers - draws from the same smaller board and none of them
   * needs to know. That is also exactly what the store will send once it can
   * enforce areas, so nothing here changes then. See domain/scope.js for why this
   * is a view and not yet protection.
   *
   * Whether they are an admin: if not, the settings group is drawn read-only. The
   * store's own answer is kept too, because an admin whose saves SharePoint refuses
   * needs telling why - the People page does that.
   */
  const who = env.identity;
  const admin = viewerIsAdmin(snap, who);
  const board = scopeBoard(snap, who);
  const modes = admin ? env.modes : Object.assign({}, env.modes, { settings: 'readonly' });
  const settingsRefused = !!env.modes && env.modes.settings === 'readonly';
  snap = board;
  env = Object.assign({}, env, { modes: modes, admin: admin, settingsRefused: settingsRefused });

  /*
   * `details` is the third permission group and it is NOT a screen: the annual
   * value sits on a project page among fields anybody may edit. So it cannot be
   * folded into areaReadonly, which answers "is this SCREEN read-only" - it needs
   * its own flag, or somebody allowed to read the money but not change it gets an
   * editable-looking box that rejects the click.
   */
  const full = Object.assign({}, env, {
    areaReadonly: areaReadonly(ui, env.modes),
    detailsReadonly: !!env.modes && env.modes.details !== 'live'
  });

  let main;
  if (ui.view === 'tab') {
    const tab = byId(snap.tabs, ui.tab);
    if (!tab) {
      // The meeting was deleted, or a remembered id no longer exists.
      main = renderOverview(snap, ui, full);
    } else if (ui.settings) {
      main = renderMeetingSettings(snap, ui, full, tab);
    } else {
      main = renderMeeting(snap, ui, full, tab);
    }
  } else if (ui.view === 'project') {
    const p = byId(snap.projects, ui.project);
    // The project was deleted, or a remembered id no longer exists. Falling back to
    // the overview is better than an empty page with no way out.
    main = p ? renderProject(snap, ui, full, p) : renderOverview(snap, ui, full);
  } else if (ui.view === 'projects') {
    main = renderProjects(snap, ui, full);
  } else if (ui.view === 'actions') {
    main = renderActions(snap, ui, full);
  } else if (ui.view === 'timeline') {
    main = renderTimeline(snap, ui, full);
  } else if (ui.view === 'people') {
    main = renderPeople(snap, ui, full);
  } else if (ui.view === 'config') {
    main = renderConfig(snap, ui, full);
  } else {
    main = renderOverview(snap, ui, full);
  }

  // `slim` collapses the sidebar to the icon strip. It goes here rather than on
  // `.side`, because the grid track it changes is declared on `.app`.
  return '<div class="app' + (full.areaReadonly ? ' ro' : '') +
    (ui.sideSlim ? ' slim' : '') + '">' +
    renderSide(snap, ui, full) +
    '<main class="mainarea" id="main"><div class="page">' + main + '</div></main>' +
    '</div>';
}
