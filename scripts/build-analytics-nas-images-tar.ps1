<#
.SYNOPSIS
  Analytics NAS 배포용 이미지 tar 생성(docker save)만 수행.

.DESCRIPTION
  - NAS에서는 빌드하지 않는다(로컬에서 이미지 tar 생성 후 NAS로 반영).
  - 실행 태그(SoT)는 docker/analytics.master.lock의 ANALYTICS_IMAGE_TAG 이다.
  - 결과물: repo root에 analytics_images_<tag>.tar 생성

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-analytics-nas-images-tar.ps1

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-analytics-nas-images-tar.ps1 -ForceSave
#>
param(
  [switch] $ForceSave
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Step([string] $m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Assert-Ok([string] $what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit=$LASTEXITCODE)" } }

$repoRoot = (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) '..')).Path
Push-Location $repoRoot | Out-Null

try {
  $masterLock = Join-Path $repoRoot 'docker\analytics.master.lock'
  if (-not (Test-Path -LiteralPath $masterLock)) { throw "Missing lock: $masterLock" }

  $tagLine = Get-Content -LiteralPath $masterLock | Where-Object { $_ -match '^\s*ANALYTICS_IMAGE_TAG\s*=' } | Select-Object -First 1
  if (-not $tagLine) { throw 'ANALYTICS_IMAGE_TAG not found in master lock' }
  $tag = ($tagLine -split '=', 2)[1].Trim()
  if (-not $tag) { throw 'ANALYTICS_IMAGE_TAG is empty' }
  $safeTag = $tag -replace '[^0-9A-Za-z_.-]', '_'

  $tarName = "analytics_images_$safeTag.tar"
  $tarLocal = Join-Path $repoRoot $tarName

  $webImage = "analytics-analytics-web:$tag"
  $apiImage = "analytics-analytics-api:$tag"

  $shouldSave = $true
  if (-not $ForceSave) {
    try {
      if (Test-Path -LiteralPath $tarLocal) {
        $len = (Get-Item -LiteralPath $tarLocal).Length
        if ($len -ge 50MB) { $shouldSave = $false }
      }
    } catch { $shouldSave = $true }
  }

  if ($shouldSave) {
    Write-Step "docker save -> $tarName (web+api)  tag=$tag"
    & docker save -o $tarLocal $webImage $apiImage
    Assert-Ok 'docker save'
  } else {
    Write-Step "Reuse existing tar (skip docker save): $tarName"
  }

  if (-not (Test-Path -LiteralPath $tarLocal)) { throw "Tar missing: $tarLocal" }
  $bytes = (Get-Item -LiteralPath $tarLocal).Length
  if ($bytes -lt 50MB) { throw "Tar too small (truncated?): $tarLocal bytes=$bytes" }

  Write-Info "tag=$tag"
  Write-Info "tar=$tarLocal"
  Write-Info "tarBytes=$bytes"
}
finally {
  Pop-Location | Out-Null
}

