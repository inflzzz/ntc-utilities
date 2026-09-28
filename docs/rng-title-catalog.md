# NTC RNG title catalog

`content/rng-title-catalog.json` is the canonical catalog for the shipped RNG titles. It is loaded by the local RNG and exported to the Echo Edge Function with:

```sh
node scripts/generate-echo-title-catalog.cjs
```

Every `id` is permanent identity, not display text. Never rename, recycle, or remove a published ID. To rename or edit a title, keep its ID and change its fields. To retire one, keep its row and set `acquisition` to `unobtainable` (and `active` to `false`); ownership and discovery history remain keyed by the same ID. To restore it, publish a new catalog version and change its lifecycle fields. A new title is a new row with a new stable ID.

`version` is the immutable catalog revision. Increment it for any published-content change before syncing to Supabase. `bootstrapExpectedCount` is the count expected only for the initial v1 bootstrap, not a permanent catalog-size limit. Current odds are held in `baseWeight`/`baseDenominator`; descriptions, acquisition mode (`normal`, `event`, `limited`, `exclusive`, or `unobtainable`), activity, collection eligibility, `eventId`, `assetId`, and `presentationId` are data fields.

Only active `normal` rows enter the ordinary roll pool. Event/limited/exclusive acquisition still needs its corresponding game/event grant path; the catalog models and preserves those identities but does not invent an event schedule or grant rule. Display names and tiers are copied into discovery snapshots at acquisition so later edits do not rewrite historical presentation. Older saves cannot recover historical labels that were never stored; their first normalization uses the current catalog values.

The server stores immutable catalog versions and rejects a version whose contents change, a version rollback, or a later version that omits an already-published ID. Catalog synchronization is separate from Echo progression; keep `progression_enabled` false and the Cron paused until the catalog is reviewed and intentionally activated.
