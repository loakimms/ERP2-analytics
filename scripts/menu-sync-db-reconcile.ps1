<#
.SYNOPSIS
  로컬/NAS 양쪽 DB를 같은 상태로 맞추기 위해 양방향 메뉴 동기화를 수행

.DESCRIPTION
  - 로컬 API에서 선택 메뉴 번들을 export 후 NAS API에 import
  - NAS API에서 같은 메뉴 번들을 export 후 로컬 API에 import
  - import는 서버의 메뉴별 정책(insert-missing/upsert)에 따르며, 기본 목적은 양쪽 누락분 보강이다.
#>
param(
  [string] $LocalApiBaseUrl = 'http://localhost:5189',
  [string] $NasApiBaseUrl = 'http://192.168.0.50:6188/api',
  [string[]] $MenuIds = @('review_qna'),
  [string] $MenuIdsJson = '',
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
      if (-not [string]::IsNullOrWhiteSpace($single)) { return @($single) }
      return @()
    } catch {
      throw "Invalid JSON array text: $JsonText"
    }
  }
  return @($Values | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Try-ParseJsonFromOutput([string] $text) {
  $raw = [string]$text
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  $lines = @($raw -split "`r?`n")
  [array]::Reverse($lines)
  foreach ($line in $lines) {
    $candidate = ([string]$line).Trim()
    if (-not $candidate) { continue }
    if (-not ($candidate.StartsWith('{') -or $candidate.StartsWith('['))) { continue }
    try { return ($candidate | ConvertFrom-Json -AsHashtable) } catch { continue }
  }
  return $null
}

function Export-Bundle([string] $ApiBaseUrl, [string] $BearerToken, [string] $BundleFileName) {
  $args = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $exportScript,
    '-LocalApiBaseUrl', $ApiBaseUrl,
    '-MenuIdsJson', ($resolvedMenuIds | ConvertTo-Json -Compress),
    '-OutDir', $OutDir,
    '-BundleFileName', $BundleFileName
  )
  if ($BearerToken) { $args += @('-BearerToken', $BearerToken) }
  if ($DateFrom) { $args += @('-DateFrom', $DateFrom) }
  if ($DateTo) { $args += @('-DateTo', $DateTo) }
  if ($resolvedTargetDates -and $resolvedTargetDates.Count -gt 0) {
    $args += @('-TargetDatesJson', ($resolvedTargetDates | ConvertTo-Json -Compress))
  }
  $output = (& pwsh @args 2>&1 | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw "Export failed (exit=$LASTEXITCODE): $output" }
  $parsed = Try-ParseJsonFromOutput $output
  if (-not ($parsed -is [hashtable])) { throw 'Export returned no JSON result.' }
  return $parsed
}

function Import-Bundle([string] $ApiBaseUrl, [string] $BearerToken, [string] $BundlePath) {
  $args = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $importScript,
    '-BundlePath', $BundlePath,
    '-NasApiBaseUrl', $ApiBaseUrl
  )
  if ($BearerToken) { $args += @('-BearerToken', $BearerToken) }
  $output = (& pwsh @args 2>&1 | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw "Import failed (exit=$LASTEXITCODE): $output" }
  $parsed = Try-ParseJsonFromOutput $output
  if (-not ($parsed -is [hashtable])) { throw 'Import returned no JSON result.' }
  return $parsed
}

$scriptDir = Split-Path -Parent $PSCommandPath
$exportScript = Join-Path $scriptDir 'menu-sync-local-export.ps1'
$importScript = Join-Path $scriptDir 'menu-sync-nas-import.ps1'

$resolvedMenuIds = @(Resolve-StringArray -Values $MenuIds -JsonText $MenuIdsJson)
$resolvedTargetDates = @(Resolve-StringArray -Values $TargetDates -JsonText $TargetDatesJson)
if (-not $resolvedMenuIds -or $resolvedMenuIds.Count -eq 0) { throw "At least one MenuId is required." }

$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
$menuPart = ($resolvedMenuIds -join '_')

Write-Info 'Step 1/4: export local bundle'
$localExport = Export-Bundle -ApiBaseUrl $LocalApiBaseUrl -BearerToken $LocalBearerToken -BundleFileName ("menu_sync_local_to_nas_{0}_{1}.zip" -f $menuPart, $ts)
$localBundlePath = [string]$localExport['bundlePath']
if (-not $localBundlePath) { throw 'Local export returned empty bundlePath.' }

Write-Info 'Step 2/4: import local bundle into NAS'
$nasImport = Import-Bundle -ApiBaseUrl $NasApiBaseUrl -BearerToken $NasBearerToken -BundlePath $localBundlePath

Write-Info 'Step 3/4: export NAS bundle'
$nasExport = Export-Bundle -ApiBaseUrl $NasApiBaseUrl -BearerToken $NasBearerToken -BundleFileName ("menu_sync_nas_to_local_{0}_{1}.zip" -f $menuPart, $ts)
$nasBundlePath = [string]$nasExport['bundlePath']
if (-not $nasBundlePath) { throw 'NAS export returned empty bundlePath.' }

Write-Info 'Step 4/4: import NAS bundle into local'
$localImport = Import-Bundle -ApiBaseUrl $LocalApiBaseUrl -BearerToken $LocalBearerToken -BundlePath $nasBundlePath

$result = @{
  ok = $true
  action = 'menu-sync-db-reconcile'
  menus = @($resolvedMenuIds)
  date_from = $DateFrom
  date_to = $DateTo
  target_dates = @($resolvedTargetDates)
  local_to_nas_bundlePath = $localBundlePath
  nas_to_local_bundlePath = $nasBundlePath
  local_export_response = $localExport
  nas_import_response = $nasImport
  nas_export_response = $nasExport
  local_import_response = $localImport
  imported_tables = @($nasImport['imported_tables']) + @($localImport['imported_tables'])
}

Write-Info 'Done.'
$result | ConvertTo-Json -Compress -Depth 10
