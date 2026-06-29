<#
.SYNOPSIS
  analytics docker compose 스택(코드/데이터/로그/이미지) 전체 백업

.DESCRIPTION
  - 코드: Analytics 레포 루트(이 스크립트 위치) 전체 복사(대용량/재귀 폴더는 제외)
  - DB: analytics-db(Postgres)에서 pg_dump/pg_dumpall 결과 추출
  - 볼륨: analytics_analytics-db-data, analytics_analytics-browser-data 를 tar.gz로 보관
  - 로그/메타: docker logs, docker inspect, docker compose config/ls/ps 등 스냅샷 저장
  - 이미지: analytics-analytics-api/web 및 postgres:16-alpine 를 docker save 로 보관(옵션)

.EXAMPLE
  # 기본(모두 백업)
  powershell -NoProfile -ExecutionPolicy Bypass -File .\analytics\backup-analytics.ps1

.EXAMPLE
  # 이미지 백업은 스킵
  powershell -NoProfile -ExecutionPolicy Bypass -File .\analytics\backup-analytics.ps1 -SkipImages
#>

[CmdletBinding(PositionalBinding = $false)]
param(
  # 표준 스택(되돌림 방지): analytics_master
  [Parameter(Mandatory = $false)][string] $ProjectName = 'analytics_master',
  [Parameter(Mandatory = $false)][string] $ComposeFile = '',
  [Parameter(Mandatory = $false)][string] $OutputRoot = '',

  [switch] $SkipCode,
  [switch] $SkipDbDump,
  [switch] $SkipVolumes,
  [switch] $SkipLogs,
  [switch] $SkipImages
)

$ErrorActionPreference = 'Stop'

function Get-ScriptDir {
  $p = $PSCommandPath
  if ([string]::IsNullOrWhiteSpace($p)) { $p = $MyInvocation.MyCommand.Path }
  if ([string]::IsNullOrWhiteSpace($p)) { throw '스크립트 경로를 확인할 수 없습니다.' }
  return (Split-Path -Parent $p)
}

function Invoke-External([string] $Exe, [string[]] $ArgList) {
  Write-Host ("[RUN] {0} {1}" -f $Exe, ($ArgList -join ' ')) -ForegroundColor DarkGray
  & $Exe @ArgList
  if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Exe $($ArgList -join ' ')" }
}

function Invoke-CmdLine([string] $CommandLine) {
  # cmd.exe로 실행하면 native stderr가 PowerShell 오류 레코드로 승격되는 문제를 피하면서
  # 파일 리다이렉션(> 2>&1)을 안전하게 사용할 수 있다.
  Invoke-External 'cmd.exe' @('/c', $CommandLine)
}

function New-Dir([string] $Path) {
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Write-Utf8([string] $Path, [string] $Content) {
  $Content | Out-File -FilePath $Path -Encoding utf8
}

function Resolve-FullPath([string] $Path) {
  if (Test-Path -Path $Path) { return (Resolve-Path -Path $Path).Path }
  return [System.IO.Path]::GetFullPath($Path)
}

function Require-File([string] $Path) {
  if (-not (Test-Path -Path $Path -PathType Leaf)) { throw "파일을 찾을 수 없습니다: $Path" }
}

function Require-Command([string] $Exe) {
  $cmd = Get-Command $Exe -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "필수 명령을 찾을 수 없습니다: $Exe (PATH 확인 필요)" }
}

$_scriptDir = Get-ScriptDir
if ([string]::IsNullOrWhiteSpace($ComposeFile)) { $ComposeFile = (Join-Path $_scriptDir 'docker\analytics.master.yml') }
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  # 이 스크립트는 Analytics 레포 루트에 위치한다.
  # 완전 백업은 _backups_full로 분리(운영의 tag 백업(_backups)과 목적이 다름)
  $OutputRoot = (Join-Path $_scriptDir '_backups_full')
}

Require-Command 'docker'
Require-File $ComposeFile

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outputRootFull = Resolve-FullPath $OutputRoot
New-Dir $outputRootFull

