param(
  [string] $NasHost = '192.168.0.50',
  [string] $NasUser = 'admin2',
  [string] $NasPath = '/volume1/projects/ERP2-Dev/ERP2-analytics'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Step([string] $m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Assert-Ok([string] $what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit=$LASTEXITCODE)" } }

$keyPath = Join-Path $env:USERPROFILE '.ssh\erp2_nas'
$sshOpts = @(
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=no',
  # sandbox 환경에서 known_hosts 파일 쓰기가 막힐 수 있어, 아예 기록/갱신을 하지 않는다.
  '-o', 'UserKnownHostsFile=NUL',
  '-o', 'GlobalKnownHostsFile=NUL',
  '-o', 'LogLevel=ERROR'
)
if (Test-Path -LiteralPath $keyPath) { $sshOpts = @('-i', $keyPath) + $sshOpts }
$sshTarget = "${NasUser}@${NasHost}"
$repoRoot = (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) '..')).Path

function Get-TextMatch([string] $Path, [string] $Pattern, [string] $Label) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Missing file for ${Label}: $Path" }
  $text = Get-Content -LiteralPath $Path -Raw
  $m = [regex]::Match($text, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
  if (-not $m.Success) { throw "Could not parse $Label from $Path" }
  return [string]$m.Groups[1].Value
}

function Get-ExpectedHostAgentRelease {
  $uiPath = Join-Path $repoRoot 'web\src\modules\hostAgentRelease.ts'
  $agentPath = Join-Path $repoRoot 'tools\host-agent.ps1'
  $installerPath = Join-Path $repoRoot 'web\public\nas\Install-Analytics-HostAgent.ps1'

  $uiVersion = Get-TextMatch $uiPath 'REQUIRED_HOST_AGENT_VERSION\s*=\s*[''"]([^''"]+)[''"]' 'UI required host agent version'
  $uiManageNo = Get-TextMatch $uiPath 'REQUIRED_HOST_AGENT_MANAGE_NO\s*=\s*[''"]([^''"]+)[''"]' 'UI required host agent manage no'
  $agentVersion = Get-TextMatch $agentPath '^\$AgentVersion\s*=\s*"([^"]+)"' 'host-agent.ps1 AgentVersion'
  $agentManageNo = Get-TextMatch $agentPath '^\$AgentManageNo\s*=\s*"([^"]+)"' 'host-agent.ps1 AgentManageNo'
  $bundledVersion = Get-TextMatch $installerPath '^\$bundledAgentVersion\s*=\s*"([^"]+)"' 'NAS installer bundledAgentVersion'
  $bundledManageNo = Get-TextMatch $installerPath '^\$bundledAgentManageNo\s*=\s*"([^"]+)"' 'NAS installer bundledAgentManageNo'

  $pairs = @(
    @('UI version', $uiVersion, $agentVersion),
    @('UI manageNo', $uiManageNo, $agentManageNo),
    @('NAS installer version', $bundledVersion, $agentVersion),
    @('NAS installer manageNo', $bundledManageNo, $agentManageNo)
  )
  foreach ($p in $pairs) {
    if ([string]$p[1] -ne [string]$p[2]) {
      throw ("Host Agent release mismatch: {0} actual={1} expected={2}" -f $p[0], $p[1], $p[2])
    }
  }

  return @{ version = $agentVersion; manageNo = $agentManageNo }
}

function New-RemoteScript([string] $bashCmd) {
  # Send the actual script over stdin to avoid nested quote breakage in ssh "bash -lc ...".
  return @"
DOCKER_BIN=`$(command -v docker 2>/dev/null || true)
if [ -z "`$DOCKER_BIN" ]; then DOCKER_BIN='/var/packages/ContainerManager/target/usr/bin/docker'; fi
$bashCmd
"@
}

function Invoke-Ssh([string] $bashCmd, [string] $label) {
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((New-RemoteScript $bashCmd)))
  & ssh.exe @sshOpts $sshTarget ("echo '" + $payload + "' | base64 -d | sh")
  Assert-Ok $label
}

function Invoke-SshCapture([string] $bashCmd, [string] $label) {
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((New-RemoteScript $bashCmd)))
  $out = & ssh.exe @sshOpts $sshTarget ("echo '" + $payload + "' | base64 -d | sh") 2>&1 | Out-String
  Assert-Ok $label
  return $out
}

Write-Step "Verify remote files exist ($sshTarget)"
Invoke-Ssh "set -eu; cd '$NasPath'; ls -l docker/analytics.nas.master.lock docker/analytics.nas.master.yml" 'ssh ls lock/yml'

