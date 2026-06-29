# Analytics Host Agent 실행기 (일반 사용자 PC / NAS 수집용, Standalone)
param(
  [int]$Port = 9230,
  [int]$CdpPort = 9223,
  [string]$InstallDir = "$env:LOCALAPPDATA\\ERP2-Analytics-HostAgent",
  [switch]$NoPause = $false
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Windows PowerShell(5.1)로 실행되면 pwsh로 재실행(가능하면)
if ($PSVersionTable.PSVersion.Major -lt 7) {
  $pwshCmd0 = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pwshCmd0 -and $pwshCmd0.Source) {
    Start-Process -FilePath $pwshCmd0.Source -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", $PSCommandPath,
      "-Port", $Port,
      "-CdpPort", $CdpPort,
      "-InstallDir", $InstallDir,
      "-NoPause:$NoPause"
    ) -WindowStyle Normal -Wait | Out-Null
    exit 0
  }
}

function Test-AgentHealthy([int]$CheckPort, [int]$TimeoutSeconds = 6) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $CheckPort) -TimeoutSec 1
      if ($r -and $r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 250
  }
  return $false
}

$start = Join-Path $InstallDir "start-host-agent.ps1"
if (-not (Test-Path -LiteralPath $start)) {
  Write-Host ""
  Write-Host "start-host-agent.ps1을 찾지 못했습니다: $start" -ForegroundColor Red
  Write-Host "먼저 설치를 실행해 주세요: Install-Analytics-HostAgent.ps1 (nas/)" -ForegroundColor Yellow
  Write-Host ""
  if (-not $NoPause) {
    Read-Host -Prompt "Enter 키를 누르면 종료됩니다"
  }
  exit 1
}

try {
  Write-Host ""
  Write-Host "Host Agent 실행을 확인하는 중입니다..." -ForegroundColor Cyan
  Write-Host (" - install: {0}" -f $InstallDir)
  Write-Host (" - health target: http://127.0.0.1:{0}/health" -f $Port)
  Write-Host ""
  & $start -Port $Port -CdpPort $CdpPort -NoPause | Out-Host
  if (Test-AgentHealthy -CheckPort $Port) {
    Write-Host ""
    Write-Host "✅ Host Agent health 확인 완료" -ForegroundColor Green
    Write-Host (" - health: http://127.0.0.1:{0}/health" -f $Port)
    Write-Host ""
  } else {
    Write-Host ""
    Write-Host "⚠ Host Agent 실행 요청 후 health 확인에 실패했습니다." -ForegroundColor Yellow
    Write-Host (" - 확인: http://127.0.0.1:{0}/health" -f $Port) -ForegroundColor Yellow
    Write-Host " - standalone 설치본만 사용합니다. repo 경로로 자동 fallback하지 않습니다." -ForegroundColor Yellow
    Write-Host " - 9230 포트 충돌, 보안SW, 구버전 프로세스 잔존 여부를 확인해 주세요." -ForegroundColor Yellow
    Write-Host ""
    if ($NoPause) { throw "HOST_AGENT_HEALTH_CHECK_FAILED" }
  }
} catch {
  Write-Host ""
  Write-Host "오류가 발생했습니다:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  if ($NoPause) { throw }
}

if (-not $NoPause) {
  Read-Host -Prompt "위 내용을 확인한 뒤 Enter 키를 누르면 종료됩니다"
}

