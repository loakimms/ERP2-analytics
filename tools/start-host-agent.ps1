param(
	[int]$Port = 9230,
	[int]$CdpPort = 9223,
	[switch]$NoPause = $false
)

$ErrorActionPreference = "Stop"

$agent = Join-Path $PSScriptRoot "host-agent.ps1"
if (-not (Test-Path -LiteralPath $agent)) { throw "host-agent.ps1 not found: $agent" }

function Test-AgentHealthy([int]$port) {
	try {
		$r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $port) -TimeoutSec 1
		return ($r -and $r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
	} catch {
		return $false
	}
}

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
