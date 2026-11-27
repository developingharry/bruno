import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { ENTITIES, buildListSpec } from 'utils/cyclr/registry';
import { getCyclrContext, getContextPartnerId } from 'providers/ReduxStore/slices/cyclr';

/**
 * Renderer-side memory of the last result per list, so re-opening a picker is instant
 * even before the main process answers. The main process owns the real (TTL + disk) cache.
 */
const sessionCache = new Map();

const addSearchKeys = (items) =>
  (items || []).map((it) => (it.hay ? it : { ...it, hay: `${it.label} ${it.id} ${it.sub || ''}`.toLowerCase() }));

const EMPTY = { items: [], loading: false, error: null, loaded: 0, total: null, fetchedAt: null, stale: false, truncated: false };

/**
 * Load the options for an entity picker.
 * Nothing is fetched until `enabled` is true (i.e. the picker is open).
 */
export const useCyclrList = ({ collectionUid, entityKey, enabled }) => {
  const ctx = useSelector((state) => getCyclrContext(state, collectionUid));
  const stackId = ctx.stackId;
  const partnerId = getContextPartnerId(ctx);
  const isPartnerList = !!(ENTITIES[entityKey]?.source === 'adminPartners');
  const spec = useMemo(() => buildListSpec(entityKey, ctx.selections), [entityKey, ctx.selections]);
  const requestKey = useMemo(() => {
    if (!stackId) return null;
    if (isPartnerList) return JSON.stringify(['partners', stackId]);
    return spec.path ? JSON.stringify([stackId, partnerId, spec.path, spec.accountId, spec.idField, spec.maxItems]) : null;
  }, [stackId, partnerId, isPartnerList, spec]);

  const [state, setState] = useState(() => {
    if (spec.static) return { ...EMPTY, items: addSearchKeys(spec.static) };
    const cached = requestKey && sessionCache.get(requestKey);
    return cached ? { ...EMPTY, ...cached } : EMPTY;
  });
  const requestKeyRef = useRef(requestKey);
  requestKeyRef.current = requestKey;

  // Reset when the list identity changes (e.g. a parent selection changed).
  useEffect(() => {
    if (spec.static) {
      setState({ ...EMPTY, items: addSearchKeys(spec.static) });
      return;
    }
    const cached = requestKey && sessionCache.get(requestKey);
    setState(cached ? { ...EMPTY, ...cached } : EMPTY);
  }, [requestKey, spec.static]);

  // Stream pages / background refreshes from the main process.
  useEffect(() => {
    if (!requestKey || !window.ipcRenderer) return undefined;
    return window.ipcRenderer.on('main:cyclr-list-progress', (payload) => {
      if (payload?.requestKey !== requestKeyRef.current) return;
      if (payload.error) {
        setState((s) => ({ ...s, loading: false, error: payload.error }));
        return;
      }
      setState((s) => {
        const next = {
          ...s,
          items: addSearchKeys(payload.items),
          loaded: payload.loaded ?? payload.items?.length ?? s.loaded,
          total: payload.total ?? s.total,
          loading: !payload.done,
          error: null,
          ...(payload.refreshed ? { fetchedAt: payload.fetchedAt, stale: false, truncated: !!payload.truncated } : {})
        };
        if (payload.done) {
          sessionCache.set(requestKey, { items: next.items, fetchedAt: next.fetchedAt, truncated: next.truncated, total: next.total });
        }
        return next;
      });
    });
  }, [requestKey]);

  const load = useCallback(
    async ({ force = false } = {}) => {
      if (!requestKey || spec.error || spec.static) return;
      const key = requestKey;
      setState((s) => ({ ...s, loading: true, error: null, ...(force ? { loaded: 0 } : {}) }));
      try {
        const res = isPartnerList
          ? await window.ipcRenderer.invoke('cyclr:list-partners', { stackId, spec, requestKey: key, force })
          : await window.ipcRenderer.invoke('cyclr:list', { stackId, partnerId, spec, requestKey: key, force });
        if (requestKeyRef.current !== key) return;
        if (!res?.ok) throw new Error(res?.error || 'Failed to load');
        const { items, fetchedAt, stale, truncated, total } = res.data;
        const result = { items: addSearchKeys(items), fetchedAt, truncated, total };
        sessionCache.set(key, result);
        // When stale, a background refresh is running: keep the spinner until it reports back.
        setState({ ...EMPTY, ...result, stale, loading: !!stale, loaded: items.length });
      } catch (err) {
        if (requestKeyRef.current !== key) return;
        setState((s) => ({ ...s, loading: false, error: err.message }));
      }
    },
    [requestKey, spec, stackId, partnerId, isPartnerList]
  );

  useEffect(() => {
    if (enabled && requestKey) load();
  }, [enabled, load, requestKey]);

  return { ...state, spec, stackId, partnerId, refresh: () => load({ force: true }) };
};

export default useCyclrList;
