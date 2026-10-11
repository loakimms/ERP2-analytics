# ANALYTICS_FORWARD_ONLY_PRODUCTION_BASELINE_AND_REBUILD_GUARD_V1
# Canonical authority: governance/CURRENT_PRODUCTION_BASELINE.json
# No --force-old-base / --ignore-baseline / --build-from-worktree.

Set-StrictMode -Version Latest

function Get-AnalyticsRepoRootFromGuard {
  if ($PSCommandPath) {
    return (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) '..')).Path
  }
  return (Resolve-Path '.').Path
}

function Get-FileSha256Hex([string] $Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw ("file missing: " + $Path) }
  return ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash).ToLowerInvariant()
}

function ConvertTo-NormalizedFullPath([string] $Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  return $full.TrimEnd('\', '/')
}

function Read-CurrentProductionBaseline([string] $RepoRoot) {
  $pointer = Join-Path $RepoRoot 'governance\CURRENT_PRODUCTION_BASELINE.json'
  if (-not (Test-Path -LiteralPath $pointer)) {
    throw 'HOLD_CURRENT_PRODUCTION_BASELINE_NOT_REPRODUCIBLE: missing governance/CURRENT_PRODUCTION_BASELINE.json'
  }
  $raw = Get-Content -LiteralPath $pointer -Raw -Encoding UTF8
  $obj = $raw | ConvertFrom-Json
  if (-not $obj) { throw 'HOLD_CURRENT_PRODUCTION_BASELINE_NOT_REPRODUCIBLE: pointer json empty' }
  return @{
    PointerPath = $pointer
    RuntimeTag = [string]$obj.runtimeTag
    SourceSnapshot = [string]$obj.sourceSnapshot
    SourceManifest = [string]$obj.sourceManifest
    SourceManifestSha256 = ([string]$obj.sourceManifestSha256).ToLowerInvariant()
    WebImageDigest = [string]$obj.webImageDigest
    ApiImageDigest = [string]$obj.apiImageDigest
    Status = [string]$obj.status
    Previous = $obj.previousProductionBaseline
  }
}

function Assert-CurrentProductionBaselineIntegrity([string] $RepoRoot) {
  $b = Read-CurrentProductionBaseline -RepoRoot $RepoRoot
  $required = @('RuntimeTag', 'SourceSnapshot', 'SourceManifest', 'SourceManifestSha256', 'WebImageDigest', 'ApiImageDigest', 'Status')
  foreach ($k in $required) {
    if (-not $b[$k]) {
      throw ("HOLD_CURRENT_PRODUCTION_BASELINE_INTEGRITY_FAILURE: missing " + $k)
    }
  }
  if ($b.Status -ne 'CANONICAL_PRODUCTION_BASELINE') {
    throw ("HOLD_CURRENT_PRODUCTION_BASELINE_INTEGRITY_FAILURE: status=" + $b.Status)
  }
  $snap = Join-Path $RepoRoot $b.SourceSnapshot
  $man = Join-Path $RepoRoot $b.SourceManifest
  if (-not (Test-Path -LiteralPath $snap)) {
    throw 'HOLD_CURRENT_PRODUCTION_BASELINE_NOT_REPRODUCIBLE: source snapshot directory missing (no Git/NAS fallback)'
  }
  if (-not (Test-Path -LiteralPath $man)) {
    throw 'HOLD_CURRENT_PRODUCTION_BASELINE_NOT_REPRODUCIBLE: source manifest missing (no Git/NAS fallback)'
  }
  $actual = Get-FileSha256Hex $man
  if ($actual -ne $b.SourceManifestSha256) {
    throw ("HOLD_CURRENT_PRODUCTION_BASELINE_INTEGRITY_FAILURE: manifest sha mismatch expected=" + $b.SourceManifestSha256 + " actual=" + $actual)
  }
  return $b
}

function Assert-CandidateBaseIdentity {
  param(
    [Parameter(Mandatory = $true)][hashtable] $Baseline,
    [Parameter(Mandatory = $true)][string] $BaseRuntimeTag,
    [Parameter(Mandatory = $true)][string] $BaseSourceManifestSha256
  )
  $gotTag = ([string]$BaseRuntimeTag).Trim()
  $gotSha = ([string]$BaseSourceManifestSha256).Trim().ToLowerInvariant()
  if ($gotTag -ne $Baseline.RuntimeTag -or $gotSha -ne $Baseline.SourceManifestSha256) {
    throw ("FAIL_PRODUCTION_BASELINE_REGRESSION: candidate base tag/sha must equal CURRENT_PRODUCTION_BASELINE (have tag=" + $gotTag + " sha=" + $gotSha + ")")
  }
}

function Test-PathIsRepoWorktree([string] $RepoRoot, [string] $CandidatePath) {
  if (-not $CandidatePath) { return $true }
  $repo = ConvertTo-NormalizedFullPath $RepoRoot
  $cand = ConvertTo-NormalizedFullPath $CandidatePath
  if ($cand -eq $repo) { return $true }
  foreach ($leaf in @('api', 'web', 'docker', 'scripts')) {
    if ($cand -eq (ConvertTo-NormalizedFullPath (Join-Path $RepoRoot $leaf))) { return $true }
  }
  return $false
}

function Assert-NotDirectWorktreeBuildContext {
  param(
    [Parameter(Mandatory = $true)][string] $RepoRoot,
    [string] $BuildContext = '',
    [string] $Entrypoint = ''
  )
  if (-not $BuildContext) {
    throw ("BLOCKED_DIRECT_WORKTREE_BUILD: Production image build requires CandidateSnapshot (entrypoint=" + $Entrypoint + ")")
  }
  if (Test-PathIsRepoWorktree -RepoRoot $RepoRoot -CandidatePath $BuildContext) {
    throw ("BLOCKED_DIRECT_WORKTREE_BUILD: buildContext is the developer worktree (entrypoint=" + $Entrypoint + ")")
  }
}

function Read-ApprovedChangeManifest([string] $Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw ("approved-change-manifest missing: " + $Path) }
  $obj = (Get-Content -LiteralPath $Path -Raw -Encoding UTF8) | ConvertFrom-Json
  return $obj
}

