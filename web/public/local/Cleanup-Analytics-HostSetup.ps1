# 로컬 수집 종료 후 정리(중지/삭제)
# - Host Chrome 종료(있다면)
# - Host Agent 자동 실행(작업 스케줄러) 제거
param(
  [int]$AgentPort = 9230,
  [int]$CdpPort = 9223
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host ("[INFO] " + $m) -ForegroundColor Cyan }
function Write-Warn([string] $m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }

# 1) Host Chrome 종료(best-effort)
try {
  Invoke-RestMethod -Method Post -Uri ("http://127.0.0.1:{0}/stop-host-chrome?port={1}" -f $AgentPort, $CdpPort) -TimeoutSec 3 | Out-Null
  Write-Info "Host Chrome stop requested (via agent)"
} catch {
  Write-Warn "Host Chrome stop request failed (agent not reachable)"
}

# 2) Host Agent 프로세스 종료(best-effort): 9230 LISTEN pid만 종료
try {
  $c = Get-NetTCPConnection -LocalPort $AgentPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c -and $c.OwningProcess) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Info ("Stopped process listening on {0} (pid={1})" -f $AgentPort, $c.OwningProcess)
  }
} catch {}

# 2-b) LISTEN pid가 없어도 host-agent 프로세스가 남을 수 있어 커맨드라인으로 정리
try {
  $needle2 = "host-agent.ps1"
  $needlePort = "-Port $AgentPort"
  $targets =
    Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'" |
    Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$needle2*") -and ($_.CommandLine -like "*$needlePort*") }
  foreach ($t in $targets) {
    try { Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
} catch {}

# 3) 작업 스케줄러 제거(있다면)
$task1 = "ERP2-Analytics Host Agent"
$task2 = "ERP2-Analytics Host Agent (ensure)"
try { schtasks.exe /End /TN "$task2" | Out-Null } catch {}
try { schtasks.exe /End /TN "$task1" | Out-Null } catch {}
try { schtasks.exe /Delete /TN "$task2" /F | Out-Null } catch {}
try { schtasks.exe /Delete /TN "$task1" /F | Out-Null } catch {}
Write-Info "Scheduled tasks removed (if existed)"

Write-Host ""
Write-Info "Cleanup done."
Write-Host ""
Read-Host -Prompt "Enter 키를 누르면 이 창이 닫힙니다"

