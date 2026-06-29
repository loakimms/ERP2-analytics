param(
	# NAS host (nginx/web는 6188, api 컨테이너에서 docker exec로 점검)
	[string]$NasHost = "192.168.0.50",
	# NAS가 접속해야 하는 "내 PC" IP (예: 192.168.0.52)
	[string]$PcIp = "192.168.0.52",
	# NAS에서 접속할 CDP 포트(PC 인바운드). 일반적으로 9223.
	[int]$CdpPort = 9223,
	# 로컬에서 실제 Chrome이 열려있는 포트(프록시 타겟). 일반적으로 9224.
	[int]$ChromePort = 9224,
	# ssh user@host
	[string]$NasSshUser = "admin2",
	# NAS에서 docker exec 대상 컨테이너 이름
	[string]$NasApiContainer = "analytics-nas-api",
	# 가능한 경우, 로컬에서 Host Chrome(9224)을 자동 실행한다.
	[switch]$EnsureChrome = $false,
	# 가능한 경우, 로컬에서 0.0.0.0:9223 -> 127.0.0.1:9224 프록시를 자동 실행한다.
	[switch]$EnsureProxy = $false,
	# NAS/로컬 컨테이너 안에 service_blocked 코드가 있는지 확인한다.
	[switch]$VerifyCode = $false,
	# 타임아웃(초)
	[int]$TimeoutSec = 5
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }
function Write-Warn([string]$msg) { Write-Host ("[WARN] " + $msg) -ForegroundColor Yellow }
function Write-Err([string]$msg) { Write-Host ("[ERR ] " + $msg) -ForegroundColor Red }

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
		if (Test-Path -LiteralPath (Join-Path $root "tools\start-host-chrome.ps1")) { return $root }
	}

	return $null
}

$AnalyticsRoot = Resolve-AnalyticsRepoRoot

function Resolve-RepoToolPath([string]$RelativePath) {
	if (-not $AnalyticsRoot) {
		throw "analytics_repo_root_not_found: ERP2_ANALYTICS_ROOT 또는 CANONICAL_ROOT.txt 를 확인하세요."
	}
	$path = Join-Path $AnalyticsRoot $RelativePath
	if (-not (Test-Path -LiteralPath $path)) { throw "missing_script:$path" }
	return $path
}

function Test-HttpOk {
	param([string]$Url, [int]$TimeoutSeconds = 3)
	try {
		$resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSeconds -Method GET
		return [bool]($resp -and $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300)
	} catch {
		return $false
	}
}

function Get-ListenerAddress {
	param([int]$Port)
	try {
		$conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
		if (-not $conns) { return @() }
		return @($conns | ForEach-Object { [string]$_.LocalAddress } | Where-Object { $_ } | Select-Object -Unique)
	} catch {
		return @()
	}
}

function Start-HostChrome9224 {
	param([int]$Port, [int]$TimeoutSeconds)
	$scriptPath = Resolve-RepoToolPath "tools\start-host-chrome.ps1"
	$userData = Join-Path $env:LOCALAPPDATA ("ERP2-Analytics-HostChrome-" + $Port)
	Write-Info ("Host Chrome 실행 시도: port=" + $Port + " user-data-dir=" + $userData)
	Start-Process -FilePath "pwsh" -ArgumentList @(
		"-NoProfile",
		"-ExecutionPolicy", "Bypass",
		"-File", $scriptPath,
		"-Port", $Port,
		"-UserDataDir", $userData,
		"-ProfileDir", "Default",
		"-NoPause"
	) -WindowStyle Normal | Out-Null

	$ok = $false
	for ($i = 0; $i -lt ($TimeoutSeconds * 4); $i++) {
		if (Test-HttpOk -Url ("http://127.0.0.1:" + $Port + "/json/version") -TimeoutSeconds 1) {
			$ok = $true
			break
		}
		Start-Sleep -Milliseconds 250
	}
	return $ok
}

