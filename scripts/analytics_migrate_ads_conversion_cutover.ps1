<#
.SYNOPSIS
  2026-03-09 이전 광고 전환 데이터 의미를 구매전환 기준으로 교정한다.

.DESCRIPTION
  배경:
  - 2026-03-09 이전 네이버 광고 원천에는 "총전환/총전환매출액" 개념이 없고 실구매 데이터만 존재했다.
  - 따라서 과거 적재분의 conversions/revenue/roas 는 실제로는 purchase_* 의미다.
  - 이 스크립트는 과거 데이터를 아래 규칙으로 교정한다.
    conversions -> purchase_conversions
    revenue -> purchase_revenue
    roas -> 0 (총전환 ROAS 개념 없음)
    conversion_semantics -> legacy_purchase_only

  안전장치:
  - 기본은 dry-run 이다.
  - -Apply 지정 시에만 실제 UPDATE를 수행한다.
  - 적용 전 각 테이블별 백업 테이블을 생성한다.
#>
param(
  [string] $ComposeFile = "docker/analytics.master.yml",
  [string] $LockFile = "docker/analytics.master.lock",
  [string] $CutoverDate = "2026-03-09",
  [switch] $Apply
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Warn([string] $m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Invoke-DbSql([string] $sql) {
  docker compose -f $ComposeFile --env-file $LockFile exec -T analytics-db psql -U analytics -d analytics -v ON_ERROR_STOP=1 -P pager=off -c $sql
  if ($LASTEXITCODE -ne 0) { throw "psql failed (exit=$LASTEXITCODE)" }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot | Out-Null

$tables = @(
  "naver_ad_keyword_daily",
  "naver_ad_searchword_daily",
  "naver_ad_creative_daily"
)

$ensureSchemaSql = @"
ALTER TABLE naver_ad_keyword_daily ADD COLUMN IF NOT EXISTS conversion_semantics VARCHAR NOT NULL DEFAULT 'total_plus_purchase';
ALTER TABLE naver_ad_keyword_daily ADD COLUMN IF NOT EXISTS purchase_conversions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE naver_ad_keyword_daily ADD COLUMN IF NOT EXISTS purchase_revenue INTEGER NOT NULL DEFAULT 0;
ALTER TABLE naver_ad_searchword_daily ADD COLUMN IF NOT EXISTS conversion_semantics VARCHAR NOT NULL DEFAULT 'total_plus_purchase';
ALTER TABLE naver_ad_searchword_daily ADD COLUMN IF NOT EXISTS purchase_conversions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE naver_ad_searchword_daily ADD COLUMN IF NOT EXISTS purchase_revenue INTEGER NOT NULL DEFAULT 0;
ALTER TABLE naver_ad_creative_daily ADD COLUMN IF NOT EXISTS conversion_semantics VARCHAR NOT NULL DEFAULT 'total_plus_purchase';
ALTER TABLE naver_ad_creative_daily ADD COLUMN IF NOT EXISTS purchase_conversions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE naver_ad_creative_daily ADD COLUMN IF NOT EXISTS purchase_revenue INTEGER NOT NULL DEFAULT 0;
"@

Write-Info "Ensure migration columns exist"
Invoke-DbSql $ensureSchemaSql

$previewSql = @"
WITH targets AS (
  SELECT 'naver_ad_keyword_daily' AS table_name, COUNT(*) AS rows, COALESCE(SUM(conversions), 0) AS total_conv, COALESCE(SUM(revenue), 0) AS total_rev, COALESCE(SUM(purchase_conversions), 0) AS purchase_conv, COALESCE(SUM(purchase_revenue), 0) AS purchase_rev
  FROM naver_ad_keyword_daily
  WHERE date < DATE '$CutoverDate' AND COALESCE(conversion_semantics, 'total_plus_purchase') <> 'legacy_purchase_only'
  UNION ALL
  SELECT 'naver_ad_searchword_daily' AS table_name, COUNT(*) AS rows, COALESCE(SUM(conversions), 0) AS total_conv, COALESCE(SUM(revenue), 0) AS total_rev, COALESCE(SUM(purchase_conversions), 0) AS purchase_conv, COALESCE(SUM(purchase_revenue), 0) AS purchase_rev
  FROM naver_ad_searchword_daily
  WHERE date < DATE '$CutoverDate' AND COALESCE(conversion_semantics, 'total_plus_purchase') <> 'legacy_purchase_only'
  UNION ALL
  SELECT 'naver_ad_creative_daily' AS table_name, COUNT(*) AS rows, COALESCE(SUM(conversions), 0) AS total_conv, COALESCE(SUM(revenue), 0) AS total_rev, COALESCE(SUM(purchase_conversions), 0) AS purchase_conv, COALESCE(SUM(purchase_revenue), 0) AS purchase_rev
  FROM naver_ad_creative_daily
  WHERE date < DATE '$CutoverDate' AND COALESCE(conversion_semantics, 'total_plus_purchase') <> 'legacy_purchase_only'
)
SELECT * FROM targets ORDER BY table_name;
"@

Write-Info "Preview rows before migration (cutover=$CutoverDate)"
Invoke-DbSql $previewSql

if (-not $Apply) {
  Write-Warn "Dry-run only. Re-run with -Apply to create backups and update rows."
  exit 0
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
foreach ($table in $tables) {
  $backupTable = "${table}_bak_${ts}"
  Write-Info "Backup: $table -> $backupTable"
  $backupSql = @"
DROP TABLE IF EXISTS $backupTable;
CREATE TABLE $backupTable AS
SELECT *
FROM $table
WHERE date < DATE '$CutoverDate'
  AND COALESCE(conversion_semantics, 'total_plus_purchase') <> 'legacy_purchase_only';
"@
  Invoke-DbSql $backupSql

  Write-Info "Migrate: $table"
  $updateSql = @"
UPDATE $table
SET
  purchase_conversions = CASE
    WHEN COALESCE(purchase_conversions, 0) > 0 THEN purchase_conversions
    ELSE COALESCE(conversions, 0)
  END,
  purchase_revenue = CASE
    WHEN COALESCE(purchase_revenue, 0) > 0 THEN purchase_revenue
    ELSE COALESCE(revenue, 0)
  END,
  conversions = 0,
  revenue = 0,
  roas = 0,
  conversion_semantics = 'legacy_purchase_only'
WHERE date < DATE '$CutoverDate'
  AND COALESCE(conversion_semantics, 'total_plus_purchase') <> 'legacy_purchase_only';
"@
  Invoke-DbSql $updateSql
}

Write-Info "Preview rows after migration"
Invoke-DbSql $previewSql
Write-Info "Done."
