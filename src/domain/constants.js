// @ts-check
/**
 * The board's fixed vocabulary: statuses, severities, roles, and the meeting agenda.
 *
 * These are the strings actually stored in the database, so changing a key here is a
 * data migration, not a rename. Changing a *label* is safe.
 *
 * Lifted from board.html:467-483, 479-480, 616.
 */

/* ---------- projects ---------- */

/** Every status a project can be set to, in the order the buttons appear. */
export const STATUSES = ['on', 'off', 'hold', 'cancelled', 'done'];

/** Statuses that count as live work. Matches ACTIVE in board.html:480. */
export const ACTIVE_STATUSES = ['new', 'on', 'off', 'hold'];

/**
 * Display labels for every status, including 'new', which projects start in but
 * which is not a button you can press. board.html:616.
 */
export const STATUS_LABELS = {
  new: 'New',
  on: 'On track',
  off: 'Off track',
  hold: 'On hold',
  cancelled: 'Cancelled',
  done: 'Done'
};

/* ---------- issues ---------- */

/**
 * Issue severity labels. board.html:478.
 *
 * Note 'offtrack' is never stored on an issue record — it is applied synthetically to
 * off-track projects when they join the issue queue. Only 'stopper' and 'risk' are
 * offered in the form.
 */
export const SEVERITY_LABELS = {
  stopper: 'Urgent',
  risk: 'Important',
  offtrack: 'Off Track Project'
};

/**
 * The severities offered when raising an issue, in the order they appear.
 *
 * 'offtrack' is applied automatically to a project the moment its status is set to
 * off track, which is the usual way it arises — but it is also selectable, because
 * a project can be in trouble without anyone having changed its status yet, and
 * being told "you cannot describe it that way" helps nobody.
 *
 * The dropdown is built from this list, so adding a severity here is all it takes.
 */
export const SEVERITIES = ['stopper', 'risk', 'offtrack'];

/* ---------- meetings ---------- */

/** Meeting kinds. board.html:482. */
export const MEETING_KINDS = { area: 'Area meeting', internal: 'Internal meeting' };

/** Attendance roles, in order. The key is the field name on a tab. board.html:483. */
export const ROLES = [
  ['members', 'Reporting'],
  ['support', 'Supporting'],
  ['optional', 'Optional'],
  ['none', 'Not in meeting']
];

/** Weekday names as the settings screen shows them. Index = Date.getDay(). */
export const WEEKDAYS = [
  'Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'
];

/* ---------- the agenda ---------- */

/**
 * The five agenda segments. `f` is each one's share of the meeting length, and they
 * sum to 1.0 — half the meeting is meant to go on Issues, which is the whole point
 * of the format.
 *
 * `rule` is the coaching text shown under the segment heading; it contains HTML.
 *
 * board.html:467-472.
 */
export const SEGMENTS = [
  {
    name: 'Wins & Losses', short: 'Wins & Losses', tiny: 'Wins', f: 0.15,
    rule: 'Go around the room. Outcomes since the last meeting and <b>why</b>. Own the losses: what was in our control, and what will we do differently?'
  },
  {
    name: 'New Opportunities', short: 'Opportunities', tiny: 'Opps', f: 0.10,
    rule: 'Go around again. Name it, plus any major challenge — deep dives get scheduled separately.'
  },
  {
    name: 'Current Projects', short: 'Projects', tiny: 'Projects', f: 0.15,
    rule: 'One selection each: on track, off track, on hold, cancelled or done. New opportunities presented last week appear here as current projects. Select a project to see only its actions.'
  },
  {
    name: 'Issues', short: 'Issues', tiny: 'Issues', f: 0.50,
    rule: 'Only what has no path yet, ranked. Work from the top: agree the action, <b>one</b> owner, who supports, and the date. Once it has an owner it stops being an issue and moves to Action items.'
  },
  {
    name: 'Rate the Meeting', short: 'Rate', tiny: 'Rate', f: 0.10,
    rule: 'Everyone scores the meeting 1–5. The test: did we leave with clear actions, one owner each, and dates?'
  }
];

/** The tab id that gets the Tech Directors agenda instead of the standard one. */
export const TECHDIR_TAB_ID = 'techdir';

/**
 * The Tech Directors variant: segments 2 and 3 are replaced. board.html:474-477.
 */
export const TECHDIR_SEGMENTS = SEGMENTS.map(function (s, i) {
  if (i === 1) {
    return Object.assign({}, s, {
      name: 'Business Project Review', short: 'Business Review', tiny: 'Review',
      rule: 'A company-wide look at every active project, from every meeting. Not a status update — just making sure nothing important is missing.'
    });
  }
  if (i === 2) {
    return Object.assign({}, s, {
      name: 'Tech-Projects', short: 'Tech-Projects', tiny: 'Tech',
      rule: 'One selection each: on track, off track, on hold, cancelled or done. These are this group\u2019s own technical initiatives — separate from the business-facing projects reviewed in the area meetings.'
    });
  }
  return Object.assign({}, s);
});

/**
 * Which agenda a tab uses.
 * @param {{id?: string} | null} tab
 */
export function segmentsFor(tab) {
  return tab && tab.id === TECHDIR_TAB_ID ? TECHDIR_SEGMENTS : SEGMENTS;
}
