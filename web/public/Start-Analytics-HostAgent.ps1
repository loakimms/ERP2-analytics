# Analytics Host Agent 실행기(로컬 세션 준비용)
# - 목적: 웹 UI의 "로컬 세션 준비" 버튼이 host-agent(127.0.0.1:9230)를 통해
#   Host Chrome(CDP 9223)을 자동으로 띄울 수 있게 한다.
# - 사용: 이 파일을 다운로드 후 "우클릭 → PowerShell로 실행"
param(
  [int]$Port = 9230,
  [int]$CdpPort = 9223,
  [switch]$NoPause = $false
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Add-UniquePath([System.Collections.Generic.List[string]]$Items, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return }
  $normalized = $Value.Trim()
  if (-not $Items.Contains($normalized)) { $Items.Add($normalized) }
}

function Add-ParentCandidates([System.Collections.Generic.List[string]]$Items, [string]$StartPath) {
  if ([string]::IsNullOrWhiteSpace($StartPath)) { return }

  $current = $StartPath
  while (-not [string]::IsNullOrWhiteSpace($current)) {
    Add-UniquePath $Items $current

    $canonicalFile = Join-Path $current "CANONICAL_ROOT.txt"
    if (Test-Path -LiteralPath $canonicalFile) {
      try {
        $canonicalRoot = (Get-Content -LiteralPath $canonicalFile -TotalCount 1 -ErrorAction Stop | Select-Object -First 1).Trim()
        Add-UniquePath $Items $canonicalRoot
      } catch {}
    }

    $parent = Split-Path -Parent $current
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) { break }
    $current = $parent
  }
}

function Resolve-AnalyticsRepoRoot {
  $candidates = New-Object 'System.Collections.Generic.List[string]'

  Add-UniquePath $candidates $env:ERP2_ANALYTICS_ROOT
  Add-ParentCandidates $candidates $PSScriptRoot

  try {
    Add-ParentCandidates $candidates ((Get-Location).Path)
  } catch {}

  try {
    foreach ($driveRoot in (Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root)) {
      Add-UniquePath $candidates (Join-Path $driveRoot "dev\ERP2-analytics")
    }
  } catch {}

  Add-UniquePath $candidates "D:\dev\ERP2-analytics"
  Add-UniquePath $candidates "C:\dev\ERP2-analytics"

  foreach ($root in $candidates) {
    $toolPath = Join-Path $root "tools\start-host-agent.ps1"
    if (Test-Path -LiteralPath $toolPath) { return $root }
  }

  return $null
}

$installed = Join-Path $env:LOCALAPPDATA "ERP2-Analytics-HostAgent\start-host-agent.ps1"
$repoRoot = Resolve-AnalyticsRepoRoot
$repoScript = if ($repoRoot) { Join-Path $repoRoot "tools\start-host-agent.ps1" } else { $null }
$agentScript = if (Test-Path -LiteralPath $installed) { $installed } else { $repoScript }

if (-not (Test-Path -LiteralPath $agentScript)) {
  Write-Host ""
  Write-Host "start-host-agent.ps1을 찾지 못했습니다." -ForegroundColor Red
  Write-Host "1) (권장) Install-Analytics-HostAgent.ps1 로 standalone 설치 후 재시도" -ForegroundColor Yellow
  Write-Host "2) 개발 PC라면 프로젝트 루트를 먼저 지정할 수 있습니다." -ForegroundColor Yellow
  Write-Host '   $env:ERP2_ANALYTICS_ROOT = "D:\dev\ERP2-analytics"' -ForegroundColor Yellow
  Write-Host " - searched repo root: $repoRoot" -ForegroundColor Yellow
  Write-Host ""
  if (-not $NoPause) { Read-Host -Prompt "Enter 키를 누르면 이 창이 닫힙니다" }
  exit 1
}

try {
  Write-Host ""
  Write-Host "Host Agent 백그라운드 실행을 요청하는 중입니다..." -ForegroundColor Cyan
  if ($repoRoot) { Write-Host " - repo: $repoRoot" }
  Write-Host " - health target: http://127.0.0.1:$Port/health"
  Write-Host ""
  Start-Process -FilePath "pwsh" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $agentScript,
    "-Port", $Port,
    "-CdpPort", $CdpPort,
    "-NoPause"
  ) -WindowStyle Hidden | Out-Null

  Write-Host ""
  Write-Host "✅ Host agent 백그라운드 실행을 요청했습니다." -ForegroundColor Green
  if ($repoRoot) { Write-Host " - repo: $repoRoot" }
  Write-Host " - health: http://127.0.0.1:$Port/health"
  Write-Host " - 상태 확인/수집 제어는 웹 수집 모달에서 진행합니다."
  Write-Host ""
} catch {
  Write-Host ""
  Write-Host "오류가 발생했습니다:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
}

if (-not $NoPause) {
  Read-Host -Prompt "위 내용을 확인한 뒤 Enter 키를 누르면 이 창이 닫힙니다"
}
