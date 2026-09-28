'use strict';

// One-time bootstrap helper: exports the currently shipped RNG catalog without
// changing its IDs, names, tiers, or effective base weights.
const fs = require('node:fs');
const path = require('node:path');
const { TITLES, TIERS } = require('../src/rng.cjs');

const catalog = {
  version: 1,
  bootstrapExpectedCount: 200,
  tiers: TIERS.map((tier, rank) => ({ id: tier.id, label: tier.label, rank })),
  titles: TITLES.map(title => ({
    id: title.id,
    name: title.name,
    description: '',
    tier: title.tier,
    baseDenominator: title.denominator?.toString() ?? null,
    baseWeight: title.baseWeight.toString(),
    acquisition: 'normal',
    active: true,
    eventId: null,
    assetId: `tier-${title.tier}`,
    presentationId: title.tier
  }))
};

const output = path.join(__dirname, '..', 'content', 'rng-title-catalog.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
process.stdout.write(`Exported ${catalog.titles.length} titles to ${path.relative(process.cwd(), output)}\n`);
