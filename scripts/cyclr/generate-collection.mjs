#!/usr/bin/env node
/**
 * Generate a Bruno collection for the Cyclr API from cyclr_api.json.
 *
 *   node scripts/cyclr/generate-collection.mjs [specPath] [outDir]
 *
 * defaults: specPath = ./cyclr_api.json, outDir = ./cyclr-collection
 *
 * Every request is pre-wired to the Cyclr context bar:
 *   - URL          {{cyclr_baseUrl}}/v1.0/...   (from the selected partner's stack)
 *   - auth         Bearer {{cyclr_token}}       (collection level, refreshed automatically)
 *   - header       X-Cyclr-Account: {{cyclr_accountId}} where the endpoint takes it
 *   - path params  {{cyclr_cycleId}}, {{cyclr_stepId}} ... picked from dropdowns
 *   - query params listed but disabled, with their defaults, so they're one click away
 *
 * Re-run after updating cyclr_api.json. The output folder is replaced.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);

const { stringifyRequest, stringifyFolder, stringifyCollection } = require(
  path.join(repoRoot, 'packages/bruno-filestore/dist/cjs/index.js')
);
const { ENTITIES, resolvePathParamEntity } = await import(
  pathToFileURL(path.join(repoRoot, 'packages/bruno-app/src/utils/cyclr/registry.js')).href
);

const specPath = path.resolve(process.argv[2] || path.join(repoRoot, 'cyclr_api.json'));
const outDir = path.resolve(process.argv[3] || path.join(repoRoot, 'cyclr-collection'));
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// ---------------------------------------------------------------------------
// helpers

const resolveRef = (obj) => {
  let cur = obj;
  const seen = new Set();
  while (cur && cur.$ref && !seen.has(cur.$ref)) {
    seen.add(cur.$ref);
    cur = cur.$ref.replace(/^#\//, '').split('/').reduce((acc, k) => acc?.[k], spec);
  }
  return cur || {};
};

const safeFileName = (name) =>
  name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '').slice(0, 80) || 'request';

const shortName = (summary, method, p) => {
  if (!summary) return `${method.toUpperCase()} ${p}`;
  // First sentence only - some summaries run on.
  const first = summary.split(/\.\s|\n/)[0].replace(/\.$/, '').trim();
  return first.length > 70 ? `${first.slice(0, 67)}...` : first;
};

/** Build an example JSON body from a schema (depth-limited, cycle-safe). */
const exampleFromSchema = (schemaIn, depth = 0, stack = []) => {
  const refName = schemaIn?.$ref;
  if (refName && stack.includes(refName)) return null;
  const schema = resolveRef(schemaIn);
  const nextStack = refName ? [...stack, refName] : stack;

  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => exampleFromSchema(s, depth, nextStack) || {}));
  if (schema.oneOf || schema.anyOf) return exampleFromSchema((schema.oneOf || schema.anyOf)[0], depth, nextStack);

  const type = schema.type || (schema.properties ? 'object' : undefined);
  switch (type) {
    case 'object': {
      if (depth > 3) return {};
      const out = {};
      for (const [k, v] of Object.entries(schema.properties || {})) {
        const prop = resolveRef(v);
        if (prop.readOnly) continue;
        out[k] = exampleFromSchema(v, depth + 1, nextStack);
      }
      return out;
    }
    case 'array':
      return depth > 3 ? [] : [exampleFromSchema(schema.items || {}, depth + 1, nextStack)].filter((v) => v !== null);
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      if (schema.format === 'date-time') return '2026-01-01T00:00:00Z';
      if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
      return '';
    default:
      return null;
  }
};

const paramValueFor = (p) => {
  const schema = resolveRef(p.schema || {});
  if (p.example !== undefined) return String(p.example);
  if (schema.default !== undefined) return String(schema.default);
  if (schema.enum?.length) return String(schema.enum[0]);
  return '';
};

const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// build

const folders = new Map(); // tag -> { seq, description, items: [] }
const tagDescriptions = Object.fromEntries((spec.tags || []).map((t) => [t.name, t.description || '']));
let unmapped = [];

