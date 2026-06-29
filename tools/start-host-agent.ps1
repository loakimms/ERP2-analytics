param(
	[int]$Port = 9230,
	[int]$CdpPort = 9223,
	[switch]$NoPause = $false
)

$ErrorActionPreference = "Stop"

$agent = Join-Path $PSScriptRoot "host-agent.ps1"
if (-not (Test-Path -LiteralPath $agent)) { throw "host-agent.ps1 not found: $agent" }

function Stop-ExistingHostAgents([int]$port) {
	try {
		Invoke-RestMethod -Method Post -Uri ("http://127.0.0.1:{0}/shutdown" -f $port) -TimeoutSec 2 | Out-Null
		Start-Sleep -Milliseconds 700
	} catch {
		# The process may already be down or blocked before the listener responds.
	}

	try {
		$currentPid = $PID
		$processes = Get-CimInstance Win32_Process | Where-Object {
			$cmd = [string]($_.CommandLine)
			if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }
			if ([int]$_.ProcessId -eq [int]$currentPid) { return $false }
			$isHostAgent = $cmd -like "*host-agent.ps1*"
			$usesPort = $cmd -like ("*-Port {0}*" -f $port)
			return ($isHostAgent -and $usesPort)
		}
		foreach ($process in $processes) {
			try { Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue } catch {}
		}
	} catch {
		# Best effort cleanup. The new process will still fail health check if the port is occupied.
	}
	Start-Sleep -Milliseconds 700
}

function Test-AgentHealthy([int]$port) {
	try {
		$r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $port) -TimeoutSec 1
		return ($r -and $r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
	} catch {
		return $false
	}
}

# Re-running the launcher is an explicit restart. Stop stale repo/standalone/worker
# processes first so old Host Agent code cannot keep claiming collector jobs.
Stop-ExistingHostAgents -port $Port

# Host Agent 상태는 웹 수집 모달에서 확인하므로 장시간 실행 콘솔 창은 숨김으로 띄운다.
Start-Process -FilePath "pwsh" -ArgumentList @(
	"-NoProfile",
	"-ExecutionPolicy", "Bypass",
	"-File", $agent,
	"-Port", $Port,
	"-CdpPort", $CdpPort
) -WindowStyle Hidden | Out-Null

for ($i = 0; $i -lt 20; $i++) {
	if (Test-AgentHealthy -port $Port) { break }
	Start-Sleep -Milliseconds 500
}

if (Test-AgentHealthy -port $Port) {
	Write-Host "✅ Host agent started in background: http://127.0.0.1:$Port/health"
} else {
	Write-Host "⚠️ Host agent start requested, but health check is not ready: http://127.0.0.1:$Port/health" -ForegroundColor Yellow
}
Write-Host "   - 상태 확인/수집 제어는 UI 수집 모달에서 진행합니다."

if (-not $NoPause) {
	Read-Host -Prompt "위 내용을 확인한 뒤 Enter 키를 누르면 이 창이 닫힙니다"
}
