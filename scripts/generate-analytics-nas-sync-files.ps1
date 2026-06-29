<#
.SYNOPSIS
  NAS 동기화에 필요한 파일 묶음(zip) 생성

.DESCRIPTION
  - docker/analytics.master.lock 태그(SoT)를 기준으로
    docker/analytics.nas.master.lock 을 동일 태그로 동기화한다.
  - docker/analytics.nas.master.yml(고정 파일명)과,
    혼선 방지용 아카이브 사본(docker/analytics.nas.master.<tag>.yml)을 포함한다.
  - NAS로 "코드 동기화" 또는 "이미지+lock 배포" 전에,
    필요한 파일을 한 번에 전달할 수 있도록 zip 산출물을 만든다.

.OUTPUTS
  artifacts\nas-sync\analytics_nas_sync_files_<tag>_<timestamp>.zip

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\generate-analytics-nas-sync-files.ps1
#>
param(
  [string] $OutDir = 'artifacts\nas-sync'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Step([string] $m) { Write-Host "==> $m" -ForegroundColor Cyan }

function Get-RepoRoot {
  return (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) '..')).Path
}

function Read-LockTag([string] $LockPath) {
  $line = Get-Content -LiteralPath $LockPath | Where-Object { ($_ -match '^\s*ANALYTICS_IMAGE_TAG\s*=') } | Select-Object -First 1
  if (-not $line) { throw "ANALYTICS_IMAGE_TAG not found: $LockPath" }
  $tag = (($line -split '=', 2)[1]).Trim()
  if (-not $tag) { throw "ANALYTICS_IMAGE_TAG is empty: $LockPath" }
  return $tag
}

$repoRoot = Get-RepoRoot
Push-Location $repoRoot | Out-Null

try {
  $masterLock = Join-Path $repoRoot 'docker\analytics.master.lock'
  $nasLock = Join-Path $repoRoot 'docker\analytics.nas.master.lock'
  $nasCompose = Join-Path $repoRoot 'docker\analytics.nas.master.yml'

  if (-not (Test-Path -LiteralPath $masterLock)) { throw "Missing: $masterLock" }
  if (-not (Test-Path -LiteralPath $nasCompose)) { throw "Missing: $nasCompose" }

  $tag = Read-LockTag $masterLock
  $safeTag = $tag -replace '[\\/:*?"<>|]', '_'
  $ts = Get-Date -Format 'yyyyMMdd_HHmmss'

  Write-Step "Sync NAS lock from master (tag=$tag)"
  $masterContent = Get-Content -LiteralPath $masterLock -Raw
  Set-Content -LiteralPath $nasLock -Value $masterContent -Encoding UTF8 -NoNewline

  $nasComposeArchive = Join-Path $repoRoot ("docker\analytics.nas.master.{0}.yml" -f $safeTag)
  if (-not (Test-Path -LiteralPath $nasComposeArchive)) {
    Write-Step "Create archive compose: $nasComposeArchive"
    Copy-Item -LiteralPath $nasCompose -Destination $nasComposeArchive -Force
  } else {
    Write-Info "Archive compose exists: $nasComposeArchive"
  }

  $outRoot = Join-Path $repoRoot $OutDir
  $outStage = Join-Path $outRoot ("stage_{0}_{1}" -f $safeTag, $ts)
  New-Item -ItemType Directory -Force -Path $outStage | Out-Null

  $readme = @"
Analytics NAS 동기화 공유 파일 묶음

- 생성 시각: $ts
- 이미지 태그(SoT): $tag

포함 파일(핵심):
- docker\analytics.nas.master.lock  (SoT: ANALYTICS_IMAGE_TAG=$tag)
- docker\analytics.nas.master.yml   (NAS compose 고정 파일명)
- docker\analytics.nas.master.$safeTag.yml (혼선 방지용 사본)

동기화(코드): scripts\cmd-analytics-nas-sync.ps1
- SMB: PowerShell에서 `$env:NAS_SMB_PASSWORD='***' 설정 후 실행
- SSH(키 인증): -SyncViaSsh 옵션 사용

배포(이미지+lock+compose, SSH): scripts\deploy-analytics-nas.ps1
검증(원격에서 tar/lock/yml + compose up 확인): scripts\verify-analytics-nas-after-copy.ps1
"@
  Set-Content -LiteralPath (Join-Path $outStage 'README_NAS_SYNC.txt') -Value $readme -Encoding UTF8 -NoNewline

  $filesToCopy = @(
    'docker\analytics.nas.master.lock',
    'docker\analytics.nas.master.yml',
    ("docker\analytics.nas.master.{0}.yml" -f $safeTag),
    'scripts\cmd-analytics-nas-sync.ps1',
    'scripts\deploy-analytics-nas.ps1',
    'scripts\upload-nas-lock.ps1',
    'scripts\verify-analytics-nas-after-copy.ps1'
  )

  foreach ($rel in $filesToCopy) {
    $src = Join-Path $repoRoot $rel
    if (-not (Test-Path -LiteralPath $src)) { throw "Missing required file: $src" }
    $dst = Join-Path $outStage $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }

  $zipPath = Join-Path $outRoot ("analytics_nas_sync_files_{0}_{1}.zip" -f $safeTag, $ts)
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

  Write-Step "Create zip: $zipPath"
  Compress-Archive -Path (Join-Path $outStage '*') -DestinationPath $zipPath -Force

  Write-Info "Done."
  Write-Info "Zip: $zipPath"
} finally {
  Pop-Location | Out-Null
}

