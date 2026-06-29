param(
	[int]$Port = 9223,
	[string]$UserDataDir = "$env:LOCALAPPDATA\\ERP2-Analytics-HostChrome",
	[switch]$Force = $true
)

$ErrorActionPreference = "Stop"

function Stop-ByPidFile {
	param([string]$PidFile)
	if (-not (Test-Path -LiteralPath $PidFile)) { return $false }
	try {
		$pidText = (Get-Content -LiteralPath $PidFile -Raw).Trim()
		if (-not $pidText) { return $false }
		$pid = [int]$pidText
		$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
		if ($proc) {
			Stop-Process -Id $pid -Force:$Force -ErrorAction SilentlyContinue
			return $true
		}
		return $false
	} catch {
		return $false
	}
}

function Stop-ByCommandLine {
	# PID 파일이 없거나 stale인 경우를 대비해, 커맨드라인으로 “Host Chrome”만 찾아 종료한다.
	# (일반 사용자의 Chrome까지 죽이지 않기 위해 user-data-dir + port를 함께 매칭)
	$needlePort = "--remote-debugging-port=$Port"
	# CommandLine에는 보통 다음처럼 따옴표가 포함됩니다:
	# --user-data-dir="C:\Users\...\ERP2-Analytics-HostChrome"
	# PowerShell 문자열 이스케이프는 백슬래시가 아니라 backtick(`)을 사용합니다.
	$needleUserData = "--user-data-dir=`"$UserDataDir`""

	$targets = @(
		Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
			Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$needlePort*") -and ($_.CommandLine -like "*$needleUserData*") }
	)

	foreach ($t in $targets) {
		try { Stop-Process -Id $t.ProcessId -Force:$Force -ErrorAction SilentlyContinue } catch {}
	}

	return ($targets.Count -gt 0)
}

$pidFile = Join-Path $UserDataDir "host-chrome.pid"

$stopped = $false
if (Stop-ByPidFile -PidFile $pidFile) { $stopped = $true }
if (-not $stopped) { $stopped = Stop-ByCommandLine }

try {
	if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
} catch {}

if ($stopped) {
	Write-Host "✅ Host Chrome stopped (port=$Port, user-data-dir=$UserDataDir)"
} else {
	Write-Host "ℹ️  Host Chrome not found (port=$Port, user-data-dir=$UserDataDir)"
}

