<#
.SYNOPSIS
  로컬/NAS의 내 상품 추적 inventory를 비교해 결측 날짜를 분석

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\menu-sync-tracking-gap-analyze.ps1 `
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
  [string] $LocalBearerToken = '',
  [string] $NasBearerToken = '',
  [string] $MenuId = 'product_tracking'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }

function Invoke-Inventory([string] $BaseUrl, [string] $BearerToken) {
  $url = ($BaseUrl.TrimEnd('/')) + '/menu-sync/inventory'
  $headers = @{ 'Content-Type' = 'application/json' }
  if ($BearerToken) { $headers['Authorization'] = "Bearer $BearerToken" }
  $payload = @{ menu_id = $MenuId }
  if ($DateFrom) { $payload['date_from'] = $DateFrom }
  if ($DateTo) { $payload['date_to'] = $DateTo }
  Write-Info "Inventory -> $url"
  $response = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body ($payload | ConvertTo-Json -Compress)
  return $response
}

function New-KeySetMap($Inventory) {
  $map = @{}
  foreach ($table in @($Inventory.tables)) {
    $tableName = [string]($table.table_name ?? '')
    if (-not $tableName) { continue }
    if (-not $map.ContainsKey($tableName)) { $map[$tableName] = @{} }
    foreach ($day in @($table.days)) {
      $dayKey = [string]($day.date ?? '')
      if (-not $dayKey) { continue }
      $hash = New-Object 'System.Collections.Generic.HashSet[string]'
      foreach ($key in @($day.keys)) {
        $text = [string]($key ?? '')
        if ($text) { [void]$hash.Add($text) }
      }
      $map[$tableName][$dayKey] = @{
        keySet = $hash
        rowCount = [int]($day.row_count ?? 0)
      }
    }
  }
  return $map
}

$local = Invoke-Inventory -BaseUrl $LocalApiBaseUrl -BearerToken $LocalBearerToken
$nas = Invoke-Inventory -BaseUrl $NasApiBaseUrl -BearerToken $NasBearerToken

$localMap = New-KeySetMap $local
$nasMap = New-KeySetMap $nas

$missingDates = New-Object 'System.Collections.Generic.HashSet[string]'
$gapItems = @()

foreach ($tableName in @($localMap.Keys | Sort-Object)) {
  $localDays = $localMap[$tableName]
  $nasDays = @{}
  if ($nasMap.ContainsKey($tableName)) { $nasDays = $nasMap[$tableName] }
  foreach ($dayKey in @($localDays.Keys | Sort-Object)) {
    $localState = $localDays[$dayKey]
    $nasState = $null
    if ($nasDays.ContainsKey($dayKey)) { $nasState = $nasDays[$dayKey] }
    $nasSet = New-Object 'System.Collections.Generic.HashSet[string]'
    $nasRowCount = 0
    if ($nasState) {
      $nasSet = $nasState.keySet
      $nasRowCount = [int]($nasState.rowCount ?? 0)
    }
    $missingKeys = @()
    foreach ($key in @($localState.keySet)) {
      if (-not $nasSet.Contains($key)) { $missingKeys += $key }
    }
    if ($missingKeys.Count -gt 0) {
      [void]$missingDates.Add($dayKey)
      $gapItems += @{
        date = $dayKey
        table_name = $tableName
        local_row_count = [int]($localState.rowCount ?? 0)
        nas_row_count = $nasRowCount
        missing_key_count = $missingKeys.Count
        missing_keys = @($missingKeys | Sort-Object)
      }
    }
  }
}

$result = @{
  ok = $true
  action = 'menu-sync-tracking-gap-analyze'
  menu_id = $MenuId
  date_from = $DateFrom
  date_to = $DateTo
  missing_dates = @($missingDates | Sort-Object)
  missing_date_count = $missingDates.Count
  gap_items = @($gapItems | Sort-Object date, table_name)
  local_inventory = $local
  nas_inventory = $nas
}

$result | ConvertTo-Json -Compress -Depth 10
