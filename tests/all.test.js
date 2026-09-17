// @ts-check
/**
 * Every test file, run together.
 *
 * Each import below defines and runs its own tests as a side effect; this file just
 * gathers them and paints one combined result. Add a new test file by adding an
 * import here.
 */

import { report } from './harness.js';

import './modules.test.js';
import './dates.test.js';
import './queries.test.js';
import './projects.test.js';
import './issues.test.js';
import './actions.test.js';
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
import './adapterContract.test.js';
import './graphAdapter.test.js';

export const summary = await report(
  typeof document === 'undefined' ? null : document.getElementById('results')
);
