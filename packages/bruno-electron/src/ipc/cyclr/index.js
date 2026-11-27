const path = require('path');
const { ipcMain, app } = require('electron');
const { getCertsAndProxyConfig } = require('../network/cert-utils');
const { makeAxiosInstance } = require('../network/axios-instance');
const { CyclrStore, webhookUrlFor } = require('./store');
const { CyclrClient } = require('./client');

const PROGRESS_THROTTLE_MS = 150;

/** HTTP via Bruno's axios factory so system proxy / custom CA preferences still apply. */
const httpRequest = async ({ method, url, headers, data }) => {
  const { proxyMode, proxyConfig, httpsAgentRequestFields, interpolationOptions } = await getCertsAndProxyConfig({
    collectionUid: null,
    collection: { promptVariables: {} },
    request: { url },
    envVars: {},
    runtimeVariables: {},
    processEnvVars: {},
    collectionPath: '',
    globalEnvironmentVariables: {}
  });
  const axiosInstance = makeAxiosInstance({ proxyMode, proxyConfig, httpsAgentRequestFields, interpolationOptions });
  const res = await axiosInstance.request({
    method,
    url,
    headers,
    data,
    validateStatus: () => true,
    timeout: 60000,
    maxRedirects: 3
  });

  let body = res.data;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // leave as text
    }
  }
  const headersPlain = typeof res.headers?.toJSON === 'function' ? res.headers.toJSON() : { ...(res.headers || {}) };
  return { status: res.status, headers: headersPlain, data: body };
};

const isSafeApiPath = (p) => typeof p === 'string' && /^\/v1\.0\/[\w\-./%]*$/.test(p) && !p.includes('..');

const ok = (data) => ({ ok: true, data });
const fail = (err) => ({ ok: false, error: err?.message || String(err) });

const registerCyclrIpc = (mainWindow) => {
  const store = new CyclrStore();
  const client = new CyclrClient({
    httpRequest,
    cacheDir: path.join(app.getPath('userData'), 'cyclr-cache')
  });

  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };

  const resolveStack = (stackId) => {
    const stack = store.getStack(stackId);
    if (!stack) throw new Error('Choose a stack first');
    return stack;
  };

  const resolvePartner = (stackId, partnerId) => {
    const stack = resolveStack(stackId);
    if (partnerId === undefined || partnerId === null || partnerId === '') throw new Error('Choose a partner first');
    const partner = store.getPartnerWithSecret(stackId, partnerId);
    if (!partner) {
      const err = new Error('No API credentials saved for this partner yet');
      err.code = 'NO_CREDENTIALS';
      throw err;
    }
    return { partner, stack };
  };

  const getConfig = () => ({
    stacks: store.getStacks().map((s) => ({ ...s, hasWebhook: !!webhookUrlFor(s) })),
    credentials: store.getPublicCredentials()
  });

  /** Throttle per-page progress events to the renderer; `done` always flushes. */
  const makeProgressSender = (requestKey) => {
    let lastSent = 0;
    let pending = null;
    let timer = null;
    const flush = () => {
      timer = null;
      if (pending) {
        send('main:cyclr-list-progress', { requestKey, ...pending });
        pending = null;
        lastSent = Date.now();
      }
    };
    const onProgress = (progress) => {
      pending = progress;
      if (progress.done) {
        if (timer) clearTimeout(timer);
        return flush();
      }
      const wait = PROGRESS_THROTTLE_MS - (Date.now() - lastSent);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    };
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    return {
      onProgress,
      cancel,
      onRefreshed: (entry) => {
        cancel();
        send('main:cyclr-list-progress', { requestKey, ...entry, done: true, refreshed: true });
      },
      onRefreshError: (err) => send('main:cyclr-list-progress', { requestKey, error: err.message, done: true })
    };
  };

  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return ok(await fn(...args));
      } catch (err) {
        return { ...fail(err), code: err.code };
      }
    });
  };

  handle('cyclr:get-config', () => getConfig());

  handle('cyclr:save-stack', (stack) => store.saveStack(stack));

  handle('cyclr:delete-stack', (id) => {
    store.deleteStack(id);
    return true;
  });

  handle('cyclr:save-partner-credentials', (cred) => {
    const saved = store.savePartnerCredentials(cred);
    // Credentials may have changed: drop any token minted with the old ones.
    const { partner, stack } = resolvePartner(saved.stackId, saved.partnerId);
    client.invalidateToken(stack, partner);
    return saved;
  });

  handle('cyclr:delete-partner-credentials', ({ stackId, partnerId }) => {
    store.deletePartnerCredentials(stackId, partnerId);
    return true;
  });

  handle('cyclr:test-partner', async ({ stackId, partnerId }) => {
    const { partner, stack } = resolvePartner(stackId, partnerId);
    await client.getToken(stack, partner, { force: true });
    return true;
  });

  handle('cyclr:get-context', (collectionPath) => store.getContext(collectionPath));

  handle('cyclr:set-context', (collectionPath, context) => {
    store.setContext(collectionPath, context);
    return true;
  });

  handle('cyclr:get-token', async ({ stackId, partnerId, force } = {}) => {
    const { partner, stack } = resolvePartner(stackId, partnerId);
    const { token, expiresAt } = await client.getToken(stack, partner, { force: !!force });
    return { token, expiresAt, baseUrl: stack.baseUrl };
  });

  handle('cyclr:clear-cache', async () => {
    await client.clearCache();
    return true;
  });

  /** The stack's partners via its admin webhook. */
  handle('cyclr:list-partners', async ({ stackId, spec, requestKey, force } = {}) => {
    const stack = resolveStack(stackId);
    const url = webhookUrlFor(stack);
    if (!url) throw new Error(`No admin webhook set for the ${stack.name} stack`);
    const progress = makeProgressSender(requestKey);
    try {
      return await client.listPartners(stack, url, spec, { force: !!force, ...progress });
    } finally {
      progress.cancel();
    }
  });

  /**
   * List items for a picker. `requestKey` identifies the list in progress events
   * (`main:cyclr-list-progress`) so the renderer can render pages as they arrive.
   */
  handle('cyclr:list', async ({ stackId, partnerId, spec, requestKey, force } = {}) => {
    if (!spec || !isSafeApiPath(spec.path)) throw new Error('Invalid list request');
    const { partner, stack } = resolvePartner(stackId, partnerId);
    const progress = makeProgressSender(requestKey);
    try {
      return await client.list(stack, partner, spec, { force: !!force, ...progress });
    } finally {
      progress.cancel();
    }
  });
};

module.exports = registerCyclrIpc;
