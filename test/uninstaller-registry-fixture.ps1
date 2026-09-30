param([ValidateSet('create','delete','get','setRun','getRun','deleteRun')][string]$Action)
$ErrorActionPreference='Stop'
$r=[Console]::In.ReadToEnd() | ConvertFrom-Json
if ($r.key -notmatch '^NTC-Disposable-[a-f0-9-]+$') { throw 'Fixture key required' }
$view=if ($r.view -eq 32) { [Microsoft.Win32.RegistryView]::Registry32 } else { [Microsoft.Win32.RegistryView]::Registry64 }
$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
$path='Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$r.key
try {
  if ($Action -eq 'create') { $k=$base.CreateSubKey($path); try { foreach ($p in $r.values.PSObject.Properties) { $k.SetValue($p.Name,$p.Value,[Microsoft.Win32.RegistryValueKind]::String) } } finally { $k.Dispose() } }
  if ($Action -eq 'delete') { $base.DeleteSubKeyTree($path,$false) }
  if ($Action -eq 'get') { $k=$base.OpenSubKey($path); @{exists=($null -ne $k)} | ConvertTo-Json -Compress; if($k){$k.Dispose()} }
  if ($Action -in @('setRun','getRun','deleteRun')) { $k=$base.CreateSubKey('Software\Microsoft\Windows\CurrentVersion\Run'); try { if($Action -eq 'setRun'){$k.SetValue($r.key,$r.command,[Microsoft.Win32.RegistryValueKind]::String)}; if($Action -eq 'getRun'){@{value=$k.GetValue($r.key)}|ConvertTo-Json -Compress}; if($Action -eq 'deleteRun'){$k.DeleteValue($r.key,$false)} }finally{$k.Dispose()} }
} finally { $base.Dispose() }
