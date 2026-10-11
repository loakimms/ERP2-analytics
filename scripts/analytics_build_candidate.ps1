param(
  # 태그에 포함할 사람이 읽는 버전(선택)
  [string] $Version = 'analytics',

  # Analytics 레포 루트(기본: 이 스크립트가 있는 레포)
  [string] $AnalyticsRoot = '',

  # 어떤 lock을 갱신할지 (local만 우선 지원; nas는 추후 추가)
  [ValidateSet('local')]
  [string] $Target = 'local',

  # Production docker build context. Must be releases/_candidates/<tag> (never the dirty worktree).
  [string] $CandidateSnapshot = '',
  [string] $ApprovedChangeManifest = '',
  [string] $CandidateTag = '',
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }
function Assert-LastExitOk([string] $what) { if ($LASTEXITCODE -ne 0) { throw ($what + " failed (exit=" + $LASTEXITCODE + ")") } }

function Get-RepoRoot {
  $sd = Split-Path -Parent $PSCommandPath
  return (Resolve-Path (Join-Path $sd '..')).Path
}

function Assert-CanonicalRoot([string] $RepoRoot) {
  $sentinel = Join-Path $RepoRoot 'CANONICAL_ROOT.txt'
  if (-not (Test-Path -LiteralPath $sentinel)) { return }
  $expected = (Get-Content -LiteralPath $sentinel -TotalCount 1 -ErrorAction Stop).Trim()
  if (-not $expected) { return }
  if ($RepoRoot -ne $expected) {
    throw ("이 폴더는 CANONICAL_ROOT.txt에 의해 실행이 차단되었습니다. expected='" + $expected + "' actual='" + $RepoRoot + "' (단일 폴더 운영 원칙)")
  }
}

# env 파일에서 KEY=VALUE 로드(최소 구현)
function Try-Load-KeyFromEnvFile([string] $EnvFilePath, [string] $KeyName) {
  if (-not (Test-Path -LiteralPath $EnvFilePath)) { return $false }
  $lines = Get-Content -LiteralPath $EnvFilePath -ErrorAction Stop
  foreach ($line in $lines) {
    $t = ('' + $line).Trim()
    # UTF-8 BOM 방어 (파일 첫 줄 key에 붙는 경우가 있음)
    $t = $t.TrimStart([char]0xFEFF)
    if (-not $t) { continue }
    if ($t.StartsWith('#')) { continue }
    if ($t -notmatch '=') { continue }
    $k = (($t -split '=', 2)[0]).Trim().TrimStart([char]0xFEFF)
    if ($k -ne $KeyName) { continue }
    $v = (($t -split '=', 2)[1]).Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    if ($v) { Set-Item -Path ("Env:" + $KeyName) -Value $v; return $true }
  }
  return $false
}

# Firebase Web 설정 로드
# - Analytics Web은 빌드타임 VITE_FIREBASE_API_KEY가 없으면 로그인/인트로 단계에서 깨질 수 있다.
# - 값 자체는 “웹 클라이언트 설정”이므로 비밀키가 아니지만, 출력/로그에 노출하지 않는다.
function Load-FirebaseWebEnv([string] $RepoRoot) {
  $hasApiKey = $env:VITE_FIREBASE_API_KEY -and ('' + $env:VITE_FIREBASE_API_KEY).Trim()
  $hasProjectId = $env:VITE_FIREBASE_PROJECT_ID -and ('' + $env:VITE_FIREBASE_PROJECT_ID).Trim()
  if ($hasApiKey -and $hasProjectId) { return }
  $envWebCandidates = @(
    (Join-Path $RepoRoot 'env.web.local'),
    (Join-Path $RepoRoot 'docker\env.web.local'),
    'C:\dev\ERP2-dev\env.web.local',
    'D:\dev\ERP2-dev\env.web.local'
  )

  $okApiKey = $false
  $okProjectId = $false
  foreach ($p in $envWebCandidates) {
    if (-not $p) { continue }
    $okApiKey = $okApiKey -or (Try-Load-KeyFromEnvFile -EnvFilePath $p -KeyName 'VITE_FIREBASE_API_KEY')
    $okProjectId = $okProjectId -or (Try-Load-KeyFromEnvFile -EnvFilePath $p -KeyName 'VITE_FIREBASE_PROJECT_ID')
  }

  if (-not $env:VITE_FIREBASE_API_KEY -or -not $env:VITE_FIREBASE_PROJECT_ID) {
    $hint = ($envWebCandidates -join "`n  - ")
    throw ("Firebase Web 설정을 찾지 못했습니다. 다음 중 하나로 설정하세요:`n" +
      "1) 환경변수 VITE_FIREBASE_API_KEY + VITE_FIREBASE_PROJECT_ID`n" +
      "2) 아래 경로 중 하나에 동일 키를 넣은 env 파일을 둡니다:`n  - " + $hint)
  }
}

