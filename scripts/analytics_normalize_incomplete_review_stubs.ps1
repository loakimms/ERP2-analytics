param(
  [int] $Limit = 500
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }

$containerName = 'analytics-master-api'
$runningNames = docker ps --format "{{.Names}}"
if (-not ($runningNames -split "`n" | Where-Object { $_ -eq $containerName })) {
  throw "container_not_running: $containerName"
}

Write-Info ("Normalize incomplete review stubs via " + $containerName)
docker exec $containerName python /app/normalize_incomplete_review_stubs.py --limit $Limit
if ($LASTEXITCODE -ne 0) {
  throw "normalize_incomplete_review_stubs failed (exit=$LASTEXITCODE)"
}
