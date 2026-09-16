// @ts-check
/**
 * What every button, field and form does.
 *
 * Three groups, matching the three ways the app is driven:
 *   clicks(...)  - buttons carrying data-act
 *   edits(...)   - fields carrying data-edit, fired on change
 *   forms(...)   - forms carrying data-form, on submit
 *
 * A handler's job is small on purpose: read the intent, ask a domain function what
 * should happen, hand the result to the store. The rules live in src/domain/; if a
 * rule is being decided here, it is in the wrong place.
 *
 * From board.html:1323-1707.
 */

import { byId, byName } from './lib/seq.js';
import { addDays, nowIso } from './lib/dates.js';
import { toast, flash, focusFirst } from './lib/dom.js';
import { newNote, editNote, canEditNote } from './domain/notes.js';
import { issueItems, detailsArrived } from './domain/queries.js';
import {
  statusChange, newProject, newOpportunity, projectSummary
} from './domain/projects.js';
import {
  newIssue, resolveIssue, reopenIssue, reorderQueue
} from './domain/issues.js';
import {
  newAction, toggleDone, changeDue, parseParentRef, wouldGainPath, actionLabel
} from './domain/actions.js';
import {
  deleteAction, deleteEntry, deleteProject, deleteIssue, deletePerson, deleteTab, deleteNote
} from './domain/cascade.js';
import {
  meetingDate, toggleRating, setNote, documentId, meetingSummary
} from './domain/meetings.js';

/**
 * Build the handler set.
 *
 * @param {object} app
 * @param {any} app.store
 * @param {any} app.ui
 * @param {() => void} app.render
 * @param {() => string} app.today
 */