function Assert-ApprovedChangeManifestSafe {
  param(
    [Parameter(Mandatory = $true)] $Manifest,
    [Parameter(Mandatory = $true)][hashtable] $Baseline
  )
  $baseTag = [string]$Manifest.baseRuntimeTag
  $baseSha = ([string]$Manifest.baseSourceManifestSha256).ToLowerInvariant()
  Assert-CandidateBaseIdentity -Baseline $Baseline -BaseRuntimeTag $baseTag -BaseSourceManifestSha256 $baseSha
  $unexpected = 0
  $files = @($Manifest.files)
  foreach ($f in $files) {
    $cls = [string]$f.classification
    if ($cls -eq 'UNEXPECTED') { $unexpected += 1 }
    elseif ($cls -notin @('BASELINE_UNCHANGED', 'APPROVED_NEW', 'APPROVED_MODIFIED')) {
      throw ("FAIL_UNEXPECTED_CANDIDATE_DIFF_NOT_BLOCKED: unknown classification=" + $cls)
    }
  }
  if ($unexpected -gt 0) {
    throw ("BUILD_BLOCKED: UNEXPECTED=" + $unexpected)
  }
}

function Assert-PromotionArtifactsPresent {
  param(
    [string] $CandidateSnapshot = '',
    [string] $CandidateSourceManifest = '',
    [string] $ApprovedChangeManifest = '',
    [string] $WebImageDigest = '',
    [string] $ApiImageDigest = '',
    [string] $VersionTag = ''
  )
  $missing = @()
  if (-not $CandidateSnapshot) { $missing += 'candidate source snapshot' }
  if (-not $CandidateSourceManifest) { $missing += 'candidate source manifest' }
  if (-not $ApprovedChangeManifest) { $missing += 'approved change manifest' }
  if (-not $WebImageDigest) { $missing += 'web image digest' }
  if (-not $ApiImageDigest) { $missing += 'api image digest' }
  if (-not $VersionTag) { $missing += 'version tag' }
  if ($missing.Count -gt 0) {
    throw ("HOLD_PROMOTION_BASELINE_FREEZE_INCOMPLETE: missing " + ($missing -join ', ') + " (Docker image success is not promotion complete)")
  }
}

function Get-ProtectedBaselineTags([hashtable] $Baseline) {
  $tags = @()
  if ($Baseline.RuntimeTag) { $tags += [string]$Baseline.RuntimeTag }
  if ($Baseline.Previous) { $tags += [string]$Baseline.Previous }
  return $tags
}

