// @ts-check
/**
 * A board at realistic size, built to break the layout rather than to look plausible.
 *
 * ## Every value in here is invented
 *
 * CLAUDE.md hard rules, restated because this file is exactly where they would get
 * broken: no company workbooks, exports or data pulls; no real project, customer or
 * person names; nothing that could be mistaken for the real board. The vocabularies
 * below are Greek letters, minerals and compass directions precisely so that anybody
 * glancing at the screen during a rehearsal can see at once that it is fake.
 *
 * ## Deterministic
 *
 * One seeded PRNG, one fixed seed. The same board every time, so "the third project
 * on Northern Area 2 looked wrong" is a thing somebody else can go and look at. An
 * unseeded generator makes a rehearsal unrepeatable, which defeats the point of
 * having one.
 *
 * ## The stress cases are planted, not random
 *
 * Randomness produces plausible data; bugs live in the tails. Everything under
 * `plantHazards` is deliberate, and each one names the failure it is there to
 * provoke. If a hazard stops being a hazard, delete it and say why.
 *
 *     node tools/layout-check.mjs        (uses this)
 *     index.html?board=big               (renders it)
 */

import { today, addDays } from '../src/lib/dates.js';

/* ------------------------------------------------------------------ the dice */

/** mulberry32: small, fast, and good enough to lay out a fake board. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------ obviously invented words */

const FIRST = ['Kappa', 'Delta', 'Sigma', 'Theta', 'Omega', 'Lambda', 'Iota',
  'Zeta', 'Nu', 'Rho', 'Tau', 'Psi', 'Beta', 'Chi', 'Eta', 'Mu', 'Pi', 'Xi',
  'Phi', 'Gamma'];
const LAST = ['Feldspar', 'Ashgrove', 'Quartzman', 'Balewood', 'Corrin',
  'Marlstone', 'Pyrite', 'Dunmore', 'Halloway', 'Bassett', 'Whitlock', 'Redding',
  'Sandover', 'Kessler', 'Trevane', 'Ormsby', 'Lindale', 'Garrow', 'Vance',
  'Thorne'];
const MINERAL = ['Zircon', 'Basalt', 'Gypsum', 'Olivine', 'Calcite', 'Barite',
  'Halite', 'Rutile', 'Kaolin', 'Dolomite'];
const TRADE = ['Coatings', 'Sealants', 'Polymers', 'Fluids', 'Composites'];
const FIELD = ['Coatings', 'Sealants', 'Process', 'Polymers', 'Downhole'];
const PTYPE = ['Trial', 'Reformulation', 'Qualification', 'Scale-up', 'Audit'];
const FOCUS = ['Corrosion', 'Scale', 'Pipeline', 'Rod Pumps', 'Paraffin', 'Emulsion'];
const RESOURCE = ['Pilot reactor', 'Rheometer', 'Weathering cabinet', 'External lab',
  'Pilot line 3'];
const PRODUCT = ['Testex 12 clear', 'Testex 40 pigmented', 'Demo-Bond 7',
  'Demo-Seal HT', 'Testex 88 matte'];

const VERB = ['trial', 'requalification', 'changeover', 'uplift', 'rework',
  'screening', 'validation', 'transfer'];
const THING = ['additive', 'binder', 'primer', 'catalyst', 'dispersion', 'topcoat',
  'hardener', 'thinner'];

/**
 * The snapshot.
 *
 * @param {object} [opts]
 * @param {number} [opts.seed]
 * @returns {any}
 */
