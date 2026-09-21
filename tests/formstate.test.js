// @ts-check
/**
 * Keeping what somebody has typed, across a re-render.
 *
 * This exists because of a reported bug: the new-opportunity form emptied itself
 * halfway through entry, every time, at a different point each time. The cause was
 * not the form. The board reloads and redraws itself every 60 seconds, and again
 * whenever the window regains focus, and `root.innerHTML = ...` throws away anything
 * typed into a form that has not been submitted — there is no record behind it yet.
 *
 * The forms that were fine are the ones whose fields carry `data-edit`: those write
 * on change, so the next render puts the value back from the store. Only the
 * creation forms lost anything, and only the long one lost it reliably, because it
 * is the only one that takes more than a minute to fill in.
 *
 * The functions take the root and the focused element as arguments rather than
 * reaching for `document`, which is what makes this testable with the small fake
 * below instead of a browser.
 */

import { group, test, eq, ok, notOk } from './harness.js';
import {
  captureForms, restoreForms, renderPreservingForms
} from '../src/lib/formstate.js';

/* ---------------------------------------------------------------- a fake DOM */

function el(tag, attrs, children) {
  const a = attrs || {};
  const node = {
    tag: tag,
    attrs: a,
    name: a.name || '',
    type: a.type || (tag === 'select' ? 'select-one' : 'text'),
    value: a.value == null ? '' : String(a.value),
    checked: !!a.checked,
    children: children || [],
    focused: false,
    selection: null,
    getAttribute: function (k) { return a[k] == null ? null : String(a[k]); },
    focus: function () { node.focused = true; },
    setSelectionRange: function (s, e) { node.selection = [s, e]; }
  };
  // Text-ish fields report a caret; number and date ones do not.
  if (tag !== 'select' && ['text', 'textarea'].indexOf(node.type) >= 0) {
    node.selectionStart = a.selectionStart == null ? node.value.length : a.selectionStart;
    node.selectionEnd = a.selectionEnd == null ? node.value.length : a.selectionEnd;
  }
  return node;
}

/** Walk a tree, collecting nodes whose tag is one of `tags`. */
function collect(node, tags, out) {
  (node.children || []).forEach(function (c) {
    if (tags.indexOf(c.tag) >= 0) out.push(c);
    collect(c, tags, out);
  });
  return out;
}

function rootOf(forms) {
  return {
    children: forms,
    querySelectorAll: function (sel) {
      if (sel === 'form[data-form]') {
        return (this.children || []).filter(function (f) {
          return f.getAttribute && f.getAttribute('data-form');
        });
      }
      return collect(this, ['input', 'select', 'textarea'], []);
    }
  };
}

/**
 * A root that really re-renders: assigning innerHTML swaps in the next tree, the
 * way the browser would after renderApp produced new markup.
 */
function liveRoot(before, after) {
  const r = rootOf(before);
  Object.defineProperty(r, 'innerHTML', {
    set: function () { r.children = after; },
    get: function () { return ''; }
  });
  return r;
}

function form(attrs, fields) {
  const f = el('form', attrs, fields);
  f.querySelectorAll = function () {
    return collect(f, ['input', 'select', 'textarea'], []);
  };
  return f;
}

/** The opportunity form, as the view renders it and as a person half-fills it. */
function oppForm(values) {
  const v = values || {};
  return form({ 'data-form': 'opp', 'data-pid': 'p1' }, [
    el('input', { name: 'customer', type: 'text', value: v.customer || '' }),
    el('input', { name: 'text', type: 'text', value: v.text || '' }),
    el('input', { name: 'why', type: 'text', value: v.why || '' }),
    el('input', { name: 'winPct', type: 'number', value: v.winPct || '' }),
    el('input', { name: 'winReason', type: 'text', value: v.winReason || '' }),
    el('input', { name: 'focus', type: 'checkbox', value: 'Corrosion', checked: !!v.corrosion }),
    el('input', { name: 'focus', type: 'checkbox', value: 'Scale', checked: !!v.scale }),
    el('input', { name: 'actionText', type: 'text', value: v.actionText || '' }),
    el('select', { name: 'actionOwner', value: v.actionOwner || '' }),
    el('input', { name: 'actionDue', type: 'date', value: v.actionDue || '' })
  ]);
}

function valueOf(root, name) {
  const found = collect(root, ['input', 'select', 'textarea'], [])
    .filter(function (f) { return f.name === name; });
  return found.length ? found[0].value : null;
}

group('Half-typed forms survive a re-render');

test('Everything typed comes back', () => {
  // This is the reported bug, in miniature: fill some of the form, let the idle
  // poll redraw the page, and find the boxes empty.
  const before = rootOf([oppForm({
    customer: 'Halden Industrial',
    text: 'Downhole scale trial',
    why: 'Their lab is slow',
    winPct: '40'
  })]);

  const typed = captureForms(before, null);
  const after = rootOf([oppForm()]);          // what a fresh render produces
  restoreForms(after, typed);

  eq(valueOf(after, 'customer'), 'Halden Industrial');
  eq(valueOf(after, 'text'), 'Downhole scale trial');
  eq(valueOf(after, 'why'), 'Their lab is slow');
  eq(valueOf(after, 'winPct'), '40');
});

