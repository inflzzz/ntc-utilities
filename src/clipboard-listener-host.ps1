$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Web.Extensions
Add-Type -Path (Join-Path $PSScriptRoot 'clipboard-listener-host.cs') -ReferencedAssemblies @('System.Windows.Forms.dll', 'System.Web.Extensions.dll')
if ($args -contains '--check') { Write-Output 'CLIPBOARD_LISTENER_COMPILED'; exit 0 }
[NtcClipboardListenerHost]::Run()