for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
  for (const method of HTTP_METHODS) {
    const op = pathItem[method];
    if (!op) continue;

    const tag = op.tags?.[0] || 'Other';
    if (!folders.has(tag)) folders.set(tag, { seq: folders.size + 1, items: [] });
    const folder = folders.get(tag);

    const params = [...(pathItem.parameters || []), ...(op.parameters || [])].map(resolveRef);
    const brunoUrlPath = apiPath.replace(/\{(\w+)\}/g, ':$1');
    const isTokenEndpoint = apiPath === '/oauth/token';

    const pathParams = params
      .filter((p) => p.in === 'path')
      .map((p) => {
        const entityKey = resolvePathParamEntity(apiPath, p.name);
        if (!entityKey) unmapped.push(`${method.toUpperCase()} ${apiPath} :${p.name}`);
        return {
          name: p.name,
          value: entityKey ? `{{${ENTITIES[entityKey].var}}}` : '',
          description: oneLine(p.description),
          enabled: true,
          type: 'path'
        };
      });

    const queryParams = params
      .filter((p) => p.in === 'query')
      .map((p) => ({
        name: p.name,
        value: paramValueFor(p),
        description: oneLine(p.description),
        enabled: false,
        type: 'query'
      }));

    const headers = params
      .filter((p) => p.in === 'header')
      .map((p) => ({
        name: p.name,
        value: p.name.toLowerCase() === 'x-cyclr-account' ? '{{cyclr_accountId}}' : paramValueFor(p),
        description: oneLine(p.description),
        enabled: true
      }));

    // Body
    let body = { mode: 'none' };
    const content = resolveRef(op.requestBody || {}).content || {};
    if (isTokenEndpoint) {
      body = {
        mode: 'formUrlEncoded',
        formUrlEncoded: [
          { name: 'grant_type', value: 'client_credentials', enabled: true },
          { name: 'client_id', value: '', enabled: true },
          { name: 'client_secret', value: '', enabled: true }
        ]
      };
    } else if (content['application/json'] || content['text/json'] || content['application/*+json']) {
      const media = content['application/json'] || content['text/json'] || content['application/*+json'];
      const example = media.example ?? exampleFromSchema(media.schema || {});
      body = { mode: 'json', json: JSON.stringify(example ?? {}, null, 2) };
    } else if (content['application/x-www-form-urlencoded']) {
      const schema = resolveRef(content['application/x-www-form-urlencoded'].schema || {});
      body = {
        mode: 'formUrlEncoded',
        formUrlEncoded: Object.keys(schema.properties || {}).map((name) => ({ name, value: '', enabled: true }))
      };
    }

    // Docs
    const docLines = [];
    if (op.summary) docLines.push(`**${oneLine(op.summary)}**`, '');
    if (op.description && op.description !== op.summary) docLines.push(op.description, '');
    docLines.push('`' + method.toUpperCase() + ' ' + apiPath + '`');
    if (op.deprecated) docLines.unshift('> Deprecated', '');
    if (isTokenEndpoint) {
      docLines.push('', 'You normally don\'t need this request: the Cyclr context bar fetches and refreshes tokens automatically for the selected partner.');
    }

    folder.items.push({
      type: 'http-request',
      name: shortName(op.summary, method, apiPath),
      seq: folder.items.length + 1,
      tags: op.deprecated ? ['deprecated'] : [],
      settings: { encodeUrl: true },
      request: {
        method: method.toUpperCase(),
        url: `{{cyclr_baseUrl}}${brunoUrlPath}`,
        params: [...queryParams, ...pathParams],
        headers,
        auth: { mode: isTokenEndpoint ? 'none' : 'inherit' },
        body,
        docs: docLines.join('\n')
      }
    });
  }
}

// ---------------------------------------------------------------------------
// write

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const brunoConfig = {
  version: '1',
  name: 'Cyclr API',
  type: 'collection',
  ignore: ['node_modules', '.git'],
  cyclr: { enabled: true }
};
fs.writeFileSync(path.join(outDir, 'bruno.json'), JSON.stringify(brunoConfig, null, 2) + '\n');

const collectionRoot = {
  request: {
    headers: [{ name: 'Accept', value: 'application/json', enabled: true }],
    auth: { mode: 'bearer', bearer: { token: '{{cyclr_token}}' } }
  },
  docs: [
    `# ${spec.info?.title || 'Cyclr API'}`,
    '',
    spec.info?.description || '',
    '',
    '## Using this collection',
    '',
    '1. Pick a **Stack** in the bar above the URL. It sets `{{cyclr_baseUrl}}`. Stacks and admin webhooks are edited under *Cyclr settings…* in the same menu.',
    '2. Pick a **Partner**. The list comes from the stack\x27s admin webhook. The first time, you\x27re asked for that partner\x27s API client ID and secret.',
    '3. Pick an Account, then a Cycle, then a Step… Each dropdown is fed by the matching List endpoint, using the selections before it. A token is fetched into `{{cyclr_token}}` automatically on every send.',
    '4. In the Params tab, the list icon beside a path parameter opens the same picker for that parameter.',
    '',
    `Generated from \`${path.basename(specPath)}\` (${spec.info?.version || ''}) by \`scripts/cyclr/generate-collection.mjs\`.`
  ].join('\n')
};
fs.writeFileSync(path.join(outDir, 'collection.bru'), stringifyCollection(collectionRoot, brunoConfig, { format: 'bru' }));

let requestCount = 0;
for (const [tag, folder] of folders) {
  const dir = path.join(outDir, safeFileName(tag));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'folder.bru'),
    stringifyFolder(
      { meta: { name: tag, seq: folder.seq }, request: { auth: { mode: 'inherit' } }, docs: tagDescriptions[tag] || '' },
      { format: 'bru' }
    )
  );

  const usedNames = new Set();
  for (const item of folder.items) {
    let fileBase = safeFileName(item.name);
    let candidate = fileBase;
    for (let n = 2; usedNames.has(candidate.toLowerCase()); n++) {
      candidate = `${fileBase} (${item.request.method}${n > 2 ? ` ${n - 1}` : ''})`;
    }
    usedNames.add(candidate.toLowerCase());
    if (candidate !== fileBase) item.name = candidate;
    fs.writeFileSync(path.join(dir, `${candidate}.bru`), stringifyRequest(item, { format: 'bru' }));
    requestCount += 1;
  }
}

console.log(`Wrote ${requestCount} requests in ${folders.size} folders to ${path.relative(process.cwd(), outDir) || outDir}`);
unmapped = [...new Set(unmapped)];
if (unmapped.length) {
  console.log(`Path params without a picker (free text): ${unmapped.length}`);
  for (const u of unmapped) console.log(`  ${u}`);
}