test('Ticked checkboxes come back ticked, and unticked ones stay unticked', () => {
  const before = rootOf([oppForm({ corrosion: true, scale: false })]);
  const typed = captureForms(before, null);

  const after = rootOf([oppForm()]);
  restoreForms(after, typed);

  const boxes = collect(after, ['input'], []).filter(function (f) { return f.name === 'focus'; });
  eq(boxes.length, 2);
  eq(boxes[0].checked, true, 'Corrosion was ticked');
  eq(boxes[1].checked, false, 'Scale was not');
});

test('The field being typed in keeps focus and the caret', () => {
  // Without this the caret jumps to the end of whichever box you were in, or focus
  // is lost entirely and the next keystroke goes nowhere.
  const f = oppForm({ text: 'Downhole scale trial' });
  const field = collect(f, ['input'], []).filter(function (x) { return x.name === 'text'; })[0];
  field.selectionStart = 8;
  field.selectionEnd = 8;

  const typed = captureForms(rootOf([f]), field);
  const after = rootOf([oppForm()]);
  restoreForms(after, typed);

  const restored = collect(after, ['input'], [])
    .filter(function (x) { return x.name === 'text'; })[0];
  ok(restored.focused, 'focus is back in the same field');
  eq(restored.selection, [8, 8], 'and the caret where it was');
});

test('A number or date field has no caret, and that is not an error', () => {
  const f = oppForm({ winPct: '40' });
  const field = collect(f, ['input'], []).filter(function (x) { return x.name === 'winPct'; })[0];

  const typed = captureForms(rootOf([f]), field);
  const after = rootOf([oppForm()]);
  restoreForms(after, typed);

  const restored = collect(after, ['input'], [])
    .filter(function (x) { return x.name === 'winPct'; })[0];
  eq(restored.value, '40');
  ok(restored.focused, 'it still gets focus back');
});

group('What must NOT be restored');

test('Nothing is put back into a form that has gone', () => {
  // After a successful submit the form is not rendered again. Restoring into
  // nothing must be a no-op, not a crash - and must not resurrect the values.
  const typed = captureForms(rootOf([oppForm({ text: 'Downhole scale trial' })]), null);
  const after = rootOf([]);
  restoreForms(after, typed);
  ok(true, 'did not throw');
});

test('Two forms of the same kind never swap what was typed into them', () => {
  // A screen can render several forms with the SAME data-form - two notes being
  // edited at once, for instance. Matching on data-form alone would drop what was
  // typed into one of them into the other.
  //
  // This used to be shown with the per-person opportunity forms, one per block.
  // Those are a single form now, so it uses the pair that does still occur.
  const mine = form({ 'data-form': 'noteEdit', 'data-id': 'n1' }, [
    el('textarea', { name: 'text', type: 'textarea', value: 'Mine' })
  ]);
  const theirs = form({ 'data-form': 'noteEdit', 'data-id': 'n2' }, [
    el('textarea', { name: 'text', type: 'textarea', value: '' })
  ]);

  const typed = captureForms(rootOf([mine, theirs]), null);

  const after = rootOf([
    form({ 'data-form': 'noteEdit', 'data-id': 'n1' }, [
      el('textarea', { name: 'text', type: 'textarea', value: '' })
    ]),
    form({ 'data-form': 'noteEdit', 'data-id': 'n2' }, [
      el('textarea', { name: 'text', type: 'textarea', value: '' })
    ])
  ]);
  restoreForms(after, typed);

  const boxes = collect(after, ['textarea'], []);
  eq(boxes[0].value, 'Mine', 'n1 gets its own back');
  eq(boxes[1].value, '', 'and n2 gets nothing');
});

test('A form that changed shape is left alone rather than part-filled', () => {
  // If the render produced a different set of fields, the saved values no longer
  // line up. The first field here has the SAME name as the first saved one, so only
  // the field-count check can stop a partial restore - the name check cannot.
  const typed = captureForms(rootOf([oppForm({ customer: 'Halden Industrial' })]), null);

  const after = rootOf([form({ 'data-form': 'opp', 'data-pid': 'p1' }, [
    el('input', { name: 'customer', type: 'text', value: '' })
  ])]);
  restoreForms(after, typed);

  eq(valueOf(after, 'customer'), '', 'nothing part-filled');
});

test('Reordered fields are left alone rather than shuffled into each other', () => {
  // Same form, same number of fields, different order. Restoring by position alone
  // would put the customer into the title box and the title into the customer box.
  const before = rootOf([form({ 'data-form': 'opp', 'data-pid': 'p1' }, [
    el('input', { name: 'customer', type: 'text', value: 'Halden Industrial' }),
    el('input', { name: 'text', type: 'text', value: 'Downhole scale trial' })
  ])]);
  const typed = captureForms(before, null);

  const after = rootOf([form({ 'data-form': 'opp', 'data-pid': 'p1' }, [
    el('input', { name: 'text', type: 'text', value: '' }),
    el('input', { name: 'customer', type: 'text', value: '' })
  ])]);
  restoreForms(after, typed);

  eq(valueOf(after, 'text'), '', 'the title box is not given the customer');
  eq(valueOf(after, 'customer'), '', 'nor the other way round');
});

