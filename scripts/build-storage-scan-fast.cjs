const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.log('Fast scanner helper is Windows-only; other platforms use the standard scanner.');
  process.exit(0);
}

const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const source = path.join(__dirname, '..', 'src', 'storage-scan-fast.cs');
const outputDir = path.join(__dirname, '..', 'resources', 'bin');
const output = path.join(outputDir, 'storage-scan-fast.exe');
if (!fs.existsSync(compiler)) throw new Error('Compilador .NET Framework 64-bit não encontrado para montar o helper de enumeração.');
fs.mkdirSync(outputDir, { recursive: true });
const result = spawnSync(compiler, ['/nologo', '/optimize+', '/target:exe', `/out:${output}`, source], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log('Helper de enumeração Windows compilado em resources/bin.');
