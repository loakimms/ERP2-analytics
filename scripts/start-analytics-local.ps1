# Analytics 로컬 빌드+기동 (ERP2-dev scripts/start-local.ps1 구조와 동일)
# - 기동 폴더: C:\dev\ERP2-analytics
# - lock 파일(analytics.master.lock 또는 analytics.candidate.lock)이 단일 진실(SoT)
$ErrorActionPreference = 'Stop'
Set-Location -Path (Split-Path -Parent $PSCommandPath) | Out-Null
Set-Location -Path (Resolve-Path ..) | Out-Null

function Get-RepoRoot {
    return (Resolve-Path (Get-Location).Path).Path
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

function Resolve-LockFile([string] $RepoRoot) {
    $candidate = Join-Path $RepoRoot 'docker\analytics.candidate.lock'
    $master = Join-Path $RepoRoot 'docker\analytics.master.lock'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    if (Test-Path -LiteralPath $master) { return $master }
    throw "lock 파일이 없습니다: docker/analytics.candidate.lock 또는 docker/analytics.master.lock (먼저 scripts/analytics_build_candidate.ps1 실행)"
}

function Resolve-DockerPath {
    $cmd = Get-Command docker -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $default = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
    if (Test-Path $default) { return $default }
    return $null
}

function Wait-DockerEngine([int] $Seconds = 120) {
    $docker = Resolve-DockerPath
    if (-not $docker) { return $false }
    for ($i = 0; $i -lt $Seconds; $i += 2) {
        try {
            & $docker version | Out-Null
            & $docker info | Out-Null
            return $true
        } catch { Start-Sleep -Seconds 2 }
    }
    return $false
}

function Ensure-DockerOnPath {
    $docker = Resolve-DockerPath
    if (-not $docker) { return }
    $dir = [System.IO.Path]::GetDirectoryName($docker)
    if ($env:PATH -notlike "*$dir*") { $env:PATH = "$dir;$env:PATH" }
    $plugins = Join-Path $dir '..\cli-plugins' | Resolve-Path -ErrorAction SilentlyContinue
    if ($plugins) { if ($env:PATH -notlike "*$plugins*") { $env:PATH = "$plugins;$env:PATH" } }
}

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]] $ArgsList)
    Ensure-DockerOnPath
    $docker = Resolve-DockerPath
    if ($docker) { & $docker compose @ArgsList; return }
    $dc1 = Get-Command docker-compose -ErrorAction SilentlyContinue
    if ($dc1) { & $dc1.Source @ArgsList; return }
    throw 'Docker CLI를 찾지 못했습니다. Docker Desktop 실행 후 새 PowerShell을 열어 다시 시도하세요.'
}

function Import-EnvFile([string] $Path) {
    if (-not (Test-Path $Path)) { return }
    Write-Host "==> Loading env from $Path"
    Get-Content -Raw -Path $Path | ForEach-Object {
        $_ -split "`n" | ForEach-Object {
            $line = $_.Trim(); if (-not $line) { return }
            if ($line.StartsWith('#')) { return }
            $idx = $line.IndexOf('='); if ($idx -lt 1) { return }
            $key = $line.Substring(0, $idx).Trim()
            $val = $line.Substring($idx + 1).Trim()
            if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                $val = $val.Substring(1, $val.Length - 2)
            }
            [Environment]::SetEnvironmentVariable($key, $val)
            Set-Item -Path Env:$key -Value $val | Out-Null
        }
    }
}

$repoRoot = Get-RepoRoot
Assert-CanonicalRoot -RepoRoot $repoRoot
$lockFile = Resolve-LockFile -RepoRoot $repoRoot

