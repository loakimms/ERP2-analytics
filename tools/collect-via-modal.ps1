param(
	# Host Chrome (CDP)
	[int]$CdpPort = 9223,
	[string]$UserDataDir = "$env:LOCALAPPDATA\\ERP2-Analytics-HostChrome",
	[string]$StartUrl = "https://search.shopping.naver.com/",

	# Analytics URLs
	[string]$AnalyticsWebUrl = "http://localhost:5188/analytics/rank/tracking",
	[string]$ApiBaseUrl = "http://localhost:5189",
	[string]$StatusPath = "/search-rank/page-metrics/status",

	# Polling
	[int]$PollIntervalSec = 2,
	[int]$WaitForStartTimeoutMin = 60,
	[int]$WaitForFinishTimeoutMin = 180
)

$ErrorActionPreference = "Stop"

$startScript = Join-Path $PSScriptRoot "start-host-chrome.ps1"
$stopScript = Join-Path $PSScriptRoot "stop-host-chrome.ps1"

if (-not (Test-Path -LiteralPath $startScript)) { throw "start-host-chrome.ps1 not found: $startScript" }
if (-not (Test-Path -LiteralPath $stopScript)) { throw "stop-host-chrome.ps1 not found: $stopScript" }

function Get-Status {
	param([string]$BaseUrl, [string]$Path)
	$u = ($BaseUrl.TrimEnd("/") + $Path)
	return (Invoke-RestMethod -Uri $u -TimeoutSec 10)
}

function Status-ToText {
	param($s)
	$st = "" + $s.status
	$sa = "" + $s.started_at
	$fa = "" + $s.finished_at
	$dt = "" + $s.detail
	return ("status={0}, started_at={1}, finished_at={2}, detail={3}" -f $st, $sa, $fa, $dt)
}

function Is-RunningStatus {
	param([string]$status)
	# 서버 구현이 바뀌어도 안전하게 동작하도록 "IDLE이 아니면 진행 중"으로 넓게 잡는다.
	# (ex: RUNNING, BUSY, RETRY_WAIT, ERROR 등)
	if (-not $status) { return $false }
	return ($status.ToUpperInvariant() -ne "IDLE")
}

& $startScript -Port $CdpPort -UserDataDir $UserDataDir -StartUrl $StartUrl -OpenCdpList:$false -NoPause | Out-Host

try {
	# 사용자가 바로 화면을 열 수 있도록 웹페이지를 띄워준다. (Host Chrome이 아니어도 무방)
	try { Start-Process $AnalyticsWebUrl | Out-Null } catch {}

	Write-Host ""
	Write-Host "============================================================"
	Write-Host "수집 모달 기반 자동 종료 모드"
	Write-Host "1) (방금 열린) Host Chrome에서 네이버 로그인 완료"
	Write-Host "2) Analytics 화면($AnalyticsWebUrl)에서 '지금 수집' 실행"
	Write-Host "3) 수집이 완료되면 Host Chrome이 자동 종료됩니다."
	Write-Host "============================================================"
	Write-Host ""

	# 상태 폴링: IDLE -> RUNNING(또는 started_at 생성) -> 완료(IDLE + finished_at)
	$baseline = Get-Status -BaseUrl $ApiBaseUrl -Path $StatusPath
	Write-Host ("현재 상태: " + (Status-ToText $baseline))

	$deadlineStart = (Get-Date).AddMinutes($WaitForStartTimeoutMin)
	$detectedStart = $false
	$startedAtSeen = $baseline.started_at

	while ((Get-Date) -lt $deadlineStart) {
		Start-Sleep -Seconds $PollIntervalSec
		$s = Get-Status -BaseUrl $ApiBaseUrl -Path $StatusPath

		# started_at이 새로 생기거나, status가 IDLE이 아니면 "시작"으로 판단
		if (($null -ne $s.started_at -and $s.started_at -ne $startedAtSeen) -or (Is-RunningStatus -status $s.status)) {
			$detectedStart = $true
			$startedAtSeen = $s.started_at
			Write-Host ("수집 시작 감지: " + (Status-ToText $s))
			break
		}
	}

	if (-not $detectedStart) {
		throw "수집 시작을 $WaitForStartTimeoutMin 분 동안 감지하지 못했습니다. (모달에서 '지금 수집'을 실행했는지, API가 정상인지 확인하세요)"
	}

	$deadlineFinish = (Get-Date).AddMinutes($WaitForFinishTimeoutMin)
	while ((Get-Date) -lt $deadlineFinish) {
		Start-Sleep -Seconds $PollIntervalSec
		$s = Get-Status -BaseUrl $ApiBaseUrl -Path $StatusPath

		# 완료 조건:
		# - finished_at이 생겼고
		# - status가 IDLE이거나(완료 후 idle), 혹은 RUNNING이 아닌 어떤 종료 상태(ERROR 등)
		$finished = ($null -ne $s.finished_at -and ("" + $s.finished_at).Length -gt 0)
		$idle = (("" + $s.status).ToUpperInvariant() -eq "IDLE")
		$running = Is-RunningStatus -status $s.status

		if ($finished -and (-not $running -or $idle)) {
			Write-Host ("수집 완료 감지: " + (Status-ToText $s))
			return
		}
	}

	throw "수집 완료를 $WaitForFinishTimeoutMin 분 동안 감지하지 못했습니다. (API status endpoint 확인 필요)"
} finally {
	& $stopScript -Port $CdpPort -UserDataDir $UserDataDir | Out-Host
}