function Update-LockTag([string] $LockPath, [string] $Tag, [string] $BuildTime, [string] $GitSha, [string] $FirebaseProjectId) {
  if (-not (Test-Path -LiteralPath $LockPath)) { throw ("lock file missing: " + $LockPath) }
  $lines = Get-Content -LiteralPath $LockPath -Encoding utf8 -ErrorAction Stop
  $out = @()
  $seen = @{}
  foreach ($line in $lines) {
    $t = ('' + $line).Trim()
    if (-not $t -or $t.StartsWith('#') -or ($t -notmatch '=')) { $out += $line; continue }
    $k = $t.Split('=')[0].Trim()
    if ($k -eq 'ANALYTICS_IMAGE_TAG') { $out += ("ANALYTICS_IMAGE_TAG=" + $Tag); $seen[$k] = $true; continue }
    if ($k -eq 'VITE_APP_VERSION') { $out += ("VITE_APP_VERSION=" + $Tag); $seen[$k] = $true; continue }
    if ($k -eq 'VITE_IMAGE_TAG') { $out += ("VITE_IMAGE_TAG=" + $Tag); $seen[$k] = $true; continue }
    if ($k -eq 'ANALYTICS_BUILD_TIME') { $out += ("ANALYTICS_BUILD_TIME=" + $BuildTime); $seen[$k] = $true; continue }
    if ($k -eq 'ANALYTICS_GIT_SHA') { $out += ("ANALYTICS_GIT_SHA=" + $GitSha); $seen[$k] = $true; continue }
    if ($k -eq 'FIREBASE_PROJECT_ID') { $out += ("FIREBASE_PROJECT_ID=" + $FirebaseProjectId); $seen[$k] = $true; continue }
    $out += $line
  }
  if (-not $seen.ContainsKey('ANALYTICS_IMAGE_TAG')) { $out += ("ANALYTICS_IMAGE_TAG=" + $Tag) }
  if (-not $seen.ContainsKey('VITE_APP_VERSION')) { $out += ("VITE_APP_VERSION=" + $Tag) }
  if (-not $seen.ContainsKey('VITE_IMAGE_TAG')) { $out += ("VITE_IMAGE_TAG=" + $Tag) }
  if (-not $seen.ContainsKey('ANALYTICS_BUILD_TIME')) { $out += ("ANALYTICS_BUILD_TIME=" + $BuildTime) }
  if (-not $seen.ContainsKey('ANALYTICS_GIT_SHA')) { $out += ("ANALYTICS_GIT_SHA=" + $GitSha) }
  if (-not $seen.ContainsKey('FIREBASE_PROJECT_ID')) { $out += ("FIREBASE_PROJECT_ID=" + $FirebaseProjectId) }
  $out | Set-Content -Encoding UTF8 -LiteralPath $LockPath
}

$repoRoot = Get-RepoRoot
Set-Location -Path $repoRoot | Out-Null
Assert-CanonicalRoot -RepoRoot $repoRoot

. (Join-Path $repoRoot 'scripts\analytics_forward_only_guard.ps1')
Assert-NoProductionBypassSwitch -ArgTokens @($MyInvocation.UnboundArguments)

Write-Info 'Baseline Authority Check'
$baseline = Assert-CurrentProductionBaselineIntegrity -RepoRoot $repoRoot
Assert-RuntimeComposeIsImageOnly -RepoRoot $repoRoot
Write-Info ("CURRENT_PRODUCTION_BASELINE=" + $baseline.RuntimeTag)

if ($DryRun) {
  Write-Info 'DryRun: Candidate Source Gate only (docker build skipped)'
  if (-not $CandidateSnapshot) {
    Assert-NotDirectWorktreeBuildContext -RepoRoot $repoRoot -BuildContext $repoRoot -Entrypoint 'analytics_build_candidate.ps1'
  }
  Assert-ProductionRebuildPreflight -RepoRoot $repoRoot -CandidateSnapshot $CandidateSnapshot -ApprovedChangeManifest $ApprovedChangeManifest -Entrypoint 'analytics_build_candidate.ps1'
  Write-Info 'DryRun PASS: docker build not executed'
  exit 0
}

Assert-ProductionRebuildPreflight -RepoRoot $repoRoot -CandidateSnapshot $CandidateSnapshot -ApprovedChangeManifest $ApprovedChangeManifest -Entrypoint 'analytics_build_candidate.ps1'
$snapRoot = (Resolve-Path -LiteralPath $CandidateSnapshot).Path
$apiContext = Join-Path $snapRoot 'source\api'
$webContext = Join-Path $snapRoot 'source\web'
$webDockerfile = Join-Path $webContext 'Dockerfile.web'
if (-not (Test-Path -LiteralPath (Join-Path $apiContext 'Dockerfile'))) { throw ("Candidate API Dockerfile not found: " + $apiContext) }
if (-not (Test-Path -LiteralPath $webDockerfile)) { throw ("Candidate WEB Dockerfile.web not found: " + $webDockerfile) }

