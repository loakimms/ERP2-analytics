# ANALYTICS_FORWARD_ONLY_RAW_COMPOSE_BYPASS_CLOSURE_V1 dry-run
# No Production docker rebuild, no runtime tag change, no git reset.
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-RepoRoot {
  return (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) '..')).Path
}

$repoRoot = Get-RepoRoot
Set-Location -Path $repoRoot | Out-Null
. (Join-Path $repoRoot 'scripts\analytics_forward_only_guard.ps1')

$out = [ordered]@{}
$out.sprint = 'ANALYTICS_FORWARD_ONLY_RAW_COMPOSE_BYPASS_CLOSURE_V1'
$out.actualDockerRebuild = 0
$out.actualRuntimeTagChange = 0

function Fail([string] $why) { throw ('HOLD_PRODUCTION_BUILD_BYPASS_PATH_UNCLOSED: ' + $why) }

# CASE 1: raw compose --build cannot use worktree context
Write-Host '[CASE 1] analytics.local.yml up --build must not build from worktree'
Assert-RuntimeComposeIsImageOnly -RepoRoot $repoRoot
$cfg = & docker compose -p analytics_bypass_closure_probe -f docker/analytics.local.yml --env-file docker/analytics.master.lock config
if ($LASTEXITCODE -ne 0) { Fail 'compose config failed for analytics.local.yml' }
$cfgText = ($cfg | Out-String)
if ($cfgText -match '(?m)^\s+build\s*:') {
  Fail 'docker compose config still contains build: for runtime local.yml'
}
if ($cfgText -match 'context:\s*.*/(api|web)\s*$') {
  Fail 'docker compose config still points context at worktree api/web'
}
$buildOut = & docker compose -p analytics_bypass_closure_probe -f docker/analytics.local.yml --env-file docker/analytics.master.lock build 2>&1 | Out-String
if ($buildOut -match 'load build definition|FROM node|FROM python|context.*\\api|context.*/api|Dockerfile.web') {
  Fail ('compose build still compiled worktree images: ' + $buildOut.Substring(0, [Math]::Min(400, $buildOut.Length)))
}
$upDry = ''
$upDryExit = 'n/a'
try {
  $upDry = & docker compose -p analytics_bypass_closure_probe -f docker/analytics.local.yml --env-file docker/analytics.master.lock up --build --dry-run 2>&1 | Out-String
  $upDryExit = [string]$LASTEXITCODE
} catch {
  $upDry = '' + $_.Exception.Message
  $upDryExit = 'dry-run-unsupported-or-failed'
}
if ($upDry -match 'load build definition|Dockerfile.web|context:.*/api') {
  Fail 'up --build --dry-run still has a worktree build'
}
# never `up -d` here: that would bind 5188/5189
$out.case1 = [ordered]@{
  expected = 'NO_WORKTREE_BUILD_POSSIBLE'
  actual = 'NO_WORKTREE_BUILD_POSSIBLE'
  composeConfigHasBuild = $false
  composeBuildUsedWorktree = $false
  upDashD = 'NOT_RUN'
  upBuildDryRunExit = $upDryExit
}

