<#
.SYNOPSIS
  Analytics 이미지: 로컬에서 생성(save) → NAS로 복사 → NAS에서 load → 재기동 → 검증

.DESCRIPTION
  룰: NAS에서는 빌드하지 않음. 로컬 master lock 태그 기준으로 이미지 tar 생성 후 NAS에 반영.
  NAS 접근: ssh -o BatchMode=yes admin2@192.168.0.50 (키 인증 필요, 비밀번호 불필요).
  - docker/analytics.master.lock 태그로 docker save
  - docker/analytics.nas.master.lock 을 master와 동일 태그로 갱신
  - SSH(scp)로 tar + nas lock 복사
  - SSH로 NAS에서 docker load → compose up (web/api) → 검증

.EXAMPLE
  pwsh -NoProfile -File .\scripts\deploy-analytics-nas.ps1
#>
param(
  # NAS 접근: ssh -o BatchMode=yes admin2@192.168.0.50
  [string] $NasHost = '192.168.0.50',
  [string] $NasUser = 'admin2',
  [string] $NasPath = '/volume1/projects/ERP2-Dev/ERP2-analytics',
  # 동일 태그로 반복 실행 시, 기존 tar가 충분히 크면 docker save를 생략한다.
  [switch] $ForceSave
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Step([string] $m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Assert-Ok([string] $what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit=$LASTEXITCODE)" } }
function Assert-RemotePathExists([string] $Path, [string] $Label) {
  if (-not $Path) { throw "Remote path is empty: $Label" }
}
function Get-TextMatch([string] $Path, [string] $Pattern, [string] $Label) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Missing file for ${Label}: $Path" }
  $text = Get-Content -LiteralPath $Path -Raw
  $m = [regex]::Match($text, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
  if (-not $m.Success) { throw "Could not parse $Label from $Path" }
  return [string]$m.Groups[1].Value
}
function Get-ExpectedHostAgentRelease([string] $RepoRoot) {
  $uiPath = Join-Path $RepoRoot 'web\src\modules\hostAgentRelease.ts'
  $agentPath = Join-Path $RepoRoot 'tools\host-agent.ps1'
  $installerPath = Join-Path $RepoRoot 'web\public\nas\Install-Analytics-HostAgent.ps1'
  $uiVersion = Get-TextMatch $uiPath 'REQUIRED_HOST_AGENT_VERSION\s*=\s*[''"]([^''"]+)[''"]' 'UI required host agent version'
  $uiManageNo = Get-TextMatch $uiPath 'REQUIRED_HOST_AGENT_MANAGE_NO\s*=\s*[''"]([^''"]+)[''"]' 'UI required host agent manage no'
  $agentVersion = Get-TextMatch $agentPath '^\$AgentVersion\s*=\s*"([^"]+)"' 'host-agent.ps1 AgentVersion'
  $agentManageNo = Get-TextMatch $agentPath '^\$AgentManageNo\s*=\s*"([^"]+)"' 'host-agent.ps1 AgentManageNo'
  $bundledVersion = Get-TextMatch $installerPath '^\$bundledAgentVersion\s*=\s*"([^"]+)"' 'NAS installer bundledAgentVersion'
  $bundledManageNo = Get-TextMatch $installerPath '^\$bundledAgentManageNo\s*=\s*"([^"]+)"' 'NAS installer bundledAgentManageNo'
  foreach ($p in @(
    @('UI version', $uiVersion, $agentVersion),
    @('UI manageNo', $uiManageNo, $agentManageNo),
    @('NAS installer version', $bundledVersion, $agentVersion),
    @('NAS installer manageNo', $bundledManageNo, $agentManageNo)
  )) {
    if ([string]$p[1] -ne [string]$p[2]) {
      throw ("Host Agent release mismatch: {0} actual={1} expected={2}" -f $p[0], $p[1], $p[2])
    }
  }
  return @{ version = $agentVersion; manageNo = $agentManageNo }
}

$repoRoot = (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) '..')).Path
Push-Location $repoRoot | Out-Null

