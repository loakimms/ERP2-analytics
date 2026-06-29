param(
	[int]$Port = 9230,
	[int]$CdpPort = 9223
)

$ErrorActionPreference = "Stop"

$startScript = Join-Path $PSScriptRoot "start-host-agent.ps1"
if (-not (Test-Path -LiteralPath $startScript)) { throw "start-host-agent.ps1 not found: $startScript" }

function Test-AgentHealthy([int]$port) {
	try {
		$r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $port) -TimeoutSec 1
		return ($r -and $r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
	} catch {
		return $false
	}
}

if (Test-AgentHealthy -port $Port) {
	Write-Host ("✅ Host agent already running: http://127.0.0.1:{0}/health" -f $Port)
	exit 0
}

# host-agent가 안 떠 있으면 시작한다. 자동 보정 경로에서는 입력 대기를 만들지 않는다.
& $startScript -Port $Port -CdpPort $CdpPort -NoPause | Out-Host

# 시작 후 확인(짧게)
$ok = $false
for ($i = 0; $i -lt 10; $i++) {
	if (Test-AgentHealthy -port $Port) { $ok = $true; break }
	Start-Sleep -Milliseconds 300
}

if ($ok) {
	Write-Host ("✅ Host agent started: http://127.0.0.1:{0}/health" -f $Port)
	exit 0
}

Write-Host ("⚠️  Host agent started but health check failed: http://127.0.0.1:{0}/health" -f $Port) -ForegroundColor Yellow
exit 1

