<#
.SYNOPSIS
  키워드 순위 수집·저장 진단: API 로그 [openapi-rank-job] 및 DB tracked_product_rank_daily 확인.

.DESCRIPTION
  - API 로그: analytics-api 컨테이너에서 [openapi-rank-job] 로그만 추출 (client_id_len, saved_cells, write_keyword_result failed 등).
  - DB: 오늘자 source='openapi' 행 수 조회.
  실행 위치: C:\dev\ERP2-analytics (프로젝트 루트).

.PARAMETER LogTail
  API 로그에서 가져올 최근 줄 수. 기본 300.

.PARAMETER DbOnly
  DB 조회만 수행 (로그 생략).

.PARAMETER LogOnly
  로그만 수행 (DB 조회 생략).
#>
param(
    [int] $LogTail = 300,
    [switch] $DbOnly,
    [switch] $LogOnly
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot | Split-Path -Parent
Set-Location $Root

$ComposeFile = "docker/analytics.master.yml"
$LockFile   = "docker/analytics.master.lock"
if (-not (Test-Path $LockFile)) {
    Write-Host "[WARN] Lock file not found: $LockFile. Use analytics_rebuild_and_verify.ps1 first, or run from analytics repo root."
}

if (-not $DbOnly) {
    Write-Host "[INFO] API log (openapi-rank-job) last $LogTail lines"
    Write-Host "---"
    docker compose -f $ComposeFile --env-file $LockFile logs --no-log-prefix --tail=$LogTail analytics-api 2>&1 |
        Select-String -Pattern "openapi-rank-job" | ForEach-Object { $_.Line }
    Write-Host "---"
}

if (-not $LogOnly) {
    Write-Host "[INFO] DB: today's openapi row count (tracked_product_rank_daily)"
    $sql = @"
SELECT date, source, COUNT(*) AS rows
FROM tracked_product_rank_daily
WHERE date = CURRENT_DATE AND source = 'openapi'
GROUP BY date, source;
"@
    docker compose -f $ComposeFile --env-file $LockFile exec -T analytics-db psql -U analytics -d analytics -c $sql 2>&1
    Write-Host "[INFO] DB: per-product keyword count (top 10)"
    $sql2 = @"
SELECT LEFT(product_url, 60) AS product_url, COUNT(*) AS keywords
FROM tracked_product_rank_daily
WHERE date = CURRENT_DATE AND source = 'openapi'
GROUP BY product_url
ORDER BY keywords DESC
LIMIT 10;
"@
    docker compose -f $ComposeFile --env-file $LockFile exec -T analytics-db psql -U analytics -d analytics -c $sql2 2>&1
}

Write-Host "[INFO] Done. See docs/RANK_COLLECT_SAVE_DIAGNOSIS.md for interpretation."
