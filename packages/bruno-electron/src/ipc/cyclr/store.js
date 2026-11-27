const Store = require('electron-store');
const { encryptStringSafe, decryptStringSafe } = require('../../utils/encryption');

/**
 * Persistent Cyclr configuration:
 *  - stacks:             [{ id, name, baseUrl, webhookId }] - one per Cyclr stack.
 *                        `webhookId` points at the admin webhook that lists the stack's partners.
 *  - partnerCredentials: { "<stackId>:<partnerId>": { stackId, partnerId, partnerName, clientId, clientSecret (encrypted) } }
 *  - contexts:           { [collectionPath]: { stackId, selections } }
 *
 * Client secrets are encrypted with the OS keychain via Electron safeStorage
 * (falls back to AES with a machine-derived key, same as Bruno's env secrets).
 */

// Not in the store defaults: electron-store writes defaults into an existing file before
// migrate() runs, which would mark an old file as current and skip the migration.
const SCHEMA_VERSION = 3;

const ADMIN_WEBHOOK_BASE = 'https://cyclrsalesintegrations-h.cyclr.uk/api/webhook/';

// The admin webhook is IP-restricted, so these ids alone don't grant access.
const DEFAULT_STACKS = [
  { id: 'uk', name: 'UK', baseUrl: 'https://api.cyclr.uk', webhookId: 'nWHjlB' },
  { id: 'eu', name: 'EU', baseUrl: 'https://api.eu.cyclr.com', webhookId: 'CRhh4j' },
  { id: 'us', name: 'US', baseUrl: 'https://api.cyclr.com', webhookId: 'kPey4t' },
  { id: 'us2', name: 'US2', baseUrl: 'https://api.us2.cyclr.com', webhookId: '0wt9vi' }
];

const posixifyPath = (p) => (p ? p.replace(/\\/g, '/') : p);
const credKey = (stackId, partnerId) => `${stackId}:${partnerId}`;

const normaliseBaseUrl = (url) => {
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const parsed = new URL(trimmed); // throws on invalid input
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('Base URL must start with http:// or https://');
  }
  return trimmed;
};