$backupDir = Join-Path $outputRootFull ("{0}_{1}" -f $ProjectName, $timestamp)
$paths = @{
  root    = $backupDir
  code    = (Join-Path $backupDir 'code')
  db      = (Join-Path $backupDir 'db')
  volumes = (Join-Path $backupDir 'volumes')
  logs    = (Join-Path $backupDir 'logs')
  meta    = (Join-Path $backupDir 'meta')
  images  = (Join-Path $backupDir 'images')
}

foreach ($p in $paths.Values) { New-Dir $p }

Write-Host ("백업 시작: {0}" -f $backupDir) -ForegroundColor Cyan
Write-Host ("Compose: {0}" -f (Resolve-FullPath $ComposeFile)) -ForegroundColor Cyan

# 표준 스택(container_name/volume_name 고정값)
$containers = @('analytics-master-db', 'analytics-master-api', 'analytics-master-web')
$volumeNames = @('analytics-master_analytics-db-data', 'analytics-master_analytics-browser-data')

function Read-LockTag([string] $LockPath) {
  try {
    if (-not (Test-Path -LiteralPath $LockPath)) { return '' }
    $line = (Select-String -LiteralPath $LockPath -Pattern '^\s*ANALYTICS_IMAGE_TAG\s*=' | Select-Object -First 1).Line
    if (-not $line) { return '' }
    return (($line -split '=', 2)[1]).Trim()
  } catch { return '' }
}

$lockPath = (Join-Path $_scriptDir 'docker\analytics.master.lock')
$tag = Read-LockTag $lockPath
if ([string]::IsNullOrWhiteSpace($tag)) { $tag = 'latest' }
$imageNames = @(("analytics-analytics-api:{0}" -f $tag), ("analytics-analytics-web:{0}" -f $tag), 'postgres:16-alpine')

function Quote-Arg([string] $Arg) {
  if ($null -eq $Arg) { return '""' }
  if ($Arg -match '[\s"]') { return '"' + ($Arg -replace '"', '\"') + '"' }
  return $Arg
}

function Safe-ExecText([string[]] $DockerArgs) {
  # PowerShell에서 native stderr가 NativeCommandError로 승격되어 중단되는 경우가 있어,
  # Process로 stdout/stderr를 "문자열"로 안전하게 수집한다.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'docker'
  $psi.Arguments = (($DockerArgs | ForEach-Object { Quote-Arg $_ }) -join ' ')
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi

  [void] $p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit() | Out-Null

  if ([string]::IsNullOrEmpty($stderr)) { return $stdout }
  if ([string]::IsNullOrEmpty($stdout)) { return $stderr }
  return ($stdout.TrimEnd() + "`n" + $stderr)
}

function Container-Exists([string] $Name) {
  $id = (& docker ps -aq -f "name=^/$Name$" | Out-String).Trim()
  return -not [string]::IsNullOrWhiteSpace($id)
}

function Get-ContainerId([string] $Name) {
  return (& docker ps -aq -f "name=^/$Name$" | Out-String).Trim()
}

function Compose-Cmd([string[]] $ComposeArgs) {
  $base = @('compose', '-p', $ProjectName, '-f', (Resolve-FullPath $ComposeFile))
  return Safe-ExecText ($base + $ComposeArgs)
}

function Save-TextSnapshot([string] $RelPath, [string[]] $DockerArgs) {
  $p = Join-Path $paths.meta $RelPath
  $txt = Safe-ExecText $DockerArgs
  Write-Utf8 $p $txt
}

function Save-ComposeSnapshot([string] $RelPath, [string[]] $ComposeArgs) {
  $p = Join-Path $paths.meta $RelPath
  $txt = Compose-Cmd $ComposeArgs
  Write-Utf8 $p $txt
}

