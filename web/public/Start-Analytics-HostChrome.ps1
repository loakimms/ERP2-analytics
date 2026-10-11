param(
	[int]$Port = 9223,
	[string]$UserDataDir = "$env:LOCALAPPDATA\\ERP2-Analytics-HostChrome",
	[string]$StartUrl = "https://search.shopping.naver.com/",
	# 여러 Chrome 프로필이 존재하는 PC에서는, 프로필 선택(사용자 선택) 창이 먼저 뜨며
	# CDP 포트가 늦게 열리거나 사용자가 "크롬이 안 뜬다"로 오해하기 쉽다.
	# 전용 user-data-dir 내에서 사용할 프로필 디렉터리를 명시하면(예: Default, Profile 1)
	# 프로필 선택 창 없이 바로 StartUrl로 진입한다.
	[string]$ProfileDir = "Default",
	# 기본값은 OFF:
	# - /json/list 탭을 Host Chrome에 같이 열면 사용자가 기대하는 "네이버 쇼핑 로그인 화면"이 아니라
	#   json/list 탭이 전면으로 올라와 "크롬이 활성화가 안 된다"로 오해하기 쉽다.
	# - 필요하면 기본 브라우저로만 열어 확인한다.
	[switch]$OpenCdpList = $false,
	[switch]$WritePidFile = $true,
	# Host Chrome 창을 전면으로 가져온다(사용자 체감: "창이 떴는데 안 보임/비활성" 방지)
	[switch]$BringToFront = $true,
	# 창을 최대화해서 띄운다(사용자 체감 개선)
	[switch]$StartMaximized = $true,
	# Collector 자동 수집용: 창을 앞으로 가져오지 않고 최소화 상태로 시작한다.
	[switch]$Background = $false,
	# 우클릭/직접 실행 시 창이 바로 닫히지 않도록 대기. collect-via-modal 등 자동 호출 시 -NoPause 사용
	[switch]$NoPause = $false
)

$ErrorActionPreference = "Stop"

if ($Background) {
	$BringToFront = $false
	$StartMaximized = $false
}

function Find-ChromePath {
	$candidates = @(
		"$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe",
		"$env:ProgramFiles(x86)\\Google\\Chrome\\Application\\chrome.exe",
		"$env:LocalAppData\\Google\\Chrome\\Application\\chrome.exe"
	) | Where-Object { $_ -and (Test-Path $_) }

	# PowerShell은 파이프 결과가 1개면 '문자열 스칼라'가 될 수 있어 [0]을 쓰면 첫 글자('C')만 잘릴 수 있음.
	# 따라서 항상 Select-Object로 첫 항목을 안전하게 반환한다.
	if ($candidates) { return ($candidates | Select-Object -First 1) }

	# (보강) 레지스트리 App Paths를 통해 설치 경로를 찾는다.
	try {
		$reg = Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" -ErrorAction SilentlyContinue
		if ($reg -and $reg.'(default)' -and (Test-Path $reg.'(default)')) { return $reg.'(default)' }
	} catch {}
	try {
		$reg2 = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" -ErrorAction SilentlyContinue
		if ($reg2 -and $reg2.'(default)' -and (Test-Path $reg2.'(default)')) { return $reg2.'(default)' }
	} catch {}

	return $null
}

