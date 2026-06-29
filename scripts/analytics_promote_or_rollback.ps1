param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('PASS','FAIL')]
  [string] $Result,

  [ValidateSet('local')]
  [string] $Target = 'local',

  # (변경) 자동 저장/자동 백업은 비활성화됨.
  # - 코드 수정/검증 루프에서 디스크/시간을 소모하지 않기 위해,
  #   PASS 승격 시점의 docker save(이미지 tar) 자동 생성을 제거했다.
  # - 필요 시 별도의 수동 백업(backup-analytics.ps1 등)만 사용한다.
  [string] $BackupDir = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }
function Write-Warn([string] $msg) { Write-Host ("[WARN] " + $msg) -ForegroundColor Yellow }
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

function Read-LockTag([string] $LockPath) {
  if (-not (Test-Path -LiteralPath $LockPath)) { throw ("lock file missing: " + $LockPath) }
  $line = Get-Content -LiteralPath $LockPath -Encoding utf8 | Where-Object { ($_ -match '^\s*ANALYTICS_IMAGE_TAG\s*=') } | Select-Object -First 1
  if (-not $line) { throw ("ANALYTICS_IMAGE_TAG missing in lock: " + $LockPath) }
  return (($line -split '=', 2)[1]).Trim()
}

function Read-LockValue([string] $LockPath, [string] $Key) {
  if (-not (Test-Path -LiteralPath $LockPath)) { throw ("lock file missing: " + $LockPath) }
  $line = Get-Content -LiteralPath $LockPath -Encoding utf8 | Where-Object { ($_ -match ('^\s*' + [regex]::Escape($Key) + '\s*=')) } | Select-Object -First 1
  if (-not $line) { return '' }
  return (($line -split '=', 2)[1]).Trim()
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

function Normalize-FilePart([string] $s) {
  if (-not $s) { return '' }
  $out = $s
  foreach ($ch in @('\', '/', ':', '*', '?', '"', '<', '>', '|')) { $out = $out.Replace($ch, '_') }
  return $out.Trim()
}

function Save-DockerImagesWithProgress([string] $TarPath, [string[]] $Images) {
  if (-not $TarPath) { throw 'Save-DockerImagesWithProgress: TarPath is required' }
  if (-not $Images -or $Images.Count -eq 0) { throw 'Save-DockerImagesWithProgress: Images are required' }

  $args = @('save', '-o', $TarPath) + $Images
  $proc = Start-Process -FilePath 'docker' -ArgumentList $args -NoNewWindow -PassThru

  $lastMb = -1
  $start = Get-Date
  while (-not $proc.HasExited) {
    $mb = 0
    try {
      if (Test-Path -LiteralPath $TarPath) {
        $mb = [int]([math]::Round(((Get-Item -LiteralPath $TarPath).Length / 1MB), 0))
      }
    } catch {
      $mb = 0
    }

    if ($mb -ne $lastMb) {
      $elapsed = [int]((New-TimeSpan -Start $start -End (Get-Date)).TotalSeconds)
      Write-Info ("Backup: docker save running... " + $mb + "MB (" + $elapsed + "s)")
      $lastMb = $mb
    }

    Start-Sleep -Seconds 3
    try { $proc.Refresh() } catch { }
  }

  if ($proc.ExitCode -ne 0) {
    throw ("docker save failed (exit=" + $proc.ExitCode + ")")
  }
}

function Write-RestoreScript([string] $BackupDir, [string] $ImagesTar, [string] $ComposeFileLeaf, [string] $LockFileLeaf, [string] $ProjectName) {
  $p = Join-Path $BackupDir 'restore.ps1'
  # NOTE: single-quoted here-string(@' '@)을 사용해 $변수 인터폴레이션을 차단한다.
  $content = @'
param(
  [string] $ProjectName = "__PROJECT_NAME__"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host ("[INFO] " + $m) -ForegroundColor Cyan }
function Assert-LastExitOk([string] $what) { if ($LASTEXITCODE -ne 0) { throw ($what + " failed (exit=" + $LASTEXITCODE + ")") } }

$here = Split-Path -Parent $PSCommandPath
$imagesTar = Join-Path $here "__IMAGES_TAR__"
$composeFile = Join-Path $here "__COMPOSE_FILE__"
$lockFile = Join-Path $here "__LOCK_FILE__"

function Read-Tag([string] $LockPath) {
  try {
    $line = (Select-String -LiteralPath $LockPath -Pattern "^ANALYTICS_IMAGE_TAG=" | Select-Object -First 1).Line
    if (-not $line) { return "" }
    return (($line -split "=",2)[1]).Trim()
  } catch { return "" }
}

Write-Info ("docker load: " + $imagesTar)
$tag = Read-Tag $lockFile
if ($tag) { Write-Info ("lock tag=" + $tag) }

$p = Start-Process -FilePath "docker" -ArgumentList @("load","-i",$imagesTar) -NoNewWindow -PassThru
$start = Get-Date
$lastDetected = $false
while (-not $p.HasExited) {
  $elapsed = [int]((New-TimeSpan -Start $start -End (Get-Date)).TotalSeconds)
  if ($tag) {
    $detected = $false
    try { docker image inspect ("analytics-analytics-web:" + $tag) 1>$null 2>$null; if ($LASTEXITCODE -eq 0) { $detected = $true } } catch { }
    try { docker image inspect ("analytics-analytics-api:" + $tag) 1>$null 2>$null; if ($LASTEXITCODE -eq 0) { $detected = $detected -and $true } } catch { }
    if ($detected -and -not $lastDetected) {
      Write-Info ("docker load in progress... images detected (" + $elapsed + "s)")
      $lastDetected = $true
    } elseif (-not $detected -and ($elapsed % 15 -eq 0)) {
      Write-Info ("docker load in progress... (" + $elapsed + "s)")
    }
  } else {
    if ($elapsed % 15 -eq 0) { Write-Info ("docker load in progress... (" + $elapsed + "s)") }
  }

  Start-Sleep -Seconds 3
  try { $p.Refresh() } catch { }
}
if ($p.ExitCode -ne 0) { throw ("docker load failed (exit=" + $p.ExitCode + ")") }

Write-Info "docker compose up (db)"
docker compose -p $ProjectName -f $composeFile --env-file $lockFile up -d analytics-db --pull never --remove-orphans
Assert-LastExitOk "docker compose up (db)"

Write-Info "docker compose up (web/api)"
docker compose -p $ProjectName -f $composeFile --env-file $lockFile up -d --no-deps --force-recreate analytics-web analytics-api --pull never --remove-orphans
Assert-LastExitOk "docker compose up (web/api)"

Write-Info "RESTORE_OK"
'@
  $content = $content.Replace('__PROJECT_NAME__', $ProjectName)
  $content = $content.Replace('__IMAGES_TAR__', $ImagesTar)
  $content = $content.Replace('__COMPOSE_FILE__', $ComposeFileLeaf)
  $content = $content.Replace('__LOCK_FILE__', $LockFileLeaf)
  $content | Set-Content -Encoding UTF8 -LiteralPath $p
}

function Backup-AnalyticsImages([string] $Tag, [string] $OutRoot, [string] $ComposeFilePath, [string] $LockFilePath, [string] $ProjectName) {
  if (-not $Tag) { throw 'Backup-AnalyticsImages: Tag is required' }
  if (-not $OutRoot) { throw 'Backup-AnalyticsImages: OutRoot is required' }

  New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null
  $safeTag = Normalize-FilePart $Tag
  $safeTarget = Normalize-FilePart $Target
  $dir = Join-Path $OutRoot (Join-Path $safeTarget $safeTag)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  $webImage = ("analytics-analytics-web:" + $Tag)
  $apiImage = ("analytics-analytics-api:" + $Tag)

  $tarLeaf = ("analytics_images_" + $safeTag + ".tar")
  $tarPath = Join-Path $dir $tarLeaf
  $manifestPath = Join-Path $dir "manifest.json"

  $shouldSave = $true
  if (-not $ForceBackup) {
    try {
      if (Test-Path -LiteralPath $tarPath) {
        $len = (Get-Item -LiteralPath $tarPath).Length
        # 50MB 이상이면 "이미지 tar가 존재"로 간주(반복 실행 최적화)
        if ($len -ge (50MB)) { $shouldSave = $false }
      }
    } catch {
      $shouldSave = $true
    }
  }

  if ($shouldSave) {
    Write-Info ("Backup: docker save -> " + $tarPath)
    Save-DockerImagesWithProgress -TarPath $tarPath -Images @($webImage, $apiImage)
  } else {
    Write-Info ("Backup: existing tar found, skip docker save (use -ForceBackup to re-save) -> " + $tarPath)
  }

  $savedAt = (Get-Date).ToString('s')
  $webInspect = $null
  $apiInspect = $null
  try { $webInspect = (docker image inspect $webImage | ConvertFrom-Json) } catch { $webInspect = $null }
  try { $apiInspect = (docker image inspect $apiImage | ConvertFrom-Json) } catch { $apiInspect = $null }

  $manifest = @{
    kind = 'analytics_image_backup'
    savedAt = $savedAt
    target = $Target
    tag = $Tag
    buildTime = $script:BuildTime
    gitSha = $script:GitSha
    images = @(
      @{ name = $webImage; inspect = $webInspect }
      @{ name = $apiImage; inspect = $apiInspect }
    )
    composeFile = $ComposeFilePath
    lockFile = $LockFilePath
  }
  ($manifest | ConvertTo-Json -Depth 20) | Set-Content -Encoding UTF8 -LiteralPath $manifestPath

  # 복구에 필요한 최소 파일(동봉)
  $composeLeaf = Split-Path -Leaf $ComposeFilePath
  $lockLeaf = Split-Path -Leaf $LockFilePath
  Copy-Item -Force -LiteralPath $ComposeFilePath -Destination (Join-Path $dir $composeLeaf)
  Copy-Item -Force -LiteralPath $LockFilePath -Destination (Join-Path $dir $lockLeaf)

  Write-RestoreScript -BackupDir $dir -ImagesTar $tarLeaf -ComposeFileLeaf $composeLeaf -LockFileLeaf $lockLeaf -ProjectName $ProjectName

  Write-Info ("Backup: manifest -> " + $manifestPath)
  Write-Info ("Backup: restore.ps1 -> " + (Join-Path $dir 'restore.ps1'))
  Write-Info ("Backup: DONE -> " + $dir)
}

$repoRoot = Get-RepoRoot
Set-Location -Path $repoRoot | Out-Null
Assert-CanonicalRoot -RepoRoot $repoRoot

$projectName = 'analytics_master'
$composeFile = 'docker\\analytics.master.yml'
$masterLock = 'docker\\analytics.master.lock'
$candidateLock = 'docker\\analytics.candidate.lock'
$envLocal = Join-Path $repoRoot 'docker\\env.analytics.local'

# Firebase Admin SDK env (전체 사용자 목록용)
$firebaseAdminCandidates = @(
  (Join-Path $repoRoot 'docker\\env.firebase.admin.local'),
  (Join-Path $repoRoot 'env.firebase-admin.local'),
  'C:\dev\ERP2-dev\env.firebase-admin.local',
  'C:\dev\ERP2-dev\docker\.env.api.local'
)
$firebaseAdminEnv = $null
foreach ($p in $firebaseAdminCandidates) {
  if ($p -and (Test-Path -LiteralPath $p)) { $firebaseAdminEnv = $p; break }
}

# 로컬 env: ADMIN_TEST_MODE 등 / Firebase Admin
$envFileArgs = @('--env-file', $masterLock)
if (Test-Path -LiteralPath $envLocal) { $envFileArgs += '--env-file', $envLocal }
if ($firebaseAdminEnv) { $envFileArgs += '--env-file', $firebaseAdminEnv }

if ([string]::IsNullOrWhiteSpace($BackupDir)) { $BackupDir = (Join-Path $repoRoot '_backups') }

if ($Result -eq 'PASS') {
  $tag = Read-LockTag $candidateLock
  Write-Info ("PROMOTE candidate -> master (tag=" + $tag + ")")
  $script:BuildTime = Read-LockValue $candidateLock 'ANALYTICS_BUILD_TIME'
  $script:GitSha = Read-LockValue $candidateLock 'ANALYTICS_GIT_SHA'
  $firebaseProjectId = Read-LockValue $candidateLock 'FIREBASE_PROJECT_ID'
  Update-LockTag -LockPath $masterLock -Tag $tag -BuildTime $script:BuildTime -GitSha $script:GitSha -FirebaseProjectId $firebaseProjectId

  # NAS-mode(local docker simulation)도 동일 태그로 수집/검증할 수 있도록 master lock을 동기화한다.
  # - 로컬(master) 스택 동작에는 영향 없음 (analytics_nas는 별도 compose/포트 사용)
  try {
    $nasMasterLock = 'docker\\analytics.nas.master.lock'
    Copy-Item -Force -LiteralPath $masterLock -Destination $nasMasterLock
    Write-Info ("NAS lock synced from master: " + $nasMasterLock)
  } catch {
    Write-Warn ("NAS lock sync skipped: " + $_.Exception.Message)
  }

  Write-Info 'Ensure: analytics-db up (do NOT recreate)'
  docker compose -p $projectName -f $composeFile @envFileArgs up -d analytics-db --pull never --remove-orphans
  Assert-LastExitOk 'docker compose up (db)'

  docker compose -p $projectName -f $composeFile @envFileArgs up -d --no-deps --force-recreate analytics-web analytics-api --pull never --remove-orphans
  Assert-LastExitOk 'docker compose up (promote web/api)'

  Write-Info 'Auto backup disabled: skip docker save/manifest/restore generation'

  Write-Info 'Done.'
  exit 0
}

# FAIL: rollback to master.lock
$tag = Read-LockTag $masterLock
Write-Warn ("ROLLBACK to master (tag=" + $tag + ")")
Write-Info 'Ensure: analytics-db up (do NOT recreate)'
docker compose -p $projectName -f $composeFile @envFileArgs up -d analytics-db --pull never --remove-orphans
Assert-LastExitOk 'docker compose up (db)'

docker compose -p $projectName -f $composeFile @envFileArgs up -d --no-deps --force-recreate analytics-web analytics-api --pull never --remove-orphans
Assert-LastExitOk 'docker compose up (rollback web/api)'
Write-Info 'Done.'
exit 0