function Write-RestoreScript {
  $p = Join-Path $backupDir 'restore.ps1'
  $composeLeaf = 'meta\\docker-compose.yml'
  $lockLeaf = 'meta\\analytics.master.lock'
  $imagesTarLeaf = 'images\\docker-images.tar'
  $dbDumpLeaf = 'db\\analytics.dump'
  $volDirLeaf = 'volumes'

  $content = @'
param(
  [switch] $Force,
  [switch] $SkipImages,
  [switch] $SkipVolumes,
  [switch] $SkipDbRestore
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host ("[INFO] " + $m) -ForegroundColor Cyan }
function Write-Warn([string] $m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }
function Assert-LastExitOk([string] $what) { if ($LASTEXITCODE -ne 0) { throw ($what + " failed (exit=" + $LASTEXITCODE + ")") } }

$here = Split-Path -Parent $PSCommandPath
$compose = Join-Path $here "__COMPOSE_LEAF__"
$lock = Join-Path $here "__LOCK_LEAF__"
$imagesTar = Join-Path $here "__IMAGES_TAR_LEAF__"
$dbDump = Join-Path $here "__DB_DUMP_LEAF__"
$volDir = Join-Path $here "__VOL_DIR_LEAF__"

Write-Info ("compose=" + $compose)
Write-Info ("lock=" + $lock)
Write-Info ("project=analytics_master")

if (-not $Force) {
  $existing = (& docker ps -aq -f "name=analytics-master-" | Out-String).Trim()
  if ($existing) {
    throw "이미 analytics_master 컨테이너가 존재합니다. 중단합니다. (삭제/덮어쓰기 원하면 -Force)"
  }
}

if (-not $SkipImages) {
  if (-not (Test-Path -LiteralPath $imagesTar)) { throw ("images tar missing: " + $imagesTar) }
  Write-Info ("docker load: " + $imagesTar)
  docker load -i $imagesTar
  Assert-LastExitOk "docker load"
} else {
  Write-Warn "SkipImages enabled"
}

# (중요) 볼륨 복원은 DB 컨테이너가 떠 있기 전에 수행해야 데이터 손상이 없다.
if (-not $SkipVolumes) {
  if (-not (Test-Path -LiteralPath $volDir)) { throw ("volumes dir missing: " + $volDir) }

  # volume restore helper: create volume if missing, then extract tgz
  function Ensure-Volume([string] $name) {
    $v = (& docker volume ls -q -f "name=^$name$" | Out-String).Trim()
    if (-not $v) { & docker volume create $name | Out-Null }
  }

  function Restore-VolumeFromTgz([string] $volName, [string] $tgzPath) {
    Ensure-Volume $volName
    if (-not (Test-Path -LiteralPath $tgzPath)) { throw ("volume tgz missing: " + $tgzPath) }
    $leaf = Split-Path -Leaf $tgzPath
    Write-Info ("restore volume " + $volName + " <- " + $leaf)
    # /backup에는 volumes 폴더가 그대로 마운트됨
    & docker run --rm -v "${volName}:/volume" -v "${volDir}:/backup" alpine:3.20 sh -lc ("rm -rf /volume/* && tar -xzf /backup/" + $leaf + " -C /volume")
    Assert-LastExitOk "restore volume"
  }

  Restore-VolumeFromTgz -volName "analytics-master_analytics-db-data" -tgzPath (Join-Path $volDir "analytics-master_analytics-db-data.tgz")
  Restore-VolumeFromTgz -volName "analytics-master_analytics-browser-data" -tgzPath (Join-Path $volDir "analytics-master_analytics-browser-data.tgz")
} else {
  Write-Warn "SkipVolumes enabled"
}

Write-Info "docker compose up (db)"
docker compose -p analytics_master -f $compose --env-file $lock up -d analytics-db --pull never --remove-orphans
Assert-LastExitOk "docker compose up (db)"

Write-Info "wait db healthy (max 60s)"
for ($i=1; $i -le 30; $i++) {
  $st = ""
  try { $st = (docker inspect -f "{{.State.Health.Status}}" analytics-master-db 2>$null | Out-String).Trim() } catch { $st = "" }
  if ($st -match "healthy") { break }
  Start-Sleep -Seconds 2
}

Write-Info "docker compose up (api/web)"
docker compose -p analytics_master -f $compose --env-file $lock up -d --no-deps --force-recreate analytics-api analytics-web --pull never --remove-orphans
Assert-LastExitOk "docker compose up (api/web)"

if (-not $SkipDbRestore) {
  if (Test-Path -LiteralPath $dbDump) {
    Write-Info "restore DB from analytics.dump (pg_restore -Fc)"
    & docker cp $dbDump "analytics-master-db:/tmp/analytics.dump"
    Assert-LastExitOk "docker cp db dump"
    & docker exec analytics-master-db sh -lc "pg_restore -U analytics -d analytics --clean --if-exists /tmp/analytics.dump"
    Assert-LastExitOk "pg_restore"
  } else {
    Write-Warn ("db dump not found, skip: " + $dbDump)
  }
} else {
  Write-Warn "SkipDbRestore enabled"
}

Write-Info "RESTORE_OK"
'@

  $content = $content.Replace('__COMPOSE_LEAF__', $composeLeaf)
  $content = $content.Replace('__LOCK_LEAF__', $lockLeaf)
  $content = $content.Replace('__IMAGES_TAR_LEAF__', $imagesTarLeaf)
  $content = $content.Replace('__DB_DUMP_LEAF__', $dbDumpLeaf)
  $content = $content.Replace('__VOL_DIR_LEAF__', $volDirLeaf)
  $content | Set-Content -Encoding UTF8 -LiteralPath $p
}

