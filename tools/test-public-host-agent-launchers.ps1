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

$repoTool = Join-Path $RepoRoot "tools\start-host-agent.ps1"
Assert-True (Test-Path -LiteralPath $repoTool) "기준 스크립트가 없습니다: $repoTool"

$targets = @(
  "web\public\local\Start-Analytics-HostAgent.ps1",
  "web\public\local\Install-Analytics-HostAgent.ps1",
  "web\public\Start-Analytics-HostAgent.ps1",
  "web\public\Install-Analytics-HostAgent.ps1"
)

foreach ($relativePath in $targets) {
  $text = Get-Text $relativePath
  Assert-Contains $text "Resolve-AnalyticsRepoRoot" "루트 해석 함수가 없습니다: $relativePath"
  Assert-Contains $text "ERP2_ANALYTICS_ROOT" "환경 변수 fallback이 없습니다: $relativePath"
  Assert-Contains $text "CANONICAL_ROOT.txt" "canonical root 탐색이 없습니다: $relativePath"
  Assert-Contains $text "Get-PSDrive -PSProvider FileSystem" "드라이브 스캔 fallback이 없습니다: $relativePath"
}

$localStart = Get-Text "web\public\local\Start-Analytics-HostAgent.ps1"
Assert-NotContains $localStart 'C:\dev\ERP2-analytics\tools\start-host-agent.ps1' "local start launcher에 C: 하드코딩이 남아 있습니다."

$localInstall = Get-Text "web\public\local\Install-Analytics-HostAgent.ps1"
Assert-NotContains $localInstall 'C:\dev\ERP2-analytics\tools\host-agent.ps1' "local install launcher에 agent C: 하드코딩이 남아 있습니다."
Assert-NotContains $localInstall 'C:\dev\ERP2-analytics\tools\ensure-host-agent.ps1' "local install launcher에 ensure C: 하드코딩이 남아 있습니다."

$publicStart = Get-Text "web\public\Start-Analytics-HostAgent.ps1"
Assert-NotContains $publicStart 'C:\dev\ERP2-analytics\tools\start-host-agent.ps1' "public start launcher에 C: 하드코딩이 남아 있습니다."

$publicInstall = Get-Text "web\public\Install-Analytics-HostAgent.ps1"
Assert-NotContains $publicInstall 'C:\dev\ERP2-analytics\tools\host-agent.ps1' "public install launcher에 agent C: 하드코딩이 남아 있습니다."
Assert-NotContains $publicInstall 'C:\dev\ERP2-analytics\tools\ensure-host-agent.ps1' "public install launcher에 ensure C: 하드코딩이 남아 있습니다."
Assert-NotContains $publicInstall 'schtasks.exe /Create /TN "$taskNameEnsure"' "public install script가 ensure watchdog task를 기본 등록하고 있습니다."
Assert-NotContains $publicInstall 'schtasks.exe /Run /TN "$taskNameEnsure"' "public install script가 ensure watchdog task를 즉시 실행하고 있습니다."
Assert-Contains $publicInstall 'Register-HostAgentTask' "public install script가 schtasks 실패를 검사하지 않습니다."
Assert-Contains $publicInstall '$LASTEXITCODE' "public install script가 schtasks 종료 코드를 검사하지 않습니다."
Assert-Contains $publicInstall 'Test-HostAgentTaskExists' "public install script가 기존 작업 재사용 여부를 확인하지 않습니다."
Assert-Contains $publicInstall '기존 작업 재사용' "public install script가 권한 거부 시 기존 작업 재사용 안내를 제공하지 않습니다."
Assert-Contains $publicInstall 'POST /shutdown' "public install script에 host-agent 종료 엔드포인트가 없습니다."
Assert-Contains $publicInstall 'cleanup' "public install script에 force-stop용 cleanup 종료 모드가 없습니다."
Assert-Contains $publicInstall '/bridge/start-host-chrome' "public install script에 localhost bridge 페이지가 없습니다."

