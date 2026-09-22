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
  Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $archive
  Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
  $ffmpegSource = Get-ChildItem -Path $extract -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
  $ffprobeSource = Get-ChildItem -Path $extract -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1
  if (-not $ffmpegSource -or -not $ffprobeSource) { throw 'Não foi possível localizar FFmpeg e FFprobe no arquivo baixado.' }
  Copy-Item -LiteralPath $ffmpegSource.FullName -Destination $ffmpeg -Force
  Copy-Item -LiteralPath $ffprobeSource.FullName -Destination $ffprobe -Force
}

Write-Host 'Binários internos prontos para o instalador.'
