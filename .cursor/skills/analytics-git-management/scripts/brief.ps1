$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path

function Test-JunkPath([string]$Path) {
  if ($Path -match '^(releases|calibration|backups|tmp-local-edit-qa|%LOCALAPPDATA%)/') { return $true }
  if ($Path -eq '$dst' -or $Path -eq 'tmp_check_host_agent_js.py') { return $true }
  if ($Path -match '(?i)\.pdf$') { return $true }
  if ($Path -match '^docker/.+\.analytics_\d{8}_\d{6}\.(yml|lock)$') { return $true }
  if ($Path -match '^docs/ChatGPT Image .+\.png$') { return $true }
  return $false
}

Write-Host "=== BRANCH ==="
git status -sb | Select-Object -First 1
Write-Host "=== AHEAD ==="
git log --oneline "@{u}..HEAD"
Write-Host "=== BEHIND ==="
git log --oneline "HEAD..@{u}"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "git"
$psi.Arguments = "-c core.quotepath=false status --porcelain=v1 -uall -z"
$psi.WorkingDirectory = (Get-Location).Path
$psi.RedirectStandardOutput = $true
$psi.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
$psi.UseShellExecute = $false
$proc = [System.Diagnostics.Process]::Start($psi)
$raw = $proc.StandardOutput.ReadToEnd()
$proc.WaitForExit()

$keep = 0
$junk = 0
$records = $raw -split "`0" | Where-Object { $_ -and $_.Length -ge 4 }
foreach ($rec in $records) {
  $path = $rec.Substring(3).Trim().Trim('"') -replace '\\','/'
  if (Test-JunkPath $path) { $junk++ } else { $keep++ }
}
Write-Host "=== WORKTREE ==="
Write-Host "source_entries=$keep"
Write-Host "local_artifact_entries=$junk"
if ($keep -eq 0) {
  Write-Host "SOURCE_CLEAN=YES"
} else {
  Write-Host "SOURCE_CLEAN=NO"
}
