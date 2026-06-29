<#
.SYNOPSIS
  UI에 표시되는 수집 %와 DB 저장 건수가 일치하는지 검증.
  - API today-status 응답의 covered_keywords vs DB tracked_product_rank_daily 행 수
  - 동일하면 UI % = (DB 저장 건수 / total_keywords) 와 일치함.
#>
param()

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot | Split-Path -Parent
Set-Location $Root

$ComposeFile = "docker/analytics.master.yml"
$LockFile   = "docker/analytics.master.lock"

Write-Host "[1] DB: 오늘자 openapi 상품별 저장 건수(covered)"
$sql = "SELECT product_url || E'\t' || COUNT(*) FROM tracked_product_rank_daily WHERE date = CURRENT_DATE AND source = 'openapi' GROUP BY product_url ORDER BY product_url;"
$dbLines = docker compose -f $ComposeFile --env-file $LockFile exec -T analytics-db psql -U analytics -d analytics -t -A -c $sql
$dbMap = @{}
foreach ($line in ($dbLines | Where-Object { $_ -match "\t" })) {
    $parts = $line -split "`t", 2
    $dbMap[$parts[0]] = [int]$parts[1]
}

if ($dbMap.Count -eq 0) {
    Write-Host "  (오늘자 openapi 데이터 없음)"
    exit 0
}

$urls = @($dbMap.Keys | Sort-Object)
Write-Host "[2] API: today-status 호출 (동일 URL 목록)"
$body = @{ product_urls = $urls } | ConvertTo-Json
$apiItems = Invoke-RestMethod -Uri "http://localhost:5189/search-rank/crawl/today-status" -Method Post -Body $body -ContentType "application/json"

Write-Host ""
Write-Host "상품(product_url 끝 12자) | total | API covered | DB count | 일치 | UI%"
Write-Host ("-" * 85)
$allMatch = $true
foreach ($item in $apiItems) {
    $u = $item.product_url
    $tail = if ($u.Length -gt 12) { $u.Substring($u.Length - 12) } else { $u }
    $total = [int]$item.total_keywords
    $apiCovered = [int]$item.covered_keywords
    $dbCount = $dbMap[$u]
    if ($null -eq $dbCount) { $dbCount = 0 }
    $match = ($apiCovered -eq $dbCount)
    if (-not $match) { $allMatch = $false }
    $pct = if ($total -gt 0) { [math]::Round(100 * $apiCovered / $total) } else { 0 }
    Write-Host ("{0} | {1,5} | {2,12} | {3,9} | {4} | {5}%" -f $tail, $total, $apiCovered, $dbCount, $(if ($match) { "OK" } else { "DIFF" }), $pct)
}
Write-Host ("-" * 85)
if ($allMatch) {
    Write-Host "[결과] UI %와 DB 저장 건수 일치 (API covered_keywords = DB 행 수)"
} else {
    Write-Host "[결과] 불일치 있음 - API와 DB 로직 확인 필요"
    exit 1
}
