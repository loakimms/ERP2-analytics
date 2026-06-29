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

function Read-LockTag([string] $LockPath) {
  if (-not (Test-Path -LiteralPath $LockPath)) { throw ("lock file missing: " + $LockPath) }
  $line = Get-Content -LiteralPath $LockPath -Encoding utf8 | Where-Object { ($_ -match '^\s*ANALYTICS_IMAGE_TAG\s*=') } | Select-Object -First 1
  if (-not $line) { throw ("ANALYTICS_IMAGE_TAG missing in lock: " + $LockPath) }
  return (($line -split '=', 2)[1]).Trim()
}

$repoRoot = Get-RepoRoot
Set-Location -Path $repoRoot | Out-Null
Assert-CanonicalRoot -RepoRoot $repoRoot

$projectName = 'analytics_master'
$composeFile = 'docker\\analytics.master.yml'
$candidateLock = 'docker\\analytics.candidate.lock'
$envLocal = Join-Path $repoRoot 'docker\\env.analytics.local'

# Firebase Admin SDK env (전체 사용자 목록용)
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

# 로컬 env: ADMIN_TEST_MODE 등 / Firebase Admin
$envFileArgs = @('--env-file', $candidateLock)
if (Test-Path -LiteralPath $envLocal) { $envFileArgs += '--env-file', $envLocal }
if ($firebaseAdminEnv) { $envFileArgs += '--env-file', $firebaseAdminEnv }

$webUrl = 'http://localhost:5188'
$apiUrl = 'http://localhost:5189'
$dbContainerName = 'analytics-master-db'

$tag = Read-LockTag $candidateLock
Write-Info ("Switch stack to candidate tag=" + $tag)

Write-Info 'Ensure: analytics-db up (do NOT recreate)'
docker compose -p $projectName -f $composeFile @envFileArgs up -d analytics-db --pull never --remove-orphans
Assert-LastExitOk 'docker compose up (db)'

Write-Info 'Wait: analytics-db healthy (max 60s)'
for ($i=1; $i -le 30; $i++) {
  $st = ''
  try { $st = (docker inspect -f '{{.State.Health.Status}}' $dbContainerName 2>$null | Out-String).Trim() } catch { $st = '' }
  $st2 = $st
  if (-not $st2) { $st2 = '(unknown)' }
  Write-Info ("[db] " + $i + " " + $st2)
  if ($st -match 'healthy') { break }
  Start-Sleep -Seconds 2
}

Write-Info 'Switch: recreate analytics-web/analytics-api with candidate tag'
docker compose -p $projectName -f $composeFile @envFileArgs up -d --no-deps --force-recreate analytics-web analytics-api --pull never --remove-orphans
Assert-LastExitOk 'docker compose up (candidate web/api)'

Write-Info 'Verify: containers'
docker compose -p $projectName -f $composeFile @envFileArgs ps

Write-Info ('Verify: web version.json -> ' + $webUrl + '/version.json')
try {
  $vj = Invoke-RestMethod -Method GET -Uri ($webUrl + '/version.json') -TimeoutSec 10
  $appVersion = ''
  try { if ($null -ne $vj.appVersion) { $appVersion = [string] $vj.appVersion } } catch { $appVersion = '' }
  $imageTag = ''
  try { if ($null -ne $vj.imageTag) { $imageTag = [string] $vj.imageTag } } catch { $imageTag = '' }
  if (-not $appVersion -and -not $imageTag) { throw 'version.json missing appVersion/imageTag' }
  if ($imageTag -and ($imageTag -ne $tag)) { throw ("version.json imageTag mismatch: expected=" + $tag + " actual=" + $imageTag) }
  Write-Info ("version.json appVersion=" + $appVersion + " imageTag=" + $imageTag)
} catch {
  throw ("web version.json verify failed: " + $_.Exception.Message)
}

Write-Info ('Verify: api health -> ' + $apiUrl + '/health')
try {
  $h = $null
  $lastErr = $null
  for ($i=0; $i -lt 15; $i++) {
    try {
      $h = Invoke-RestMethod -Method GET -Uri ($apiUrl + '/health') -TimeoutSec 5
      $lastErr = $null
      break
    } catch {
      $lastErr = $_.Exception
      Start-Sleep -Seconds 2
    }
  }
  if ($null -eq $h) { throw ("health request failed: " + [string] $lastErr) }
  $status = ''
  try { if ($null -ne $h.status) { $status = [string] $h.status } } catch { $status = '' }
  if ($status -ne 'ok') { throw 'health.status != ok' }
} catch {
  throw ("api health verify failed: " + $_.Exception.Message)
}

Write-Info ('Verify: api version -> ' + $apiUrl + '/api/version')
try {
  $v = $null
  $lastErr2 = $null
  for ($i=0; $i -lt 15; $i++) {
    try {
      $v = Invoke-RestMethod -Method GET -Uri ($apiUrl + '/api/version') -TimeoutSec 5
      $lastErr2 = $null
      break
    } catch {
      $lastErr2 = $_.Exception
      Start-Sleep -Seconds 2
    }
  }
  if ($null -eq $v) { throw ("version request failed: " + [string] $lastErr2) }
  $vTag = ''
  try { if ($null -ne $v.imageTag) { $vTag = [string] $v.imageTag } } catch { $vTag = '' }
  if (-not $vTag) { throw 'api version missing imageTag' }
  if ($vTag -ne $tag) { throw ("api version imageTag mismatch: expected=" + $tag + " actual=" + $vTag) }
  Write-Info ("api version imageTag=" + $vTag)
} catch {
  throw ("api version verify failed: " + $_.Exception.Message)
}

Write-Info 'VERIFY_OK'

