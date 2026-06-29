# NAS 수집 종료 후 정리(중지/삭제)
# - Host Chrome 종료
# - Host Agent 자동 실행(작업 스케줄러) 제거
# - 9223 접근 설정(방화벽/portproxy) 원복
# - (선택) 설치 파일(%LOCALAPPDATA%\ERP2-Analytics-HostAgent) 삭제
param(
  [string]$NasIp = "192.168.0.50",
  [int]$AgentPort = 9230,
  [int]$CdpPort = 9223,
  [string]$LocalIp,
  # Host Chrome를 구분하기 위한 user-data-dir (기본값: HostAgent/HostChrome에서 쓰는 기본값)
  [string]$UserDataDir = "$env:LOCALAPPDATA\\ERP2-Analytics-HostChrome",
  [switch]$KeepFiles,
  [switch]$NoPause = $false
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host ("[INFO] " + $m) -ForegroundColor Cyan }
function Write-Warn([string] $m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }

function Is-Admin {
  return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-Admin {
  if (Is-Admin) { return }
  $pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if (-not $pwsh) { $pwsh = "pwsh" }
  Write-Warn "관리자 권한이 필요합니다. UAC 승인 창이 뜹니다."
  $psArgs = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $PSCommandPath,
    "-NasIp", $NasIp,
    "-AgentPort", $AgentPort,
    "-CdpPort", $CdpPort,
    "-NoPause:$NoPause"
  )
  if ($LocalIp) { $psArgs += @("-LocalIp", $LocalIp) }
  if ($KeepFiles) { $psArgs += "-KeepFiles" }
  Start-Process -FilePath $pwsh -ArgumentList $psArgs -Verb RunAs -WindowStyle Normal | Out-Null
  exit 0
}

function Test-PrivateIpv4([string]$IpAddress) {
  if ([string]::IsNullOrWhiteSpace($IpAddress)) { return $false }
  if ($IpAddress -like "127.*" -or $IpAddress -like "169.254.*") { return $false }
  return (
    $IpAddress -like "10.*" -or
    $IpAddress -like "192.168.*" -or
    $IpAddress -match "^172\.(1[6-9]|2[0-9]|3[0-1])\."
  )
}

