<#
.SYNOPSIS
  로컬 API에서 메뉴 동기화 번들을 내려받아 프로젝트 artifacts 폴더에 저장

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\menu-sync-local-export.ps1 `
    -LocalApiBaseUrl http://localhost:5189 `
    -MenuIds @('review_qna') `
    -BearerToken '<ops_admin token>'
#>
param(
  [string] $LocalApiBaseUrl = 'http://localhost:5189',
  [string[]] $MenuIds = @('review_qna'),
  [string] $MenuIdsJson = '',
  [string] $BundleFileName = '',
  [string] $OutDir = 'artifacts\menu-sync',
  [string] $BearerToken = '',
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

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
$outRoot = Join-Path $repoRoot $OutDir
New-Item -ItemType Directory -Force -Path $outRoot | Out-Null

$resolvedMenuIds = @(Resolve-StringArray -Values $MenuIds -JsonText $MenuIdsJson)
$resolvedTargetDates = @(Resolve-StringArray -Values $TargetDates -JsonText $TargetDatesJson)

if (-not $resolvedMenuIds -or $resolvedMenuIds.Count -eq 0) {
  throw "At least one MenuId is required."
}

$payload = @{ menu_ids = @($resolvedMenuIds) }
if ($DateFrom) { $payload['date_from'] = $DateFrom }
if ($DateTo) { $payload['date_to'] = $DateTo }
if ($resolvedTargetDates -and $resolvedTargetDates.Count -gt 0) { $payload['target_dates'] = @($resolvedTargetDates) }
$menuPayload = $payload | ConvertTo-Json -Compress
$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
if (-not $BundleFileName) {
  $BundleFileName = ("menu_sync_{0}_{1}.zip" -f (($resolvedMenuIds -join '_')), $ts)
}
$bundlePath = Join-Path $outRoot $BundleFileName
$exportUrl = ($LocalApiBaseUrl.TrimEnd('/')) + '/menu-sync/export'

Write-Info "Export bundle from $exportUrl"
$headers = @{ 'Content-Type' = 'application/json' }
if ($BearerToken) {
  $headers['Authorization'] = "Bearer $BearerToken"
}
Invoke-WebRequest -Method Post -Uri $exportUrl -Headers $headers -Body $menuPayload -OutFile $bundlePath | Out-Null
Write-Info "Saved bundle: $bundlePath"

$result = @{
  ok = $true
  action = 'menu-sync-export'
  bundlePath = $bundlePath
  bundleFileName = [System.IO.Path]::GetFileName($bundlePath)
  localApiBaseUrl = $LocalApiBaseUrl
  menus = @($resolvedMenuIds)
  date_from = $DateFrom
  date_to = $DateTo
  target_dates = @($resolvedTargetDates)
}
$result | ConvertTo-Json -Compress -Depth 6