test('Values are matched by position, so repeated names stay in their own boxes', () => {
  // The focus checkboxes all share one name - that is how a browser sends several
  // values under it - so matching by name alone would put the first one everywhere.
  const before = rootOf([oppForm({ corrosion: false, scale: true })]);
  const typed = captureForms(before, null);

  const after = rootOf([oppForm()]);
  restoreForms(after, typed);

  const boxes = collect(after, ['input'], []).filter(function (f) { return f.name === 'focus'; });
  eq(boxes[0].checked, false, 'Corrosion still unticked');
  eq(boxes[1].checked, true, 'Scale still ticked');
});

group('Capture and restore are one step, not two');

test('Rendering through renderPreservingForms keeps what was typed', () => {
  // The two halves used to be separate statements around an `innerHTML =` in
  // main.js, where dropping the second one silently reintroduces the original bug
  // and no test could see it. Now there is a single call to get wrong.
  const root = liveRoot(
    [oppForm({ customer: 'Halden Industrial', text: 'Downhole scale trial' })],
    [oppForm()]
  );

  renderPreservingForms(root, '<ignored/>', null);

  eq(valueOf(root, 'customer'), 'Halden Industrial');
  eq(valueOf(root, 'text'), 'Downhole scale trial');
});

test('It captures BEFORE replacing, not after', () => {
  // Reading the forms after the replace would capture the blank ones and put those
  // back, which looks exactly like doing nothing at all.
  const root = liveRoot([oppForm({ text: 'Downhole scale trial' })], [oppForm()]);
  renderPreservingForms(root, '<ignored/>', null);
  eq(valueOf(root, 'text'), 'Downhole scale trial');
});

test('A form that is gone after the render is simply gone', () => {
  // This is the successful-submit path: the values described something that now
  // exists, and putting them back would leave a ghost of it in an empty form.
  const root = liveRoot([oppForm({ text: 'Downhole scale trial' })], []);
  renderPreservingForms(root, '<ignored/>', null);
  eq(collect(root, ['input'], []).length, 0, 'nothing resurrected');
});

group('It copes with nothing to do');

test('No forms on the page captures nothing', () => {
  eq(captureForms(rootOf([]), null), []);
});

test('A missing or odd root does not throw', () => {
  eq(captureForms(null, null), []);
  eq(captureForms({}, null), []);
  restoreForms(null, []);
  restoreForms({}, null);
  ok(true, 'all no-ops');
});

test('A form with no fields is not carried around', () => {
  const empty = form({ 'data-form': 'x' }, []);
  eq(captureForms(rootOf([empty]), null), []);
});

group('Fields backed by state are left to the view');

/** The projects search box: one input that writes to ui on every keystroke. */
function searchForm(value) {
  return form({ 'data-form': 'projSearch' }, [
    el('input', { name: '', type: 'text', value: value || '', 'data-input': 'projQuery' })
  ]);
}

test('A data-input field keeps the value the view rendered, not the captured one', () => {
  // This is what makes Reset work. Clicking Reset sets ui.projQuery to '' and
  // redraws; the click did not touch the box, so capture reads the OLD text out of
  // it. Restoring that would put the search straight back and Reset would look
  // broken.
  const before = rootOf([searchForm('meridian')]);
  const typed = captureForms(before, null);

  const after = rootOf([searchForm('')]);        // what the view now renders
  restoreForms(after, typed);

  eq(valueOf(after, ''), '', 'the blank the view rendered survives');
});

test('But focus and the caret still come back', () => {
  // Only the value is the view's business. Losing focus mid-word is still the bug
  // this whole file exists for.
  const f = searchForm('meridian');
  const field = collect(f, ['input'], [])[0];
  field.selectionStart = 4;
  field.selectionEnd = 4;

  const typed = captureForms(rootOf([f]), field);
  const after = rootOf([searchForm('meridian')]);
  restoreForms(after, typed);

  const restored = collect(after, ['input'], [])[0];
  ok(restored.focused, 'focus is back');
  eq(restored.selection, [4, 4], 'and the caret where it was');
});

test('An ordinary field in the same form is still restored', () => {
  // The rule is per field, not per form.
  const before = rootOf([form({ 'data-form': 'mixed' }, [
    el('input', { name: 'typed', type: 'text', value: 'kept' }),
    el('input', { name: 'live', type: 'text', value: 'stale', 'data-input': 'q' })
  ])]);
  const typed = captureForms(before, null);

  const after = rootOf([form({ 'data-form': 'mixed' }, [
    el('input', { name: 'typed', type: 'text', value: '' }),
    el('input', { name: 'live', type: 'text', value: 'fresh', 'data-input': 'q' })
  ])]);
  restoreForms(after, typed);

  eq(valueOf(after, 'typed'), 'kept', 'the ordinary one comes back');
  eq(valueOf(after, 'live'), 'fresh', 'the state-backed one does not');
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