# CASE 2: start-analytics-local.ps1 is existing image + --no-build
Write-Host '[CASE 2] start-analytics-local.ps1 source check (do not execute up)'
$startSrc = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts\start-analytics-local.ps1') -Raw
if ($startSrc -notmatch "--no-build") { Fail 'start-analytics-local.ps1 missing --no-build' }
if ($startSrc -match "up', '-d', '--build'" -or $startSrc -match "up `"-d`" --build" -or $startSrc -match "up -d --build") {
  Fail 'start-analytics-local.ps1 still invokes compose up --build'
}
$out.case2 = [ordered]@{
  expected = 'existing image only --no-build'
  actual = 'existing image only --no-build'
  scriptExecuted = $false
}

# CASE 3: rebuild without CandidateSnapshot
Write-Host '[CASE 3] analytics_rebuild_and_verify.ps1 without CandidateSnapshot'
$case3 = 'UNEXPECTED'
try {
  & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\analytics_rebuild_and_verify.ps1') 2>&1 | Out-Null
  $case3 = 'NOT_BLOCKED'
} catch {
  $case3 = '' + $_.Exception.Message
}
# pwsh -File does not throw into this catch; check exit
$p3 = Start-Process -FilePath 'pwsh' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $repoRoot 'scripts\analytics_rebuild_and_verify.ps1')) -Wait -PassThru -NoNewWindow -RedirectStandardError (Join-Path $env:TEMP 'afo-case3.err') -RedirectStandardOutput (Join-Path $env:TEMP 'afo-case3.out')
$err3 = Get-Content -LiteralPath (Join-Path $env:TEMP 'afo-case3.err') -Raw -ErrorAction SilentlyContinue
$out3 = Get-Content -LiteralPath (Join-Path $env:TEMP 'afo-case3.out') -Raw -ErrorAction SilentlyContinue
$blob3 = ($err3 + "`n" + $out3)
if ($p3.ExitCode -eq 0 -or $blob3 -notmatch 'BLOCKED_DIRECT_WORKTREE_BUILD') {
  Fail ('CASE 3 did not block worktree rebuild: exit=' + $p3.ExitCode + ' out=' + $blob3)
}
$out.case3 = [ordered]@{ expected = 'BLOCKED'; actual = 'BLOCKED_DIRECT_WORKTREE_BUILD'; exitCode = $p3.ExitCode }

# CASE 4: valid CandidateSnapshot dry-run
Write-Host '[CASE 4] rebuild -DryRun with valid CandidateSnapshot'
$snap = Join-Path $repoRoot 'releases\_candidates\_dryrun_compose_bypass_closure_v1'
$p4 = Start-Process -FilePath 'pwsh' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $repoRoot 'scripts\analytics_rebuild_and_verify.ps1'),'-DryRun','-CandidateSnapshot',$snap) -Wait -PassThru -NoNewWindow -RedirectStandardError (Join-Path $env:TEMP 'afo-case4.err') -RedirectStandardOutput (Join-Path $env:TEMP 'afo-case4.out')
$blob4 = ((Get-Content -LiteralPath (Join-Path $env:TEMP 'afo-case4.err') -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath (Join-Path $env:TEMP 'afo-case4.out') -Raw -ErrorAction SilentlyContinue))
if ($p4.ExitCode -ne 0 -or $blob4 -notmatch 'CANDIDATE_ALLOWED' -or $blob4 -notmatch 'actual Production rebuild=0') {
  Fail ('CASE 4 failed: exit=' + $p4.ExitCode + ' out=' + $blob4)
}
$out.case4 = [ordered]@{ expected = 'CANDIDATE_ALLOWED'; actual = 'CANDIDATE_ALLOWED'; actualBuild = 'NOT_RUN'; exitCode = $p4.ExitCode }

# CASE 5: candidate context = worktree
Write-Host '[CASE 5] candidate context = worktree'
try {
  Assert-NotDirectWorktreeBuildContext -RepoRoot $repoRoot -BuildContext $repoRoot -Entrypoint 'closure-case5'
  Fail 'CASE 5 did not block worktree context'
} catch {
  if (("" + $_.Exception.Message) -notmatch 'BLOCKED_DIRECT_WORKTREE_BUILD') { throw }
}
try {
  Assert-ProductionRebuildPreflight -RepoRoot $repoRoot -CandidateSnapshot $repoRoot -Entrypoint 'closure-case5'
  Fail 'CASE 5 preflight did not block worktree snapshot'
} catch {
  if (("" + $_.Exception.Message) -notmatch 'BLOCKED_DIRECT_WORKTREE_BUILD') { throw }
}
$out.case5 = [ordered]@{ expected = 'BLOCKED_DIRECT_WORKTREE_BUILD'; actual = 'BLOCKED_DIRECT_WORKTREE_BUILD' }

# candidate-build.yml raw compose without env must fail
Write-Host '[extra] candidate-build.yml without env'
$cb = & docker compose -p analytics_candidate_build_probe -f docker/analytics.candidate-build.yml config 2>&1 | Out-String
if ($cb -notmatch 'ANALYTICS_FORWARD_ONLY_CANDIDATE_BUILD|ANALYTICS_CANDIDATE_FOLDER|ANALYTICS_IMAGE_TAG') {
  Fail ('candidate-build.yml config should fail without env, got: ' + $cb)
}
$out.candidateBuildRawComposeWithoutEnv = 'BUILD_BLOCKED'

$out.decision = 'PASS_ANALYTICS_FORWARD_ONLY_RAW_COMPOSE_BYPASS_CLOSURE_V1'
$out | ConvertTo-Json -Depth 8 | Write-Host
Write-Host 'PASS_ANALYTICS_FORWARD_ONLY_RAW_COMPOSE_BYPASS_CLOSURE_V1'
