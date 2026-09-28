'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseEnvFile, isPublishableKey } = require('../src/rng-online.cjs');

const root = path.resolve(__dirname, '..');
const localPath = path.join(root, '.env.online.local');
let local = {};
try { local = parseEnvFile(fs.readFileSync(localPath, 'utf8')); } catch {}

const config = {
  SUPABASE_URL: process.env.SUPABASE_URL || local.SUPABASE_URL || '',
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || local.SUPABASE_PUBLISHABLE_KEY || ''
};
if (config.SUPABASE_PUBLISHABLE_KEY && !isPublishableKey(config.SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error('SUPABASE_PUBLISHABLE_KEY deve ser uma Publishable Key sb_publishable_...; configuração privilegiada recusada.');
}
const destination = path.join(root, 'src', 'rng-online-config.generated.cjs');
fs.writeFileSync(destination, `'use strict';\nmodule.exports = Object.freeze(${JSON.stringify(config)});\n`, { mode: 0o600 });
if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) {
  process.stderr.write('NTC Online: SUPABASE_URL/ SUPABASE_PUBLISHABLE_KEY ausentes; o app empacotado ficará offline.\n');
}
