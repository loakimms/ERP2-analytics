param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Assert-Contains([string]$Text, [string]$Needle, [string]$Message) {
  Assert-True ($Text.Contains($Needle)) $Message
}

function Assert-NotContains([string]$Text, [string]$Needle, [string]$Message) {
  Assert-True (-not $Text.Contains($Needle)) $Message
}

function Get-Text([string]$RelativePath) {
  $path = Join-Path $RepoRoot $RelativePath
  return [System.IO.File]::ReadAllText($path)
}

$enable = Get-Text "web\public\nas\Enable-Analytics-HostChrome-NasAccess.ps1"
Assert-Contains $enable "Get-CandidateLocalIpv4s" "NAS access enable script에 개선된 IP 후보 함수가 없습니다."
Assert-Contains $enable "WSL|Hyper-V|vEthernet|VMware|VirtualBox|Loopback|Tailscale|ZeroTier|Docker" "NAS access enable script에 가상 어댑터 제외 규칙이 없습니다."
Assert-Contains $enable "Remove-PortProxyAll" "NAS access enable script에 기존 portproxy 정리 로직이 없습니다."
Assert-Contains $enable "iphlpsvc" "NAS access enable script에 IP Helper(portproxy 전제조건) 점검이 없습니다."
Assert-Contains $enable "Ensure-PortProxyReady" "NAS access enable script에 portproxy 사전 준비 함수가 없습니다."
Assert-Contains $enable "http://127.0.0.1:" "NAS access enable script에 loopback CDP 진단이 없습니다."
Assert-Contains $enable 'http://{0}:{1}/json/version' "NAS access enable script에 LAN CDP 검증이 없습니다."

$cleanup = Get-Text "web\public\nas\Cleanup-Analytics-HostSetup.ps1"
Assert-Contains $cleanup "Get-CandidateLocalIpv4s" "NAS cleanup script에 개선된 IP 후보 함수가 없습니다."
Assert-Contains $cleanup "WSL|Hyper-V|vEthernet|VMware|VirtualBox|Loopback|Tailscale|ZeroTier|Docker" "NAS cleanup script에 가상 어댑터 제외 규칙이 없습니다."

$preflight = Get-Text "scripts\analytics_nas_preflight.ps1"
Assert-Contains $preflight "Resolve-AnalyticsRepoRoot" "NAS preflight에 저장소 루트 해석 함수가 없습니다."
Assert-Contains $preflight "CANONICAL_ROOT.txt" "NAS preflight에 canonical root 탐색이 없습니다."
Assert-NotContains $preflight 'C:\dev\ERP2-analytics\tools\start-host-chrome.ps1' "NAS preflight에 start-host-chrome 경로 하드코딩이 남아 있습니다."
Assert-NotContains $preflight 'C:\dev\ERP2-analytics\tools\host-cdp-proxy.ps1' "NAS preflight에 host-cdp-proxy 경로 하드코딩이 남아 있습니다."

Write-Host "PASS: NAS host access scripts prefer physical LAN IPs and resolve repo root dynamically."
