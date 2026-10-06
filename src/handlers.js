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
import { issueItems, detailsArrived, projVisible } from './domain/queries.js';
import { looksLikeSnapshot } from './adapters/localAdapter.js';
import { upnKey } from './identity.js';
import { setTheme } from './lib/theme.js';
import { adminsOf, viewerIsAdmin } from './domain/scope.js';
import {
  statusChange, newProject, newOpportunity, projectSummary, reorderProjects,
  recordConfidence, SORT_COLUMNS, firstDirFor, canonicalValue
} from './domain/projects.js';
import {
  newIssue, resolveIssue, reopenIssue, reorderQueue
} from './domain/issues.js';
import {
  newAction, toggleDone, changeDue, parseParentRef, wouldGainPath, actionLabel,
  ACTION_SORT_COLUMNS, firstActionDirFor
} from './domain/actions.js';
import {
  deleteAction, deleteEntry, deleteProject, deleteIssue, deletePerson, deleteTab, moveProject,
  deleteNote, renameListValue
} from './domain/cascade.js';
import { decideOpportunity } from './domain/opportunities.js';
import {
  meetingDate, toggleRating, setNote, documentId, meetingSummary, withRole, ROLE_LISTS
} from './domain/meetings.js';

/**
 * Build the handler set.
 *
 * @param {object} app
 * @param {any} app.store
 * @param {any} app.ui
 * @param {() => void} app.render
 * @param {() => string} app.today
 * @param {(question: string) => boolean} [app.confirm] - defaults to window.confirm
 */
