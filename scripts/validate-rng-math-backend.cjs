'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const backendRoot = path.join(root, 'resources', 'ntc-math-backend', '1.3.2');
const manifest = JSON.parse(fs.readFileSync(path.join(backendRoot, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const checks = [];
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function check(ok, message) { checks.push({ ok: Boolean(ok), message }); }

check(packageJson.devDependencies?.['gmp-wasm'] === '1.3.2', 'gmp-wasm is pinned as exact devDependency 1.3.2');
check(manifest.backendId === 'ntc-mpfr-gmp-wasm' && manifest.backendVersion === '1.3.2', 'versioned backend manifest identity');
check(manifest.gmpVersion === '6.3.0' && manifest.mpfrVersion === '4.2.1', 'GMP/MPFR source versions pinned');
check(/^[a-f0-9]{64}$/.test(manifest.runtimeSha256), 'manifest contains a canonical runtime SHA-256');
check(crypto.createHash('sha256').update(fs.readFileSync(require.resolve('gmp-wasm'))).digest('hex') === manifest.runtimeSha256, 'installed runtime bytes match the versioned manifest hash');
for (const item of Object.values(manifest.sourceMaterials || {})) {
  const file = path.join(backendRoot, item.path);
  check(fs.existsSync(file) && sha256(file) === item.sha256, `source material hash: ${path.basename(file)}`);
}
for (const file of ['LICENSE-gmp-wasm.txt', 'NOTICE.md', 'REBUILD.md']) {
  check(fs.existsSync(path.join(backendRoot, file)), `distribution notice present: ${file}`);
}
check(manifest.precisionPolicy?.directedRounding?.join(',') === 'RNDD,RNDU', 'directed-rounding policy declared');
check(['mpfr_log10', 'mpfr_pow', 'mpfr_get_z_2exp'].every(name => manifest.capabilities.includes(name)), 'required MPFR operations declared');

const failed = checks.filter(item => !item.ok);
for (const result of checks) process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'} ${result.message}\n`);
if (failed.length) process.exitCode = 1;
else process.stdout.write(`Validated isolated MPFR backend packaging inputs (${checks.length} checks).\n`);