export function bigBoard(opts) {
  const o = opts || {};
  const rand = rng(o.seed == null ? 20260917 : o.seed);
  const pick = function (list) { return list[Math.floor(rand() * list.length)]; };
  const chance = function (p) { return rand() < p; };
  const some = function (list, n) {
    const copy = list.slice();
    const out = [];
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
    }
    return out;
  };

  const TODAY = today();
  const monday = (function () {
    const d = new Date(TODAY + 'T00:00:00Z');
    return addDays(TODAY, -(((d.getUTCDay() + 6) % 7)));
  })();

  /* --- people --- */

  const people = [];
  for (let i = 0; i < 20; i++) {
    people.push({
      id: 'bp' + i,
      name: FIRST[i] + ' ' + LAST[i],
      title: pick(['Chemist', 'Senior Chemist', 'Technical Lead', 'Applications',
        'Process Engineer', 'Lab Manager']),
      home: pick(['North', 'South', 'Central', 'Works'])
    });
  }

  /* --- meetings: ten, unevenly loaded --- */

  const tabs = [];
  const AREAS = ['Northern Area 1', 'Northern Area 2', 'Southern Area 1',
    'Southern Area 2', 'Central Area', 'Western Area'];
  AREAS.forEach(function (name, i) {
    tabs.push({
      id: 'bt' + i, name: name, kind: 'area',
      weekday: 1 + (i % 5), lengthMin: pick([30, 45, 60]),
      members: some(people, 3 + Math.floor(rand() * 5)).map(function (p) { return p.id; }),
      support: some(people, 2).map(function (p) { return p.id; }),
      optional: some(people, 2).map(function (p) { return p.id; })
    });
  });
  ['Polymer Review', 'Works Council', 'Safety Review'].forEach(function (name, i) {
    tabs.push({
      id: 'bi' + i, name: name, kind: 'internal',
      weekday: 2 + (i % 4), lengthMin: 45,
      members: some(people, 4).map(function (p) { return p.id; }),
      support: [], optional: []
    });
  });
  // The cross-area roll-up keeps its well-known id so segmentsFor() treats it right.
  tabs.push({
    id: 'techdir', name: 'Tech Directors', kind: 'internal',
    weekday: 4, lengthMin: 60,
    members: some(people, 5).map(function (p) { return p.id; }),
    support: [], optional: []
  });

  /* --- projects --- */

  const projects = [];
  const projectDetails = [];
  let n = 0;

  // Deliberately lopsided: one meeting carries fourteen, one carries a single
  // project, and one carries none at all. Even distribution is the case that never
  // happens and never breaks anything.
  const load = [14, 9, 7, 6, 5, 4, 4, 3, 1, 0, 2];

  tabs.forEach(function (t, ti) {
    const count = load[ti] == null ? 3 : load[ti];
    for (let i = 0; i < count; i++) {
      const id = 'bpr' + (n++);
      const owner = t.members.length
        ? t.members[Math.floor(rand() * t.members.length)]
        : people[0].id;
      const status = pick(['on', 'on', 'on', 'off', 'hold', 'new', 'done', 'cancelled']);

      const p = {
        id: id, tab: t.id, personId: owner,
        name: 'Low-VOC ' + pick(THING) + ' ' + pick(VERB),
        customer: 'Demo ' + pick(MINERAL) + ' ' + pick(TRADE),
        field: pick(FIELD),
        projectType: pick(PTYPE),
        status: status,
        due: chance(0.8) ? addDays(monday, Math.floor(rand() * 180) - 30) : '',
        added: addDays(monday, -Math.floor(rand() * 300)),
        focus: some(FOCUS, Math.floor(rand() * 3)),
        resources: some(RESOURCE, Math.floor(rand() * 2)),
        products: some(PRODUCT, Math.floor(rand() * 2))
      };

      if (chance(0.6)) p.winPct = Math.floor(rand() * 101);
      if (chance(0.4)) p.winReason = 'Only supplier with the ' + pick(THING) + ' data.';
      if (chance(0.3)) p.mission = 'Prove the ' + pick(THING) + ' holds spec on their ' +
        'line before their reformulation deadline.';
      if (status === 'off') { p.prevStatus = 'on'; p.statusMeeting = monday; p.rank = 1000 + i; }
      if (status === 'done' || status === 'cancelled') p.doneMeeting = monday;

      // Confidence series, some of them long enough to be worth drawing.
      if (p.winPct != null && chance(0.6)) {
        const points = 5 + Math.floor(rand() * 55);
        p.confidence = [];
        for (let k = points; k > 0; k--) {
          p.confidence.push({
            m: addDays(monday, -7 * k),
            p: Math.max(0, Math.min(100, Math.floor(rand() * 101)))
          });
        }
        p.confidence.push({ m: monday, p: p.winPct });
      }

      projects.push(p);
      if (chance(0.5)) {
        projectDetails.push({ id: id, estValue: Math.floor(rand() * 900000) + 5000 });
      }
    }
  });

  /* --- a year of entries --- */

  const entries = [];
  let e = 0;
  for (let week = 52; week >= 0; week--) {
    const d = addDays(monday, -7 * week);
    tabs.forEach(function (t) {
      if (!t.members.length || !chance(0.55)) return;
      const howMany = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < howMany; i++) {
        const kind = pick(['win', 'win', 'loss', 'opp']);
        entries.push({
          id: 'be' + (e++), tab: t.id, meeting: d,
          personId: t.members[Math.floor(rand() * t.members.length)],
          kind: kind,
          text: pick(['Held spec on', 'Missed the window on', 'Opened a door at',
            'Recovered', 'Lost time on']) + ' the ' + pick(THING) + ' ' + pick(VERB),
          why: chance(0.6) ? 'Their lab turned the data round slowly.' : '',
          change: kind === 'loss' ? 'Book the rig a fortnight earlier next time.' : ''
        });
      }
    });
  }

  /* --- issues and actions --- */

  const issues = [];
  for (let i = 0; i < 90; i++) {
    const t = tabs[Math.floor(rand() * tabs.length)];
    if (!t.members.length) continue;
    const resolved = chance(0.35);
    issues.push({
      id: 'bis' + i, tab: t.id,
      personId: t.members[Math.floor(rand() * t.members.length)],
      text: pick(['No rig time for', 'Data sheets missing for', 'Spec unclear on',
        'Supplier slipped on']) + ' the ' + pick(THING) + ' ' + pick(VERB),
      sev: pick(['stopper', 'risk', 'risk']),
      status: resolved ? 'resolved' : 'open',
      autoResolved: resolved && chance(0.5),
      meeting: addDays(monday, -7 * Math.floor(rand() * 12)),
      rank: (i + 1) * 100
    });
  }

  const actions = [];
  for (let i = 0; i < 400; i++) {
    const t = tabs[Math.floor(rand() * tabs.length)];
    if (!t.members.length) continue;
    const owner = people[Math.floor(rand() * people.length)];
    const open = chance(0.55);

    // Every dueness state, on purpose: overdue, due soon, far off, and none.
    const when = rand();
    const due = when < 0.25 ? addDays(monday, -Math.floor(rand() * 60) - 1)
      : when < 0.5 ? addDays(monday, Math.floor(rand() * 7))
      : when < 0.85 ? addDays(monday, 7 + Math.floor(rand() * 90))
      : '';

    const inTab = projects.filter(function (p) { return p.tab === t.id; });
    const parent = inTab.length && chance(0.5)
      ? { type: 'project', id: inTab[Math.floor(rand() * inTab.length)].id }
      : null;

    actions.push({
      id: 'ba' + i, num: i + 1, tab: t.id,
      text: pick(['Send', 'Book', 'Confirm', 'Rerun', 'Chase', 'Draft']) + ' the ' +
        pick(THING) + ' ' + pick(['data pack', 'rig slot', 'spec', 'sample set']),
      owner: owner.name,
      support: chance(0.2) ? people[Math.floor(rand() * people.length)].name : '',
      due: due,
      status: open ? 'open' : 'done',
      doneOn: open ? '' : addDays(monday, -Math.floor(rand() * 30)),
      parent: parent,
      meeting: addDays(monday, -7 * Math.floor(rand() * 8))
    });
  }

  /* --- ratings and notes --- */

  const meetings = {};
  tabs.forEach(function (t) {
    for (let week = 0; week < 8; week++) {
      const d = addDays(monday, -7 * week);
      const ratings = {};
      t.members.forEach(function (id) {
        if (chance(0.7)) ratings[id] = 1 + Math.floor(rand() * 5);
      });
      meetings[t.id + '|' + d] = {
        ratings: ratings,
        note: chance(0.4) ? 'Keep the issue list shorter next week.' : ''
      };
    }
  });

  const projectNotes = [];
  projects.forEach(function (p, i) {
    if (!chance(0.4)) return;
    const howMany = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < howMany; k++) {
      projectNotes.push({
        id: 'bn' + i + '-' + k, projectId: p.id, authorId: p.personId,
        text: pick(['Samples shipped.', 'Their lab is slow on the data pack.',
          'Third batch mixing Thursday.', 'Holding the deadline for now.']),
        created: new Date(Date.parse(addDays(monday, -k * 3) + 'T14:32:05.000Z'))
          .toISOString()
      });
    }
  });

  const snap = {
    people: people, tabs: tabs, entries: entries, projects: projects,
    projectDetails: projectDetails, projectNotes: projectNotes,
    issues: issues, actions: actions, meetings: meetings,
    settings: {
      field: { items: FIELD.slice() },
      projectType: { items: PTYPE.slice() },
      focus: { items: FOCUS.slice() },
      resources: { items: RESOURCE.slice() },
      products: { items: PRODUCT.slice() }
    }
  };

  plantHazards(snap, monday);
  return snap;
}

