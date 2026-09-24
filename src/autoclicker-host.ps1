$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
Add-Type -AssemblyName System.Web.Extensions
Add-Type -Path (Join-Path $PSScriptRoot 'autoclicker-host.cs') -ReferencedAssemblies @('System.Web.Extensions.dll')
if ($args -contains '--check') { Write-Output 'AUTOCLICKER_HOST_COMPILED'; exit 0 }
[NtcAutoClickHost]::Run()
