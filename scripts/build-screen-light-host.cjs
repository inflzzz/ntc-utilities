const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.log('Luz da Tela é exclusiva do Windows.');
  process.exit(0);
}

const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
if (!fs.existsSync(vswhere)) throw new Error('Visual Studio Build Tools não encontrado para compilar o helper nativo.');
const found = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true });
if (found.status !== 0 || !found.stdout.trim()) throw new Error('Compilador MSVC x64 não encontrado.');
const vars = path.join(found.stdout.trim(), 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
if (!fs.existsSync(vars)) throw new Error('Ambiente de compilação MSVC x64 não encontrado.');
const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'resources', 'bin');
fs.mkdirSync(outputDir, { recursive: true });
const source = path.join(root, 'src', 'screen-light-host.cpp');
const output = path.join(outputDir, 'screen-light-host.exe');
const command = `call "${vars}" >nul && cl /nologo /O2 /EHsc /std:c++17 /utf-8 /MT /DUNICODE /D_UNICODE "${source}" /Fe:"${output}" /link user32.lib gdi32.lib`;
const result = spawnSync('cmd.exe', ['/d', '/c', command], { cwd: outputDir, stdio: 'inherit', windowsHide: true, windowsVerbatimArguments: true });
if (result.error) throw result.error;
if (result.status !== 0 || !fs.existsSync(output)) process.exit(result.status || 1);
console.log(`Helper nativo compilado: ${output}`);
