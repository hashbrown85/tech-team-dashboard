// @ts-check
/**
 * A DataStore backed by SharePoint lists, over Microsoft Graph.
 *
 * Satisfies the same contract as memoryAdapter.js, and is checked against the same
 * shared contract tests — so if it passes, the app works on it unchanged.
 *
 * ## The id problem, and how it is solved
 *
 * SharePoint assigns its own integer item id on create and gives you no say. The app
 * needs its OWN ids honoured, because undo restores deleted records under their
 * original ids and everything points at them by id. So:
 *
 *   - every item carries the app's id in the `Title` column
 *   - this adapter keeps a private map from app id to SharePoint item id
 *   - the map is built during load() and maintained on every write
 *   - nothing above this file ever sees a SharePoint item id
 *
 * When an update or delete arrives for an id that is not in the map, the adapter
 * looks it up by `Title` before giving up — which covers a record created by
 * somebody else since the last load.
 *
 * ## The action counter
 *
 * A single row in its own list, updated with a compare-and-swap: read the value with
 * its ETag, PATCH with `If-Match`, and on 412 read again and retry. That makes the
 * numbers gapless AND safe under two people adding an action in the same second —
 * strictly better than the original, which was a read-then-write with a real race.
 *
 * ## Errors
 *
 * Graph's status codes are mapped to the small vocabulary the store understands, so
 * nothing above here has to know about HTTP: 403 becomes 'denied' (which turns that
 * part of the board read-only), 429 and 503 become 'rate_limit' and are retried
 * honouring Retry-After, 507 becomes 'full'.
 */

import {
  blankSnapshot,
  memoryKeyFor,
  COLLECTIONS,
  KEYED_COLLECTIONS,
  OPTIONAL_COLLECTIONS
} from './DataStore.js';
import {
  SCHEMA, KEY_COLUMN, toFields, fromFields,
  COUNTER_LIST, COUNTER_KEY, COUNTER_COLUMN
} from './sharepointSchema.js';
import { uid } from '../lib/seq.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const PAGE_SIZE = 200;
const MAX_BATCH = 20;      // Graph's limit per $batch request
const MAX_RETRIES = 5;

/**
 * @typedef {import('./DataStore.js').Snapshot} Snapshot
 * @typedef {import('./DataStore.js').Op} Op
 */

/** Graph status -> the store's error vocabulary. */
function codeFor(status) {
  if (status === 401 || status === 403) return 'denied';
  if (status === 429 || status === 503) return 'rate_limit';
  if (status === 507) return 'full';
  if (status === 412) return 'conflict';
  return 'failed';
}

function graphError(status, body) {
  const err = new Error(
    (body && body.error && body.error.message) || ('Graph request failed (' + status + ')')
  );
  /** @type {any} */ (err).code = codeFor(status);
  /** @type {any} */ (err).status = status;
  return err;
}

/**
 * @param {object} config
 * @param {string} config.siteId - Graph site id, or 'host:/sites/name' form
 * @param {() => Promise<string>} config.getToken - a bearer token for Graph
 * @param {typeof fetch} [config.fetch] - injectable for tests
 * @param {(ms: number) => Promise<void>} [config.wait] - injectable for tests
 */
