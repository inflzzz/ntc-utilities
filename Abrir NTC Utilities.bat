@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo O NTC Utilities ainda nao foi instalado.
  echo Execute "pnpm install" nesta pasta uma vez e tente novamente.
  pause
  exit /b 1
)

start "NTC Utilities" "%~dp0node_modules\electron\dist\electron.exe" "."
