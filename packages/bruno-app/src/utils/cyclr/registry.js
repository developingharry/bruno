/**
 * Cyclr entity registry.
 *
 * Pure ESM with no imports so that it can be shared by the renderer and by the
 * collection generator script (scripts/cyclr/generate-collection.mjs).
 *
 * An "entity" is something the user picks from a dropdown (an Account, a Cycle,
 * a Step...). Each entity knows:
 *  - which runtime variable it feeds (`var`), used as `{{var}}` in requests
 *  - which list endpoint populates it (`list.path`), with `{entityKey}`
 *    placeholders that are filled from the other selections in the context
 *  - which other entities must be selected first (`requires`) - this is what
 *    makes the dropdowns cascade, and what clears children when a parent changes
 *  - whether the list call needs the `X-Cyclr-Account` header (`accountHeader`)
 *  - how to turn a raw API object into `{ id, label, sub, meta }`
 */

export const CYCLR_VAR_PREFIX = 'cyclr_';
export const CYCLR_BASE_URL_VAR = 'cyclr_baseUrl';
export const CYCLR_TOKEN_VAR = 'cyclr_token';
export const CYCLR_ACCOUNT_HEADER = 'X-Cyclr-Account';

const MINUTE = 60;

export const ENTITIES = {
  partner: {
    label: 'Partner',
    var: 'cyclr_partnerId',
    requires: [],
    accountHeader: 'none',
    // Listed via the stack's admin webhook rather than the partner API.
    source: 'adminPartners',
    idField: 'Id',
    labelFields: ['Name'],
    subFields: [],
    ttl: 30 * MINUTE
  },
  account: {
    label: 'Account',
    var: 'cyclr_accountId',
    requires: ['partner'],
    accountHeader: 'none',
    list: { path: '/v1.0/accounts', paged: true },
    idField: 'Id',
    labelFields: ['Name'],
    subFields: ['Description'],
    ttl: 10 * MINUTE
  },
  cycle: {
    label: 'Cycle',
    var: 'cyclr_cycleId',
    requires: ['account'],
    accountHeader: 'required',
    list: { path: '/v1.0/Cycles', paged: true },
    idField: 'Id',
    labelFields: ['Name'],
    subFields: ['Status'],
    ttl: 5 * MINUTE
  },
  step: {
    label: 'Step',
    var: 'cyclr_stepId',
    requires: ['account', 'cycle'],
    accountHeader: 'required',
    list: { path: '/v1.0/Cycles/{cycle}/steps', paged: false },
    idField: 'Id',
    labelFields: ['Name'],
    subFields: ['ActionType'],
    ttl: 5 * MINUTE
  },
  accountConnector: {
    label: 'Account Connector',
    var: 'cyclr_accountConnectorId',
    requires: ['account'],
    accountHeader: 'required',
    list: { path: '/v1.0/account/connectors', paged: true },
    idField: 'Id',
    labelFields: ['Name'],
    subFields: ['Connector.Name', 'Connector.Version'],
    metaFields: { connectorId: 'Connector.Id' },
    ttl: 5 * MINUTE
  },
  accountConnectorMethod: {
    label: 'Connector Method',
    var: 'cyclr_accountConnectorMethodId',
    requires: ['account', 'accountConnector'],
    accountHeader: 'optional',
    // Methods belong to the connector behind the selected account connector.
    list: { path: '/v1.0/connectors/{accountConnector.meta.connectorId}/methods', paged: false },
    idField: 'Id',
    labelFields: ['Name'],
    subFields: ['Category.Name', 'MethodType'],
    ttl: 30 * MINUTE
  },
  connector: {
    label: 'Connector',
    var: 'cyclr_connectorId',
    requires: ['partner'],
    accountHeader: 'optional',
    list: { path: '/v1.0/connectors', paged: true },
    idField: 'Id',
    labelFields: ['Name'],
    subFields: ['Version', 'Status'],
    ttl: 30 * MINUTE
  },
  connectorName: {
    label: 'Connector (by name)',
    var: 'cyclr_connectorName',
    requires: ['partner'],
    accountHeader: 'optional',
    list: { path: '/v1.0/connectors', paged: true },
    idField: 'Name',
    labelFields: ['Name'],
    subFields: ['Version'],
    dedupe: true,
    ttl: 30 * MINUTE
  },
  method: {
    label: 'Method',
    var: 'cyclr_methodId',
    requires: ['connector'],
    accountHeader: 'optional',
    list: { path: '/v1.0/connectors/{connector}/methods', paged: false },
    idField: 'Id',
    labelFields: ['Name'],
    subFields: ['Category.Name', 'MethodType'],
    ttl: 30 * MINUTE
  },
  template: {
    label: 'Template',
    var: 'cyclr_templateId',
    requires: ['partner'],
    accountHeader: 'optional',
    list: { path: '/v1.0/Templates', paged: true },
    idField: 'Id',
    labelFields: ['Name'],
    subFields: ['ReleaseStatus'],
    ttl: 15 * MINUTE
  },
  customConnector: {
    label: 'Custom Connector',
    var: 'cyclr_customConnectorId',
    requires: ['account'],
    accountHeader: 'required',
    list: { path: '/v1.0/account/connectors/custom', paged: true },
    idField: 'Id',
    labelFields: ['Name'],
    subFields: ['Version'],
    ttl: 15 * MINUTE
  },
  accountConnectorProperty: {
    label: 'Connector Property',
    var: 'cyclr_accountConnectorPropertyId',
    requires: ['account', 'accountConnector'],
    accountHeader: 'required',
    list: { path: '/v1.0/account/connectors/{accountConnector}/properties', paged: true },
    idField: 'Id',
    labelFields: ['Name'],
    subFields: ['Value'],
    ttl: 5 * MINUTE
  },
  customField: {
    label: 'Custom Field',
    var: 'cyclr_customFieldId',
    requires: ['account', 'accountConnector'],
    accountHeader: 'required',
    list: { path: '/v1.0/account/connectors/{accountConnector}/fields', paged: true },
    idField: 'Id',
    labelFields: ['DisplayName', 'ConnectorField'],
    subFields: ['DataType', 'MethodUniqueIdentifier'],
    ttl: 5 * MINUTE
  },
  customCategory: {
    label: 'Custom Category',
    var: 'cyclr_customCategoryId',
    requires: ['account', 'accountConnector'],
    accountHeader: 'required',
    list: { path: '/v1.0/account/connectors/{accountConnector}/customcategories', paged: false },
    idField: 'Id',
    labelFields: ['Object'],
    subFields: ['CustomizableCategoryId'],
    ttl: 5 * MINUTE
  },
  customizableCategory: {
    label: 'Customizable Category',
    var: 'cyclr_customizableCategoryId',
    requires: ['account', 'accountConnector'],
    accountHeader: 'required',
    list: { path: '/v1.0/account/connectors/{accountConnector}/customcategories', paged: false },
    idField: 'CustomizableCategoryId',
    labelFields: ['Object'],
    subFields: ['Id'],
    dedupe: true,
    ttl: 5 * MINUTE
  },
  cycleVariable: {
    label: 'Cycle Variable',
    var: 'cyclr_cycleVariable',
    requires: ['account', 'cycle'],
    accountHeader: 'required',
    list: { path: '/v1.0/Cycles/{cycle}/variables', paged: false },
    idField: 'SystemName',
    labelFields: ['DisplayName', 'SystemName'],
    subFields: ['MappingType'],
    ttl: 5 * MINUTE
  },
  edge: {
    label: 'Edge',
    var: 'cyclr_edgeId',
    requires: ['account', 'cycle'],
    accountHeader: 'required',
    list: { path: '/v1.0/cycles/{cycle}/edges', paged: false },
    idField: 'Id',
    labelFields: ['EdgeType'],
    subFields: ['TailStepId', 'HeadStepId'],
    ttl: 5 * MINUTE
  },
  transaction: {
    label: 'Transaction',
    var: 'cyclr_transactionId',
    requires: ['account', 'cycle'],
    accountHeader: 'required',
    // Transactions can number in the hundreds of thousands: only pull the most recent few pages.
    list: { path: '/v1.0/cycles/{cycle}/transactions', paged: true, maxItems: 250 },
    idField: 'Id',
    labelFields: ['StartedTimestamp'],
    subFields: ['Status'],
    ttl: 1 * MINUTE
  },
  fieldMapping: {
    label: 'Field',
    var: 'cyclr_fieldId',
    requires: ['account', 'cycle', 'step'],
    accountHeader: 'required',
    list: { path: '/v1.0/Steps/{step}/fieldmappings', paged: false },
    idField: 'Field.Id',
    labelFields: ['Field.Name'],
    subFields: ['Field.Location', 'MappingType'],
    ttl: 5 * MINUTE
  },
  stepParameter: {
    label: 'Parameter',
    var: 'cyclr_parameterId',
    requires: ['account', 'cycle', 'step'],
    accountHeader: 'required',
    list: { path: '/v1.0/Steps/{step}/parameters', paged: false },
    idField: 'Parameter.Id',
    labelFields: ['Parameter.Name'],
    subFields: ['MappingType'],
    ttl: 5 * MINUTE
  },
  mcpServer: {
    label: 'MCP Server',
    var: 'cyclr_mcpServerId',
    requires: ['partner'],
    accountHeader: 'optional',
    list: { path: '/v1.0/Mcp/servers', paged: false },
    idField: 'Id',
    labelFields: ['Name'],
    subFields: ['Url'],
    ttl: 5 * MINUTE
  },
  mcpValidCycle: {
    label: 'MCP Cycle',
    var: 'cyclr_versionedCycleId',
    requires: ['mcpServer'],
    accountHeader: 'optional',
    list: { path: '/v1.0/Mcp/servers/{mcpServer}/cycles/valid', paged: false },
    idField: 'VersionedCycleId',
    labelFields: ['CycleName'],
    subFields: ['CycleDescription'],
    ttl: 5 * MINUTE
  },
  incidentLevel: {
    label: 'Incident Level',
    var: 'cyclr_incidentLevel',
    requires: [],
    accountHeader: 'none',
    static: [
      { id: 'Info', label: 'Info' },
      { id: 'Warning', label: 'Warning' },
      { id: 'Error', label: 'Error' }
    ]
  }
};