/**
 * The cases that actually break layouts.
 *
 * Each one names the failure it provokes. These are the point of the file — the
 * random data above is only there so they have somewhere realistic to sit.
 */
function plantHazards(snap, monday) {
  const busiest = snap.tabs[0];
  const who = busiest.members[0] || snap.people[0].id;

  // The collapse itself: 80 characters with nothing to break on. This is what
  // `overflow-wrap: anywhere` turned into one letter per line.
  snap.projects.push({
    id: 'bhz1', tab: busiest.id, personId: who,
    name: 'TX12CLRLOWVOCREV7BATCH0449QUALIFICATIONRERUNNORTHERNAREAPILOTLINETHREESEQ',
    customer: 'DEMOZIRCONCOATINGSINTERNATIONALHOLDINGSLIMITEDNORTHERNDIVISION',
    field: 'Coatings', projectType: 'Trial', status: 'on',
    due: addDays(monday, 14), added: addDays(monday, -30),
    focus: [], resources: [], products: []
  });

  // Long but breakable: wrapping, row height, truncation.
  snap.projects.push({
    id: 'bhz2', tab: busiest.id, personId: who,
    name: 'Requalification of the low-odour thinner across the flooring range, ' +
      'including the weathering programme, the adhesion rerun and the revised ' +
      'cure profile agreed after the second pilot batch failed freeze-thaw',
    customer: 'Demo Olivine Composites', field: 'Polymers',
    projectType: 'Requalification and extended weathering programme',
    status: 'off', prevStatus: 'on', statusMeeting: monday, rank: 500,
    due: addDays(monday, 3), added: addDays(monday, -90),
    focus: ['Corrosion', 'Scale', 'Pipeline', 'Rod Pumps', 'Paraffin', 'Emulsion'],
    resources: ['Pilot reactor', 'Rheometer', 'Weathering cabinet', 'External lab'],
    products: ['Testex 12 clear', 'Testex 40 pigmented', 'Demo-Bond 7', 'Demo-Seal HT'],
    winPct: 55, mission: 'Prove it holds adhesion spec on their line.'
  });

  // Escaping, in every place a value reaches the markup.
  snap.projects.push({
    id: 'bhz3', tab: busiest.id, personId: who,
    name: 'Rerun <script>alert(1)</script> & "quoted" spec',
    customer: 'Demo "Quoted" & <Angled> Coatings — 50% Rev\'d',
    field: 'Sealants', projectType: 'Audit', status: 'hold',
    due: '', added: addDays(monday, -12),
    focus: [], resources: [], products: []
  });
  snap.people.push({
    id: 'bhzp', name: 'Wilhelmina Ashgrove-Featherstonehaugh',
    title: 'Applications & <Technical> "Lead"', home: 'North'
  });
  busiest.members.push('bhzp');
  snap.settings.focus.items.push('Corrosion & "scale" <combined>');

  // Money at both ends: moneyShort and the 30px KPI cell.
  snap.projectDetails.push({ id: 'bhz1', estValue: 0 });
  snap.projectDetails.push({ id: 'bhz2', estValue: 999999999 });

  // A bare URL, which has no break opportunities either.
  snap.projectNotes.push({
    id: 'bhzn', projectId: 'bhz2', authorId: who,
    text: 'Method here: https://example.invalid/very/long/path/to/a/document/' +
      'that/nobody/will/shorten/before/the/meeting/starts/index.html?x=1&y=2',
    // A fixed instant, not Date.now(): the board has to be identical run to run,
    // or "the note under that project looked wrong" is not something anybody else
    // can go and look at.
    created: monday + 'T09:15:00.000Z'
  });

  // One action long enough to test the four-column row under pressure.
  snap.actions.push({
    id: 'bhza', num: 9001, tab: busiest.id,
    text: 'Write up the freeze-thaw rerun, circulate the revised cure profile to ' +
      'their lab, book the weathering cabinet for the fortnight after next, and ' +
      'confirm with purchasing that the replacement hardener is on contract before ' +
      'the batch is scheduled',
    owner: 'Wilhelmina Ashgrove-Featherstonehaugh', support: '',
    due: addDays(monday, -2), status: 'open', doneOn: '',
    parent: { type: 'project', id: 'bhz2' }, meeting: monday
  });

  // An issue carrying fifteen actions: list overflow inside one issue.
  snap.issues.push({
    id: 'bhzi', tab: busiest.id, personId: who,
    text: 'Rig time is the constraint on every coatings rerun this quarter',
    sev: 'stopper', status: 'open', meeting: monday, rank: 50
  });
  for (let i = 0; i < 15; i++) {
    snap.actions.push({
      id: 'bhzia' + i, num: 9100 + i, tab: busiest.id,
      text: 'Book rig slot ' + (i + 1) + ' and confirm the sample set',
      owner: snap.people[i % snap.people.length].name, support: '',
      due: addDays(monday, i), status: 'open', doneOn: '',
      parent: { type: 'issue', id: 'bhzi' }, meeting: monday
    });
  }
}
