// @ts-check
/**
 * Boot: pick an adapter, load the board, draw it, and wire up the events.
 *
 * Event handling is delegated — one listener on the root element for clicks, one for
 * changes, one for submits, one for the Escape key. That is why no view attaches an
 * event: the markup says what it wants with data-act / data-edit / data-form, and
 * this file turns that into a handler call. Re-rendering therefore never leaks
 * listeners, because there were never any to leak.
 *
 * From board.html:1709-1765.
 */

import { createStore } from './store.js';
import { createMemoryAdapter } from './adapters/memoryAdapter.js';
import { createLocalAdapter } from './adapters/localAdapter.js';
import { createGraphAdapter } from './adapters/graphAdapter.js';
import { signIn, explainAuthFailure } from './adapters/auth.js';
import { CONFIG, isConfigured, missingConfig } from './config.js';
import { loadUi, saveUi, stepOf } from './ui.js';
import { renderApp } from './views/render.js';
import { createHandlers } from './handlers.js';
import { toast, clock, minutes } from './lib/dom.js';
import { today as todayString } from './lib/dates.js';
import { segmentsFor } from './domain/constants.js';
import { byId } from './lib/seq.js';
import { demoBoard } from './demo-data.js';
import { identify } from './identity.js';
import { renderPreservingForms } from './lib/formstate.js';

/**
 * Work out which backing store to use, and sign in if it needs one.
 *
 * Three outcomes, and the middle one matters: if the app is set to 'sharepoint' but
 * the ids are missing, it says exactly which ones rather than failing obscurely.
 *
 * @param {HTMLElement} root
 * @returns {Promise<{adapter: any, account: any}>}
 */
async function chooseAdapter(root) {
  /*
   * The real board, before SharePoint exists: saved in this browser, no sign-in.
   * `local: true` is what tells identify() this is real data rather than the demo,
   * so it neither labels it a demo nor invents a point of view for it.
   */
  if (CONFIG.mode === 'local') {
    return { adapter: createLocalAdapter({}), account: null, local: true };
  }

  if (CONFIG.mode !== 'sharepoint') {
    // No sign-in in demo mode, so no account: identify() falls back to demo.
    return { adapter: createMemoryAdapter({ seed: demoBoard(), startActionNum: 8 }), account: null };
  }

  if (!isConfigured()) {
    root.innerHTML =
      '<div class="boot"><h1>Nearly there</h1>' +
      '<p>The board is set to use SharePoint, but these are still blank in ' +
      '<code>src/config.js</code>:</p><ul><li>' +
      missingConfig().map(function (m) { return m.replace(/[<>&]/g, ''); }).join('</li><li>') +
      '</li></ul><p>Set <code>mode</code> back to <code>demo</code> to use the ' +
      'sample board in the meantime.</p></div>';
    throw new Error('SharePoint mode is missing configuration.');
  }

  const session = await signIn();
  return {
    adapter: createGraphAdapter({ siteId: CONFIG.siteId, getToken: session.getToken }),
    account: session.account
  };
}

/**
 * Start the app.
 *
 * @param {object} [options]
 * @param {any} [options.adapter] - overrides the configured one; used by tests
 * @param {boolean} [options.local] - the adapter holds REAL data with no sign-in
 * @param {HTMLElement} [options.root]
 */
