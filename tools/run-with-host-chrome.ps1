param(
	[int]$Port = 9223,
	[string]$UserDataDir = "$env:LOCALAPPDATA\\ERP2-Analytics-HostChrome",
	[string]$StartUrl = "https://search.shopping.naver.com/",
	[switch]$OpenCdpList = $false,

	# 수집(collector) 실행 커맨드
	# 예)
	# -Command "docker" -CommandArgs @("exec","-it","analytics-api","python","-m","collector","run")
	# -Command "pwsh" -CommandArgs @("-File",".\\tools\\collect.ps1")
	[Parameter(Mandatory = $true)]
	[string]$Command,
	[string[]]$CommandArgs = @()
)

$ErrorActionPreference = "Stop"

$startScript = Join-Path $PSScriptRoot "start-host-chrome.ps1"
$stopScript = Join-Path $PSScriptRoot "stop-host-chrome.ps1"

if (-not (Test-Path -LiteralPath $startScript)) { throw "start-host-chrome.ps1 not found: $startScript" }
if (-not (Test-Path -LiteralPath $stopScript)) { throw "stop-host-chrome.ps1 not found: $stopScript" }

& $startScript -Port $Port -UserDataDir $UserDataDir -StartUrl $StartUrl -OpenCdpList:$OpenCdpList -NoPause | Out-Host

try {
	# 수집 실행
	& $Command @CommandArgs
} finally {
	# 수집 성공/실패와 무관하게 Host Chrome 정리
	& $stopScript -Port $Port -UserDataDir $UserDataDir | Out-Host
}

