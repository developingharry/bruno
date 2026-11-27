const fs = require('fs');
const os = require('os');
const path = require('path');
const { CyclrClient, normalizeItems, fetchAllPages, PAGE_SIZE } = require('./client');

const stack = { id: 'us', baseUrl: 'https://api.example.test' };
const partner = { id: 'p1', name: 'Acme', clientId: 'cid', clientSecret: 'secret' };

const makeRows = (from, count) => Array.from({ length: count }, (_, i) => ({ Id: `id-${from + i}`, Name: `Item ${from + i}` }));

describe('normalizeItems', () => {
  it('maps id/label/sub/meta using dotted paths and drops rows without an id', () => {
    const spec = {
      idField: 'Field.Id',
      labelFields: ['Field.Name'],
      subFields: ['MappingType', 'Missing'],
      metaFields: { connectorId: 'Connector.Id' }
    };
    const rows = [
      { Field: { Id: 7, Name: 'Email' }, MappingType: 'StepOutput', Connector: { Id: 99 } },
      { Field: { Name: 'no id' } }
    ];
    expect(normalizeItems(rows, spec)).toEqual([
      { id: '7', label: 'Email', sub: 'StepOutput', meta: { connectorId: 99 } }
    ]);
  });

  it('falls back to the id as label and dedupes when asked', () => {
    const spec = { idField: 'Name', labelFields: ['Title'], dedupe: true };
    const items = normalizeItems([{ Name: 'Hubspot' }, { Name: 'Hubspot' }, { Name: 'Slack' }], spec);
    expect(items.map((i) => i.label)).toEqual(['Hubspot', 'Slack']);
  });
});

describe('fetchAllPages', () => {
  it('uses Total-Pages to fetch remaining pages in parallel, keeping page order', async () => {
    const total = PAGE_SIZE * 3 + 5;
    const getPage = jest.fn(async (page, size) => ({
      status: 200,
      headers: { 'total-pages': '4', 'total-records': String(total) },
      data: makeRows((page - 1) * size, page === 4 ? 5 : size)
    }));
    const progress = [];
    const result = await fetchAllPages(getPage, { paged: true }, (p) => progress.push(p.loaded));

    expect(getPage).toHaveBeenCalledTimes(4);
    expect(result.rows).toHaveLength(total);
    expect(result.rows[0].Id).toBe('id-0');
    expect(result.rows[total - 1].Id).toBe(`id-${total - 1}`);
    expect(result.truncated).toBe(false);
    expect(progress[0]).toBe(PAGE_SIZE);
  });

  it('walks pages sequentially when there are no paging headers', async () => {
    const getPage = jest.fn(async (page, size) => ({
      status: 200,
      headers: {},
      data: page < 3 ? makeRows((page - 1) * size, size) : makeRows((page - 1) * size, 3)
    }));
    const result = await fetchAllPages(getPage, { paged: true });
    expect(getPage).toHaveBeenCalledTimes(3);
    expect(result.rows).toHaveLength(PAGE_SIZE * 2 + 3);
  });

  it('stops at maxItems and reports truncation', async () => {
    const getPage = jest.fn(async (page, size) => ({
      status: 200,
      headers: { 'Total-Pages': '100', 'Total-Records': '5000' },
      data: makeRows((page - 1) * size, size)
    }));
    const result = await fetchAllPages(getPage, { paged: true, maxItems: 120 });
    expect(getPage).toHaveBeenCalledTimes(3);
    expect(result.rows).toHaveLength(120);
    expect(result.truncated).toBe(true);
  });

  it('retries the first page with a smaller page size on HTTP 400', async () => {
    const getPage = jest.fn(async (page, size) =>
      size === PAGE_SIZE ? { status: 400, data: { Message: 'pageSize too large' } } : { status: 200, headers: {}, data: makeRows(0, 2) }
    );
    const result = await fetchAllPages(getPage, { paged: true });
    expect(result.rows).toHaveLength(2);
    expect(getPage).toHaveBeenLastCalledWith(1, 10);
  });

  it('throws a readable error on failure', async () => {
    const getPage = async () => ({ status: 403, data: { Message: 'Forbidden for account' } });
    await expect(fetchAllPages(getPage, { paged: true })).rejects.toThrow('HTTP 403: Forbidden for account');
  });
});

