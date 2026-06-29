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
# Analytics Host Agent 자동 시작(운영 PC / 로컬 레포 기반)
# - 새 개발 PC처럼 드라이브가 바뀌어도 현재 저장소 루트를 자동 탐색합니다.
param(
  [int]$Port = 9230,
  [int]$CdpPort = 9223,
  [switch]$NoPause = $false
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Warn([string] $m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }

function Test-HostAgentTaskExists([string]$TaskName) {
  $null = & schtasks.exe /Query /TN "$TaskName" 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Get-HostAgentTaskCommand([string]$TaskName) {
  $output = @(& schtasks.exe /Query /TN "$TaskName" /FO LIST /V 2>$null)
  if ($LASTEXITCODE -ne 0) { return "" }
  $joined = (($output | ForEach-Object { "$_" }) -join [Environment]::NewLine)
  $line = ($joined -split "`r?`n" | Where-Object { $_ -match "host-agent\.ps1|start-host-agent\.ps1|ERP2-Analytics-HostAgent|ERP2-analytics" } | Select-Object -First 1)
  return [string]($line ?? "")
}

function Register-HostAgentTask([string]$TaskName, [string]$TaskRunCommand) {
  $output = @(& schtasks.exe /Create /TN "$TaskName" /TR "$TaskRunCommand" /SC ONLOGON /RL LIMITED /F 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -eq 0) { return @{ reusedExisting = $false } }

  $detail = (($output | ForEach-Object { "$_" }) -join [Environment]::NewLine).Trim()
  if ([string]::IsNullOrWhiteSpace($detail)) {
    $detail = "schtasks.exe exited with code $exitCode"
  }

  if ($detail -match "액세스가 거부|Access is denied") {
    if (Test-HostAgentTaskExists -TaskName $TaskName) {
      $currentTaskCommand = Get-HostAgentTaskCommand -TaskName $TaskName
      $expectedAgentPath = Join-Path (Resolve-AnalyticsRepoRoot) "tools\host-agent.ps1"
      if ($currentTaskCommand -and $currentTaskCommand -like "*$expectedAgentPath*" -and $currentTaskCommand -like "*-Port 9230*" -and $currentTaskCommand -like "*-CdpPort 9223*") {
        Write-Warn ("기존 작업 '{0}'이 올바른 명령으로 이미 등록되어 있어 재사용합니다. (작업 덮어쓰기는 권한상 생략)" -f $TaskName)
        return @{ reusedExisting = $true; detail = $detail }
      }
      throw ("작업 스케줄러 등록이 거부되었고 기존 '{0}' 작업의 실행 명령이 현재 repo/포트와 다릅니다.`n기존 명령: {1}`n기대 명령: {2}`n해결: 관리자 PowerShell에서 schtasks /Delete /TN `"{0}`" /F 실행 후 다시 설치하세요." -f $TaskName, $currentTaskCommand, $TaskRunCommand)
    }
    throw ("작업 스케줄러 등록이 거부되었습니다. 기존 '{0}' 작업이 관리자 권한/구버전 설치본으로 남아 있을 수 있습니다.`n해결: 작업 스케줄러에서 같은 이름의 작업을 삭제한 뒤 다시 실행하거나, 관리자 PowerShell에서 schtasks /Delete /TN `"{0}`" /F 후 다시 설치하세요.`n원본 메시지: {1}" -f $TaskName, $detail)
  }

  throw ("작업 스케줄러 등록에 실패했습니다: {0}" -f $detail)
}

function Register-HostAgentStartProtocol([string]$StartScriptPath) {
  $protocolRoot = "HKCU:\Software\Classes\erp2-analytics-host-agent"
  $commandKey = Join-Path $protocolRoot "shell\open\command"
  New-Item -Path $commandKey -Force | Out-Null
  New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
  Set-Item -Path $protocolRoot -Value "URL:ERP2 Analytics Host Agent"
  # 브라우저의 "상태확인/재시작"에서 띄우는 PowerShell 창은
  # 성공/실패 안내를 사용자가 읽을 수 있어야 하므로 NoPause를 강제하지 않는다.
  $command = "`"$pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$StartScriptPath`" -Port $Port -CdpPort $CdpPort"
  Set-Item -Path $commandKey -Value $command
}

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
    $agentPath = Join-Path $root "tools\host-agent.ps1"
    $ensurePath = Join-Path $root "tools\ensure-host-agent.ps1"
    if ((Test-Path -LiteralPath $agentPath) -and (Test-Path -LiteralPath $ensurePath)) {
      return $root
    }
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

$taskName = "ERP2-Analytics Host Agent"
$taskNameEnsure = "ERP2-Analytics Host Agent (ensure)"
$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1
$pwsh = if ($pwshCmd -and $pwshCmd.Source) { $pwshCmd.Source } else { "pwsh" }

$repoRoot = Resolve-AnalyticsRepoRoot
$agent = if ($repoRoot) { Join-Path $repoRoot "tools\host-agent.ps1" } else { $null }
$ensure = if ($repoRoot) { Join-Path $repoRoot "tools\ensure-host-agent.ps1" } else { $null }
$start = if ($repoRoot) { Join-Path $repoRoot "tools\start-host-agent.ps1" } else { $null }

if (-not (Test-Path -LiteralPath $agent)) { throw "host-agent.ps1 not found. searched root=$repoRoot" }
if (-not (Test-Path -LiteralPath $ensure)) { throw "ensure-host-agent.ps1 not found. searched root=$repoRoot" }
if (-not (Test-Path -LiteralPath $start)) { throw "start-host-agent.ps1 not found. searched root=$repoRoot" }

try {
  $tr = "`"$pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$agent`" -Port $Port -CdpPort $CdpPort"

  $taskResult = Register-HostAgentTask -TaskName $taskName -TaskRunCommand $tr
  Register-HostAgentStartProtocol -StartScriptPath $start

  Write-Host ""
  Write-Host "✅ 설치 완료: 로그온 시 Host Agent가 자동 실행됩니다." -ForegroundColor Green
  Write-Host " - mode: local repo (ops PC)"
  Write-Host " - repo: $repoRoot"
  Write-Host " - task: $taskName"
  Write-Host " - protocol: erp2-analytics-host-agent://start"
  if ($taskResult.reusedExisting) { Write-Host " - task-status: 기존 작업 재사용" -ForegroundColor Yellow }
  Write-Host " - health: http://127.0.0.1:$Port/health"
  Write-Host ""
} catch {
  Write-Host ""
  Write-Host "설치 중 오류가 발생했습니다:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
}

if (-not $NoPause) {
  Read-Host -Prompt "위 내용을 확인한 뒤 Enter 키를 누르면 종료됩니다"
}

