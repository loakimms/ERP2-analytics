<#
.SYNOPSIS
  NAS 배포용 Docker 이미지 tar 생성 (docker save)

.DESCRIPTION
  - SoT: docker/analytics.master.lock 의 ANALYTICS_IMAGE_TAG
  - 대상 이미지(로컬에 존재해야 함):
    - analytics-analytics-web:<tag>
    - analytics-analytics-api:<tag>
  - 산출물:
    - C:\dev\ERP2-analytics\analytics_images_<tag>.tar

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\generate-analytics-nas-images-tar.ps1
#>
param(
  [int64] $MinTarBytes = 300MB
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Step([string] $m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Assert-Ok([string] $what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit=$LASTEXITCODE)" } }

function Get-RepoRoot {
  return (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) '..')).Path
}

function Read-LockTag([string] $LockPath) {
  if (-not (Test-Path -LiteralPath $LockPath)) { throw "Missing lock: $LockPath" }
  $line = Get-Content -LiteralPath $LockPath | Where-Object { ($_ -match '^\s*ANALYTICS_IMAGE_TAG\s*=') } | Select-Object -First 1
  if (-not $line) { throw "ANALYTICS_IMAGE_TAG not found in lock: $LockPath" }
  $tag = (($line -split '=', 2)[1]).Trim()
  if (-not $tag) { throw "ANALYTICS_IMAGE_TAG is empty in lock: $LockPath" }
  return $tag
}

$repoRoot = Get-RepoRoot
Push-Location $repoRoot | Out-Null
try {
  $masterLock = Join-Path $repoRoot 'docker\analytics.master.lock'
  $tag = Read-LockTag $masterLock
  $safeTag = $tag -replace '[\\/:*?"<>|]', '_'

  $webImage = "analytics-analytics-web:$tag"
  $apiImage = "analytics-analytics-api:$tag"

  Write-Step "Check local images exist (tag=$tag)"
  & docker image inspect $webImage *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Missing local image: $webImage (먼저 규칙대로 재빌드/검증: scripts/analytics_rebuild_and_verify.ps1)"
  }
  & docker image inspect $apiImage *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Missing local image: $apiImage (먼저 규칙대로 재빌드/검증: scripts/analytics_rebuild_and_verify.ps1)"
  }

  $tarPath = Join-Path $repoRoot ("analytics_images_{0}.tar" -f $safeTag)
  if (Test-Path -LiteralPath $tarPath) {
    Write-Info "Remove existing tar: $tarPath"
    Remove-Item -LiteralPath $tarPath -Force
  }

  Write-Step "docker save -> $tarPath"
  & docker save -o $tarPath $webImage $apiImage
  Assert-Ok 'docker save'

  if (-not (Test-Path -LiteralPath $tarPath)) { throw "Tar not created: $tarPath" }
  $len = (Get-Item -LiteralPath $tarPath).Length
  Write-Info ("Tar bytes = " + $len)
  if ($len -lt $MinTarBytes) {
    throw ("Tar looks too small (possible truncated). bytes={0}, path={1}" -f $len, $tarPath)
  }

  Write-Info "Done."
  Write-Info ("Tar: " + $tarPath)
} finally {
  Pop-Location | Out-Null
}