# ----- meta snapshots -----
Save-TextSnapshot 'docker_version.txt' @('version')
Save-TextSnapshot 'docker_ps_all.txt' @('ps', '-a', '--no-trunc')
Save-TextSnapshot 'docker_volume_ls.txt' @('volume', 'ls')
Save-ComposeSnapshot 'compose_ls.txt' @('ls')
Save-ComposeSnapshot 'compose_ps.txt' @('ps')
Save-ComposeSnapshot 'compose_config.txt' @('config')

# compose 원본도 보관
Copy-Item -Force -Path (Resolve-FullPath $ComposeFile) -Destination (Join-Path $paths.meta 'docker-compose.yml')

# lock(단일 진실)도 보관: restore 시 --env-file 로 사용
$lockSource = (Join-Path $_scriptDir 'docker\analytics.master.lock')
if (Test-Path -LiteralPath $lockSource) {
  Copy-Item -Force -LiteralPath $lockSource -Destination (Join-Path $paths.meta 'analytics.master.lock')
}

# ----- code backup -----
if (-not $SkipCode) {
  $src = Resolve-FullPath $_scriptDir
  $dst = Join-Path $paths.code 'analytics'
  New-Dir $dst

  # robocopy는 exit code가 0이 아니어도 "정상(복사됨)" 코드가 존재함(0~7 정상 취급)
  # (중요) 백업 산출물(_backups_full/_backups)과 node_modules 같은 대용량 폴더를 제외하지 않으면
  # 백업이 자기 자신을 또 백업하는 "무한 중첩"이 발생해 디스크가 순식간에 가득 찰 수 있다.
  $excludeDirs = @(
    (Join-Path $src '_backups_full'),
    (Join-Path $src '_backups'),
    (Join-Path $src '.git'),
    (Join-Path $src 'web\node_modules'),
    (Join-Path $src 'web\dist'),
    (Join-Path $src 'web\.vite'),
    (Join-Path $src 'api\__pycache__'),
    (Join-Path $src 'api\.pytest_cache'),
    (Join-Path $src '.venv'),
    (Join-Path $src 'venv')
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }

  $args = @(
    $src,
    $dst,
    '/E',
    '/COPY:DAT',
    '/R:2',
    '/W:1',
    # junction/심볼릭 링크를 따라가면 의도치 않은 대용량 폴더를 끌어올 수 있어 제외
    '/XJ',
    '/NFL',
    '/NDL',
    '/NP'
  )
  if ($excludeDirs.Count -gt 0) {
    $args += '/XD'
    $args += $excludeDirs
  }
  Write-Host ("[RUN] robocopy {0}" -f ($args -join ' ')) -ForegroundColor DarkGray
  & robocopy @args | Out-Null
  $rc = $LASTEXITCODE
  if ($rc -gt 7) { throw "robocopy 실패(exit=$rc)" }
}

# ----- container logs + inspect -----
if (-not $SkipLogs) {
  Write-Host '[STEP] container logs + inspect' -ForegroundColor Cyan
  foreach ($c in $containers) {
    if (-not (Container-Exists $c)) {
      Write-Host ("[WARN] 컨테이너 없음: {0}" -f $c) -ForegroundColor Yellow
      continue
    }
    $logPath = Join-Path $paths.logs ("{0}.log.txt" -f $c)
    $inspectPath = Join-Path $paths.meta ("{0}.inspect.json" -f $c)

    Invoke-CmdLine ('docker logs --timestamps --details {0} > "{1}" 2>&1' -f $c, $logPath)
    Invoke-CmdLine ('docker inspect {0} > "{1}" 2>&1' -f $c, $inspectPath)
  }
}

