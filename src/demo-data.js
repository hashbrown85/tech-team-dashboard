// @ts-check
/**
 * A made-up board, so the app can be clicked through locally.
 *
 * EVERYTHING HERE IS INVENTED. No real people, projects, customers or numbers —
 * CLAUDE.md hard rules 1 to 3. The names are deliberately bland ("Northern Area",
 * "Coating additive trial") so nobody can mistake this for the real board. If you
 * want to demo with real data, point the app at a real adapter; do not paste real
 * records into this file.
 *
 * Dates are worked out from today so the demo always looks current: something
 * overdue, something due this week, a rated meeting last week.
 */

import { today as todayString, addDays, nextOn } from './lib/dates.js';

/**
 * @returns {import('./domain/queries.js').Snapshot}
 */
export function demoBoard() {
  const today = todayString();
  const thisMonday = mondayOf(today);
  const lastMonday = addDays(thisMonday, -7);
  const thisTuesday = nextOn(thisMonday, 2);

  return {
    people: [
      { id: 'p1', name: 'Alex Morgan', title: 'Area Technical Lead', home: 'Northern' },
      { id: 'p2', name: 'Priya Raman', title: 'Applications Chemist', home: 'Northern' },
      { id: 'p3', name: 'Sam Okafor', title: 'Process Engineer', home: 'Southern' },
      { id: 'p4', name: 'Dana Whitfield', title: 'Technical Director', home: 'National' },
      { id: 'p5', name: 'Ravi Chandra', title: 'Lab Technician', home: 'Southern' }
    ],

    tabs: [
      {
        id: 't1', name: 'Northern Area', kind: 'area', weekday: 1, lengthMin: 60,
        members: ['p1', 'p2'], support: ['p5'], optional: ['p4']
      },
      {
        id: 't2', name: 'Southern Area', kind: 'area', weekday: 2, lengthMin: 45,
        members: ['p3'], support: ['p5'], optional: []
      },
      {
        id: 'techdir', name: 'Tech Directors', kind: 'internal', weekday: 4, lengthMin: 90,
        members: ['p4', 'p1'], support: [], optional: ['p3']
      }
    ],

    entries: [
      { id: 'e1', tab: 't1', meeting: thisMonday, personId: 'p1', kind: 'win',
        text: 'Coating additive trial passed the adhesion spec', why: 'Ran the pre-check before shipping samples' },
      { id: 'e2', tab: 't1', meeting: thisMonday, personId: 'p2', kind: 'loss',
        text: 'Lost the sealant retender', why: 'Quoted three days after the deadline',
        change: 'Put tender dates in the register the day we hear about them' },
      { id: 'e3', tab: 't1', meeting: thisMonday, personId: 'p1', kind: 'opp',
        text: 'Low-odour thinner for the flooring range', why: 'Needs a fortnight of lab time we have not booked',
        projectId: 'pr4' },
      { id: 'e4', tab: 't1', meeting: lastMonday, personId: 'p2', kind: 'win',
        text: 'Cut the viscosity test cycle from four days to two', why: '' }
    ],

    projects: [
      { id: 'pr1', tab: 't1', personId: 'p1', name: 'Coating additive trial', status: 'on',
        customer: 'Meridian Coatings',
        field: 'Coatings', projectType: 'Trial',
        mission: 'Prove the low-VOC additive holds adhesion spec on their line, so they '
          + 'can move off the incumbent before their reformulation deadline.',
        winPct: 65,
        // Confidence climbing as the trial data came in. Invented, like everything
        // else here - and enough points that the trend line has something to draw.
        confidence: [
          { m: addDays(thisMonday, -28), p: 30 },
          { m: addDays(thisMonday, -21), p: 45 },
          { m: addDays(thisMonday, -14), p: 45 },
          { m: lastMonday, p: 55 },
          { m: thisMonday, p: 65 }
        ],
        winReason: 'Only supplier with the low-VOC data package',
        products: ['Testex 12 clear', 'Demo-Bond 7'],
        resources: ['Rheometer'], focus: ['Corrosion', 'Scale'],
        due: addDays(thisMonday, 24), added: lastMonday },
      { id: 'pr2', tab: 't1', personId: 'p2', name: 'Sealant reformulation', status: 'off',
        customer: 'Halden Industrial',
        field: 'Sealants', projectType: 'Reformulation',
        mission: 'Reformulate to pass freeze-thaw without losing cure speed.',
        due: addDays(thisMonday, 10), added: addDays(lastMonday, -14),
        prevStatus: 'on', statusMeeting: thisMonday, rank: 1000,
        note: 'Second pilot batch failed the freeze-thaw cycle' },
      { id: 'pr3', tab: 't1', personId: 'p1', name: 'Pigment supplier qualification', status: 'hold',
        field: 'Coatings', projectType: 'Qualification',
        due: addDays(thisMonday, 45), added: addDays(lastMonday, -21),
        note: 'Waiting on their updated safety data sheets' },
      { id: 'pr4', tab: 't1', personId: 'p1', name: 'Low-odour thinner for the flooring range',
        status: 'new', due: '', start: addDays(thisMonday, 7), fromOpp: 'e3',
        note: 'Needs a fortnight of lab time we have not booked' },
      { id: 'pr5', tab: 't2', personId: 'p3', name: 'Line 3 throughput uplift', status: 'on',
        customer: 'Internal',
        field: 'Process', projectType: 'Trial',
        winPct: 40, winReason: '',
        // And one going the other way, which is the case worth being able to see.
        confidence: [
          { m: addDays(thisMonday, -21), p: 70 },
          { m: addDays(thisMonday, -14), p: 60 },
          { m: lastMonday, p: 40 }
        ],
        products: ['Testex 12 clear'], resources: [], focus: [],
        due: addDays(thisMonday, 17), added: lastMonday },
      { id: 'pr6', tab: 'techdir', personId: 'p4', name: 'Shared test-method library', status: 'on',
        due: addDays(thisMonday, 60), added: addDays(lastMonday, -28) }
    ],

    // The money, on its own permissioned list, and nothing else. Invented
    // figures, like every other value in this file.
    projectDetails: [
      { id: 'pr1', estValue: 180000 },
      { id: 'pr5', estValue: 90000 }
    ],

    // Timestamped commentary that belongs to the project, not to one meeting.
    projectNotes: [
      { id: 'n1', projectId: 'pr2', authorId: 'p2',
        text: 'Second pilot batch cracked in the freeze-thaw cycle. Suspect the '
          + 'plasticiser ratio.',
        created: isoDaysAgo(9) },
      { id: 'n2', projectId: 'pr2', authorId: 'p1',
        text: 'Halden can hold the deadline two more weeks if we show them a revised '
          + 'cure profile.',
        created: isoDaysAgo(4) },
      { id: 'n3', projectId: 'pr2', authorId: 'p2',
        text: 'Third batch mixing Thursday. Will bring the data to the meeting.',
        created: isoDaysAgo(1), edited: isoDaysAgo(1) },
      { id: 'n4', projectId: 'pr1', authorId: 'p1',
        text: 'Adhesion results back and comfortably inside spec.',
        created: isoDaysAgo(6) }
    ],

    issues: [
      { id: 'i1', tab: 't1', personId: 'p2', text: 'No rheometer time before the customer visit',
        sev: 'stopper', status: 'open', meeting: thisMonday, rank: 0.5 },
      { id: 'i2', tab: 't1', personId: 'p1', text: 'Nobody owns the sample retention log',
        sev: 'risk', status: 'open', meeting: lastMonday, rank: 2 },
      { id: 'i3', tab: 't1', personId: 'p2', text: 'Drum labels printing at the wrong size',
        sev: 'risk', status: 'resolved', resolvedMeeting: thisMonday, autoResolved: true, rank: 3 },
      { id: 'i4', tab: 't2', personId: 'p3', text: 'Line 3 pressure sensor reads high after a wash',
        sev: 'stopper', status: 'open', meeting: thisTuesday, rank: 0.5 }
    ],

    actions: [
      // Overdue, so the overview has something to complain about.
      { id: 'a1', num: 1, tab: 't1', text: 'Send the freeze-thaw data to the formulation group',
        owner: 'Priya Raman', support: '', due: addDays(today, -4), status: 'open',
        parent: { type: 'project', id: 'pr2' }, meeting: lastMonday },
      { id: 'a2', num: 2, tab: 't1', text: 'Book two weeks of lab time for the thinner work',
        owner: 'Alex Morgan', support: 'Ravi Chandra', due: addDays(today, 3), status: 'open',
        parent: null, meeting: thisMonday },
      { id: 'a3', num: 3, tab: 't1', text: 'Reprint the drum labels at 90mm',
        owner: 'Ravi Chandra', support: '', due: addDays(today, -1), status: 'done',
        doneOn: today, parent: { type: 'issue', id: 'i3' }, meeting: lastMonday },
      { id: 'a4', num: 4, tab: 't1', text: 'Chase the pigment supplier for updated safety sheets',
        owner: 'Alex Morgan', support: '', due: addDays(today, 11), status: 'open',
        parent: { type: 'project', id: 'pr3' }, meeting: lastMonday },
      { id: 'a5', num: 5, tab: 't2', text: 'Recalibrate the Line 3 pressure sensor',
        owner: 'Sam Okafor', support: '', due: addDays(today, 6), status: 'open',
        parent: null, meeting: thisTuesday },
      { id: 'a6', num: 6, tab: 'techdir', text: 'Circulate the draft test-method index',
        owner: 'Dana Whitfield', support: '', due: addDays(today, 20), status: 'open',
        parent: { type: 'project', id: 'pr6' }, meeting: thisMonday },
      { id: 'a7', num: 7, tab: 't1', text: 'Add tender dates to the register as they arrive',
        owner: 'Priya Raman', support: '', due: addDays(today, 30), status: 'open',
        parent: null, meeting: thisMonday }
    ],

    meetings: {
      // Two rated weeks, so the trend line has something to draw.
      ['t1|' + lastMonday]: { ratings: { p1: 4, p2: 3, p5: 4 }, note: 'Start on time' },
      ['t1|' + thisMonday]: { ratings: { p1: 4, p2: 5 }, note: '' },
      ['t2|' + thisTuesday]: { ratings: { p3: 4 }, note: '' }
    },

    settings: {
      // What the customer cares about most, not what the project is made of.
      focus: { items: ['Corrosion', 'Scale', 'Pipeline', 'Rod Pumps', 'Paraffin'] },
      resources: { items: ['Pilot reactor', 'Rheometer', 'Weathering cabinet', 'External lab'] },
      // Invented product names. The real list lives in Dataverse; this row stands
      // in for it until that is reachable. See projects.products in the schema.
      products: {
        items: ['Testex 12 clear', 'Testex 40 pigmented', 'Demo-Bond 7', 'Demo-Seal HT']
      }
    }
  };
}

/** An ISO timestamp a whole number of days ago, so the demo always looks current. */
function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

/** The Monday of the week containing `d`. */
function mondayOf(d) {
  const next = nextOn(d, 1);
  return next === d ? d : addDays(next, -7);
}
