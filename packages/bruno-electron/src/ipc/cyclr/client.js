const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Cyclr API transport for the dropdown pickers: OAuth tokens, fetching every page
 * of a list endpoint, normalising rows to { id, label, sub, meta } and caching.
 *
 * The HTTP function is injected (`httpRequest`) so this module can be unit tested
 * without Electron. See ./index.js for the real wiring.
 */

const PAGE_SIZE = 50;
const FALLBACK_PAGE_SIZE = 10;
const PAGE_CONCURRENCY = 4;
const HARD_MAX_ITEMS = 20000; // safety net against runaway pagination
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
const MAX_DISK_CACHE_FILES = 500;

const getByPath = (obj, p) => String(p).split('.').reduce((acc, k) => (acc === null || acc === undefined ? undefined : acc[k]), obj);

const isBlank = (v) => v === undefined || v === null || v === '';

const firstValue = (raw, fields = []) => {
  for (const f of fields) {
    const v = getByPath(raw, f);
    if (!isBlank(v)) return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return '';
};

/** Turn raw API rows into compact picker items. Rows without an id are dropped. */
const normalizeItems = (rows, spec) => {
  const out = [];
  const seen = new Set();
  for (const raw of rows || []) {
    const idValue = getByPath(raw, spec.idField);
    if (isBlank(idValue)) continue;
    const id = String(idValue);
    if (spec.dedupe && seen.has(id)) continue;
    seen.add(id);

    const sub = (spec.subFields || [])
      .map((f) => getByPath(raw, f))
      .filter((v) => !isBlank(v) && typeof v !== 'object')
      .map(String)
      .join(' · ');

    const meta = {};
    for (const [key, field] of Object.entries(spec.metaFields || {})) {
      const v = getByPath(raw, field);
      if (!isBlank(v)) meta[key] = v;
    }

    out.push({ id, label: firstValue(raw, spec.labelFields) || id, sub, meta });
  }
  return out;
};

const extractRows = (data) => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['Items', 'items', 'Data', 'data', 'Results', 'results']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
};

const headerInt = (headers, name) => {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const n = key ? parseInt(headers[key], 10) : NaN;
  return Number.isFinite(n) ? n : null;
};

const describeHttpError = (res) => {
  const data = res?.data;
  const detail = data && typeof data === 'object' ? data.Message || data.message || data.error_description || data.error : null;
  return `HTTP ${res?.status}${detail ? `: ${detail}` : ''}`;
};

/** Run `tasks` (functions returning promises) with at most `limit` in flight. */
const runPool = async (tasks, limit) => {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
};

/**
 * Fetch every page of a list endpoint.
 *
 * Cyclr list endpoints take `page` / `pageSize` and usually return `Total-Pages`
 * and `Total-Records` headers. When the headers are present the remaining pages are
 * fetched in parallel; otherwise we keep going until a short page comes back.
 *
 * @param {(page, pageSize) => Promise<{status, headers, data}>} getPage
 * @param {{ paged: boolean, maxItems?: number }} spec
 * @param {(snapshot) => void} onProgress  called with rows so far, in page order
 */
const fetchAllPages = async (getPage, spec, onProgress = () => {}) => {
  if (!spec.paged) {
    const res = await getPage(null, null);
    const rows = extractRows(res.data);
    onProgress({ rows, loaded: rows.length, total: rows.length, done: true });
    return { rows, truncated: false, total: rows.length };
  }

  const cap = Math.min(spec.maxItems || HARD_MAX_ITEMS, HARD_MAX_ITEMS);

  let pageSize = PAGE_SIZE;
  let first = await getPage(1, pageSize);
  if (first.status === 400) {
    // Some stacks cap pageSize lower; retry with a conservative size.
    pageSize = FALLBACK_PAGE_SIZE;
    first = await getPage(1, pageSize);
  }
  if (first.status < 200 || first.status >= 300) {
    throw new Error(describeHttpError(first));
  }

  const pages = [extractRows(first.data)];
  const totalPages = headerInt(first.headers, 'total-pages');
  const totalRecords = headerInt(first.headers, 'total-records');
  const maxPages = Math.ceil(cap / pageSize);
  const flatten = () => pages.flat();

  onProgress({ rows: flatten(), loaded: pages[0].length, total: totalRecords, done: false });

  if (totalPages !== null) {
    const lastPage = Math.min(totalPages, maxPages);
    const tasks = [];
    for (let p = 2; p <= lastPage; p++) {
      tasks.push(async () => {
        const res = await getPage(p, pageSize);
        if (res.status < 200 || res.status >= 300) throw new Error(describeHttpError(res));
        pages[p - 1] = extractRows(res.data);
        const rows = flatten();
        onProgress({ rows, loaded: rows.length, total: totalRecords, done: false });
      });
    }
    await runPool(tasks, PAGE_CONCURRENCY);
    const rows = flatten().slice(0, cap);
    const truncated = totalPages > lastPage || (totalRecords !== null && totalRecords > rows.length);
    return { rows, truncated, total: totalRecords ?? rows.length };
  }

  // No paging headers: walk sequentially until we get a short (or empty) page.
  let page = 1;
  while (pages[page - 1].length >= pageSize && page < maxPages) {
    page += 1;
    const res = await getPage(page, pageSize);
    if (res.status < 200 || res.status >= 300) throw new Error(describeHttpError(res));
    const rows = extractRows(res.data);
    pages.push(rows);
    onProgress({ rows: flatten(), loaded: flatten().length, total: null, done: false });
    if (rows.length === 0) break;
  }
  const rows = flatten().slice(0, cap);
  const truncated = page >= maxPages && pages[page - 1].length >= pageSize;
  return { rows, truncated, total: truncated ? null : rows.length };
};

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

