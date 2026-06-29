# Analytics Host Chrome(CDP) 실행 요청 (일반 사용자 PC / NAS 수집용)
# - 직접 Chrome을 실행하지 않고, 이미 설치된 Host Agent(127.0.0.1:9230)로 요청합니다.
param(
  [int]$Port = 9223,
  [string]$StartUrl = "https://search.shopping.naver.com/",
  [string]$ProfileDir = "Default",
  [int]$AgentPort = 9230
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
      "-StartUrl", $StartUrl,
      "-ProfileDir", $ProfileDir,
      "-AgentPort", $AgentPort
    ) -WindowStyle Normal -Wait | Out-Null
    exit 0
  }
}

function Q([string] $s) {
  if ($null -eq $s) { return "" }
  try { return [System.Uri]::EscapeDataString([string]$s) } catch { return "" }
}

$health = "http://127.0.0.1:$AgentPort/health"
$start = "http://127.0.0.1:$AgentPort/start-host-chrome?port=$Port&profile_dir=$(Q $ProfileDir)&start_url=$(Q $StartUrl)"

try {
  Invoke-RestMethod -Method Get -Uri $health -TimeoutSec 2 | Out-Null
} catch {
  Write-Host ""
  Write-Host "Host Agent가 실행 중이 아닙니다." -ForegroundColor Red
  Write-Host (" - health: {0}" -f $health) -ForegroundColor Yellow
  Write-Host "먼저 Host Agent를 실행/설치한 뒤 다시 시도해 주세요." -ForegroundColor Yellow
  Write-Host ""
  Read-Host -Prompt "Enter 키를 누르면 종료됩니다"
  exit 1
}

try {
  $r = Invoke-RestMethod -Method Post -Uri $start -TimeoutSec 10
  Write-Host ""
  Write-Host "✅ Host Chrome(CDP) 실행을 요청했습니다." -ForegroundColor Green
  Write-Host (" - CDP: http://127.0.0.1:{0}/json/version" -f $Port)
  Write-Host ""
  try { Start-Process ("http://127.0.0.1:{0}/json/version" -f $Port) | Out-Null } catch {}
} catch {
  Write-Host ""
  Write-Host "오류가 발생했습니다:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
}

Read-Host -Prompt "위 내용을 확인한 뒤 Enter 키를 누르면 이 창이 닫힙니다"

