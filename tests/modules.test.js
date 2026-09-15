// @ts-check
/**
 * Every source file imports cleanly.
 *
 * This exists because of a bug that got through: a broken string literal in
 * src/main.js, which no other test imported, so the suite stayed green while the app
 * would not start at all. `node --check` did not catch it either.
 *
 * It is the cheapest possible test and it covers the whole tree: a syntax error, a
 * bad import path, a circular import that deadlocks, or a module that throws while
 * loading all fail here. Anything not reachable from another test is reachable from
 * this one.
 *
 * The list is explicit rather than discovered by scanning the folder, because a test
 * that silently covers nothing when a path changes is worse than no test.
 */

import { group, test, ok } from './harness.js';

const MODULES = [
  // entry points
  '../src/main.js',
  '../src/config.js',
  '../src/store.js',
  '../src/ui.js',
  '../src/demo-data.js',
  '../src/identity.js',
  '../src/handlers.js',
  // library
  '../src/lib/dates.js',
  '../src/lib/dom.js',
  '../src/lib/seq.js',
  // domain
  '../src/domain/constants.js',
  '../src/domain/queries.js',
  '../src/domain/dueness.js',
  '../src/domain/projects.js',
  '../src/domain/issues.js',
  '../src/domain/actions.js',
  '../src/domain/meetings.js',
  '../src/domain/cascade.js',
  // adapters
  '../src/adapters/DataStore.js',
  '../src/adapters/memoryAdapter.js',
  '../src/adapters/graphAdapter.js',
  '../src/adapters/sharepointSchema.js',
  '../src/adapters/auth.js',
  // views
  '../src/views/render.js',
  '../src/views/shell.js',
  '../src/views/overview.js',
  '../src/views/meeting.js',
  '../src/views/actions.js',
  '../src/views/timeline.js',
  '../src/views/people.js',
  '../src/views/settings.js'
];

group('Every module loads');

MODULES.forEach(function (path) {
  test(path.replace('../src/', '') + ' imports', async () => {
    const mod = await import(path);
    ok(mod && typeof mod === 'object', 'it loaded');
    ok(Object.keys(mod).length > 0, 'and exports something');
  });
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
