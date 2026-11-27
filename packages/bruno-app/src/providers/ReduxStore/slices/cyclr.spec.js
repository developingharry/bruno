import reducer, { cyclrSlice } from './cyclr';

const { setContext, setStack, setSelection } = cyclrSlice.actions;

const withContext = (selections) =>
  reducer(undefined, setContext({ collectionUid: 'c', context: { stackId: 's', selections } }));

describe('cyclr slice', () => {
  it('clears downstream selections when a parent changes', () => {
    let state = withContext({
      account: { id: 'a1' },
      cycle: { id: 'cy1' },
      step: { id: 'st1' },
      accountConnector: { id: 'ac1' },
      template: { id: 't1' }
    });
    state = reducer(state, setSelection({ collectionUid: 'c', entityKey: 'cycle', item: { id: 'cy2', label: 'Other' } }));
    expect(state.contexts.c.selections.cycle.id).toBe('cy2');
    expect(state.contexts.c.selections.step).toBeUndefined();
    expect(state.contexts.c.selections.accountConnector.id).toBe('ac1');

    state = reducer(state, setSelection({ collectionUid: 'c', entityKey: 'account', item: { id: 'a2' } }));
    expect(state.contexts.c.selections.cycle).toBeUndefined();
    expect(state.contexts.c.selections.accountConnector).toBeUndefined();
    // partner-level entities survive an account change
    expect(state.contexts.c.selections.template.id).toBe('t1');
  });

  it('keeps children when the same item is re-selected', () => {
    let state = withContext({ account: { id: 'a1' }, cycle: { id: 'cy1' } });
    state = reducer(state, setSelection({ collectionUid: 'c', entityKey: 'account', item: { id: 'a1', label: 'Renamed' } }));
    expect(state.contexts.c.selections.cycle.id).toBe('cy1');
  });

  it('clearing a selection clears its children', () => {
    let state = withContext({ account: { id: 'a1' }, cycle: { id: 'cy1' } });
    state = reducer(state, setSelection({ collectionUid: 'c', entityKey: 'account', item: null }));
    expect(state.contexts.c.selections).toEqual({});
  });

  it('switching stack resets all selections', () => {
    let state = withContext({ partner: { id: '316' }, account: { id: 'a1' } });
    state = reducer(state, setStack({ collectionUid: 'c', stackId: 'eu' }));
    expect(state.contexts.c).toMatchObject({ stackId: 'eu', selections: {} });
  });

  it('switching partner clears everything below it', () => {
    let state = withContext({ partner: { id: '316' }, account: { id: 'a1' }, template: { id: 't1' }, connector: { id: 'c1' } });
    state = reducer(state, setSelection({ collectionUid: 'c', entityKey: 'partner', item: { id: 317, label: 'Other' } }));
    expect(state.contexts.c.selections).toEqual({ partner: { id: '317', label: 'Other', sub: '', meta: {} } });
  });
});
