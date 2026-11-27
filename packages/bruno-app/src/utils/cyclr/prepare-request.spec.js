import { applyCyclrContext, getReferencedEntities } from './prepare-request';

const makeItem = ({ url = '{{cyclr_baseUrl}}/v1.0/Cycles/:id/steps', params, headers } = {}) => ({
  uid: 'item1',
  request: {
    url,
    params: params || [{ name: 'id', value: '{{cyclr_cycleId}}', type: 'path', enabled: true }],
    headers: headers || [{ name: 'X-Cyclr-Account', value: '{{cyclr_accountId}}', enabled: true }]
  }
});

const makeCollection = () => ({ uid: 'col1', brunoConfig: { cyclr: { enabled: true } }, runtimeVariables: { other: 'keep' }, items: [] });

const makeState = (ctx) => ({ cyclr: { contexts: { col1: ctx } } });

beforeEach(() => {
  window.ipcRenderer = {
    invoke: jest.fn(async () => ({ ok: true, data: { token: 'tok', baseUrl: 'https://api.example.test', expiresAt: 0 } }))
  };
});

describe('getReferencedEntities', () => {
  it('finds entities in url and params, and headers only when asked', () => {
    const item = makeItem();
    expect(getReferencedEntities(item)).toEqual(['cycle']);
    expect(getReferencedEntities(item, { includeHeaders: true }).sort()).toEqual(['account', 'cycle']);
  });

  it('prefers the draft', () => {
    const item = { ...makeItem(), draft: makeItem({ params: [{ name: 'id', value: '{{cyclr_stepId}}', type: 'path' }] }) };
    expect(getReferencedEntities(item)).toEqual(['step']);
  });
});

describe('applyCyclrContext', () => {
  it('does nothing for non-Cyclr collections', async () => {
    const collectionCopy = { uid: 'x', brunoConfig: {} };
    await applyCyclrContext({ state: makeState(null), collectionCopy, itemCopy: makeItem() });
    expect(window.ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  it('requires a partner', async () => {
    await expect(
      applyCyclrContext({ state: makeState({ stackId: 'uk', selections: {} }), collectionCopy: makeCollection(), itemCopy: makeItem() })
    ).rejects.toThrow(/stack and partner/);
  });

  it('blocks the send when a referenced id is not selected', async () => {
    const ctx = { stackId: 'uk', selections: { partner: { id: '316', label: 'Acme' }, account: { id: 'a' } } };
    await expect(
      applyCyclrContext({ state: makeState(ctx), collectionCopy: makeCollection(), itemCopy: makeItem() })
    ).rejects.toThrow('Select Cycle first');
  });

  it('injects token, base url and selections into runtime variables', async () => {
    const ctx = { stackId: 'uk', selections: { partner: { id: '316', label: 'Acme' }, account: { id: 'a' }, cycle: { id: 'c1' } } };
    const collectionCopy = makeCollection();
    const itemCopy = makeItem();
    await applyCyclrContext({ state: makeState(ctx), collectionCopy, itemCopy });

    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('cyclr:get-token', { stackId: 'uk', partnerId: '316' });
    expect(collectionCopy.runtimeVariables).toMatchObject({
      other: 'keep',
      cyclr_token: 'tok',
      cyclr_baseUrl: 'https://api.example.test',
      cyclr_accountId: 'a',
      cyclr_cycleId: 'c1',
      cyclr_stepId: ''
    });
    expect(itemCopy.request.headers[0].enabled).toBe(true);
  });

  it('drops the X-Cyclr-Account header when no account is selected', async () => {
    const ctx = { stackId: 'uk', selections: { partner: { id: '316', label: 'Acme' } } };
    const itemCopy = makeItem({ url: '{{cyclr_baseUrl}}/v1.0/connectors', params: [] });
    await applyCyclrContext({ state: makeState(ctx), collectionCopy: makeCollection(), itemCopy });
    expect(itemCopy.request.headers[0].enabled).toBe(false);
  });

  it('explains missing partner credentials', async () => {
    window.ipcRenderer.invoke = jest.fn(async () => ({ ok: false, code: 'NO_CREDENTIALS', error: 'x' }));
    const ctx = { stackId: 'uk', selections: { partner: { id: '316', label: 'Acme' }, account: { id: 'a' }, cycle: { id: 'c' } } };
    await expect(
      applyCyclrContext({ state: makeState(ctx), collectionCopy: makeCollection(), itemCopy: makeItem() })
    ).rejects.toThrow('Add API credentials for Acme');
  });

  it('surfaces token errors', async () => {
    window.ipcRenderer.invoke = jest.fn(async () => ({ ok: false, error: 'HTTP 401: invalid_client' }));
    const ctx = { stackId: 'uk', selections: { partner: { id: '316', label: 'Acme' }, account: { id: 'a' }, cycle: { id: 'c' } } };
    await expect(
      applyCyclrContext({ state: makeState(ctx), collectionCopy: makeCollection(), itemCopy: makeItem() })
    ).rejects.toThrow('invalid_client');
  });
});
