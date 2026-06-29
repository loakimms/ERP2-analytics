param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Assert-Contains([string]$Text, [string]$Needle, [string]$Message) {
  Assert-True ($Text.Contains($Needle)) $Message
}

function Get-Text([string]$RelativePath) {
  $path = Join-Path $RepoRoot $RelativePath
  return [System.IO.File]::ReadAllText($path)
}

$importScript = Get-Text "scripts\menu-sync-nas-import.ps1"
Assert-Contains $importScript '%{http_code}' "menu-sync-nas-import.ps1 가 HTTP 상태코드를 수집하지 않습니다."
Assert-Contains $importScript '__HTTP_STATUS__:' "menu-sync-nas-import.ps1 가 HTTP 상태코드 marker를 사용하지 않습니다."
Assert-Contains $importScript 'http_status=' "menu-sync-nas-import.ps1 가 비정상 HTTP 상태를 실패로 처리하지 않습니다."
Assert-Contains $importScript 'raw_response' "menu-sync-nas-import.ps1 가 응답 본문을 결과에 남기지 않습니다."

$pushScript = Get-Text "scripts\menu-sync-nas-push.ps1"
Assert-Contains $pushScript 'NAS import script failed' "menu-sync-nas-push.ps1 가 import 실패를 상위 실패로 전파하지 않습니다."
Assert-Contains $pushScript 'import_response' "menu-sync-nas-push.ps1 가 import 응답을 결과에 포함하지 않습니다."

Write-Host "PASS: menu sync scripts validate HTTP status and propagate failures."
