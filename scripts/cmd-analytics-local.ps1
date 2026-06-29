# Analytics 로컬 기동만 (빌드 없음, ERP2-dev scripts/cmd-erp2-local.ps1 구조와 동일)
# - 기동 폴더: C:\dev\ERP2-analytics
# - lock 파일(analytics.master.lock)의 태그로 기동
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }

Set-Location -Path (Split-Path -Parent $PSCommandPath) | Out-Null
Set-Location -Path (Resolve-Path ..) | Out-Null

$projectName = 'analytics_master'
$composeFile = 'docker\analytics.master.yml'
$lockFile = 'docker\analytics.master.lock'
$envLocal = Join-Path (Get-Location) 'docker\env.analytics.local'

Write-Info "Analytics local up (no build): project=$projectName compose=$composeFile lock=$lockFile"

$envFileArgs = @('--env-file', $lockFile)
if (Test-Path -LiteralPath $envLocal) { $envFileArgs += '--env-file', $envLocal }

docker compose -p $projectName -f $composeFile @envFileArgs up -d --pull never --remove-orphans

Write-Info 'Done.'
Write-Info 'Open: http://localhost:5188 (web), http://localhost:5189/health (api)'