function Get-CandidateLocalIpv4s {
  $configByIndex = @{}
  try {
    foreach ($cfg in (Get-NetIPConfiguration -ErrorAction SilentlyContinue)) {
      try {
        $idx = [int]$cfg.InterfaceIndex
        if (-not $configByIndex.ContainsKey($idx)) { $configByIndex[$idx] = $cfg }
      } catch {}
    }
  } catch {}

  $rows = New-Object 'System.Collections.Generic.List[object]'
  try {
    foreach ($addr in (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue)) {
      $ip = [string]$addr.IPAddress
      if (-not (Test-PrivateIpv4 $ip)) { continue }

      $alias = [string]$addr.InterfaceAlias
      $gateway = ""
      try {
        $cfg = $configByIndex[[int]$addr.InterfaceIndex]
        if ($cfg -and $cfg.IPv4DefaultGateway) {
          $gateway = [string]($cfg.IPv4DefaultGateway.NextHop | Select-Object -First 1)
        }
      } catch {}

      $isVirtual = $alias -match "WSL|Hyper-V|vEthernet|VMware|VirtualBox|Loopback|Tailscale|ZeroTier|Docker"
      $score = 0
      if (-not $isVirtual) { $score += 100 } else { $score -= 100 }
      if ($gateway) { $score += 50 }
      if ([string]$addr.AddressState -eq "Preferred") { $score += 40 }
      if ([string]$addr.AddressState -eq "Deprecated") { $score -= 20 }
      if ([string]$addr.PrefixOrigin -eq "Dhcp") { $score += 10 }
      if ($ip -like "192.168.*") { $score += 5 }

      $rows.Add([pscustomobject]@{
        InterfaceAlias = $alias
        IPAddress = $ip
        AddressState = [string]$addr.AddressState
        HasGateway = [bool]$gateway
        IsVirtual = $isVirtual
        Score = $score
      }) | Out-Null
    }
  } catch {}

  return @(
    $rows |
      Sort-Object -Property `
        @{ Expression = "Score"; Descending = $true }, `
        @{ Expression = "HasGateway"; Descending = $true }, `
        @{ Expression = { $_.AddressState -eq "Preferred" }; Descending = $true }, `
        @{ Expression = "InterfaceAlias"; Descending = $false }, `
        @{ Expression = "IPAddress"; Descending = $false }
  )
}

function Pick-LocalIpv4 {
  $candidates = @(Get-CandidateLocalIpv4s)
  foreach ($candidate in $candidates) {
    if ($candidate.IsVirtual) { continue }
    if ($candidate.AddressState -ne "Preferred" -and -not $candidate.HasGateway) { continue }
    return $candidate.IPAddress
  }
  if ($candidates.Count -gt 0) { return $candidates[0].IPAddress }
  return $null
}

Ensure-Admin

if (-not $LocalIp) { $LocalIp = Pick-LocalIpv4 }

Write-Info "NAS IP = $NasIp"
Write-Info ("Local IP = " + ($LocalIp ?? "(auto-detect failed)"))
Write-Info ("UserDataDir = " + ($UserDataDir ?? ""))

function Stop-HostChromeFallback([int] $port, [string] $udd) {
	# agent가 죽어있어도 Host Chrome만 안전하게 종료할 수 있도록,
	# stop-host-chrome.ps1의 정책을 여기에도 포함한다.
	$stopped = $false
	try {
		$pidFile = if ($udd) { Join-Path $udd "host-chrome.pid" } else { $null }
		if ($pidFile -and (Test-Path -LiteralPath $pidFile)) {
			$pidText = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
			if ($pidText) {
				$chromePid = [int]$pidText
				$proc = Get-Process -Id $chromePid -ErrorAction SilentlyContinue
				if ($proc) {
					Stop-Process -Id $chromePid -Force -ErrorAction SilentlyContinue
					$stopped = $true
				}
			}
		}
	} catch {}

	if (-not $stopped) {
		try {
			$needlePort = "--remote-debugging-port=$port"
			$needleUserData = if ($udd) { "--user-data-dir=`"$udd`"" } else { "" }
			$targets =
				Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
				Where-Object {
					$_.CommandLine -and
					($_.CommandLine -like "*$needlePort*") -and
					(($needleUserData -eq "") -or ($_.CommandLine -like "*$needleUserData*"))
				}
			foreach ($t in $targets) {
				try { Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
			}
			if ($targets.Count -gt 0) { $stopped = $true }
		} catch {}
	}

	try {
		if ($udd) {
			$pidFile2 = Join-Path $udd "host-chrome.pid"
			if (Test-Path -LiteralPath $pidFile2) { Remove-Item -LiteralPath $pidFile2 -Force -ErrorAction SilentlyContinue }
		}
	} catch {}

	return $stopped
}

function Stop-HostAgentByCommandLine {
	# LISTEN pid가 없거나, 작업 스케줄러가 먼저 띄웠는데 포트가 내려가 있는 등
	# "프로세스만 남아있는" 케이스를 커맨드라인으로 제거한다.
	$killed = 0
	try {
		$needle2 = "host-agent.ps1"
		$needlePort = "-Port $AgentPort"
		$targets =
			Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'" |
			Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$needle2*") -and ($_.CommandLine -like "*$needlePort*") }
		foreach ($t in $targets) {
			try { Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue; $killed += 1 } catch {}
		}
	} catch {}
	return $killed
}

function Remove-PortProxyAll([int] $port) {
	# listenaddress가 자동 감지와 다르게 잡혀도 확실히 삭제되도록
	# 현재 등록된 v4tov4 중 해당 listenport 전체를 제거한다.
	$removed = 0
	try {
		$out = (& netsh interface portproxy show v4tov4) -join "`n"
		# 예) 192.168.0.28    9223        127.0.0.1       9223
		$rx = [regex]"(?m)^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+$port\s+(\d{1,3}(?:\.\d{1,3}){3})\s+\d+\s*$"
		$m = $rx.Matches($out)
		foreach ($mm in $m) {
			$la = $mm.Groups[1].Value
			try { & netsh interface portproxy delete v4tov4 listenaddress=$la listenport=$port | Out-Null; $removed += 1 } catch {}
		}
	} catch {}
	return $removed
}