export function createHandlers(app) {
  const store = app.store;
  const ui = app.ui;
  const render = app.render;

  /**
   * Who is using the board, as a person id, or null.
   *
   * Notes record an author, so this has to come from the sign-in rather than from
   * anything the page could be told. Somebody not on the roster has no id: they can
   * still write a note, but cannot come back and edit it, because two such people
   * cannot be told apart.
   */
  function myPersonId() {
    const who = app.identity ? app.identity() : null;
    return (who && who.personId) || null;
  }

  /** The meeting currently on screen, or null. */
  function currentTab() {
    return byId(store.snapshot().tabs, ui.tab);
  }

  /** The meeting occurrence currently on screen. */
  function currentDate(tab) {
    const t = tab || currentTab();
    if (!t) return app.today();
    return meetingDate(t, app.today(), ui.dates[t.id]);
  }

  /** Run a cascade and offer an undo in the toast. */
  function cascade(result) {
    if (!result.writes.length) return;
    store.runCascade(result);
    if (result.message) {
      toast(result.message, { onUndo: function () { store.undo().then(render); } });
    }
    render();
  }

  function goView(view, id) {
    ui.view = view;
    if (view === 'tab') ui.tab = id;
    ui.settings = false;
    ui.open = null;
    render();
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  /* ---------------------------------------------------------------- clicks */

  const clicks = {
    go: function (el, id, v) { goView(v, id); },

    step: function (el, id, v) {
      const t = currentTab();
      if (!t) return;
      ui.steps[t.id] = Number(v);
      ui.open = null;
      ui.railProj = null;
      render();
    },

    prevMeeting: function () {
      const t = currentTab();
      if (!t) return;
      ui.dates[t.id] = addDays(currentDate(t), -7);
      render();
    },

    nextMeeting: function () {
      const t = currentTab();
      if (!t) return;
      ui.dates[t.id] = addDays(currentDate(t), 7);
      render();
    },

    thisMeeting: function () {
      const t = currentTab();
      if (!t) return;
      delete ui.dates[t.id];
      render();
    },

    openSettings: function () { ui.settings = true; ui.open = null; render(); },
    closeSettings: function () { ui.settings = false; render(); },

    openForm: function (el, id, v) { ui.open = v; render(); focusFirst(); },
    closeForm: function () { ui.open = null; render(); },

    filter: function (el, id, v) { ui.filter = v; render(); },
    tlGroup: function (el, id, v) { ui.tlGroup = v; render(); },
    clearPerson: function () { ui.person = 'all'; render(); },
    toggleFollow: function () { ui.follow = !ui.follow; render(); },
    toggleSummary: function () { ui.sumShow = !ui.sumShow; render(); },

    openProject: function (el, id) {
      ui.project = id;
      goView('project');
    },

    copyProject: function (el, id) {
      const snap = store.snapshot();
      const p = byId(snap.projects, id);
      if (!p) return;
      // Only include the commercial figures when this reader actually received
      // them - otherwise the copy button would hand out what the page withheld.
      copyText(projectSummary(snap, p, app.today(), detailsArrived(snap)),
        'Project summary copied.');
    },

    /* --- project notes --- */

    editNote: function (el, id) {
      ui.open = 'note:' + id;
      render();
      focusFirst();
    },

    delNote: function (el, id) {
      const snap = store.snapshot();
      const note = byId(snap.projectNotes, id);
      if (!note) return;
      // The view only offers Remove to the author, but the click handler is reachable
      // by anything that can dispatch an event, so the rule is checked here too.
      if (!canEditNote(note, myPersonId(), byId(snap.projects, note.projectId))) return;
      cascade(deleteNote(snap, id));
    },

    selectProject: function (el, id) {
      ui.railProj = ui.railProj === id ? null : id;
      render();
    },
    clearProject: function () { ui.railProj = null; render(); },

    showActions: function (el, id, v) {
      ui.filter = v || 'open';
      ui.regTab = 'all';
      ui.projFilter = 'all';
      goView('actions');
    },

    showProjActions: function (el, id) {
      const p = byId(store.snapshot().projects, id);
      ui.filter = 'all';
      ui.regTab = p ? p.tab : 'all';
      ui.projFilter = id;
      goView('actions');
    },

    focusAction: function (el, id) {
      ui.view = 'actions';
      ui.settings = false;
      ui.filter = 'all';
      ui.open = null;
      render();
      if (typeof document !== 'undefined') flash(document.getElementById('row-' + id));
    },

    openIssue: function (el, id, v) {
      ui.view = 'tab';
      ui.tab = id;
      ui.settings = false;
      ui.steps[id] = 3;
      ui.open = null;
      render();
      if (typeof document !== 'undefined') flash(document.getElementById(v));
    },

    /* --- projects --- */

    projStatus: function (el, id, v) {
      const snap = store.snapshot();
      const p = byId(snap.projects, id);
      if (!p) return;
      // The project's OWN meeting, not whichever one is on screen. On the project
      // page there is no meeting on screen at all, and a status change still has to
      // be stamped with the right one.
      const t = byId(snap.tabs, p.tab) || currentTab();
      if (!t) return;
      const doc = statusChange(snap, p, v, t.id, currentDate(t));
      if (!doc) return;
      store.set('projects', id, doc).then(render);
      render();
    },

    delProject: function (el, id) { cascade(deleteProject(store.snapshot(), id)); },

    /* --- issues --- */

    resolveIssue: function (el, id) {
      const snap = store.snapshot();
      const doc = resolveIssue(byId(snap.issues, id), currentDate());
      if (doc) store.set('issues', id, doc).then(render);
      render();
    },

    reopenIssue: function (el, id) {
      const snap = store.snapshot();
      const doc = reopenIssue(byId(snap.issues, id));
      if (doc) store.set('issues', id, doc).then(render);
      render();
    },

    moveIssue: function (el, id, v) {
      const t = currentTab();
      if (!t) return;
      const writes = reorderQueue(store.snapshot(), t.id, id, Number(v));
      if (!writes) return;
      store.batch(writes.map(function (w) {
        return { op: 'update', col: w.col, id: w.id, patch: w.patch };
      })).then(render);
      render();
    },

    delIssue: function (el, id) { cascade(deleteIssue(store.snapshot(), id)); },

    /* --- entries, actions, people, tabs --- */

    delEntry: function (el, id) { cascade(deleteEntry(store.snapshot(), id)); },
    delAction: function (el, id) { cascade(deleteAction(store.snapshot(), id)); },
    delPerson: function (el, id) { cascade(deletePerson(store.snapshot(), id)); },

    delTab: function () {
      const t = currentTab();
      if (!t) return;
      cascade(deleteTab(store.snapshot(), t.id));
      goView('overview');
    },

    addTab: function () {
      const id = 'tab-' + store.newId();
      store.set('tabs', id, {
        name: 'New meeting', kind: 'internal', weekday: 1, lengthMin: 30,
        members: [], support: [], optional: []
      }).then(render);
      ui.view = 'tab';
      ui.tab = id;
      ui.settings = true;
      render();
    },

    delChem: function (el, id, v) { removeFromList('chemistries', v); },
    delResource: function (el, id, v) { removeFromList('resources', v); },

    /* --- ratings and the summary --- */

    setRating: function (el, id, v) {
      const t = currentTab();
      if (!t) return;
      const d = currentDate(t);
      const doc = toggleRating(store.snapshot(), t.id, d, id, Number(v));
      store.set('meetings', documentId(t.id, d), doc).then(render);
      render();
    },

    copySummary: function () {
      const t = currentTab();
      if (!t) return;
      const text = meetingSummary(store.snapshot(), t, currentDate(t));
      copyText(text);
    },

    /* --- staying fresh --- */

    refresh: function () {
      store.refresh().then(render, function () {});
    }
  };

  function removeFromList(key, value) {
    const snap = store.snapshot();
    const items = ((snap.settings[key] && snap.settings[key].items) || [])
      .filter(function (x) { return x !== value; });
    store.set('settings', key, { items: items }).then(render);
    render();
  }

  /* ----------------------------------------------------------------- edits */

  const edits = {
    personFilter: function (el) { ui.person = el.value; render(); },
    regTab: function (el) { ui.regTab = el.value; ui.projFilter = 'all'; render(); },

    navSelect: function (el) {
      const v = el.value;
      if (v.indexOf('tab:') === 0) goView('tab', v.slice(4));
      else goView(v);
    },

    /** Show the "what we'll do differently" field only for a loss. */
    wlKind: function (el) {
      const form = el.form;
      const change = form && form.querySelector('[name="change"]');
      if (!change) return;
      change.hidden = el.value !== 'loss';
      if (!change.hidden) change.focus();
    },

    actionDone: function (el) {
      const snap = store.snapshot();
      const id = el.dataset.id;
      const action = byId(snap.actions, id);
      if (!action) return;

      const issueTab = action.parent && action.parent.type === 'issue'
        ? (byId(snap.issues, action.parent.id) || {}).tab
        : null;
      const issueTabRecord = issueTab ? byId(snap.tabs, issueTab) : null;

      const out = toggleDone(snap, action, el.checked, {
        today: app.today(),
        issueMeetingDate: issueTabRecord
          ? meetingDate(issueTabRecord, app.today(), ui.dates[issueTabRecord.id])
          : undefined
      });

      const ops = [{ op: 'set', col: 'actions', id: id, data: out.action }];
      if (out.issue) ops.push({ op: 'set', col: 'issues', id: out.issue.id, data: out.issue.doc });

      store.batch(ops).then(render);
      if (out.effect === 'resolved') toast('Last action closed. Issue marked resolved.');
      render();
    },

    actionDue: function (el) {
      const doc = changeDue(byId(store.snapshot().actions, el.dataset.id), el.value);
      // Silent so the date field keeps focus while it is being edited. The due
      // label beside it catches up on the next render.
      if (doc) store.set('actions', el.dataset.id, doc, { silent: true });
    },

    meetingNote: function (el) {
      const t = currentTab();
      if (!t) return;
      const d = currentDate(t);
      store.set('meetings', documentId(t.id, d), setNote(store.snapshot(), t.id, d, el.value),
        { silent: true });
    },

    /* --- project fields, from the project page --- */

    projMission: function (el) {
      // Silent, like every other free-text field: a redraw mid-sentence would take
      // the caret with it. See the note on actionDue.
      store.update('projects', el.dataset.id, { mission: el.value }, { silent: true });
    },

    projCustomer: function (el) {
      store.update('projects', el.dataset.id, { customer: el.value }, { silent: true });
    },

    projDue: function (el) {
      store.update('projects', el.dataset.id, { due: el.value }, { silent: true });
    },

    /* --- project details --- */

    pdValue: function (el) { patchDetails(el, { estValue: numberOrNull(el.value) }); },
    pdWin: function (el) { patchDetails(el, { winPct: numberOrNull(el.value) }); },
    pdReason: function (el) { patchDetails(el, { winReason: el.value }); },

    /* --- meeting settings --- */

    tabName: function (el) { patchTab({ name: el.value }); },
    tabKind: function (el) { patchTab({ kind: el.value }); },
    tabWeekday: function (el) { patchTab({ weekday: Number(el.value) }, true); },
    tabLength: function (el) { patchTab({ lengthMin: Number(el.value) || 30 }, true); },
    tabTimer: function (el) { patchTab({ showTimer: !!el.checked }, true); },

    tabRole: function (el) {
      const t = currentTab();
      if (!t) return;
      const personId = el.dataset.id;
      const role = el.dataset.v;
      const patch = {};
      ['members', 'support', 'optional'].forEach(function (r) {
        const without = (t[r] || []).filter(function (x) { return x !== personId; });
        patch[r] = r === role ? without.concat([personId]) : without;
      });
      store.update('tabs', t.id, patch).then(render);
      render();
    },

    /* --- roster --- */

    personName: function (el) {
      const snap = store.snapshot();
      const id = el.dataset.id;
      const before = byId(snap.people, id);
      const after = el.value;
      if (!before || before.name === after) return;

      // Actions record an owner by NAME, so renaming somebody orphans their work
      // unless every matching action is rewritten too. This cascade is the whole
      // reason the owner-id migration is planned - see DATA_MODEL.md.
      const ops = [{ op: 'update', col: 'people', id: id, patch: { name: after } }];
      snap.actions.forEach(function (a) {
        const patch = {};
        if (a.owner === before.name) patch.owner = after;
        if (a.support === before.name) patch.support = after;
        if (Object.keys(patch).length) {
          ops.push({ op: 'update', col: 'actions', id: a.id, patch: patch });
        }
      });
      if (ui.person === before.name) ui.person = after;
      store.batch(ops).then(render);
      render();
    },

    personTitle: function (el) { store.update('people', el.dataset.id, { title: el.value }); },
    personHome: function (el) { store.update('people', el.dataset.id, { home: el.value }); }
  };

  function numberOrNull(v) {
    return v === '' || v == null ? null : Number(v);
  }

  /**
   * Write one of the sensitive project fields.
   *
   * These live in their own collection, on their own permissioned list, keyed by
   * the project's id. The record may not exist yet - the first edit creates it.
   */
  function patchDetails(el, patch) {
    const id = el.dataset.id;
    const existing = byId(store.snapshot().projectDetails || [], id);
    // Silent: the figure is already on screen - the user just typed it. Redrawing
    // would close the panel they are still working in.
    if (existing) store.update('projectDetails', id, patch, { silent: true });
    else store.set('projectDetails', id, patch, { silent: true });
  }

  /**
   * @param {any} patch
   * @param {boolean} [rerender] - true when the change affects more than the field
   *   itself, e.g. the weekday changes every date on the screen.
   */
  function patchTab(patch, rerender) {
    const t = currentTab();
    if (!t) return;
    const p = store.update('tabs', t.id, patch, { silent: !rerender });
    if (rerender) p.then(render);
  }

  /* ----------------------------------------------------------------- forms */

  const forms = {
    note: function (fd, form) {
      const projectId = form.dataset.id;
      const doc = newNote({
        projectId: projectId,
        text: String(fd.get('text') || ''),
        authorId: myPersonId(),
        now: nowIso()
      });
      if (!doc) return;
      store.set('projectNotes', store.newId(), doc).then(render);
      render();
    },

    noteEdit: function (fd, form) {
      const snap = store.snapshot();
      const id = form.dataset.id;
      const note = byId(snap.projectNotes, id);
      if (!note) return;
      if (!canEditNote(note, myPersonId(), byId(snap.projects, note.projectId))) return;

      const doc = editNote(note, String(fd.get('text') || ''), nowIso());
      ui.open = null;
      // editNote returns null when nothing actually changed, which is not a failure -
      // the editor still closes.
      if (doc) store.set('projectNotes', id, doc).then(render);
      render();
    },

    wl: function (fd, form) {
      const t = currentTab();
      const text = String(fd.get('text') || '').trim();
      if (!t || !text) return;
      const kind = String(fd.get('kind') || 'win');
      const change = String(fd.get('change') || '').trim();
      // A loss has to say what changes. That is the one content rule the app enforces.
      if (kind === 'loss' && !change) {
        toast('A loss needs what we will do differently.');
        return;
      }
      ui.open = null;
      store.set('entries', store.newId(), {
        tab: t.id,
        meeting: currentDate(t),
        personId: form.dataset.pid,
        kind: kind,
        text: text,
        why: String(fd.get('why') || '').trim(),
        change: change
      }).then(render);
      render();
    },

    opp: function (fd, form) {
      const t = currentTab();
      const text = String(fd.get('text') || '').trim();
      if (!t || !text) return;
      ui.open = null;

      const entryId = store.newId();
      const projectId = store.newId();
      const built = newOpportunity({
        entryId: entryId,
        projectId: projectId,
        tab: t.id,
        personId: form.dataset.pid,
        text: text,
        why: String(fd.get('why') || '').trim(),
        meetingDate: currentDate(t)
      });

      store.batch([
        { op: 'set', col: 'entries', id: entryId, data: built.entry },
        { op: 'set', col: 'projects', id: projectId, data: built.project }
      ]).then(render);
      render();
    },

    project: function (fd, form) {
      const t = currentTab();
      const name = String(fd.get('name') || '').trim();
      if (!t || !name) return;
      ui.open = null;
      store.set('projects', store.newId(), newProject({
        tab: t.id,
        personId: form.dataset.pid,
        name: name,
        due: String(fd.get('due') || ''),
        meetingDate: currentDate(t)
      })).then(render);
      render();
    },

    issue: function (fd) {
      const t = currentTab();
      const text = String(fd.get('text') || '').trim();
      if (!t || !text) return;
      ui.open = null;
      store.set('issues', store.newId(), newIssue({
        snap: store.snapshot(),
        tab: t.id,
        personId: String(fd.get('who') || ''),
        text: text,
        sev: String(fd.get('sev') || 'stopper'),
        meetingDate: currentDate(t)
      })).then(render);
      render();
    },

    action: function (fd, form) {
      const snap = store.snapshot();
      const tabId = form.dataset.tab;
      const tab = byId(snap.tabs, tabId);
      const text = String(fd.get('text') || '').trim();
      if (!tab || !text) return;

      const parent = parseParentRef(snap, String(fd.get('rel') || ''));
      const gains = wouldGainPath(snap, tabId, parent);
      ui.open = null;

      const d = meetingDate(tab, app.today(), ui.dates[tab.id]);
      const parentLabel = parent
        ? (parent.type === 'project'
            ? (byId(snap.projects, parent.id) || {}).name
            : (byId(snap.issues, parent.id) || {}).text)
        : '';

      render();

      store.nextActionNum().then(function (num) {
        const doc = newAction({
          num: num,
          tab: tabId,
          text: text,
          owner: String(fd.get('owner') || ''),
          support: String(fd.get('support') || ''),
          due: String(fd.get('due') || ''),
          parent: parent,
          meetingDate: d
        });
        return store.set('actions', store.newId(), doc).then(function () {
          const label = actionLabel({ num: num });
          toast(gains
            ? 'Path and owner set. Moved to Action items as ' + label + '.'
            : label + ' added' + (parentLabel ? ' to ' + parentLabel : '') + '.');
          render();
        });
      });
    },

    person: function (fd) {
      const name = String(fd.get('name') || '').trim();
      if (!name) return;
      ui.open = null;
      store.set('people', store.newId(), {
        name: name,
        title: String(fd.get('title') || '').trim(),
        home: String(fd.get('home') || '').trim()
      }).then(render);
      render();
    },

    chem: function (fd) { addToList('chemistries', fd); },
    resource: function (fd) { addToList('resources', fd); }
  };

  function addToList(key, fd) {
    const value = String(fd.get('value') || '').trim();
    if (!value) return;
    const snap = store.snapshot();
    const items = ((snap.settings[key] && snap.settings[key].items) || []).slice();
    if (items.indexOf(value) < 0) items.push(value);
    ui.open = null;
    store.set('settings', key, { items: items }).then(render);
    render();
  }

  return { clicks: clicks, edits: edits, forms: forms };
}

/** Copy to the clipboard, with the old-browser fallback the original had. */
function copyText(text, message) {
  const said = message || 'Summary copied.';
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(
      function () { toast(said); },
      function () { fallbackCopy(text, said); }
    );
    return;
  }
  fallbackCopy(text, said);
}

function fallbackCopy(text, message) {
  if (typeof document === 'undefined') return;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  toast(ok ? (message || 'Summary copied.')
    : 'Couldn’t copy — select the text and copy it manually.');
}
