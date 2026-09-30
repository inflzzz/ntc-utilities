# Minimal per-user MSI: only a disposable registry value, never production files.
param([string]$Root,[string]$Product,[string]$Key)
$ErrorActionPreference='Stop'
$rootPath=[IO.Path]::GetFullPath($Root)
$allowed=Join-Path $env:LOCALAPPDATA 'ntc-uninstaller-tests'
if(-not $rootPath.StartsWith($allowed+'\',[StringComparison]::OrdinalIgnoreCase) -or $Key -notmatch '^NTC-Disposable-[a-f0-9-]+$' -or $Product -notmatch '^\{[a-f0-9-]{36}\}$'){throw 'Disposable MSI scope required'}
$msi=Join-Path $rootPath 'fixture.msi'
$installer=New-Object -ComObject WindowsInstaller.Installer
$db=$installer.OpenDatabase($msi,3)
function Sql([string]$query){$v=$db.OpenView($query);$v.Execute();$v.Close()}
function Insert([string]$table,[string[]]$values){$columns=switch($table){Property{'`Property`,`Value`'};Directory{'`Directory`,`Directory_Parent`,`DefaultDir`'};Component{'`Component`,`ComponentId`,`Directory_`,`Attributes`,`Condition`,`KeyPath`'};Feature{'`Feature`,`Feature_Parent`,`Title`,`Description`,`Display`,`Level`,`Directory_`,`Attributes`'};FeatureComponents{'`Feature_`,`Component_`'};Registry{'`Registry`,`Root`,`Key`,`Name`,`Value`,`Component_`'};InstallExecuteSequence{'`Action`,`Condition`,`Sequence`'}};$escaped=@($values|ForEach-Object { "'"+$_.Replace("'","''")+"'" });Sql ('INSERT INTO `'+$table+'` ('+$columns+') VALUES ('+($escaped -join ',')+')')}
Sql 'CREATE TABLE `Property` (`Property` CHAR(72) NOT NULL, `Value` CHAR(0) LOCALIZABLE PRIMARY KEY `Property`)'
Sql 'CREATE TABLE `Directory` (`Directory` CHAR(72) NOT NULL, `Directory_Parent` CHAR(72), `DefaultDir` CHAR(255) NOT NULL LOCALIZABLE PRIMARY KEY `Directory`)'
Sql 'CREATE TABLE `Component` (`Component` CHAR(72) NOT NULL, `ComponentId` CHAR(38), `Directory_` CHAR(72) NOT NULL, `Attributes` SHORT NOT NULL, `Condition` CHAR(255), `KeyPath` CHAR(72) PRIMARY KEY `Component`)'
Sql 'CREATE TABLE `Feature` (`Feature` CHAR(38) NOT NULL, `Feature_Parent` CHAR(38), `Title` CHAR(64) LOCALIZABLE, `Description` CHAR(255) LOCALIZABLE, `Display` SHORT, `Level` SHORT NOT NULL, `Directory_` CHAR(72), `Attributes` SHORT NOT NULL PRIMARY KEY `Feature`)'
Sql 'CREATE TABLE `FeatureComponents` (`Feature_` CHAR(38) NOT NULL, `Component_` CHAR(72) NOT NULL PRIMARY KEY `Feature_`, `Component_`)'
Sql 'CREATE TABLE `Registry` (`Registry` CHAR(72) NOT NULL, `Root` SHORT NOT NULL, `Key` CHAR(255) NOT NULL LOCALIZABLE, `Name` CHAR(255) LOCALIZABLE, `Value` CHAR(0) LOCALIZABLE, `Component_` CHAR(72) NOT NULL PRIMARY KEY `Registry`)'
Sql 'CREATE TABLE `InstallExecuteSequence` (`Action` CHAR(72) NOT NULL, `Condition` CHAR(255), `Sequence` SHORT PRIMARY KEY `Action`)'
Sql 'CREATE TABLE `Media` (`DiskId` SHORT NOT NULL, `LastSequence` LONG NOT NULL, `DiskPrompt` CHAR(64) LOCALIZABLE, `Cabinet` CHAR(255), `VolumeLabel` CHAR(32), `Source` CHAR(72) PRIMARY KEY `DiskId`)'
$properties=@{ProductCode=$Product;ProductName=$Key;ProductVersion='1.0.0';Manufacturer='NTC Disposable Fixtures';ProductLanguage='1033';UpgradeCode=('{'+[guid]::NewGuid()+'}');INSTALLLEVEL='1';ARPINSTALLLOCATION=$rootPath}
$properties.GetEnumerator() | ForEach-Object {Insert 'Property' @($_.Key,$_.Value)}
Insert 'Directory' @('TARGETDIR','','SourceDir')
Insert 'Component' @('FixtureRegistry',('{'+[guid]::NewGuid()+'}'),'TARGETDIR','4','','FixtureValue')
Insert 'Feature' @('Main','','Disposable','','1','1','','0')
Insert 'FeatureComponents' @('Main','FixtureRegistry')
Insert 'Registry' @('FixtureValue','1',('Software\'+$Key),'Marker','Disposable only','FixtureRegistry')
$sequence=@{CostInitialize=800;FileCost=900;CostFinalize=1000;InstallValidate=1400;InstallInitialize=1500;ProcessComponents=1600;UnpublishFeatures=1800;RemoveRegistryValues=2600;WriteRegistryValues=5000;RegisterProduct=6100;PublishFeatures=6300;PublishProduct=6400;InstallFinalize=6600}
$sequence.GetEnumerator()|ForEach-Object {Insert 'InstallExecuteSequence' @($_.Key,'',[string]$_.Value)}
$summary=$db.SummaryInformation(20)
$summary.Property(2)='NTC disposable MSI';$summary.Property(3)='Test fixture';$summary.Property(7)='Intel;1033';$summary.Property(9)=('{'+[guid]::NewGuid()+'}');$summary.Property(14)=200;$summary.Property(15)=2
$summary.Persist();$db.Commit()
