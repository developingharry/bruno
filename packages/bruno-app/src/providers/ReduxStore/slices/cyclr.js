import { createSlice } from '@reduxjs/toolkit';
import {
  ENTITIES,
  CYCLR_BASE_URL_VAR,
  getDependents,
  selectionsToVariables
} from 'utils/cyclr/registry';
import { findCollectionByUid } from 'utils/collections';
import { cyclrSetRuntimeVariables } from './collections';

/**
 * Cyclr config (stacks + saved partner API credentials, shared across collections) and the
 * per-collection "context": the chosen stack and the cascade of selections
 * (partner -> account -> cycle -> step ...). The context is persisted by the main process
 * per collection path and mirrored into the collection's runtime variables.
 */

const emptyContext = () => ({ loaded: false, stackId: null, selections: {} });

// Stable reference so useSelector doesn't re-render on every store update for unloaded contexts.
const EMPTY_CONTEXT = Object.freeze({ ...emptyContext(), selections: Object.freeze({}) });

const initialState = {
  config: { loaded: false, stacks: [], credentials: [] },
  contexts: {}
};

export const cyclrSlice = createSlice({
  name: 'cyclr',
  initialState,
  reducers: {
    setConfig: (state, action) => {
      state.config = {
        loaded: true,
        stacks: action.payload.stacks || [],
        credentials: action.payload.credentials || []
      };
    },
    setContext: (state, action) => {
      const { collectionUid, context } = action.payload;
      state.contexts[collectionUid] = {
        ...emptyContext(),
        stackId: context?.stackId || null,
        selections: context?.selections || {},
        loaded: true
      };
    },
    setStack: (state, action) => {
      const { collectionUid, stackId } = action.payload;
      const ctx = state.contexts[collectionUid] || emptyContext();
      // Partners, accounts etc. all belong to a stack, so everything is reset.
      state.contexts[collectionUid] = { ...ctx, stackId, selections: {}, loaded: true };
    },
    setSelection: (state, action) => {
      const { collectionUid, entityKey, item } = action.payload;
      const ctx = state.contexts[collectionUid] || emptyContext();
      const selections = { ...ctx.selections };
      const previousId = selections[entityKey]?.id;

      if (item) {
        selections[entityKey] = { id: String(item.id), label: item.label || '', sub: item.sub || '', meta: item.meta || {} };
      } else {
        delete selections[entityKey];
      }

      if (previousId !== selections[entityKey]?.id) {
        for (const dep of getDependents(entityKey)) delete selections[dep];
      }
      state.contexts[collectionUid] = { ...ctx, selections };
    }
  }
});

const { setConfig, setContext, setStack, setSelection } = cyclrSlice.actions;

const ipc = async (channel, ...args) => {
  const res = await window.ipcRenderer.invoke(channel, ...args);
  if (!res?.ok) {
    const err = new Error(res?.error || `Cyclr request failed (${channel})`);
    err.code = res?.code;
    throw err;
  }
  return res.data;
};

export const getCyclrContext = (state, collectionUid) => state.cyclr.contexts[collectionUid] || EMPTY_CONTEXT;

export const getContextPartnerId = (ctx) => ctx?.selections?.partner?.id || null;

export const hasPartnerCredentials = (state, stackId, partnerId) =>
  !!partnerId && state.cyclr.config.credentials.some((c) => c.stackId === stackId && String(c.partnerId) === String(partnerId));

const getStackForContext = (state, ctx) => state.cyclr.config.stacks.find((s) => s.id === ctx?.stackId) || null;

/** Mirror the context into runtime variables so `{{cyclr_*}}` highlights and resolves everywhere. */
const syncRuntimeVariables = (collectionUid) => (dispatch, getState) => {
  const state = getState();
  const ctx = getCyclrContext(state, collectionUid);
  const stack = getStackForContext(state, ctx);
  dispatch(
    cyclrSetRuntimeVariables({
      collectionUid,
      variables: { ...selectionsToVariables(ctx.selections), [CYCLR_BASE_URL_VAR]: stack?.baseUrl || '' }
    })
  );
};

const persistContext = (collectionUid) => async (dispatch, getState) => {
  const state = getState();
  const collection = findCollectionByUid(state.collections.collections, collectionUid);
  if (!collection?.pathname) return;
  const { stackId, selections } = getCyclrContext(state, collectionUid);
  try {
    await ipc('cyclr:set-context', collection.pathname, { stackId, selections });
  } catch (err) {
    console.warn('[cyclr] failed to persist context', err);
  }
};

export const loadCyclrConfig = () => async (dispatch) => {
  const data = await ipc('cyclr:get-config');
  dispatch(setConfig(data));
  return data;
};

export const loadCyclrContext = (collectionUid) => async (dispatch, getState) => {
  const collection = findCollectionByUid(getState().collections.collections, collectionUid);
  if (!collection?.pathname) return;
  const context = await ipc('cyclr:get-context', collection.pathname);
  // Drop the stack if it was deleted since the context was saved.
  const stackExists = context?.stackId && getState().cyclr.config.stacks.some((s) => s.id === context.stackId);
  dispatch(setContext({ collectionUid, context: stackExists ? context : null }));
  dispatch(syncRuntimeVariables(collectionUid));
};

export const selectCyclrStack = (collectionUid, stackId) => async (dispatch) => {
  dispatch(setStack({ collectionUid, stackId: stackId || null }));
  dispatch(syncRuntimeVariables(collectionUid));
  await dispatch(persistContext(collectionUid));
};

export const selectCyclrEntity = (collectionUid, entityKey, item) => async (dispatch) => {
  if (!ENTITIES[entityKey]) return;
  dispatch(setSelection({ collectionUid, entityKey, item }));
  dispatch(syncRuntimeVariables(collectionUid));
  await dispatch(persistContext(collectionUid));
};

export const saveCyclrStack = (stack) => async (dispatch, getState) => {
  const saved = await ipc('cyclr:save-stack', stack);
  await dispatch(loadCyclrConfig());
  // A changed base URL must reach the runtime variables of collections on this stack.
  for (const [collectionUid, ctx] of Object.entries(getState().cyclr.contexts)) {
    if (ctx.stackId === saved.id) dispatch(syncRuntimeVariables(collectionUid));
  }
  return saved;
};

export const deleteCyclrStack = (id) => async (dispatch, getState) => {
  await ipc('cyclr:delete-stack', id);
  await dispatch(loadCyclrConfig());
  for (const [collectionUid, ctx] of Object.entries(getState().cyclr.contexts)) {
    if (ctx.stackId === id) await dispatch(selectCyclrStack(collectionUid, null));
  }
};

export const saveCyclrPartnerCredentials = (cred) => async (dispatch) => {
  const saved = await ipc('cyclr:save-partner-credentials', cred);
  await dispatch(loadCyclrConfig());
  return saved;
};

export const deleteCyclrPartnerCredentials = ({ stackId, partnerId }) => async (dispatch) => {
  await ipc('cyclr:delete-partner-credentials', { stackId, partnerId });
  await dispatch(loadCyclrConfig());
};

export const testCyclrPartner = ({ stackId, partnerId }) => () => ipc('cyclr:test-partner', { stackId, partnerId });

export const clearCyclrCache = () => () => ipc('cyclr:clear-cache');

export default cyclrSlice.reducer;