function Start-Proxy9223To9224 {
	param([string]$ListenAddress, [int]$ListenPort, [int]$TargetPort)
	$scriptPath = Resolve-RepoToolPath "tools\host-cdp-proxy.ps1"
	Write-Info ("CDP 프록시 실행 시도: " + $ListenAddress + ":" + $ListenPort + " -> 127.0.0.1:" + $TargetPort)
	Start-Process -FilePath "pwsh" -ArgumentList @(
		"-NoProfile",
		"-ExecutionPolicy", "Bypass",
		"-File", $scriptPath,
		"-ListenAddress", $ListenAddress,
		"-ListenPort", $ListenPort,
		"-TargetHost", "127.0.0.1",
		"-TargetPort", $TargetPort
	) -WindowStyle Normal | Out-Null
}

function Verify-ServiceBlockedCodeLocal {
	param([string]$ContainerName)
	try {
		$out = & docker exec $ContainerName python -c "import main,inspect; s=inspect.getsource(main._is_page_metrics_rate_limited)+inspect.getsource(main._is_service_block_page); print('HAS_service_blocked=' + str('service_blocked' in s))" 2>$null
		$line = [string]($out | Select-Object -First 1)
		if ($line) { Write-Info ("CODE(" + $ContainerName + "): " + $line) }
		else { Write-Warn ("CODE(" + $ContainerName + "): no output") }
	} catch {
		Write-Warn ("CODE(" + $ContainerName + "): failed (" + $_.Exception.Message + ")")
	}
}

function Verify-ServiceBlockedCodeNas {
	param([string]$Remote, [string]$ContainerName)
	try {
		# NAS는 PATH/쉘 환경이 다를 수 있어 bash -lc로 감싼다.
		$remoteCommand = @"
bash -lc 'docker exec $ContainerName python -c "import main,inspect; s=inspect.getsource(main._is_page_metrics_rate_limited)+inspect.getsource(main._is_service_block_page); print(\"HAS_service_blocked=\" + str(\"service_blocked\" in s))"'
"@.Trim()
		$out = & ssh.exe "-o" "BatchMode=yes" "-o" "StrictHostKeyChecking=no" $Remote $remoteCommand
		$line = [string]($out | Select-Object -First 1)
		if ($line) { Write-Info ("CODE(" + $Remote + "/" + $ContainerName + "): " + $line) }
		else { Write-Warn ("CODE(" + $Remote + "/" + $ContainerName + "): no output (remote cmd ran but printed nothing)") }
	} catch {
		Write-Warn ("CODE(" + $Remote + "/" + $ContainerName + "): failed (" + $_.Exception.Message + ")")
	}
}

Write-Host ""
Write-Info ("NAS preflight 시작")
Write-Info ("- NAS=" + $NasHost + " (ssh " + $NasSshUser + "@...)")
Write-Info ("- PC=" + $PcIp + " CDP=" + $CdpPort + " (LAN)")
Write-Info ("- Chrome(local)=" + $ChromePort + " (127.0.0.1)")
Write-Host ""

# 0) (옵션) 로컬 Host Chrome 확인/실행
if ($EnsureChrome) {
	$localChromeOk = Test-HttpOk -Url ("http://127.0.0.1:" + $ChromePort + "/json/version") -TimeoutSeconds 1
	if (-not $localChromeOk) {
		$started = Start-HostChrome9224 -Port $ChromePort -TimeoutSeconds 10
		if (-not $started) {
			Write-Warn ("Host Chrome이 준비되지 않았습니다. 수동 실행: .\tools\start-host-chrome.ps1 -Port " + $ChromePort)
		}
	} else {
		Write-Info ("로컬 Host Chrome OK: http://127.0.0.1:" + $ChromePort + "/json/version")
	}
}

