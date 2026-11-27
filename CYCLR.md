# Cyclr customisations

This fork adds a Cyclr-aware layer to Bruno: switch stacks/partners, then pick Accounts, Cycles, Steps and every other ID from cascading dropdowns fed by the Cyclr API.

## Quick start

```bash
npm run setup                                  # first time only
node scripts/cyclr/generate-collection.mjs     # writes ./cyclr-collection from ./cyclr_api.json
npm run dev                                    # launch Bruno
```

In Bruno, open `cyclr-collection/` as a collection and open any request:

1. Pick a **Stack** in the bar above the URL. It sets the partner API base URL. Stacks are edited under **Stack ▾ → Cyclr settings…**.
2. Pick a **Partner**. The list comes from that stack's admin webhook (`POST {"requesttype":"listpartners"}`), which is IP-restricted, so you need to be on the office network or VPN. The first time you pick a partner you're asked for its API client ID and secret. They are tested on save, and the key icon next to the partner edits them later.
3. Pick the IDs the request needs. Only the chips it uses appear, along with their parents: `/Cycles/:id/steps` shows **Account → Cycle**, and a Step request adds **Step**. Each list comes from the matching List endpoint, scoped by the chips before it. Changing a parent clears its children; changing stack or partner clears everything. Values for hidden chips are kept for other requests.
4. Send. The OAuth token is fetched or refreshed automatically, and `{{cyclr_*}}` variables are filled in from your selections.
5. In the **Params** tab, the list icon next to a path parameter opens the same picker for that parameter, e.g. `fieldId`, `systemName` or `versionedCycleId`.

Default stacks are UK, EU, US and US2, with their admin webhook IDs. The admin webhook base URL is in `packages/bruno-electron/src/ipc/cyclr/store.js`; a stack's webhook field also accepts a full URL.

## How it fits together

| Piece | Where |
| --- | --- |
| Entity registry: what each path param means, which list feeds it, what it depends on | `packages/bruno-app/src/utils/cyclr/registry.js` |
| Context bar (partner + cascading chips) | `packages/bruno-app/src/components/Cyclr/ContextBar` |
| Searchable, virtualised picker | `packages/bruno-app/src/components/Cyclr/EntityPicker` |
| Path param picker in the Params tab | `packages/bruno-app/src/components/Cyclr/PathParamPicker` |
| Redux state (config + per-collection selections) | `packages/bruno-app/src/providers/ReduxStore/slices/cyclr.js` |
| Inject token / base URL / ids at send time | `packages/bruno-app/src/utils/cyclr/prepare-request.js` (called from `sendRequest` and the runner) |
| Main process: credentials, tokens, paging, cache | `packages/bruno-electron/src/ipc/cyclr/` |
| Collection generator | `scripts/cyclr/generate-collection.mjs` |

A collection is treated as Cyclr when its `bruno.json` has `"cyclr": { "enabled": true }`.

### Large lists

- Lists are fetched in the Electron main process with 50 rows per page. When the API returns a `Total-Pages` header, the remaining pages are fetched 4 at a time; otherwise pages are fetched one by one until a short page comes back. The picker fills in as pages arrive.
- Only `{ id, label, sub }` per row crosses IPC. The picker is virtualised with `react-virtuoso`, and search filters on the client.
- Nothing is fetched until a picker is opened.
- Results are cached in memory and on disk (`<userData>/cyclr-cache`) with a time-to-live per entity: 1 minute for transactions, 5 for cycles and steps, 30 for connectors. A stale list shows immediately and refreshes in the background. Use the refresh button in a picker to force a refresh, or **Clear list cache** in the dialog.
- Transactions are capped at the 250 most recent. Type any ID in the search box and choose **Use "…" as the ID** to go beyond that.

### Secrets

Partner client secrets are stored per stack + partner ID in `<userData>/cyclr.json`, encrypted with Electron `safeStorage` (the OS keychain), and are never sent to the renderer. Tokens live only in main-process memory and are added to a request when it is sent.

### Adding or changing a picker

Add an entry to `ENTITIES` in `registry.js`, with its list path, `requires`, ID and label fields. If the path param name is new, map it in `NAMED_PARAM_ENTITIES` or `SEGMENT_ENTITIES`. Then re-run the generator so requests use the new `{{cyclr_*}}` variable.
