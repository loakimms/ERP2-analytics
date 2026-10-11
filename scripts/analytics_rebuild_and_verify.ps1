param(
  # 태그에 포함할 사람이 읽는 버전(선택)
  [string] $Version = 'analytics',

  # 향후 Production rebuild는 CURRENT_PRODUCTION_BASELINE + approved overlay candidate snapshot 필수.
  # 이 값이 없으면 Git HEAD/dirty worktree를 암묵적 base로 쓰지 않고 차단한다.
  [string] $CandidateSnapshot = '',
  [string] $ApprovedChangeManifest = '',
  [string] $CandidateTag = '',

  # Guard/dry-run only. Docker rebuild / promotion / runtime tag change 없음.
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }
function Write-Warn([string] $msg) { Write-Host ("[WARN] " + $msg) -ForegroundColor Yellow }

function Get-RepoRoot {
  $sd = Split-Path -Parent $PSCommandPath
  return (Resolve-Path (Join-Path $sd '..')).Path
}

$repoRoot = Get-RepoRoot
Set-Location -Path $repoRoot | Out-Null

. (Join-Path $repoRoot 'scripts\analytics_forward_only_guard.ps1')
Assert-NoProductionBypassSwitch -ArgTokens @($MyInvocation.UnboundArguments)

function Get-PwshOrWindowsPowerShell {
  if (Get-Command pwsh -ErrorAction SilentlyContinue) { return 'pwsh' }
  return 'powershell'
}
$pwExe = Get-PwshOrWindowsPowerShell

$build = Join-Path $repoRoot 'scripts\analytics_build_candidate.ps1'
$verify = Join-Path $repoRoot 'scripts\analytics_switch_to_candidate_and_verify.ps1'
$promote = Join-Path $repoRoot 'scripts\analytics_promote_or_rollback.ps1'

Write-Info ("Using shell: " + $pwExe)

Write-Info 'Baseline Authority Check'
$baseline = Assert-CurrentProductionBaselineIntegrity -RepoRoot $repoRoot
Assert-RuntimeComposeIsImageOnly -RepoRoot $repoRoot
Write-Info ("CURRENT_PRODUCTION_BASELINE=" + $baseline.RuntimeTag + " manifest=" + $baseline.SourceManifestSha256)

if ($DryRun) {
  Write-Info 'DryRun: Forward-Only gates only (no docker build, no promotion, no runtime tag change)'
  $gateResults = Invoke-ForwardOnlyDryRunGates -RepoRoot $repoRoot
  $gateResults | ConvertTo-Json -Depth 6 | Write-Host
  $need = @{
    gate1_gitHead = 'FAIL_PRODUCTION_BASELINE_REGRESSION'
    gate2_worktree = 'BLOCKED_DIRECT_WORKTREE_BUILD'
    gate3_canonicalBaseline = 'BASELINE_ACCEPTED'
    gate4_approvedOverlay = 'CANDIDATE_ALLOWED'
    gate5_unexpected = 'BUILD_BLOCKED'
  }
  foreach ($k in $need.Keys) {
    if ([string]$gateResults[$k] -ne $need[$k]) {
      throw ("FAIL_PRODUCTION_BASELINE_REGRESSION_GUARD: " + $k + "=" + $gateResults[$k] + " expected=" + $need[$k])
    }
  }
  if ($CandidateSnapshot) {
    Write-Info 'DryRun CASE 4: valid CandidateSnapshot preflight (actual build NOT_RUN)'
    Assert-ProductionRebuildPreflight -RepoRoot $repoRoot -CandidateSnapshot $CandidateSnapshot -ApprovedChangeManifest $ApprovedChangeManifest -Entrypoint 'analytics_rebuild_and_verify.ps1'
    Write-Info 'CANDIDATE_ALLOWED actualBuild=NOT_RUN'
  }
  Write-Info 'DryRun gates PASS (actual Production rebuild=0)'
  exit 0
}

Write-Info 'Candidate Source Gate'
Assert-ProductionRebuildPreflight -RepoRoot $repoRoot -CandidateSnapshot $CandidateSnapshot -ApprovedChangeManifest $ApprovedChangeManifest -Entrypoint 'analytics_rebuild_and_verify.ps1'

Write-Info 'Build candidate'
& $pwExe -NoProfile -ExecutionPolicy Bypass -File $build -Version $Version -CandidateSnapshot $CandidateSnapshot -ApprovedChangeManifest $ApprovedChangeManifest -CandidateTag $CandidateTag
if ($LASTEXITCODE -ne 0) { throw "build_candidate failed (exit=$LASTEXITCODE)" }

Write-Info 'Switch to candidate and verify evidence'
$verifyOk = $false
try {
  & $pwExe -NoProfile -ExecutionPolicy Bypass -File $verify
  if ($LASTEXITCODE -eq 0) { $verifyOk = $true }
} catch {
  $verifyOk = $false
}

if ($verifyOk) {
  Write-Info 'VERIFY PASS -> promote to master + baseline freeze/pointer update'
  & $pwExe -NoProfile -ExecutionPolicy Bypass -File $promote -Result PASS -CandidateSnapshot $CandidateSnapshot -ApprovedChangeManifest $ApprovedChangeManifest
  if ($LASTEXITCODE -ne 0) { throw "promote PASS failed (exit=$LASTEXITCODE)" }
  Write-Info 'DONE'
  exit 0
}

Write-Warn 'VERIFY FAIL -> rollback to master'
& $pwExe -NoProfile -ExecutionPolicy Bypass -File $promote -Result FAIL
if ($LASTEXITCODE -ne 0) { throw "rollback FAIL failed (exit=$LASTEXITCODE)" }
throw 'VERIFY failed. Rolled back to master.'