$tag = (Invoke-SshCapture "set -eu; cd '$NasPath'; sed -n 's/^ANALYTICS_IMAGE_TAG=//p' docker/analytics.nas.master.lock | sed -n '1p'" 'ssh read tag').Trim()
if (-not $tag) { throw "Remote lock missing ANALYTICS_IMAGE_TAG ($NasPath/docker/analytics.nas.master.lock)" }
Write-Info "NAS lock tag = $tag"
$expectedAgent = Get-ExpectedHostAgentRelease
Write-Info ("Expected Host Agent release = version {0}, manageNo {1}" -f $expectedAgent.version, $expectedAgent.manageNo)
$composeEnvFiles = "--env-file docker/analytics.nas.master.lock"
$adminEnvState = (Invoke-SshCapture "set +e; cd '$NasPath'; if [ -s docker/env.firebase.admin.local ]; then echo present; else echo missing; fi" 'ssh check firebase admin env').Trim()
if ($adminEnvState -eq 'present') {
  $composeEnvFiles = "$composeEnvFiles --env-file docker/env.firebase.admin.local"
  Write-Info "Firebase Admin env file present: docker/env.firebase.admin.local"
} else {
  Write-Info "Firebase Admin env file not present on NAS; user management Admin SDK will be disabled."
}

$remoteTar = "$NasPath/docker_images/analytics_images_$tag.tar"
Write-Step "Verify tar exists ($remoteTar)"
$lsLineRaw = (Invoke-SshCapture "set -eu; ls -ln '$remoteTar'" 'ssh ls tar (numeric)').Trim()
Write-Info ("tar ls: " + ($lsLineRaw -replace '\\s+', ' '))

# (중요) tar가 "존재만" 하고 내용이 잘린 상태면 docker load가 unexpected EOF로 실패한다.
# 수동 복사(Explorer/SMB/rsync)에서 중간에 끊기면 흔히 발생하므로,
# 크기까지 확인해서 fail-fast 한다.
Write-Step 'Verify tar size (fail-fast if truncated)'
$lsLine = ($lsLineRaw -split "`r?`n" | Where-Object { $_ -and $_.Trim() } | Select-Object -Last 1).Trim()
$parts = $lsLine -split '\s+'
$tarSize = 0
try {
  # ls -ln: perms links uid gid size month day time path...
  if ($parts.Length -ge 5) { $tarSize = [int64]$parts[4] }
} catch { $tarSize = 0 }
Write-Info ("tar bytes = " + $tarSize)
if ($tarSize -lt 300MB) {
  throw ("Tar file looks truncated on NAS (size={0} bytes). Re-copy: {1}" -f $tarSize, $remoteTar)
}

Write-Step "NAS: docker load (-i $remoteTar)"
Invoke-Ssh "set -eu; ""`$DOCKER_BIN"" load -i '$remoteTar'" 'ssh docker load'

Write-Step 'NAS: ensure external DB volume'
Invoke-Ssh "set -eu; ""`$DOCKER_BIN"" volume inspect analytics_analytics-db-data >/dev/null 2>&1 || ""`$DOCKER_BIN"" volume create analytics_analytics-db-data >/dev/null" 'ssh ensure external DB volume'

Write-Step 'NAS: compose up db (if needed)'
Invoke-Ssh "set -eu; cd '$NasPath'; ""`$DOCKER_BIN"" compose -p analytics_nas -f docker/analytics.nas.master.yml $composeEnvFiles up -d analytics-db --pull never --remove-orphans" 'ssh compose up db'

Write-Step 'NAS: stop web before api recreate (avoid proxy 502 during api warmup)'
Invoke-Ssh "set +e; cd '$NasPath'; ""`$DOCKER_BIN"" compose -p analytics_nas -f docker/analytics.nas.master.yml $composeEnvFiles stop analytics-web >/dev/null 2>&1; exit 0" 'ssh stop web before api recreate'

Write-Step 'NAS: compose up api (force-recreate)'
Invoke-Ssh "set -eu; cd '$NasPath'; ""`$DOCKER_BIN"" compose -p analytics_nas -f docker/analytics.nas.master.yml $composeEnvFiles up -d --no-deps --force-recreate analytics-api --pull never --remove-orphans" 'ssh compose up api'

Write-Step 'NAS: wait api version before starting web'
$apiWarmup = Invoke-SshCapture "set +e; for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do curl -sS --max-time 3 http://127.0.0.1:6189/api/version 2>/dev/null && exit 0; sleep 2; done; echo '__API_UNREACHABLE__'; exit 0" 'ssh wait api before web'
if ($apiWarmup -match '__API_UNREACHABLE__') {
  throw 'API version check failed before web start'
}
try {
  $apiWarmupObj = $apiWarmup | ConvertFrom-Json
  $apiWarmupTag = if ($null -ne $apiWarmupObj.imageTag) { [string]$apiWarmupObj.imageTag } else { '' }
  if ($apiWarmupTag -ne $tag) { throw "NAS api imageTag mismatch before web start: expected=$tag actual=$apiWarmupTag" }
} catch {
  throw ("NAS api warmup verify failed: " + $_.Exception.Message)
}