class CyclrClient {
  /**
   * @param {object} opts
   * @param {(req) => Promise<{status, headers, data}>} opts.httpRequest
   * @param {string} [opts.cacheDir] directory for the on-disk list cache
   * @param {() => number} [opts.now]
   */
  constructor({ httpRequest, cacheDir, now = () => Date.now() }) {
    this.httpRequest = httpRequest;
    this.cacheDir = cacheDir;
    this.now = now;
    this.tokens = new Map(); // partnerKey -> { token, expiresAt }
    this.tokenRequests = new Map(); // partnerKey -> Promise
    this.memoryCache = new Map(); // cacheKey -> entry
    this.inflight = new Map(); // cacheKey -> Promise
  }

  partnerKey(stack, partner) {
    return `${stack.baseUrl}|${partner.clientId}`;
  }

  // ---- tokens -------------------------------------------------------------

  async getToken(stack, partner, { force = false } = {}) {
    if (!stack.baseUrl) {
      throw new Error(`Set the API base URL for the ${stack.name} stack in Cyclr settings first`);
    }
    const key = this.partnerKey(stack, partner);
    const cached = this.tokens.get(key);
    if (!force && cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.now()) {
      return cached;
    }
    if (this.tokenRequests.has(key)) return this.tokenRequests.get(key);

    const promise = (async () => {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: partner.clientId,
        client_secret: partner.clientSecret
      }).toString();
      const res = await this.httpRequest({
        method: 'POST',
        url: `${stack.baseUrl}/oauth/token`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        data: body
      });
      if (res.status < 200 || res.status >= 300 || !res.data?.access_token) {
        throw new Error(`Could not get a token for ${partner.name || partner.clientId} (${describeHttpError(res)})`);
      }
      const expiresIn = Number(res.data.expires_in) || 3600;
      const entry = { token: res.data.access_token, expiresAt: this.now() + expiresIn * 1000 };
      this.tokens.set(key, entry);
      return entry;
    })();

    this.tokenRequests.set(key, promise);
    try {
      return await promise;
    } finally {
      this.tokenRequests.delete(key);
    }
  }

  invalidateToken(stack, partner) {
    this.tokens.delete(this.partnerKey(stack, partner));
  }

  // ---- raw GET with token & one retry on 401 -------------------------------

  async apiGet(stack, partner, apiPath, { accountId, query } = {}) {
    const doRequest = async (token) => {
      const url = new URL(stack.baseUrl + apiPath);
      for (const [k, v] of Object.entries(query || {})) {
        if (!isBlank(v)) url.searchParams.set(k, String(v));
      }
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      if (accountId) headers['X-Cyclr-Account'] = accountId;
      return this.httpRequest({ method: 'GET', url: url.toString(), headers });
    };

    let { token } = await this.getToken(stack, partner);
    let res = await doRequest(token);
    if (res.status === 401) {
      ({ token } = await this.getToken(stack, partner, { force: true }));
      res = await doRequest(token);
    }
    return res;
  }

  // ---- list with cache ----------------------------------------------------

  cacheKey(stack, partner, spec) {
    return sha1(JSON.stringify([stack.baseUrl, partner.clientId, spec.accountId || '', spec.path, spec.idField, spec.maxItems || 0]));
  }

  async readDiskCache(key) {
    if (!this.cacheDir) return null;
    try {
      const raw = await fs.promises.readFile(path.join(this.cacheDir, `${key}.json`), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async writeDiskCache(key, entry) {
    if (!this.cacheDir) return;
    try {
      await fs.promises.mkdir(this.cacheDir, { recursive: true });
      await fs.promises.writeFile(path.join(this.cacheDir, `${key}.json`), JSON.stringify(entry), 'utf8');
      await this.pruneDiskCache();
    } catch (err) {
      console.warn('[cyclr] failed to write list cache:', err.message);
    }
  }

  async pruneDiskCache() {
    const files = (await fs.promises.readdir(this.cacheDir)).filter((f) => f.endsWith('.json'));
    if (files.length <= MAX_DISK_CACHE_FILES) return;
    const stats = await Promise.all(
      files.map(async (f) => ({ f, mtime: (await fs.promises.stat(path.join(this.cacheDir, f))).mtimeMs }))
    );
    stats.sort((a, b) => a.mtime - b.mtime);
    await Promise.all(stats.slice(0, files.length - MAX_DISK_CACHE_FILES).map(({ f }) => fs.promises.unlink(path.join(this.cacheDir, f))));
  }

  async clearCache() {
    this.memoryCache.clear();
    if (!this.cacheDir) return;
    try {
      const files = await fs.promises.readdir(this.cacheDir);
      await Promise.all(files.filter((f) => f.endsWith('.json')).map((f) => fs.promises.unlink(path.join(this.cacheDir, f))));
    } catch {
      // nothing cached yet
    }
  }

  /**
   * Run `fetchRows(onProgress)` once per key at a time, normalise and cache the result.
   * `fetchRows` resolves to `{ rows, truncated, total }`.
   */
  async fetchAndCache(key, spec, fetchRows, onProgress) {
    if (this.inflight.has(key)) return this.inflight.get(key);

    const promise = (async () => {
      const { rows, truncated, total } = await fetchRows(({ rows: partial, loaded, total: t, done }) => {
        onProgress({ items: normalizeItems(partial, spec), loaded, total: t, done });
      });

      const entry = {
        items: normalizeItems(rows, spec),
        fetchedAt: this.now(),
        truncated: !!truncated,
        total
      };
      this.memoryCache.set(key, entry);
      this.writeDiskCache(key, entry);
      return entry;
    })();

    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Cache-aware loader shared by every list:
   *  - fresh cache  -> returned immediately
   *  - stale cache  -> returned immediately, refreshed in the background (onRefreshed fires)
   *  - no cache     -> fetched now, onProgress fires as pages arrive
   */
  async cachedList(key, spec, fetchRows, { force = false, onProgress = () => {}, onRefreshed = () => {}, onRefreshError = () => {} } = {}) {
    const ttlMs = (spec.ttl || 300) * 1000;

    if (!force) {
      let cached = this.memoryCache.get(key);
      if (!cached) {
        cached = await this.readDiskCache(key);
        if (cached) this.memoryCache.set(key, cached);
      }
      if (cached) {
        const stale = this.now() - cached.fetchedAt > ttlMs;
        if (stale) {
          // No per-page progress here: the caller already shows the full cached list, and
          // streaming page 1 of the refresh would make it shrink then grow again.
          this.fetchAndCache(key, spec, fetchRows, () => {}).then(onRefreshed, onRefreshError);
        }
        return { ...cached, fromCache: true, stale };
      }
    }

    const entry = await this.fetchAndCache(key, spec, fetchRows, onProgress);
    return { ...entry, fromCache: false, stale: false };
  }

  /** A partner-API list endpoint (accounts, cycles, steps ...), all pages. */
  async list(stack, partner, spec, opts = {}) {
    const key = this.cacheKey(stack, partner, spec);
    const fetchRows = (onProgress) => {
      const getPage = (page, pageSize) =>
        this.apiGet(stack, partner, spec.path, {
          accountId: spec.accountId,
          query: page ? { page, pageSize } : undefined
        }).then((res) => {
          if (!page && (res.status < 200 || res.status >= 300)) throw new Error(describeHttpError(res));
          return res;
        });
      return fetchAllPages(getPage, spec, onProgress);
    };
    return this.cachedList(key, spec, fetchRows, opts);
  }

  /** The stack's partners, from the admin webhook (`{"requesttype":"listpartners"}`). */
  async listPartners(stack, webhookUrl, spec, opts = {}) {
    const key = sha1(JSON.stringify(['partners', stack.id, webhookUrl]));
    const fetchRows = async (onProgress) => {
      const res = await this.httpRequest({
        method: 'POST',
        url: webhookUrl,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        data: JSON.stringify({ requesttype: 'listpartners' })
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Admin webhook for ${stack.name} failed (${describeHttpError(res)})`);
      }
      if (!Array.isArray(res.data) && !(res.data && typeof res.data === 'object')) {
        // An empty 200 is what the IP filter returns.
        throw new Error(`The admin webhook for ${stack.name} returned no partner list. It is IP-restricted: are you on the office network or VPN?`);
      }
      const rows = extractRows(res.data);
      onProgress({ rows, loaded: rows.length, total: rows.length, done: true });
      return { rows, truncated: false, total: rows.length };
    };
    return this.cachedList(key, spec, fetchRows, opts);
  }
}

module.exports = {
  CyclrClient,
  normalizeItems,
  fetchAllPages,
  extractRows,
  PAGE_SIZE,
  FALLBACK_PAGE_SIZE
};