/** A webhook id, or a full webhook URL for stacks that use a different admin host. */
const webhookUrlFor = (stack) => {
  const id = String(stack?.webhookId || '').trim();
  if (!id) return null;
  if (/^https?:\/\//i.test(id)) return id;
  return ADMIN_WEBHOOK_BASE + encodeURIComponent(id);
};

class CyclrStore {
  constructor() {
    this.store = new Store({
      name: 'cyclr',
      clearInvalidConfig: true,
      defaults: { stacks: DEFAULT_STACKS, partnerCredentials: {}, contexts: {} }
    });
    this.migrate();
    this.fillBlankDefaults();
  }

  /** Default stacks pick up base URLs / webhook ids added to DEFAULT_STACKS after they were saved. */
  fillBlankDefaults() {
    let changed = false;
    const stacks = this.getStacks().map((s) => {
      const d = DEFAULT_STACKS.find((x) => x.id === s.id);
      if (!d) return s;
      const next = { ...s, baseUrl: s.baseUrl || d.baseUrl, webhookId: s.webhookId || d.webhookId };
      if (next.baseUrl !== s.baseUrl || next.webhookId !== s.webhookId) changed = true;
      return next;
    });
    if (changed) this.store.set('stacks', stacks);
  }

  migrate() {
    const version = this.store.get('schemaVersion') || 1;
    if (version >= SCHEMA_VERSION) return;
    // Older files had manually entered partners, AU instead of US2, and no admin webhook ids:
    // adopt the default stacks, keeping any base URL or webhook id the user had customised.
    const existing = this.store.get('stacks') || [];
    const stacks = DEFAULT_STACKS.map((d) => {
      const prev = existing.find((s) => s.id === d.id);
      return prev ? { ...d, baseUrl: prev.baseUrl || d.baseUrl, webhookId: prev.webhookId || d.webhookId } : d;
    });
    for (const s of existing) {
      if (!stacks.some((x) => x.id === s.id) && s.id !== 'au') stacks.push({ webhookId: '', ...s });
    }
    this.store.set('stacks', stacks);
    if (this.store.has('partners')) {
      // v1 contexts point at manual partner ids that no longer exist.
      this.store.delete('partners');
      this.store.set('contexts', {});
    }
    this.store.set('schemaVersion', SCHEMA_VERSION);
  }

  // ---- stacks -------------------------------------------------------------

  getStacks() {
    return this.store.get('stacks') || [];
  }

  getStack(id) {
    return this.getStacks().find((s) => s.id === id) || null;
  }

  saveStack({ id, name, baseUrl, webhookId }) {
    if (!name || !String(name).trim()) throw new Error('Stack name is required');
    const stacks = this.getStacks();
    const stackId = id || String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!id && stacks.some((s) => s.id === stackId)) throw new Error(`A stack called ${name} already exists`);

    const stack = {
      id: stackId,
      name: String(name).trim(),
      baseUrl: normaliseBaseUrl(baseUrl),
      webhookId: String(webhookId || '').trim()
    };
    const idx = stacks.findIndex((s) => s.id === stackId);
    if (idx >= 0) stacks[idx] = stack;
    else stacks.push(stack);
    this.store.set('stacks', stacks);
    return stack;
  }

  deleteStack(id) {
    this.store.set('stacks', this.getStacks().filter((s) => s.id !== id));
    const creds = this.store.get('partnerCredentials') || {};
    for (const key of Object.keys(creds)) if (creds[key].stackId === id) delete creds[key];
    this.store.set('partnerCredentials', creds);
  }

  // ---- partner API credentials --------------------------------------------

  /** Credentials without secrets, safe to send to the renderer. */
  getPublicCredentials() {
    return Object.values(this.store.get('partnerCredentials') || {}).map(({ clientSecret, ...rest }) => ({
      ...rest,
      hasSecret: !!clientSecret
    }));
  }

  /** `{ id, name, clientId, clientSecret }` for the token request, or null if none saved. */
  getPartnerWithSecret(stackId, partnerId) {
    const cred = (this.store.get('partnerCredentials') || {})[credKey(stackId, partnerId)];
    if (!cred) return null;
    const decrypted = cred.clientSecret ? decryptStringSafe(cred.clientSecret) : { value: '' };
    return { id: String(partnerId), name: cred.partnerName, clientId: cred.clientId, clientSecret: decrypted.value || '' };
  }

  savePartnerCredentials({ stackId, partnerId, partnerName, clientId, clientSecret }) {
    if (!this.getStack(stackId)) throw new Error('Unknown stack');
    if (partnerId === undefined || partnerId === null || partnerId === '') throw new Error('Choose a partner');
    if (!clientId || !String(clientId).trim()) throw new Error('Client ID is required');

    const all = this.store.get('partnerCredentials') || {};
    const key = credKey(stackId, partnerId);
    const existing = all[key];

    let encryptedSecret = existing?.clientSecret || '';
    if (clientSecret) {
      const result = encryptStringSafe(String(clientSecret));
      if (!result.success) throw new Error('Could not encrypt the client secret');
      encryptedSecret = result.value;
    }
    if (!encryptedSecret) throw new Error('Client secret is required');

    all[key] = {
      stackId,
      partnerId: String(partnerId),
      partnerName: partnerName || existing?.partnerName || String(partnerId),
      clientId: String(clientId).trim(),
      clientSecret: encryptedSecret
    };
    this.store.set('partnerCredentials', all);
    const { stackId: sId, partnerId: pId, partnerName: pName, clientId: cId } = all[key];
    return { stackId: sId, partnerId: pId, partnerName: pName, clientId: cId, hasSecret: true };
  }

  deletePartnerCredentials(stackId, partnerId) {
    const all = this.store.get('partnerCredentials') || {};
    delete all[credKey(stackId, partnerId)];
    this.store.set('partnerCredentials', all);
  }

  // ---- per-collection context --------------------------------------------

  getContext(collectionPath) {
    const contexts = this.store.get('contexts') || {};
    return contexts[posixifyPath(collectionPath)] || null;
  }

  setContext(collectionPath, context) {
    const contexts = this.store.get('contexts') || {};
    contexts[posixifyPath(collectionPath)] = {
      stackId: context?.stackId || null,
      selections: context?.selections || {}
    };
    this.store.set('contexts', contexts);
  }
}

module.exports = { CyclrStore, DEFAULT_STACKS, ADMIN_WEBHOOK_BASE, normaliseBaseUrl, webhookUrlFor };
