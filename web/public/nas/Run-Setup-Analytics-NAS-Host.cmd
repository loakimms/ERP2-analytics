@echo off
setlocal
set "POWERSHELL_EXE=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not exist "%POWERSHELL_EXE%" set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL_EXE%" (
  echo PowerShell executable was not found.
  pause
  exit /b 1
)

set "TARGET=%~dp0Setup-Analytics-NAS-Host.ps1"
if not exist "%TARGET%" set "TARGET=%USERPROFILE%\Downloads\Analytics-NAS-Host\Setup-Analytics-NAS-Host.ps1"

if not exist "%TARGET%" (
  echo Setup-Analytics-NAS-Host.ps1 was not found.
  echo Extract Analytics-NAS-Host-bundle.zip to "%USERPROFILE%\Downloads\Analytics-NAS-Host" first,
  echo or place this launcher next to Setup-Analytics-NAS-Host.ps1 and run it again.
  pause
  exit /b 1
)

"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%TARGET%" %*
exit /b %ERRORLEVEL%
