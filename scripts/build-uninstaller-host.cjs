const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'win32') { console.log('Desinstalador: helper exclusivo do Windows.'); process.exit(0); }
const root = path.join(__dirname, '..');
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const out = path.join(root, 'resources', 'bin');
fs.mkdirSync(out, { recursive: true });
const result = spawnSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/r:System.Web.Extensions.dll', '/r:System.Management.dll', '/r:System.ServiceProcess.dll', '/r:System.Drawing.dll', '/r:Microsoft.CSharp.dll', `/out:${path.join(out, 'uninstaller-host.exe')}`, path.join(root, 'src', 'uninstaller-host.cs'), path.join(root, 'src', 'uninstaller-icons.cs')], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status) process.exit(result.status);
fs.copyFileSync(path.join(root, 'src', 'uninstaller-windows.ps1'), path.join(out, 'uninstaller-windows.ps1'));
console.log('Helper do Desinstalador e ponte Windows incluídos em resources/bin.');