/** Entities shown permanently in the context bar - the main cascade. */
export const PRIMARY_ENTITIES = ['partner', 'account', 'cycle', 'step', 'accountConnector'];

export const VAR_TO_ENTITY = Object.fromEntries(Object.entries(ENTITIES).map(([key, e]) => [e.var, key]));

/** Named path params whose meaning doesn't depend on where they appear. */
const NAMED_PARAM_ENTITIES = {
  accountId: 'account',
  cycleId: 'cycle',
  stepId: 'step',
  accountConnectorId: 'accountConnector',
  fieldId: 'fieldMapping',
  parameterId: 'stepParameter',
  systemName: 'cycleVariable',
  versionedCycleId: 'mcpValidCycle',
  customCategoryId: 'customCategory',
  customizableCategoryId: 'customizableCategory',
  level: 'incidentLevel',
  name: 'connectorName'
};

/**
 * Generic `{id}` / `:id` params are resolved from the path segment that precedes them,
 * e.g. `/Cycles/{id}` -> cycle, `/cycles/{cycleId}/edges/{id}` -> edge.
 */
const SEGMENT_ENTITIES = {
  accounts: 'account',
  cycles: 'cycle',
  steps: 'step',
  connectors: 'connector',
  methods: 'method',
  templates: 'template',
  custom: 'customConnector',
  properties: 'accountConnectorProperty',
  fields: 'customField',
  transactions: 'transaction',
  edges: 'edge',
  servers: 'mcpServer'
};