$localInstall = Get-Text "web\public\local\Install-Analytics-HostAgent.ps1"
Assert-NotContains $localInstall 'schtasks.exe /Create /TN "$taskNameEnsure"' "local install script가 ensure watchdog task를 기본 등록하고 있습니다."
Assert-NotContains $localInstall 'schtasks.exe /Run /TN "$taskNameEnsure"' "local install script가 ensure watchdog task를 즉시 실행하고 있습니다."
Assert-Contains $localInstall 'Register-HostAgentTask' "local install script가 schtasks 실패를 검사하지 않습니다."
Assert-Contains $localInstall '$LASTEXITCODE' "local install script가 schtasks 종료 코드를 검사하지 않습니다."
Assert-Contains $localInstall 'Test-HostAgentTaskExists' "local install script가 기존 작업 재사용 여부를 확인하지 않습니다."
Assert-Contains $localInstall '기존 작업 재사용' "local install script가 권한 거부 시 기존 작업 재사용 안내를 제공하지 않습니다."

$nasInstall = Get-Text "web\public\nas\Install-Analytics-HostAgent.ps1"
Assert-NotContains $nasInstall 'schtasks.exe /Create /TN "$taskNameEnsure"' "nas install script가 ensure watchdog task를 기본 등록하고 있습니다."
Assert-NotContains $nasInstall 'schtasks.exe /Run /TN "$taskNameEnsure"' "nas install script가 ensure watchdog task를 즉시 실행하고 있습니다."
Assert-Contains $nasInstall 'Register-HostAgentTask' "nas install script가 schtasks 실패를 검사하지 않습니다."
Assert-Contains $nasInstall '$LASTEXITCODE' "nas install script가 schtasks 종료 코드를 검사하지 않습니다."
Assert-Contains $nasInstall 'Test-HostAgentTaskExists' "nas install script가 기존 작업 재사용 여부를 확인하지 않습니다."
Assert-Contains $nasInstall '기존 작업 재사용' "nas install script가 권한 거부 시 기존 작업 재사용 안내를 제공하지 않습니다."
Assert-Contains $nasInstall '[switch]$NoPause' "nas install script가 통합 실행용 NoPause를 지원하지 않습니다."
Assert-Contains $nasInstall 'POST /shutdown' "nas install script에 host-agent 종료 엔드포인트가 없습니다."
Assert-Contains $nasInstall 'cleanup' "nas install script에 force-stop용 cleanup 종료 모드가 없습니다."
Assert-Contains $nasInstall '/bridge/start-host-chrome' "nas install script에 localhost bridge 페이지가 없습니다."
Assert-Contains $nasInstall '/bridge/collector-background' "nas install script에 collector 제어 bridge 페이지가 없습니다."

$nasStart = Get-Text "web\public\nas\Start-Analytics-HostAgent.ps1"
Assert-Contains $nasStart '[switch]$NoPause' "nas start script가 통합 실행용 NoPause를 지원하지 않습니다."
Assert-Contains $nasStart 'HOST_AGENT_HEALTH_CHECK_FAILED' "nas start script가 health 실패를 통합 실행에서 전파하지 않습니다."

$nasSetup = Get-Text "web\public\nas\Setup-Analytics-NAS-Host.ps1"
Assert-Contains $nasSetup 'Install-Analytics-HostAgent.ps1' "nas setup script가 install 단계를 호출하지 않습니다."
Assert-Contains $nasSetup 'Start-Analytics-HostAgent.ps1' "nas setup script가 start 단계 스크립트를 호출하지 않습니다."
Assert-Contains $nasSetup 'Enable-Analytics-HostChrome-NasAccess.ps1' "nas setup script가 NAS access 단계를 호출하지 않습니다."
Assert-Contains $nasSetup '-NoPause' "nas setup script가 중간 pause 없이 단계를 실행하지 않습니다."