function Set-HostChromeDownloadPreferences {
	param(
		[string]$RootDir,
		[string]$ProfileDirName,
		[string]$DownloadDir
	)
	function Test-PrefsKey($Map, [string]$Key) {
		if ($null -eq $Map) { return $false }
		if ($Map -is [System.Collections.IDictionary]) { return $Map.Contains($Key) }
		try { return $Map.ContainsKey($Key) } catch { return $false }
	}
	if ([string]::IsNullOrWhiteSpace($RootDir) -or [string]::IsNullOrWhiteSpace($ProfileDirName) -or [string]::IsNullOrWhiteSpace($DownloadDir)) { return }
	New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
	$profilePath = Join-Path $RootDir $ProfileDirName
	New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
	$prefPath = Join-Path $profilePath "Preferences"
	$prefs = [ordered]@{}
	if (Test-Path -LiteralPath $prefPath) {
		try {
			$raw = Get-Content -LiteralPath $prefPath -Raw -ErrorAction Stop
			if (-not [string]::IsNullOrWhiteSpace($raw)) {
				$prefs = $raw | ConvertFrom-Json -AsHashtable
			}
		} catch {
			$prefs = [ordered]@{}
		}
	}
	if (-not (Test-PrefsKey $prefs "download") -or -not ($prefs["download"] -is [hashtable])) { $prefs["download"] = @{} }
	$prefs["download"]["default_directory"] = $DownloadDir
	$prefs["download"]["directory_upgrade"] = $true
	$prefs["download"]["prompt_for_download"] = $false
	$prefs["download"]["restrictions"] = 0
	if (-not (Test-PrefsKey $prefs "account_values") -or -not ($prefs["account_values"] -is [hashtable])) { $prefs["account_values"] = @{} }
	if (-not (Test-PrefsKey $prefs["account_values"] "download") -or -not ($prefs["account_values"]["download"] -is [hashtable])) { $prefs["account_values"]["download"] = @{} }
	$prefs["account_values"]["download"]["default_directory"] = $DownloadDir
	$prefs["account_values"]["download"]["prompt_for_download"] = $false
	if (-not (Test-PrefsKey $prefs["account_values"] "browser") -or -not ($prefs["account_values"]["browser"] -is [hashtable])) { $prefs["account_values"]["browser"] = @{} }
	if (-not (Test-PrefsKey $prefs["account_values"]["browser"] "download") -or -not ($prefs["account_values"]["browser"]["download"] -is [hashtable])) { $prefs["account_values"]["browser"]["download"] = @{} }
	$prefs["account_values"]["browser"]["download"]["default_directory"] = $DownloadDir
	$prefs["account_values"]["browser"]["download"]["prompt_for_download"] = $false
	if (-not (Test-PrefsKey $prefs "browser") -or -not ($prefs["browser"] -is [hashtable])) { $prefs["browser"] = @{} }
	if (-not (Test-PrefsKey $prefs["browser"] "download") -or -not ($prefs["browser"]["download"] -is [hashtable])) { $prefs["browser"]["download"] = @{} }
	$prefs["browser"]["download"]["default_directory"] = $DownloadDir
	$prefs["browser"]["download"]["prompt_for_download"] = $false
	if (-not (Test-PrefsKey $prefs "savefile") -or -not ($prefs["savefile"] -is [hashtable])) { $prefs["savefile"] = @{} }
	$prefs["savefile"]["default_directory"] = $DownloadDir
	if (-not (Test-PrefsKey $prefs "profile") -or -not ($prefs["profile"] -is [hashtable])) { $prefs["profile"] = @{} }
	if (-not (Test-PrefsKey $prefs["profile"] "default_content_setting_values") -or -not ($prefs["profile"]["default_content_setting_values"] -is [hashtable])) {
		$prefs["profile"]["default_content_setting_values"] = @{}
	}
	$prefs["profile"]["default_content_setting_values"]["automatic_downloads"] = 1
	if (-not (Test-PrefsKey $prefs "safebrowsing") -or -not ($prefs["safebrowsing"] -is [hashtable])) { $prefs["safebrowsing"] = @{} }
	$prefs["safebrowsing"]["enabled"] = $true
	$prefs | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $prefPath -Encoding UTF8
}

$chrome = Find-ChromePath
if (-not $chrome) {
	Write-Host ""
	Write-Host "Chrome 실행 파일을 찾지 못했습니다. (예: $env:ProgramFiles\Google\Chrome\Application\chrome.exe)" -ForegroundColor Red
	Write-Host ""
	if (-not $NoPause) { Read-Host -Prompt "Enter 키를 누르면 이 창이 닫힙니다" }
	exit 1
}

New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null
$downloadDir = Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"
Set-HostChromeDownloadPreferences -RootDir $UserDataDir -ProfileDirName $ProfileDir -DownloadDir $downloadDir

# 중요:
# - Host Agent가 로컬 PC에서 127.0.0.1:<port> 로 CDP에 접근한다.
# - 0.0.0.0 바인딩은 Windows portproxy/NAS 노출 설정과 충돌해 Chrome 창만 뜨고
#   DevTools HTTP 포트가 열리지 않는 증상을 만들 수 있으므로 로컬 전용으로 제한한다.
$chromePath = (Resolve-Path -LiteralPath $chrome).ProviderPath

