param(
  [ValidateSet('local')]
  [string] $Target = 'local'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }
function Assert-LastExitOk([string] $what) { if ($LASTEXITCODE -ne 0) { throw ($what + " failed (exit=" + $LASTEXITCODE + ")") } }

function Get-RepoRoot {
  $sd = Split-Path -Parent $PSCommandPath
  return (Resolve-Path (Join-Path $sd '..')).Path
}

function Assert-CanonicalRoot([string] $RepoRoot) {
  $sentinel = Join-Path $RepoRoot 'CANONICAL_ROOT.txt'
  if (-not (Test-Path -LiteralPath $sentinel)) { return }
  $expected = (Get-Content -LiteralPath $sentinel -TotalCount 1 -ErrorAction Stop).Trim()
  if (-not $expected) { return }
  if ($RepoRoot -ne $expected) {
    throw ("이 폴더는 CANONICAL_ROOT.txt에 의해 실행이 차단되었습니다. expected='" + $expected + "' actual='" + $RepoRoot + "' (단일 폴더 운영 원칙)")
  }
}

$repoRoot = Get-RepoRoot
Set-Location -Path $repoRoot | Out-Null
Assert-CanonicalRoot -RepoRoot $repoRoot

$projectName = 'analytics_master'
$composeFile = 'docker\\analytics.master.yml'
$masterLock = 'docker\\analytics.master.lock'
$envLocal = Join-Path $repoRoot 'docker\\env.analytics.local'

# Firebase Admin SDK(사용자관리 전체 목록) env - 없으면 ADMIN_TEST_MODE에서 본인만 표시
$firebaseAdminCandidates = @(
  (Join-Path $repoRoot 'docker\\env.firebase.admin.local'),
  (Join-Path $repoRoot 'env.firebase-admin.local'),
  'C:\dev\ERP2-dev\env.firebase-admin.local',
  'C:\dev\ERP2-dev\docker\.env.api.local'
)
$firebaseAdminEnv = $null
foreach ($p in $firebaseAdminCandidates) {
  if ($p -and (Test-Path -LiteralPath $p)) { $firebaseAdminEnv = $p; break }
}

# 로컬 env: ADMIN_TEST_MODE 등 / Firebase Admin(전체 사용자 목록용)
$envFileArgs = @('--env-file', $masterLock)
if (Test-Path -LiteralPath $envLocal) { $envFileArgs += '--env-file', $envLocal }
if ($firebaseAdminEnv) { $envFileArgs += '--env-file', $firebaseAdminEnv }

Write-Info 'Up analytics-db'
docker compose -p $projectName -f $composeFile @envFileArgs up -d analytics-db --pull never --remove-orphans
Assert-LastExitOk 'docker compose up (db)'

Write-Info 'Up analytics-web/analytics-api (no build)'
docker compose -p $projectName -f $composeFile @envFileArgs up -d --no-deps --force-recreate analytics-web analytics-api --pull never --remove-orphans
Assert-LastExitOk 'docker compose up (web/api)'

docker compose -p $projectName -f $composeFile @envFileArgs ps
Write-Info 'DONE'

