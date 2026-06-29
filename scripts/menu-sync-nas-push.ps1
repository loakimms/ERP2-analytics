<#
.SYNOPSIS
  로컬 API에서 메뉴 동기화 번들을 생성하고 NAS API에 반영

.DESCRIPTION
  - 로컬 API `/menu-sync/export`에서 zip 번들을 다운로드한다.
  - 생성한 zip을 로컬 artifacts 폴더에 저장한다.
  - 저장한 zip을 NAS API `/menu-sync/import`로 업로드한다.

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\menu-sync-nas-push.ps1 `
    -LocalApiBaseUrl http://localhost:5189 `
    -NasApiBaseUrl http://192.168.0.50:6188/api `
    -MenuIds @('review_qna') `
    -LocalBearerToken '<ops_admin token>' `
    -NasBearerToken '<ops_admin token>'
#>
param(
  [string] $LocalApiBaseUrl = 'http://localhost:5189',
  [string] $NasApiBaseUrl = 'http://192.168.0.50:6188/api',
  [string[]] $MenuIds = @('review_qna'),
  [string] $MenuIdsJson = '',
  [string] $BundleFileName = '',
  [string] $OutDir = 'artifacts\menu-sync',
  [string] $LocalBearerToken = '',
  [string] $NasBearerToken = '',
  [string] $DateFrom = '',
  [string] $DateTo = '',
  [string[]] $TargetDates = @(),
  [string] $TargetDatesJson = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }

function Resolve-StringArray([string[]] $Values, [string] $JsonText) {
  if (-not [string]::IsNullOrWhiteSpace($JsonText)) {
    try {
      $parsed = $JsonText | ConvertFrom-Json
      if ($parsed -is [System.Collections.IEnumerable] -and -not ($parsed -is [string])) {
        return @($parsed | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
      }
      $single = [string]$parsed
      if (-not [string]::IsNullOrWhiteSpace($single)) {
        return @($single)
      }
      return @()
    } catch {
      throw "Invalid JSON array text: $JsonText"
    }
  }
  return @($Values | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

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
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path

$resolvedMenuIds = @(Resolve-StringArray -Values $MenuIds -JsonText $MenuIdsJson)
$resolvedTargetDates = @(Resolve-StringArray -Values $TargetDates -JsonText $TargetDatesJson)

if (-not $resolvedMenuIds -or $resolvedMenuIds.Count -eq 0) {
  throw "At least one MenuId is required."
}

$exportScript = Join-Path $scriptDir 'menu-sync-local-export.ps1'
if (-not (Test-Path -LiteralPath $exportScript)) {
  throw "Export script not found: $exportScript"
}

$importScript = Join-Path $scriptDir 'menu-sync-nas-import.ps1'
if (-not (Test-Path -LiteralPath $importScript)) {
  throw "Import script not found: $importScript"
}

Write-Info "Export bundle into project artifacts"
$exportArgs = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $exportScript,
  '-LocalApiBaseUrl', $LocalApiBaseUrl,
  '-MenuIdsJson', ($resolvedMenuIds | ConvertTo-Json -Compress)
)
$exportArgs += @('-OutDir', $OutDir)
if ($BundleFileName) { $exportArgs += @('-BundleFileName', $BundleFileName) }
if ($LocalBearerToken) { $exportArgs += @('-BearerToken', $LocalBearerToken) }
if ($DateFrom) { $exportArgs += @('-DateFrom', $DateFrom) }
if ($DateTo) { $exportArgs += @('-DateTo', $DateTo) }
if ($resolvedTargetDates -and $resolvedTargetDates.Count -gt 0) {
  $exportArgs += @('-TargetDatesJson', ($resolvedTargetDates | ConvertTo-Json -Compress))
}
$exportOutput = (& pwsh @exportArgs 2>&1 | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) {
  throw "Export script failed (exit=$LASTEXITCODE): $exportOutput"
}
$exportResult = Try-ParseJsonFromOutput $exportOutput
if (-not ($exportResult -is [hashtable])) {
  throw "Export script returned no JSON result."
}
$bundlePath = [string]($exportResult['bundlePath'] ?? '')
if (-not $bundlePath) {
  throw "Export script returned empty bundlePath."
}

Write-Info "Import bundle into NAS"
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
  throw "NAS import script failed (exit=$LASTEXITCODE): $importOutput"
}
$importResult = Try-ParseJsonFromOutput $importOutput
if (-not ($importResult -is [hashtable])) {
  throw "NAS import script returned no JSON result."
}

$result = @{
  ok = $true
  action = 'menu-sync-push'
  bundlePath = $bundlePath
  bundleFileName = [string]($exportResult['bundleFileName'] ?? [System.IO.Path]::GetFileName($bundlePath))
  menus = @($resolvedMenuIds)
  date_from = $DateFrom
  date_to = $DateTo
  target_dates = @($resolvedTargetDates)
  imported_tables = @($importResult['imported_tables'])
  export_response = $exportResult
  import_response = $importResult
}

Write-Info "Done."
$result | ConvertTo-Json -Compress -Depth 10