# ----- DB dump -----
if (-not $SkipDbDump) {
  Write-Host '[STEP] postgres dumps' -ForegroundColor Cyan
  if (-not (Container-Exists 'analytics-master-db')) { throw "analytics-master-db 컨테이너를 찾지 못했습니다." }

  $dbDumpFcHost = Join-Path $paths.db 'analytics.dump'
  $dbDumpSqlHost = Join-Path $paths.db 'analytics.sql'
  $globalsSqlHost = Join-Path $paths.db 'globals.sql'

  # 1) custom format dump (권장)
  Invoke-External 'docker' @('exec', 'analytics-master-db', 'sh', '-lc', 'pg_dump -U analytics -d analytics -Fc -f /tmp/analytics.dump')
  Invoke-External 'docker' @('cp', 'analytics-master-db:/tmp/analytics.dump', $dbDumpFcHost)

  # 2) plain sql (가독/긴급복구 용)
  Invoke-External 'docker' @('exec', 'analytics-master-db', 'sh', '-lc', 'pg_dump -U analytics -d analytics --no-owner --no-privileges > /tmp/analytics.sql')
  Invoke-External 'docker' @('cp', 'analytics-master-db:/tmp/analytics.sql', $dbDumpSqlHost)

  # 3) globals(roles/grants 등)
  Invoke-External 'docker' @('exec', 'analytics-master-db', 'sh', '-lc', 'pg_dumpall -U analytics --globals-only > /tmp/globals.sql')
  Invoke-External 'docker' @('cp', 'analytics-master-db:/tmp/globals.sql', $globalsSqlHost)

  # cleanup (실패해도 백업은 유지)
  try { & docker exec analytics-master-db sh -lc 'rm -f /tmp/analytics.dump /tmp/analytics.sql /tmp/globals.sql' | Out-Null } catch {}
}

# ----- volumes (raw tar) -----
if (-not $SkipVolumes) {
  Write-Host '[STEP] docker volumes tar' -ForegroundColor Cyan
  foreach ($v in $volumeNames) {
    $tgz = Join-Path $paths.volumes ("{0}.tgz" -f $v)
    Write-Host ("[RUN] volume tar: {0}" -f $v) -ForegroundColor DarkGray

    # alpine 내부에서 tar 생성. (볼륨은 /volume, 출력은 /backup)
    Invoke-External 'docker' @(
      'run', '--rm',
      '-v', "${v}:/volume:ro",
      '-v', "$(Resolve-FullPath $paths.volumes):/backup",
      'alpine:3.20',
      'sh', '-lc',
      "cd /volume && tar -czf /backup/$([IO.Path]::GetFileName($tgz)) ."
    )
  }
}

# ----- images (docker save) -----
if (-not $SkipImages) {
  Write-Host '[STEP] docker images save' -ForegroundColor Cyan
  $imgTar = Join-Path $paths.images 'docker-images.tar'
  Invoke-External 'docker' (@('save') + $imageNames + @('-o', $imgTar))
  Write-Utf8 (Join-Path $paths.images 'images.txt') ((& docker image ls --no-trunc | Out-String))
}

# ----- manifest -----
$manifest = @()
$manifest += "project=$ProjectName"
$manifest += "timestamp=$timestamp"
$manifest += "compose=$(Resolve-FullPath $ComposeFile)"
$manifest += "containers=$($containers -join ',')"
$manifest += "volumes=$($volumeNames -join ',')"
$manifest += "images=$($imageNames -join ',')"
$manifest += "backup_dir=$backupDir"

Write-Utf8 (Join-Path $paths.meta 'manifest.txt') ($manifest -join "`n")

Write-RestoreScript

Write-Host "백업 완료" -ForegroundColor Green
Write-Host ("- 경로: {0}" -f $backupDir) -ForegroundColor Green