if (-not $AnalyticsRoot) { $AnalyticsRoot = $repoRoot }
if (-not (Test-Path -LiteralPath $AnalyticsRoot)) { throw ("AnalyticsRoot not found: " + $AnalyticsRoot) }

Load-FirebaseWebEnv -RepoRoot $repoRoot

$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
$tag = ("{0}_{1}" -f $Version, $ts)
if ($CandidateTag) {
  if ($CandidateTag -notmatch '^analytics_[0-9]{8}_[0-9]{6}$') {
    throw ("invalid CandidateTag: " + $CandidateTag)
  }
  $tag = $CandidateTag
}
$buildTime = (Get-Date).ToString('s')

$gitSha = ''
try { $gitSha = ((git -C $AnalyticsRoot rev-parse --short HEAD) | Out-String).Trim() } catch { $gitSha = '' }

$candidateLock = 'docker\\analytics.candidate.lock'
$firebaseProjectId = ([string]($env:VITE_FIREBASE_PROJECT_ID)).Trim()
if (-not $firebaseProjectId) { throw 'VITE_FIREBASE_PROJECT_ID is required (firebase_project_id_missing)' }
Write-Info ("TAG=" + $tag)
Write-Info ("Update lock: " + $candidateLock)
Update-LockTag -LockPath $candidateLock -Tag $tag -BuildTime $buildTime -GitSha $gitSha -FirebaseProjectId $firebaseProjectId

# 사람이 복사/검증하기 쉬운 "태그 포함" 사본을 남긴다. (실행 SoT는 analytics.candidate.lock 그대로 유지)
$candidateLockArchive = ("docker\\analytics.candidate.{0}.lock" -f $tag)
try {
  if (-not (Test-Path -LiteralPath $candidateLockArchive)) {
    Copy-Item -LiteralPath $candidateLock -Destination $candidateLockArchive -Force
  }
  Write-Info ("Archive lock: " + $candidateLockArchive)
} catch {
  Write-Info ("Archive lock skipped: " + $_.Exception.Message)
}

# 사람이 NAS로 복사할 때 헷갈리지 않도록, NAS master compose도 태그 포함 사본을 남긴다.
# - 실행 SoT는 docker/analytics.nas.master.yml 그대로 유지(고정 파일명)
$nasCompose = 'docker\\analytics.nas.master.yml'
$nasComposeArchive = ("docker\\analytics.nas.master.{0}.yml" -f $tag)
try {
  if (Test-Path -LiteralPath $nasCompose) {
    if (-not (Test-Path -LiteralPath $nasComposeArchive)) {
      Copy-Item -LiteralPath $nasCompose -Destination $nasComposeArchive -Force
    }
    Write-Info ("Archive compose: " + $nasComposeArchive)
  } else {
    Write-Info ("Archive compose skipped (missing): " + $nasCompose)
  }
} catch {
  Write-Info ("Archive compose skipped: " + $_.Exception.Message)
}

$bannerInCandidate = Join-Path $webContext 'public\banner-analysis-ui.html'
if (-not (Test-Path -LiteralPath $bannerInCandidate)) {
  throw ("Banner analysis HTML missing in candidate snapshot (worktree docs are not production build input): " + $bannerInCandidate)
}
Write-Info 'Candidate snapshot already contains web\public\banner-analysis-ui.html (worktree not used)'

$candidateFolder = Get-CandidateFolderName -RepoRoot $repoRoot -CandidateSnapshot $snapRoot
$env:ANALYTICS_CANDIDATE_FOLDER = $candidateFolder
$env:ANALYTICS_FORWARD_ONLY_CANDIDATE_BUILD = '1'
$env:ANALYTICS_IMAGE_TAG = $tag
$env:VITE_APP_VERSION = $tag
$env:VITE_IMAGE_TAG = $tag
$env:VITE_ANALYTICS_API_BASE_URL = '/api'
$env:ANALYTICS_BUILD_TIME = $buildTime
$env:ANALYTICS_GIT_SHA = $gitSha
$candidateCompose = Join-Path $repoRoot 'docker\analytics.candidate-build.yml'
Write-Info ("Build analytics images via candidate-only compose (folder=" + $candidateFolder + ")")
docker compose -p analytics_candidate_build -f $candidateCompose build
Assert-LastExitOk 'docker compose build (analytics candidate snapshot)'

$identOut = Join-Path $snapRoot 'manifests\build-output-identity.json'
@{
  candidateTag = $tag
  baseRuntimeTag = $baseline.RuntimeTag
  baseSourceManifestSha256 = $baseline.SourceManifestSha256
  apiBuildContext = $apiContext
  webBuildContext = $webContext
  builtAt = $buildTime
} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $identOut

Write-Info 'Done.'

