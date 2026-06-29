param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }
function Assert-LastExitOk([string] $what) { if ($LASTEXITCODE -ne 0) { throw ($what + " failed (exit=" + $LASTEXITCODE + ")") } }

# NAS-mode는 환경(포트/인증 강제)만 NAS처럼 시뮬레이션하고,
# 기능/버그픽스는 master와 동일 이미지 태그로 검증하는 것이 안전하다.
function Read-LockTag([string] $LockPath) {
  try {
    if (-not (Test-Path -LiteralPath $LockPath)) { return '' }
    $line = Get-Content -LiteralPath $LockPath | Where-Object { ($_ -match '^\s*ANALYTICS_IMAGE_TAG\s*=') } | Select-Object -First 1
    if (-not $line) { return '' }
    return (($line -split '=', 2)[1]).Trim()
  } catch { return '' }
}

function Sync-NasLockFromMaster([string] $RepoRoot, [string] $NasLockPath) {
  $masterLockPath = Join-Path $RepoRoot 'docker\analytics.master.lock'
  if (-not (Test-Path -LiteralPath $masterLockPath)) { return }
  $masterTag = Read-LockTag $masterLockPath
  if (-not $masterTag) { return }

  $nasTag = Read-LockTag $NasLockPath
  if ($nasTag -ne $masterTag) {
    $from = $nasTag
    if (-not $from) { $from = '(empty)' }
    Write-Info ("NAS lock tag differs from master. Sync: " + $from + " -> " + $masterTag)
    Copy-Item -Force -LiteralPath $masterLockPath -Destination $NasLockPath
  }
}

# Firebase Admin SDK(사용자관리) env 로드 (NAS-mode 로컬 시뮬레이션용)
function Import-FirebaseAdminEnv {
  if ($env:FIREBASE_PROJECT_ID -and $env:FIREBASE_CLIENT_EMAIL -and $env:FIREBASE_PRIVATE_KEY) { return }

  $repoRoot = (Get-Location).Path
  $candidates = @(
    (Join-Path $repoRoot 'docker\env.firebase.admin.local'),
    (Join-Path $repoRoot 'env.firebase-admin.local'),
    (Join-Path $repoRoot 'docker\.env.api.nas'),
    (Join-Path $repoRoot '.env'),
    'C:\dev\ERP2-dev\env.firebase-admin.local',
    'C:\dev\ERP2-dev\docker\.env.api.local'
  )

  $envFile = $null
  foreach ($p in $candidates) {
    if (Test-Path -LiteralPath $p) { $envFile = $p; break }
  }
  if (-not $envFile) { return }

  $lines = Get-Content -LiteralPath $envFile -ErrorAction Stop
  foreach ($line in $lines) {
    $t = ('' + $line).Trim()
    if (-not $t) { continue }
    if ($t.StartsWith('#')) { continue }
    if ($t -notmatch '=') { continue }
    $k = $t.Split('=')[0].Trim()
    $v = (($t -split '=', 2)[1]).Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }

    if ($k -in @('FIREBASE_PROJECT_ID','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY','FIREBASE_PRIVATE_KEY_ID','FIREBASE_AUTH_CLOCK_SKEW_SECONDS','USE_FIREBASE_ADMIN_VERIFY')) {
      if ($v -and -not (Get-Item -Path ("Env:" + $k) -ErrorAction SilentlyContinue)) {
        Set-Item -Path ("Env:" + $k) -Value $v
      } elseif ($v -and -not ('' + (Get-Item -Path ("Env:" + $k) -ErrorAction SilentlyContinue).Value).Trim()) {
        Set-Item -Path ("Env:" + $k) -Value $v
      }
    }
  }
}

# repo root (ERP2-analytics)
Set-Location -Path (Split-Path -Parent $PSCommandPath) | Out-Null
Set-Location -Path (Resolve-Path ..) | Out-Null

# NOTE:
# - 이 스크립트는 "NAS 모드 구성(포트/인증 강제)"을 로컬 Docker에서 띄우는 용도다.
# - 실제 NAS 서버 배포/기동은 별도(SSH/DSM 환경) 절차가 필요하다.
$projectName = 'analytics_nas'
$composeFile = 'docker/analytics.nas.master.yml'
$lockFile = 'docker/analytics.nas.master.lock'

Import-FirebaseAdminEnv
Sync-NasLockFromMaster -RepoRoot (Get-Location).Path -NasLockPath (Join-Path (Get-Location).Path $lockFile)

Write-Info "Analytics NAS-mode up (local docker): project=$projectName compose=$composeFile lock=$lockFile"
docker compose -p $projectName -f $composeFile --env-file $lockFile up -d --pull never --remove-orphans
Assert-LastExitOk 'docker compose up (analytics nas-mode)'

# env 변경 반영을 위해 API 컨테이너는 재생성
docker compose -p $projectName -f $composeFile --env-file $lockFile up -d --no-deps --force-recreate --pull never --remove-orphans analytics-api
Assert-LastExitOk 'docker compose up (analytics nas-mode api force-recreate)'

Write-Info 'Done.'
Write-Info 'Open: http://localhost:6188 (web), http://localhost:6189/health (api)'
Write-Info 'Debug port: http://localhost:29222 (Playwright CDP)'