# 공백/특수문자 경로 안전 처리: 값이 들어가는 인자는 따옴표로 감싼다.
$chromeArgs = @(
	"--new-window",
	"--remote-debugging-port=$Port",
	"--remote-debugging-address=127.0.0.1",
	# Chrome 111+ 부터 DevTools WebSocket 연결에 Origin 검증이 들어가
	# Docker 컨테이너(원격)에서 connectOverCDP 시 403/끊김이 발생할 수 있다.
	# 개인용 로컬 스택에서만 사용한다는 전제하에 허용(방화벽은 사설 네트워크로 제한 권장)
	"--remote-allow-origins=*",
	("--user-data-dir=`"$UserDataDir`""),
	# 프로필 선택 화면을 회피하기 위해 profile-directory를 고정한다.
	# (값에 공백이 있을 수 있어 따옴표로 감싼다)
	("--profile-directory=`"$ProfileDir`""),
	"--no-first-run",
	"--no-default-browser-check",
	"--disable-features=DownloadBubble,DownloadBubbleV2",
	"--safebrowsing-disable-download-protection",
	("`"$StartUrl`"")
)

if ($StartMaximized) {
	$chromeArgs += "--start-maximized"
} elseif ($Background) {
	$chromeArgs += "--start-minimized"
}

# -ArgumentList에 배열을 주면 환경에 따라 quoting이 깨지는 경우가 있어, 한 줄 문자열로 안전하게 전달한다.
$argLine = ($chromeArgs -join " ")

$windowStyle = if ($Background) { "Minimized" } else { "Normal" }
$proc = Start-Process -FilePath $chromePath -ArgumentList $argLine -WorkingDirectory (Get-Location) -WindowStyle $windowStyle -PassThru

function Ensure-User32Api {
	if ($script:__user32_loaded) { return }
	try {
		Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Win32Window {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@ -ErrorAction Stop | Out-Null
		$script:__user32_loaded = $true
	} catch {
		$script:__user32_loaded = $false
	}
}

function Bring-ProcessWindowToFront {
	param([int]$ProcessId)
	# 1) 가장 신뢰도 높은 방법: MainWindowHandle을 잡아 user32로 전면/표시
	Ensure-User32Api
	try {
		$p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
		if (-not $p) { return }
		for ($i = 0; $i -lt 40; $i++) {
			$p.Refresh()
			if ($p.MainWindowHandle -and $p.MainWindowHandle -ne 0) { break }
			Start-Sleep -Milliseconds 150
		}
		if ($script:__user32_loaded -and $p.MainWindowHandle -and $p.MainWindowHandle -ne 0) {
			# 9 = SW_RESTORE (최소화/비표시 상태 복원)
			[Win32Window]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null
			[Win32Window]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
			return
		}
	} catch {
		# ignore
	}

	# 2) 폴백: AppActivate (Windows 포커스 정책에 따라 실패할 수 있음)
	try {
		$ws = New-Object -ComObject WScript.Shell
		$null = $ws.AppActivate($ProcessId)
	} catch {
		# ignore
	}
}

if ($WritePidFile) {
	# stop-host-chrome.ps1 가 안전하게 종료할 수 있도록 PID 파일을 남긴다.
	# (UserDataDir를 고유하게 쓰기 때문에 다른 Chrome 인스턴스와 구분 가능)
	try {
		$pidFile = Join-Path $UserDataDir "host-chrome.pid"
		Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ASCII
	} catch {}
}

# 포트가 실제로 열렸는지 짧게 확인(사용자 체감: "연결 거부" 원인 즉시 파악)
try {
	$ok = $false
	for ($i = 0; $i -lt 20; $i++) {
		try {
			$ok = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -InformationLevel Quiet
		} catch {
			$ok = $false
		}
		if ($ok) { break }
		Start-Sleep -Milliseconds 250
	}
	if (-not $ok) {
		Write-Host ""
		Write-Host "⚠️  WARNING: 127.0.0.1:$Port 포트가 아직 열리지 않았습니다. (Chrome 실행 실패/포트 충돌/보안SW 차단 가능)"
		Write-Host "   - 다른 포트로 재시도: pwsh -File .\\tools\\start-host-chrome.ps1 -Port 9224"
		Write-Host ""
	}
} catch {}

Write-Host ""
Write-Host "✅ Host Chrome started for CDP reuse"
Write-Host " - chrome: $chromePath"
Write-Host " - user-data-dir: $UserDataDir"
Write-Host " - remote debugging port: $Port"
Write-Host (" - pid: {0}" -f $proc.Id)
Write-Host ""
Write-Host "🔎 DevTools JSON(list): http://127.0.0.1:$Port/json/list"
Write-Host "ℹ️  analytics-api 컨테이너는 기본으로 http://host.docker.internal:$Port 로 붙습니다."
Write-Host ""

if ($BringToFront) {
	# window 생성 타이밍 때문에 약간 대기 후 전면 전환
	try { Start-Sleep -Milliseconds 250 } catch {}
	Bring-ProcessWindowToFront -ProcessId $proc.Id
}

if ($OpenCdpList) {
	# Host Chrome 탭이 아니라, 기본 브라우저로만 열어 사용자 UX(로그인 화면 포커스)를 지킨다.
	try { Start-Process "http://127.0.0.1:$Port/json/list" | Out-Null } catch {}
}

if (-not $NoPause) {
	Read-Host -Prompt "Enter 키를 누르면 이 창이 닫힙니다"
}