# 1) Host Chrome 종료(best-effort)
try {
  Invoke-RestMethod -Method Post -Uri ("http://127.0.0.1:{0}/stop-host-chrome?port={1}" -f $AgentPort, $CdpPort) -TimeoutSec 3 | Out-Null
  Write-Info "Host Chrome stop requested (via agent)"
} catch {
  Write-Warn "Host Chrome stop request failed (agent not reachable)"
}
try {
	$stopped = Stop-HostChromeFallback -port $CdpPort -udd $UserDataDir
	if ($stopped) { Write-Info "Host Chrome stopped (fallback)" }
} catch {}

# 2) Host Agent 프로세스 종료(best-effort): 9230 LISTEN pid만 종료
try {
  $c = Get-NetTCPConnection -LocalPort $AgentPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c -and $c.OwningProcess) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Info ("Stopped process listening on {0} (pid={1})" -f $AgentPort, $c.OwningProcess)
  }
} catch {}
try {
	$k = Stop-HostAgentByCommandLine
	if ($k -gt 0) { Write-Info ("Stopped host-agent processes by command line: {0}" -f $k) }
} catch {}

# 3) 작업 스케줄러 제거
$task1 = "ERP2-Analytics Host Agent"
$task2 = "ERP2-Analytics Host Agent (ensure)"
try { schtasks.exe /End /TN "$task2" | Out-Null } catch {}
try { schtasks.exe /End /TN "$task1" | Out-Null } catch {}
try { schtasks.exe /Delete /TN "$task2" /F | Out-Null } catch {}
try { schtasks.exe /Delete /TN "$task1" /F | Out-Null } catch {}
Write-Info "Scheduled tasks removed (if existed)"

# 4) portproxy 원복
try {
	$removed = Remove-PortProxyAll -port $CdpPort
	if ($removed -gt 0) { Write-Info ("portproxy removed: {0} entries" -f $removed) }
	else {
		# fallback: local ip 한 번 더 시도
		if ($LocalIp) {
			try { & netsh interface portproxy delete v4tov4 listenaddress=$LocalIp listenport=$CdpPort | Out-Null } catch {}
		}
		Write-Info "portproxy removed (if existed)"
	}
} catch {
	Write-Warn "portproxy cleanup failed"
}

# 5) 방화벽 규칙 제거(이름 기준)
try { Remove-NetFirewallRule -DisplayName "ERP2 Analytics HostChrome CDP 9223 (from NAS)" -ErrorAction SilentlyContinue | Out-Null } catch {}
try { Remove-NetFirewallRule -DisplayName "TEMP allow 9223 any (5min test)" -ErrorAction SilentlyContinue | Out-Null } catch {}
Write-Info "Firewall rule removed (if existed)"

# 6) URLACL 제거(best-effort)
try { & netsh http delete urlacl url=("http://127.0.0.1:{0}/" -f $AgentPort) | Out-Null } catch {}
try { & netsh http delete urlacl url=("http://localhost:{0}/" -f $AgentPort) | Out-Null } catch {}

# 7) 설치 파일 삭제(선택)
if (-not $KeepFiles) {
  try {
    $dir = Join-Path $env:LOCALAPPDATA "ERP2-Analytics-HostAgent"
    if (Test-Path -LiteralPath $dir) {
      Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
      Write-Info "Removed install dir: $dir"
    }
  } catch {}
} else {
  Write-Info "KeepFiles enabled: install dir not removed"
}

Write-Host ""
Write-Info "Cleanup done."
Write-Host ""
try {
	$live9230 = (& netstat -ano | Select-String (":$AgentPort")).Count
	$live9223 = (& netstat -ano | Select-String (":$CdpPort")).Count
	if ($live9230 -gt 0 -or $live9223 -gt 0) {
		Write-Warn "포트가 아직 남아있을 수 있습니다. (9230 lines=$live9230, 9223 lines=$live9223)"
		Write-Warn "확인: netstat -ano | findstr :9230  /  netstat -ano | findstr :9223"
	}
} catch {}
if (-not $NoPause) {
  Read-Host -Prompt "Enter 키를 누르면 이 창이 닫힙니다"
}

