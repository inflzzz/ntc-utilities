'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TITLES, TIERS, CATALOG_VERSION, BOOTSTRAP_EXPECTED_COUNT } = require('../src/rng.cjs');

const ranks = new Map(TIERS.map(tier => [tier.id, tier.rank]));
const rows = TITLES.map(title => ({
  id: title.id,
  name: title.name,
  description: title.description || '',
  tier: title.tier,
  tier_rank: ranks.get(title.tier),
  base_weight: title.baseWeight.toString(),
  base_denominator: title.denominator?.toString() || '',
  acquisition: title.acquisition,
  active: title.active,
  collection_eligible: title.collectionEligible !== false,
  event_id: title.eventId || '',
  asset_id: title.assetId || '',
  presentation_id: title.presentationId || title.tier
}));

if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('IDs duplicados no catálogo de títulos.');
const output = path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'echo-title-catalog.json');
fs.writeFileSync(output, `${JSON.stringify({ version: CATALOG_VERSION, bootstrapExpectedCount: BOOTSTRAP_EXPECTED_COUNT, titles: rows })}\n`, 'utf8');
process.stdout.write(`Catálogo v${CATALOG_VERSION} · ${rows.length} títulos → ${path.relative(process.cwd(), output)}\n`);
