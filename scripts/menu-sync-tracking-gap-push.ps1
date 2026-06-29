<#
.SYNOPSIS
  내 상품 추적 데이터의 로컬/NAS 결측 날짜를 분석하고, 누락된 날짜만 NAS에 반영

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\menu-sync-tracking-gap-push.ps1 `
    -LocalApiBaseUrl http://localhost:5189 `
    -NasApiBaseUrl http://192.168.0.50:6188/api `
    -DateFrom 2026-01-01 `
    -DateTo 2026-12-31 `
    -LocalBearerToken '<ops_admin token>' `
    -NasBearerToken '<ops_admin token>'
#>
param(
  [string] $LocalApiBaseUrl = 'http://localhost:5189',
  [string] $NasApiBaseUrl = 'http://192.168.0.50:6188/api',
  [string] $DateFrom = '',
  [string] $DateTo = '',
  [string] $BundleFileName = '',
  [string] $OutDir = 'artifacts\menu-sync',
  [string] $LocalBearerToken = '',
  [string] $NasBearerToken = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }

function Try-ParseJsonFromOutput([string] $text) {
  $raw = [string]($text ?? '')
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  $lines = @($raw -split "`r?`n")
  [array]::Reverse($lines)
  foreach ($line in $lines) {
    $candidate = [string]($line ?? '').Trim()
    if (-not $candidate) { continue }
    if (-not ($candidate.StartsWith('{') -or $candidate.StartsWith('['))) { continue }
    try {
      return ($candidate | ConvertFrom-Json -AsHashtable)
    } catch {
      continue
    }
  }
  return $null
}

$scriptDir = Split-Path -Parent $PSCommandPath
$analyzeScript = Join-Path $scriptDir 'menu-sync-tracking-gap-analyze.ps1'
$exportScript = Join-Path $scriptDir 'menu-sync-local-export.ps1'
$importScript = Join-Path $scriptDir 'menu-sync-nas-import.ps1'

Write-Info 'Analyze local/NAS gaps'
$analyzeArgs = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $analyzeScript,
  '-LocalApiBaseUrl', $LocalApiBaseUrl,
  '-NasApiBaseUrl', $NasApiBaseUrl
)
if ($DateFrom) { $analyzeArgs += @('-DateFrom', $DateFrom) }
if ($DateTo) { $analyzeArgs += @('-DateTo', $DateTo) }
if ($LocalBearerToken) { $analyzeArgs += @('-LocalBearerToken', $LocalBearerToken) }
if ($NasBearerToken) { $analyzeArgs += @('-NasBearerToken', $NasBearerToken) }
$analyzeOutput = (& pwsh @analyzeArgs 2>&1 | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) {
  throw "Gap analyze failed (exit=$LASTEXITCODE): $analyzeOutput"
}
$analyzeResult = Try-ParseJsonFromOutput $analyzeOutput
if (-not ($analyzeResult -is [hashtable])) {
  throw 'Gap analyze returned no JSON result.'
}

$missingDates = @($analyzeResult['missing_dates'])
if (-not $missingDates -or $missingDates.Count -eq 0) {
  $noop = @{
    ok = $true
    action = 'menu-sync-tracking-gap-push'
    skipped = $true
    detail = 'no_missing_dates'
    analysis_response = $analyzeResult
    missing_dates = @()
  }
  $noop | ConvertTo-Json -Compress -Depth 10
  exit 0
}

Write-Info "Export missing dates: $($missingDates -join ', ')"
$exportArgs = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $exportScript,
  '-LocalApiBaseUrl', $LocalApiBaseUrl,
  '-MenuIds', 'product_tracking',
  '-OutDir', $OutDir,
  '-TargetDates'
)
$exportArgs += $missingDates
if ($BundleFileName) { $exportArgs += @('-BundleFileName', $BundleFileName) }
if ($DateFrom) { $exportArgs += @('-DateFrom', $DateFrom) }
if ($DateTo) { $exportArgs += @('-DateTo', $DateTo) }
if ($LocalBearerToken) { $exportArgs += @('-BearerToken', $LocalBearerToken) }
$exportOutput = (& pwsh @exportArgs 2>&1 | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) {
  throw "Export failed (exit=$LASTEXITCODE): $exportOutput"
}
$exportResult = Try-ParseJsonFromOutput $exportOutput
if (-not ($exportResult -is [hashtable])) {
  throw 'Export returned no JSON result.'
}

$bundlePath = [string]($exportResult['bundlePath'] ?? '')
if (-not $bundlePath) {
  throw 'Export returned empty bundlePath.'
}

Write-Info 'Import missing-date bundle into NAS'
$importArgs = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $importScript,
  '-BundlePath', $bundlePath,
  '-NasApiBaseUrl', $NasApiBaseUrl
)
if ($NasBearerToken) { $importArgs += @('-BearerToken', $NasBearerToken) }
$importOutput = (& pwsh @importArgs 2>&1 | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) {
  throw "Import failed (exit=$LASTEXITCODE): $importOutput"
}
$importResult = Try-ParseJsonFromOutput $importOutput
if (-not ($importResult -is [hashtable])) {
  throw 'Import returned no JSON result.'
}

$result = @{
  ok = $true
  action = 'menu-sync-tracking-gap-push'
  skipped = $false
  missing_dates = @($missingDates)
  bundlePath = $bundlePath
  bundleFileName = [string]($exportResult['bundleFileName'] ?? [System.IO.Path]::GetFileName($bundlePath))
  analysis_response = $analyzeResult
  export_response = $exportResult
  import_response = $importResult
  imported_tables = @($importResult['imported_tables'])
}

$result | ConvertTo-Json -Compress -Depth 10
