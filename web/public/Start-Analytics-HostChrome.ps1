# Analytics CDP 전용 Chrome 실행기 (일반 사용자용 / NAS 일반 사용자용)
# - Cursor/터미널 없이 이 파일만 "우클릭 → PowerShell로 실행" 하면 됩니다.
# - 출처: ERP2-analytics tools/start-host-chrome.ps1
# - NAS 접근 권한(SSH): ssh -o BatchMode=yes admin2@192.168.0.50 (키 인증 필요)
param(
	[int]$Port = 9223,
	[string]$UserDataDir = "$env:LOCALAPPDATA\ERP2-Analytics-HostChrome",
	[string]$StartUrl = "https://search.shopping.naver.com/",
	[string]$ProfileDir = "Default",
	# 기본값은 OFF:
	# - /json/list 탭이 전면으로 뜨면 사용자가 "크롬이 활성화가 안 된다"로 오해하기 쉽다.
	[switch]$OpenCdpList = $false,
	# 창을 전면으로 가져온다(사용자 체감 개선)
	[switch]$BringToFront = $true,
	# 창을 최대화해서 띄운다(사용자 체감 개선)
	[switch]$StartMaximized = $true,
	[switch]$WritePidFile = $true
)

$ErrorActionPreference = "Stop"

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
	Write-Host "  예: $env:ProgramFiles\Google\Chrome\Application\chrome.exe" -ForegroundColor Yellow
	Write-Host "  Google Chrome을 설치한 뒤 다시 실행해 보세요." -ForegroundColor Yellow
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

	if ($StartMaximized) {
		$chromeArgs += "--start-maximized"
	}

	$argLine = ($chromeArgs -join " ")
	$proc = Start-Process -FilePath $chromePath -ArgumentList $argLine -WorkingDirectory (Get-Location) -PassThru

	if ($WritePidFile) {
		try {
			$pidFile = Join-Path $UserDataDir "host-chrome.pid"
			Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ASCII
		} catch {}
	}

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
			Write-Host "WARNING: 127.0.0.1:$Port 포트가 아직 열리지 않았습니다. (Chrome 실행 실패/포트 충돌/보안SW 차단 가능)" -ForegroundColor Yellow
			Write-Host "   다른 포트로 재시도: 이 파일을 저장한 폴더에서 PowerShell을 열고 다음 실행: .\Start-Analytics-HostChrome.ps1 -Port 9224"
			Write-Host ""
		}
	} catch {}

	Write-Host ""
	Write-Host "Host Chrome started for CDP reuse"
	Write-Host " - chrome: $chromePath"
	Write-Host " - user-data-dir: $UserDataDir"
	Write-Host " - remote debugging port: $Port"
	Write-Host (" - pid: {0}" -f $proc.Id)
	Write-Host ""
	Write-Host "DevTools JSON(list): http://127.0.0.1:$Port/json/list"
	Write-Host "analytics-api 컨테이너는 기본으로 http://host.docker.internal:$Port 로 붙습니다."
	Write-Host ""

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
				[Win32Window]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null
				[Win32Window]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
				return
			}
		} catch {
			# ignore
		}
		# fallback
		try {
			$ws = New-Object -ComObject WScript.Shell
			$null = $ws.AppActivate($ProcessId)
		} catch {
			# ignore
		}
	}

	if ($BringToFront) {
		try { Start-Sleep -Milliseconds 250 } catch {}
		Bring-ProcessWindowToFront -ProcessId $proc.Id
	}

	if ($OpenCdpList) {
		# Host Chrome 탭이 아니라 기본 브라우저로 열어 포커스를 뺏지 않게 한다.
		try { Start-Process "http://127.0.0.1:$Port/json/list" | Out-Null } catch {}
	}
} catch {
	Write-Host ""
	Write-Host "오류가 발생했습니다:" -ForegroundColor Red
	Write-Host $_.Exception.Message -ForegroundColor Red
	if ($_.ScriptStackTrace) {
		Write-Host ""
		Write-Host "상세: $($_.ScriptStackTrace)" -ForegroundColor Gray
	}
	Write-Host ""
}

Read-Host -Prompt "위 내용을 확인한 뒤 Enter 키를 누르면 이 창이 닫힙니다"
