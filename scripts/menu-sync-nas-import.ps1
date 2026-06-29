<#
.SYNOPSIS
  메뉴 동기화 번들을 NAS API에 import

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\menu-sync-nas-import.ps1 `
    -BundlePath .\artifacts\menu-sync\menu_sync_review_qna.zip `
    -NasApiBaseUrl http://192.168.0.50:6188/api `
    -BearerToken '<ops_admin token>'
#>
param(
  [Parameter(Mandatory = $true)]
  [string] $BundlePath,
  [string] $NasApiBaseUrl = 'http://192.168.0.50:6188/api',
  [string] $BearerToken = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }

function Try-ParseJsonText([string] $text) {
  $raw = [string]($text ?? '')
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  try {
    return ($raw | ConvertFrom-Json -AsHashtable)
  } catch {
    return $null
  }
}

function Split-HttpStatusPayload([string] $text) {
  $raw = [string]($text ?? '')
  $marker = '__HTTP_STATUS__:'
  $idx = $raw.LastIndexOf($marker)
  if ($idx -lt 0) {
    return @{
      body = $raw.Trim()
      statusCode = 0
    }
  }
  $body = $raw.Substring(0, $idx).Trim()
  $statusText = $raw.Substring($idx + $marker.Length).Trim()
  $statusCode = 0
  try { $statusCode = [int]$statusText } catch { $statusCode = 0 }
  return @{
    body = $body
    statusCode = $statusCode
  }
}

if (-not (Test-Path -LiteralPath $BundlePath)) {
  throw "Bundle not found: $BundlePath"
}

$bundleFullPath = (Resolve-Path -LiteralPath $BundlePath).Path
$url = ($NasApiBaseUrl.TrimEnd('/')) + '/menu-sync/import'
$curlArgs = @('-sS', '-X', 'POST', '-w', "`n__HTTP_STATUS__:%{http_code}")
if ($BearerToken) {
  $curlArgs += @('-H', "Authorization: Bearer $BearerToken")
}
$curlArgs += @('-F', "file=@${bundleFullPath};type=application/zip", $url)

Write-Info "Import bundle -> $url"
$responseText = (& curl.exe @curlArgs 2>&1 | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
$http = Split-HttpStatusPayload $responseText
$responseBody = [string]($http.body ?? '')
$httpStatus = [int]($http.statusCode ?? 0)
if ($LASTEXITCODE -ne 0) {
  throw "curl import failed (exit=$LASTEXITCODE) body=$responseBody"
}
if ($httpStatus -lt 200 -or $httpStatus -ge 300) {
  throw "http_status=$httpStatus body=$responseBody"
}

$parsed = Try-ParseJsonText $responseBody
$result = @{
  ok = $true
  action = 'menu-sync-import'
  bundlePath = $bundleFullPath
  nasApiBaseUrl = $NasApiBaseUrl
  http_status = $httpStatus
  raw_response = $responseBody
}
if ($parsed -is [hashtable]) {
  foreach ($entry in $parsed.GetEnumerator()) {
    $result[$entry.Key] = $entry.Value
  }
}

Write-Host ''
Write-Info "Done."
$result | ConvertTo-Json -Compress -Depth 8
