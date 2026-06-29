# NAS 수집을 위해 "호스트 PC의 CDP(9223)"를 NAS(예: 192.168.0.50)에서 접근 가능하게 설정합니다.
# - 회사 PC 환경에서 Chrome CDP가 127.0.0.1로만 LISTEN 하는 경우가 있어, portproxy로 우회합니다.
# - 방화벽 규칙은 NAS IP만 허용하도록 제한합니다.
param(
  [string]$NasIp = "192.168.0.50",
  [int]$CdpPort = 9223,
  [string]$LocalIp,
  [switch]$DryRun,
  [switch]$NoPause = $false
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host ("[INFO] " + $m) -ForegroundColor Cyan }
function Write-Warn([string] $m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }
function Write-Err([string] $m) { Write-Host ("[ERR] " + $m) -ForegroundColor Red }

function Test-HttpOk {
  param([string]$Url, [int]$TimeoutSeconds = 2)
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSeconds -Method GET
    return [bool]($resp -and $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Is-Admin {
  return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-PortProxyReady {
  if ($DryRun) {
    Write-Warn "DRY RUN: iphlpsvc(IP Helper) 상태는 변경하지 않습니다."
    return
  }
  try {
    $svc = Get-Service -Name iphlpsvc -ErrorAction Stop
  } catch {
    throw "IP Helper(iphlpsvc) 서비스를 찾지 못했습니다. portproxy를 사용할 수 없습니다."
  }

  try {
    if ($svc.StartType -eq 'Disabled') {
      Write-Warn "IP Helper(iphlpsvc)가 Disabled 상태였습니다. Manual로 변경합니다."
      Set-Service -Name iphlpsvc -StartupType Manual -ErrorAction Stop
      $svc = Get-Service -Name iphlpsvc -ErrorAction Stop
    }
  } catch {
    throw "IP Helper(iphlpsvc) 시작 유형을 변경하지 못했습니다: $($_.Exception.Message)"
  }

  if ($svc.Status -ne 'Running') {
    try {
      Write-Info "IP Helper(iphlpsvc) 서비스를 시작합니다."
      Start-Service -Name iphlpsvc -ErrorAction Stop
      $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(10))
    } catch {
      throw "IP Helper(iphlpsvc) 서비스를 시작하지 못했습니다: $($_.Exception.Message)"
    }
  }

  Write-Info "IP Helper(iphlpsvc) = Running"
}

function Ensure-Admin {
  if ($DryRun) { return }
  if (Is-Admin) { return }
  $pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if (-not $pwsh) { $pwsh = "pwsh" }
  Write-Warn "관리자 권한이 필요합니다. UAC 승인 창이 뜹니다."
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $PSCommandPath,
    "-NasIp", $NasIp,
    "-CdpPort", $CdpPort,
    "-NoPause:$NoPause"
  )
  if ($LocalIp) { $args += @("-LocalIp", $LocalIp) }
  if ($DryRun) { $args += "-DryRun" }
  Start-Process -FilePath $pwsh -ArgumentList $args -Verb RunAs -WindowStyle Normal -Wait | Out-Null
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
    $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue
    foreach ($addr in $addresses) {
      $ip = [string]$addr.IPAddress
      if (-not (Test-PrivateIpv4 $ip)) { continue }

      $alias = [string]$addr.InterfaceAlias
      $state = [string]$addr.AddressState
      $prefixOrigin = [string]$addr.PrefixOrigin
      $gateway = ""
      try {
        $cfg = $configByIndex[[int]$addr.InterfaceIndex]
        if ($cfg -and $cfg.IPv4DefaultGateway) {
          $gateway = [string]($cfg.IPv4DefaultGateway.NextHop | Select-Object -First 1)
        }
      } catch {}

      $isVirtual = $alias -match "WSL|Hyper-V|vEthernet|VMware|VirtualBox|Loopback|Tailscale|ZeroTier|Docker"
      $isPreferred = $state -eq "Preferred"
      $isDeprecated = $state -eq "Deprecated"

      $score = 0
      if (-not $isVirtual) { $score += 100 } else { $score -= 100 }
      if ($gateway) { $score += 50 }
      if ($isPreferred) { $score += 40 }
      if ($isDeprecated) { $score -= 20 }
      if ($prefixOrigin -eq "Dhcp") { $score += 10 }
      if ($ip -like "192.168.*") { $score += 5 }

      $rows.Add([pscustomobject]@{
        InterfaceAlias = $alias
        IPAddress = $ip
        AddressState = $state
        PrefixOrigin = $prefixOrigin
        HasGateway = [bool]$gateway
        Gateway = $gateway
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

function Remove-PortProxyAll([int] $port) {
  $removed = 0
  try {
    $out = (& netsh interface portproxy show v4tov4) -join "`n"
    $rx = [regex]"(?m)^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+$port\s+(\d{1,3}(?:\.\d{1,3}){3})\s+\d+\s*$"
    $matches = $rx.Matches($out)
    foreach ($match in $matches) {
      $listenAddress = $match.Groups[1].Value
      try {
        & netsh interface portproxy delete v4tov4 listenaddress=$listenAddress listenport=$port | Out-Null
        $removed += 1
      } catch {}
    }
  } catch {}
  return $removed
}

Ensure-Admin
Ensure-PortProxyReady

$candidates = @(Get-CandidateLocalIpv4s)
if ($candidates.Count -eq 0 -and -not $LocalIp) {
  throw "LOCAL_IP_NOT_FOUND: -LocalIp 로 직접 지정해 주세요."
}

$targetIps = New-Object 'System.Collections.Generic.List[string]'
if ($LocalIp) {
  $targetIps.Add($LocalIp) | Out-Null
} else {
  foreach ($candidate in $candidates) {
    if ($candidate.IsVirtual) { continue }
    if ($candidate.AddressState -ne "Preferred" -and -not $candidate.HasGateway) { continue }
    if (-not $targetIps.Contains($candidate.IPAddress)) { $targetIps.Add($candidate.IPAddress) | Out-Null }
  }
  if ($targetIps.Count -eq 0 -and $candidates.Count -gt 0) {
    $targetIps.Add($candidates[0].IPAddress) | Out-Null
  }
}

$LocalIp = ($targetIps | Select-Object -First 1)
if (-not $LocalIp) { throw "LOCAL_IP_NOT_FOUND: -LocalIp 로 직접 지정해 주세요." }

$ruleName = "ERP2 Analytics HostChrome CDP 9223 (from NAS)"

Write-Info "NAS IP = $NasIp"
Write-Info "Primary Local IP = $LocalIp"
Write-Info ("Target IPs = " + (($targetIps | Select-Object -Unique) -join ", "))
Write-Info "CDP port = $CdpPort"
if ($candidates.Count -gt 0) {
  Write-Host ""
  Write-Info "감지된 IPv4 후보:"
  foreach ($candidate in $candidates) {
    $tags = @()
    if ($candidate.IsVirtual) { $tags += "virtual" }
    if ($candidate.HasGateway) { $tags += "gateway" }
    if ($candidate.AddressState) { $tags += $candidate.AddressState }
    Write-Info (" - {0} | {1} | score={2} | {3}" -f $candidate.InterfaceAlias, $candidate.IPAddress, $candidate.Score, ($tags -join ", "))
  }
}

$loopbackUrl = "http://127.0.0.1:$CdpPort/json/version"
$loopbackOk = Test-HttpOk -Url $loopbackUrl -TimeoutSeconds 1
if ($loopbackOk) {
  Write-Info ("로컬 CDP OK: " + $loopbackUrl)
} else {
  Write-Warn ("로컬 CDP 미확인: " + $loopbackUrl)
  Write-Warn "먼저 'Host Chrome 실행 파일 받기' 또는 Host Agent를 통해 Chrome CDP를 실행하세요."
}

if ($DryRun) {
  Write-Warn "DRY RUN: 변경을 적용하지 않습니다."
} else {
  $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if (-not $rule) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $CdpPort -Profile Private,Public | Out-Null
    $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  } else {
    Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Profile Private,Public | Out-Null
  }
  if ($rule) {
    try { Set-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule -RemoteAddress $NasIp | Out-Null } catch {}
  }

  $removed = Remove-PortProxyAll -port $CdpPort
  if ($removed -gt 0) { Write-Info ("기존 portproxy 제거: {0} entries" -f $removed) }

  foreach ($ip in ($targetIps | Select-Object -Unique)) {
    & netsh interface portproxy add v4tov4 listenaddress=$ip listenport=$CdpPort connectaddress=127.0.0.1 connectport=$CdpPort | Out-Null
  }
}

Write-Host ""
Write-Info "설정 완료(또는 확인 완료)."
Write-Info " - firewall: inbound TCP $CdpPort allow from $NasIp (Private/Public)"
foreach ($ip in ($targetIps | Select-Object -Unique)) {
  Write-Info (" - portproxy: {0}:{1} -> 127.0.0.1:{1}" -f $ip, $CdpPort)
}
Write-Host ""

$verifiedAny = $false
foreach ($ip in ($targetIps | Select-Object -Unique)) {
  $url = ("http://{0}:{1}/json/version" -f $ip, $CdpPort)
  if (Test-HttpOk -Url $url -TimeoutSeconds 2) {
    Write-Info ("확인(호스트 PC) OK: " + $url)
    $verifiedAny = $true
  } else {
    Write-Warn ("확인(호스트 PC) FAIL: " + $url)
  }
}

if (-not $verifiedAny) {
  Write-Warn "LAN 경로가 아직 열리지 않았습니다."
  Write-Warn "원인 후보: 잘못된 어댑터 IP 선택, 관리자 권한 없이 실행, Chrome/CDP 미기동, 보안SW/방화벽 차단"
}

Write-Host ""
Write-Info ("확인(NAS): curl http://{0}:{1}/json/version" -f $LocalIp, $CdpPort)
Write-Host ""

if (-not $NoPause) {
  Read-Host -Prompt "Enter 키를 누르면 이 창이 닫힙니다"
}
