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

$nginxConfPath = Join-Path $RepoRoot "web\nginx-spa.conf"
Assert-True (Test-Path -LiteralPath $nginxConfPath) "nginx 설정 파일이 없습니다: $nginxConfPath"

$text = [System.IO.File]::ReadAllText($nginxConfPath)

Assert-Contains $text "client_max_body_size 2048m;" "메뉴 동기화 대용량 업로드를 위한 client_max_body_size 설정이 없습니다."
Assert-Contains $text "location /api/ {" "API 프록시 location 설정이 없습니다."
Assert-Contains $text "proxy_pass http://analytics-api:8000/;" "API 프록시 대상이 없습니다."

Write-Host "PASS: nginx upload limit is configured for large menu sync bundles."