export function createHandlers(app) {
  const store = app.store;
  const ui = app.ui;
  const render = app.render;

  /*
   * Asking "are you sure". Injected for the same reason `today` and `identity` are:
   * a handler that reaches for a global is one the tests cannot pin down, and two
   * async tests setting `globalThis.confirm` raced each other into a false pass.
   */
  const ask = app.confirm ||
    (typeof confirm === 'function' ? function (q) { return confirm(q); }
      : function () { return true; });

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

    openForm: function (el, id, v) {
      ui.open = v;
      if (v === 'wl') ui.wlKind = 'win';   // a fresh form starts as a win
      render();
      focusFirst();
    },
    closeForm: function () { ui.open = null; render(); },

    /* Open one action's editor, wherever it is listed. See views/actionEditor.js. */
    editAction: function (el, id) { ui.open = 'act:' + id; render(); focusFirst(); },

    filter: function (el, id, v) { ui.filter = v; render(); },
    projStatusFilter: function (el, id, v) { ui.projStatus = v; render(); },

    /**
     * Sort the Projects table by a column, cycling through three states.
     *
     * First click sorts the way that column naturally goes - numbers highest first,
     * dates soonest first. Second click reverses. Third returns to the default work
     * order, which is what the header's aria-label says it will do.
     */
    projSort: function (el, id, v) {
      // The column name comes off the page, so it is checked rather than trusted -
      // the same reason pickValue validates its field name.
      if (!SORT_COLUMNS[v]) return;

      const first = firstDirFor(v);
      if (ui.projSort !== v) {
        ui.projSort = v;
        ui.projSortDir = first;
      } else if (ui.projSortDir === first) {
        ui.projSortDir = first === 'asc' ? 'desc' : 'asc';
      } else {
        ui.projSort = null;
        ui.projSortDir = first;
      }
      render();
    },

    /**
     * Clear everything narrowing or reordering the Projects list.
     *
     * One reset rather than one per control: by now there are four of them, and four
     * little clear affordances read as clutter. The person scope is NOT cleared - it
     * is set in the sidebar and applies to the whole board, so taking it out from
     * here would be reaching outside this screen.
     */
    projReset: function () {
      ui.projQuery = '';
      ui.projField = 'all';
      ui.projType = 'all';
      ui.projSort = null;
      ui.projSortDir = 'desc';
      render();
    },
    tlGroup: function (el, id, v) { ui.tlGroup = v; render(); },

    /*
     * Three-click cycle: the column's first direction, then reversed, then back to
     * the default work order. Validated against ACTION_SORT_COLUMNS before use —
     * the rule pickValue set, of never trusting a field name read off the page.
     */
    actSort: function (el, id, v) {
      if (!ACTION_SORT_COLUMNS[v]) return;
      const first = firstActionDirFor(v);
      if (ui.actSort !== v) { ui.actSort = v; ui.actSortDir = first; }
      else if (ui.actSortDir === first) { ui.actSortDir = first === 'asc' ? 'desc' : 'asc'; }
      else { ui.actSort = null; ui.actSortDir = first; }
      render();
    },

    actReset: function () {
      ui.actSort = null;
      ui.actSortDir = 'asc';
      ui.actQuery = '';
      ui.projFilter = 'all';
      render();
    },

    /*
     * `ui.projFilter` scopes the register to one project and is set by
     * showProjActions. Since the port it has had no control at all, so arriving
     * from a project page left a filter on with nothing on screen saying so.
     */
    clearProjFilter: function () { ui.projFilter = 'all'; render(); },

    /*
     * Download the whole board as one file.
     *
     * Three jobs at once: the backup for a board that lives only in this browser,
     * the way to move it to another machine, and the file that gets loaded into
     * SharePoint when the lists exist. Browser storage belongs to one address on
     * one machine and can be cleared by a policy nobody told you about; this is
     * the copy that survives that.
     */
    downloadBoard: function () {
      // Time as well as date. Two copies saved on the same day used to share a name,
      // so the browser quietly appended "(1)" - and picking the older one by mistake
      // looks exactly like the load having failed.
      const stamp = new Date().toTimeString().slice(0, 5).replace(':', '');
      const name = 'board-' + app.today() + '-' + stamp + '.json';
      const ok = downloadFile(name, JSON.stringify(store.snapshot(), null, 2));
      toast(ok ? 'Saved as ' + name + ' in your downloads.' : 'This browser cannot download files.');
    },

    /*
     * Ask for a file, using an input this handler creates and owns.
     *
     * It used to be a hidden <input type="file"> in the rendered page, opened by a
     * label. That is the ordinary way to do it, and here it was silently broken: the
     * board redraws on a 60-second poll, a file dialog stays open longer than that,
     * and the redraw detached the very input being chosen for. The pick then fired
     * on an element no longer inside `root`, the delegated listener never saw it,
     * and the result was no dialog, no message, nothing at all - reported exactly
     * that way.
     *
     * An element made here is never part of the rendered page, so no redraw can
     * reach it.
     */
    loadBoard: function () {
      if (typeof document === 'undefined') return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      // Its own listener rather than the delegated one - it is not in the page.
      input.addEventListener('change', function () { edits.loadBoard(input); });
      input.click();
    },
    clearPerson: function () { ui.person = 'all'; render(); },
    toggleFollow: function () { ui.follow = !ui.follow; render(); },
    toggleSummary: function () { ui.sumShow = !ui.sumShow; render(); },

    /*
     * Collapse the sidebar to the icon strip, for width during a meeting. Purely a
     * ui flag - the markup renders the same either way and CSS decides what shows,
     * so collapsing can never stranded a control that lives only in the sidebar
     * (Projects, Timeline, People, the + that adds a meeting, the demo-data marker).
     */
    toggleSide: function () { ui.sideSlim = !ui.sideSlim; render(); },

    /*
     * Push an action to the meeting after the one being looked at. The date is
     * computed in the view (which knows the meeting) and travels in data-v, so this
     * stays a plain write through the same changeDue the date box uses.
     */
    pushDue: function (el, id, v) {
      if (!v) return;
      const doc = changeDue(byId(store.snapshot().actions, id), v);
      if (doc) store.set('actions', id, doc);
    },

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

    /*
     * Promote, hold or cancel an opportunity. Dated to the meeting being looked at
     * in the opportunity's own meeting - the week chosen there, if one is - so a
     * promotion shows in Current Projects from exactly that meeting. The decision
     * is validated in decideOpportunity; nothing off the page is trusted.
     */
    oppDecide: function (el, id, v) {
      const snap = store.snapshot();
      const p = byId(snap.projects, id);
      const tab = p ? byId(snap.tabs, p.tab) : null;
      if (!tab) return;
      cascade(decideOpportunity(snap, id, v, currentDate(tab)));
    },

    /**
     * Move a project up or down its owner's list.
     *
     * Priority is per person per meeting: two people's lists are ordered
     * independently, which is what "each person has their own priority" means.
     */
    movePriority: function (el, id, v) {
      const t = currentTab();
      if (!t) return;
      const snap = store.snapshot();
      const p = byId(snap.projects, id);
      if (!p) return;

      const d = currentDate(t);
      const writes = reorderProjects(snap, t.id, p.personId, id, Number(v),
        function (x) { return projVisible(x, t.id, d); });
      if (!writes) return;

      store.batch(writes.map(function (w) {
        return { op: 'update', col: w.col, id: w.id, patch: w.patch };
      })).then(render);
      render();
    },

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

    /** Open the inline editor on one list value. */
    editListVal: function (el, id, v) {
      ui.open = 'listval:' + el.dataset.key + ':' + v;
      render();
      focusFirst();
    },

    delFieldVal: function (el, id, v) { removeFromList('field', v); },
    delTypeVal: function (el, id, v) { removeFromList('projectType', v); },
    delFocus: function (el, id, v) { removeFromList('focus', v); },
    delResource: function (el, id, v) { removeFromList('resources', v); },
    delProduct: function (el, id, v) { removeFromList('products', v); },

    /**
     * Take one value off a project's products, focus or resources.
     *
     * The field name rides on `data-f` because `data-v` is already carrying the
     * value. Adding is `edits.projAdd`, from the dropdown beside these chips.
     */
    projDrop: function (el, id, v) { pickValue(id, el.dataset.f, v, false); },

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

    /* Per browser, never the shared board. See lib/theme.js. */
    theme: function (el) { ui.theme = setTheme(el.value); render(); },

    /*
     * Who you are, on a local board. Only reachable there - see mePicker.
     * Clearing `person` lets main.js's "open on your own work" nudge re-apply to
     * whoever was just chosen, rather than leaving the board scoped to nobody.
     */
    meId: function (el) {
      ui.meId = el.value || null;
      ui.person = 'all';
      render();
    },

    /*
     * Load a downloaded copy, replacing everything.
     *
     * Confirmed first, and the confirmation counts what is about to go - "replace
     * the board?" is a question somebody says yes to without reading; "replace 47
     * projects?" is one they stop at.
     *
     * The file is checked for shape BEFORE anything is replaced, so a wrong file
     * picked by mistake costs nothing.
     */
    loadBoard: function (el) {
      const file = el.files && el.files[0];
      if (!file) return;
      el.value = '';                       // so picking the same file again re-fires

      file.text().then(function (text) {
        let incoming;
        try {
          incoming = JSON.parse(text);
        } catch (e) {
          toast('That file is not a board - it could not be read.');
          return;
        }
        if (!looksLikeSnapshot(incoming)) {
          toast('That file is not a board. Nothing has been changed.');
          return;
        }

        /*
         * People are counted too. Without them, deleting somebody and then loading a
         * copy showed identical numbers on both sides - "3 projects and 5 actions"
         * twice - so the question gave no sign of what was about to change.
         */
        function describe(b) {
          return (b.people || []).length + ' people, ' + (b.projects || []).length +
            ' projects and ' + (b.actions || []).length + ' actions';
        }
        if (!ask('Replace this board (' + describe(store.snapshot()) + ') with the file (' +
          describe(incoming) + ')?\n\n' +
          'This cannot be undone. Download a copy first if you are unsure.')) {
          // Said out loud: a silent "no" is indistinguishable from a failure.
          toast('Nothing was loaded.');
          return;
        }

        return store.replaceAll(incoming).then(function () {
          toast('Board loaded from the file.');
          render();
        });
      }).catch(function () {
        toast('That file could not be read.');
      });
    },
    regTab: function (el) { ui.regTab = el.value; ui.projFilter = 'all'; render(); },
    projTabFilter: function (el) { ui.projTab = el.value; render(); },
    projFieldFilter: function (el) { ui.projField = el.value; render(); },
    projTypeFilter: function (el) { ui.projType = el.value; render(); },

    navSelect: function (el) {
      const v = el.value;
      if (v.indexOf('tab:') === 0) goView('tab', v.slice(4));
      else goView(v);
    },

    /** Show the "what we'll do differently" field only for a loss. */
    /*
     * Win or loss. Recorded in ui so a redraw keeps the loss-only box showing - it
     * used to be unhidden in the DOM only, and the idle redraw hid it again. The
     * DOM is still updated directly as well, so the box appears and takes focus at
     * once without a redraw moving the caret.
     */
    wlKind: function (el) {
      ui.wlKind = el.value === 'loss' ? 'loss' : 'win';
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

    /*
     * This used to be `{silent: true}` - a write with no redraw - because the date
     * input had no id and `renderPreservingForms` could only restore focus inside a
     * `form[data-form]`. The cost was that the "3d overdue" label beside it stayed
     * stale until something else happened to redraw.
     *
     * Every date box now carries `id="due-<actionId>"`, and formstate re-finds a
     * focused element by id, so the redraw is safe and the row keeps up.
     */
    actionDue: function (el) {
      const doc = changeDue(byId(store.snapshot().actions, el.dataset.id), el.value);
      if (doc) store.set('actions', el.dataset.id, doc);
    },

    meetingNote: function (el) {
      const t = currentTab();
      if (!t) return;
      const d = currentDate(t);
      store.set('meetings', documentId(t.id, d), setNote(store.snapshot(), t.id, d, el.value),
        { silent: true });
    },

    /* --- project fields, from the project page --- */

    /**
     * Add a value from one of the project's pickers.
     *
     * Fires on the dropdown's change. Not silent: the chip has to appear, and a
     * select has no caret to lose.
     */
    projAdd: function (el) {
      const value = el.value;
      if (!value) return;          // the "+ Add a product" placeholder
      el.value = '';
      pickValue(el.dataset.id, el.dataset.f, value, true);
    },

    // The major challenge: raised with an opportunity, kept through promotion, and
    // editable on the tile's details panel and the project page alike.
    projChallenge: function (el) {
      store.update('projects', el.dataset.id, { note: el.value }, { silent: true });
    },

    projMission: function (el) {
      // Silent, like every other free-text field: a redraw mid-sentence would take
      // the caret with it. See the note on actionDue.
      store.update('projects', el.dataset.id, { mission: el.value }, { silent: true });
    },

    /*
     * Customer and name together are the project's title, and both are correctable
     * here because a project often gets entered mid-meeting against the wrong
     * customer or under a placeholder name.
     *
     * Renaming a project needs no cascade: actions point at it by id. That is the
     * difference between this and renaming a PERSON, which has to rewrite every
     * action they own because those store an owner's name as text - see the
     * personName handler below.
     *
     * Both are silent, so the field keeps the caret while it is being typed in. The
     * heading above catches up on the next render.
     */
    /* Which meeting a project is discussed in. Its actions go with it; see
       moveProject. Not silent: the page header and the back button name the
       meeting, and they should change with it. */
    projTab: function (el) {
      cascade(moveProject(store.snapshot(), el.dataset.id, el.value));
    },

    projCustomer: function (el) {
      store.update('projects', el.dataset.id, { customer: el.value }, { silent: true });
    },

    projName: function (el) {
      // An empty name would leave a row with nothing to click on, so a blank is
      // simply not written. projectTitle still has the customer to fall back on.
      const name = String(el.value == null ? '' : el.value).trim();
      if (!name) return;
      store.update('projects', el.dataset.id, { name: name }, { silent: true });
    },

    /*
     * How the project is classified. Silent for the same reason as customer and
     * name: a redraw mid-word takes the caret with it. The Projects-list dropdowns
     * and the datalist of values in use both catch up on the next render.
     *
     * Note these are projField/projType - the Projects-LIST filters above are
     * projFieldFilter/projTypeFilter. Different keys, same map, no collision.
     */
    projField: function (el) { pickOrAdd(el, 'field'); },
    projType: function (el) { pickOrAdd(el, 'projectType'); },

    projDue: function (el) {
      store.update('projects', el.dataset.id, { due: el.value }, { silent: true });
    },

    /* --- project details --- */

    // The dollar value, and only the dollar value, goes to the restricted list.
    pdValue: function (el) { patchDetails(el, { estValue: numberOrNull(el.value) }); },

    // Confidence and why-we-win are the team's, on the project itself. They were
    // restricted until it was pointed out that the value is the only part anyone
    // needs to protect, and hiding the rest just stopped people discussing them.
    pdWin: function (el) {
      const snap = store.snapshot();
      const p = byId(snap.projects, el.dataset.id);
      if (!p) return;

      // The project's OWN meeting, so a number revised on the project page - where
      // no meeting is on screen - is still stamped with the right week.
      const t = byId(snap.tabs, p.tab) || currentTab();
      const patch = recordConfidence(p, numberOrNull(el.value), t ? currentDate(t) : '');
      store.update('projects', el.dataset.id, patch, { silent: true });
    },
    pdReason: function (el) {
      store.update('projects', el.dataset.id, { winReason: el.value }, { silent: true });
    },

    /* --- meeting settings --- */

    tabName: function (el) { patchTab({ name: el.value }); },
    tabKind: function (el) { patchTab({ kind: el.value }); },
    tabWeekday: function (el) { patchTab({ weekday: Number(el.value) }, true); },
    tabLength: function (el) { patchTab({ lengthMin: Number(el.value) || 30 }, true); },
    tabTimer: function (el) { patchTab({ showTimer: !!el.checked }, true); },

    tabRole: function (el) {
      const t = currentTab();
      if (!t) return;
      store.update('tabs', t.id, withRole(t, el.dataset.id, el.dataset.v)).then(render);
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

    /*
     * Lower-cased on the way in, the same as the add form, because `identify`
     * matches on the lower-cased value. Storing it consistently means the match is
     * obvious when somebody reads the roster rather than depending on how it was
     * typed.
     */
    personUpn: function (el) {
      store.update('people', el.dataset.id, { upn: upnKey(el.value) });
    },

    /*
     * The admin switch. Two guards, both about not locking the board by accident:
     *
     * - The last admin cannot be switched off. With none, isAdmin() treats EVERYBODY
     *   as one - right for a board being set up, wrong for one that has been.
     * - A change that would leave you without admin asks first. That includes
     *   naming the first admin when it is somebody else: from then on only admins
     *   get the controls, and you are not one.
     *
     * This decides who is SHOWN the controls. On SharePoint the lock is the site's
     * admin group - see domain/scope.js.
     */
    personAdmin: function (el) {
      const snap = store.snapshot();
      const id = el.dataset.id;
      const on = !!el.checked;
      const after = Object.assign({}, snap, {
        people: snap.people.map(function (p) {
          return p.id === id ? Object.assign({}, p, { admin: on }) : p;
        })
      });

      if (!on && adminsOf(snap).length && !adminsOf(after).length) {
        el.checked = true;
        toast('There has to be at least one admin. Make somebody else one first.');
        return;
      }
      const who = app.identity ? app.identity() : null;
      if (viewerIsAdmin(snap, who) && !viewerIsAdmin(after, who) &&
        !ask('After this you will not be an admin, so you will no longer be able to ' +
          'change the roster or the board settings. Carry on?')) {
        el.checked = !on;
        return;
      }
      store.update('people', id, { admin: on }).then(render);
      render();
    }
  };

  /**
   * Put a value on, or take it off, one of a project's list fields.
   *
   * The field name comes off the page, so it is checked against the three that
   * exist rather than trusted - otherwise a crafted attribute writes an arbitrary
   * key onto the project, which the schema then silently drops.
   *
   * @param {string} id - project id
   * @param {string} field - 'products' | 'focus' | 'resources'
   * @param {string} value
   * @param {boolean} add - true to add, false to remove
   */
  function pickValue(id, field, value, add) {
    if (['products', 'focus', 'resources'].indexOf(field) < 0) return;

    const p = byId(store.snapshot().projects, id);
    if (!p) return;

    const chosen = (p[field] || []).slice();
    const at = chosen.indexOf(value);
    if (add && at < 0) chosen.push(value);
    else if (!add && at >= 0) chosen.splice(at, 1);
    else return;                   // already in the state asked for

    const patch = {};
    patch[field] = chosen;
    store.update('projects', id, patch).then(render);
    render();
  }

  /**
   * Every value of a repeated field, whichever kind of form data this is.
   *
   * A browser sends several checkboxes of the same name as several values, which
   * `FormData.getAll` returns. The tests hand handlers a Map, which has no getAll -
   * so both are accepted rather than making the tests carry a fake browser.
   *
   * @param {any} fd
   * @param {string} name
   * @returns {string[]}
   */
  function manyOf(fd, name) {
    if (typeof fd.getAll === 'function') {
      return fd.getAll(name).map(String).filter(Boolean);
    }
    const one = fd.get(name);
    if (one == null || one === '') return [];
    return Array.isArray(one) ? one.map(String) : [String(one)];
  }

  /**
   * The optional action offered while raising an opportunity.
   *
   * Empty is the normal case and must not be an error, so this resolves quietly
   * when there is nothing to add. The action points at the PROJECT the opportunity
   * created, which is what it will still be attached to next week when the project
   * appears in Current Projects.
   *
   * @returns {Promise<any>}
   */
  function addFirstAction(fd, tab, projectId, meetingDate) {
    const text = String(fd.get('actionText') || '').trim();
    if (!text) return Promise.resolve();

    return store.nextActionNum().then(function (num) {
      const doc = newAction({
        num: num,
        tab: tab.id,
        text: text,
        owner: String(fd.get('actionOwner') || ''),
        support: '',
        due: String(fd.get('actionDue') || ''),
        parent: { type: 'project', id: projectId },
        meetingDate: meetingDate
      });
      return store.set('actions', store.newId(), doc).then(function () {
        toast(actionLabel({ num: num }) + ' added to the new opportunity.');
      });
    });
  }

  /**
   * A combo box over a self-growing list: pick what is there, or type a new one.
   *
   * Three things happen here, and the order matters.
   *
   * The typed value is settled against the list first, so "coatings" becomes the
   * list's "Coatings" and does NOT become a second entry. `el.value` is corrected on
   * the spot, because the project write is silent and the box would otherwise keep
   * showing what was typed rather than what was stored. Assigning `.value` does not
   * re-fire `change`; `wlKind` is the precedent for a handler touching the DOM.
   *
   * Then TWO SEPARATE WRITES, never a batch. `store.batch` reports a failure against
   * one collection - `commit(ops, ops[0].col)` - and a refusal marks that whole
   * permission AREA read-only. A projects-led batch refused because this person
   * cannot write settings would mark `content` read-only and the board would stop
   * being editable, because a list could not grow. They also need different `silent`
   * answers, which one commit cannot give.
   *
   * The growth is gated on `canWrite`: a refused write calls reload(), which replaces
   * the snapshot and can land before the project write is acknowledged, so the person
   * watches their edit revert for a reason that has nothing to do with it.
   *
   * @param {any} el
   * @param {string} key - 'field' | 'projectType'
   */
  function pickOrAdd(el, key) {
    const settled = canonicalValue(itemsOf(key), el.value);
    el.value = settled.value;

    const patch = {};
    patch[key] = settled.value;
    store.update('projects', el.dataset.id, patch, { silent: true });

    if (settled.add && store.canWrite('settings')) growList(key, settled.add);
  }

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

    /*
      * The owner now comes from the form rather than from which person's block the
      * button sat in. `form` is still taken, because closeForm and the caret logic
      * rely on the signature, and because an empty `who` must not silently create an
      * orphan - it is required in the markup and checked again here.
      */
    wl: function (fd) {
      const t = currentTab();
      const text = String(fd.get('text') || '').trim();
      const who = String(fd.get('who') || '').trim();
      if (!t || !text || !who) return;
      const kind = String(fd.get('kind') || 'win');
      const change = String(fd.get('change') || '').trim();
      // A loss has to say what changes. That is the one content rule the app enforces.
      if (kind === 'loss' && !change) {
        toast('A loss needs what we will do differently.');
        return;
      }
      ui.open = null;
      ui.wlKind = 'win';
      store.set('entries', store.newId(), {
        tab: t.id,
        meeting: currentDate(t),
        personId: who,
        kind: kind,
        text: text,
        why: String(fd.get('why') || '').trim(),
        change: change
      }).then(render);
      render();
    },

    opp: function (fd) {
      const t = currentTab();
      const text = String(fd.get('text') || '').trim();
      const who = String(fd.get('who') || '').trim();
      if (!t || !text || !who) return;
      ui.open = null;

      const entryId = store.newId();
      const projectId = store.newId();
      const d = currentDate(t);
      const built = newOpportunity({
        entryId: entryId,
        projectId: projectId,
        tab: t.id,
        personId: who,
        support: String(fd.get('support') || '').trim(),
        text: text,
        why: String(fd.get('why') || '').trim(),
        customer: String(fd.get('customer') || '').trim(),
        winPct: fd.get('winPct'),
        winReason: String(fd.get('winReason') || '').trim(),
        focus: manyOf(fd, 'focus'),
        meetingDate: d
      });

      store.batch([
        { op: 'set', col: 'entries', id: entryId, data: built.entry },
        { op: 'set', col: 'projects', id: projectId, data: built.project }
      ]).then(function () {
        return addFirstAction(fd, t, projectId, d);
      }).then(render);
      render();
    },

    project: function (fd) {
      const t = currentTab();
      const name = String(fd.get('name') || '').trim();
      const who = String(fd.get('who') || '').trim();
      if (!t || !name || !who) return;
      ui.open = null;
      store.set('projects', store.newId(), newProject({
        tab: t.id,
        personId: who,
        support: String(fd.get('support') || '').trim(),
        customer: String(fd.get('customer') || '').trim(),
        name: name,
        note: String(fd.get('challenge') || '').trim(),
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

    /*
     * Save an edited action: what it says, owner, support and due date. What it is
     * related to is deliberately not editable here - see views/actionEditor.js.
     * A blank text or owner is refused rather than saved: an action nobody owns, or
     * that says nothing, is not one.
     */
    editAction: function (fd, form) {
      const id = form && form.dataset ? form.dataset.id : '';
      const a = byId(store.snapshot().actions, id);
      const text = String(fd.get('text') || '').trim();
      const owner = String(fd.get('owner') || '').trim();
      if (!a || !text || !owner) return;
      ui.open = null;
      store.update('actions', id, {
        text: text,
        owner: owner,
        support: String(fd.get('support') || '').trim(),
        due: String(fd.get('due') || '') || a.due || ''
      }).then(render);
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

    /*
     * A new person, and optionally a role in any number of meetings.
     *
     * Their area is not typed any more: it is whichever area meetings they attend,
     * so putting them into meetings here IS setting their area. After this,
     * attendance is changed in each meeting's settings - the one place that owns it.
     *
     * One batch: the person and every meeting they join. People and tabs are both in
     * the `settings` permission group, so a refusal cannot mark an unrelated part of
     * the board read-only (the mixed-batch trap described in store.js).
     */
    person: function (fd) {
      const name = String(fd.get('name') || '').trim();
      if (!name) return;
      ui.open = null;

      const id = store.newId();
      /** @type {any[]} */
      const ops = [{ op: 'set', col: 'people', id: id, data: {
        name: name,
        title: String(fd.get('title') || '').trim(),
        // Lower-cased on the way in, because identify() matches case-insensitively
        // and storing it consistently means the match is obvious when read by eye.
        upn: upnKey(fd.get('upn'))
      } }];

      store.snapshot().tabs.forEach(function (t) {
        const role = String(fd.get('role:' + t.id) || 'none');
        if (role === 'none' || ROLE_LISTS.indexOf(role) < 0) return;
        ops.push({ op: 'update', col: 'tabs', id: t.id, patch: withRole(t, id, role) });
      });

      store.batch(ops).then(render);
      render();
    },

    /**
     * Rename a list value, and every project using it.
     *
     * Run through `cascade()` like every other multi-record change, so it gets the
     * undo toast for free - which matters here more than most, because this can
     * touch a lot of projects at once.
     */
    renameListValue: function (fd, form) {
      ui.open = null;
      cascade(renameListValue(
        store.snapshot(), form.dataset.key, form.dataset.v,
        String(fd.get('value') || '')
      ));
    },

    fieldVal: function (fd) { addToList('field', fd); },
    typeVal: function (fd) { addToList('projectType', fd); },
    focus: function (fd) { addToList('focus', fd); },
    resource: function (fd) { addToList('resources', fd); },
    product: function (fd) { addToList('products', fd); }
  };

  function addToList(key, fd) {
    ui.open = null;
    growList(key, String(fd.get('value') || '').trim());
    render();
  }

  /** The values on one of the settings lists, however empty. */
  function itemsOf(key) {
    const snap = store.snapshot();
    return (snap.settings[key] && snap.settings[key].items) || [];
  }

  /**
   * Append a value to one of the settings lists.
   *
   * De-duped by canonicalValue, NOT by an exact string match. An exact match would
   * let the Add form on Board settings create "Corrosion" and "corrosion" as two
   * entries - which is the very fragmentation this whole design exists to prevent,
   * arriving through the one door that does not go via a project.
   *
   * Deliberately not silent: the new value has to reach the suggestions on a project
   * page, the Projects-table filter and the chips here, none of which the person can
   * already see.
   *
   * @param {string} key
   * @param {string} value
   */
  function growList(key, value) {
    const items = itemsOf(key);
    const settled = canonicalValue(items, value);
    if (!settled.add) return;                    // blank, or already on the list

    store.set('settings', key, { items: items.concat([settled.add]) }).then(render);
  }

  /* ---------------------------------------------------------------- inputs */

  /**
   * Fields that act on every keystroke rather than on change.
   *
   * Only for state that filters what is on screen. Nothing here writes to the store,
   * which is why it can afford to run per keystroke at all.
   */
  const inputs = {
    projQuery: function (el) {
      ui.projQuery = el.value;
      render();
    },

    actQuery: function (el) {
      ui.actQuery = el.value;
      render();
    }
  };

  return { clicks: clicks, edits: edits, forms: forms, inputs: inputs };
}

/**
 * Hand the browser a file to save.
 *
 * No server is involved and nothing leaves the machine - the bytes are built here
 * and passed straight to a download. That matters: this file is the whole board,
 * including real customer names.
 */
function downloadFile(name, text) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking immediately races the download in some browsers; a tick is enough.
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  return true;
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
