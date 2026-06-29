# Analytics CDP 전용 Chrome 실행기 (운영 PC / 로컬 레포 기반)
# - "우클릭 → PowerShell로 실행"으로 실행되는 경우가 많아 pwsh(PowerShell 7+) 재실행을 시도합니다.
param(
  [int]$Port = 9223,
  [string]$UserDataDir = "$env:LOCALAPPDATA\ERP2-Analytics-HostChrome",
  [string]$StartUrl = "https://search.shopping.naver.com/",
  [string]$ProfileDir = "Default",
  [switch]$OpenCdpList = $false,
  [switch]$BringToFront = $true,
  [switch]$StartMaximized = $true,
  [switch]$WritePidFile = $true
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSVersion.Major -lt 7) {
  $pwshCmd0 = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pwshCmd0 -and $pwshCmd0.Source) {
    Start-Process -FilePath $pwshCmd0.Source -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", $PSCommandPath,
      "-Port", $Port,
      "-UserDataDir", $UserDataDir,
      "-StartUrl", $StartUrl,
      "-ProfileDir", $ProfileDir,
      "-OpenCdpList:$OpenCdpList",
      "-BringToFront:$BringToFront",
      "-StartMaximized:$StartMaximized",
      "-WritePidFile:$WritePidFile"
    ) -WindowStyle Normal | Out-Null
    exit 0
  }
}

function Find-ChromePath {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($candidates) { return ($candidates | Select-Object -First 1) }

  try {
    $reg = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue
    if ($reg -and $reg.'(default)' -and (Test-Path $reg.'(default)')) { return $reg.'(default)' }
  } catch {}
  try {
    $reg2 = Get-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue
    if ($reg2 -and $reg2.'(default)' -and (Test-Path $reg2.'(default)')) { return $reg2.'(default)' }
  } catch {}

  return $null
}

$chrome = Find-ChromePath
if (-not $chrome) {
  Write-Host ""
  Write-Host "Chrome 실행 파일을 찾지 못했습니다." -ForegroundColor Red
  Write-Host ""
  Read-Host -Prompt "아래 메시지를 확인한 뒤 Enter 키를 누르면 이 창이 닫힙니다"
  exit 1
}

try {
  New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null
  $chromePath = (Resolve-Path -LiteralPath $chrome).ProviderPath

  $chromeArgs = @(
    "--new-window",
    "--remote-debugging-port=$Port",
    "--remote-debugging-address=0.0.0.0",
    "--remote-allow-origins=*",
    ("--user-data-dir=`"$UserDataDir`""),
    ("--profile-directory=`"$ProfileDir`""),
    "--no-first-run",
    "--no-default-browser-check",
    ("`"$StartUrl`"")
  )
  if ($StartMaximized) { $chromeArgs += "--start-maximized" }

  $argLine = ($chromeArgs -join " ")
  $proc = Start-Process -FilePath $chromePath -ArgumentList $argLine -WorkingDirectory (Get-Location) -PassThru

  if ($WritePidFile) {
    try {
      $pidFile = Join-Path $UserDataDir "host-chrome.pid"
      Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ASCII
    } catch {}
  }

  Write-Host ""
  Write-Host "✅ Host Chrome started for CDP reuse"
  Write-Host " - remote debugging port: $Port"
  Write-Host (" - pid: {0}" -f $proc.Id)
  Write-Host ""

  if ($BringToFront) {
    try {
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Win32Window {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@ -ErrorAction Stop | Out-Null
      Start-Sleep -Milliseconds 250
      $p = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
      if ($p -and $p.MainWindowHandle -and $p.MainWindowHandle -ne 0) {
        [Win32Window]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null
        [Win32Window]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
      }
    } catch {}
  }

  if ($OpenCdpList) {
    try { Start-Process "http://127.0.0.1:$Port/json/list" | Out-Null } catch {}
  }
} catch {
  Write-Host ""
  Write-Host "오류가 발생했습니다:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
}

Read-Host -Prompt "위 내용을 확인한 뒤 Enter 키를 누르면 이 창이 닫힙니다"

