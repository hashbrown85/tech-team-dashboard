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
import { renderMeetingSettings } from './settings.js';
import { renderProject } from './project.js';
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
 * @param {{content: string, settings: string}} modes
 */
export function areaReadonly(ui, modes) {
  if (ui.view === 'people') return modes.settings !== 'live';
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
 * @param {{content: string, settings: string}} env.modes
 * @returns {string}
 */
export function renderApp(snap, ui, env) {
  const full = Object.assign({}, env, { areaReadonly: areaReadonly(ui, env.modes) });

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
  } else if (ui.view === 'actions') {
    main = renderActions(snap, ui, full);
  } else if (ui.view === 'timeline') {
    main = renderTimeline(snap, ui, full);
  } else if (ui.view === 'people') {
    main = renderPeople(snap, ui, full);
  } else {
    main = renderOverview(snap, ui, full);
  }

  return '<div class="app' + (full.areaReadonly ? ' ro' : '') + '">' +
    renderSide(snap, ui, full) +
    '<main class="main" id="main"><div class="page">' + main + '</div></main>' +
    '</div>';
}
