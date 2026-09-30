param([Parameter(Mandatory=$true)][ValidateSet('appx','removeAppx','restorePoint')][string]$Action)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  switch ($Action) {
    'appx' {
      $items = @(Get-AppxPackage | ForEach-Object {
        @{ name=$_.Name; version=$_.Version.ToString(); publisher=$_.Publisher; package=$_.PackageFullName; location=$_.InstallLocation; architecture=$_.Architecture.ToString(); protected=([bool]$_.NonRemovable -or [bool]$_.IsFramework -or [bool]$_.IsResourcePackage -or $_.Name -match '^Microsoft\.(Windows|AAD|Accounts|LockApp|Bio|Cred|SecHealth|Services|VCLibs|NET|UI\.Xaml)'); framework=[bool]$_.IsFramework; source='Get-AppxPackage · usuário atual' }
      })
      @{ items=$items } | ConvertTo-Json -Depth 8 -Compress
    }
    'removeAppx' {
      if ($request.package -notmatch '^[A-Za-z0-9_.-]+_[A-Za-z0-9_.-]+$') { throw 'Identidade de pacote inválida.' }
      $p = @(Get-AppxPackage | Where-Object { $_.PackageFullName -ceq $request.package })
      if ($p.Count -ne 1 -or $p[0].NonRemovable -or $p[0].IsFramework -or $p[0].IsResourcePackage -or $p[0].Name -match '^Microsoft\.(Windows|AAD|Accounts|LockApp|Bio|Cred|SecHealth|Services|VCLibs|NET|UI\.Xaml)') { throw 'Pacote ausente ou protegido.' }
      Remove-AppxPackage -Package $p[0].PackageFullName -ErrorAction Stop
      @{ removed=(@(Get-AppxPackage | Where-Object { $_.PackageFullName -ceq $request.package }).Count -eq 0) } | ConvertTo-Json -Compress
    }
    'restorePoint' {
      # Confirm an actual new point rather than assuming cmdlet success (frequency limiting).
      $before = @(Get-ComputerRestorePoint -ErrorAction Stop | Select-Object -ExpandProperty SequenceNumber)
      Checkpoint-Computer -Description 'NTC Utilities — Desinstalador' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop
      $new = @(Get-ComputerRestorePoint -ErrorAction Stop | Where-Object { $_.SequenceNumber -notin $before })
      if ($new.Count -eq 0) { throw 'O Windows não criou um novo ponto. A proteção pode estar desabilitada ou o limite de frequência foi atingido.' }
      @{ created=$true; sequence=$new[-1].SequenceNumber } | ConvertTo-Json -Compress
    }
  }
} catch { @{ error=$_.Exception.Message } | ConvertTo-Json -Compress; exit 1 }