# env.web.local: Firebase Web (VITE_FIREBASE_*)
if (Test-Path (Join-Path $repoRoot 'env.web.local')) { Import-EnvFile (Join-Path $repoRoot 'env.web.local') }
elseif (Test-Path (Join-Path $repoRoot 'env.web')) { Import-EnvFile (Join-Path $repoRoot 'env.web') }
elseif (Test-Path 'C:\dev\ERP2-dev\env.web.local') { Import-EnvFile 'C:\dev\ERP2-dev\env.web.local' }

# lock 파일이 단일 진실(SoT)
Import-EnvFile $lockFile

# env.analytics.local: API 오버라이드(ADMIN_TEST_MODE 등)
$envAnalytics = Join-Path $repoRoot 'docker\env.analytics.local'
if (Test-Path -LiteralPath $envAnalytics) { Import-EnvFile $envAnalytics }

# Vite 빌드용
if (-not $env:VITE_IMAGE_TAG -and $env:ANALYTICS_IMAGE_TAG) { $env:VITE_IMAGE_TAG = $env:ANALYTICS_IMAGE_TAG }
if (-not $env:VITE_APP_VERSION -and $env:ANALYTICS_IMAGE_TAG) { $env:VITE_APP_VERSION = $env:ANALYTICS_IMAGE_TAG }
if (-not $env:VITE_ANALYTICS_API_BASE_URL) { $env:VITE_ANALYTICS_API_BASE_URL = '/api' }
if (-not $env:VITE_FIREBASE_PROJECT_ID -and $env:FIREBASE_PROJECT_ID) { $env:VITE_FIREBASE_PROJECT_ID = $env:FIREBASE_PROJECT_ID }

# Firebase Web 필수
if (-not $env:VITE_FIREBASE_API_KEY -or -not $env:VITE_FIREBASE_PROJECT_ID) {
    throw "Firebase Web 설정이 필요합니다. env.web.local 또는 C:\dev\ERP2-dev\env.web.local에 VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID를 설정하세요."
}

# data 폴더 생성
$dataDir = Join-Path $repoRoot 'data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
$dbDir = Join-Path $dataDir 'analytics_db'
$browserDir = Join-Path $dataDir 'analytics_browser_data'
if (-not (Test-Path $dbDir)) { New-Item -ItemType Directory -Path $dbDir | Out-Null }
if (-not (Test-Path $browserDir)) { New-Item -ItemType Directory -Path $browserDir | Out-Null }

Write-Host '==> Building and starting analytics local stack (analytics-db, analytics-api, analytics-web)'
if (-not (Wait-DockerEngine -Seconds 180)) { Write-Error 'Docker Desktop가 아직 실행되지 않았습니다.' }

# Firebase Admin SDK env (전체 사용자 목록용)
$firebaseAdminCandidates = @(
  (Join-Path $repoRoot 'docker\env.firebase.admin.local'),
  (Join-Path $repoRoot 'env.firebase-admin.local'),
  'C:\dev\ERP2-dev\env.firebase-admin.local',
  'C:\dev\ERP2-dev\docker\.env.api.local'
)
$firebaseAdminEnv = $null
foreach ($p in $firebaseAdminCandidates) {
  if ($p -and (Test-Path -LiteralPath $p)) { $firebaseAdminEnv = $p; break }
}

$envArgs = @('--env-file', $lockFile)
if (Test-Path -LiteralPath $envAnalytics) { $envArgs += '--env-file', $envAnalytics }
if ($firebaseAdminEnv) { $envArgs += '--env-file', $firebaseAdminEnv }

Invoke-Compose -ArgsList (@('-f', 'docker/analytics.local.yml', '-f', 'docker/analytics.local.override.yml') + $envArgs + @('up', '-d', '--build'))

Write-Host '==> Health check'
Start-Sleep -Seconds 3
try { curl.exe -sS http://localhost:5189/health | Out-Null; Write-Host 'API /health OK' } catch { Write-Warn 'API health check pending (retry: curl http://localhost:5189/health)' }

Write-Host 'Done.'
Write-Host 'Web: http://localhost:5188  API: http://localhost:5189  DB: localhost:5442'