describe('CyclrClient', () => {
  let cacheDir;
  let now;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyclr-cache-'));
    now = 1_000_000;
  });

  afterEach(async () => {
    // let fire-and-forget cache writes finish before removing the directory
    await new Promise((r) => setTimeout(r, 50));
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  const makeHttp = (handlers = {}) =>
    jest.fn(async (req) => {
      if (req.url.endsWith('/oauth/token')) {
        return handlers.token ? handlers.token(req) : { status: 200, data: { access_token: 'tok-1', expires_in: 3600 } };
      }
      return handlers.api(req);
    });

  const spec = { path: '/v1.0/Cycles', accountId: 'acc-1', paged: false, idField: 'Id', labelFields: ['Name'], ttl: 60 };

  it('reuses a token until it nears expiry', async () => {
    const http = makeHttp({ api: async () => ({ status: 200, data: [] }) });
    const client = new CyclrClient({ httpRequest: http, now: () => now });
    await client.getToken(stack, partner);
    await client.getToken(stack, partner);
    expect(http).toHaveBeenCalledTimes(1);

    now += 3600 * 1000;
    await client.getToken(stack, partner);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('sends the account header and retries once with a fresh token on 401', async () => {
    let calls = 0;
    const http = makeHttp({
      api: async (req) => {
        calls += 1;
        expect(req.headers['X-Cyclr-Account']).toBe('acc-1');
        return calls === 1 ? { status: 401, data: {} } : { status: 200, data: makeRows(0, 2) };
      }
    });
    const client = new CyclrClient({ httpRequest: http, now: () => now });
    const result = await client.list(stack, partner, spec);
    expect(result.items).toHaveLength(2);
    expect(calls).toBe(2);
  });

  it('serves fresh cache without calling the API, and refreshes stale cache in the background', async () => {
    let version = 0;
    const http = makeHttp({ api: async () => ({ status: 200, data: makeRows(0, ++version) }) });
    const client = new CyclrClient({ httpRequest: http, cacheDir, now: () => now });

    const first = await client.list(stack, partner, spec);
    expect(first.fromCache).toBe(false);
    expect(first.items).toHaveLength(1);

    const second = await client.list(stack, partner, spec);
    expect(second.fromCache).toBe(true);
    expect(second.stale).toBe(false);

    now += 61 * 1000;
    const refreshed = new Promise((resolve) => {
      client.list(stack, partner, spec, { onRefreshed: resolve }).then((third) => {
        expect(third.fromCache).toBe(true);
        expect(third.stale).toBe(true);
        expect(third.items).toHaveLength(1);
      });
    });
    const entry = await refreshed;
    expect(entry.items).toHaveLength(2);
  });

  it('loads from the disk cache in a new client instance', async () => {
    const http = makeHttp({ api: async () => ({ status: 200, data: makeRows(0, 3) }) });
    const a = new CyclrClient({ httpRequest: http, cacheDir, now: () => now });
    await a.list(stack, partner, spec);
    // let the fire-and-forget disk write land
    await new Promise((r) => setTimeout(r, 50));

    const http2 = makeHttp({ api: async () => { throw new Error('should not be called'); } });
    const b = new CyclrClient({ httpRequest: http2, cacheDir, now: () => now });
    const result = await b.list(stack, partner, spec);
    expect(result.fromCache).toBe(true);
    expect(result.items).toHaveLength(3);
  });

  it('dedupes concurrent requests for the same list', async () => {
    const http = makeHttp({ api: async () => ({ status: 200, data: makeRows(0, 1) }) });
    const client = new CyclrClient({ httpRequest: http, now: () => now });
    await Promise.all([client.list(stack, partner, spec), client.list(stack, partner, spec)]);
    const apiCalls = http.mock.calls.filter(([req]) => !req.url.endsWith('/oauth/token'));
    expect(apiCalls).toHaveLength(1);
  });

  describe('listPartners', () => {
    const ukStack = { id: 'uk', name: 'UK', baseUrl: 'https://api.cyclr.uk' };
    const pspec = { idField: 'Id', labelFields: ['Name'], subFields: [], ttl: 60 };
    const url = 'https://admin.example.test/api/webhook/abc';

    it('POSTs listpartners to the webhook and normalises the result', async () => {
      const http = jest.fn(async () => ({ status: 200, data: [{ Id: 316, Name: 'Acme' }, { Id: 317, Name: 'Beta' }] }));
      const client = new CyclrClient({ httpRequest: http, now: () => now });
      const result = await client.listPartners(ukStack, url, pspec);
      expect(http).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', url, data: JSON.stringify({ requesttype: 'listpartners' }) }));
      expect(result.items).toEqual([
        { id: '316', label: 'Acme', sub: '', meta: {} },
        { id: '317', label: 'Beta', sub: '', meta: {} }
      ]);
    });

    it('explains an empty 200 (the IP filter)', async () => {
      const http = jest.fn(async () => ({ status: 200, data: '' }));
      const client = new CyclrClient({ httpRequest: http, now: () => now });
      await expect(client.listPartners(ukStack, url, pspec)).rejects.toThrow(/IP-restricted/);
    });
  });

  it('refuses to mint a token for a stack without a base URL', async () => {
    const client = new CyclrClient({ httpRequest: jest.fn(), now: () => now });
    await expect(client.getToken({ id: 'us2', name: 'US2', baseUrl: '' }, partner)).rejects.toThrow(/base URL for the US2 stack/);
  });
});
