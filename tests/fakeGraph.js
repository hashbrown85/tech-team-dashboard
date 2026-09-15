// @ts-check
/**
 * A stand-in for Microsoft Graph, good enough to build the adapter against.
 *
 * It is not a simulation of SharePoint. It is a deliberate imitation of the four
 * behaviours that actually shape the adapter's design, each of which is easy to get
 * wrong and expensive to discover in production:
 *
 *  1. **It assigns its own item ids.** A create returns an integer id of the
 *     server's choosing, and there is no way to ask for one. Any adapter that
 *     assumes it can write an app id straight into an item id will fail here, which
 *     is the point.
 *  2. **ETags and 412.** A PATCH with a stale `If-Match` is rejected, which is what
 *     makes the gapless action counter correct under two writers.
 *  3. **429 with Retry-After.** Throttling is normal on SharePoint, not exceptional.
 *  4. **$batch returns per-request statuses.** A batch can half-fail: some requests
 *     succeed and others do not, in one 200 response.
 *
 * Everything can be made to fail on demand, so the adapter's error mapping and the
 * store's read-only fallback are both testable without a tenant.
 */

/**
 * @param {object} [options]
 * @param {Record<string, any[]>} [options.seed] - list name -> array of `fields` objects
 * @param {(req: {method: string, url: string, body: any}) => ({status: number, headers?: any, body?: any} | null)} [options.intercept]
 *   Return a response to fail or fake a request; return null to let it through.
 */