try {
  $masterLock = Join-Path $repoRoot 'docker\analytics.master.lock'
  $nasLock = Join-Path $repoRoot 'docker\analytics.nas.master.lock'
  $nasComposeLocal = Join-Path $repoRoot 'docker\analytics.nas.master.yml'
  if (-not (Test-Path -LiteralPath $masterLock)) { throw "Missing: $masterLock" }
  if (-not (Test-Path -LiteralPath $nasComposeLocal)) { throw "Missing: $nasComposeLocal" }

  # 1) NAS lock을 master와 동일 태그로 갱신
  $masterContent = Get-Content -LiteralPath $masterLock -Raw
  Set-Content -LiteralPath $nasLock -Value $masterContent -Encoding UTF8 -NoNewline
  Write-Step 'NAS lock synced from master (same tag)'

  $tagLine = Get-Content -LiteralPath $masterLock | Where-Object { $_ -match '^\s*ANALYTICS_IMAGE_TAG\s*=' } | Select-Object -First 1
  if (-not $tagLine) { throw 'ANALYTICS_IMAGE_TAG not found in master lock' }
  $tag = ($tagLine -split '=', 2)[1].Trim()
  $safeTag = $tag -replace '[\\/:*?"<>|]', '_'
  $expectedAgent = Get-ExpectedHostAgentRelease $repoRoot
  Write-Step ("Host Agent release verified: version {0}, manageNo {1}" -f $expectedAgent.version, $expectedAgent.manageNo)

  # 사람이 NAS로 복사할 때 "어떤 파일인지" 명확히 알 수 있도록,
  # 고정 파일명(SoT) 외에 태그 포함 사본을 매번 남긴다. (덮어쓰기 혼선 방지)
  $nasComposeArchiveLocal = Join-Path $repoRoot ("docker\\analytics.nas.master.{0}.yml" -f $safeTag)
  try {
    if (-not (Test-Path -LiteralPath $nasComposeArchiveLocal)) {
      Copy-Item -LiteralPath $nasComposeLocal -Destination $nasComposeArchiveLocal -Force
    }
    Write-Step ("Archive compose: " + $nasComposeArchiveLocal)
  } catch {
    Write-Info ("Archive compose skipped: " + $_.Exception.Message)
  }

  $webImage = "analytics-analytics-web:$tag"
  $apiImage = "analytics-analytics-api:$tag"

  # 2) 이미지 생성 (docker save)
  $tarName = "analytics_images_$safeTag.tar"
  $tarLocal = Join-Path $repoRoot $tarName
  $shouldSave = $true
  if (-not $ForceSave) {
    try {
      if (Test-Path -LiteralPath $tarLocal) {
        $len = (Get-Item -LiteralPath $tarLocal).Length
        # 50MB 이상이면 "정상 tar 존재"로 간주(반복 실행 최적화)
        if ($len -ge 50MB) { $shouldSave = $false }
      }
    } catch { $shouldSave = $true }
  }
  if ($shouldSave) {
    Write-Step "Save images to $tarName (web + api)"
    & docker save -o $tarLocal $webImage $apiImage
    Assert-Ok 'docker save'
  } else {
    Write-Step "Reuse existing tar (skip docker save): $tarName"
  }
  if (-not (Test-Path -LiteralPath $tarLocal) -or (Get-Item -LiteralPath $tarLocal).Length -lt 50MB) {
    throw "docker save output missing or too small: $tarLocal"
  }

  # 3) SSH로 NAS 복사 (NAS 접근: ssh -o BatchMode=yes admin2@192.168.0.50)
  $keyPath = Join-Path $env:USERPROFILE '.ssh\erp2_nas'
  # Windows/Cursor 환경에서 known_hosts 파일 쓰기/경고 출력이 섞이면 태그 파싱/명령 실패가 재발할 수 있어,
  # 아예 known_hosts 기록을 비활성화하고 로그 레벨을 낮춘다.
  $sshOpts = @(
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=NUL',
    '-o', 'GlobalKnownHostsFile=NUL',
    '-o', 'LogLevel=ERROR'
  )
  if (Test-Path -LiteralPath $keyPath) { $sshOpts = @('-i', $keyPath) + $sshOpts }
  $sshTarget = "${NasUser}@${NasHost}"

  Write-Step "SSH: ensure remote dirs (ssh -o BatchMode=yes $sshTarget)"
  Assert-RemotePathExists -Path $NasPath -Label 'NasPath'
  $mkdirCmd = "set -euo pipefail; mkdir -p '$NasPath' '$NasPath/docker_images' '$NasPath/docker'; ls -ld '$NasPath' '$NasPath/docker_images' '$NasPath/docker'"
  & ssh.exe @sshOpts $sshTarget ("bash -lc " + [char]34 + $mkdirCmd + [char]34)
  Assert-Ok 'SSH mkdir'

  function Send-FileViaSshBinary([string] $LocalPath, [string] $RemotePath, [string] $Label) {
    if (-not (Test-Path -LiteralPath $LocalPath)) { throw "Missing local file: $LocalPath" }
    if (-not $RemotePath) { throw "Remote path empty: $Label" }
    Write-Step "SSH upload ($Label) -> $RemotePath"
    # IMPORTANT(고정):
    # - cmd.exe "<" 리다이렉션은 큰 바이너리에서 경로/따옴표 처리 문제가 재발할 수 있다.
    # - pwsh의 -AsByteStream + 파이프는 바이너리 안전 + 따옴표 이슈 최소화.
    Get-Content -LiteralPath $LocalPath -AsByteStream | & ssh.exe @sshOpts $sshTarget bash -lc ("cat > '$RemotePath'")
    Assert-Ok "SSH upload $Label"
  }

  # scp 업로드가 NAS 설정/권한에 의해 차단되는 경우가 있어(실제로 "Permission denied" 발생),
  # ssh + stdin 스트림으로 파일을 업로드한다.
  #
  # IMPORTANT(고정):
  # - /tmp 경유 업로드는 NAS tmpfs 용량(작음) 때문에 1GB tar 업로드가 실패할 수 있다.
  # - 따라서 tar는 NAS 프로젝트 경로의 docker_images로 "직접" 업로드한다.
  $remoteTar = "$NasPath/docker_images/$tarName"
  $remoteLock = "$NasPath/docker/analytics.nas.master.lock"
  $remoteCompose = "$NasPath/docker/analytics.nas.master.yml"

  Send-FileViaSshBinary -LocalPath $tarLocal -RemotePath $remoteTar -Label 'tar'
  Send-FileViaSshBinary -LocalPath $nasLock -RemotePath $remoteLock -Label 'lock'
  Send-FileViaSshBinary -LocalPath $nasComposeLocal -RemotePath $remoteCompose -Label 'compose'

  $lsCmd = "set -euo pipefail; ls -l '$remoteTar' '$remoteLock' '$remoteCompose'"
  & ssh.exe @sshOpts $sshTarget ("bash -lc " + [char]34 + $lsCmd + [char]34)
  Assert-Ok 'SSH verify uploaded files'

  # 4) SSH: load + 재기동

  Write-Step 'NAS: docker load'
  & ssh.exe @sshOpts $sshTarget "bash -lc 'docker load -i $remoteTar'"
  Assert-Ok 'SSH docker load'

  Write-Step 'NAS: ensure external DB volume'
  & ssh.exe @sshOpts $sshTarget "bash -lc 'docker volume inspect analytics_analytics-db-data >/dev/null 2>&1 || docker volume create analytics_analytics-db-data >/dev/null'"
  Assert-Ok 'SSH ensure external DB volume'

  Write-Step 'NAS: compose up db (if needed)'
  & ssh.exe @sshOpts $sshTarget "bash -lc 'cd $NasPath && docker compose -p analytics_nas -f docker/analytics.nas.master.yml --env-file docker/analytics.nas.master.lock up -d analytics-db --pull never --remove-orphans'"
  Assert-Ok 'SSH compose up db'

  Write-Step 'NAS: stop web before api recreate (avoid proxy 502 during api warmup)'
  & ssh.exe @sshOpts $sshTarget "bash -lc 'cd $NasPath && docker compose -p analytics_nas -f docker/analytics.nas.master.yml --env-file docker/analytics.nas.master.lock stop analytics-web >/dev/null 2>&1 || true'"
  Assert-Ok 'SSH stop web before api recreate'

  Write-Step 'NAS: compose up api (force-recreate)'
  & ssh.exe @sshOpts $sshTarget "bash -lc 'cd $NasPath && docker compose -p analytics_nas -f docker/analytics.nas.master.yml --env-file docker/analytics.nas.master.lock up -d --no-deps --force-recreate analytics-api --pull never --remove-orphans'"
  Assert-Ok 'SSH compose up api'

  Write-Step 'NAS: wait api version before starting web'
  $apiWarmup = & ssh.exe @sshOpts $sshTarget "bash -lc 'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do curl -sS --max-time 3 http://127.0.0.1:6189/api/version 2>/dev/null && exit 0; sleep 2; done; echo __API_UNREACHABLE__; exit 0'" | Out-String
  if ($apiWarmup -match '__API_UNREACHABLE__') {
    throw 'API version check failed before web start'
  }
  if ($apiWarmup -match 'imageTag[\"'']?\s*:\s*[\"'']?([^\"''\s,}]+)') {
    $apiWarmupTag = $Matches[1]
    Write-Info "  API ready before web start: $apiWarmupTag"
    if ($apiWarmupTag -ne $tag) { throw "NAS api imageTag mismatch before web start: expected=$tag actual=$apiWarmupTag" }
  } else { throw "Could not parse api/version before web start" }

  Write-Step 'NAS: compose up web (force-recreate)'
  & ssh.exe @sshOpts $sshTarget "bash -lc 'cd $NasPath && docker compose -p analytics_nas -f docker/analytics.nas.master.yml --env-file docker/analytics.nas.master.lock up -d --no-deps --force-recreate analytics-web --pull never --remove-orphans'"
  Assert-Ok 'SSH compose up web'

  # 5) 검증
  Start-Sleep -Seconds 5
  Write-Step 'Verify: web version.json'
  $webJson = & ssh.exe @sshOpts $sshTarget "bash -lc 'curl -sS http://127.0.0.1:6188/version.json'" 2>$null | Out-String
  if ($webJson -match 'imageTag[\"'']?\s*:\s*[\"'']?([^\"''\s]+)') {
    $webTag = $Matches[1]
    Write-Info "  Web imageTag: $webTag"
    if ($webTag -ne $tag) { throw "NAS web imageTag mismatch: expected=$tag actual=$webTag" }
  } else { throw "Could not parse version.json" }

  Write-Step 'Verify: NAS-served Host Agent installer release'
  $installerText = & ssh.exe @sshOpts $sshTarget "bash -lc 'curl -sS http://127.0.0.1:6188/nas/Install-Analytics-HostAgent.ps1'" 2>$null | Out-String
  if ($installerText -notmatch [regex]::Escape([string]$expectedAgent.version)) {
    throw ("NAS installer missing expected Host Agent version: " + [string]$expectedAgent.version)
  }
  if ($installerText -notmatch [regex]::Escape([string]$expectedAgent.manageNo)) {
    throw ("NAS installer missing expected Host Agent manageNo: " + [string]$expectedAgent.manageNo)
  }
  Write-Info ("  NAS installer Host Agent release OK: version {0}, manageNo {1}" -f $expectedAgent.version, $expectedAgent.manageNo)

  Write-Step 'Verify: api version'
  $apiVer = & ssh.exe @sshOpts $sshTarget "bash -lc 'curl -sS http://127.0.0.1:6189/api/version'" 2>$null | Out-String
  if ($apiVer -match 'imageTag[\"'']?\s*:\s*[\"'']?([^\"''\s]+)') {
    $apiTag = $Matches[1]
    Write-Info "  API imageTag: $apiTag"
    if ($apiTag -ne $tag) { throw "NAS api imageTag mismatch: expected=$tag actual=$apiTag" }
  } else { throw "Could not parse api/version" }

  Write-Info "Done. NAS Web: http://${NasHost}:6188  API: http://${NasHost}:6189  tag=$tag"
}
finally {
  Pop-Location | Out-Null
}
