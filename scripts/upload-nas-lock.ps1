param(
  [string] $NasHost = '192.168.0.50',
  [string] $NasUser = 'admin2',
  [string] $NasPath = '/volume1/projects/ERP2-Dev/ERP2-analytics'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host ("[INFO] " + $m) -ForegroundColor Cyan }

$repoRoot = (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) '..')).Path
$localLock = Join-Path $repoRoot 'docker\analytics.nas.master.lock'
$remoteLock = "$NasPath/docker/analytics.nas.master.lock"

if (-not (Test-Path -LiteralPath $localLock)) { throw "Missing local lock: $localLock" }

$target = "${NasUser}@${NasHost}"
$keyPath = Join-Path $env:USERPROFILE '.ssh\erp2_nas'
$sshOpts = @(
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=NUL',
  '-o', 'GlobalKnownHostsFile=NUL',
  '-o', 'LogLevel=ERROR'
)
if (Test-Path -LiteralPath $keyPath) { $sshOpts = @('-i', $keyPath) + $sshOpts }
Write-Info ("Upload NAS lock -> " + $target + ":" + $remoteLock)

# text file upload via ssh stdin (safe, no scp dependency)
try {
  $q = [char]34
  $remoteCmd = "cat > '$remoteLock'"
  Get-Content -LiteralPath $localLock -Raw |
    ssh.exe @sshOpts $target ("bash -lc " + $q + $remoteCmd + $q)
} catch {
  throw
}
if ($LASTEXITCODE -ne 0) { throw "ssh upload failed (exit=$LASTEXITCODE)" }

Write-Info 'Done.'