# 1) (옵션) 프록시(0.0.0.0:9223) 확인/실행
if ($EnsureProxy) {
	$addrs = Get-ListenerAddress -Port $CdpPort
	$hasAny = ($addrs | Measure-Object).Count -gt 0
	$hasWide = $addrs -contains "0.0.0.0" -or $addrs -contains "::"
	if (-not $hasAny -or -not $hasWide) {
		Start-Proxy9223To9224 -ListenAddress "0.0.0.0" -ListenPort $CdpPort -TargetPort $ChromePort
		# 실제 체감 실패는 "LISTEN 조회"가 아니라 HTTP 접근 실패로 나타난다.
		# 따라서 /json/version이 열리는지로 확인한다(프록시는 TCP 포워딩이므로 HTTP로도 판정 가능).
		$proxyOk = $false
		for ($i = 0; $i -lt 20; $i++) {
			if (Test-HttpOk -Url ("http://127.0.0.1:" + $CdpPort + "/json/version") -TimeoutSeconds 1) {
				$proxyOk = $true
				break
			}
			Start-Sleep -Milliseconds 250
		}
		if ($proxyOk) {
			Write-Info ("프록시 OK: http://127.0.0.1:" + $CdpPort + "/json/version")
		} else {
			$addrs2 = Get-ListenerAddress -Port $CdpPort
			$addrText2 = if ($addrs2 -and $addrs2.Count -gt 0) { ($addrs2 -join ", ") } else { "none" }
			Write-Warn ("프록시/포트 상태를 확정할 수 없습니다. (http://127.0.0.1:" + $CdpPort + "/json/version 실패, LISTEN=" + $addrText2 + ")")
		}
	} else {
		$addrText = if ($addrs -and $addrs.Count -gt 0) { ($addrs -join ", ") } else { "unknown" }
		Write-Info ("프록시 LISTEN OK: " + $addrText + ":" + $CdpPort)
	}
}

# 2) PC LAN 포트(/json/version) 확인
$lanUrl = "http://" + $PcIp + ":" + $CdpPort + "/json/version"
$lanOk = Test-HttpOk -Url $lanUrl -TimeoutSeconds $TimeoutSec
if ($lanOk) {
	Write-Info ("LAN OK: " + $lanUrl)
} else {
	Write-Err ("LAN FAIL: " + $lanUrl)
	Write-Err ("- 원인 후보: 9223이 127.0.0.1로만 열림(프록시 미실행), Windows 방화벽 인바운드 차단, Chrome/CDP 종료")
	Write-Err ("- 해결: (권장) Chrome을 9224로 실행 + 0.0.0.0:9223 프록시를 켠 뒤 재시도")
	exit 2
}

# 3) NAS 컨테이너(analytics-nas-api)에서 PC 9223 접근 확인
$ssh = "ssh.exe"
$remote = ($NasSshUser + "@" + $NasHost)
$cmd = "bash -lc 'docker exec " + $NasApiContainer + " curl -sS --max-time " + $TimeoutSec + " " + $lanUrl + " >/dev/null && echo OK || echo FAIL'"
Write-Info ("NAS 컨테이너 점검: " + $remote + " :: " + $NasApiContainer + " -> " + $lanUrl)
try {
	$out = & $ssh "-o" "BatchMode=yes" "-o" "StrictHostKeyChecking=no" $remote $cmd 2>$null
	$txt = [string]($out | Select-Object -First 1)
	if ($txt -match "OK") {
		Write-Info ("NAS->PC OK: docker exec " + $NasApiContainer + " curl " + $lanUrl)
		Write-Host ""
		if ($VerifyCode) {
			Write-Info ("CODE VERIFY: checking containers...")
			Verify-ServiceBlockedCodeLocal -ContainerName "analytics-master-api"
			Verify-ServiceBlockedCodeNas -Remote $remote -ContainerName $NasApiContainer
			Write-Host ""
		}
		Write-Info ("PRECHECK PASS (NAS 동기화/배포 전에 네트워크/프록시 상태는 정상)")
		exit 0
	}
	Write-Err ("NAS->PC FAIL: docker exec에서 " + $lanUrl + " 접근 실패")
	Write-Err ("- 원인 후보: PC 방화벽(사설망)에서 9223 차단, NAS->PC 라우팅/대역 문제, 프록시/크롬 다운")
	exit 3
} catch {
	Write-Err ("SSH 실패: " + ($_.Exception.Message))
	Write-Err ("- 확인: ssh 키/BatchMode, NAS 접속 권한, NAS에서 docker exec 가능 여부")
	exit 4
}