const PARAM_RE = /^(?:\{(\w+)\}|:(\w+))$/;

const splitPath = (urlOrPath) => {
  let path = String(urlOrPath || '');
  // Drop scheme/host or a leading {{baseUrl}} style variable.
  path = path.replace(/^\{\{[^}]+\}\}/, '').replace(/^[a-z]+:\/\/[^/]+/i, '');
  path = path.split('?')[0].split('#')[0];
  return path.split('/').filter(Boolean);
};

/**
 * Work out which entity a path parameter refers to.
 * Accepts OpenAPI (`{id}`) or Bruno (`:id`) style templates, with or without a base URL.
 * Returns an entity key, or null if the param can't be picked from a list.
 */
export const resolvePathParamEntity = (urlOrPath, paramName) => {
  const segments = splitPath(urlOrPath);
  const idx = segments.findIndex((seg) => {
    const m = seg.match(PARAM_RE);
    return m && (m[1] || m[2]) === paramName;
  });
  if (idx === -1) return null;

  const lowerSegs = segments.map((s) => s.toLowerCase());
  const prev = idx > 0 ? lowerSegs[idx - 1] : '';
  const prevPrev = idx > 1 ? lowerSegs[idx - 2] : '';

  // methodId is a connector method; under /account/connectors/{id} it belongs to that account connector.
  if (paramName === 'methodId') {
    return lowerSegs[1] === 'account' && lowerSegs[2] === 'connectors' ? 'accountConnectorMethod' : 'method';
  }

  if (paramName === 'version' || paramName === 'triggerId') return null;

  if (NAMED_PARAM_ENTITIES[paramName]) return NAMED_PARAM_ENTITIES[paramName];

  if (paramName === 'id') {
    if (prev === 'connectors' && prevPrev === 'account') return 'accountConnector';
    return SEGMENT_ENTITIES[prev] || null;
  }

  return null;
};