export function createGraphAdapter(config) {
  const doFetch = config.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) throw new Error('No fetch available for the Graph adapter.');

  const wait = config.wait || function (ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  };

  /** collection -> Map(appId -> sharePointItemId) */
  const itemIds = {};
  COLLECTIONS.forEach(function (c) { itemIds[c] = new Map(); });

  function listUrl(listName) {
    return GRAPH + '/sites/' + config.siteId + '/lists/' + encodeURIComponent(listName) + '/items';
  }

  function listNameFor(col) {
    if (col === 'counters') return COUNTER_LIST;
    const spec = SCHEMA[col];
    if (!spec) throw new Error('Unknown collection: ' + col);
    return spec.list;
  }

  /**
   * One Graph request, retrying on throttling.
   *
   * Retry-After is honoured rather than guessed at — SharePoint means it, and
   * ignoring it is how a cascade turns into a cascade of 429s.
   */
  async function request(method, url, body, headers) {
    let attempt = 0;
    for (;;) {
      const token = await config.getToken();
      const res = await doFetch(url, {
        method: method,
        headers: Object.assign({
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }, headers || {}),
        body: body == null ? undefined : JSON.stringify(body)
      });

      if (res.ok) {
        if (res.status === 204) return null;
        return await res.json();
      }

      if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
        const after = Number(res.headers.get('Retry-After') || 1);
        await wait(Math.max(after, 1) * 1000);
        attempt++;
        continue;
      }

      let payload = null;
      try { payload = await res.json(); } catch (e) { payload = null; }
      throw graphError(res.status, payload);
    }
  }

  /* -------------------------------------------------------------- reading */

  /** Every item in a list, following nextLink. */
  async function readAll(listName) {
    let url = listUrl(listName) + '?$expand=fields&$top=' + PAGE_SIZE;
    const out = [];
    for (;;) {
      const page = await request('GET', url, null);
      (page.value || []).forEach(function (item) {
        out.push({ itemId: item.id, etag: item.eTag, fields: item.fields || {} });
      });
      const next = page['@odata.nextLink'];
      if (!next) return out;
      url = next;
    }
  }

  /**
   * Load the whole board and reshape it into the app's Snapshot.
   *
   * All the shape differences are absorbed here — arrays out of JSON columns, the
   * polymorphic action parent out of two text columns, and the two collections the
   * app holds as keyed objects rather than arrays.
   */
  async function load() {
    const snap = blankSnapshot();
    /** Collections this person was refused. Not an error — see below. */
    const denied = [];

    await Promise.all(COLLECTIONS.map(async function (col) {
      const listName = listNameFor(col);

      let rows;
      try {
        rows = await readAll(listName);
      } catch (err) {
        // Being refused ONE list can be perfectly normal: most of the team
        // cannot read project values, and that must not stop the board loading.
        // The collection comes back empty, so the panel is simply not there -
        // because the numbers never arrived, not because the browser chose not
        // to draw them. Any other failure, or a refusal anywhere else, is real.
        const refused = /** @type {any} */ (err).status === 403 ||
          /** @type {any} */ (err).code === 'denied';
        if (refused && OPTIONAL_COLLECTIONS.indexOf(col) >= 0) {
          denied.push(col);
          itemIds[col] = new Map();
          return;
        }
        throw err;
      }

      const map = new Map();

      if (KEYED_COLLECTIONS.indexOf(col) >= 0) {
        rows.forEach(function (row) {
          const storedId = row.fields[KEY_COLUMN];
          if (!storedId) return;
          map.set(storedId, row.itemId);
          const doc = fromFields(col, row.fields);
          delete doc.id;
          snap[col][memoryKeyFor(col, storedId)] = doc;
        });
      } else {
        rows.forEach(function (row) {
          const storedId = row.fields[KEY_COLUMN];
          if (!storedId) return;
          map.set(storedId, row.itemId);
          snap[col].push(fromFields(col, row.fields));
        });
      }

      itemIds[col] = map;
    }));

    // Let the app know what it did not get, so it can say so rather than
    // silently showing a board with pieces missing.
    if (denied.length) snap.denied = denied;

    return snap;
  }

  /* -------------------------------------------------------------- writing */

  /** The SharePoint item id for an app id, looked up if not already known. */
  async function resolveItemId(col, id) {
    const known = itemIds[col].get(id);
    if (known) return known;

    // Somebody else may have created it since our last load.
    const url = listUrl(listNameFor(col)) +
      '?$expand=fields&$top=2&$filter=fields/' + KEY_COLUMN +
      " eq '" + String(id).replace(/'/g, "''") + "'";
    const page = await request('GET', url, null);
    const found = (page.value || [])[0];
    if (!found) return null;
    itemIds[col].set(id, found.id);
    return found.id;
  }

  /** Create or replace a record at the app's id. */
  async function set(col, id, doc) {
    const fields = toFields(col, id, doc);
    const itemId = await resolveItemId(col, id);

    if (itemId) {
      await request('PATCH', listUrl(listNameFor(col)) + '/' + itemId + '/fields', fields);
      return;
    }
    const created = await request('POST', listUrl(listNameFor(col)), { fields: fields });
    // Remember the id SharePoint chose, so the next write finds it.
    if (created && created.id) itemIds[col].set(id, created.id);
  }

  /** Merge fields into an existing record. */
  async function update(col, id, patch) {
    const itemId = await resolveItemId(col, id);
    if (!itemId) {
      // Nothing to merge into. Treat it as a create so a patch can't silently
      // vanish — the same thing the in-memory adapter does.
      await set(col, id, patch);
      return;
    }
    const fields = partialFields(col, patch);
    await request('PATCH', listUrl(listNameFor(col)) + '/' + itemId + '/fields', fields);
  }

  /**
   * Only the columns a patch actually mentions.
   *
   * A full toFields() would blank every field the patch omitted, which for an update
   * is exactly wrong.
   */
  function partialFields(col, patch) {
    const spec = SCHEMA[col];
    const full = toFields(col, '__unused__', patch);
    /** @type {Record<string, any>} */
    const out = {};

    Object.keys(patch || {}).forEach(function (appField) {
      if (appField === 'parent' && col === 'actions') {
        out.ParentType = full.ParentType;
        out.ParentKey = full.ParentKey;
        return;
      }
      const f = spec.fields[appField];
      if (f) out[f.col] = full[f.col];
    });

    return out;
  }

  async function remove(col, id) {
    const itemId = await resolveItemId(col, id);
    if (!itemId) return;
    await request('DELETE', listUrl(listNameFor(col)) + '/' + itemId, null);
    itemIds[col].delete(id);
  }

  /**
   * Many writes in as few round trips as possible.
   *
   * Graph takes 20 per $batch. A batch is NOT a transaction — each request gets its
   * own status and some can fail while others succeed — so the first failure is
   * reported and the caller's undo is the only rollback. That is the same deal the
   * original app had, and cascade.js builds the undo for exactly this reason.
   *
   * Creates cannot go in a batch, because the id SharePoint assigns has to be read
   * back and remembered; those are done first, individually.
   *
   * @param {Op[]} ops
   */
  async function batch(ops) {
    /** @type {Op[]} */
    const batchable = [];

    for (const op of ops) {
      if (op.op === 'set') {
        const itemId = await resolveItemId(op.col, op.id);
        if (!itemId) {
          await set(op.col, op.id, op.data);   // a create; needs its id read back
          continue;
        }
      }
      batchable.push(op);
    }

    for (let i = 0; i < batchable.length; i += MAX_BATCH) {
      const chunk = batchable.slice(i, i + MAX_BATCH);
      const requests = [];

      for (let n = 0; n < chunk.length; n++) {
        const op = chunk[n];
        const itemId = await resolveItemId(op.col, op.id);
        const base = '/sites/' + config.siteId + '/lists/' +
          encodeURIComponent(listNameFor(op.col)) + '/items';

        if (op.op === 'remove') {
          if (!itemId) continue;
          requests.push({ id: String(n), method: 'DELETE', url: base + '/' + itemId });
          itemIds[op.col].delete(op.id);
        } else if (op.op === 'set') {
          requests.push({
            id: String(n), method: 'PATCH', url: base + '/' + itemId + '/fields',
            headers: { 'Content-Type': 'application/json' },
            body: toFields(op.col, op.id, op.data)
          });
        } else {
          if (!itemId) continue;
          requests.push({
            id: String(n), method: 'PATCH', url: base + '/' + itemId + '/fields',
            headers: { 'Content-Type': 'application/json' },
            body: partialFields(op.col, op.patch)
          });
        }
      }

      if (!requests.length) continue;

      const res = await request('POST', GRAPH + '/$batch', { requests: requests });
      const bad = (res.responses || []).filter(function (r) {
        return r.status < 200 || r.status >= 300;
      });
      if (bad.length) {
        // Report the most serious: a refusal matters more than a 404.
        bad.sort(function (a, b) { return rank(a.status) - rank(b.status); });
        throw graphError(bad[0].status, bad[0].body);
      }
    }
  }

  function rank(status) {
    if (status === 401 || status === 403) return 0;
    if (status === 429 || status === 503) return 1;
    if (status === 507) return 2;
    return 3;
  }

  /* -------------------------------------------------------- the counter */

  /**
   * The next action number, via compare-and-swap.
   *
   * Read value + ETag, PATCH with If-Match, retry on 412. Gapless and safe under
   * concurrent writers, which the original read-then-write was not.
   *
   * Two layers, because there are two kinds of race:
   *
   *  - Within this browser, calls are queued one behind another. This is the case
   *    that actually happens: somebody adds two actions quickly and both reads would
   *    otherwise see the same value.
   *  - Across browsers, the If-Match precondition catches it: whoever writes second
   *    gets a 412, reads again, and takes the next number.
   *
   * If the counter row is missing it is created and then the loop runs again, so the
   * number still comes from a compare-and-swap rather than from the create. The
   * provisioning script creates this row, so that path is only reached on a site
   * that was never provisioned.
   */
  let counterQueue = Promise.resolve();

  function nextActionNum() {
    const run = counterQueue.then(reserveActionNum, reserveActionNum);
    // Keep the queue alive even if one reservation fails.
    counterQueue = run.then(function () {}, function () {});
    return run;
  }

  async function reserveActionNum() {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const url = listUrl(COUNTER_LIST) +
        "?$expand=fields&$top=1&$filter=fields/" + KEY_COLUMN + " eq '" + COUNTER_KEY + "'";
      const page = await request('GET', url, null);
      const row = (page.value || [])[0];

      if (!row) {
        const fields = {};
        fields[KEY_COLUMN] = COUNTER_KEY;
        fields[COUNTER_COLUMN] = 1;
        await request('POST', listUrl(COUNTER_LIST), { fields: fields });
        continue;   // now read it back and reserve properly
      }

      const current = Number(row.fields[COUNTER_COLUMN] || 1);
      const patch = {};
      patch[COUNTER_COLUMN] = current + 1;

      try {
        await request(
          'PATCH',
          listUrl(COUNTER_LIST) + '/' + row.id + '/fields',
          patch,
          { 'If-Match': row.eTag }
        );
        return current;
      } catch (err) {
        // Somebody else took this number. Read again and take the next one.
        if (/** @type {any} */ (err).status === 412) continue;
        throw err;
      }
    }
    throw graphError(409, { error: { message: 'Could not reserve an action number.' } });
  }

  return {
    capabilities: { realtime: false, batch: true, llm: false },

    load: load,

    /** SharePoint has no push. The store polls and reloads on focus instead. */
    watch: function () { return null; },

    set: set,
    update: update,
    remove: remove,
    batch: batch,
    nextActionNum: nextActionNum,
    newId: function () { return uid(); }
  };
}
