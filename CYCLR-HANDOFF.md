# Cyclr Bruno fork: where we are

Hand-off notes for picking this work up on a new machine or in a new Claude Code chat. Read `CYCLR.md` alongside this; it covers usage and architecture.

## Goal

Customise Bruno for Cyclr's API (`cyclr_api.json`, OpenAPI 3.0.4, 145 operations):

- switch between stacks, each with its own base URL;
- cascading dropdowns: Stack → Partner → Account → Cycle → Step …;
- every path parameter can be picked from a dropdown;
- large lists are cached and don't hang the UI.

## Done and working

- **Stack picker**: UK, EU, US and US2, with base URLs and admin webhook IDs, in `packages/bruno-electron/src/ipc/cyclr/store.js`. US2 is `https://api.us2.cyclr.com`. Stacks are edited under **Stack ▾ → Cyclr settings…**.
- **Partner picker**:
  - fed by `POST https://cyclrsalesintegrations-h.cyclr.uk/api/webhook/<webhookId>` with body `{"requesttype":"listpartners"}`, which returns `[{"Id":316,"Name":"..."}]`;
  - the webhook is IP-allowlisted, so a new machine or network needs its public IPv4 address added;
  - an empty HTTP 200 response means the IP isn't allowed.
- **Partner API credentials**: the client ID and secret are prompted for the first time you pick a partner (key icon), tested on save, and stored encrypted with Electron safeStorage in `%APPDATA%\bruno\cyclr.json`. They are tied to the machine and won't transfer, so they must be re-entered after the wipe.
- **Dropdowns follow the request**: the bar above the URL shows only the entities the open request references, plus their parents. For example, `/Cycles/:id/steps` shows Account and Cycle only. Hidden chips keep their values.
- **Path-param pickers** in the Params tab use the same registry.
- **Lists**:
  - paged and fetched in the main process;
  - cached in memory and on disk, with stale-while-revalidate;
  - shown in a virtualised list with search;
  - transactions are capped at 250.
- **At send time**: the OAuth token is fetched and refreshed automatically, and `{{cyclr_*}}` runtime variables are injected.
- **Collection generator**: `scripts/cyclr/generate-collection.mjs` turns `cyclr_api.json` into `cyclr-collection/`, with 145 requests in 16 folders.
- **Tests**: 15 Electron tests in `client.spec.js` and 44 renderer tests in the registry, prepare-request and cyclr slice specs. All pass, and lint is clean.

## Files involved (all uncommitted)

```
CYCLR.md, CYCLR-HANDOFF.md, cyclr_api.json, cyclr-collection/, scripts/cyclr/
packages/bruno-app/src/components/Cyclr/              (ContextBar, EntityPicker, PathParamPicker,
                                                       PartnerCredentialsModal, ConnectionsModal, useCyclrList)
packages/bruno-app/src/utils/cyclr/                   (registry.js, prepare-request.js + specs)
packages/bruno-app/src/providers/ReduxStore/slices/cyclr.js (+ spec)
packages/bruno-electron/src/ipc/cyclr/                (index.js, store.js, client.js + spec)
modified: RequestPane/QueryParams/index.js, RequestTabPanel/index.js, ReduxStore/index.js,
          slices/collections/actions.js, slices/collections/index.js, bruno-electron/src/index.js
```

Base: upstream `usebruno/bruno` at commit `14d5a00db`.

## Running it

```bash
npm run setup                                   # first time
node scripts/cyclr/generate-collection.mjs      # only if cyclr_api.json changed
npm run dev                                     # web dev server on :3000
# If Electron doesn't open (dev.js can't parse the port when output is redirected):
cd packages/bruno-electron && BRUNO_DEV_PORT=3000 npm run dev
```

Then open `cyclr-collection/` in Bruno via Collections ⋮ → Open Collection.

- **Restarts**: main-process changes (`bruno-electron`) need Electron restarted. On Windows, kill leftover `electron.exe` processes first. Renderer changes hot-reload.
- **Tests**:
  - `cd packages/bruno-electron && npx jest src/ipc/cyclr`
  - `cd packages/bruno-app && npx jest src/utils/cyclr src/providers/ReduxStore/slices/cyclr`

## Gotchas found so far

- **Settings migration**: electron-store writes its defaults into an existing file before `migrate()` runs, so `schemaVersion` must not be in the defaults. It's now v3. `fillBlankDefaults()` fills in blank base URLs and webhook IDs for the built-in stacks at startup.
- **Cyclr collections**: a collection counts as Cyclr only if `bruno.json` has `"cyclr": { "enabled": true }`.

## Open questions / ideas

- If the admin cycle could return partner credentials (another `requesttype`), the manual client ID and secret step could go.
- The webhook IDs are hard-coded in `store.js`. Keep this fork private, or move them to config.
- Nothing has been tried against US2 yet.
