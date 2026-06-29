<#
.SYNOPSIS
  ERP2-dev에 남아있는 analytics 관련 자료를 ERP2-analytics로 안전하게 이관(기본: Copy).

.DESCRIPTION
  - 기본값은 "복사(Copy)"이며, 원본(ERP2-dev)을 삭제하지 않습니다.
  - 결과는 ERP2-analytics/_from_erp2-dev/<timestamp>/ 아래로 저장됩니다.
  - 실행 후 manifest 파일(파일 목록/크기/해시 옵션)을 남겨 누락/오염을 검증할 수 있습니다.

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\migrate-from-erp2-dev.ps1

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\migrate-from-erp2-dev.ps1 -IncludeArtifacts -ComputeHash
#>
param(
  [string] $SourceRoot = 'C:\dev\ERP2-dev',
  [string] $DestRoot = 'C:\dev\ERP2-analytics',
  [switch] $IncludeArtifacts,
  [switch] $ComputeHash
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }
function Write-Warn([string] $msg) { Write-Host ("[WARN] " + $msg) -ForegroundColor Yellow }

if (-not (Test-Path -LiteralPath $SourceRoot)) { throw "SOURCE_NOT_FOUND: $SourceRoot" }
if (-not (Test-Path -LiteralPath $DestRoot)) { throw "DEST_NOT_FOUND: $DestRoot" }

$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
$dest = Join-Path $DestRoot ("_from_erp2-dev\" + $ts)

New-Item -Force -ItemType Directory -Path $dest | Out-Null
foreach ($sub in @('docs','docker','scripts','cursor_rules','nas_sync','artifacts')) {
  New-Item -Force -ItemType Directory -Path (Join-Path $dest $sub) | Out-Null
}

function RoboCopyFiles([string] $srcDir, [string] $dstDir, [string[]] $patterns, [switch] $Recurse) {
  if (-not (Test-Path -LiteralPath $srcDir)) { return }
  New-Item -Force -ItemType Directory -Path $dstDir | Out-Null
  $args = @($srcDir, $dstDir) + $patterns + @('/R:1','/W:1','/NP','/NFL','/NDL','/NJH','/NJS','/XJ')
  if ($Recurse) { $args += '/S' }
  & robocopy @args | Out-Null
  $code = $LASTEXITCODE
  # robocopy: 0~7 = success (includes "extra files" etc). 8+ = failure.
  if ($code -ge 8) { throw "Robocopy failed: src=$srcDir dst=$dstDir exit=$code patterns=$($patterns -join ',')" }
}

Write-Info "Creating snapshot at: $dest"

# 1) docs
RoboCopyFiles (Join-Path $SourceRoot 'docs') (Join-Path $dest 'docs') @('ANALYTICS_*.md','analytics_diff_*.txt') -Recurse:$false

# 2) docker (analytics 관련 compose/lock)
RoboCopyFiles (Join-Path $SourceRoot 'docker') (Join-Path $dest 'docker') @('analytics*') -Recurse:$false

# 3) scripts (analytics 관련 스크립트)
RoboCopyFiles (Join-Path $SourceRoot 'scripts') (Join-Path $dest 'scripts') @('*analytics*','*Analytics*') -Recurse:$false

# 4) cursor rules (analytics 관련 룰만 보존)
RoboCopyFiles (Join-Path $SourceRoot '.cursor\rules') (Join-Path $dest 'cursor_rules') @('analytics-*.mdc') -Recurse:$false

# 5) NAS sync (analytics 관련 산출물 일부)
RoboCopyFiles (Join-Path $SourceRoot '_nas_sync') (Join-Path $dest 'nas_sync') @('analytics*') -Recurse:$false

# 6) artifacts (옵션): 임시/비교/스냅샷 파일은 용량이 클 수 있어 opt-in
if ($IncludeArtifacts) {
  Write-Warn 'IncludeArtifacts=ON (may be large).'
  RoboCopyFiles $SourceRoot (Join-Path $dest 'artifacts') @('_tmp_*crawl*','_tmp_*tracked*','_tmp_*manual*','_tmp_*compare*') -Recurse:$false
  RoboCopyFiles (Join-Path $SourceRoot '.tmp') (Join-Path $dest 'artifacts\.tmp') @('analytics*') -Recurse:$false
  # snapshot_inspect는 폴더 구조가 크므로, analytics 키워드 파일만 1차 보존
  RoboCopyFiles (Join-Path $SourceRoot '_snapshot_inspect') (Join-Path $dest 'artifacts\_snapshot_inspect') @('*analytics*') -Recurse
}

# manifest
$manifestPath = Join-Path $dest 'manifest.csv'
Write-Info "Writing manifest: $manifestPath"

$files = Get-ChildItem -LiteralPath $dest -Recurse -File
$rows = foreach ($f in $files) {
  $rel = $f.FullName.Substring($dest.Length).TrimStart('\')
  $hash = $null
  if ($ComputeHash) {
    try { $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash } catch { $hash = $null }
  }
  [pscustomobject]@{
    relativePath = $rel
    length = $f.Length
    lastWriteTimeUtc = $f.LastWriteTimeUtc.ToString('o')
    sha256 = $hash
  }
}

$rows | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $manifestPath

Write-Info ("Done. files=" + $files.Count + " computeHash=" + [bool]$ComputeHash)
Write-Info ("SnapshotDir=" + $dest)

