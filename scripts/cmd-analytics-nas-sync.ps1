<#
.SYNOPSIS
  Analytics 코드를 NAS로 동기화 (SMB 또는 SSH)

.DESCRIPTION
  NAS 접근 권한(SSH): ssh -o BatchMode=yes admin2@192.168.0.50 (키 인증 필요)
  - SMB: robocopy로 \\loa_nas\projects\ERP2-Dev\ERP2-analytics 동기화 (NAS_SMB_PASSWORD 필요)
  - SSH: tar 스트리밍 + rsync (위 SSH 접속으로 -SyncViaSsh 사용)

.EXAMPLE
  $env:NAS_SMB_PASSWORD='***'; .\scripts\cmd-analytics-nas-sync.ps1

.EXAMPLE
  .\scripts\cmd-analytics-nas-sync.ps1 -SyncViaSsh
#>
param(
  [string] $NasSharePath = "\\loa_nas\\projects\\ERP2-Dev",
  [string] $Username = "admin2",
  [string] $TargetFolderName = "ERP2-analytics",
  [string] $Source,
  [string] $Password,

  # NAS 접근 권한: ssh -o BatchMode=yes admin2@192.168.0.50
  [string] $NasHost = "192.168.0.50",
  [string] $NasUser = "admin2",
  [string] $SshKeyPath = (Join-Path $HOME ".ssh\erp2_nas"),
  # NAS 내부 경로 (SSH 동기화 시)
  [string] $NasPath = "/volume1/projects/ERP2-Dev/ERP2-analytics",
  # SMB 대신 SSH로 동기화 (키 기반 인증 사용)
  [switch] $SyncViaSsh
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Source 기본값: 이 스크립트가 있는 프로젝트 루트 (ERP2-analytics)
if (-not $Source) {
  $scriptDir = Split-Path -Parent $PSCommandPath
  $Source = (Resolve-Path (Join-Path $scriptDir '..')).Path
}

# NAS SSH 접속 테스트: ssh -o BatchMode=yes admin2@192.168.0.50
$NasSshTarget = "${NasUser}@${NasHost}"
$NasSshOpts = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no')
if ($SshKeyPath -and (Test-Path -LiteralPath $SshKeyPath)) {
  $NasSshOpts = @('-i', $SshKeyPath) + $NasSshOpts
}

function Write-Info([string] $msg) { Write-Host ("[INFO] " + $msg) -ForegroundColor Cyan }

function Test-NasSsh {
  try {
    & ssh.exe @NasSshOpts $NasSshTarget 'echo OK' 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

function Ensure-NasSession([string] $SharePath, [string] $User, [string] $Pass) {
  $accessible = $false
  try { $accessible = Test-Path -LiteralPath $SharePath } catch { $accessible = $false }
  if (-not $accessible) {
    $cmd = "net use `"$SharePath`" `"$Pass`" /user:`"$User`" /persistent:no"
    cmd.exe /c $cmd | Out-Null
    Start-Sleep -Milliseconds 300
    try { $accessible = Test-Path -LiteralPath $SharePath } catch { $accessible = $false }
  }
  if (-not $accessible) { throw "Cannot access NAS share: $SharePath" }
}

function Invoke-Robocopy([string] $Src, [string] $Dst) {
  if (-not (Test-Path -LiteralPath $Src)) { throw "SRC_NOT_FOUND: $Src" }
  if (-not (Test-Path -LiteralPath $Dst)) { New-Item -ItemType Directory -Force -Path $Dst | Out-Null }

  $excludeNames = @('.git','.github','.cursor','.cache','node_modules','dist','coverage','.venv','.venv-reports','__pycache__','.pytest_cache')
  $xdArgs = @('/XD') + $excludeNames
  $xfArgs = @('/XF','*.tar','*.zip','*.7z','*.iso','*.pyc')

  Write-Info "Sync: $Src -> $Dst"
  & robocopy $Src $Dst /MIR /R:1 /W:2 /MT:16 /NFL /NDL /NP /XJ @xdArgs @xfArgs | Out-Null
  $code = $LASTEXITCODE
  if ($code -gt 3) { throw "Robocopy failed with exit code $code." }
}

if ($SyncViaSsh) {
  Write-Info "Sync via SSH: $NasSshTarget (ssh -o BatchMode=yes $NasSshTarget)"
  if (-not (Test-NasSsh)) {
    throw "SSH 연결 실패: $NasSshTarget (ssh -o BatchMode=yes $NasSshTarget 확인, 키 인증 필요)"
  }

  $ts = Get-Date -Format 'yyyyMMdd_HHmmss'
  $remoteTmpDir = "$NasPath/.tmp_sync"
  $remoteArchive = "$remoteTmpDir/analytics_sync_$ts.tgz"
  $remoteStage = "$remoteTmpDir/stage_$ts"

  $tarExcludes = @(
    '--exclude=.git', '--exclude=.github', '--exclude=.cursor', '--exclude=.cache',
    '--exclude=node_modules', '--exclude=web/node_modules', '--exclude=dist', '--exclude=web/dist',
    '--exclude=api/__pycache__', '--exclude=.pytest_cache', '--exclude=.venv',
    '--exclude=*.tar', '--exclude=*.zip', '--exclude=*.7z', '--exclude=*.iso', '--exclude=*.pyc',
    '--exclude=data', '--exclude=_backups_full', '--exclude=_debug',
    '--exclude=docker/env.analytics.local', '--exclude=docker/env.firebase.admin.local'
  )

  Write-Info "tar | ssh: $Source -> ${NasSshTarget}:${remoteArchive}"
  & ssh.exe @NasSshOpts $NasSshTarget "mkdir -p `"$remoteTmpDir`""
  $tarArgs = @('-czf', '-') + $tarExcludes + @('-C', $Source, '.')
  & tar.exe @tarArgs | & ssh.exe @NasSshOpts $NasSshTarget "cat > `"$remoteArchive`""
  if ($LASTEXITCODE -ne 0) { throw "SSH upload failed ($LASTEXITCODE)" }

  $syncScript = @"
set -euo pipefail
ARCH="$remoteArchive"
STAGE="$remoteStage"
DEST="$NasPath"
mkdir -p "`$STAGE"
tar -xzf "`$ARCH" -C "`$STAGE"
if command -v rsync >/dev/null 2>&1; then
  rsync -av --checksum --no-times --omit-dir-times "`$STAGE"/ "`$DEST"/
else
  cp -a "`$STAGE"/* "`$DEST"/
fi
rm -rf "`$STAGE" "`$ARCH"
echo "Done. Synced to `$DEST"
"@
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($syncScript))
  $payload | & ssh.exe @NasSshOpts $NasSshTarget 'bash -lc "tr -d ''\r'' | base64 -d | bash"'
  if ($LASTEXITCODE -ne 0) { throw "SSH extract/sync failed ($LASTEXITCODE)" }

  Write-Info "Done. Synced to $NasPath (via SSH)"
} else {
  if (-not $Password) { $Password = [string]($env:NAS_SMB_PASSWORD) }
  if (-not $Password) {
    throw "NAS_SMB_PASSWORD가 필요합니다. (예: PowerShell에서 `$env:NAS_SMB_PASSWORD='***' 설정 후 다시 실행). 또는 SMB 대신 SSH: -SyncViaSsh"
  }

  Ensure-NasSession -SharePath $NasSharePath -User $Username -Pass $Password
  $destRoot = Join-Path $NasSharePath $TargetFolderName
  Invoke-Robocopy -Src $Source -Dst $destRoot

  Write-Info "Done. Synced to $destRoot"
}
