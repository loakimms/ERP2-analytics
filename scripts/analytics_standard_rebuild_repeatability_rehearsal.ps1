param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Info([string] $m) { Write-Host "[REHEARSAL] $m" -ForegroundColor Cyan }
function Fail([string] $code, [string] $m) { throw ($code + ': ' + $m) }
function Sha256([string] $p) { return ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash).ToLowerInvariant() }
function ReadJson([string] $p) { return (Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json) }
function WriteJson([string] $p, $obj, [int] $depth = 12) { ($obj | ConvertTo-Json -Depth $depth) | Set-Content -LiteralPath $p -Encoding UTF8 }
function Rel([string] $root, [string] $path) { return ([System.IO.Path]::GetFullPath($path).Substring([System.IO.Path]::GetFullPath($root).TrimEnd('\','/').Length).TrimStart('\','/').Replace('\','/')) }

$repo = (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) '..')).Path
Set-Location $repo
. (Join-Path $repo 'scripts\analytics_forward_only_guard.ps1')

$beforePointerRaw = Get-Content -LiteralPath (Join-Path $repo 'governance\CURRENT_PRODUCTION_BASELINE.json') -Raw -Encoding UTF8
$beforeMasterLockRaw = Get-Content -LiteralPath (Join-Path $repo 'docker\analytics.master.lock') -Raw -Encoding UTF8
$baseline = Assert-CurrentProductionBaselineIntegrity -RepoRoot $repo
Assert-RuntimeComposeIsImageOnly -RepoRoot $repo
if ($baseline.RuntimeTag -ne 'analytics_20260921_005100') { Fail 'FAIL_PRODUCTION_MUTATED_DURING_REHEARSAL' ('unexpected baseline=' + $baseline.RuntimeTag) }

$tag = 'analytics_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
$candidate = Join-Path $repo ('releases\_candidates\' + $tag)
if (Test-Path -LiteralPath $candidate) { Fail 'FAIL_CANONICAL_CANDIDATE_BUILD' ('candidate exists: ' + $candidate) }
$baseRelease = Join-Path $repo $baseline.SourceSnapshot
New-Item -ItemType Directory -Force -Path $candidate | Out-Null
Copy-Item -LiteralPath (Join-Path $baseRelease 'source') -Destination (Join-Path $candidate 'source') -Recurse
Copy-Item -LiteralPath (Join-Path $baseRelease 'docker') -Destination (Join-Path $candidate 'docker') -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $candidate 'manifests') | Out-Null

$fixtureRel = 'source/web/public/rebuild-repeatability-fixture.txt'
$fixturePath = Join-Path $candidate ($fixtureRel -replace '/', '\')
@"
ANALYTICS_STANDARD_REBUILD_REPEATABILITY_REHEARSAL_V1
candidate=$tag
baseRuntimeTag=$($baseline.RuntimeTag)
baseManifestSha256=$($baseline.SourceManifestSha256)
behavior=none
"@ | Set-Content -LiteralPath $fixturePath -Encoding UTF8

$approved = [ordered]@{
  sprint = 'ANALYTICS_STANDARD_REBUILD_REPEATABILITY_REHEARSAL_V1'
  baseRuntimeTag = $baseline.RuntimeTag
  baseSourceManifestSha256 = $baseline.SourceManifestSha256
  candidateTag = $tag
  summary = [ordered]@{ BASELINE_UNCHANGED = 'all 005100 build-input files except approved overlay'; APPROVED_NEW = 1; APPROVED_MODIFIED = 0; UNEXPECTED = 0 }
  files = @([ordered]@{ relativePath = $fixtureRel; classification = 'APPROVED_NEW'; sha256 = (Sha256 $fixturePath); behaviorImpact = 'none' })
}
$approvedPath = Join-Path $candidate 'manifests\approved-change-manifest.json'
WriteJson $approvedPath $approved
$approvedSha = Sha256 $approvedPath

$identity = [ordered]@{
  sprint = 'ANALYTICS_STANDARD_REBUILD_REPEATABILITY_REHEARSAL_V1'
  candidateTag = $tag
  baseRuntimeTag = $baseline.RuntimeTag
  baseSourceManifestSha256 = $baseline.SourceManifestSha256
  approvedChangeManifest = 'manifests/approved-change-manifest.json'
  approvedChangeManifestSha256 = $approvedSha
  buildContextPolicy = 'docker/analytics.candidate-build.yml -> releases/_candidates/<tag>/source/{api,web}'
}
$identityPath = Join-Path $candidate 'manifests\candidate-identity.json'
WriteJson $identityPath $identity

function New-Manifest([string] $Root, [string] $RuntimeTag, [string] $OutPath) {
  $files = @()
  foreach ($f in Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object FullName) {
    $rel = Rel $Root $f.FullName
    if ($rel -in @('manifests/source-manifest.json','manifests/source-manifest.sha256')) { continue }
    $files += [ordered]@{ relativePath = $rel; size = $f.Length; sha256 = (Sha256 $f.FullName) }
  }
  $obj = [ordered]@{ runtimeTag = $RuntimeTag; createdAt = (Get-Date).ToString('s'); fileCount = $files.Count; files = $files }
  WriteJson $OutPath $obj 20
  return (Sha256 $OutPath)
}
$manifestPath = Join-Path $candidate 'manifests\source-manifest.json'
$candidateManifestSha = New-Manifest -Root $candidate -RuntimeTag $tag -OutPath $manifestPath
$candidateManifestSha | Set-Content -LiteralPath (Join-Path $candidate 'manifests\source-manifest.sha256') -Encoding ASCII

$identity = ReadJson $identityPath
$identity | Add-Member -NotePropertyName candidateSourceManifest -NotePropertyValue 'manifests/source-manifest.json' -Force
$identity | Add-Member -NotePropertyName candidateManifestSha256 -NotePropertyValue $candidateManifestSha -Force
WriteJson $identityPath $identity
$approvedObj = ReadJson $approvedPath
$approvedObj | Add-Member -NotePropertyName candidateManifestSha256 -NotePropertyValue $candidateManifestSha -Force
WriteJson $approvedPath $approvedObj
$approvedSha = Sha256 $approvedPath
$candidateManifestSha = New-Manifest -Root $candidate -RuntimeTag $tag -OutPath $manifestPath
$candidateManifestSha | Set-Content -LiteralPath (Join-Path $candidate 'manifests\source-manifest.sha256') -Encoding ASCII

Info "Candidate created: $tag"
Info "Candidate manifest: $candidateManifestSha"

# Guard / preflight
Assert-ProductionRebuildPreflight -RepoRoot $repo -CandidateSnapshot $candidate -ApprovedChangeManifest $approvedPath -Entrypoint 'repeatability-rehearsal' | Out-Null
& pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\analytics_rebuild_and_verify.ps1') -DryRun -CandidateSnapshot $candidate -ApprovedChangeManifest $approvedPath | Out-Host
if ($LASTEXITCODE -ne 0) { Fail 'FAIL_CANONICAL_CANDIDATE_BUILD' 'Forward-Only dry-run failed' }

# Actual image build only; no switch/promote.
& pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\analytics_build_candidate.ps1') -CandidateSnapshot $candidate -ApprovedChangeManifest $approvedPath -CandidateTag $tag | Out-Host
if ($LASTEXITCODE -ne 0) { Fail 'FAIL_CANONICAL_CANDIDATE_BUILD' 'candidate image build failed' }
$webDigest = ((docker image inspect --format '{{.Id}}' ("analytics-analytics-web:$tag")) | Out-String).Trim()
$apiDigest = ((docker image inspect --format '{{.Id}}' ("analytics-analytics-api:$tag")) | Out-String).Trim()
if (-not $webDigest -or -not $apiDigest) { Fail 'FAIL_CANONICAL_CANDIDATE_BUILD' 'missing built image digest' }

# Isolated runtime.
$rehearsalRoot = Join-Path $repo 'releases\_rehearsal'
New-Item -ItemType Directory -Force -Path $rehearsalRoot | Out-Null
$composePath = Join-Path $rehearsalRoot ("analytics.rehearsal.$tag.yml")
$lockPath = Join-Path $rehearsalRoot ("analytics.rehearsal.$tag.lock")
@"
ANALYTICS_IMAGE_TAG=$tag
VITE_APP_VERSION=$tag
VITE_IMAGE_TAG=$tag
ANALYTICS_BUILD_TIME=$(Get-Date -Format s)
ANALYTICS_GIT_SHA=repeatability-rehearsal
FIREBASE_PROJECT_ID=money-management-e380f
"@ | Set-Content -LiteralPath $lockPath -Encoding ASCII
@"
name: analytics_rehearsal_$($tag.Replace('analytics_',''))
services:
  analytics-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: analytics
      POSTGRES_PASSWORD: analytics_pw
      POSTGRES_DB: analytics
    ports:
      - "7442:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U analytics -d analytics"]
      interval: 5s
      timeout: 5s
      retries: 20
  analytics-api:
    image: "analytics-analytics-api:`${ANALYTICS_IMAGE_TAG:?}"
    depends_on:
      analytics-db:
        condition: service_healthy
    environment:
      ANALYTICS_IMAGE_TAG: `${ANALYTICS_IMAGE_TAG:?}
      ANALYTICS_BUILD_TIME: `${ANALYTICS_BUILD_TIME:-}
      ANALYTICS_GIT_SHA: `${ANALYTICS_GIT_SHA:-}
      REQUIRE_FIREBASE_AUTH: "0"
      FIREBASE_PROJECT_ID: `${FIREBASE_PROJECT_ID:-}
      ADMIN_TEST_MODE: "1"
      ANALYTICS_DB_URL: postgresql://analytics:analytics_pw@analytics-db:5432/analytics
      API_SETTINGS_DB_ONLY: "1"
      CORS_ORIGINS: "*"
      GFA_GENERATED_IMAGE_DIR: /data/gfa_generated_creatives
      CONTENT_GENERATED_IMAGE_DIR: /data/content_generated_images
      CONTENT_ASSET_DIR: /data/content_assets
      GFA_WINDOWS_FONT_DIR: /host_windows_fonts
      PYTHONUNBUFFERED: "1"
    ports:
      - "7189:8000"
    volumes:
      - rehearsal-generated-data:/data/gfa_generated_creatives
      - rehearsal-content-images:/data/content_generated_images
      - rehearsal-content-assets:/data/content_assets
      - C:/Windows/Fonts:/host_windows_fonts:ro
  analytics-web:
    image: "analytics-analytics-web:`${ANALYTICS_IMAGE_TAG:?}"
    depends_on:
      - analytics-api
    ports:
      - "7188:80"
volumes:
  rehearsal-generated-data:
  rehearsal-content-images:
  rehearsal-content-assets:
"@ | Set-Content -LiteralPath $composePath -Encoding UTF8

$project = 'analytics_rehearsal_' + ($tag -replace '[^0-9A-Za-z]','_')
try {
  docker compose -p $project -f $composePath --env-file $lockPath up -d --pull never --remove-orphans | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail 'FAIL_CANDIDATE_RUNTIME_VERIFY' 'isolated compose up failed' }

  $apiOk = $false
  $webOk = $false
  $apiVersion = $null
  $webVersion = $null
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $apiVersion = (curl.exe -sS http://localhost:7189/api/version | ConvertFrom-Json)
      if ($apiVersion.imageTag -eq $tag) { $apiOk = $true }
    } catch { }
    try {
      $webVersion = (curl.exe -sS http://localhost:7188/version.json | ConvertFrom-Json)
      if ($webVersion.imageTag -eq $tag) { $webOk = $true }
    } catch { }
    if ($apiOk -and $webOk) { break }
    Start-Sleep -Seconds 2
  }
  if (-not $apiOk -or -not $webOk) { Fail 'FAIL_CANDIDATE_VERSION_IDENTITY' 'isolated Web/API version mismatch or unavailable' }

  $prodWeb = (curl.exe -sS http://localhost:5188/version.json | ConvertFrom-Json)
  $prodApi = (curl.exe -sS http://localhost:5189/api/version | ConvertFrom-Json)
  if ($prodWeb.imageTag -ne 'analytics_20260921_005100' -or $prodApi.imageTag -ne 'analytics_20260921_005100') {
    Fail 'FAIL_PRODUCTION_MUTATED_DURING_REHEARSAL' 'production runtime tag changed'
  }

  # Promotion preflight, but no promotion call.
  Assert-PromotionArtifactsPresent -CandidateSnapshot $candidate -CandidateSourceManifest $manifestPath -ApprovedChangeManifest $approvedPath -WebImageDigest $webDigest -ApiImageDigest $apiDigest -VersionTag $tag
  $promoEligible = $true

  # Next baseline freeze simulation.
  $simRelease = Join-Path $rehearsalRoot $tag
  if (Test-Path -LiteralPath $simRelease) { Remove-Item -LiteralPath $simRelease -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $simRelease | Out-Null
  Copy-Item -LiteralPath (Join-Path $candidate 'source') -Destination (Join-Path $simRelease 'source') -Recurse
  Copy-Item -LiteralPath (Join-Path $candidate 'docker') -Destination (Join-Path $simRelease 'docker') -Recurse
  Copy-Item -LiteralPath (Join-Path $candidate 'manifests') -Destination (Join-Path $simRelease 'manifests') -Recurse
  $provenance = [ordered]@{
    sprint = 'ANALYTICS_STANDARD_REBUILD_REPEATABILITY_REHEARSAL_V1'
    candidateTag = $tag
    baseRuntimeTag = $baseline.RuntimeTag
    baseManifestSha256 = $baseline.SourceManifestSha256
    candidateManifestSha256 = $candidateManifestSha
    approvedChangeManifestSha256 = $approvedSha
    webImageDigest = $webDigest
    apiImageDigest = $apiDigest
    frozenAsSimulationAt = (Get-Date).ToString('s')
    productionAuthority = $false
  }
  WriteJson (Join-Path $simRelease 'manifests\build-provenance.json') $provenance
  foreach ($required in @('source','docker','manifests','manifests\source-manifest.json','manifests\approved-change-manifest.json','manifests\build-provenance.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $simRelease $required))) { Fail 'FAIL_NEXT_BASELINE_FREEZE_SIMULATION' ('missing ' + $required) }
  }
  $simPointer = [ordered]@{
    status = 'REHEARSAL_NEXT_BASELINE_SIMULATION'
    productionAuthority = $false
    runtimeTag = $tag
    sourceSnapshot = ('releases/_rehearsal/' + $tag)
    sourceManifest = ('releases/_rehearsal/' + $tag + '/manifests/source-manifest.json')
    sourceManifestSha256 = $candidateManifestSha
    webImageDigest = $webDigest
    apiImageDigest = $apiDigest
    previousProductionBaseline = $baseline.RuntimeTag
  }
  $simPointerPath = Join-Path $rehearsalRoot 'NEXT_BASELINE_SIMULATION.json'
  WriteJson $simPointerPath $simPointer
  $readSim = ReadJson $simPointerPath
  if ($readSim.runtimeTag -ne $tag -or $readSim.sourceManifestSha256 -ne $candidateManifestSha) { Fail 'FAIL_NEXT_BASELINE_FREEZE_SIMULATION' 'simulation pointer invalid' }

  # Second generation candidate dry-run from simulated baseline (no Docker build).
  $gen2Tag = '_dryrun_repeatability_gen2'
  $gen2 = Join-Path $rehearsalRoot ('_candidates_second_generation\' + $gen2Tag)
  if (Test-Path -LiteralPath $gen2) { Remove-Item -LiteralPath $gen2 -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $gen2 | Out-Null
  Copy-Item -LiteralPath (Join-Path $simRelease 'source') -Destination (Join-Path $gen2 'source') -Recurse
  Copy-Item -LiteralPath (Join-Path $simRelease 'docker') -Destination (Join-Path $gen2 'docker') -Recurse
  New-Item -ItemType Directory -Force -Path (Join-Path $gen2 'manifests') | Out-Null
  $gen2Fixture = Join-Path $gen2 'source\web\public\rebuild-repeatability-fixture-gen2.txt'
  'second generation approved fixture; behavior=none' | Set-Content -LiteralPath $gen2Fixture -Encoding UTF8
  $gen2Approved = [ordered]@{
    sprint = 'ANALYTICS_STANDARD_REBUILD_REPEATABILITY_REHEARSAL_V1_GEN2_DRYRUN'
    baseRuntimeTag = $tag
    baseSourceManifestSha256 = $candidateManifestSha
    files = @([ordered]@{ relativePath = 'source/web/public/rebuild-repeatability-fixture-gen2.txt'; classification = 'APPROVED_NEW'; sha256 = (Sha256 $gen2Fixture) })
    summary = [ordered]@{ APPROVED_NEW = 1; APPROVED_MODIFIED = 0; UNEXPECTED = 0 }
  }
  WriteJson (Join-Path $gen2 'manifests\approved-change-manifest.json') $gen2Approved
  $gen2Ident = [ordered]@{ candidateTag = $gen2Tag; baseRuntimeTag = $tag; baseSourceManifestSha256 = $candidateManifestSha }
  WriteJson (Join-Path $gen2 'manifests\candidate-identity.json') $gen2Ident
  $gen2ManifestSha = New-Manifest -Root $gen2 -RuntimeTag $gen2Tag -OutPath (Join-Path $gen2 'manifests\source-manifest.json')
  if (-not $gen2ManifestSha) { Fail 'FAIL_SECOND_GENERATION_CANDIDATE_CREATION' 'gen2 manifest missing' }

  $afterPointerRaw = Get-Content -LiteralPath (Join-Path $repo 'governance\CURRENT_PRODUCTION_BASELINE.json') -Raw -Encoding UTF8
  $afterMasterLockRaw = Get-Content -LiteralPath (Join-Path $repo 'docker\analytics.master.lock') -Raw -Encoding UTF8
  if ($afterPointerRaw -ne $beforePointerRaw -or $afterMasterLockRaw -ne $beforeMasterLockRaw) {
    Fail 'FAIL_PRODUCTION_MUTATED_DURING_REHEARSAL' 'pointer or master lock changed'
  }

  $result = [ordered]@{
    sprint = 'ANALYTICS_STANDARD_REBUILD_REPEATABILITY_REHEARSAL_V1'
    decision = 'PASS_ANALYTICS_STANDARD_REBUILD_REPEATABILITY_REHEARSAL_V1'
    candidateTag = $tag
    baseRuntimeTag = $baseline.RuntimeTag
    baseManifestSha256 = $baseline.SourceManifestSha256
    candidateSnapshot = (Rel $repo $candidate)
    approvedOverlay = [ordered]@{ approvedNew = 1; approvedModified = 0; unexpected = 0; file = $fixtureRel }
    candidateManifestSha256 = $candidateManifestSha
    approvedChangeManifestSha256 = $approvedSha
    webImageDigest = $webDigest
    apiImageDigest = $apiDigest
    isolatedRuntime = [ordered]@{ project = $project; web = 'http://localhost:7188/version.json'; api = 'http://localhost:7189/api/version'; webImageTag = $webVersion.imageTag; apiImageTag = $apiVersion.imageTag }
    promotionPreflight = if ($promoEligible) { 'PROMOTION_ELIGIBLE' } else { 'NOT_ELIGIBLE' }
    nextBaselineSimulation = (Rel $repo $simPointerPath)
    secondGenerationDryRun = [ordered]@{ created = $true; manifestSha256 = $gen2ManifestSha; dockerBuild = 'NOT_RUN' }
    productionMutation = [ordered]@{ dockerProductionRebuild = 0; productionPromotion = 0; productionRuntimeTagChange = 0; currentProductionBaselineChange = 0 }
    gates = [ordered]@{
      R1 = 'PASS'; R2 = 'PASS'; R3 = 'PASS'; R4 = 'PASS'; R5 = 'PASS'; R6 = 'PASS'; R7 = 'PASS'; R8 = 'PASS'; R9 = 'PROMOTION_ELIGIBLE'; R10 = 'PASS'; R11 = 'PASS'; R12 = 'PASS'; R13 = 'NO'; R14 = 'NO'
    }
  }
  $reviewDir = Join-Path $repo 'calibration\review\analytics-standard-rebuild-repeatability-rehearsal-v1'
  New-Item -ItemType Directory -Force -Path $reviewDir | Out-Null
  WriteJson (Join-Path $reviewDir 'result.json') $result 10
  WriteJson (Join-Path $repo 'governance\ANALYTICS_STANDARD_REBUILD_REPEATABILITY_REHEARSAL_V1.json') $result 10
  WriteJson (Join-Path $repo 'governance\ANALYTICS_STANDARD_REBUILD_REPEATABILITY_REHEARSAL_V1_QA.json') $result 10

  Write-Host ($result | ConvertTo-Json -Depth 10)
  Write-Host 'PASS_ANALYTICS_STANDARD_REBUILD_REPEATABILITY_REHEARSAL_V1'
} finally {
  Info 'Stopping isolated rehearsal runtime'
  try { docker compose -p $project -f $composePath --env-file $lockPath down --remove-orphans | Out-Host } catch { Write-Host $_.Exception.Message -ForegroundColor Yellow }
}
