// @ts-check
/**
 * Every test file, run together.
 *
 * Each import below defines and runs its own tests as a side effect; this file just
 * gathers them and paints one combined result. Add a new test file by adding an
 * import here.
 *
 * ## Nothing reachable from here may use node:fs
 *
 * tests/tests.html runs this same file in a browser, so a single `node:` import
 * anywhere in the graph breaks it — and breaks it silently, because the browser
 * harness just stops.
 *
 * That is why there is a SECOND command. Anything that needs to read a file lives in
 * `tools/layout-check.mjs`: it reads the stylesheet and checks the markup against it,
 * which is the one class of bug this suite is structurally unable to see.
 *
 *     node tests/all.test.js
 *     node tools/layout-check.mjs
 */

import { report } from './harness.js';

import './modules.test.js';
import './dates.test.js';
import './queries.test.js';
import './areas.test.js';
import './projects.test.js';
import './issues.test.js';
import './actions.test.js';
import './register.test.js';
import './meetings.test.js';
import './notes.test.js';
import './formstate.test.js';
import './project.test.js';
import './projectsList.test.js';
import './sorting.test.js';
import './lists.test.js';
import './cascade.test.js';
import './store.test.js';
import './identity.test.js';
import './views.test.js';
import './flow.test.js';
import './reporting.test.js';
import './adapterContract.test.js';
import './localAdapter.test.js';
import './localBoard.test.js';
import './graphAdapter.test.js';

export const summary = await report(
  typeof document === 'undefined' ? null : document.getElementById('results')
);
