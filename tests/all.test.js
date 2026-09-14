// @ts-check
/**
 * Every test file, run together.
 *
 * Each import below defines and runs its own tests as a side effect; this file just
 * gathers them and paints one combined result. Add a new test file by adding an
 * import here.
 */

import { report } from './harness.js';

import './dates.test.js';
import './queries.test.js';
import './projects.test.js';

export const summary = report(
  typeof document === 'undefined' ? null : document.getElementById('results')
);
