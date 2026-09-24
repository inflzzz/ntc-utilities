$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'resources\bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

$ytDlp = Join-Path $bin 'yt-dlp.exe'
if (-not (Test-Path $ytDlp)) {
  Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $ytDlp
}

$ffmpeg = Join-Path $bin 'ffmpeg.exe'
$ffprobe = Join-Path $bin 'ffprobe.exe'
if (-not (Test-Path $ffmpeg) -or -not (Test-Path $ffprobe)) {
  $archive = Join-Path $env:TEMP 'ntc-ffmpeg.zip'
  $extract = Join-Path $env:TEMP 'ntc-ffmpeg'
  Invoke-WebRequest -Uri 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/autobuild-2026-07-31-16-16/ffmpeg-N-125875-g5d4d3bdc61-win64-gpl.zip' -OutFile $archive
  Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
  $ffmpegSource = Join-Path $extract 'ffmpeg-N-125875-g5d4d3bdc61-win64-gpl\bin\ffmpeg.exe'
  $ffprobeSource = Join-Path $extract 'ffmpeg-N-125875-g5d4d3bdc61-win64-gpl\bin\ffprobe.exe'
  if (-not $ffmpegSource -or -not $ffprobeSource) { throw 'Não foi possível localizar FFmpeg e FFprobe no arquivo baixado.' }
  if (-not (Test-Path $ffmpegSource) -or -not (Test-Path $ffprobeSource)) { throw 'O pacote fixado não contém FFmpeg e FFprobe nos caminhos esperados.' }
  $expectedHashes = @{
    $ffmpegSource = '851AA8EA5366B5AF33C0681CC292D662829C7088E9AC96F6E9B37030E6835BA4'
    $ffprobeSource = '01DD9A776DB5DF93D0E3A9B8714A7A7500402E8E628CDC68608ED781454F8B71'
  }
  foreach ($source in @($ffmpegSource, $ffprobeSource)) {
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $expectedHashes[$source]) { throw "A verificação SHA-256 falhou para $source." }
  }
  Copy-Item -LiteralPath $ffmpegSource -Destination $ffmpeg -Force
  Copy-Item -LiteralPath $ffprobeSource -Destination $ffprobe -Force
}

Write-Host 'Binários internos prontos para o instalador.'
