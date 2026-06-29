# Analytics NAS 수집용 호스트 준비 통합 스크립트
# 1) Host Agent 설치
# 2) Host Agent 실행
# 3) NAS -> Host Chrome CDP(9223) 접근 허용
param(
  [string]$NasIp = "192.168.0.50",
  [int]$AgentPort = 9230,
  [int]$CdpPort = 9223,
  [string]$InstallDir = "$env:LOCALAPPDATA\\ERP2-Analytics-HostAgent",
  [switch]$NoPause = $false
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host ("[STEP] " + $Message) -ForegroundColor Cyan
}

# Windows PowerShell(5.1)로 실행되면 pwsh로 재실행(가능하면)
if ($PSVersionTable.PSVersion.Major -lt 7) {
  $pwshCmd0 = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pwshCmd0 -and $pwshCmd0.Source) {
    Start-Process -FilePath $pwshCmd0.Source -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", $PSCommandPath,
      "-NasIp", $NasIp,
      "-AgentPort", $AgentPort,
      "-CdpPort", $CdpPort,
      "-InstallDir", $InstallDir,
      "-NoPause:$NoPause"
    ) -WindowStyle Normal -Wait | Out-Null
    exit 0
  }
}

$installScript = Join-Path $PSScriptRoot "Install-Analytics-HostAgent.ps1"
$startAgentScript = Join-Path $PSScriptRoot "Start-Analytics-HostAgent.ps1"
$enableNasAccessScript = Join-Path $PSScriptRoot "Enable-Analytics-HostChrome-NasAccess.ps1"

foreach ($requiredScript in @($installScript, $startAgentScript, $enableNasAccessScript)) {
  if (-not (Test-Path -LiteralPath $requiredScript)) {
    throw "필수 스크립트를 찾지 못했습니다: $requiredScript"
  }
}

try {
  Write-Step "1/3 Host Agent 설치"
  & $installScript -Port $AgentPort -CdpPort $CdpPort -InstallDir $InstallDir -NoPause

  Write-Step "2/3 Host Agent 실행"
  & $startAgentScript -Port $AgentPort -CdpPort $CdpPort -InstallDir $InstallDir -NoPause

  Write-Step "3/3 NAS 9223 접근 설정"
  & $enableNasAccessScript -NasIp $NasIp -CdpPort $CdpPort -NoPause

  Write-Host ""
  Write-Host "✅ NAS 호스트 준비가 완료되었습니다." -ForegroundColor Green
  Write-Host (" - host agent health: http://127.0.0.1:{0}/health" -f $AgentPort)
  Write-Host (" - local cdp probe: http://127.0.0.1:{0}/json/version" -f $CdpPort)
  Write-Host " - 다음 단계: Analytics 웹에서 'NAS 세션 준비' 클릭"
  Write-Host ""
} catch {
  Write-Host ""
  Write-Host "❌ NAS 호스트 준비 중 오류가 발생했습니다." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  if ($NoPause) { throw }
}

if (-not $NoPause) {
  Read-Host -Prompt "Press Enter to close this window"
}