Write-Step 'NAS: compose up web (force-recreate)'
Invoke-Ssh "set -eu; cd '$NasPath'; ""`$DOCKER_BIN"" compose -p analytics_nas -f docker/analytics.nas.master.yml $composeEnvFiles up -d --no-deps --force-recreate analytics-web --pull never --remove-orphans" 'ssh compose up web'

Write-Step 'Verify: web version.json (internal)'
$webJson = Invoke-SshCapture "set -eu; curl -sS http://127.0.0.1:6188/version.json" 'ssh curl web version'
Write-Info ("web version.json: " + ($webJson.Trim() -replace '\\s+', ' '))
try {
  $webObj = $webJson | ConvertFrom-Json
  $webTag = if ($null -ne $webObj.imageTag) { [string]$webObj.imageTag } else { '' }
  if ($webTag -ne $tag) { throw "NAS web imageTag mismatch: expected=$tag actual=$webTag" }
} catch {
  throw ("NAS web version.json verify failed: " + $_.Exception.Message)
}

Write-Step 'Verify: NAS-served Host Agent installer release'
$installerText = Invoke-SshCapture "set -eu; curl -sS http://127.0.0.1:6188/nas/Install-Analytics-HostAgent.ps1" 'ssh curl host agent installer'
if ($installerText -notmatch [regex]::Escape([string]$expectedAgent.version)) {
  throw ("NAS installer missing expected Host Agent version: " + [string]$expectedAgent.version)
}
if ($installerText -notmatch [regex]::Escape([string]$expectedAgent.manageNo)) {
  throw ("NAS installer missing expected Host Agent manageNo: " + [string]$expectedAgent.manageNo)
}
Write-Info ("NAS installer Host Agent release OK: version {0}, manageNo {1}" -f $expectedAgent.version, $expectedAgent.manageNo)

Write-Step 'Verify: api version (internal, retry up to 90s)'
Write-Info '  waiting up to 90s for api version...'
$apiVer = Invoke-SshCapture "set +e; for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45; do curl -sS --max-time 3 http://127.0.0.1:6189/api/version 2>/dev/null && exit 0; curl -sS --max-time 3 http://127.0.0.1:6189/version 2>/dev/null && exit 0; sleep 2; done; echo '__API_UNREACHABLE__'; exit 0" 'ssh curl api version (retry)'
if ($apiVer -match '__API_UNREACHABLE__') {
  Write-Info 'API not reachable after retry. Collecting evidence...'
  $ps = Invoke-SshCapture "set -eu; cd '$NasPath'; ""`$DOCKER_BIN"" compose -p analytics_nas -f docker/analytics.nas.master.yml $composeEnvFiles ps" 'ssh compose ps'
  Write-Info ("compose ps: " + ($ps.Trim() -replace '\\s+', ' '))
  $logs = Invoke-SshCapture "set -eu; cd '$NasPath'; ""`$DOCKER_BIN"" compose -p analytics_nas -f docker/analytics.nas.master.yml $composeEnvFiles logs --no-log-prefix --tail=200 analytics-api" 'ssh api logs'
  Write-Info ("api logs tail: " + ($logs.Trim() -replace '\\s+', ' '))
  $curlDiag = Invoke-SshCapture "set +e; echo 'curl -v /api/version'; curl -v --max-time 3 http://127.0.0.1:6189/api/version 2>&1 | sed -n '1,120p'; echo; echo 'curl -v /version'; curl -v --max-time 3 http://127.0.0.1:6189/version 2>&1 | sed -n '1,120p'" 'ssh curl diag'
  Write-Info ("curl diag: " + ($curlDiag.Trim() -replace '\\s+', ' '))
  throw 'API version check failed (unreachable)'
}
Write-Info ("api version: " + ($apiVer.Trim() -replace '\\s+', ' '))
try {
  $apiObj = $apiVer | ConvertFrom-Json
  $apiTag = if ($null -ne $apiObj.imageTag) { [string]$apiObj.imageTag } else { '' }
  if ($apiTag -ne $tag) { throw "NAS api imageTag mismatch: expected=$tag actual=$apiTag" }
} catch {
  throw ("NAS api version verify failed: " + $_.Exception.Message)
}

Write-Step 'Verify: discover-host-cdp endpoint exists (expect 400)'
$code = Invoke-SshCapture "set -eu; curl -sS -o /dev/null -w '%{http_code}\\n' 'http://127.0.0.1:6189/search-rank/page-metrics/discover-host-cdp?cidr=192.168.0.0/33'" 'ssh curl discover endpoint'
Write-Info ("discover-host-cdp status=" + $code.Trim())

Write-Info "Done. NAS Web: http://${NasHost}:6188  API: http://${NasHost}:6189  tag=$tag"

