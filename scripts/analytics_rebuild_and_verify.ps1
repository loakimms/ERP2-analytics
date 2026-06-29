param(
  # 태그에 포함할 사람이 읽는 버전(선택)
  [string] $Version = 'analytics'
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

function Get-PwshOrWindowsPowerShell {
  if (Get-Command pwsh -ErrorAction SilentlyContinue) { return 'pwsh' }
  return 'powershell'
}
$pwExe = Get-PwshOrWindowsPowerShell

$build = Join-Path $repoRoot 'scripts\analytics_build_candidate.ps1'
$verify = Join-Path $repoRoot 'scripts\analytics_switch_to_candidate_and_verify.ps1'
$promote = Join-Path $repoRoot 'scripts\analytics_promote_or_rollback.ps1'

Write-Info ("Using shell: " + $pwExe)

Write-Info 'Build candidate'
& $pwExe -NoProfile -ExecutionPolicy Bypass -File $build -Version $Version
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
  Write-Info 'VERIFY PASS -> promote to master + backup'
  & $pwExe -NoProfile -ExecutionPolicy Bypass -File $promote -Result PASS
  if ($LASTEXITCODE -ne 0) { throw "promote PASS failed (exit=$LASTEXITCODE)" }
  Write-Info 'DONE'
  exit 0
}

Write-Warn 'VERIFY FAIL -> rollback to master'
& $pwExe -NoProfile -ExecutionPolicy Bypass -File $promote -Result FAIL
if ($LASTEXITCODE -ne 0) { throw "rollback FAIL failed (exit=$LASTEXITCODE)" }
throw 'VERIFY failed. Rolled back to master.'

