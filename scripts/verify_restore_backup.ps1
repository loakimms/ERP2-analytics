<#
.SYNOPSIS
  백업 폴더(restore 산출물)만으로 복구가 가능한지 "격리 스택"으로 리허설 검증합니다.

.DESCRIPTION
  - 운영 중인 analytics_master(5188/5189/5442, analytics-master-* 컨테이너)를 건드리지 않기 위해,
    compose를 임시로 변형해 다른 프로젝트명/포트/컨테이너명/볼륨명으로 기동합니다.
  - images/docker-images.tar 로 이미지 로드
  - volumes/*.tgz 로 볼륨 복원
  - db/analytics.dump (우선) 또는 analytics.sql 로 DB 복원
  - web/version.json, api/health, api/version 증거 확인
  - 원하면 종료/정리까지 수행

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify_restore_backup.ps1 `
    -BackupDir "E:\ERP프로그램 백업\backup\analytics_master_20260210_112344"
#>

[CmdletBinding(PositionalBinding = $false)]
param(
  [Parameter(Mandatory = $true)][string] $BackupDir,

  # 격리 스택 식별자
  [Parameter(Mandatory = $false)][string] $VerifyProjectName = 'analytics_verify',

  # 호스트 포트(충돌 방지)
  [Parameter(Mandatory = $false)][int] $WebPort = 15188,
  [Parameter(Mandatory = $false)][int] $ApiPort = 15189,
  [Parameter(Mandatory = $false)][int] $DbPort = 15442,
  [Parameter(Mandatory = $false)][int] $ApiDebugPort = 19223,

  # 검증 후 정리
  [switch] $Cleanup
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host ('[INFO] ' + $m) -ForegroundColor Cyan }
function Write-Warn([string] $m) { Write-Host ('[WARN] ' + $m) -ForegroundColor Yellow }
function Fail([string] $m) { throw $m }

function Require-File([string] $p) {
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Fail ('파일을 찾을 수 없습니다: ' + $p) }
}

function Require-Dir([string] $p) {
  if (-not (Test-Path -LiteralPath $p -PathType Container)) { Fail ('폴더를 찾을 수 없습니다: ' + $p) }
}

function Docker-Ok() {
  & docker version *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'docker 엔진이 준비되지 않았습니다. Docker Desktop 실행 상태를 확인해주세요.' }
}

function Read-LockValue([string] $lockPath, [string] $key) {
  $line = (Select-String -LiteralPath $lockPath -Pattern ('^\s*' + [regex]::Escape($key) + '\s*=') | Select-Object -First 1).Line
  if (-not $line) { return '' }
  return (($line -split '=', 2)[1]).Trim()
}

function Ensure-Volume([string] $name) {
  $v = (& docker volume ls -q -f "name=^$name$" | Out-String).Trim()
  if (-not $v) { & docker volume create $name | Out-Null }
}

function Restore-VolumeFromTgz([string] $volName, [string] $tgzPath) {
  Ensure-Volume $volName
  Require-File $tgzPath
  $inDir = Split-Path -Parent $tgzPath
  $leaf = Split-Path -Leaf $tgzPath
  Write-Info ("Restore volume: {0} <- {1}" -f $volName, $leaf)
  & docker run --rm -v ($volName + ':/v') -v ($inDir + ':/in:ro') alpine:3.20 sh -lc ("rm -rf /v/* && tar -xzf /in/" + $leaf + " -C /v")
  if ($LASTEXITCODE -ne 0) { Fail ('볼륨 복원 실패: ' + $volName) }
}

function Wait-HttpOk([string] $url, [int] $timeoutSec = 60) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return $r }
    } catch {
      # ignore
    }
    Start-Sleep -Seconds 2
  }
  Fail ('HTTP OK 타임아웃: ' + $url)
}

function Replace-InText([string] $text, [string] $old, [string] $new) {
  return $text.Replace($old, $new)
}

function Write-ComposeForVerify([string] $srcCompose, [string] $destCompose, [hashtable] $rep) {
  $t = Get-Content -LiteralPath $srcCompose -Raw
  foreach ($k in $rep.Keys) {
    $t = Replace-InText $t $k $rep[$k]
  }
  $t | Set-Content -Encoding UTF8 -LiteralPath $destCompose
}

function Invoke-Compose([string[]] $ComposeArgs, [string] $composePath, [string] $lockPath) {
  if (-not $ComposeArgs -or $ComposeArgs.Count -lt 1) { Fail 'ComposeArgs가 비어 있습니다.' }
  & docker compose -p $VerifyProjectName -f $composePath --env-file $lockPath @ComposeArgs
  if ($LASTEXITCODE -ne 0) { Fail ('docker compose 실패: ' + ($ComposeArgs -join ' ')) }
}

function Cleanup-Verify([string] $composePath, [string] $lockPath, [string[]] $volsToRemove) {
  Write-Warn 'Cleanup: docker compose down'
  try { & docker compose -p $VerifyProjectName -f $composePath --env-file $lockPath down --remove-orphans | Out-Null } catch {}
  foreach ($v in $volsToRemove) {
    try { & docker volume rm -f $v | Out-Null } catch {}
  }
}

Docker-Ok

$backupFull = (Resolve-Path -LiteralPath $BackupDir).Path
Require-Dir $backupFull

$metaCompose = Join-Path $backupFull 'meta\docker-compose.yml'
$metaLock = Join-Path $backupFull 'meta\analytics.master.lock'
$imagesTar = Join-Path $backupFull 'images\docker-images.tar'
$volDir = Join-Path $backupFull 'volumes'
$dbDumpFc = Join-Path $backupFull 'db\analytics.dump'
$dbDumpSql = Join-Path $backupFull 'db\analytics.sql'

Require-File $metaCompose
Require-File $metaLock
Require-File $imagesTar
Require-Dir $volDir
if (-not (Test-Path -LiteralPath $dbDumpFc -PathType Leaf) -and -not (Test-Path -LiteralPath $dbDumpSql -PathType Leaf)) {
  Fail ('DB 덤프가 없습니다: ' + $dbDumpFc + ' / ' + $dbDumpSql)
}

$tag = Read-LockValue $metaLock 'ANALYTICS_IMAGE_TAG'
if ([string]::IsNullOrWhiteSpace($tag)) { Fail 'lock의 ANALYTICS_IMAGE_TAG가 비어 있습니다.' }

Write-Info ('BackupDir=' + $backupFull)
Write-Info ('VerifyProjectName=' + $VerifyProjectName)
Write-Info ('Ports web/api/db=' + $WebPort + '/' + $ApiPort + '/' + $DbPort)
Write-Info ('Lock tag=' + $tag)

# 이미 운영이 5188/5189/5442를 쓰고 있으니, 격리 포트로 compose를 변형해서 사용한다.
$tmpDir = Join-Path $backupFull '_verify_tmp'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$verifyCompose = Join-Path $tmpDir 'docker-compose.verify.yml'

# 컨테이너/볼륨/포트 치환(단순 Replace: meta compose 포맷이 고정이라는 전제)
$dbVol = ($VerifyProjectName + '_analytics-db-data')
$browserVol = ($VerifyProjectName + '_analytics-browser-data')

$rep = @{
  'name: analytics_master' = ('name: ' + $VerifyProjectName)
  'container_name: analytics-master-db' = ('container_name: ' + $VerifyProjectName + '-db')
  'container_name: analytics-master-api' = ('container_name: ' + $VerifyProjectName + '-api')
  'container_name: analytics-master-web' = ('container_name: ' + $VerifyProjectName + '-web')
  '"5442:5432"' = ('"' + $DbPort + ':5432"')
  '"5189:8000"' = ('"' + $ApiPort + ':8000"')
  '"5188:80"' = ('"' + $WebPort + ':80"')
  '"19222:9222"' = ('"' + $ApiDebugPort + ':9222"')
  'PW_DEBUG_HOST_PORT: "19222"' = ('PW_DEBUG_HOST_PORT: "' + $ApiDebugPort + '"')
  'analytics-master_analytics-db-data' = $dbVol
  'analytics-master_analytics-browser-data' = $browserVol
}

Write-Info ('Write verify compose -> ' + $verifyCompose)
Write-ComposeForVerify -srcCompose $metaCompose -destCompose $verifyCompose -rep $rep

$cleanupVols = @($dbVol, $browserVol)
try {
  # 1) images load
  Write-Info ('docker load: ' + $imagesTar)
  & docker load -i $imagesTar | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'docker load 실패' }

  # 2) volume restore (중요: DB 컨테이너 기동 전에 수행)
  $dbTgz = Join-Path $volDir 'analytics-master_analytics-db-data.tgz'
  $browserTgz = Join-Path $volDir 'analytics-master_analytics-browser-data.tgz'
  Restore-VolumeFromTgz -volName $dbVol -tgzPath $dbTgz
  Restore-VolumeFromTgz -volName $browserVol -tgzPath $browserTgz

  # 3) start DB
  Write-Info 'docker compose up (db)'
  Invoke-Compose -composePath $verifyCompose -lockPath $metaLock -ComposeArgs @('up', '-d', 'analytics-db', '--pull', 'never', '--remove-orphans')

  # 컨테이너 생성 여부 확인(실패인데 exit code가 0인 케이스 방지)
  $dbId = (& docker ps -aq -f ("name=^/" + $VerifyProjectName + "-db$") | Out-String).Trim()
  if (-not $dbId) { Fail 'verify DB 컨테이너가 생성되지 않았습니다.' }

  # wait db healthy (via healthcheck)
  Write-Info 'wait db healthy (max 60s)'
  for ($i = 0; $i -lt 30; $i++) {
    $st = ''
    try {
      $st = (& docker inspect -f '{{.State.Health.Status}}' ($VerifyProjectName + '-db') 2>$null | Out-String).Trim()
    } catch { $st = '' }
    if ($st -eq 'healthy') { break }
    Start-Sleep -Seconds 2
  }

  # 4) restore DB
  if (Test-Path -LiteralPath $dbDumpFc -PathType Leaf) {
    Write-Info 'restore DB (pg_restore -Fc)'
    & docker cp $dbDumpFc (($VerifyProjectName + '-db') + ':/tmp/analytics.dump')
    if ($LASTEXITCODE -ne 0) { Fail 'docker cp dump 실패' }
    & docker exec ($VerifyProjectName + '-db') sh -lc 'pg_restore -U analytics -d analytics --clean --if-exists /tmp/analytics.dump'
    if ($LASTEXITCODE -ne 0) { Fail 'pg_restore 실패' }
  } else {
    Write-Warn 'analytics.dump 없음 -> SQL import로 대체'
    cmd /c ("type """ + $dbDumpSql + """ | docker exec -i " + ($VerifyProjectName + '-db') + " psql -U analytics -d analytics -q")
    if ($LASTEXITCODE -ne 0) { Fail 'psql import 실패' }
  }

  # 5) start api/web
  Write-Info 'docker compose up (api/web)'
  Invoke-Compose -composePath $verifyCompose -lockPath $metaLock -ComposeArgs @('up', '-d', '--pull', 'never', '--remove-orphans', 'analytics-api', 'analytics-web')

  # 6) evidence
  $webVer = 'http://localhost:' + $WebPort + '/version.json'
  $apiHealth = 'http://localhost:' + $ApiPort + '/health'
  $apiVer = 'http://localhost:' + $ApiPort + '/api/version'

  Write-Info ('Evidence web: ' + $webVer)
  $w = Wait-HttpOk -url $webVer -timeoutSec 60
  Write-Info ('Evidence api health: ' + $apiHealth)
  Wait-HttpOk -url $apiHealth -timeoutSec 60 | Out-Null
  Write-Info ('Evidence api version: ' + $apiVer)
  $av = Wait-HttpOk -url $apiVer -timeoutSec 60

  Write-Info 'verify tag matches lock'
  try {
    $wj = $w.Content | ConvertFrom-Json
    if ([string]($wj.imageTag) -ne $tag) { Fail ("web imageTag mismatch: " + $wj.imageTag + " != " + $tag) }
  } catch { Fail ('web version.json 파싱 실패: ' + $_.Exception.Message) }
  try {
    $aj = $av.Content | ConvertFrom-Json
    if ([string]($aj.imageTag) -ne $tag) { Fail ("api imageTag mismatch: " + $aj.imageTag + " != " + $tag) }
  } catch { Fail ('api version 파싱 실패: ' + $_.Exception.Message) }

  # 7) minimal unit tests inside api container (auth/version only)
  Write-Info 'run minimal api tests in verify container'
  & docker exec ($VerifyProjectName + '-api') python -m unittest -q test_version_endpoint test_auth_middleware test_version_management test_firebase_auth_verify
  if ($LASTEXITCODE -ne 0) { Fail 'verify api unit tests failed' }

  Write-Info 'VERIFY_RESTORE_OK'
  Write-Output ('VERIFY_URL_WEB=' + 'http://localhost:' + $WebPort)
  Write-Output ('VERIFY_URL_API=' + 'http://localhost:' + $ApiPort)
} finally {
  if ($Cleanup) {
    Cleanup-Verify -composePath $verifyCompose -lockPath $metaLock -volsToRemove $cleanupVols
    Write-Info 'CLEANUP_OK'
  } else {
    Write-Warn 'Cleanup 미실행(요청하지 않음)'
  }
}

