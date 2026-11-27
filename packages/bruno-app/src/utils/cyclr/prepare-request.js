import {
  ENTITIES,
  VAR_TO_ENTITY,
  CYCLR_BASE_URL_VAR,
  CYCLR_TOKEN_VAR,
  CYCLR_ACCOUNT_HEADER,
  isCyclrCollection,
  selectionsToVariables
} from './registry';

const VAR_RE = /\{\{\s*(cyclr_\w+)\s*\}\}/g;

const getRequest = (item) => (item?.draft ? item.draft.request : item?.request);

const collectStrings = (request, includeHeaders) => {
  const out = [request?.url || ''];
  for (const p of request?.params || []) {
    if (p.enabled !== false) out.push(p.value || '');
  }
  if (includeHeaders) {
    for (const h of request?.headers || []) {
      if (h.enabled !== false) out.push(h.value || '');
    }
  }
  return out;
};

/**
 * Entities referenced by `{{cyclr_*}}` variables in a request's URL and params
 * (and headers, when asked).
 */
export const getReferencedEntities = (item, { includeHeaders = false } = {}) => {
  const found = new Set();
  for (const str of collectStrings(getRequest(item), includeHeaders)) {
    for (const m of String(str).matchAll(VAR_RE)) {
      const key = VAR_TO_ENTITY[m[1]];
      if (key) found.add(key);
    }
  }
  return [...found];
};

/** Disable `X-Cyclr-Account: {{cyclr_accountId}}` headers when no account is selected. */
const stripEmptyAccountHeader = (item) => {
  for (const req of [item?.request, item?.draft?.request]) {
    for (const h of req?.headers || []) {
      if (h.name?.toLowerCase() === CYCLR_ACCOUNT_HEADER.toLowerCase() && /\{\{\s*cyclr_accountId\s*\}\}/.test(h.value || '')) {
        h.enabled = false;
      }
    }
  }
  for (const child of item?.items || []) stripEmptyAccountHeader(child);
};

/**
 * Inject the Cyclr context (base URL, fresh OAuth token, selected ids) into a cloned
 * collection just before it is sent. No-op for non-Cyclr collections.
 *
 * @param {object} args
 * @param {object} args.state            redux state
 * @param {object} args.collectionCopy   deep-cloned collection (mutated)
 * @param {object} [args.itemCopy]       deep-cloned request being sent (mutated); omit for runner
 * @param {boolean} [args.validate=true] fail if the request uses a variable that isn't selected yet
 */
export const applyCyclrContext = async ({ state, collectionCopy, itemCopy, validate = true }) => {
  if (!isCyclrCollection(collectionCopy)) return;

  const ctx = state.cyclr?.contexts?.[collectionCopy.uid];
  const partnerId = ctx?.selections?.partner?.id;
  if (!ctx?.stackId || !partnerId) {
    throw new Error('Choose a Cyclr stack and partner in the bar above the URL before sending.');
  }

  if (itemCopy && validate) {
    const missing = getReferencedEntities(itemCopy).filter((key) => !ctx.selections?.[key]?.id);
    if (missing.length) {
      throw new Error(`Select ${missing.map((k) => ENTITIES[k].label).join(', ')} first - this request needs it.`);
    }
  }

  const res = await window.ipcRenderer.invoke('cyclr:get-token', { stackId: ctx.stackId, partnerId });
  if (!res?.ok) {
    if (res?.code === 'NO_CREDENTIALS') {
      throw new Error(`Add API credentials for ${ctx.selections.partner.label || 'this partner'} first (click the key icon next to the partner).`);
    }
    throw new Error(res?.error || 'Could not get a Cyclr access token');
  }

  collectionCopy.runtimeVariables = {
    ...(collectionCopy.runtimeVariables || {}),
    ...selectionsToVariables(ctx.selections),
    [CYCLR_BASE_URL_VAR]: res.data.baseUrl,
    [CYCLR_TOKEN_VAR]: res.data.token
  };

  if (!ctx.selections?.account?.id) {
    if (itemCopy) stripEmptyAccountHeader(itemCopy);
    stripEmptyAccountHeader(collectionCopy);
  }
};