function Test-ReleaseSnapshotProtected([string] $RepoRoot, [string] $TargetPath, [hashtable] $Baseline) {
  if (-not $TargetPath) { return $false }
  $full = ConvertTo-NormalizedFullPath $TargetPath
  foreach ($tag in (Get-ProtectedBaselineTags -Baseline $Baseline)) {
    if (-not $tag) { continue }
    $protected = ConvertTo-NormalizedFullPath (Join-Path $RepoRoot ('releases\' + $tag))
    if ($full -eq $protected) { return $true }
  }
  return $false
}

function Assert-NoProductionBypassSwitch {
  param([string[]] $ArgTokens = @())
  $forbidden = @(
    '--force-old-base',
    '--ignore-baseline',
    '--build-from-worktree',
    '-ForceOldBase',
    '-IgnoreBaseline',
    '-BuildFromWorktree'
  )
  foreach ($t in $ArgTokens) {
    if ($forbidden -contains $t) {
      throw ('FAIL_PRODUCTION_BASELINE_REGRESSION: production bypass switch is forbidden: ' + $t)
    }
  }
}

function Assert-CandidateFolderNameSafe([string] $Name) {
  if (-not $Name) {
    throw 'BLOCKED_DIRECT_WORKTREE_BUILD: candidate folder name is empty'
  }
  if ($Name -match '\.\.|[\\/]') {
    throw ('BLOCKED_DIRECT_WORKTREE_BUILD: candidate folder traversal is forbidden: ' + $Name)
  }
  if ($Name -notmatch '^(analytics_[0-9]{8}_[0-9]{6}|_dryrun_[A-Za-z0-9_-]+)$') {
    throw ('BLOCKED_DIRECT_WORKTREE_BUILD: invalid candidate folder name=' + $Name)
  }
}

function Get-CandidateFolderName([string] $RepoRoot, [string] $CandidateSnapshot) {
  $full = ConvertTo-NormalizedFullPath $CandidateSnapshot
  $root = ConvertTo-NormalizedFullPath (Join-Path $RepoRoot 'releases\_candidates')
  if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'BLOCKED_DIRECT_WORKTREE_BUILD: docker build context must be under releases/_candidates/'
  }
  $rel = $full.Substring($root.Length).Trim('\', '/')
  if (-not $rel -or $rel -match '[\\/]') {
    throw 'BLOCKED_DIRECT_WORKTREE_BUILD: candidate snapshot must be a direct child of releases/_candidates/'
  }
  Assert-CandidateFolderNameSafe -Name $rel
  return $rel
}

function Assert-RuntimeComposeIsImageOnly([string] $RepoRoot) {
  $runtimeFiles = @(
    'docker\analytics.local.yml',
    'docker\analytics.local.override.yml',
    'docker\analytics.master.yml',
    'docker\analytics.nas.master.yml'
  )
  foreach ($rel in $runtimeFiles) {
    $p = Join-Path $RepoRoot $rel
    if (-not (Test-Path -LiteralPath $p)) { continue }
    $lines = Get-Content -LiteralPath $p -Encoding UTF8
    $i = 0
    foreach ($line in $lines) {
      $i += 1
      $t = ('' + $line)
      if ($t -match '^\s*build\s*:') {
        throw ("HOLD_PRODUCTION_BUILD_BYPASS_PATH_UNCLOSED: runtime compose must be image-only (no build:): " + $rel + ":" + $i)
      }
      if ($t -match 'context\s*:\s*\.\./(api|web)\b') {
        throw ("HOLD_PRODUCTION_BUILD_BYPASS_PATH_UNCLOSED: worktree build.context in runtime compose: " + $rel + ":" + $i)
      }
    }
  }
}

function Assert-BuildContextIsCandidateSnapshot {
  param(
    [Parameter(Mandatory = $true)][string] $RepoRoot,
    [Parameter(Mandatory = $true)][string] $BuildContext
  )
  $full = ConvertTo-NormalizedFullPath $BuildContext
  $candidatesRoot = ConvertTo-NormalizedFullPath (Join-Path $RepoRoot 'releases\_candidates')
  if (-not $full.StartsWith($candidatesRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'BLOCKED_DIRECT_WORKTREE_BUILD: docker build context must be under releases/_candidates/'
  }
  $api = Join-Path $BuildContext 'source\api'
  $web = Join-Path $BuildContext 'source\web'
  if (-not (Test-Path -LiteralPath $api) -or -not (Test-Path -LiteralPath $web)) {
    throw 'HOLD_CURRENT_PRODUCTION_BASELINE_NOT_REPRODUCIBLE: candidate snapshot missing source/api or source/web'
  }
}

function Read-CandidateIdentity([string] $CandidateSnapshot) {
  $p = Join-Path $CandidateSnapshot 'manifests\candidate-identity.json'
  if (-not (Test-Path -LiteralPath $p)) {
    throw 'FAIL_PRODUCTION_BASELINE_REGRESSION: missing manifests/candidate-identity.json (baseRuntimeTag/baseSourceManifestSha256 required)'
  }
  return ((Get-Content -LiteralPath $p -Raw -Encoding UTF8) | ConvertFrom-Json)
}

function Assert-ProductionRebuildPreflight {
  param(
    [Parameter(Mandatory = $true)][string] $RepoRoot,
    [string] $CandidateSnapshot = '',
    [string] $ApprovedChangeManifest = '',
    [string] $Entrypoint = 'analytics_rebuild_and_verify.ps1',
    [switch] $SkipCandidateSnapshot
  )
  $baseline = Assert-CurrentProductionBaselineIntegrity -RepoRoot $RepoRoot
  Assert-RuntimeComposeIsImageOnly -RepoRoot $RepoRoot
  if ($SkipCandidateSnapshot) { return $baseline }
  Assert-NotDirectWorktreeBuildContext -RepoRoot $RepoRoot -BuildContext $CandidateSnapshot -Entrypoint $Entrypoint
  if (Test-ReleaseSnapshotProtected -RepoRoot $RepoRoot -TargetPath $CandidateSnapshot -Baseline $baseline) {
    throw 'FAIL_PRODUCTION_BASELINE_REGRESSION: CURRENT/PREVIOUS baseline snapshots are immutable; overlay into releases/_candidates/<tag>/'
  }
  Assert-BuildContextIsCandidateSnapshot -RepoRoot $RepoRoot -BuildContext $CandidateSnapshot
  Get-CandidateFolderName -RepoRoot $RepoRoot -CandidateSnapshot $CandidateSnapshot | Out-Null
  $ident = Read-CandidateIdentity -CandidateSnapshot $CandidateSnapshot
  Assert-CandidateBaseIdentity -Baseline $baseline -BaseRuntimeTag ([string]$ident.baseRuntimeTag) -BaseSourceManifestSha256 ([string]$ident.baseSourceManifestSha256)
  if (-not $ApprovedChangeManifest) {
    $ApprovedChangeManifest = Join-Path $CandidateSnapshot 'manifests\approved-change-manifest.json'
  }
  $m = Read-ApprovedChangeManifest -Path $ApprovedChangeManifest
  Assert-ApprovedChangeManifestSafe -Manifest $m -Baseline $baseline
  $candMan = Join-Path $CandidateSnapshot 'manifests\source-manifest.json'
  if (-not (Test-Path -LiteralPath $candMan)) {
    throw 'HOLD_CURRENT_PRODUCTION_BASELINE_NOT_REPRODUCIBLE: candidate source-manifest.json missing'
  }
  return $baseline
}

function Update-CurrentProductionBaselinePointer {
  param(
    [Parameter(Mandatory = $true)][string] $RepoRoot,
    [Parameter(Mandatory = $true)][string] $NewRuntimeTag,
    [Parameter(Mandatory = $true)][string] $NewSourceSnapshot,
    [Parameter(Mandatory = $true)][string] $NewSourceManifest,
    [Parameter(Mandatory = $true)][string] $NewSourceManifestSha256,
    [Parameter(Mandatory = $true)][string] $WebImageDigest,
    [Parameter(Mandatory = $true)][string] $ApiImageDigest
  )
  $old = Read-CurrentProductionBaseline -RepoRoot $RepoRoot
  $newSnapFull = Join-Path $RepoRoot $NewSourceSnapshot
  $newManFull = Join-Path $RepoRoot $NewSourceManifest
  if (-not (Test-Path -LiteralPath $newSnapFull) -or -not (Test-Path -LiteralPath $newManFull)) {
    throw 'HOLD_PROMOTION_BASELINE_FREEZE_INCOMPLETE: new release snapshot/manifest missing'
  }
  $actual = Get-FileSha256Hex $newManFull
  if ($actual -ne $NewSourceManifestSha256.ToLowerInvariant()) {
    throw 'HOLD_PROMOTION_BASELINE_FREEZE_INCOMPLETE: new sourceManifestSha256 mismatch'
  }
  $pointer = Join-Path $RepoRoot 'governance\CURRENT_PRODUCTION_BASELINE.json'
  $obj = [ordered]@{
    status = 'CANONICAL_PRODUCTION_BASELINE'
    runtimeTag = $NewRuntimeTag
    sourceSnapshot = $NewSourceSnapshot.Replace('\', '/')
    sourceManifest = $NewSourceManifest.Replace('\', '/')
    sourceManifestSha256 = $NewSourceManifestSha256.ToLowerInvariant()
    webImageDigest = $WebImageDigest
    apiImageDigest = $ApiImageDigest
    previousProductionBaseline = $old.RuntimeTag
    frozenAt = (Get-Date).ToString('s')
    notes = @(
      'Production Promotion + Canonical Baseline Freeze are one transaction.',
      'CURRENT and PREVIOUS release snapshots are excluded from automatic deletion.',
      'BuildKit/containerd/running containers are RECOVERY_EVIDENCE_ONLY.'
    )
  }
  ($obj | ConvertTo-Json -Depth 8) | Set-Content -Encoding UTF8 -LiteralPath $pointer
  $verify = Read-CurrentProductionBaseline -RepoRoot $RepoRoot
  if ($verify.RuntimeTag -ne $NewRuntimeTag -or $verify.SourceManifestSha256 -ne $NewSourceManifestSha256.ToLowerInvariant()) {
    throw 'HOLD_PROMOTION_BASELINE_FREEZE_INCOMPLETE: pointer write did not stick'
  }
  return $verify
}

function Test-GitHeadEqualsCanonicalBaseline([string] $RepoRoot, [hashtable] $Baseline) {
  # Git HEAD is production base only when the entire build-input tree
  # is mechanically proven equal to sourceManifestSha256. "Closest commit"
  # or a single-file match is never sufficient. No such proof exists here.
  if (-not $RepoRoot -or -not $Baseline) { return $false }
  return $false
}

function Invoke-ForwardOnlyDryRunGates([string] $RepoRoot) {
  $results = @{}
  Assert-RuntimeComposeIsImageOnly -RepoRoot $RepoRoot
  $results.runtimeComposeImageOnly = 'NO_WORKTREE_BUILD_POSSIBLE'
  $baseline = Assert-CurrentProductionBaselineIntegrity -RepoRoot $RepoRoot
  $results.baselineIntegrity = 'PASS'

  # Gate 1: Git HEAD as base
  $headEquals = Test-GitHeadEqualsCanonicalBaseline -RepoRoot $RepoRoot -Baseline $baseline
  if ($headEquals) {
    $results.gate1_gitHead = 'UNEXPECTED_EQUAL_TO_BASELINE'
  } else {
    try {
      Assert-CandidateBaseIdentity -Baseline $baseline -BaseRuntimeTag 'git-HEAD' -BaseSourceManifestSha256 'not-the-canonical-manifest'
      $results.gate1_gitHead = 'FAIL_PRODUCTION_BASELINE_REGRESSION_GUARD'
    } catch {
      if (("" + $_.Exception.Message) -match 'FAIL_PRODUCTION_BASELINE_REGRESSION') {
        $results.gate1_gitHead = 'FAIL_PRODUCTION_BASELINE_REGRESSION'
      } else {
        $results.gate1_gitHead = ('' + $_.Exception.Message)
      }
    }
  }

  # Gate 2: direct worktree
  try {
    Assert-NotDirectWorktreeBuildContext -RepoRoot $RepoRoot -BuildContext $RepoRoot -Entrypoint 'dry-run-worktree'
    $results.gate2_worktree = 'FAIL_DIRECT_DIRTY_WORKTREE_BUILD_NOT_BLOCKED'
  } catch {
    if (("" + $_.Exception.Message) -match 'BLOCKED_DIRECT_WORKTREE_BUILD') {
      $results.gate2_worktree = 'BLOCKED_DIRECT_WORKTREE_BUILD'
    } else {
      $results.gate2_worktree = ('' + $_.Exception.Message)
    }
  }

  # Gate 3: canonical baseline accepted (no docker build)
  $snap = Join-Path $RepoRoot $baseline.SourceSnapshot
  if (Test-Path -LiteralPath $snap) {
    $results.gate3_canonicalBaseline = 'BASELINE_ACCEPTED'
  } else {
    $results.gate3_canonicalBaseline = 'HOLD_CURRENT_PRODUCTION_BASELINE_NOT_REPRODUCIBLE'
  }

  # Gate 4: approved overlay fixture
  $fixDir = Join-Path $RepoRoot 'calibration\review\analytics-forward-only-production-baseline-and-rebuild-guard-v1\fixtures'
  $okMan = Join-Path $fixDir 'approved-overlay.json'
  try {
    $m = Read-ApprovedChangeManifest -Path $okMan
    Assert-ApprovedChangeManifestSafe -Manifest $m -Baseline $baseline
    $results.gate4_approvedOverlay = 'CANDIDATE_ALLOWED'
  } catch {
    $results.gate4_approvedOverlay = ('' + $_.Exception.Message)
  }

  # Gate 5: unexpected file
  $badMan = Join-Path $fixDir 'unexpected-file.json'
  try {
    $m2 = Read-ApprovedChangeManifest -Path $badMan
    Assert-ApprovedChangeManifestSafe -Manifest $m2 -Baseline $baseline
    $results.gate5_unexpected = 'FAIL_UNEXPECTED_CANDIDATE_DIFF_NOT_BLOCKED'
  } catch {
    if (("" + $_.Exception.Message) -match 'BUILD_BLOCKED') {
      $results.gate5_unexpected = 'BUILD_BLOCKED'
    } else {
      $results.gate5_unexpected = ('' + $_.Exception.Message)
    }
  }

  # Promotion artifacts missing
  try {
    Assert-PromotionArtifactsPresent
    $results.gate_promotionMissing = 'FAIL_PROMOTION_WITHOUT_SOURCE_BASELINE'
  } catch {
    if (("" + $_.Exception.Message) -match 'HOLD_PROMOTION_BASELINE_FREEZE_INCOMPLETE') {
      $results.gate_promotionMissing = 'HOLD_PROMOTION_BASELINE_FREEZE_INCOMPLETE'
    } else {
      $results.gate_promotionMissing = ('' + $_.Exception.Message)
    }
  }

  # Protected CURRENT snapshot must not be a docker build context
  try {
    Assert-ProductionRebuildPreflight -RepoRoot $RepoRoot -CandidateSnapshot (Join-Path $RepoRoot $baseline.SourceSnapshot) -Entrypoint 'dry-run-protected-baseline'
    $results.gate_protectedBaselineBuild = 'FAIL_PRODUCTION_BASELINE_REGRESSION_GUARD'
  } catch {
    $msg = '' + $_.Exception.Message
    if ($msg -match 'FAIL_PRODUCTION_BASELINE_REGRESSION|BLOCKED_DIRECT_WORKTREE_BUILD') {
      $results.gate_protectedBaselineBuild = 'PROTECTED_BASELINE_NOT_BUILD_CONTEXT'
    } else {
      $results.gate_protectedBaselineBuild = $msg
    }
  }

  # docker build context must be releases/_candidates
  try {
    Assert-BuildContextIsCandidateSnapshot -RepoRoot $RepoRoot -BuildContext $RepoRoot
    $results.gate_buildInputMustBeCandidate = 'FAIL_DIRECT_DIRTY_WORKTREE_BUILD_NOT_BLOCKED'
  } catch {
    if (("" + $_.Exception.Message) -match 'BLOCKED_DIRECT_WORKTREE_BUILD') {
      $results.gate_buildInputMustBeCandidate = 'BLOCKED_DIRECT_WORKTREE_BUILD'
    } else {
      $results.gate_buildInputMustBeCandidate = ('' + $_.Exception.Message)
    }
  }

  $results.promotionFreezeContract = 'Production Promotion + Canonical Baseline Freeze are one transaction; pointer failure => HOLD_PROMOTION_BASELINE_FREEZE_INCOMPLETE; PROMOTION_COMPLETE=NO'
  $results.buildKitRole = 'RECOVERY_EVIDENCE_ONLY'
  $results.canonicalAuthority = 'governance/CURRENT_PRODUCTION_BASELINE.json + releases/<production-tag>'
  $results.protectedTags = @(Get-ProtectedBaselineTags -Baseline $baseline)
  $results.runtimeTag = $baseline.RuntimeTag
  $results.sourceManifestSha256 = $baseline.SourceManifestSha256
  $results.webImageDigest = $baseline.WebImageDigest
  $results.apiImageDigest = $baseline.ApiImageDigest
  $results.status = $baseline.Status
  $results.actualBuild = 'NOT_RUN'
  $results.actualPromotion = 'NOT_RUN'
  $results.runtimeTagChange = 'NOT_RUN'
  return $results
}
