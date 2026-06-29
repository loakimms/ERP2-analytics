param(
  [string] $NasHost = '192.168.0.50',
  [string] $NasUser = 'admin2',
  [Parameter(Mandatory = $true)]
  [string] $RemotePath,
  [int] $TimeoutSeconds = 900,
  [int] $IntervalSeconds = 5
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host ("[INFO] " + $m) -ForegroundColor Cyan }
function Write-Warn([string] $m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }

$target = "${NasUser}@${NasHost}"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$attempt = 0

Write-Info ("Wait remote file: " + $target + ":" + $RemotePath)
Write-Info "Timeout: ${TimeoutSeconds}s, interval: ${IntervalSeconds}s"

while ((Get-Date) -lt $deadline) {
  $attempt++
  try {
    & ssh.exe -o BatchMode=yes -o StrictHostKeyChecking=no $target "ls -l '$RemotePath'" 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
      Write-Info "FOUND (attempt=$attempt): $RemotePath"
      exit 0
    }
  } catch {
    # ignore and retry
  }

  if ($attempt -eq 1 -or ($attempt % 6 -eq 0)) {
    Write-Warn "Not found yet (attempt=$attempt). Waiting..."
  }
  Start-Sleep -Seconds $IntervalSeconds
}

throw ("TIMEOUT: remote file not found: " + $target + ":" + $RemotePath)

