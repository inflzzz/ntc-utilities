param([ValidateSet('create','get','delete')][string]$Action)
$ErrorActionPreference='Stop'
$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
if($r.key -notmatch '^NTC-Disposable-[a-f0-9-]+$'){throw 'Unique disposable name required'}
$allowed=Join-Path $env:LOCALAPPDATA 'ntc-uninstaller-tests'
$exe=[IO.Path]::GetFullPath($r.exe)
if(-not $exe.StartsWith($allowed+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Disposable scope required'}
$name=$r.key
$scheduler=New-Object -ComObject Schedule.Service
$scheduler.Connect()
$folder=$scheduler.GetFolder('\')
$policy=New-Object -ComObject HNetCfg.FwPolicy2
$shortcut=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) ($name+'.lnk')
$classes='HKCU:\Software\Classes\'+$name
if($Action -eq 'create'){
  & sc.exe create $name binPath= ('"'+$exe+'"') start= demand obj= LocalSystem | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Disposable service creation failed'}
  & sc.exe description $name 'NTC disposable description' | Out-Null
  $definition=$scheduler.NewTask(0)
  $definition.Principal.UserId=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $definition.Principal.LogonType=3
  $definition.Settings.Enabled=$true
  $definition.Actions.Create(0).Path=$exe
  $folder.RegisterTaskDefinition($name,$definition,2,$definition.Principal.UserId,$null,3,$null)|Out-Null
  $rule=New-Object -ComObject HNetCfg.FWRule
  $rule.Name=$name;$rule.Description='NTC disposable firewall';$rule.ApplicationName=$exe
  $rule.Protocol=6;$rule.LocalPorts='48931';$rule.RemotePorts='*';$rule.Direction=1
  $rule.Enabled=$false;$rule.Action=1;$rule.Profiles=7
  $policy.Rules.Add($rule)
  $shell=New-Object -ComObject WScript.Shell
  $link=$shell.CreateShortcut($shortcut);$link.TargetPath=$exe;$link.Save()
  New-Item -Path ($classes+'\shell\open\command') -Force | Out-Null
  Set-Item -LiteralPath ($classes+'\shell\open\command') -Value ('"'+$exe+'" "%1"')
}
if($Action -eq 'get'){
  $service=Get-Service -Name $name -ErrorAction SilentlyContinue
  $task=$null;try{$task=$folder.GetTask($name)}catch{}
  $rule=$null;try{$rule=$policy.Rules.Item($name)}catch{}
  $commandKey=Get-Item ($classes+'\shell\open\command') -ErrorAction SilentlyContinue
  @{service=($null -ne $service);description=(Get-ItemProperty ('HKLM:\SYSTEM\CurrentControlSet\Services\'+$name) -ErrorAction SilentlyContinue).Description;task=($null -ne $task);taskEnabled=($task -and $task.Enabled);firewall=($null -ne $rule);ports=if($rule){$rule.LocalPorts}else{''};shortcut=(Test-Path -LiteralPath $shortcut);command=if($commandKey){$commandKey.GetValue('')}else{''}} | ConvertTo-Json -Compress
}
if($Action -eq 'delete'){
  & sc.exe delete $name | Out-Null
  try{$folder.DeleteTask($name,0)}catch{}
  try{$policy.Rules.Remove($name)}catch{}
  if(Test-Path -LiteralPath $shortcut){Remove-Item -LiteralPath $shortcut -Force}
  if(Test-Path -LiteralPath $classes){Remove-Item -LiteralPath $classes -Recurse -Force}
}
