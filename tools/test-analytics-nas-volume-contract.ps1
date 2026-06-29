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

$nasCompose = Get-Text "docker\analytics.nas.master.yml"
Assert-Contains $nasCompose "analytics-db-data:" "NAS compose에 analytics-db-data 볼륨 정의가 없습니다."
Assert-Contains $nasCompose "name: analytics_analytics-db-data" "NAS compose가 기존 DB 볼륨명을 유지하지 않습니다."
Assert-Contains $nasCompose "external: true" "NAS compose가 DB 볼륨을 external로 선언하지 않아 project label 경고가 재발할 수 있습니다."

$deployNas = Get-Text "scripts\deploy-analytics-nas.ps1"
Assert-Contains $deployNas "volume inspect analytics_analytics-db-data" "NAS deploy 스크립트에 DB 볼륨 선검사 로직이 없습니다."
Assert-Contains $deployNas "volume create analytics_analytics-db-data" "NAS deploy 스크립트에 DB 볼륨 자동 생성 로직이 없습니다."

$verifyAfterCopy = Get-Text "scripts\verify-analytics-nas-after-copy.ps1"
Assert-Contains $verifyAfterCopy "volume inspect analytics_analytics-db-data" "NAS verify 스크립트에 DB 볼륨 선검사 로직이 없습니다."
Assert-Contains $verifyAfterCopy "volume create analytics_analytics-db-data" "NAS verify 스크립트에 DB 볼륨 자동 생성 로직이 없습니다."

Write-Host "PASS: NAS DB volume contract is externalized and bootstrapped safely."
