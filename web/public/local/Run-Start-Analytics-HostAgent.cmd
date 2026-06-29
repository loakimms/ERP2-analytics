@echo off
setlocal
set "POWERSHELL_EXE=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not exist "%POWERSHELL_EXE%" set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL_EXE%" (
  echo PowerShell executable was not found.
  pause
  exit /b 1
)
set "ANALYTICS_LAUNCHER_SELF=%~f0"
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $self = $env:ANALYTICS_LAUNCHER_SELF; $lines = Get-Content -LiteralPath $self -Encoding UTF8; $start = [Array]::IndexOf($lines, '###__POWERSHELL__###'); if ($start -lt 0) { throw 'launcher_marker_not_found' }; $body = $lines | Select-Object -Skip ($start + 1); $tmp = Join-Path $env:TEMP ('analytics-launch-' + [guid]::NewGuid().ToString('N') + '.ps1'); [System.IO.File]::WriteAllLines($tmp, $body, [System.Text.UTF8Encoding]::new($false)); try { & $tmp; $code = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }; exit $code } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }"
exit /b %ERRORLEVEL%
###__POWERSHELL__###
# Analytics Host Agent 실행기(운영 PC / 로컬 레포 기반)
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
      "-NoPause:$NoPause"
    ) -WindowStyle Normal | Out-Null
    exit 0
  }
}

$repoRoot = Resolve-AnalyticsRepoRoot
$agentScript = if ($repoRoot) { Join-Path $repoRoot "tools\start-host-agent.ps1" } else { $null }
if (-not (Test-Path -LiteralPath $agentScript)) {
  Write-Host ""
  Write-Host "start-host-agent.ps1을 찾지 못했습니다." -ForegroundColor Red
  Write-Host " - searched root: $repoRoot" -ForegroundColor Yellow
  Write-Host " - fallback order: ERP2_ANALYTICS_ROOT -> 현재/상위 폴더 -> 각 드라이브의 \dev\ERP2-analytics" -ForegroundColor Yellow
  Write-Host ' - 필요 시 먼저 지정: $env:ERP2_ANALYTICS_ROOT = "D:\dev\ERP2-analytics"' -ForegroundColor Yellow
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
  Write-Host " - repo: $repoRoot"
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
  Read-Host -Prompt "위 내용을 확인한 뒤 Enter 키를 누르면 종료됩니다"
}

