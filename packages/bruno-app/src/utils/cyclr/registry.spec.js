import {
  ENTITIES,
  buildListSpec,
  getDependents,
  getMissingRequirements,
  resolvePathParamEntity,
  selectionsToVariables,
  isCyclrCollection
} from './registry';

describe('resolvePathParamEntity', () => {
  it.each([
    ['/v1.0/Cycles/{id}/steps', 'id', 'cycle'],
    ['/v1.0/Cycles/{id}/steps/{stepId}', 'stepId', 'step'],
    ['/v1.0/Steps/{id}/fieldmappings/{fieldId}', 'id', 'step'],
    ['/v1.0/Steps/{id}/fieldmappings/{fieldId}', 'fieldId', 'fieldMapping'],
    ['/v1.0/cycles/{cycleId}/edges/{id}', 'id', 'edge'],
    ['/v1.0/cycles/{cycleId}/transactions/{id}/replay', 'id', 'transaction'],
    ['/v1.0/account/connectors/{id}', 'id', 'accountConnector'],
    ['/v1.0/connectors/{id}/methods', 'id', 'connector'],
    ['/v1.0/account/connectors/{id}/methods/{methodId}', 'methodId', 'accountConnectorMethod'],
    ['/v1.0/Methods/{id}', 'id', 'method'],
    ['/v1.0/account/connectors/custom/{id}', 'id', 'customConnector'],
    ['/v1.0/account/connectors/{accountConnectorId}/properties/{id}', 'id', 'accountConnectorProperty'],
    ['/v1.0/Mcp/servers/{id}/install/{accountId}', 'accountId', 'account'],
    ['/v1.0/Cycles/{id}/incidents/{level}', 'level', 'incidentLevel'],
    ['/v1.0/connectors/{name}/{version}', 'version', null],
    ['/v1.0/account/connectors/{id}/triggers/{triggerId}', 'triggerId', null]
  ])('%s :%s -> %s', (p, name, expected) => {
    expect(resolvePathParamEntity(p, name)).toBe(expected);
  });

  it('understands Bruno-style URLs with a base url variable', () => {
    expect(resolvePathParamEntity('{{cyclr_baseUrl}}/v1.0/Cycles/:id/steps/:stepId?filter=x', 'id')).toBe('cycle');
    expect(resolvePathParamEntity('https://api.cyclr.com/v1.0/Templates/:id', 'id')).toBe('template');
  });
});

describe('cascade', () => {
  it('lists everything downstream of an account', () => {
    const deps = getDependents('account');
    expect(deps).toEqual(expect.arrayContaining(['cycle', 'step', 'fieldMapping', 'accountConnector', 'accountConnectorMethod']));
    expect(deps).not.toContain('connector');
    expect(deps).not.toContain('template');
  });

  it('makes the partner the root of the cascade', () => {
    const deps = getDependents('partner');
    for (const key of Object.keys(ENTITIES)) {
      if (key !== 'partner' && !ENTITIES[key].static) expect(deps).toContain(key);
    }
  });

  it('builds an admin-webhook spec for partners', () => {
    expect(buildListSpec('partner', {})).toMatchObject({ source: 'adminPartners', idField: 'Id', labelFields: ['Name'] });
  });

  it('reports missing parents', () => {
    expect(getMissingRequirements('step', { account: { id: 'a' } })).toEqual(['cycle']);
    expect(getMissingRequirements('account', {})).toEqual(['partner']);
    expect(getMissingRequirements('step', { account: { id: 'a' }, cycle: { id: 'c' } })).toEqual([]);
  });

  it('every requirement refers to a real entity', () => {
    for (const e of Object.values(ENTITIES)) for (const r of e.requires) expect(ENTITIES[r]).toBeDefined();
  });
});

describe('buildListSpec', () => {
  it('fills parent ids into the list path and carries the account header', () => {
    const spec = buildListSpec('step', { account: { id: 'acc 1' }, cycle: { id: 'cyc/2' } });
    expect(spec.path).toBe('/v1.0/Cycles/cyc%2F2/steps');
    expect(spec.accountId).toBe('acc 1');
    expect(spec.paged).toBe(false);
  });

  it('uses selection meta for account connector methods', () => {
    const spec = buildListSpec('accountConnectorMethod', {
      account: { id: 'a' },
      accountConnector: { id: '55', meta: { connectorId: 123 } }
    });
    expect(spec.path).toBe('/v1.0/connectors/123/methods');
  });

  it('returns an error until requirements are met', () => {
    expect(buildListSpec('cycle', { partner: { id: 'p' } }).error).toMatch(/Account/);
  });

  it('does not send the account header for partner-level lists', () => {
    expect(buildListSpec('account', { partner: { id: 'p' }, account: { id: 'x' } }).accountId).toBeNull();
  });

  it('caps transactions', () => {
    expect(buildListSpec('transaction', { account: { id: 'a' }, cycle: { id: 'c' } }).maxItems).toBe(250);
  });

  it('returns static options without a request', () => {
    expect(buildListSpec('incidentLevel', {}).static).toHaveLength(3);
  });
});

describe('selectionsToVariables', () => {
  it('maps selections to vars and blanks the rest', () => {
    const vars = selectionsToVariables({ cycle: { id: 42 } });
    expect(vars.cyclr_cycleId).toBe('42');
    expect(vars.cyclr_stepId).toBe('');
  });
});

describe('isCyclrCollection', () => {
  it('reads the bruno.json flag', () => {
    expect(isCyclrCollection({ brunoConfig: { cyclr: { enabled: true } } })).toBe(true);
    expect(isCyclrCollection({ brunoConfig: {} })).toBe(false);
  });
});
