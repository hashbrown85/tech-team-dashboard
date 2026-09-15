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
import { loadUi, saveUi, stepOf } from './ui.js';
import { renderApp } from './views/render.js';
import { createHandlers } from './handlers.js';
import { toast, clock, minutes } from './lib/dom.js';
import { today as todayString } from './lib/dates.js';
import { segmentsFor } from './domain/constants.js';
import { byId } from './lib/seq.js';
import { demoBoard } from './demo-data.js';

/**
 * Start the app.
 *
 * @param {object} [options]
 * @param {any} [options.adapter] - defaults to an in-memory demo board
 * @param {HTMLElement} [options.root]
 */
export function start(options) {
  const opts = options || {};
  const root = opts.root || document.getElementById('root');
  if (!root) throw new Error('No #root element to render into.');

  const adapter = opts.adapter || createMemoryAdapter({ seed: demoBoard(), startActionNum: 8 });
  const ui = loadUi();

  const store = createStore(adapter, {
    onMessage: function (msg) { toast(msg); },
    onChange: function () { draw(); }
  });

  const handlers = createHandlers({
    store: store,
    ui: ui,
    render: draw,
    today: todayString
  });

  let drawing = false;

  function draw() {
    // Handlers often change ui state and then also await a store write that fires
    // onChange; without this guard a single click can redraw three times.
    if (drawing) return;
    drawing = true;
    try {
      root.innerHTML = renderApp(store.snapshot(), ui, {
        today: todayString(),
        modes: store.modes()
      });
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
    const fn = handlers.edits[el.getAttribute('data-edit')];
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