export function createFakeGraph(options) {
  const opts = options || {};

  /** list name -> { items: [{id, etag, fields}], nextId } */
  const lists = {};
  /** Every request that arrived, for assertions about batching and retries. */
  const log = [];

  function ensureList(name) {
    if (!lists[name]) lists[name] = { items: [], nextId: 1 };
    return lists[name];
  }

  if (opts.seed) {
    Object.keys(opts.seed).forEach(function (name) {
      const list = ensureList(name);
      opts.seed[name].forEach(function (fields) {
        list.items.push({
          id: String(list.nextId++),
          etag: 'etag-' + Math.random().toString(36).slice(2, 8),
          fields: JSON.parse(JSON.stringify(fields))
        });
      });
    });
  }

  function bumpEtag(item) {
    item.etag = 'etag-' + Math.random().toString(36).slice(2, 8);
  }

  /** Parse the paths the adapter uses. Anything else is a 404, loudly. */
  function route(method, url, body, headers) {
    // /sites/{site}/lists/{list}/items[/{itemId}[/fields]]
    const m = /\/sites\/[^/]+\/lists\/([^/?]+)\/items(?:\/(\d+))?(?:\/fields)?/.exec(url);
    if (!m) return { status: 404, body: { error: { code: 'unknownRoute', message: url } } };

    const listName = decodeURIComponent(m[1]);
    const itemId = m[2];
    const list = ensureList(listName);

    if (method === 'GET' && !itemId) {
      // $filter must actually filter. An earlier version of this fake ignored it and
      // returned the whole list, which quietly hid the adapter looking a record up by
      // key and being handed the wrong row - writes then landed on the wrong item.
      // A test double that is more forgiving than the real thing is worse than none.
      let source = list.items;
      const filter = (/\$filter=([^&]+)/.exec(url) || [])[1];
      if (filter) {
        const decoded = decodeURIComponent(filter);
        const eq = /^fields\/([A-Za-z0-9_]+)\s+eq\s+'(.*)'$/.exec(decoded);
        if (!eq) {
          return { status: 400,
                   body: { error: { code: 'unsupportedFilter', message: decoded } } };
        }
        const column = eq[1];
        const wanted = eq[2].replace(/''/g, "'");
        source = list.items.filter(function (it) {
          return String(it.fields[column] == null ? '' : it.fields[column]) === wanted;
        });
      }

      // Paged, so the adapter has to follow nextLink rather than assuming one page.
      const top = Number((/\$top=(\d+)/.exec(url) || [])[1] || 200);
      const skip = Number((/\$skiptoken=(\d+)/.exec(url) || [])[1] || 0);
      const page = source.slice(skip, skip + top);
      const more = skip + top < source.length;
      return {
        status: 200,
        body: {
          value: page.map(function (it) {
            return { id: it.id, eTag: it.etag, fields: JSON.parse(JSON.stringify(it.fields)) };
          }),
          '@odata.nextLink': more
            ? 'https://graph.example/sites/s/lists/' + encodeURIComponent(listName) +
              '/items?$expand=fields&$top=' + top +
              (filter ? '&$filter=' + filter : '') +
              '&$skiptoken=' + (skip + top)
            : undefined
        }
      };
    }

    if (method === 'GET' && itemId) {
      const item = list.items.find(function (x) { return x.id === itemId; });
      if (!item) return { status: 404, body: { error: { code: 'itemNotFound' } } };
      return { status: 200, body: { id: item.id, eTag: item.etag, fields: item.fields } };
    }

    if (method === 'POST' && !itemId) {
      // SharePoint picks the id. The adapter does not get a say.
      const item = {
        id: String(list.nextId++),
        etag: 'etag-' + Math.random().toString(36).slice(2, 8),
        fields: JSON.parse(JSON.stringify((body && body.fields) || {}))
      };
      list.items.push(item);
      return { status: 201, body: { id: item.id, eTag: item.etag, fields: item.fields } };
    }

    if (method === 'PATCH' && itemId) {
      const item = list.items.find(function (x) { return x.id === itemId; });
      if (!item) return { status: 404, body: { error: { code: 'itemNotFound' } } };

      const ifMatch = headers && (headers['If-Match'] || headers['if-match']);
      if (ifMatch && ifMatch !== '*' && ifMatch !== item.etag) {
        return { status: 412, body: { error: { code: 'preconditionFailed' } } };
      }

      Object.assign(item.fields, JSON.parse(JSON.stringify(body || {})));
      bumpEtag(item);
      return { status: 200, body: { id: item.id, eTag: item.etag, fields: item.fields } };
    }

    if (method === 'DELETE' && itemId) {
      const i = list.items.findIndex(function (x) { return x.id === itemId; });
      if (i < 0) return { status: 404, body: { error: { code: 'itemNotFound' } } };
      list.items.splice(i, 1);
      return { status: 204 };
    }

    return { status: 405, body: { error: { code: 'methodNotAllowed' } } };
  }

  /**
   * The fetch the adapter is given. Same shape as the real one, so swapping in
   * window.fetch changes nothing.
   */
  async function fetchLike(url, init) {
    const method = ((init && init.method) || 'GET').toUpperCase();
    const headers = (init && init.headers) || {};
    const body = init && init.body ? JSON.parse(init.body) : null;

    log.push({ method: method, url: String(url), body: body });

    if (opts.intercept) {
      const forced = opts.intercept({ method: method, url: String(url), body: body });
      if (forced) return makeResponse(forced);
    }

    // /$batch: one request carrying many, each with its own status.
    if (String(url).indexOf('/$batch') >= 0) {
      const requests = (body && body.requests) || [];
      const responses = requests.map(function (r) {
        if (opts.intercept) {
          const forced = opts.intercept({
            method: (r.method || 'GET').toUpperCase(),
            url: r.url,
            body: r.body
          });
          if (forced) {
            return { id: r.id, status: forced.status, body: forced.body, headers: forced.headers };
          }
        }
        const res = route((r.method || 'GET').toUpperCase(), r.url, r.body, r.headers);
        return { id: r.id, status: res.status, body: res.body };
      });
      return makeResponse({ status: 200, body: { responses: responses } });
    }

    return makeResponse(route(method, String(url), body, headers));
  }

  function makeResponse(res) {
    const headers = res.headers || {};
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: {
        get: function (name) {
          const k = Object.keys(headers).find(function (h) {
            return h.toLowerCase() === String(name).toLowerCase();
          });
          return k ? headers[k] : null;
        }
      },
      json: async function () { return res.body === undefined ? {} : res.body; },
      text: async function () { return JSON.stringify(res.body || ''); }
    };
  }

  return {
    fetch: fetchLike,

    /* --- test helpers, not part of Graph --- */

    /** Raw items in a list, for assertions. */
    items: function (listName) {
      return ensureList(listName).items.map(function (it) {
        return { id: it.id, etag: it.etag, fields: JSON.parse(JSON.stringify(it.fields)) };
      });
    },

    /** Add rows without going through the API. */
    seedList: function (listName, rows) {
      const list = ensureList(listName);
      rows.forEach(function (fields) {
        list.items.push({
          id: String(list.nextId++),
          etag: 'etag-' + Math.random().toString(36).slice(2, 8),
          fields: JSON.parse(JSON.stringify(fields))
        });
      });
    },

    /** Change a row behind the adapter's back, to make its ETag stale. */
    touch: function (listName, appKey, keyColumn) {
      const item = ensureList(listName).items.find(function (x) {
        return x.fields[keyColumn] === appKey;
      });
      if (item) bumpEtag(item);
      return item;
    },

    requests: function () { return log.slice(); },
    batchCount: function () {
      return log.filter(function (r) { return r.url.indexOf('/$batch') >= 0; }).length;
    },
    reset: function () { log.length = 0; }
  };
}