$repoHostAgent = Get-Text "tools\host-agent.ps1"
Assert-Contains $repoHostAgent 'POST /shutdown' "repo host-agent에 종료 엔드포인트가 없습니다."
Assert-Contains $repoHostAgent 'Remove-HostAgentAutoStart' "repo host-agent에 자동 실행 정리 함수가 없습니다."
Assert-Contains $repoHostAgent '/bridge/start-host-chrome' "repo host-agent에 localhost bridge 페이지가 없습니다."
Assert-Contains $repoHostAgent '/bridge/collector-background' "repo host-agent에 collector 제어 bridge 페이지가 없습니다."
Assert-Contains $repoHostAgent '& $stopScript' "repo host-agent가 stop-host-chrome을 자식 Hidden pwsh가 아닌 인라인 호출로 실행해야 합니다."
Assert-Contains $repoHostAgent 'POST /menu-sync/push' "repo host-agent에 menu sync push 엔드포인트가 없습니다."
Assert-Contains $repoHostAgent 'POST /menu-sync/import' "repo host-agent에 menu sync import 엔드포인트가 없습니다."
Assert-Contains $repoHostAgent 'POST /menu-sync/export' "repo host-agent에 menu sync export 엔드포인트가 없습니다."
Assert-Contains $repoHostAgent 'POST /menu-sync/tracking-gap-analyze' "repo host-agent에 tracking gap analyze 엔드포인트가 없습니다."
Assert-Contains $repoHostAgent 'POST /menu-sync/tracking-gap-push' "repo host-agent에 tracking gap push 엔드포인트가 없습니다."
Assert-Contains $repoHostAgent 'scripts\\menu-sync-local-export.ps1' "repo host-agent가 menu sync export 스크립트를 연결하지 않았습니다."
Assert-Contains $repoHostAgent 'scripts\\menu-sync-nas-push.ps1' "repo host-agent가 menu sync push 스크립트를 연결하지 않았습니다."
Assert-Contains $repoHostAgent 'scripts\\menu-sync-nas-import.ps1' "repo host-agent가 menu sync import 스크립트를 연결하지 않았습니다."
Assert-Contains $repoHostAgent 'scripts\\menu-sync-tracking-gap-analyze.ps1' "repo host-agent가 tracking gap analyze 스크립트를 연결하지 않았습니다."
Assert-Contains $repoHostAgent 'scripts\\menu-sync-tracking-gap-push.ps1' "repo host-agent가 tracking gap push 스크립트를 연결하지 않았습니다."
Assert-Contains $repoHostAgent '-MenuIdsJson' "repo host-agent가 복수 menuIds를 JSON 인자로 전달하지 않습니다."
Assert-Contains $repoHostAgent '-TargetDatesJson' "repo host-agent가 복수 targetDates를 JSON 인자로 전달하지 않습니다."
Assert-Contains $repoHostAgent 'http://192.168.0.50:6188/api' "repo host-agent의 NAS API 기본값이 Web 프록시 주소가 아닙니다."
Assert-NotContains $repoHostAgent 'http://192.168.0.50:6189' "repo host-agent 메뉴 동기화 기본값에 NAS API 직접 포트가 남아 있습니다."

$menuSyncExportScript = Get-Text "scripts\menu-sync-local-export.ps1"
Assert-Contains $menuSyncExportScript '$MenuIdsJson' "menu sync local export 스크립트가 JSON menuIds 입력을 지원하지 않습니다."
Assert-Contains $menuSyncExportScript '$TargetDatesJson' "menu sync local export 스크립트가 JSON targetDates 입력을 지원하지 않습니다."

$menuSyncPushScript = Get-Text "scripts\menu-sync-nas-push.ps1"
Assert-Contains $menuSyncPushScript '$MenuIdsJson' "menu sync NAS push 스크립트가 JSON menuIds 입력을 지원하지 않습니다."
Assert-Contains $menuSyncPushScript '$TargetDatesJson' "menu sync NAS push 스크립트가 JSON targetDates 입력을 지원하지 않습니다."

Write-Host "PASS: public/local host-agent launchers resolve repo root dynamically."