/** Every entity that (transitively) depends on `entityKey`. */
export const getDependents = (entityKey) => {
  const out = new Set();
  const visit = (key) => {
    for (const [k, e] of Object.entries(ENTITIES)) {
      if (!out.has(k) && e.requires.includes(key)) {
        out.add(k);
        visit(k);
      }
    }
  };
  visit(entityKey);
  return [...out];
};

/**
 * Required parents that are not yet selected. The dropdown is disabled until these are picked.
 */
export const getMissingRequirements = (entityKey, selections = {}) => {
  const entity = ENTITIES[entityKey];
  if (!entity) return [];
  return entity.requires.filter((req) => !selections[req]?.id);
};

const getByPath = (obj, path) => path.split('.').reduce((acc, k) => (acc === null || acc === undefined ? undefined : acc[k]), obj);

/**
 * Fill `{entity}` / `{entity.meta.x}` placeholders in a list path from the current selections.
 * Returns null if any placeholder can't be resolved.
 */
export const buildListPath = (entityKey, selections = {}) => {
  const entity = ENTITIES[entityKey];
  if (!entity?.list) return null;
  let missing = false;
  const path = entity.list.path.replace(/\{([\w.]+)\}/g, (_, ref) => {
    const [selKey, ...rest] = ref.split('.');
    const sel = selections[selKey];
    const value = rest.length ? getByPath(sel, rest.join('.')) : sel?.id;
    if (value === undefined || value === null || value === '') {
      missing = true;
      return '';
    }
    return encodeURIComponent(String(value));
  });
  return missing ? null : path;
};

/**
 * Build the serialisable spec the main process needs to fetch and normalise a list.
 * Returns `{ error }` if the entity can't be listed yet.
 */
export const buildListSpec = (entityKey, selections = {}) => {
  const entity = ENTITIES[entityKey];
  if (!entity) return { error: `Unknown entity ${entityKey}` };
  if (entity.static) return { static: entity.static };

  const missing = getMissingRequirements(entityKey, selections);
  if (missing.length) {
    return { error: `Select ${missing.map((m) => ENTITIES[m].label).join(', ')} first`, missing };
  }

  if (entity.source === 'adminPartners') {
    return {
      source: entity.source,
      idField: entity.idField,
      labelFields: entity.labelFields,
      subFields: entity.subFields || [],
      metaFields: {},
      ttl: entity.ttl || 5 * MINUTE
    };
  }

  const path = buildListPath(entityKey, selections);
  if (!path) return { error: 'Missing information to build list request' };

  const accountId = entity.accountHeader === 'none' ? null : selections.account?.id || null;
  if (entity.accountHeader === 'required' && !accountId) {
    return { error: 'Select an Account first', missing: ['account'] };
  }

  return {
    path,
    accountId,
    paged: !!entity.list.paged,
    maxItems: entity.list.maxItems || null,
    idField: entity.idField,
    labelFields: entity.labelFields,
    subFields: entity.subFields || [],
    metaFields: entity.metaFields || {},
    dedupe: !!entity.dedupe,
    ttl: entity.ttl || 5 * MINUTE
  };
};

/**
 * Compute runtime variables for the current context.
 * Unselected entities map to '' so `{{var}}` never leaks into a request literally.
 */
export const selectionsToVariables = (selections = {}) => {
  const vars = {};
  for (const [key, entity] of Object.entries(ENTITIES)) {
    const sel = selections[key];
    vars[entity.var] = sel?.id !== undefined && sel?.id !== null ? String(sel.id) : '';
  }
  return vars;
};

export const isCyclrCollection = (collection) => {
  const cfg = collection?.draft?.brunoConfig || collection?.brunoConfig;
  return !!cfg?.cyclr?.enabled;
};