export async function start(options) {
  const opts = options || {};
  const root = opts.root || document.getElementById('root');
  if (!root) throw new Error('No #root element to render into.');

  let adapter;
  let account = null;
  let local = false;
  try {
    if (opts.adapter) {
      adapter = opts.adapter;
      local = !!opts.local;
    } else {
      const chosen = await chooseAdapter(root);
      adapter = chosen.adapter;
      account = chosen.account;
      local = !!chosen.local;
    }
  } catch (err) {
    // chooseAdapter has already explained a configuration problem on screen.
    if (String(err && err.message).indexOf('missing configuration') >= 0) throw err;
    root.innerHTML =
      '<div class="boot"><h1>Could not sign in</h1><p>' +
      explainAuthFailure(err).replace(/[<>]/g, '') +
      '</p><p>Set <code>mode</code> to <code>demo</code> in ' +
      '<code>src/config.js</code> to use the sample board while this is sorted out.</p></div>';
    throw err;
  }

  const ui = loadUi();

  const store = createStore(adapter, {
    onMessage: function (msg) { toast(msg); },
    onChange: function () { draw(); }
  });

  const handlers = createHandlers({
    store: store,
    ui: ui,
    render: draw,
    today: todayString,
    // Resolved on demand rather than captured, because the roster can change under
    // a long-running session - somebody added to People should be recognised without
    // a reload. Notes record an author, so this has to be the sign-in's answer.
    identity: function () { return identify(store.snapshot(), account, localFor()); }
  });

  /* Null unless this is a local board, which is what identify() keys on. */
  function localFor() {
    return local ? { personId: ui.meId } : null;
  }

  let drawing = false;
  // Once somebody chooses who to show items for, stop overriding it.
  let personFilterTouched = false;

  function draw() {
    // Handlers often change ui state and then also await a store write that fires
    // onChange; without this guard a single click can redraw three times.
    if (drawing) return;
    drawing = true;
    try {
      const snap = store.snapshot();
      const identity = identify(snap, account, localFor());

      // Open on your own work rather than everyone's - but only until the person
      // filter is touched, after which their choice stands.
      if (!personFilterTouched && identity.person && ui.person === 'all') {
        ui.person = identity.person.name;
      }

      // NOT `root.innerHTML = ...`. What somebody has half-typed into a form exists
      // only in the DOM - there is no record behind it yet - so replacing the HTML
      // throws it away, and the 60-second idle poll then empties an open form
      // mid-sentence for no reason the person typing can see.
      renderPreservingForms(root, renderApp(snap, ui, {
        today: todayString(),
        modes: store.modes(),
        identity: identity
      }), document.activeElement);

      saveUi(ui);
      tickTimer();
    } finally {
      drawing = false;
    }
  }

  /* ---------------------------------------------------------------- events */

  root.addEventListener('click', function (e) {
    const el = /** @type {HTMLElement} */ (e.target).closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    const fn = handlers.clicks[act];
    if (!fn) return;
    e.preventDefault();
    fn(el, el.getAttribute('data-id') || '', el.getAttribute('data-v') || '');
  });

  root.addEventListener('change', function (e) {
    const el = /** @type {HTMLElement} */ (e.target).closest('[data-edit]');
    if (!el) return;
    const what = el.getAttribute('data-edit');
    if (what === 'personFilter') personFilterTouched = true;
    const fn = handlers.edits[what];
    if (fn) fn(el);
  });

  /*
   * Fields that filter as you type, via `data-input`.
   *
   * A distinct attribute rather than firing `edits` on `input`: every existing
   * data-edit field would then write to the store on every keystroke - projMission,
   * pdValue, and personName, which cascades over every action that person owns.
   * Opting in keeps all of that unchanged.
   */
  root.addEventListener('input', function (e) {
    const el = /** @type {HTMLElement} */ (e.target).closest('[data-input]');
    if (!el) return;
    const fn = handlers.inputs[el.getAttribute('data-input')];
    if (fn) fn(el);
  });

  root.addEventListener('submit', function (e) {
    const form = /** @type {HTMLFormElement} */ (e.target);
    const name = form.getAttribute && form.getAttribute('data-form');
    if (!name) return;
    e.preventDefault();
    const fn = handlers.forms[name];
    if (fn) fn(new FormData(form), form);
  });

  // A <details> panel opening or closing. The `toggle` event does not bubble, so
  // this listens in the capture phase. Nothing is redrawn - we are only recording
  // what the user did so the next render can put it back the way they left it.
  root.addEventListener('toggle', function (e) {
    const el = /** @type {HTMLElement} */ (e.target);
    if (!el || !el.getAttribute || !el.hasAttribute('data-details')) return;
    const id = el.getAttribute('data-details');
    if (/** @type {HTMLDetailsElement} */ (el).open) ui.openDetails[id] = true;
    else delete ui.openDetails[id];
    saveUi(ui);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.open) {
      ui.open = null;
      draw();
    }
  });

  /* ----------------------------------------------------------- the clock */

  /**
   * The agenda clock. Advisory only: it highlights the segment you *should* be on
   * and warns when you are over, but never changes the step and never writes.
   *
   * Runs on an interval rather than in draw(), so the seconds tick without
   * re-rendering the whole page.
   */
  function tickTimer() {
    if (ui.view !== 'tab' || ui.settings) return;
    const tab = byId(store.snapshot().tabs, ui.tab);
    if (!tab) return;

    const elapsedEl = document.getElementById('t-el');
    if (!elapsedEl) return;

    const timer = ui.timers[tab.id] || { acc: 0, start: 0 };
    const running = !!timer.start;
    const elapsed = timer.acc + (running ? (Date.now() - timer.start) / 1000 : 0);
    const total = (Number(tab.lengthMin) || 30) * 60;
    const segs = segmentsFor(tab);

    elapsedEl.textContent = clock(elapsed);

    const btn = document.getElementById('t-btn');
    if (btn) {
      btn.textContent = running ? '❚❚' : '▶';
      btn.setAttribute('aria-label', running ? 'Pause meeting clock' : 'Start meeting clock');
      btn.classList.toggle('go', !running);
    }

    // Fill each segment's progress bar, and work out which one the clock says.
    let consumed = 0;
    let shouldBe = 0;
    segs.forEach(function (s, i) {
      const budget = total * s.f;
      const into = Math.min(Math.max(elapsed - consumed, 0), budget);
      const bar = document.getElementById('stp-' + i);
      if (bar) bar.style.width = (budget ? (into / budget) * 100 : 0).toFixed(1) + '%';
      if (elapsed > consumed) shouldBe = i;
      consumed += budget;
    });

    const hint = document.getElementById('t-hint');
    if (hint) {
      const step = stepOf(ui, tab.id);
      if (!running && elapsed === 0) {
        hint.textContent = '';
      } else if (elapsed > total) {
        hint.textContent = 'Over by ' + clock(elapsed - total) + '. Wrap up.';
        hint.className = 't-hint warn';
      } else if (shouldBe !== step) {
        hint.textContent = 'The clock says you should be on ' + (shouldBe + 1) +
          ' · ' + segs[shouldBe].short + '. ' + minutes((total - elapsed) / 60) + ' left.';
        hint.className = 't-hint warn';
      } else {
        hint.textContent = minutes((total - elapsed) / 60) + ' left in the meeting.';
        hint.className = 't-hint';
      }
    }
  }

  handlers.clicks.timerToggle = function () {
    const tab = byId(store.snapshot().tabs, ui.tab);
    if (!tab) return;
    const t = ui.timers[tab.id] || { acc: 0, start: 0 };
    if (t.start) {
      t.acc = t.acc + (Date.now() - t.start) / 1000;
      t.start = 0;
    } else {
      t.start = Date.now();
    }
    ui.timers[tab.id] = t;
    draw();
  };

  handlers.clicks.timerReset = function () {
    const tab = byId(store.snapshot().tabs, ui.tab);
    if (!tab) return;
    ui.timers[tab.id] = { acc: 0, start: 0 };
    draw();
  };

  setInterval(tickTimer, 1000);

  /* ------------------------------------------------------------------ go */

  draw();
  store.load().then(function () {
    store.startWatching();
    draw();
  }, function () {
    // The store has already told the user; the shell is up and read-only.
    draw();
  });

  return { store: store, ui: ui, render: draw };
}
