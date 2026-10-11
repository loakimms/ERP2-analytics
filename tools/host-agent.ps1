param(
	[int]$Port = 9230,
	[int]$CdpPort = 9223,
	[string]$UserDataDir = (Join-Path $env:LOCALAPPDATA "ERP2-Analytics-HostChrome"),
	[switch]$BackgroundWorker = $false,
	[string]$WorkerApiBaseUrl = "",
	[string]$WorkerBearerToken = "",
	[string]$WorkerCollectorToken = "",
	[string]$WorkerDeviceId = "",
	[string]$WorkerHostChromeUserDataDir = "",
	[string]$WorkerChromeProfileDir = "Default",
	[string]$WorkerChromeProfileLabel = ""
)

$ErrorActionPreference = "Stop"
$script:CollectorWorkerToken = [string]($WorkerCollectorToken ?? "")
$script:HostChromeUserDataDir = [string]($WorkerHostChromeUserDataDir ?? "")
if ([string]::IsNullOrWhiteSpace($script:HostChromeUserDataDir)) { $script:HostChromeUserDataDir = $UserDataDir }
$script:HostChromeUserDataDir = [Environment]::ExpandEnvironmentVariables($script:HostChromeUserDataDir)
try { $script:HostChromeUserDataDir = [IO.Path]::GetFullPath($script:HostChromeUserDataDir) } catch {}
$script:HostChromeProfileDir = [string]($WorkerChromeProfileDir ?? "Default")
if ([string]::IsNullOrWhiteSpace($script:HostChromeProfileDir)) { $script:HostChromeProfileDir = "Default" }
$script:HostChromeProfileLabel = [string]($WorkerChromeProfileLabel ?? "")

try {
	$defaultChromeRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data")).TrimEnd("\")
	$requestedChromeRoot = [IO.Path]::GetFullPath($script:HostChromeUserDataDir).TrimEnd("\")
	if (
		$requestedChromeRoot.Equals($defaultChromeRoot, [StringComparison]::OrdinalIgnoreCase) -or
		$requestedChromeRoot.StartsWith($defaultChromeRoot + "\", [StringComparison]::OrdinalIgnoreCase)
	) {
		$profileSlugBase = if (-not [string]::IsNullOrWhiteSpace($script:HostChromeProfileLabel)) { $script:HostChromeProfileLabel } else { $script:HostChromeProfileDir }
		$profileSlug = ($profileSlugBase -replace '[^A-Za-z0-9._-]+', '-').Trim("-._")
		if ([string]::IsNullOrWhiteSpace($profileSlug)) { $profileSlug = "chrome-profile" }
		$script:HostChromeUserDataDir = Join-Path $env:LOCALAPPDATA ("ERP2-Analytics-HostChromeProfiles\" + $profileSlug)
		$script:HostChromeProfileDir = "Default"
	}
} catch {
	# If path normalization fails, keep the original value so the existing guard can fail closed.
}

function Write-Info([string]$m) { Write-Host ("[INFO] " + $m) -ForegroundColor Cyan }
function Write-Warn([string]$m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }

function Resolve-PowerShellExe {
	$candidates = New-Object 'System.Collections.Generic.List[string]'
	$pshomePwsh = $null
	$pshomeWindows = $null
	if (-not [string]::IsNullOrWhiteSpace($PSHOME)) {
		$pshomePwsh = Join-Path $PSHOME 'pwsh.exe'
		$pshomeWindows = Join-Path $PSHOME 'powershell.exe'
	}
	foreach ($value in @(
		$pshomePwsh,
		$pshomeWindows,
		"$env:ProgramFiles\PowerShell\7\pwsh.exe",
		"$env:ProgramFiles\PowerShell\6\pwsh.exe",
		"$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
	)) {
		if (-not [string]::IsNullOrWhiteSpace($value) -and -not $candidates.Contains($value)) { $candidates.Add($value) | Out-Null }
	}
	foreach ($candidate in $candidates) {
		if (Test-Path -LiteralPath $candidate) { return $candidate }
	}
	$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1
	if ($pwshCmd -and $pwshCmd.Source) { return $pwshCmd.Source }
	$powershellCmd = Get-Command powershell -ErrorAction SilentlyContinue | Select-Object -First 1
	if ($powershellCmd -and $powershellCmd.Source) { return $powershellCmd.Source }
	throw "PowerShell executable was not found."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath
$AgentVersion = "2026.10.08-review-reply-extraction-guard"
$AgentManageNo = "20261008-1720"
$HostAgentInstallMode = if (Test-Path -LiteralPath (Join-Path $repoRoot "CANONICAL_ROOT.txt")) { "repo" } else { "standalone" }
$MenuSyncSupported = $HostAgentInstallMode -eq "repo"
$startScript = Join-Path $repoRoot "tools\\start-host-chrome.ps1"
$stopScript = Join-Path $repoRoot "tools\\stop-host-chrome.ps1"
$menuSyncExportScript = Join-Path $repoRoot "scripts\\menu-sync-local-export.ps1"
$menuSyncPushScript = Join-Path $repoRoot "scripts\\menu-sync-nas-push.ps1"
$menuSyncImportScript = Join-Path $repoRoot "scripts\\menu-sync-nas-import.ps1"
$menuSyncReconcileScript = Join-Path $repoRoot "scripts\\menu-sync-db-reconcile.ps1"
$menuSyncTrackingGapAnalyzeScript = Join-Path $repoRoot "scripts\\menu-sync-tracking-gap-analyze.ps1"
$menuSyncTrackingGapPushScript = Join-Path $repoRoot "scripts\\menu-sync-tracking-gap-push.ps1"
if (-not (Test-Path -LiteralPath $startScript)) { throw "Missing: $startScript" }
if (-not (Test-Path -LiteralPath $stopScript)) { throw "Missing: $stopScript" }
if (-not (Test-Path -LiteralPath $menuSyncExportScript)) { throw "Missing: $menuSyncExportScript" }
if (-not (Test-Path -LiteralPath $menuSyncPushScript)) { throw "Missing: $menuSyncPushScript" }
if (-not (Test-Path -LiteralPath $menuSyncImportScript)) { throw "Missing: $menuSyncImportScript" }
if (-not (Test-Path -LiteralPath $menuSyncReconcileScript)) { throw "Missing: $menuSyncReconcileScript" }
if (-not (Test-Path -LiteralPath $menuSyncTrackingGapAnalyzeScript)) { throw "Missing: $menuSyncTrackingGapAnalyzeScript" }
if (-not (Test-Path -LiteralPath $menuSyncTrackingGapPushScript)) { throw "Missing: $menuSyncTrackingGapPushScript" }

function Send-Json($ctx, [int]$code, $obj) {
	try { $ctx.Response.StatusCode = $code } catch {}
	try { $ctx.Response.ContentType = "application/json; charset=utf-8" } catch {}
	# CORS/PNA: NAS 웹(192.168.*) -> localhost(127.0.0.1) 호출 허용
	$origin = ""
	try { $origin = [string]($ctx.Request.Headers["Origin"] ?? "") } catch {}
	try {
		if ($origin) { $ctx.Response.Headers.Add("Access-Control-Allow-Origin", $origin) }
		else { $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*") }
	} catch {}
	try { $ctx.Response.Headers.Add("Vary", "Origin") } catch {}
	try { $ctx.Response.Headers.Add("Access-Control-Allow-Headers", "*") } catch {}
	try { $ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET,POST,OPTIONS") } catch {}
	try { $ctx.Response.Headers.Add("Access-Control-Allow-Private-Network", "true") } catch {}
	$bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress))
	try { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) } catch {}
	try { $ctx.Response.OutputStream.Close() } catch {}
}

function Send-Html($ctx, [int]$code, [string]$html) {
	try { $ctx.Response.StatusCode = $code } catch {}
	try { $ctx.Response.ContentType = "text/html; charset=utf-8" } catch {}
	try { $ctx.Response.Headers.Add("Cache-Control", "no-store") } catch {}
	$bytes = [Text.Encoding]::UTF8.GetBytes(($html ?? ""))
	try { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) } catch {}
	try { $ctx.Response.OutputStream.Close() } catch {}
}

function Read-BodyText($ctx) {
	try {
		$sr = New-Object System.IO.StreamReader($ctx.Request.InputStream, $ctx.Request.ContentEncoding)
		return ($sr.ReadToEnd() ?? "")
	} catch {
		return ""
	}
}

function Read-JsonBody($ctx) {
	$bodyText = "" + (Read-BodyText $ctx)
	if ([string]::IsNullOrWhiteSpace($bodyText)) { return @{} }
	try {
		$parsed = $bodyText | ConvertFrom-Json -AsHashtable
		if ($parsed -is [hashtable]) { return $parsed }
		return @{}
	} catch {
		throw "invalid_json_body"
	}
}

function Get-QueryMap($ctx) {
	$q = @{}
	try {
		foreach ($k in $ctx.Request.QueryString.Keys) {
			if ($null -eq $k) { continue }
			$q[$k] = $ctx.Request.QueryString[$k]
		}
	} catch {}
	return $q
}

function Get-BodyStringValue([hashtable]$Body, [string]$Key, [string]$Default = "") {
	if (-not $Body.ContainsKey($Key)) { return $Default }
	return [string]($Body[$Key] ?? $Default)
}

function Get-BodyStringArray([hashtable]$Body, [string]$Key) {
	if (-not $Body.ContainsKey($Key)) { return @() }
	$value = $Body[$Key]
	if ($null -eq $value) { return @() }
	if ($value -is [System.Collections.IEnumerable] -and -not ($value -is [string])) {
		return @($value | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
	}
	$single = [string]$value
	if ([string]::IsNullOrWhiteSpace($single)) { return @() }
	return @($single)
}

function Start-HostAgentSelfUpdate([string]$InstallerUrl, [string]$ExpectedVersion, [int]$port, [int]$cdpPort) {
	if ([string]::IsNullOrWhiteSpace($InstallerUrl)) { throw "installer_url_required" }
	$uri = [Uri]$InstallerUrl
	if ($uri.Scheme -notin @("http", "https")) { throw "installer_url_must_be_http" }

	$installDir = Join-Path $env:LOCALAPPDATA "ERP2-Analytics-HostAgent"
	$workDir = Join-Path $env:TEMP ("ERP2-Analytics-HostAgent-Update-" + [Guid]::NewGuid().ToString("N"))
	New-Item -ItemType Directory -Force -Path $workDir | Out-Null
	$installerPath = Join-Path $workDir "Install-Analytics-HostAgent.ps1"
	$updaterPath = Join-Path $workDir "Run-HostAgent-SelfUpdate.ps1"
	$logPath = Join-Path $installDir "self-update.log"
	$installerUrlLiteral = $InstallerUrl | ConvertTo-Json -Compress
	$installerPathLiteral = $installerPath | ConvertTo-Json -Compress
	$installDirLiteral = $installDir | ConvertTo-Json -Compress
	$logPathLiteral = $logPath | ConvertTo-Json -Compress

	$updater = @"
`$ErrorActionPreference = "Stop"
`$ProgressPreference = "SilentlyContinue"
`$installerUrl = $installerUrlLiteral
`$installerPath = $installerPathLiteral
`$installDir = $installDirLiteral
`$logPath = $logPathLiteral
function Write-UpdateLog([string]`$message) {
  try {
    New-Item -ItemType Directory -Force -Path `$installDir | Out-Null
    Add-Content -LiteralPath `$logPath -Encoding UTF8 -Value ((Get-Date).ToString("s") + " " + `$message)
  } catch {}
}
try {
  Write-UpdateLog "download start `$installerUrl"
  Invoke-WebRequest -UseBasicParsing -Uri `$installerUrl -OutFile `$installerPath -TimeoutSec 30
  `$backgroundStatus = `$null
  try {
    `$backgroundStatus = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/collector/background/status" -TimeoutSec 2
    if (`$backgroundStatus -and `$backgroundStatus.running) {
      Write-UpdateLog "background stop before update"
      Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/collector/background/stop" -TimeoutSec 5 | Out-Null
    }
  } catch { Write-UpdateLog ("background stop skipped " + `$_.Exception.Message) }
  Write-UpdateLog "agent shutdown before install"
  try { Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/shutdown" -TimeoutSec 2 | Out-Null } catch { Write-UpdateLog ("agent shutdown skipped " + `$_.Exception.Message) }
  Start-Sleep -Seconds 2
  Write-UpdateLog "install start"
  `$candidates = @(
    (Join-Path `$PSHOME 'pwsh.exe'),
    (Join-Path `$PSHOME 'powershell.exe'),
    "`$env:ProgramFiles\PowerShell\7\pwsh.exe",
    "`$env:ProgramFiles\PowerShell\6\pwsh.exe",
    "`$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  )
  `$pwsh = `$null
  foreach (`$candidate in `$candidates) { if (`$candidate -and (Test-Path -LiteralPath `$candidate)) { `$pwsh = `$candidate; break } }
  if (-not `$pwsh) {
    `$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1
    if (`$pwshCmd -and `$pwshCmd.Source) { `$pwsh = `$pwshCmd.Source }
  }
  if (-not `$pwsh) { throw "PowerShell executable was not found." }
  `$stdoutPath = Join-Path `$installDir "self-update-install.out.log"
  `$stderrPath = Join-Path `$installDir "self-update-install.err.log"
  `$installerArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", `$installerPath, "-Port", "$port", "-CdpPort", "$cdpPort", "-InstallDir", `$installDir, "-NoPause")
  `$p = Start-Process -FilePath `$pwsh -ArgumentList `$installerArgs -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput `$stdoutPath -RedirectStandardError `$stderrPath
  Write-UpdateLog ("install exit " + `$p.ExitCode)
  try {
    if (Test-Path -LiteralPath `$stdoutPath) {
      `$stdoutTail = Get-Content -LiteralPath `$stdoutPath -Tail 40 -ErrorAction SilentlyContinue
      if (`$stdoutTail) { Write-UpdateLog ("install stdout: " + ((`$stdoutTail | ForEach-Object { "$_" }) -join " | ")) }
    }
  } catch {}
  try {
    if (Test-Path -LiteralPath `$stderrPath) {
      `$stderrTail = Get-Content -LiteralPath `$stderrPath -Tail 40 -ErrorAction SilentlyContinue
      if (`$stderrTail) { Write-UpdateLog ("install stderr: " + ((`$stderrTail | ForEach-Object { "$_" }) -join " | ")) }
    }
  } catch {}
  if (`$p.ExitCode -ne 0) { throw ("installer_exit_" + `$p.ExitCode) }
  Start-Sleep -Seconds 1
  `$start = Join-Path `$installDir "start-host-agent.ps1"
  if (Test-Path -LiteralPath `$start) {
    Start-Process -FilePath `$pwsh -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", `$start, "-Port", "$port", "-CdpPort", "$cdpPort", "-NoPause") -WindowStyle Hidden | Out-Null
    Write-UpdateLog "restart requested"
    if (`$backgroundStatus -and `$backgroundStatus.running) {
      Write-UpdateLog "background restart skipped: token refresh required"
    }
  } else {
    Write-UpdateLog "start script not found"
  }
} catch {
  Write-UpdateLog ("error " + `$_.Exception.Message)
}
"@
	Set-Content -LiteralPath $updaterPath -Encoding UTF8 -Value $updater
	$pwshExe = Resolve-PowerShellExe
	$proc = Start-Process -FilePath $pwshExe -ArgumentList @(
		"-NoProfile",
		"-ExecutionPolicy", "Bypass",
		"-File", $updaterPath
	) -WindowStyle Hidden -PassThru
	return @{ ok = $true; action = "self-update"; pid = $proc.Id; installerUrl = $InstallerUrl; expectedVersion = $ExpectedVersion; installDir = $installDir }
}

function Limit-Text([string]$Text, [int]$MaxLength = 4000) {
	$s = [string]($Text ?? "")
	if ($s.Length -le $MaxLength) { return $s }
	return $s.Substring($s.Length - $MaxLength)
}

function Try-ParseJsonFromText([string]$Text) {
	$raw = [string]($Text ?? "")
	if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
	$lines = @($raw -split "`r?`n")
	[array]::Reverse($lines)
	foreach ($line in $lines) {
		$candidate = [string]($line ?? "").Trim()
		if (-not $candidate) { continue }
		if (-not ($candidate.StartsWith("{") -or $candidate.StartsWith("["))) { continue }
		try {
			return ($candidate | ConvertFrom-Json -AsHashtable)
		} catch {
			continue
		}
	}
	return $null
}

function Invoke-PwshScriptCapture([string]$ScriptPath, [string[]]$ArgumentList) {
	$psArgs = @(
		"-NoProfile",
		"-ExecutionPolicy", "Bypass",
		"-File", $ScriptPath
	) + @($ArgumentList)
	$output = (& pwsh @psArgs 2>&1 | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
	$exitCode = $LASTEXITCODE
	return @{
		exitCode = $exitCode
		output = (Limit-Text $output)
		parsedJson = (Try-ParseJsonFromText $output)
	}
}

function Get-DefaultMenuSyncBundlePath([string]$BundleFileName) {
	$fileName = [string]($BundleFileName ?? "")
	if ([string]::IsNullOrWhiteSpace($fileName)) { return "" }
	return (Join-Path (Join-Path $repoRoot "artifacts\\menu-sync") $fileName)
}

function New-MenuSyncScriptResponse([string]$Action, $Result, [string]$FallbackBundlePath = "") {
	$bundlePath = $FallbackBundlePath
	$response = @{
		ok = $true
		action = $Action
		bundlePath = $bundlePath
		output = [string]($Result.output ?? "")
	}
	$parsed = $Result.parsedJson
	if ($parsed -is [hashtable]) {
		foreach ($entry in $parsed.GetEnumerator()) {
			$response[$entry.Key] = $entry.Value
		}
		if ($parsed.ContainsKey("bundlePath") -and $parsed["bundlePath"]) {
			$response["bundlePath"] = [string]$parsed["bundlePath"]
		}
	}
	return $response
}

function Invoke-MenuSyncExport([hashtable]$Body) {
	$localApiBaseUrl = Get-BodyStringValue $Body "localApiBaseUrl" "http://localhost:5189"
	$bundleFileName = Get-BodyStringValue $Body "bundleFileName" ""
	$bearerToken = Get-BodyStringValue $Body "bearerToken" ""
	$dateFrom = Get-BodyStringValue $Body "dateFrom" ""
	$dateTo = Get-BodyStringValue $Body "dateTo" ""
	$targetDates = @(Get-BodyStringArray $Body "targetDates")
	$menuIds = @(Get-BodyStringArray $Body "menuIds")
	if ($menuIds.Count -eq 0) { throw "menuIds_required" }

	$args = @(
		"-LocalApiBaseUrl", $localApiBaseUrl,
		"-MenuIdsJson", ($menuIds | ConvertTo-Json -Compress)
	)
	$args += @("-OutDir", "artifacts\menu-sync")
	if ($bundleFileName) { $args += @("-BundleFileName", $bundleFileName) }
	if ($bearerToken) { $args += @("-BearerToken", $bearerToken) }
	if ($dateFrom) { $args += @("-DateFrom", $dateFrom) }
	if ($dateTo) { $args += @("-DateTo", $dateTo) }
	if ($targetDates.Count -gt 0) {
		$args += @("-TargetDatesJson", ($targetDates | ConvertTo-Json -Compress))
	}

	$result = Invoke-PwshScriptCapture -ScriptPath $menuSyncExportScript -ArgumentList $args
	if (($result.exitCode ?? 1) -ne 0) {
		throw ("menu_sync_export_failed: " + [string]($result.output ?? "exit=$($result.exitCode)"))
	}

	return (New-MenuSyncScriptResponse -Action "menu-sync-export" -Result $result -FallbackBundlePath (Get-DefaultMenuSyncBundlePath $bundleFileName))
}

function Invoke-MenuSyncPush([hashtable]$Body) {
	$localApiBaseUrl = Get-BodyStringValue $Body "localApiBaseUrl" "http://localhost:5189"
	$nasApiBaseUrl = Get-BodyStringValue $Body "nasApiBaseUrl" "http://192.168.0.50:6188/api"
	$bundleFileName = Get-BodyStringValue $Body "bundleFileName" ""
	$localBearerToken = Get-BodyStringValue $Body "localBearerToken" ""
	$nasBearerToken = Get-BodyStringValue $Body "nasBearerToken" ""
	$dateFrom = Get-BodyStringValue $Body "dateFrom" ""
	$dateTo = Get-BodyStringValue $Body "dateTo" ""
	$targetDates = @(Get-BodyStringArray $Body "targetDates")
	$menuIds = @(Get-BodyStringArray $Body "menuIds")
	if ($menuIds.Count -eq 0) { throw "menuIds_required" }

	$args = @(
		"-LocalApiBaseUrl", $localApiBaseUrl,
		"-NasApiBaseUrl", $nasApiBaseUrl,
		"-MenuIdsJson", ($menuIds | ConvertTo-Json -Compress)
	)
	$args += @("-OutDir", "artifacts\menu-sync")
	if ($bundleFileName) { $args += @("-BundleFileName", $bundleFileName) }
	if ($localBearerToken) { $args += @("-LocalBearerToken", $localBearerToken) }
	if ($nasBearerToken) { $args += @("-NasBearerToken", $nasBearerToken) }
	if ($dateFrom) { $args += @("-DateFrom", $dateFrom) }
	if ($dateTo) { $args += @("-DateTo", $dateTo) }
	if ($targetDates.Count -gt 0) {
		$args += @("-TargetDatesJson", ($targetDates | ConvertTo-Json -Compress))
	}

	$result = Invoke-PwshScriptCapture -ScriptPath $menuSyncPushScript -ArgumentList $args
	if (($result.exitCode ?? 1) -ne 0) {
		throw ("menu_sync_push_failed: " + [string]($result.output ?? "exit=$($result.exitCode)"))
	}

	return (New-MenuSyncScriptResponse -Action "menu-sync-push" -Result $result -FallbackBundlePath (Get-DefaultMenuSyncBundlePath $bundleFileName))
}

function Invoke-MenuSyncImport([hashtable]$Body) {
	$nasApiBaseUrl = Get-BodyStringValue $Body "nasApiBaseUrl" "http://192.168.0.50:6188/api"
	$bearerToken = Get-BodyStringValue $Body "bearerToken" ""
	$bundlePath = Get-BodyStringValue $Body "bundlePath" ""
	if (-not $bundlePath) {
		$bundlePath = Get-DefaultMenuSyncBundlePath (Get-BodyStringValue $Body "bundleFileName" "")
	}
	if (-not $bundlePath) { throw "bundlePath_required" }

	$args = @(
		"-BundlePath", $bundlePath,
		"-NasApiBaseUrl", $nasApiBaseUrl
	)
	if ($bearerToken) { $args += @("-BearerToken", $bearerToken) }

	$result = Invoke-PwshScriptCapture -ScriptPath $menuSyncImportScript -ArgumentList $args
	if (($result.exitCode ?? 1) -ne 0) {
		throw ("menu_sync_import_failed: " + [string]($result.output ?? "exit=$($result.exitCode)"))
	}

	return (New-MenuSyncScriptResponse -Action "menu-sync-import" -Result $result -FallbackBundlePath $bundlePath)
}

function Invoke-MenuSyncReconcile([hashtable]$Body) {
	$localApiBaseUrl = Get-BodyStringValue $Body "localApiBaseUrl" "http://localhost:5189"
	$nasApiBaseUrl = Get-BodyStringValue $Body "nasApiBaseUrl" "http://192.168.0.50:6188/api"
	$localBearerToken = Get-BodyStringValue $Body "localBearerToken" ""
	$nasBearerToken = Get-BodyStringValue $Body "nasBearerToken" ""
	$dateFrom = Get-BodyStringValue $Body "dateFrom" ""
	$dateTo = Get-BodyStringValue $Body "dateTo" ""
	$targetDates = @(Get-BodyStringArray $Body "targetDates")
	$menuIds = @(Get-BodyStringArray $Body "menuIds")
	if ($menuIds.Count -eq 0) { throw "menuIds_required" }

	$args = @(
		"-LocalApiBaseUrl", $localApiBaseUrl,
		"-NasApiBaseUrl", $nasApiBaseUrl,
		"-MenuIdsJson", ($menuIds | ConvertTo-Json -Compress),
		"-OutDir", "artifacts\menu-sync"
	)
	if ($localBearerToken) { $args += @("-LocalBearerToken", $localBearerToken) }
	if ($nasBearerToken) { $args += @("-NasBearerToken", $nasBearerToken) }
	if ($dateFrom) { $args += @("-DateFrom", $dateFrom) }
	if ($dateTo) { $args += @("-DateTo", $dateTo) }
	if ($targetDates.Count -gt 0) {
		$args += @("-TargetDatesJson", ($targetDates | ConvertTo-Json -Compress))
	}

	$result = Invoke-PwshScriptCapture -ScriptPath $menuSyncReconcileScript -ArgumentList $args
	if (($result.exitCode ?? 1) -ne 0) {
		throw ("menu_sync_reconcile_failed: " + [string]($result.output ?? "exit=$($result.exitCode)"))
	}
	return (New-MenuSyncScriptResponse -Action "menu-sync-db-reconcile" -Result $result)
}

function Invoke-MenuSyncTrackingGapAnalyze([hashtable]$Body) {
	$localApiBaseUrl = Get-BodyStringValue $Body "localApiBaseUrl" "http://localhost:5189"
	$nasApiBaseUrl = Get-BodyStringValue $Body "nasApiBaseUrl" "http://192.168.0.50:6188/api"
	$dateFrom = Get-BodyStringValue $Body "dateFrom" ""
	$dateTo = Get-BodyStringValue $Body "dateTo" ""
	$localBearerToken = Get-BodyStringValue $Body "localBearerToken" ""
	$nasBearerToken = Get-BodyStringValue $Body "nasBearerToken" ""

	$args = @(
		"-LocalApiBaseUrl", $localApiBaseUrl,
		"-NasApiBaseUrl", $nasApiBaseUrl
	)
	if ($dateFrom) { $args += @("-DateFrom", $dateFrom) }
	if ($dateTo) { $args += @("-DateTo", $dateTo) }
	if ($localBearerToken) { $args += @("-LocalBearerToken", $localBearerToken) }
	if ($nasBearerToken) { $args += @("-NasBearerToken", $nasBearerToken) }

	$result = Invoke-PwshScriptCapture -ScriptPath $menuSyncTrackingGapAnalyzeScript -ArgumentList $args
	if (($result.exitCode ?? 1) -ne 0) {
		throw ("menu_sync_tracking_gap_analyze_failed: " + [string]($result.output ?? "exit=$($result.exitCode)"))
	}
	return (New-MenuSyncScriptResponse -Action "menu-sync-tracking-gap-analyze" -Result $result)
}

function Invoke-MenuSyncTrackingGapPush([hashtable]$Body) {
	$localApiBaseUrl = Get-BodyStringValue $Body "localApiBaseUrl" "http://localhost:5189"
	$nasApiBaseUrl = Get-BodyStringValue $Body "nasApiBaseUrl" "http://192.168.0.50:6188/api"
	$dateFrom = Get-BodyStringValue $Body "dateFrom" ""
	$dateTo = Get-BodyStringValue $Body "dateTo" ""
	$bundleFileName = Get-BodyStringValue $Body "bundleFileName" ""
	$localBearerToken = Get-BodyStringValue $Body "localBearerToken" ""
	$nasBearerToken = Get-BodyStringValue $Body "nasBearerToken" ""

	$args = @(
		"-LocalApiBaseUrl", $localApiBaseUrl,
		"-NasApiBaseUrl", $nasApiBaseUrl
	)
	if ($dateFrom) { $args += @("-DateFrom", $dateFrom) }
	if ($dateTo) { $args += @("-DateTo", $dateTo) }
	if ($bundleFileName) { $args += @("-BundleFileName", $bundleFileName) }
	if ($localBearerToken) { $args += @("-LocalBearerToken", $localBearerToken) }
	if ($nasBearerToken) { $args += @("-NasBearerToken", $nasBearerToken) }

	$result = Invoke-PwshScriptCapture -ScriptPath $menuSyncTrackingGapPushScript -ArgumentList $args
	if (($result.exitCode ?? 1) -ne 0) {
		throw ("menu_sync_tracking_gap_push_failed: " + [string]($result.output ?? "exit=$($result.exitCode)"))
	}
	return (New-MenuSyncScriptResponse -Action "menu-sync-tracking-gap-push" -Result $result)
}

function Test-PrivateIpv4([string]$IpAddress) {
	if ([string]::IsNullOrWhiteSpace($IpAddress)) { return $false }
	if ($IpAddress -like "127.*" -or $IpAddress -like "169.254.*") { return $false }
	return (
		$IpAddress -like "10.*" -or
		$IpAddress -like "192.168.*" -or
		$IpAddress -match "^172\.(1[6-9]|2[0-9]|3[0-1])\."
	)
}

function Get-CandidateLocalIpv4s {
	$configByIndex = @{}
	try {
		foreach ($cfg in (Get-NetIPConfiguration -ErrorAction SilentlyContinue)) {
			try {
				$idx = [int]$cfg.InterfaceIndex
				if (-not $configByIndex.ContainsKey($idx)) { $configByIndex[$idx] = $cfg }
			} catch {}
		}
	} catch {}

	$rows = New-Object 'System.Collections.Generic.List[object]'
	try {
		$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue
		foreach ($addr in $addresses) {
			$ip = [string]$addr.IPAddress
			if (-not (Test-PrivateIpv4 $ip)) { continue }

			$alias = [string]$addr.InterfaceAlias
			$state = [string]$addr.AddressState
			$prefixOrigin = [string]$addr.PrefixOrigin
			$gateway = ""
			try {
				$cfg = $configByIndex[[int]$addr.InterfaceIndex]
				if ($cfg -and $cfg.IPv4DefaultGateway) {
					$gateway = [string]($cfg.IPv4DefaultGateway.NextHop | Select-Object -First 1)
				}
			} catch {}

			$isVirtual = $alias -match "WSL|Hyper-V|vEthernet|VMware|VirtualBox|Loopback|Tailscale|ZeroTier|Docker"
			$isPreferred = $state -eq "Preferred"
			$isDeprecated = $state -eq "Deprecated"

			$score = 0
			if (-not $isVirtual) { $score += 100 } else { $score -= 100 }
			if ($gateway) { $score += 50 }
			if ($isPreferred) { $score += 40 }
			if ($isDeprecated) { $score -= 20 }
			if ($prefixOrigin -eq "Dhcp") { $score += 10 }
			if ($ip -like "192.168.*") { $score += 5 }

			$rows.Add([pscustomobject]@{
				InterfaceAlias = $alias
				IPAddress = $ip
				AddressState = $state
				HasGateway = [bool]$gateway
				IsVirtual = $isVirtual
				Score = $score
			}) | Out-Null
		}
	} catch {}

	return @(
		$rows |
			Sort-Object -Property `
				@{ Expression = "Score"; Descending = $true }, `
				@{ Expression = "HasGateway"; Descending = $true }, `
				@{ Expression = { $_.AddressState -eq "Preferred" }; Descending = $true }, `
				@{ Expression = "InterfaceAlias"; Descending = $false }, `
				@{ Expression = "IPAddress"; Descending = $false }
	)
}

function Get-PrimaryLocalIpv4 {
	$candidates = @(Get-CandidateLocalIpv4s)
	foreach ($candidate in $candidates) {
		if ($candidate.IsVirtual) { continue }
		if ($candidate.AddressState -ne "Preferred" -and -not $candidate.HasGateway) { continue }
		return [string]$candidate.IPAddress
	}
	if ($candidates.Count -gt 0) { return [string]$candidates[0].IPAddress }
	return $null
}

function Get-LocalChromeProfiles {
	$roots = @(
		"$env:LOCALAPPDATA\\Google\\Chrome\\User Data",
		"$env:LOCALAPPDATA\\Google\\Chrome Beta\\User Data",
		"$env:LOCALAPPDATA\\Google\\Chrome Dev\\User Data",
		"$env:LOCALAPPDATA\\Google\\Chrome SxS\\User Data"
	) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
	$rows = New-Object 'System.Collections.Generic.List[object]'
	foreach ($root in $roots) {
		$localStatePath = Join-Path $root "Local State"
		$infoCache = $null
		try {
			if (Test-Path -LiteralPath $localStatePath) {
				$localState = Get-Content -LiteralPath $localStatePath -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable
				if ($localState.ContainsKey("profile") -and $localState["profile"].ContainsKey("info_cache")) {
					$infoCache = $localState["profile"]["info_cache"]
				}
			}
		} catch {
			$infoCache = $null
		}
		if ($null -ne $infoCache -and $infoCache -is [System.Collections.IDictionary]) {
			foreach ($key in $infoCache.Keys) {
				$profileDir = [string]$key
				$info = $infoCache[$key]
				$name = [string]($info["name"] ?? "")
				$email = [string]($info["user_name"] ?? "")
				$gaiaName = [string]($info["gaia_name"] ?? "")
				$avatar = [string]($info["avatar_icon"] ?? "")
				$label = if (-not [string]::IsNullOrWhiteSpace($email)) { $email } elseif (-not [string]::IsNullOrWhiteSpace($name)) { $name } else { $profileDir }
				$rows.Add([ordered]@{
					source = "chrome"
					userDataDir = $root
					profileDir = $profileDir
					name = $name
					email = $email
					gaiaName = $gaiaName
					label = $label
					avatarIcon = $avatar
					directUseWarning = "일반 Chrome 프로필 직접 사용은 Chrome 종료 상태에서만 안정적입니다. 운영 권장은 이 프로필로 CDP 전용 UserDataDir에 로그인 후 사용하는 방식입니다."
				}) | Out-Null
			}
		}
	}
	return @($rows | Sort-Object -Property label, profileDir)
}

function Get-HostChromeDebugProcesses([int]$port) {
	$needlePort = "--remote-debugging-port=$port"
	return @(
		Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
			Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$needlePort*") }
	)
}

function Test-HostChromeMatchesProfile([int]$port, [string]$userDataDir, [string]$profileDir) {
	$targets = @(Get-HostChromeDebugProcesses -port $port)
	if ($targets.Count -le 0) { return $false }
	$wantUser = Normalize-PathForCompare $userDataDir
	$wantProfile = ([string]$profileDir).Trim()
	if ([string]::IsNullOrWhiteSpace($wantUser) -or [string]::IsNullOrWhiteSpace($wantProfile)) { return $false }
	foreach ($target in $targets) {
		$cmd = [string]($target.CommandLine ?? "")
		if ([string]::IsNullOrWhiteSpace($cmd)) { continue }
		# Do not GetFullPath the whole cmdline; only normalize slashes/case for contains().
		$cmdNorm = (($cmd.ToLowerInvariant()) -replace '\\+', '\')
		$userOk = $cmdNorm.Contains($wantUser)
		$profileOk = (
			($cmd -like "*--profile-directory=`"$wantProfile`"*") -or
			($cmd -like "*--profile-directory=$wantProfile*") -or
			($cmd -match ("--profile-directory=`"?{0}`"?" -f [regex]::Escape($wantProfile)))
		)
		if ($userOk -and $profileOk) { return $true }
	}
	return $false
}

function Stop-HostChromeDebugPort([int]$port) {
	$targets = @(Get-HostChromeDebugProcesses -port $port)
	foreach ($target in $targets) {
		try { Stop-Process -Id ([int]$target.ProcessId) -Force -ErrorAction SilentlyContinue } catch {}
	}
	return $targets.Count
}

function Normalize-PathForCompare([string]$path) {
	if ([string]::IsNullOrWhiteSpace($path)) { return "" }
	$expanded = [Environment]::ExpandEnvironmentVariables($path)
	try { $expanded = [System.IO.Path]::GetFullPath($expanded) } catch {}
	$trimmed = $expanded.TrimEnd([char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar))
	return (($trimmed.ToLowerInvariant()) -replace '\\+', '\')
}

function Get-RegularChromeUserDataDirConflict([string]$userDataDir, [int]$port) {
	$requested = Normalize-PathForCompare $userDataDir
	if ([string]::IsNullOrWhiteSpace($requested)) { return $null }
	$defaultChromeUserDataDir = Normalize-PathForCompare (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data")
	$needlePort = "--remote-debugging-port=$port"
	$processes = @(
		Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
			Where-Object { $_.CommandLine }
	)
	foreach ($process in $processes) {
		$cmd = [string]($process.CommandLine ?? "")
		if ($cmd -like "*$needlePort*") { continue }
		$cmdNorm = (($cmd.ToLowerInvariant()) -replace '\\+', '\')
		$usesRequestedDir = $cmdNorm.Contains($requested)
		if (-not $usesRequestedDir -and $requested -eq $defaultChromeUserDataDir -and $cmd -match 'chrome\.exe') {
			$usesRequestedDir = $true
		}
		if ($usesRequestedDir) { return $process }
	}
	return $null
}

function ConvertTo-ProcessArgumentLine([array]$Arguments) {
	$parts = @(
		foreach ($arg in @($Arguments)) {
			$text = [string]$arg
			if ($text -match '[\s"]') {
				$escaped = $text -replace '"', '\"'
				'"' + $escaped + '"'
			} else {
				$text
			}
		}
	)
	return ($parts -join " ")
}

function Start-HostChrome([int]$port, [string]$startUrl, [string]$profileDir, [bool]$Background = $true) {
	if (Wait-CdpReady -port $port -timeoutMs 800) {
		if (Test-HostChromeMatchesProfile -port $port -userDataDir $script:HostChromeUserDataDir -profileDir $profileDir) {
			Ensure-CdpPageTarget -port $port -startUrl $startUrl | Out-Null
			# Collector jobs minimize the window (Background=true).
			# UI/manual start (Background=false) must restore it — otherwise "CDP closed and cannot reopen".
			if ($Background) { Hide-HostChrome -port $port | Out-Null }
			else { Show-HostChrome -port $port | Out-Null }
			return "reused"
		}
		Write-Warn ("CDP Chrome profile mismatch on port {0}; restarting with requested profile label={1}, dir={2}" -f $port, $script:HostChromeProfileLabel, $profileDir)
		Stop-HostChromeDebugPort -port $port | Out-Null
		Start-Sleep -Seconds 2
	}
	$conflict = Get-RegularChromeUserDataDirConflict -userDataDir $script:HostChromeUserDataDir -port $port
	if ($conflict) {
		throw ("cdp_profile_in_use_by_regular_chrome: close all regular Chrome windows for UserDataDir={0} before starting CDP. conflictingPid={1}" -f $script:HostChromeUserDataDir, $conflict.ProcessId)
	}
	$psArgs = @(
		"-NoProfile",
		"-ExecutionPolicy", "Bypass",
		"-File", $startScript,
		"-Port", $port,
		"-UserDataDir", $script:HostChromeUserDataDir,
		"-NoPause"
	)
	if ($Background) { $psArgs += @("-Background") }
	if ($startUrl) { $psArgs += @("-StartUrl", $startUrl) }
	if ($profileDir) { $psArgs += @("-ProfileDir", $profileDir) }
	# Collector 자동 수집에서는 PowerShell 창과 Chrome 창이 전면으로 튀지 않도록 숨김/최소화로 실행한다.
	$windowStyle = if ($Background) { "Hidden" } else { "Normal" }
	$pwshExe = Resolve-PowerShellExe
	Start-Process -FilePath $pwshExe -ArgumentList (ConvertTo-ProcessArgumentLine $psArgs) -WindowStyle $windowStyle | Out-Null
	return "started"
}

function Get-CdpRawTabs([int]$port) {
	$tabsResponse = Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/list" -f $port) -TimeoutSec 3
	$tabs = @($tabsResponse)
	if ($tabs.Count -eq 1 -and $tabs[0] -is [array]) { $tabs = @($tabs[0]) }
	return @($tabs)
}

function Ensure-CdpPageTarget([int]$port, [string]$startUrl = "") {
	$tabs = @(Get-CdpRawTabs -port $port)
	$pages = @($tabs | Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl })
	$page = $pages | Where-Object {
		$url0 = [string]($_.url ?? "")
		-not [string]::IsNullOrWhiteSpace($url0) -and $url0 -ne "about:blank" -and $url0 -notmatch "^chrome://"
	} | Select-Object -First 1
	if (-not $page -and $pages.Count -gt 0) { $page = $pages[0] }

	if (-not [string]::IsNullOrWhiteSpace($startUrl)) {
		if ($page) {
			$currentUrl = [string]($page.url ?? "")
			if ($currentUrl -eq "about:blank" -or [string]::IsNullOrWhiteSpace($currentUrl) -or $currentUrl -notlike "$startUrl*") {
				Invoke-CdpNavigateOnPage -Page $page -url $startUrl
			}
			return $page
		}
		return New-CdpPageForUrl -port $port -url $startUrl
	}

	if ($page) { return $page }
	try {
		Invoke-RestMethod -UseBasicParsing -Method Put -Uri ("http://127.0.0.1:{0}/json/new?about%3Ablank" -f $port) -TimeoutSec 3 | Out-Null
	} catch {
		try { Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/new?about%3Ablank" -f $port) -TimeoutSec 3 | Out-Null } catch {}
	}
	Start-Sleep -Milliseconds 500
	$tabs = @(Get-CdpRawTabs -port $port)
	$page = $tabs | Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl } | Select-Object -First 1
	if (-not $page) { throw "cdp_page_not_found" }
	return $page
}

function Wait-CdpReady([int]$port, [int]$timeoutMs = 6000) {
	# Chrome이 떴더라도 보안SW/정책/프로필 잠금으로 인해 remote-debugging 포트가 안 열리는 경우가 있다.
	# UI가 /json/list를 열기 전에 여기서 "포트 오픈"까지 확인해 착시(접속 불가 페이지)를 방지한다.
	$deadline = (Get-Date).AddMilliseconds($timeoutMs)
	while ((Get-Date) -lt $deadline) {
		try {
			$r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/version" -f $port) -TimeoutSec 1
			if ($r -and $r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return $true }
		} catch {
			# ignore
		}
		Start-Sleep -Milliseconds 250
	}
	return $false
}

function ConvertTo-PlainObject($Value) {
	if ($null -eq $Value) { return $null }
	$json = $Value | ConvertTo-Json -Depth 30 -Compress
	if ([string]::IsNullOrWhiteSpace($json)) { return @{} }
	Write-Output -NoEnumerate ($json | ConvertFrom-Json)
}

function Get-CdpPage([int]$port) {
	$tabsResponse = Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/list" -f $port) -TimeoutSec 3
	$tabs = @($tabsResponse)
	if ($tabs.Count -eq 1 -and $tabs[0] -is [array]) { $tabs = @($tabs[0]) }
	$page = $tabs | Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl } | Select-Object -First 1
	if ($page) { return $page }

	try {
		Invoke-RestMethod -UseBasicParsing -Method Put -Uri ("http://127.0.0.1:{0}/json/new?about%3Ablank" -f $port) -TimeoutSec 3 | Out-Null
	} catch {
		try { Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/new?about%3Ablank" -f $port) -TimeoutSec 3 | Out-Null } catch {}
	}
	Start-Sleep -Milliseconds 500

	$tabsResponse = Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/list" -f $port) -TimeoutSec 3
	$tabs = @($tabsResponse)
	if ($tabs.Count -eq 1 -and $tabs[0] -is [array]) { $tabs = @($tabs[0]) }
	$page = $tabs | Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl } | Select-Object -First 1
	if (-not $page) { throw "cdp_page_not_found" }
	return $page
}

function New-CdpPageForUrl([int]$port, [string]$url) {
	$encoded = [Uri]::EscapeDataString($url)
	try {
		$page = Invoke-RestMethod -UseBasicParsing -Method Put -Uri ("http://127.0.0.1:{0}/json/new?{1}" -f $port, $encoded) -TimeoutSec 5
	} catch {
		$page = Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/new?{1}" -f $port, $encoded) -TimeoutSec 5
	}
	Start-Sleep -Milliseconds 500
	if ($page -and $page.webSocketDebuggerUrl) { return $page }
	$tabsResponse = Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/list" -f $port) -TimeoutSec 3
	$tabs = @($tabsResponse)
	if ($tabs.Count -eq 1 -and $tabs[0] -is [array]) { $tabs = @($tabs[0]) }
	$match = $tabs | Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl -and ([string]$_.url) -eq $url } | Select-Object -First 1
	if ($match) { return $match }
	throw "cdp_new_page_not_found"
}

function Close-CdpPagesByUrlRegex([int]$port, [string]$UrlRegex) {
	try {
		$tabsResponse = Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/list" -f $port) -TimeoutSec 3
		$tabs = @($tabsResponse)
		if ($tabs.Count -eq 1 -and $tabs[0] -is [array]) { $tabs = @($tabs[0]) }
		foreach ($tab in $tabs) {
			$tabId = [string]($tab.id ?? "")
			$tabUrl = [string]($tab.url ?? "")
			$tabType = [string]($tab.type ?? "")
			if ([string]::IsNullOrWhiteSpace($tabId) -or $tabType -ne "page" -or $tabUrl -notmatch $UrlRegex) { continue }
			try {
				Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/close/{1}" -f $port, [Uri]::EscapeDataString($tabId)) -TimeoutSec 3 | Out-Null
			} catch {}
		}
		Start-Sleep -Milliseconds 700
	} catch {}
}

function Invoke-CdpEvaluateOnPage($Page, [string]$expression, [int]$timeoutMs = 30000) {
	$wsUrl = [string]$Page.webSocketDebuggerUrl
	if ([string]::IsNullOrWhiteSpace($wsUrl)) { throw "cdp_websocket_not_found" }
	$client = [System.Net.WebSockets.ClientWebSocket]::new()
	$cts = [Threading.CancellationTokenSource]::new()
	try {
		$cts.CancelAfter($timeoutMs)
		$client.ConnectAsync([Uri]$wsUrl, $cts.Token).GetAwaiter().GetResult()
		$request = @{
			id = 1
			method = "Runtime.evaluate"
			params = @{
				expression = $expression
				returnByValue = $true
				awaitPromise = $true
			}
		} | ConvertTo-Json -Depth 20 -Compress
		$bytes = [Text.Encoding]::UTF8.GetBytes($request)
		$client.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()
		$buffer = New-Object byte[] 65536
		$chunks = New-Object 'System.Collections.Generic.List[string]'
		while ($true) {
			$result = $client.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cts.Token).GetAwaiter().GetResult()
			if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { break }
			$chunks.Add([Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)) | Out-Null
			if ($result.EndOfMessage) {
				$text = ($chunks -join "")
				$chunks.Clear()
				$msg = $text | ConvertFrom-Json
				if ($msg.id -eq 1) {
					$errorProp = $msg.PSObject.Properties["error"]
					if ($null -ne $errorProp) { throw ("cdp_eval_error: " + (($errorProp.Value | ConvertTo-Json -Compress))) }
					$resultProp = $msg.PSObject.Properties["result"]
					$resultObj = if ($null -ne $resultProp) { $resultProp.Value } else { $null }
					if ($null -eq $resultObj) { throw "cdp_eval_missing_result" }
					$topExceptionDetails = if ($null -ne $msg.PSObject.Properties["exceptionDetails"]) { $msg.exceptionDetails } else { $null }
					$resultExceptionDetails = if ($null -ne $resultObj.PSObject.Properties["exceptionDetails"]) { $resultObj.exceptionDetails } else { $null }
					if ($null -ne $topExceptionDetails) { throw ("cdp_eval_exception: " + (($topExceptionDetails | ConvertTo-Json -Compress))) }
					if ($null -ne $resultExceptionDetails) { throw ("cdp_eval_exception: " + (($resultExceptionDetails | ConvertTo-Json -Compress))) }
					$value = $null
					try { $value = $resultObj.result.value } catch { $value = $null }
					$plain = @(ConvertTo-PlainObject $value) | Select-Object -Last 1
					Write-Output -NoEnumerate $plain
					return
				}
			}
		}
		throw "cdp_eval_no_response"
	} catch [System.OperationCanceledException] {
		throw "cdp_eval_timeout"
	} finally {
		try { $cts.Dispose() } catch {}
		try { $client.Dispose() } catch {}
	}
}

function Invoke-CdpEvaluate([int]$port, [string]$expression, [int]$timeoutMs = 30000) {
	$page = Get-CdpPage -port $port
	return Invoke-CdpEvaluateOnPage -Page $page -expression $expression -timeoutMs $timeoutMs
}

function Invoke-CdpNavigateOnPage($Page, [string]$url) {
	if ([string]::IsNullOrWhiteSpace($url)) { return }
	$wsUrl = [string]$Page.webSocketDebuggerUrl
	if ([string]::IsNullOrWhiteSpace($wsUrl)) { throw "cdp_websocket_not_found" }
	$client = [System.Net.WebSockets.ClientWebSocket]::new()
	$cts = [Threading.CancellationTokenSource]::new()
	try {
		$cts.CancelAfter(12000)
		$client.ConnectAsync([Uri]$wsUrl, $cts.Token).GetAwaiter().GetResult()
		Send-CdpWsJson -Client $client -Payload @{ id = 1; method = "Page.enable"; params = @{} } -Token $cts.Token
		Send-CdpWsJson -Client $client -Payload @{ id = 2; method = "Runtime.evaluate"; params = @{ expression = "(() => { try { window.onbeforeunload = null; return true; } catch (e) { return false; } })()"; returnByValue = $true; awaitPromise = $true } } -Token $cts.Token
		Send-CdpWsJson -Client $client -Payload @{ id = 3; method = "Page.navigate"; params = @{ url = $url } } -Token $cts.Token
		$buffer = New-Object byte[] 65536
		$chunks = New-Object 'System.Collections.Generic.List[string]'
		while ($true) {
			$result = $client.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cts.Token).GetAwaiter().GetResult()
			if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { break }
			$chunks.Add([Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)) | Out-Null
			if (-not $result.EndOfMessage) { continue }
			$text = ($chunks -join "")
			$chunks.Clear()
			$msg = $text | ConvertFrom-Json
			if ($msg.id -eq 3) {
				$errorProp = $msg.PSObject.Properties["error"]
				if ($null -ne $errorProp) { throw ("cdp_navigate_error: " + (($errorProp.Value | ConvertTo-Json -Compress))) }
				return
			}
		}
		throw "cdp_navigate_no_response"
	} catch [System.OperationCanceledException] {
		throw "cdp_navigate_timeout"
	} finally {
		try { $cts.Dispose() } catch {}
		try { $client.Dispose() } catch {}
	}
}

function Send-CdpWsJson($Client, [hashtable]$Payload, [Threading.CancellationToken]$Token) {
	$json = $Payload | ConvertTo-Json -Depth 20 -Compress
	$bytes = [Text.Encoding]::UTF8.GetBytes($json)
	$Client.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $Token).GetAwaiter().GetResult()
}

function Invoke-CdpNavigate([int]$port, [string]$url) {
	if ([string]::IsNullOrWhiteSpace($url)) { return }
	$page = Get-CdpPage -port $port
	$client = [System.Net.WebSockets.ClientWebSocket]::new()
	$cts = [Threading.CancellationTokenSource]::new()
	try {
		$cts.CancelAfter(12000)
		$client.ConnectAsync([Uri]([string]$page.webSocketDebuggerUrl), $cts.Token).GetAwaiter().GetResult()
		Send-CdpWsJson -Client $client -Payload @{ id = 1; method = "Page.enable"; params = @{} } -Token $cts.Token
		Send-CdpWsJson -Client $client -Payload @{
			id = 2
			method = "Runtime.evaluate"
			params = @{
				expression = "(() => { try { window.onbeforeunload = null; return true; } catch (e) { return false; } })()"
				returnByValue = $true
				awaitPromise = $true
			}
		} -Token $cts.Token
		Send-CdpWsJson -Client $client -Payload @{ id = 3; method = "Page.navigate"; params = @{ url = $url } } -Token $cts.Token

		$buffer = New-Object byte[] 65536
		$chunks = New-Object 'System.Collections.Generic.List[string]'
		while ($true) {
			$result = $client.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cts.Token).GetAwaiter().GetResult()
			if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { break }
			$chunks.Add([Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)) | Out-Null
			if (-not $result.EndOfMessage) { continue }
			$text = ($chunks -join "")
			$chunks.Clear()
			$msg = $text | ConvertFrom-Json
			if ([string]($msg.method) -eq "Page.javascriptDialogOpening") {
				# GFA edit pages can show "save changes before leaving" prompts between creatives.
				# Accepting the beforeunload dialog allows the collector to leave the current edit page.
				Send-CdpWsJson -Client $client -Payload @{ id = 4; method = "Page.handleJavaScriptDialog"; params = @{ accept = $true } } -Token $cts.Token
				continue
			}
			if ($msg.id -eq 3) {
				$errorProp = $msg.PSObject.Properties["error"]
				if ($null -ne $errorProp) { throw ("cdp_navigate_error: " + (($errorProp.Value | ConvertTo-Json -Compress))) }
				return
			}
		}
		throw "cdp_navigate_no_response"
	} catch [System.OperationCanceledException] {
		throw "cdp_navigate_timeout"
	} finally {
		try { $cts.Dispose() } catch {}
		try { $client.Dispose() } catch {}
	}
}

function Invoke-CdpJsonCommand([string]$wsUrl, [string]$method, [hashtable]$params, [int]$id = 1, [int]$timeoutMs = 5000) {
	if ([string]::IsNullOrWhiteSpace($wsUrl)) { throw "cdp_websocket_not_found" }
	$client = [System.Net.WebSockets.ClientWebSocket]::new()
	$cts = [Threading.CancellationTokenSource]::new()
	try {
		$cts.CancelAfter($timeoutMs)
		$client.ConnectAsync([Uri]$wsUrl, $cts.Token).GetAwaiter().GetResult()
		$request = @{
			id = $id
			method = $method
			params = $params
		} | ConvertTo-Json -Depth 10 -Compress
		$bytes = [Text.Encoding]::UTF8.GetBytes($request)
		$client.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()
		$buffer = New-Object byte[] 65536
		$chunks = New-Object 'System.Collections.Generic.List[string]'
		while ($true) {
			$result = $client.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cts.Token).GetAwaiter().GetResult()
			if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { break }
			$chunks.Add([Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)) | Out-Null
			if (-not $result.EndOfMessage) { continue }
			$text = ($chunks -join "")
			$chunks.Clear()
			$msg = $text | ConvertFrom-Json
			if ($msg.id -ne $id) { continue }
			if ($null -ne $msg.PSObject.Properties["error"]) {
				throw ("cdp_command_error:{0}:{1}" -f $method, (($msg.error | ConvertTo-Json -Compress)))
			}
			return $msg.result
		}
		throw "cdp_command_no_response:$method"
	} catch [System.OperationCanceledException] {
		throw "cdp_command_timeout:$method"
	} finally {
		try { $cts.Dispose() } catch {}
		try { $client.Dispose() } catch {}
	}
}

function Invoke-CdpPageCommand([int]$port, [string]$method, [hashtable]$params, [int]$id = 1, [int]$timeoutMs = 5000) {
	$page = Get-CdpPage -port $port
	$wsUrl = [string]$page.webSocketDebuggerUrl
	if ([string]::IsNullOrWhiteSpace($wsUrl)) { throw "cdp_websocket_not_found" }
	return Invoke-CdpJsonCommand -wsUrl $wsUrl -method $method -params $params -id $id -timeoutMs $timeoutMs
}

function Invoke-CdpTrustedTextInput([int]$port, [string]$Text, [int]$DelayMs = 90) {
	Invoke-CdpPageCommand -port $port -method "Input.dispatchKeyEvent" -params @{
		type = "keyDown"; key = "Control"; code = "ControlLeft"; windowsVirtualKeyCode = 17; nativeVirtualKeyCode = 17; modifiers = 2
	} -id 9301 -timeoutMs 5000 | Out-Null
	Invoke-CdpPageCommand -port $port -method "Input.dispatchKeyEvent" -params @{
		type = "keyDown"; key = "a"; code = "KeyA"; windowsVirtualKeyCode = 65; nativeVirtualKeyCode = 65; modifiers = 2
	} -id 9302 -timeoutMs 5000 | Out-Null
	Invoke-CdpPageCommand -port $port -method "Input.dispatchKeyEvent" -params @{
		type = "keyUp"; key = "a"; code = "KeyA"; windowsVirtualKeyCode = 65; nativeVirtualKeyCode = 65; modifiers = 2
	} -id 9303 -timeoutMs 5000 | Out-Null
	Invoke-CdpPageCommand -port $port -method "Input.dispatchKeyEvent" -params @{
		type = "keyUp"; key = "Control"; code = "ControlLeft"; windowsVirtualKeyCode = 17; nativeVirtualKeyCode = 17; modifiers = 0
	} -id 9304 -timeoutMs 5000 | Out-Null
	Start-Sleep -Milliseconds 80
	Invoke-CdpPageCommand -port $port -method "Input.dispatchKeyEvent" -params @{
		type = "keyDown"; key = "Backspace"; code = "Backspace"; windowsVirtualKeyCode = 8; nativeVirtualKeyCode = 8
	} -id 9305 -timeoutMs 5000 | Out-Null
	Invoke-CdpPageCommand -port $port -method "Input.dispatchKeyEvent" -params @{
		type = "keyUp"; key = "Backspace"; code = "Backspace"; windowsVirtualKeyCode = 8; nativeVirtualKeyCode = 8
	} -id 9306 -timeoutMs 5000 | Out-Null
	Start-Sleep -Milliseconds 120
	foreach ($ch in ([char[]]$Text)) {
		$key = [string]$ch
		$code = ""
		$vk = 0
		if ($key -match "^[0-9]$") {
			$code = "Digit$key"
			$vk = 48 + [int]::Parse($key)
		} elseif ($key -eq ".") {
			$code = "Period"
			$vk = 190
		} else {
			$code = $key
			$vk = [int][char]$key
		}
		Invoke-CdpPageCommand -port $port -method "Input.dispatchKeyEvent" -params @{
			type = "rawKeyDown"; key = $key; code = $code; windowsVirtualKeyCode = $vk; nativeVirtualKeyCode = $vk
		} -id 9307 -timeoutMs 5000 | Out-Null
		Start-Sleep -Milliseconds 25
		Invoke-CdpPageCommand -port $port -method "Input.dispatchKeyEvent" -params @{
			type = "char"; key = $key; code = $code; windowsVirtualKeyCode = $vk; nativeVirtualKeyCode = $vk; text = $key; unmodifiedText = $key
		} -id 9308 -timeoutMs 5000 | Out-Null
		Start-Sleep -Milliseconds 25
		Invoke-CdpPageCommand -port $port -method "Input.dispatchKeyEvent" -params @{
			type = "keyUp"; key = $key; code = $code; windowsVirtualKeyCode = $vk; nativeVirtualKeyCode = $vk
		} -id 9309 -timeoutMs 5000 | Out-Null
		if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
	}
}

function Invoke-CdpTrustedMouseClick([int]$port, [double]$X, [double]$Y) {
	Invoke-CdpPageCommand -port $port -method "Input.dispatchMouseEvent" -params @{
		type = "mouseMoved"; x = $X; y = $Y; button = "none"; buttons = 0
	} -id 9311 -timeoutMs 5000 | Out-Null
	Start-Sleep -Milliseconds 80
	Invoke-CdpPageCommand -port $port -method "Input.dispatchMouseEvent" -params @{
		type = "mousePressed"; x = $X; y = $Y; button = "left"; buttons = 1; clickCount = 1
	} -id 9312 -timeoutMs 5000 | Out-Null
	Start-Sleep -Milliseconds 120
	Invoke-CdpPageCommand -port $port -method "Input.dispatchMouseEvent" -params @{
		type = "mouseReleased"; x = $X; y = $Y; button = "left"; buttons = 0; clickCount = 1
	} -id 9313 -timeoutMs 5000 | Out-Null
}

function Invoke-CdpSetDownloadBehavior([int]$port, [string]$downloadPath) {
	if ([string]::IsNullOrWhiteSpace($downloadPath)) { return }
	if (-not (Test-Path -LiteralPath $downloadPath)) { New-Item -ItemType Directory -Force -Path $downloadPath | Out-Null }
	$successCount = 0
	$errors = New-Object 'System.Collections.Generic.List[string]'
	try {
		$version = Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/version" -f $port) -TimeoutSec 3
		$browserWsUrl = [string]($version.webSocketDebuggerUrl ?? "")
		if (-not [string]::IsNullOrWhiteSpace($browserWsUrl)) {
			foreach ($behavior in @("allow", "allowAndName")) {
				try {
					Invoke-CdpJsonCommand -wsUrl $browserWsUrl -method "Browser.setDownloadBehavior" -params @{
						behavior = $behavior
						downloadPath = $downloadPath
						eventsEnabled = $true
					} -id 9101 -timeoutMs 5000 | Out-Null
					$successCount += 1
					break
				} catch {
					$errors.Add($_.Exception.Message) | Out-Null
				}
			}
		}
	} catch {
		$errors.Add($_.Exception.Message) | Out-Null
	}
	Get-CdpPage -port $port | Out-Null
	$tabsResponse = Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/list" -f $port) -TimeoutSec 3
	$tabs = @($tabsResponse)
	if ($tabs.Count -eq 1 -and $tabs[0] -is [array]) { $tabs = @($tabs[0]) }
	$pages = @($tabs | Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl })
	if ($pages.Count -le 0) { throw "cdp_page_not_found" }
	foreach ($page in $pages) {
		try {
			Invoke-CdpJsonCommand -wsUrl ([string]$page.webSocketDebuggerUrl) -method "Page.setDownloadBehavior" -params @{
				behavior = "allow"
				downloadPath = $downloadPath
			} -id 9102 -timeoutMs 5000 | Out-Null
			$successCount += 1
		} catch {
			$errors.Add($_.Exception.Message) | Out-Null
		}
		try {
			Invoke-CdpJsonCommand -wsUrl ([string]$page.webSocketDebuggerUrl) -method "Runtime.evaluate" -params @{
				expression = "try{ if (navigator.permissions && navigator.permissions.query) { void navigator.permissions.query({name:'automatic-downloads'}).catch(()=>{}); } }catch(e){} true"
				returnByValue = $true
			} -id 9103 -timeoutMs 5000 | Out-Null
		} catch {}
	}
	if ($successCount -le 0) {
		$detail = (($errors | Select-Object -First 5) -join " | ")
		if ([string]::IsNullOrWhiteSpace($detail)) { $detail = "no_successful_cdp_download_behavior_call" }
		throw "cdp_download_behavior_not_applied: $detail"
	}
}

function Invoke-LocalPageMetricsScrape([int]$port, [string]$url) {
	$urlJson = $url | ConvertTo-Json -Compress
	try {
		$page0 = Get-CdpPage -port $port
		$currentUrl = [string]($page0.url ?? "")
		if (-not [string]::IsNullOrWhiteSpace($url) -and $currentUrl -ne $url) {
			Invoke-CdpNavigate -port $port -url $url
			Start-Sleep -Milliseconds 5500
		} else {
			Start-Sleep -Milliseconds 800
		}
	} catch {
		Start-Sleep -Milliseconds 1500
	}
	$expression = @"
(async () => {
  const targetUrl = $urlJson;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await sleep(1200);
  const text = document.body ? (document.body.innerText || '') : '';
  const pageUrl = location.href || '';
  const meta = (name) => document.querySelector('meta[property="' + name + '"],meta[name="' + name + '"]')?.content || null;
  const num = (v) => {
    const s = String(v || '').replace(/[^0-9]/g, '');
    return s ? Number(s) : null;
  };
  const findNum = (patterns) => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1]) return num(m[1]);
    }
    return null;
  };
  const title = meta('og:title') || document.title || null;
  const price = num(meta('product:price:amount')) || findNum([/([0-9,]+)\s*원/]);
  const review_count = findNum([/리뷰\s*([0-9,]+)/, /상품리뷰\s*([0-9,]+)/, /방문자리뷰\s*([0-9,]+)/]);
  const ratingMatch = text.match(/(?:평점|별점)\s*([0-9]+(?:\.[0-9]+)?)/);
  const rating = ratingMatch ? Number(ratingMatch[1]) : null;
  const wish_count = findNum([/찜\s*([0-9,]+)/, /관심상품\s*([0-9,]+)/]);
  const recentPurchase = findNum([/최근\s*([0-9,]+)\s*(?:건\s*)?구매/, /([0-9,]+)\s*(?:건\s*)?구매/]);
  const humanActionPatterns = [
    ['login_required', /로그인|sign\s*in|login/i],
    ['security_check', /보안\s*확인|자동입력|captcha|캡차|로봇이 아닙니다/i],
    ['blocked', /서비스\s*접속이\s*불가능|접속이\s*불가능|비정상적인\s*접근/i]
  ];
  let human_action_reason = null;
  for (const [reason, pattern] of humanActionPatterns) {
    const bodyMatch = reason !== 'login_required' && pattern.test(text);
    if (bodyMatch || pattern.test(String(title || '')) || pattern.test(pageUrl)) {
      human_action_reason = reason;
      break;
    }
  }
  return {
    title,
    page_url: pageUrl,
    price,
    review_count,
    rating,
    delivery: null,
    buy_count: null,
    wish_count,
    registered_date: null,
    recent_purchase_count: recentPurchase,
    recent_purchase_window: recentPurchase === null ? null : 'unknown',
    recent_purchase_status: recentPurchase === null ? 'not_visible' : 'collected',
    recent_purchase_7d_count: null,
    recent_repurchase_count: null,
    recent_repurchase_window: null,
    recent_repurchase_3m_count: null,
    recent_badge_text: null,
    http_status: 200,
    human_action_required: human_action_reason !== null,
    human_action_reason,
    body_sample: text.slice(0, 500),
    error: human_action_reason === null ? null : human_action_reason,
    via: 'local_collector_cdp_dom'
  };
})()
"@
	$lastError = $null
	for ($i = 1; $i -le 5; $i++) {
		try {
			$evaluated = @(Invoke-CdpEvaluate -port $port -expression $expression -timeoutMs 45000) | Select-Object -Last 1
			Write-Output -NoEnumerate $evaluated
			return
		} catch {
			$lastError = $_.Exception.Message
			if ($lastError -notmatch "Inspected target navigated or closed|-32000|cdp_eval_missing_result|cdp_websocket_not_found|cdp_eval_no_response") {
				throw
			}
			Write-Info ("page_metrics_cdp_retry: attempt={0}, error={1}" -f $i, $lastError)
			try {
				if (-not [string]::IsNullOrWhiteSpace($url)) { Invoke-CdpNavigate -port $port -url $url }
			} catch {}
			Start-Sleep -Milliseconds (1500 + ($i * 1000))
		}
	}
	throw $lastError
}

function New-CollectorApiHeaders([string]$BearerToken, [string]$ContentType = "") {
	$headers = @{}
	if (-not [string]::IsNullOrWhiteSpace($BearerToken)) { $headers["Authorization"] = "Bearer $BearerToken" }
	if (-not [string]::IsNullOrWhiteSpace($script:CollectorWorkerToken)) { $headers["X-Analytics-Collector-Token"] = $script:CollectorWorkerToken }
	if (-not [string]::IsNullOrWhiteSpace($ContentType)) { $headers["Content-Type"] = $ContentType }
	return $headers
}

function Submit-CollectorResult([string]$ApiBaseUrl, [string]$JobId, [string]$BearerToken, [string]$Url, $Metrics) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl) -or [string]::IsNullOrWhiteSpace($JobId)) { return $false }
	$headers = New-CollectorApiHeaders -BearerToken $BearerToken
	$body = @{
		results = @(
			@{
				url = $Url
				ok = $true
				metrics = $Metrics
			}
		)
	} | ConvertTo-Json -Depth 20 -Compress
	Invoke-RestMethod -Method Post -Uri ($ApiBaseUrl.TrimEnd("/") + "/search-rank/page-metrics/local-collector/jobs/$JobId/results") -ContentType "application/json" -Headers $headers -Body $body -TimeoutSec 30 | Out-Null
	return $true
}

function Submit-CollectorResults([string]$ApiBaseUrl, [string]$JobId, [string]$BearerToken, [array]$Results) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl) -or [string]::IsNullOrWhiteSpace($JobId)) { return $false }
	$headers = New-CollectorApiHeaders -BearerToken $BearerToken
	$body = @{ results = @($Results) } | ConvertTo-Json -Depth 30 -Compress
	Invoke-RestMethod -Method Post -Uri ($ApiBaseUrl.TrimEnd("/") + "/search-rank/page-metrics/local-collector/jobs/$JobId/results") -ContentType "application/json" -Headers $headers -Body $body -TimeoutSec 180 | Out-Null
	return $true
}

function Submit-CollectorPartialResults([string]$ApiBaseUrl, [string]$JobId, [string]$BearerToken, [array]$Results) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl) -or [string]::IsNullOrWhiteSpace($JobId)) { return $false }
	if ($null -eq $Results -or @($Results).Count -le 0) { return $true }
	$headers = New-CollectorApiHeaders -BearerToken $BearerToken
	$body = @{ results = @($Results) } | ConvertTo-Json -Depth 30 -Compress
	return Invoke-RestMethod -Method Post -Uri ($ApiBaseUrl.TrimEnd("/") + "/search-rank/page-metrics/local-collector/jobs/$JobId/partial-results") -ContentType "application/json" -Headers $headers -Body $body -TimeoutSec 120
}

function Submit-AdRankDiagnosisPartialResults([string]$ApiBaseUrl, [string]$JobId, [string]$BearerToken, [string]$Url, [hashtable]$Metrics, [bool]$Ok, [string]$ErrorMessage = "") {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl) -or [string]::IsNullOrWhiteSpace($JobId)) { return $null }
	$headers = New-CollectorApiHeaders -BearerToken $BearerToken
	$item = @{
		url = $Url
		ok = $Ok
		metrics = $Metrics
	}
	if (-not [string]::IsNullOrWhiteSpace($ErrorMessage)) { $item["error"] = $ErrorMessage }
	$body = @{ results = @($item) } | ConvertTo-Json -Depth 30 -Compress
	return Invoke-RestMethod -Method Post -Uri ($ApiBaseUrl.TrimEnd("/") + "/search-rank/page-metrics/local-collector/jobs/$JobId/partial-results") -ContentType "application/json" -Headers $headers -Body $body -TimeoutSec 60
}

function Submit-GfaCampaignInventorySnapshot([string]$ApiBaseUrl, [string]$BearerToken, [string]$AdAccountNo, [string]$CampaignType, [string]$MenuLabel, [array]$Items) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl)) { throw "api_base_url_required" }
	$headers = New-CollectorApiHeaders -BearerToken $BearerToken
	$cleanItems = @(
		foreach ($item in @($Items)) {
			@{
				campaign_id = Get-MetricString $item "campaign_id"
				campaign_name = Get-MetricString $item "campaign_name"
				campaign_type = [string]$CampaignType
				menu_label = [string]$MenuLabel
				status = Get-MetricString $item "status"
				onoff = Get-MetricString $item "onoff"
				daily_budget = Get-MetricString $item "daily_budget"
			}
		}
	)
	$body = @{
		ad_account_no = $AdAccountNo
		campaign_type = $CampaignType
		menu_label = $MenuLabel
		items = @($cleanItems)
	} | ConvertTo-Json -Depth 30 -Compress
	return Invoke-RestMethod -Method Post -Uri ($ApiBaseUrl.TrimEnd("/") + "/gfa/campaigns/inventory/snapshot") -ContentType "application/json" -Headers $headers -Body $body -TimeoutSec 90
}

function Submit-GfaAdgroupInventorySnapshot([string]$ApiBaseUrl, [string]$BearerToken, [string]$AdAccountNo, [string]$CampaignType, [string]$MenuLabel, [array]$Items) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl)) { throw "api_base_url_required" }
	$headers = New-CollectorApiHeaders -BearerToken $BearerToken
	$cleanItems = @(
		foreach ($item in @($Items)) {
			@{
				campaign_id = Get-MetricString $item "campaign_id"
				campaign_name = Get-MetricString $item "campaign_name"
				adgroup_id = Get-MetricString $item "adgroup_id"
				adgroup_name = Get-MetricString $item "adgroup_name"
				campaign_type = [string]$CampaignType
				menu_label = [string]$MenuLabel
				status = Get-MetricString $item "status"
				onoff = Get-MetricString $item "onoff"
				daily_budget = Get-MetricString $item "daily_budget"
			}
		}
	)
	$body = @{
		ad_account_no = $AdAccountNo
		campaign_type = $CampaignType
		menu_label = $MenuLabel
		items = @($cleanItems)
	} | ConvertTo-Json -Depth 30 -Compress
	return Invoke-RestMethod -Method Post -Uri ($ApiBaseUrl.TrimEnd("/") + "/gfa/adgroups/inventory/snapshot") -ContentType "application/json" -Headers $headers -Body $body -TimeoutSec 90
}

function Test-CollectorJobCancelled([string]$ApiBaseUrl, [string]$JobId, [string]$BearerToken) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl) -or [string]::IsNullOrWhiteSpace($JobId)) { return $false }
	try {
		$headers = New-CollectorApiHeaders -BearerToken $BearerToken
		$job = Invoke-RestMethod -Method Get -Uri ($ApiBaseUrl.TrimEnd("/") + "/search-rank/page-metrics/local-collector/jobs/$JobId") -Headers $headers -TimeoutSec 10
		return ([string]($job.status) -eq "CANCELLED")
	} catch {
		return $false
	}
}

function Get-PurchaseKeywordTargetDate([string]$Url) {
	try {
		if ($Url -match "analyticsCollectDate=([0-9]{4}-[0-9]{2}-[0-9]{2})") { return $Matches[1] }
		if ($Url -match "date=([0-9]{4}-[0-9]{2}-[0-9]{2})") { return $Matches[1] }
	} catch {}
	return (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
}

function Get-AdsSearchwordReportRange([string]$Url) {
	$out = @{ dateFrom = ""; dateTo = "" }
	try {
		if ($Url -match "analyticsSearchwordDateFrom=([0-9]{4}-[0-9]{2}-[0-9]{2})") { $out.dateFrom = $Matches[1] }
		if ($Url -match "analyticsSearchwordDateTo=([0-9]{4}-[0-9]{2}-[0-9]{2})") { $out.dateTo = $Matches[1] }
	} catch {}
	if ([string]::IsNullOrWhiteSpace([string]$out.dateFrom)) { $out.dateFrom = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd") }
	if ([string]::IsNullOrWhiteSpace([string]$out.dateTo)) { $out.dateTo = [string]$out.dateFrom }
	return $out
}

function Remove-AdsSearchwordReportRangeParams([string]$Url) {
	try {
		if ([string]::IsNullOrWhiteSpace($Url)) { return $Url }
		$uri = [Uri]$Url
		$pairs = @()
		foreach ($part in ([string]$uri.Query).TrimStart("?").Split("&", [System.StringSplitOptions]::RemoveEmptyEntries)) {
			if ($part -notmatch "^analyticsSearchwordDate(From|To)=") { $pairs += $part }
		}
		$query = if ($pairs.Count -gt 0) { "?" + ($pairs -join "&") } else { "" }
		return $uri.GetLeftPart([System.UriPartial]::Path) + $query + $uri.Fragment
	} catch {
		return ([string]$Url -replace "([?&])analyticsSearchwordDate(From|To)=[0-9]{4}-[0-9]{2}-[0-9]{2}", '$1').TrimEnd("?","&")
	}
}

function Get-AdsCreativeReportRange([string]$Url) {
	$out = @{ dateFrom = ""; dateTo = "" }
	try {
		if ($Url -match "analyticsCreativeDateFrom=([0-9]{4}-[0-9]{2}-[0-9]{2})") { $out.dateFrom = $Matches[1] }
		if ($Url -match "analyticsCreativeDateTo=([0-9]{4}-[0-9]{2}-[0-9]{2})") { $out.dateTo = $Matches[1] }
	} catch {}
	if ([string]::IsNullOrWhiteSpace([string]$out.dateFrom)) { $out.dateFrom = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd") }
	if ([string]::IsNullOrWhiteSpace([string]$out.dateTo)) { $out.dateTo = [string]$out.dateFrom }
	return $out
}

function Remove-AdsCreativeReportRangeParams([string]$Url) {
	try {
		if ([string]::IsNullOrWhiteSpace($Url)) { return $Url }
		$uri = [Uri]$Url
		$pairs = @()
		foreach ($part in ([string]$uri.Query).TrimStart("?").Split("&", [System.StringSplitOptions]::RemoveEmptyEntries)) {
			if ($part -notmatch "^analyticsCreativeDate(From|To)=") { $pairs += $part }
		}
		$query = if ($pairs.Count -gt 0) { "?" + ($pairs -join "&") } else { "" }
		return $uri.GetLeftPart([System.UriPartial]::Path) + $query + $uri.Fragment
	} catch {
		return ([string]$Url -replace "([?&])analyticsCreativeDate(From|To)=[0-9]{4}-[0-9]{2}-[0-9]{2}", '$1').TrimEnd("?","&")
	}
}

function Get-GfaCampaignInventoryUrlMeta([string]$Url) {
	$out = @{ adAccountNo = ""; campaignType = "website_conversion"; menuLabel = "웹사이트 전환" }
	try {
		if ($Url -match "/ad-accounts/([0-9]+)") { $out.adAccountNo = $Matches[1] }
		if ($Url -match "(?:[?&])analyticsGfaAdAccountNo=([^&]+)") { $out.adAccountNo = [System.Uri]::UnescapeDataString($Matches[1]) }
		if ($Url -match "(?:[?&])analyticsGfaInventoryType=([^&]+)") { $out.campaignType = [System.Uri]::UnescapeDataString($Matches[1]) }
		if ($Url -match "(?:[?&])analyticsGfaInventoryMenuLabel=([^&]+)") { $out.menuLabel = [System.Uri]::UnescapeDataString($Matches[1]) }
	} catch {}
	return $out
}

function Get-GfaAdgroupInventoryUrlMeta([string]$Url) {
	$out = @{ adAccountNo = ""; campaignType = "website_conversion"; menuLabel = "웹사이트 전환" }
	try {
		if ($Url -match "/ad-accounts/([0-9]+)") { $out.adAccountNo = $Matches[1] }
		if ($Url -match "(?:[?&])analyticsGfaAdAccountNo=([^&]+)") { $out.adAccountNo = [System.Uri]::UnescapeDataString($Matches[1]) }
		if ($Url -match "(?:[?&])analyticsGfaInventoryType=([^&]+)") { $out.campaignType = [System.Uri]::UnescapeDataString($Matches[1]) }
		if ($Url -match "(?:[?&])analyticsGfaInventoryMenuLabel=([^&]+)") { $out.menuLabel = [System.Uri]::UnescapeDataString($Matches[1]) }
	} catch {}
	return $out
}

function Invoke-GfaCampaignInventoryCollect([int]$port, [string]$url, [string]$CampaignType, [string]$MenuLabel) {
	$campaignTypeJson = ($CampaignType | ConvertTo-Json -Compress)
	$menuLabelJson = ($MenuLabel | ConvertTo-Json -Compress)
	$expression = @"
(async () => {
  const campaignType = $campaignTypeJson || 'website_conversion';
  const menuLabel = $menuLabelJson || '웹사이트 전환';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const txt = (el) => (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
  const compact = (value) => String(value || '').replace(/\s+/g, '').trim();
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const bodyText = () => txt(document.body || document.documentElement);
  const stageLog = [];
  const loginMarkers = ['로그인', 'Login', 'NAVER 로그인', '아이디', '비밀번호'];

  if (loginMarkers.some((marker) => bodyText().includes(marker)) && !location.href.includes('/campaigns-by/')) {
    return { ok: false, human_action_required: true, human_action_reason: 'login_required', items: [], stage_log: ['login_required'], page_url: location.href, title: document.title, body_sample: bodyText().slice(0, 900), error: 'login_required', via: 'naver_gfa_campaign_inventory_cdp' };
  }

  const extractId = (href, rowText) => {
    const source = String(href || '') + ' ' + String(rowText || '');
    const patterns = [/campaign(?:Id|No)?[=/:-]([0-9]+)/i, /campaigns\/([0-9]+)/i, /\/campaign\/([0-9]+)/i, /[?&]id=([0-9]+)/i];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match && match[1]) return match[1];
    }
    return '';
  };
  const normalizeName = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const clickElement = async (el) => {
    if (!el) return false;
    let target = el;
    for (let i = 0; i < 6 && target; i += 1) {
      const tag = String(target.tagName || '').toLowerCase();
      const role = String(target.getAttribute?.('role') || '').toLowerCase();
      const cls = String(target.className || '');
      if (tag === 'button' || tag === 'a' || role === 'button' || /btn|button|select|dropdown/i.test(cls)) break;
      if (!target.parentElement) break;
      target = target.parentElement;
    }
    try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    try { target.focus?.(); } catch (e) {}
    try {
      const rect = target.getBoundingClientRect();
      const x = Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
      const pointTarget = document.elementFromPoint(x, y) || target;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        try {
          const evt = type.startsWith('pointer') && typeof PointerEvent !== 'undefined'
            ? new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true })
            : new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 });
          pointTarget.dispatchEvent(evt);
        } catch (e) {}
      }
      try { pointTarget.click?.(); } catch (e) {}
      if (pointTarget !== target) {
        try { target.click?.(); } catch (e) {}
      }
    } catch (e) {
      try { target.click?.(); } catch (e2) {}
    }
    await sleep(900);
    return true;
  };
  const filterTriggerCandidates = () => Array.from(document.querySelectorAll('button,a,[role="button"],input,div,span,label'))
    .filter(visible)
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const rawText = txt(el);
      const rawCompact = compact(rawText);
      const hay = rawCompact + ' ' + compact(String(el.className || '')) + ' ' + compact(String(el.getAttribute?.('aria-label') || '')) + ' ' + compact(String(el.getAttribute?.('title') || ''));
      const tag = String(el.tagName || '').toLowerCase();
      const role = String(el.getAttribute?.('role') || '').toLowerCase();
      let score = 0;
      if (rawCompact.replace(/\//g, '') === 'ONOFF') score += 1200;
      else if (/ON\/?OFF/i.test(rawText)) score += 700;
      if (/ONOFF/.test(hay.replace(/\//g, ''))) score += 200;
      if (tag === 'button' || tag === 'a' || role === 'button') score += 220;
      if (/select|dropdown|filter|btn|button/i.test(String(el.className || ''))) score += 120;
      if (rect.top <= Math.max(220, window.innerHeight * 0.4)) score += 180;
      if (rect.width >= 40 && rect.width <= 240 && rect.height >= 18 && rect.height <= 60) score += 100;
      return { el, rect, rawText, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  const filterPopupRoots = () => Array.from(document.querySelectorAll('[role="dialog"],[role="listbox"],[role="menu"],[aria-modal="true"],body > div,body > section,body > aside'))
    .filter(visible)
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const text = compact(txt(el));
      return { el, rect, text };
    })
    .filter((x) => x.rect.width >= 120 && x.rect.height >= 120)
    .filter((x) => /ON/.test(x.text) && /OFF/.test(x.text))
    .filter((x) => /확인|취소/.test(x.text))
    .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
  const readSelectionState = (el) => {
    const queue = [el];
    if (el?.parentElement) queue.push(el.parentElement);
    if (el?.closest) {
      const closest = el.closest('label,li,button,a,[role="option"],[role="menuitemcheckbox"],[role="checkbox"],div');
      if (closest && !queue.includes(closest)) queue.push(closest);
    }
    for (const node of queue) {
      if (!node) continue;
      const ariaChecked = node.getAttribute?.('aria-checked');
      if (ariaChecked === 'true') return true;
      if (ariaChecked === 'false') return false;
      const ariaSelected = node.getAttribute?.('aria-selected');
      if (ariaSelected === 'true') return true;
      if (ariaSelected === 'false') return false;
      if (node.tagName === 'INPUT' && String(node.type || '').toLowerCase() === 'checkbox') return !!node.checked;
      const cb = node.querySelector?.('input[type="checkbox"],[role="checkbox"]');
      if (cb) {
        const cbChecked = cb.getAttribute?.('aria-checked');
        if (cbChecked === 'true') return true;
        if (cbChecked === 'false') return false;
        if (cb.tagName === 'INPUT') return !!cb.checked;
      }
      const cls = String(node.className || '');
      if (/selected|checked|active/.test(cls)) return true;
    }
    return null;
  };
  const ensureCampaignOnOffFilter = async () => {
    const rows = [...document.querySelectorAll('table tbody tr, [role="row"]')].filter(visible);
    let onCount = 0;
    let offCount = 0;
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td, [role="cell"], [role="gridcell"]')].filter(visible);
      const onoff = onoffFromRow(row, cells);
      if (onoff === 'ON') onCount += 1;
      if (onoff === 'OFF') offCount += 1;
    }
    stageLog.push('campaign_default_list_onoff_detected:ON=' + onCount + ',OFF=' + offCount);
    if (onCount <= 0 && offCount <= 0) {
      stageLog.push('campaign_default_list_onoff_not_detected');
      return { ok: true, warning: 'gfa_campaign_default_onoff_not_detected', on_count: 0, off_count: 0 };
    }
    if (onCount <= 0 || offCount <= 0) {
      stageLog.push('campaign_default_list_not_mixed_onoff_warning');
    }
    return { ok: true, on_count: onCount, off_count: offCount, default_all_campaigns_assumed: true };
  };
  const looksLikeCampaignName = (value) => {
    const v = normalizeName(value);
    if (!v || v.length < 2) return false;
    if (/^(ON|OFF|켜짐|꺼짐|운영중|운영가능|운영불가|운영 불가|중지|종료|삭제)$/i.test(v)) return false;
    if (/^(캠페인 이름|상태|결과|총비용|노출수|클릭수|예산)$/.test(v)) return false;
    return true;
  };
  const statusFromCells = (cells) => {
    for (const cell of cells) {
      const v = txt(cell);
      const match = v.match(/(운영\s*가능|운영\s*중|운영\s*불가|중지|종료|삭제|비운영)/);
      if (match) return match[1].replace(/\s+/g, '');
    }
    return '';
  };
  const onoffFromRow = (row, cells) => {
    const toggle = row.querySelector('[role="switch"], input[type="checkbox"], button[aria-checked], [aria-pressed]');
    if (toggle) {
      const checked = toggle.getAttribute('aria-checked') || toggle.getAttribute('aria-pressed') || toggle.checked;
      if (String(checked).toLowerCase() === 'true') return 'ON';
      if (String(checked).toLowerCase() === 'false') return 'OFF';
    }
    for (const cell of cells.slice(0, 2)) {
      const v = txt(cell);
      if (/\bON\b|켜짐/i.test(v)) return 'ON';
      if (/\bOFF\b|꺼짐/i.test(v)) return 'OFF';
    }
    return '';
  };
  const budgetFromCells = (cells) => {
    for (const cell of cells) {
      const v = txt(cell);
      if (/예산|일예산|₩|원/.test(v) && /[0-9]/.test(v)) return v;
    }
    return '';
  };
  const collectVisibleRows = () => {
    const rows = [...document.querySelectorAll('table tbody tr, [role="row"]')].filter(visible);
    const items = [];
    const seen = new Set();
    for (const row of rows) {
      const rowText = txt(row);
      if (!rowText || /캠페인 이름.*상태/.test(rowText)) continue;
      const cells = [...row.querySelectorAll('td, [role="cell"], [role="gridcell"]')].filter(visible);
      const linkCandidates = [...row.querySelectorAll('a[href]')].filter(visible);
      let nameLink = linkCandidates.find((a) => /campaign/i.test(a.href || '') && looksLikeCampaignName(txt(a))) || linkCandidates.find((a) => looksLikeCampaignName(txt(a)));
      let campaignName = nameLink ? normalizeName(txt(nameLink)) : '';
      if (!campaignName) {
        const cellNames = cells.map((cell) => txt(cell)).filter(looksLikeCampaignName);
        campaignName = normalizeName(cellNames[0] || '');
      }
      if (!campaignName) continue;
      const href = nameLink ? nameLink.href : '';
      const campaignId = extractId(href, rowText);
      const key = String(campaignId || '') + ':' + campaignName;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        campaign_id: campaignId || null,
        campaign_name: campaignName,
        campaign_type: campaignType,
        menu_label: menuLabel,
        status: statusFromCells(cells) || null,
        onoff: onoffFromRow(row, cells) || null,
        daily_budget: budgetFromCells(cells) || null
      });
    }
    return items;
  };
  const findNextButton = () => {
    const candidates = [...document.querySelectorAll('button, a, [role="button"]')].filter(visible);
    return candidates.find((el) => {
      const label = (txt(el) + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).trim();
      if (!/(다음|Next|›|>)/i.test(label)) return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      if (/disabled/i.test(String(el.className || ''))) return false;
      return true;
    }) || null;
  };

  await sleep(1200);
  const onoffFilter = await ensureCampaignOnOffFilter();
  if (onoffFilter.warning) stageLog.push(String(onoffFilter.warning));
  const all = [];
  const seen = new Set();
  for (let page = 1; page <= 20; page += 1) {
    const rows = collectVisibleRows();
    for (const item of rows) {
      const key = String(item.campaign_id || '') + ':' + item.campaign_name;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(item);
      }
    }
    stageLog.push('page_' + page + ':rows=' + rows.length + ',total=' + all.length);
    const next = findNextButton();
    if (!next) break;
    const before = bodyText().slice(0, 3000);
    try {
      await clickElement(next);
    } catch (e) {
      stageLog.push('next_click_failed:' + String(e && e.message || e).slice(0, 120));
      break;
    }
    await sleep(1800);
    if (bodyText().slice(0, 3000) === before) break;
  }

  if (all.length <= 0) {
    const sample = bodyText();
    const loginRequired = loginMarkers.some((marker) => sample.includes(marker));
    return { ok: false, human_action_required: loginRequired, human_action_reason: loginRequired ? 'login_required' : null, items: [], campaign_type: campaignType, menu_label: menuLabel, stage_log: stageLog, page_url: location.href, title: document.title, body_sample: sample.slice(0, 900), error: loginRequired ? 'login_required' : 'gfa_campaign_inventory_rows_not_found', via: 'naver_gfa_campaign_inventory_cdp' };
  }
  const visibilitySummary = {
    on_count: all.filter((item) => String(item.onoff || '').toUpperCase() === 'ON').length,
    off_count: all.filter((item) => String(item.onoff || '').toUpperCase() === 'OFF').length,
    active_status_count: all.filter((item) => /운영가능|운영중/.test(String(item.status || ''))).length,
    inactive_status_count: all.filter((item) => /운영불가|중지|종료|삭제|비운영/.test(String(item.status || ''))).length,
  };
  stageLog.push('campaign_inventory_visibility_summary:' + JSON.stringify(visibilitySummary));
  if (visibilitySummary.on_count <= 0 || visibilitySummary.off_count <= 0) {
    stageLog.push('campaign_inventory_visibility_summary_warning');
  }
  return { ok: true, items: all, campaign_type: campaignType, menu_label: menuLabel, count: all.length, visibility_summary: visibilitySummary, stage_log: stageLog, page_url: location.href, title: document.title, body_sample: bodyText().slice(0, 900), error: null, via: 'naver_gfa_campaign_inventory_cdp' };
})()
"@
	$jsonExpression = "(async () => JSON.stringify(await (" + $expression + ")))()"
	$lastError = $null
	for ($i = 1; $i -le 4; $i++) {
		try {
			$evaluatedJson = [string](@(Invoke-CdpEvaluate -port $port -expression $jsonExpression -timeoutMs 90000) | Select-Object -Last 1)
			$evaluated = $evaluatedJson | ConvertFrom-Json
			Write-Output -NoEnumerate $evaluated
			return
		} catch {
			$lastError = $_.Exception.Message
			if ($lastError -notmatch "Inspected target navigated or closed|-32000|cdp_eval_missing_result|cdp_websocket_not_found|cdp_eval_no_response|cdp_eval_timeout") { throw }
			Write-Info ("gfa_campaign_inventory_cdp_retry: attempt={0}, error={1}" -f $i, $lastError)
			try { if (-not [string]::IsNullOrWhiteSpace($url)) { Invoke-CdpNavigate -port $port -url $url } } catch {}
			Start-Sleep -Milliseconds (1500 + ($i * 1000))
		}
	}
	throw $lastError
}

function Invoke-GfaAdgroupInventoryCollect([int]$port, [string]$url, [string]$CampaignType, [string]$MenuLabel) {
	$campaignTypeJson = ($CampaignType | ConvertTo-Json -Compress)
	$menuLabelJson = ($MenuLabel | ConvertTo-Json -Compress)
	$expression = @"
(async () => {
  const campaignType = $campaignTypeJson || 'website_conversion';
  const menuLabel = $menuLabelJson || '웹사이트 전환';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const txt = (el) => (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const bodyText = () => txt(document.body || document.documentElement);
  const stageLog = [];
  const loginMarkers = ['로그인', 'Login', 'NAVER 로그인', '아이디', '비밀번호'];

  if (loginMarkers.some((marker) => bodyText().includes(marker)) && !location.href.includes('/adgroups-by/')) {
    return { ok: false, human_action_required: true, human_action_reason: 'login_required', items: [], stage_log: ['login_required'], page_url: location.href, title: document.title, body_sample: bodyText().slice(0, 900), error: 'login_required', via: 'naver_gfa_adgroup_inventory_cdp' };
  }

  const normalizeName = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const extractId = (href, rowText, kind) => {
    const source = String(href || '') + ' ' + String(rowText || '');
    const patterns = kind === 'campaign'
      ? [/campaign(?:Id|No)?[=/:-]([0-9]+)/i, /campaigns\/([0-9]+)/i, /\/campaign\/([0-9]+)/i]
      : [/adgroup(?:Id|No)?[=/:-]([0-9]+)/i, /adgroups\/([0-9]+)/i, /\/adgroup\/([0-9]+)/i, /[?&]adGroupId=([0-9]+)/i];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match && match[1]) return match[1];
    }
    return '';
  };
  const looksLikeEntityName = (value) => {
    const v = normalizeName(value);
    if (!v || v.length < 2) return false;
    if (/^(ON|OFF|켜짐|꺼짐|운영중|운영가능|운영불가|운영 불가|중지|종료|삭제)$/i.test(v)) return false;
    if (/^(캠페인 이름|광고그룹 이름|광고 그룹 이름|상태|결과|총비용|노출수|클릭수|예산)$/.test(v)) return false;
    return true;
  };
  const statusFromCells = (cells) => {
    for (const cell of cells) {
      const v = txt(cell);
      const match = v.match(/(운영\s*가능|운영\s*중|운영\s*불가|중지|종료|삭제|비운영)/);
      if (match) return match[1].replace(/\s+/g, '');
    }
    return '';
  };
  const onoffFromRow = (row, cells) => {
    const toggle = row.querySelector('[role="switch"], input[type="checkbox"], button[aria-checked], [aria-pressed]');
    if (toggle) {
      const checked = toggle.getAttribute('aria-checked') || toggle.getAttribute('aria-pressed') || toggle.checked;
      if (String(checked).toLowerCase() === 'true') return 'ON';
      if (String(checked).toLowerCase() === 'false') return 'OFF';
    }
    for (const cell of cells.slice(0, 2)) {
      const v = txt(cell);
      if (/\bON\b|켜짐/i.test(v)) return 'ON';
      if (/\bOFF\b|꺼짐/i.test(v)) return 'OFF';
    }
    return '';
  };
  const budgetFromCells = (cells) => {
    for (const cell of cells) {
      const v = txt(cell);
      if (/예산|일예산|₩|원/.test(v) && /[0-9]/.test(v)) return v;
    }
    return '';
  };
  const collectVisibleRows = () => {
    const rows = [...document.querySelectorAll('table tbody tr, [role="row"]')].filter(visible);
    const items = [];
    const seen = new Set();
    for (const row of rows) {
      const rowText = txt(row);
      if (!rowText || /광고\s*그룹.*상태/.test(rowText)) continue;
      const cells = [...row.querySelectorAll('td, [role="cell"], [role="gridcell"]')].filter(visible);
      const links = [...row.querySelectorAll('a[href]')].filter(visible);
      const adgroupLink = links.find((a) => /adgroup/i.test(a.href || '') && looksLikeEntityName(txt(a))) || links.find((a) => looksLikeEntityName(txt(a)));
      const campaignLink = links.find((a) => /campaign/i.test(a.href || '') && looksLikeEntityName(txt(a)));
      let adgroupName = adgroupLink ? normalizeName(txt(adgroupLink)) : '';
      let campaignName = campaignLink ? normalizeName(txt(campaignLink)) : '';
      const cellTexts = cells.map((cell) => txt(cell)).filter(looksLikeEntityName);
      if (!adgroupName) adgroupName = normalizeName(cellTexts[0] || '');
      if (!campaignName) {
        const candidate = cellTexts.find((v) => v !== adgroupName);
        campaignName = normalizeName(candidate || '');
      }
      if (!adgroupName) continue;
      const adgroupHref = adgroupLink ? adgroupLink.href : '';
      const campaignHref = campaignLink ? campaignLink.href : '';
      const adgroupId = extractId(adgroupHref, rowText, 'adgroup');
      const campaignId = extractId(campaignHref || adgroupHref, rowText, 'campaign');
      const key = String(campaignId || campaignName || '') + ':' + String(adgroupId || adgroupName);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        campaign_id: campaignId || null,
        campaign_name: campaignName || '',
        adgroup_id: adgroupId || null,
        adgroup_name: adgroupName,
        campaign_type: campaignType,
        menu_label: menuLabel,
        status: statusFromCells(cells) || null,
        onoff: onoffFromRow(row, cells) || null,
        daily_budget: budgetFromCells(cells) || null
      });
    }
    return items;
  };
  const findNextButton = () => {
    const candidates = [...document.querySelectorAll('button, a, [role="button"]')].filter(visible);
    return candidates.find((el) => {
      const label = (txt(el) + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).trim();
      if (!/(다음|Next|›|>)/i.test(label)) return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      if (/disabled/i.test(String(el.className || ''))) return false;
      return true;
    }) || null;
  };

  await sleep(1200);
  const all = [];
  const seen = new Set();
  for (let page = 1; page <= 20; page += 1) {
    const rows = collectVisibleRows();
    for (const item of rows) {
      const key = String(item.campaign_id || item.campaign_name || '') + ':' + String(item.adgroup_id || item.adgroup_name);
      if (!seen.has(key)) {
        seen.add(key);
        all.push(item);
      }
    }
    stageLog.push('page_' + page + ':rows=' + rows.length + ',total=' + all.length);
    const next = findNextButton();
    if (!next) break;
    const before = bodyText().slice(0, 3000);
    try {
      next.click();
    } catch (e) {
      stageLog.push('next_click_failed:' + String(e && e.message || e).slice(0, 120));
      break;
    }
    await sleep(1800);
    if (bodyText().slice(0, 3000) === before) break;
  }

  if (all.length <= 0) {
    const sample = bodyText();
    const loginRequired = loginMarkers.some((marker) => sample.includes(marker));
    return { ok: false, human_action_required: loginRequired, human_action_reason: loginRequired ? 'login_required' : null, items: [], campaign_type: campaignType, menu_label: menuLabel, stage_log: stageLog, page_url: location.href, title: document.title, body_sample: sample.slice(0, 900), error: loginRequired ? 'login_required' : 'gfa_adgroup_inventory_rows_not_found', via: 'naver_gfa_adgroup_inventory_cdp' };
  }
  return { ok: true, items: all, campaign_type: campaignType, menu_label: menuLabel, count: all.length, stage_log: stageLog, page_url: location.href, title: document.title, body_sample: bodyText().slice(0, 900), error: null, via: 'naver_gfa_adgroup_inventory_cdp' };
})()
"@
	$jsonExpression = "(async () => JSON.stringify(await (" + $expression + ")))()"
	$lastError = $null
	for ($i = 1; $i -le 4; $i++) {
		try {
			$evaluatedJson = [string](@(Invoke-CdpEvaluate -port $port -expression $jsonExpression -timeoutMs 90000) | Select-Object -Last 1)
			$evaluated = $evaluatedJson | ConvertFrom-Json
			Write-Output -NoEnumerate $evaluated
			return
		} catch {
			$lastError = $_.Exception.Message
			if ($lastError -notmatch "Inspected target navigated or closed|-32000|cdp_eval_missing_result|cdp_websocket_not_found|cdp_eval_no_response|cdp_eval_timeout") { throw }
			Write-Info ("gfa_adgroup_inventory_cdp_retry: attempt={0}, error={1}" -f $i, $lastError)
			try { if (-not [string]::IsNullOrWhiteSpace($url)) { Invoke-CdpNavigate -port $port -url $url } } catch {}
			Start-Sleep -Milliseconds (1500 + ($i * 1000))
		}
	}
	throw $lastError
}

function Invoke-GfaCreativeDetailCollect([int]$port, [string]$url) {
	$urlJson = ($url | ConvertTo-Json -Compress)
	$expression = @"
(async () => {
  const targetUrl = $urlJson || location.href;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const txt = (el) => (el && (el.innerText || el.textContent || el.value) || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05 && rect.width > 1 && rect.height > 1;
  };
  const bodyText = () => txt(document.body || document.documentElement);
  const stageLog = [];
  const loginMarkers = ['로그인', 'Login', 'NAVER 로그인', '아이디', '비밀번호'];
  const securityMarkers = ['보안확인', '자동입력 방지', 'captcha', 'CAPTCHA'];
  const pageUrl = location.href || targetUrl;
  const urlObj = new URL(pageUrl);
  const fromUrl = {
    ad_account_no: (pageUrl.match(/\/ad-accounts\/([0-9]+)/) || [])[1] || urlObj.searchParams.get('analyticsGfaAdAccountNo') || '',
    campaign_id: urlObj.searchParams.get('campaignNo') || urlObj.searchParams.get('campaignId') || '',
    adgroup_id: urlObj.searchParams.get('adSetNo') || urlObj.searchParams.get('adgroupNo') || urlObj.searchParams.get('adGroupId') || '',
    creative_id: urlObj.searchParams.get('creativeNo') || urlObj.searchParams.get('creativeId') || ''
  };
  await sleep(1800);
  const allText = bodyText();
  if (loginMarkers.some((marker) => allText.includes(marker)) && !/creativeNo=/.test(pageUrl)) {
    return { ok: false, human_action_required: true, human_action_reason: 'login_required', stage_log: ['login_required'], page_url: pageUrl, title: document.title, body_sample: allText.slice(0, 900), error: 'login_required', via: 'naver_gfa_creative_detail_cdp', ...fromUrl };
  }
  if (securityMarkers.some((marker) => allText.toLowerCase().includes(String(marker).toLowerCase()))) {
    return { ok: false, human_action_required: true, human_action_reason: 'security_check_required', stage_log: ['security_check_required'], page_url: pageUrl, title: document.title, body_sample: allText.slice(0, 900), error: 'security_check_required', via: 'naver_gfa_creative_detail_cdp', ...fromUrl };
  }
  const cleanValue = (value) => {
    const v = String(value || '').replace(/\s+/g, ' ').trim();
    return /^(on|off|true|false)$/i.test(v) ? '' : v;
  };
  const inputValue = (el) => {
    const tag = String(el?.tagName || '').toLowerCase();
    const type = String(el?.getAttribute?.('type') || '').toLowerCase();
    if (tag === 'input' && /^(checkbox|radio|hidden|submit|button)$/i.test(type)) return '';
    return cleanValue(el?.value || el?.getAttribute?.('value') || '');
  };
  const textCandidates = Array.from(document.querySelectorAll('input,textarea,[contenteditable="true"]')).filter(visible).map(inputValue).filter(Boolean);
  const labelValue = (labelPattern) => {
    const nodes = Array.from(document.querySelectorAll('label,dt,th,div,span,p,strong')).filter(visible);
    for (const el of nodes) {
      const label = txt(el);
      if (!labelPattern.test(label)) continue;
      const parent = el.closest('tr,li,dl,section,article,div') || el.parentElement;
      const candidates = [];
      if (parent) {
        candidates.push(...Array.from(parent.querySelectorAll('input,textarea,[contenteditable="true"]')).map(inputValue));
        candidates.push(...Array.from(parent.querySelectorAll('dd,td,p,span,div')).map((one) => cleanValue(txt(one))));
      }
      for (const value of candidates) {
        const v = cleanValue(value);
        if (v && v !== label && !labelPattern.test(v)) return v;
      }
    }
    return '';
  };
  const findByRegex = (patterns) => {
    for (const pattern of patterns) {
      const m = allText.match(pattern);
      if (m && m[1]) return String(m[1]).replace(/\s+/g, ' ').trim();
    }
    return '';
  };
  const imgs = Array.from(document.querySelectorAll('img[src]')).filter(visible).map((img) => {
    const rect = img.getBoundingClientRect();
    return {
      src: img.currentSrc || img.src || '',
      alt: img.alt || '',
      width: Math.round(rect.width || img.naturalWidth || 0),
      height: Math.round(rect.height || img.naturalHeight || 0),
      area: Math.round((rect.width || img.naturalWidth || 0) * (rect.height || img.naturalHeight || 0)),
      top: Math.round(rect.top || 0),
      left: Math.round(rect.left || 0)
    };
  }).filter((x) => {
    if (!x.src || /^data:/i.test(x.src)) return false;
    if (/^chrome-extension:/i.test(x.src)) return false;
    if (/\/static\/svg\//i.test(x.src) || /\.svg(?:$|\?)/i.test(x.src)) return false;
    if (x.left < 0 || x.area < 5000 || x.width < 80 || x.height < 60) return false;
    return true;
  });
  imgs.sort((a, b) => b.area - a.area);
  const profileImg = imgs.find((x) => x.area > 100 && x.area < 20000) || null;
  const mainImg = imgs.find((x) => x.area >= 20000) || imgs[0] || null;
  const isIdLike = (value) => /^\d{5,}$/.test(String(value || '').trim());
  const isUrlLike = (value) => /^https?:\/\//i.test(String(value || '').trim());
  const textNonIds = textCandidates.filter((x) => x && !isIdLike(x) && !isUrlLike(x));
  const textUrls = textCandidates.filter(isUrlLike);
  const pickNonId = (value, fallback = '') => {
    const v = cleanValue(value);
    return isIdLike(v) ? cleanValue(fallback) : v;
  };
  const creativeTypeFromText = findByRegex([
    /소재\s*타입\s+(.{2,80}?)\s+광고\s*소재\s*ID/,
    /(네이티브\s*이미지\s*\([^)]+\))/,
    /(이미지\s*\([^)]+\))/,
    /(동영상\s*\([^)]+\))/,
  ]);
  const creativeName = pickNonId(labelValue(/광고\s*소재\s*이름|소재\s*이름|소재명/) || findByRegex([/광고\s*소재\s*이름\s*([^\n\r]{2,80})/, /소재\s*이름\s*([^\n\r]{2,80})/]), textNonIds[0] || '');
  const creativeType = pickNonId(labelValue(/소재\s*유형|광고\s*유형|타입/) || creativeTypeFromText, creativeTypeFromText || '').replace(/^소재\s*타입\s*/, '').trim();
  const profileName = pickNonId(labelValue(/프로필\s*이름|프로필명|브랜드\s*이름/), textNonIds[1] || '');
  const ctaFromText = findByRegex([/(더\s*알아보기|지금\s*구매하기|자세히\s*보기|문의하기|가입하기|다운로드|예약하기)/]);
  const ctaLabel = pickNonId(labelValue(/행동\s*유도|CTA|버튼\s*문구/), '');
  const cta = isUrlLike(ctaLabel) ? ctaFromText : cleanValue(ctaLabel || ctaFromText);
  const landingLabel = cleanValue(labelValue(/랜딩\s*URL|최종\s*URL|연결\s*URL|도착\s*URL/));
  let landingUrl = isUrlLike(landingLabel) ? landingLabel : (textUrls[0] || '');
  if (/naver\.com\/(policy|common|help)|privacy|terms/i.test(landingUrl)) landingUrl = '';
  const primaryText = pickNonId(labelValue(/광고\s*문구|본문|메인\s*문구|문구/), textNonIds.find((x) => x.length >= 8 && x !== creativeName && x !== profileName) || '');
  const headline = pickNonId(labelValue(/제목|타이틀|헤드라인/), '');
  const description = pickNonId(labelValue(/설명|보조\s*문구|상세\s*문구/), '');
  const payload = {
    ok: true,
    detail_url: pageUrl,
    page_url: pageUrl,
    title: document.title,
    ...fromUrl,
    creative_name: creativeName || '',
    creative_type: creativeType || '',
    profile_name: profileName || '',
    profile_image_url: profileImg ? profileImg.src : '',
    image_url: mainImg ? mainImg.src : '',
    primary_text: primaryText || '',
    headline: headline || '',
    description: description || '',
    cta: cta || '',
    landing_url: landingUrl || '',
    image_candidates: imgs.slice(0, 8),
    text_candidates: textCandidates.slice(0, 20),
    stage_log: stageLog,
    body_sample: allText.slice(0, 1200),
    error: null,
    via: 'naver_gfa_creative_detail_cdp'
  };
  if (!payload.image_url && !payload.primary_text && !payload.headline && !payload.description && !payload.cta && !payload.landing_url) {
    payload.ok = false;
    payload.error = 'gfa_creative_detail_fields_not_found';
  }
  return payload;
})()
"@
	$jsonExpression = "(async () => JSON.stringify(await (" + $expression + ")))()"
	$lastError = $null
	for ($i = 1; $i -le 4; $i++) {
		try {
			$evaluatedJson = [string](@(Invoke-CdpEvaluate -port $port -expression $jsonExpression -timeoutMs 90000) | Select-Object -Last 1)
			$evaluated = $evaluatedJson | ConvertFrom-Json
			Write-Output -NoEnumerate $evaluated
			return
		} catch {
			$lastError = $_.Exception.Message
			if ($lastError -notmatch "Inspected target navigated or closed|-32000|cdp_eval_missing_result|cdp_websocket_not_found|cdp_eval_no_response|cdp_eval_timeout") { throw }
			Write-Info ("gfa_creative_detail_cdp_retry: attempt={0}, error={1}" -f $i, $lastError)
			try { if (-not [string]::IsNullOrWhiteSpace($url)) { Invoke-CdpNavigate -port $port -url $url } } catch {}
			Start-Sleep -Milliseconds (1500 + ($i * 1000))
		}
	}
	throw $lastError
}

function Get-DownloadsDirectory {
	$dir = Join-Path $env:USERPROFILE "Downloads"
	if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
	return $dir
}

function Invoke-PurchaseKeywordDownload([int]$port, [string]$url, [string]$targetDate) {
	$urlJson = $url | ConvertTo-Json -Compress
	$dateJson = $targetDate | ConvertTo-Json -Compress
	$expression = @"
(async () => {
  const targetUrl = $urlJson;
  const targetDate = $dateJson;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const getDoc = () => {
    const frame = document.querySelector('iframe#__delegate');
    try {
      if (frame && frame.contentDocument && frame.contentDocument.body) return frame.contentDocument;
    } catch (e) {}
    return document;
  };
  const setNativeValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const clickByText = (pattern) => {
    const doc = getDoc();
    const nodes = Array.from(doc.querySelectorAll('button,a,[role="button"],.btn,[class*="button"]'));
    const haystack = (el) => [
      el.innerText || el.textContent || '',
      el.className || '',
      el.getAttribute('data-test-id') || '',
      el.getAttribute('title') || '',
      el.getAttribute('aria-label') || ''
    ].join(' ');
    const target = nodes.find((el) => pattern.test(haystack(el)) && !el.disabled);
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    return true;
  };
  await sleep(1500);
  const doc = getDoc();
  const text = doc.body ? (doc.body.innerText || '') : '';
  const pageUrl = location.href || '';
  const title = document.title || '';
  const humanActionPatterns = [
    ['login_required', /로그인|sign\s*in|login/i],
    ['security_check', /보안\s*확인|자동입력|captcha|캡차|로봇이 아닙니다/i],
    ['blocked', /서비스\s*접속이\s*불가능|접속이\s*불가능|비정상적인\s*접근/i]
  ];
  for (const [reason, pattern] of humanActionPatterns) {
    if (pattern.test(text) || pattern.test(title) || pattern.test(pageUrl)) {
      return { ok: false, human_action_required: true, human_action_reason: reason, page_url: pageUrl, title, body_sample: text.slice(0, 500), error: reason };
    }
  }
  if (/naverpay\/settlement/i.test(pageUrl)) {
    return { ok: false, human_action_required: true, human_action_reason: 'wrong_menu_detected', target_date: targetDate, page_url: pageUrl, title, body_sample: text.slice(0, 500), error: 'wrong_menu_detected' };
  }
  const targetParts = targetDate.split('-').map((v) => Number(v));
  const targetMonthText = String(targetParts[0]) + '. ' + String(targetParts[1]).padStart(2, '0') + '.';
  const targetDayText = String(targetParts[2]);
  const targetDisplay = String(targetParts[0]) + '.' + String(targetParts[1]).padStart(2, '0') + '.' + String(targetParts[2]).padStart(2, '0') + '.';
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const compact = (v) => norm(v).replace(/\s+/g, '');
  const isTargetSingleDayRange = (v) => {
    const c = compact(v);
    return c.includes(targetDisplay + '~' + targetDisplay) || (c.includes(targetDisplay) && !c.includes('~'));
  };
  const dateToggle = doc.querySelector('.date_select .btn.select_data,[data-test-id="DateRangeFixedArea_click_toggle"]');
  if (!dateToggle) {
    return { ok: false, human_action_required: true, human_action_reason: 'date_filter_required', target_date: targetDate, page_url: location.href, title, body_sample: text.slice(0, 500), error: 'date_toggle_not_found' };
  }
  const currentRangeBefore = norm(dateToggle.innerText || dateToggle.textContent || '');
  if (!isTargetSingleDayRange(currentRangeBefore)) {
    dateToggle.click();
    await sleep(600);
    const months = () => Array.from(doc.querySelectorAll('.calendar_lypop .DayPicker-Month'));
    const centerMonth = () => months()[1] || months()[0] || null;
    const centerCaptionText = () => norm(centerMonth()?.querySelector('.DayPicker-Caption')?.textContent);
    const findMonth = () => centerCaptionText().includes(targetMonthText) ? centerMonth() : null;
    const captionYm = (text) => {
      const m = norm(text).match(/(\d{4})\.\s*(\d{1,2})\./);
      return m ? Number(m[1]) * 12 + Number(m[2]) : null;
    };
    const targetYm = targetParts[0] * 12 + targetParts[1];
    let month = findMonth();
    for (let i = 0; !month && i < 12; i += 1) {
      const centerYm = captionYm(centerCaptionText());
      const navSelector = targetYm < centerYm ? '[data-test-id="DateCommonNavBarM_click_prev-month"],.DayPicker-NavButton--prev' : targetYm > centerYm ? '[data-test-id="DateCommonNavBarM_click_next-month"],.DayPicker-NavButton--next' : null;
      if (!navSelector) break;
      const nav = doc.querySelector(navSelector);
      if (!nav) break;
      nav.click();
      await sleep(450);
      month = findMonth();
    }
    if (!month) {
      const captions = Array.from(doc.querySelectorAll('.calendar_lypop .DayPicker-Caption')).map((el) => norm(el.textContent));
      return { ok: false, human_action_required: true, human_action_reason: 'date_filter_required', target_date: targetDate, captions, page_url: location.href, title, body_sample: text.slice(0, 500), error: 'target_month_not_found' };
    }
    const dayCell = Array.from(month.querySelectorAll('.DayPicker-Day.rdp-day:not(.DayPicker-Day--outside)')).find((td) => norm(td.textContent) === targetDayText);
    if (!dayCell) {
      return { ok: false, human_action_required: true, human_action_reason: 'date_filter_required', target_date: targetDate, page_url: location.href, title, body_sample: text.slice(0, 500), error: 'target_day_not_found' };
    }
    dayCell.click();
    await sleep(250);
    // SmartStore date range picker treats the first click as range start; click again to lock a single-day range.
    dayCell.click();
    await sleep(500);
    const applyButton = Array.from(doc.querySelectorAll('.calendar_lypop button,.calendar_lypop a,[role="button"]')).find((el) => /적용|확인|apply|confirm|complate|complete/i.test(norm(el.innerText || el.textContent || el.value) + ' ' + String(el.className || '') + ' ' + String(el.getAttribute('data-test-id') || '')));
    if (!applyButton) {
      return { ok: false, human_action_required: true, human_action_reason: 'date_filter_required', target_date: targetDate, page_url: location.href, title, body_sample: text.slice(0, 500), error: 'date_apply_button_not_found' };
    }
    applyButton.click();
    await sleep(3000);
  }
  const currentRange = norm(doc.querySelector('.date_select .btn.select_data,[data-test-id="DateRangeFixedArea_click_toggle"]')?.innerText || '');
  if (!isTargetSingleDayRange(currentRange)) {
    return { ok: false, human_action_required: true, human_action_reason: 'date_filter_required', target_date: targetDate, current_range: currentRange, page_url: location.href, title, body_sample: text.slice(0, 500), error: 'target_single_day_not_applied' };
  }
  // 화면 표는 필터/페이지 크기에 따라 누락될 수 있으므로, 전체 데이터가 내려오는 엑셀 다운로드를 우선 사용한다.
  const clicked = clickByText(/엑셀|Excel|다운로드|download|btn_download|xlsx/i);
  await sleep(1500);
  return { ok: clicked, clicked, target_date: targetDate, current_range: currentRange, human_action_required: false, page_url: location.href, title, body_sample: text.slice(0, 500), error: clicked ? null : 'excel_download_button_not_found', via: 'smartstore_purchase_keyword_excel_cdp' };
})()
"@
	$evaluated = @(Invoke-CdpEvaluate -port $port -expression $expression) | Select-Object -Last 1
	Write-Output -NoEnumerate $evaluated
}

function Wait-PurchaseKeywordDownload([DateTime]$After, [int]$TimeoutSec = 90) {
	$downloads = Get-DownloadsDirectory
	$deadline = (Get-Date).AddSeconds($TimeoutSec)
	while ((Get-Date) -lt $deadline) {
		$files = @(Get-ChildItem -LiteralPath $downloads -File -ErrorAction SilentlyContinue |
			Where-Object {
				$_.LastWriteTime -ge $After.AddSeconds(-2) -and
				$_.Name -notmatch "\.crdownload$|\.tmp$" -and
				($_.Extension -match "\.xlsx|\.xls|\.csv")
			} |
			Sort-Object LastWriteTime -Descending)
		if ($files.Count -gt 0) { return $files[0].FullName }
		Start-Sleep -Seconds 2
	}
	throw "purchase_keyword_download_timeout"
}

function Wait-ReviewExcelDownload([DateTime]$After, [int]$TimeoutSec = 30) {
	try {
		return Wait-PurchaseKeywordDownload -After $After -TimeoutSec $TimeoutSec
	} catch {
		throw "review_excel_download_timeout"
	}
}

function Wait-AdsSearchwordReportDownload([DateTime]$After, [int]$TimeoutSec = 90) {
	try {
		return Wait-PurchaseKeywordDownload -After $After -TimeoutSec $TimeoutSec
	} catch {
		throw "ads_searchword_report_download_timeout"
	}
}

function Wait-AdsCreativeReportDownload([DateTime]$After, [int]$TimeoutSec = 90) {
	try {
		return Wait-PurchaseKeywordDownload -After $After -TimeoutSec $TimeoutSec
	} catch {
		throw "ads_creative_report_download_timeout"
	}
}

function Wait-GfaPerformanceReportDownload([DateTime]$After, [int]$TimeoutSec = 120, [string]$ApiBaseUrl = "", [string]$JobId = "", [string]$BearerToken = "") {
	$downloads = Get-DownloadsDirectory
	$deadline = (Get-Date).AddSeconds($TimeoutSec)
	while ((Get-Date) -lt $deadline) {
		if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $JobId -BearerToken $BearerToken) { throw "user_cancelled" }
		$files = @(Get-ChildItem -LiteralPath $downloads -File -ErrorAction SilentlyContinue |
			Where-Object {
				$_.LastWriteTime -ge $After.AddSeconds(-2) -and
				$_.Name -notmatch "\.crdownload$|\.tmp$" -and
				(
					$_.Name -match "^ReportDownload_.*_PERFORMANCE_.*\.zip$" -or
					$_.Extension -match "\.zip|\.csv"
				)
			} |
			Sort-Object LastWriteTime -Descending)
		if ($files.Count -gt 0) { return $files[0].FullName }
		Start-Sleep -Seconds 2
	}
	throw "gfa_performance_report_download_timeout"
}

function Submit-PurchaseKeywordUpload([string]$ApiBaseUrl, [string]$BearerToken, [string]$FilePath, [string]$TargetDate) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl) -or [string]::IsNullOrWhiteSpace($FilePath)) { throw "upload_required_args_missing" }
	$headers = New-CollectorApiHeaders -BearerToken $BearerToken
	$uri = $ApiBaseUrl.TrimEnd("/") + "/purchase/keywords/upload?target_date=" + [Uri]::EscapeDataString($TargetDate) + "&source=smartstore_cdp"
	try {
		return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Form @{ file = Get-Item -LiteralPath $FilePath } -TimeoutSec 120
	} catch {
		$detail = ""
		try { $detail = [string]$_.ErrorDetails.Message } catch {}
		if ([string]::IsNullOrWhiteSpace($detail)) { try { $detail = [string]$_.Exception.Message } catch {} }
		throw ("purchase_keyword_upload_failed: " + $detail)
	}
}

function Submit-AdsSearchwordReportUpload([string]$ApiBaseUrl, [string]$BearerToken, [string]$FilePath, [string]$DateFrom, [string]$DateTo) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl) -or [string]::IsNullOrWhiteSpace($FilePath)) { throw "upload_required_args_missing" }
	$headers = New-CollectorApiHeaders -BearerToken $BearerToken
	$uri = $ApiBaseUrl.TrimEnd("/") + "/ads/searchwords/upload?date=" + [Uri]::EscapeDataString($DateFrom) + "&date_from=" + [Uri]::EscapeDataString($DateFrom) + "&date_to=" + [Uri]::EscapeDataString($DateTo)
	try {
		return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Form @{ file = Get-Item -LiteralPath $FilePath } -TimeoutSec 180
	} catch {
		$detail = ""
		try { $detail = [string]$_.ErrorDetails.Message } catch {}
		if ([string]::IsNullOrWhiteSpace($detail)) { try { $detail = [string]$_.Exception.Message } catch {} }
		throw ("ads_searchword_report_upload_failed: " + $detail)
	}
}

function Submit-AdsCreativeReportUpload([string]$ApiBaseUrl, [string]$BearerToken, [string]$FilePath) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl) -or [string]::IsNullOrWhiteSpace($FilePath)) { throw "upload_required_args_missing" }
	$headers = New-CollectorApiHeaders -BearerToken $BearerToken
	$uri = $ApiBaseUrl.TrimEnd("/") + "/ads/creatives/upload"
	try {
		return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Form @{ file = Get-Item -LiteralPath $FilePath } -TimeoutSec 180
	} catch {
		$detail = ""
		try { $detail = [string]$_.ErrorDetails.Message } catch {}
		if ([string]::IsNullOrWhiteSpace($detail)) { try { $detail = [string]$_.Exception.Message } catch {} }
		throw ("ads_creative_report_upload_failed: " + $detail)
	}
}

function Submit-GfaPerformanceReportUpload([string]$ApiBaseUrl, [string]$BearerToken, [string]$FilePath, [string]$AdUnit = "CREATIVE") {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl) -or [string]::IsNullOrWhiteSpace($FilePath)) { throw "upload_required_args_missing" }
	$headers = New-CollectorApiHeaders -BearerToken $BearerToken
	$uri = $ApiBaseUrl.TrimEnd("/") + "/gfa/reports/upload"
	try {
		return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Form @{ file = Get-Item -LiteralPath $FilePath; ad_unit = $AdUnit } -TimeoutSec 180
	} catch {
		$detail = ""
		try { $detail = [string]$_.ErrorDetails.Message } catch {}
		if ([string]::IsNullOrWhiteSpace($detail)) { try { $detail = [string]$_.Exception.Message } catch {} }
		throw ("gfa_performance_report_upload_failed: " + $detail)
	}
}

function Invoke-GfaPerformanceReportDownload([int]$port, [string]$url, [string]$dateFrom, [string]$dateTo, [bool]$ClearRequestListAtStart = $false, [bool]$SkipInitialRequestListCheck = $false, [string]$ApiBaseUrl = "", [string]$JobId = "", [string]$BearerToken = "", $Page = $null) {
	$urlJson = $url | ConvertTo-Json -Compress
	$dateFromJson = $dateFrom | ConvertTo-Json -Compress
	$dateToJson = $dateTo | ConvertTo-Json -Compress
	$clearRequestListAtStartJson = $ClearRequestListAtStart.ToString().ToLowerInvariant()
	$skipInitialRequestListCheckJson = $SkipInitialRequestListCheck.ToString().ToLowerInvariant()
	$cancelApiBaseUrlJson = $ApiBaseUrl | ConvertTo-Json -Compress
	$cancelJobIdJson = $JobId | ConvertTo-Json -Compress
	$cancelBearerTokenJson = $BearerToken | ConvertTo-Json -Compress
	$expression = @"
(async () => {
  const targetUrl = $urlJson;
  const dateFrom = $dateFromJson;
  const dateTo = $dateToJson;
  const clearRequestListAtStart = $clearRequestListAtStartJson;
  const skipInitialRequestListCheck = $skipInitialRequestListCheckJson;
  const cancelApiBaseUrl = $cancelApiBaseUrlJson;
  const cancelJobId = $cancelJobIdJson;
  const cancelBearerToken = $cancelBearerTokenJson;
  const rawSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const stageLog = [];
  const mark = (stage, extra = {}) => stageLog.push({ stage, time: new Date().toISOString(), ...extra });
  let lastCancelCheckAt = 0;
  const checkCancelled = async (force = false) => {
    if (!cancelApiBaseUrl || !cancelJobId) return false;
    const now = Date.now();
    if (!force && now - lastCancelCheckAt < 1000) return false;
    lastCancelCheckAt = now;
    try {
      const headers = {};
      if (cancelBearerToken) headers.Authorization = 'Bearer ' + cancelBearerToken;
      let base = String(cancelApiBaseUrl);
      while (base.endsWith('/')) base = base.slice(0, -1);
      const res = await fetch(base + '/search-rank/page-metrics/local-collector/jobs/' + encodeURIComponent(cancelJobId), { method: 'GET', headers, cache: 'no-store' });
      if (!res.ok) return false;
      const job = await res.json();
      if (String(job?.status || '') === 'CANCELLED') {
        mark('user_cancelled_in_browser_automation');
        throw new Error('user_cancelled');
      }
    } catch (e) {
      if (String(e?.message || e) === 'user_cancelled') throw e;
    }
    return false;
  };
  const sleep = async (ms) => {
    const until = Date.now() + Math.max(0, Number(ms) || 0);
    while (Date.now() < until) {
      await checkCancelled(false);
      await rawSleep(Math.min(500, Math.max(0, until - Date.now())));
    }
    await checkCancelled(false);
  };
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const compact = (v) => norm(v).replace(/\s+/g, '');
  const textOf = (el) => norm(el?.innerText || el?.textContent || el?.value || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || '');
  const isVisible = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const clickableOf = (el) => {
    let cur = el;
    for (let i = 0; i < 8 && cur; i += 1) {
      const tag = String(cur.tagName || '').toLowerCase();
      const role = String(cur.getAttribute?.('role') || '').toLowerCase();
      const cls = String(cur.className || '');
      if (tag === 'button' || tag === 'a' || role === 'button' || /btn|button/i.test(cls)) return cur;
      cur = cur.parentElement;
    }
    return el;
  };
  const clickElement = async (el) => {
    const target = clickableOf(el);
    try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    try { target.focus?.(); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    target.click();
    await sleep(900);
    return { clicked: true, text: textOf(target) || textOf(el), tag: String(target.tagName || ''), className: String(target.className || '') };
  };
  const candidates = () => Array.from(document.querySelectorAll('button,a,[role="button"],input,span,div')).filter(isVisible);
  const clickText = async (patterns, timeout = 15000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const hits = candidates()
        .map((el) => {
          const r = el.getBoundingClientRect();
          const text = compact(textOf(el)) + ' ' + compact(String(el.getAttribute?.('aria-label') || '')) + ' ' + compact(String(el.getAttribute?.('title') || '')) + ' ' + compact(String(el.className || ''));
          return { el, text, rawText: textOf(el), width: r.width, height: r.height };
        })
        .filter((x) => x.text)
        .filter((x) => x.width >= 20 && x.height >= 10 && x.width < window.innerWidth * 0.92 && x.height < window.innerHeight * 0.6)
        .filter((x) => patterns.some((re) => re.test(x.text)));
      hits.sort((a, b) => compact(a.rawText).length - compact(b.rawText).length || a.width - b.width);
      const hit = hits[0];
      if (hit) {
        const result = await clickElement(hit.el);
        mark('clicked', { text: result.text || hit.rawText, tag: result.tag, className: result.className });
        return true;
      }
      await sleep(500);
    }
    return false;
  };
  const modalRoots = () => {
    const roots = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"]'))
      .filter(isVisible)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 240 && r.height >= 120 && r.width <= Math.max(900, window.innerWidth * 0.9) && r.height <= Math.max(650, window.innerHeight * 0.9);
      })
      .filter((el) => /다운로드를요청하시겠습니까|다운로드가능시점|이메일|SMS|알림/.test(compact(textOf(el))));
    if (roots.length) return roots;
    return Array.from(document.querySelectorAll('body > div, body > section, body > aside'))
      .filter(isVisible)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 240 && r.height >= 120 && /다운로드를요청하시겠습니까|다운로드가능시점/.test(compact(textOf(el)));
      });
  };
  const clickStrictConfirmButtonInRoot = async (root, stage = 'download_request_confirm_clicked') => {
    const rootRect = root.getBoundingClientRect();
    const controls = Array.from(root.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],span,div'))
      .filter(isVisible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const rawText = textOf(el);
        const txt = compact(rawText);
        const cls = compact(String(el.className || ''));
        const aria = compact(String(el.getAttribute?.('aria-label') || ''));
        const title = compact(String(el.getAttribute?.('title') || ''));
        const hay = txt + ' ' + cls + ' ' + aria + ' ' + title;
        const tag = String(el.tagName || '').toLowerCase();
        const role = String(el.getAttribute?.('role') || '').toLowerCase();
        const disabled = !!(el.disabled || el.getAttribute?.('aria-disabled') === 'true');
        const clickable = clickableOf(el);
        const clickableTag = String(clickable?.tagName || '').toLowerCase();
        const clickableRole = String(clickable?.getAttribute?.('role') || '').toLowerCase();
        const clickableClass = String(clickable?.className || '');
        const hasConfirmIntent = /^확인$|^ok$|^confirm$/i.test(txt) || /확인|ok|confirm/i.test(hay);
        let score = 0;
        if (/^확인$|^ok$|^confirm$/i.test(txt)) score += 800;
        else if (/확인|ok|confirm/i.test(hay)) score += 260;
        if (clickableTag === 'button' || clickableTag === 'a' || clickableTag === 'input' || clickableRole === 'button') score += 180;
        if (tag === 'button' || tag === 'a' || tag === 'input' || role === 'button') score += 120;
        if (/ad-cms-btn|btn|button|primary|solid/i.test(clickableClass + ' ' + cls)) score += 140;
        if (/primary|solid|blue/i.test(clickableClass + ' ' + cls)) score += 80;
        if (r.top >= rootRect.top + rootRect.height * 0.55) score += 110;
        if (r.top >= rootRect.top + rootRect.height * 0.72) score += 80;
        if (r.left >= rootRect.left + rootRect.width * 0.45) score += 70;
        if (r.width >= 24 && r.height >= 14) score += 20;
        if (/취소|닫기|cancel|close/i.test(hay)) score -= 800;
        if (/checkbox|check-box|label/i.test(hay) || tag === 'label' || clickableTag === 'label') score -= 900;
        if (tag === 'input' && /checkbox|radio/i.test(String(el.type || ''))) score -= 900;
        if (r.width > rootRect.width * 0.75 || r.height > rootRect.height * 0.35 || rawText.length > 80) score -= 450;
        return { el, clickable, hay, txt, rawText, tag, role, clickableTag, clickableRole, clickableClass, disabled, hasConfirmIntent, score, width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      })
      .filter((x) => !x.disabled)
      .filter((x) => x.hasConfirmIntent)
      .filter((x) => x.width >= 12 && x.height >= 8)
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.bottom - a.bottom || b.right - a.right || b.width - a.width);
    mark(stage + '_candidates', {
      candidates: controls.slice(0, 8).map((x) => ({
        text: norm(x.rawText).slice(0, 80),
        tag: x.tag,
        role: x.role,
        targetTag: x.clickableTag,
        targetRole: x.clickableRole,
        className: String(x.clickableClass || '').slice(0, 100),
        score: x.score,
        rect: { top: Math.round(x.top), left: Math.round(x.left), width: Math.round(x.width), height: Math.round(x.height) },
      })),
    });
    const hit = controls[0];
    if (!hit) return false;
    const target = hit.clickable || hit.el;
    try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    try { target.focus?.(); } catch (e) {}
    const tr = target.getBoundingClientRect();
    const x = Math.max(1, Math.min(window.innerWidth - 1, tr.left + tr.width / 2));
    const y = Math.max(1, Math.min(window.innerHeight - 1, tr.top + tr.height / 2));
    const pointTarget = document.elementFromPoint(x, y) || target;
    const eventInit = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        const evt = type.startsWith('pointer') && typeof PointerEvent !== 'undefined'
          ? new PointerEvent(type, { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true })
          : new MouseEvent(type, eventInit);
        pointTarget.dispatchEvent(evt);
      } catch (e) {}
    }
    try { pointTarget.click?.(); } catch (e) {}
    if (pointTarget !== target) {
      try { target.click?.(); } catch (e) {}
    }
    mark(stage, { text: hit.rawText, tag: hit.tag, role: hit.role, targetTag: hit.clickableTag, targetRole: hit.clickableRole, className: String(target.className || ''), score: hit.score, left: hit.left, top: hit.top, right: hit.right, bottom: hit.bottom });
    await sleep(1500);
    return true;
  };
  const rootConfirmCandidateCount = (root) => Array.from(root.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],span,div'))
    .filter(isVisible)
    .filter((el) => {
      const rawText = textOf(el);
      const txt = compact(rawText);
      const hay = txt + ' ' + compact(String(el.className || '')) + ' ' + compact(String(el.getAttribute?.('aria-label') || '')) + ' ' + compact(String(el.getAttribute?.('title') || ''));
      return /^확인$|^ok$|^confirm$/i.test(txt) || /확인|ok|confirm/i.test(hay);
    }).length;
  const clickDownloadRequestConfirm = async (timeout = 15000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const roots = modalRoots();
      if (roots.length) {
        const root = roots.sort((a, b) => {
          const ac = rootConfirmCandidateCount(a);
          const bc = rootConfirmCandidateCount(b);
          if (bc !== ac) return bc - ac;
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return (ar.width * ar.height) - (br.width * br.height);
        })[0];
        mark('download_request_modal_found', { text: textOf(root).slice(0, 160) });
        if (await clickStrictConfirmButtonInRoot(root, 'download_request_confirm_clicked')) {
          for (let i = 0; i < 36; i += 1) {
            await sleep(250);
            if (!modalRoots().length) {
              mark('download_request_confirm_modal_closed');
              return true;
            }
            if (requestListRoots().length) {
              mark('download_request_confirm_opened_request_list');
              return true;
            }
            if (statusModalRoots().length) {
              await clickDownloadRequestStatusConfirm(5000);
              mark('download_request_confirm_status_modal_closed');
              return true;
            }
            if (i === 11 || i === 23) {
              const remainingRoots = modalRoots().sort((a, b) => {
                const ac = rootConfirmCandidateCount(a);
                const bc = rootConfirmCandidateCount(b);
                if (bc !== ac) return bc - ac;
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                return (ar.width * ar.height) - (br.width * br.height);
              });
              if (remainingRoots.length) {
                mark('download_request_confirm_retry', { attempt: i === 11 ? 2 : 3, remaining: remainingRoots.length, text: textOf(remainingRoots[0]).slice(0, 160) });
                await clickStrictConfirmButtonInRoot(remainingRoots[0], 'download_request_confirm_retry_clicked');
              }
            }
          }
          mark('download_request_confirm_modal_close_failed', { remaining: modalRoots().length, body_sample: body().slice(0, 500) });
          return false;
        }
      }
      await sleep(500);
    }
    return false;
  };
  const statusModalRoots = () => Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"],body > div,body > section,body > aside'))
    .filter(isVisible)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const text = compact(textOf(el));
      return r.width >= 240 && r.height >= 120
        && !/다운로드요청목록/.test(text)
        && /다운로드신청상태|다운로드요청상태|신청상태|요청상태|요청되었습니다|신청되었습니다|요청이완료|신청이완료|다운로드요청.*완료|다운로드신청.*완료/.test(text);
    });
  const clickDownloadRequestStatusConfirm = async (timeout = 20000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const roots = statusModalRoots();
      if (roots.length) {
        const root = roots.sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return (ar.width * ar.height) - (br.width * br.height);
        })[0];
        mark('download_request_status_modal_found', { text: textOf(root).slice(0, 180) });
        if (await clickStrictConfirmButtonInRoot(root, 'download_request_status_confirm_clicked')) return true;
      }
      await sleep(500);
    }
    mark('download_request_status_confirm_not_found');
    return false;
  };
  const requestListRoots = () => Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"],body > div,body > section'))
    .filter(isVisible)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 420 && r.height >= 260 && /다운로드요청목록/.test(compact(textOf(el))) && /요청일시|파일생성일시|요청자|상태/.test(compact(textOf(el)));
    });
  const closeRequestListModal = async () => {
    const roots = requestListRoots();
    if (!roots.length) return false;
    const root = roots.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const ac = Array.from(a.querySelectorAll('button,[role="button"],a,input[type="button"],span,div')).filter((el) => isVisible(el) && /^확인$/.test(compact(textOf(el)))).length;
      const bc = Array.from(b.querySelectorAll('button,[role="button"],a,input[type="button"],span,div')).filter((el) => isVisible(el) && /^확인$/.test(compact(textOf(el)))).length;
      if (bc !== ac) return bc - ac;
      return (br.width * br.height) - (ar.width * ar.height);
    })[0];
    const rootRect = root.getBoundingClientRect();
    const clickableInRoot = (el) => {
      let cur = el;
      for (let i = 0; i < 7 && cur && cur !== root.parentElement; i += 1) {
        const tag = String(cur.tagName || '').toLowerCase();
        const role = String(cur.getAttribute?.('role') || '').toLowerCase();
        const cls = String(cur.className || '');
        if (tag === 'button' || tag === 'a' || role === 'button' || /btn|button/i.test(cls)) return cur;
        cur = cur.parentElement;
      }
      return el;
    };
    const clickAtCenter = async (hit) => {
      const x = Math.max(1, Math.min(window.innerWidth - 1, (hit.left + hit.right) / 2));
      const y = Math.max(1, Math.min(window.innerHeight - 1, (hit.top + hit.bottom) / 2));
      const pointTarget = document.elementFromPoint(x, y) || hit.el;
      const eventInit = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        try {
          const evt = type.startsWith('pointer') && typeof PointerEvent !== 'undefined'
            ? new PointerEvent(type, { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true })
            : new MouseEvent(type, eventInit);
          pointTarget.dispatchEvent(evt);
        } catch (e) {}
      }
      try { pointTarget.click?.(); } catch (e) {}
      if (pointTarget !== hit.el) {
        try { hit.el.click?.(); } catch (e) {}
      }
      return { x, y, pointTag: String(pointTarget.tagName || ''), pointText: textOf(pointTarget).slice(0, 80) };
    };
    const buttonElements = Array.from(new Set([
      ...Array.from(root.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"],span,div')),
      ...Array.from(document.body.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"],span,div')),
    ]));
    const buttons = buttonElements
      .filter(isVisible)
      .map((el) => {
        const target = clickableInRoot(el);
        const r = el.getBoundingClientRect();
        const tr = target.getBoundingClientRect();
        const disabled = !!(target.disabled || target.getAttribute?.('aria-disabled') === 'true');
        const targetTag = String(target.tagName || '').toLowerCase();
        const targetRole = String(target.getAttribute?.('role') || '').toLowerCase();
        const rawText = textOf(el) || textOf(target);
        const rawCompact = compact(rawText);
        const useRawRect = /^확인$|^닫기$|^close$|^×$|^x$/i.test(rawCompact) && r.width >= 8 && r.height >= 8 && r.width <= 320 && r.height <= 90;
        const pr = useRawRect ? r : tr;
        return { el: target, disabled, rawText, text: compact(textOf(el)) + ' ' + compact(textOf(target)) + ' ' + compact(String(target.className || '')), width: pr.width, height: pr.height, top: pr.top, left: pr.left, right: pr.right, bottom: pr.bottom, targetTag, targetRole, useRawRect };
      })
      .filter((x) => !x.disabled && x.width >= 12 && x.height >= 8);
    const buttonLike = (x) => x && (
      x.targetTag === 'button'
      || x.targetTag === 'a'
      || x.targetTag === 'input'
      || x.targetRole === 'button'
      || (x.width <= 260 && x.height <= 72 && /btn|button|primary|solid/i.test(x.text))
    );
    const exact = buttons
      .filter((x) => /^확인$/.test(compact(x.rawText)))
      .filter(buttonLike)
      .filter((x) => x.width <= 320 && x.height <= 90)
      .filter((x) => x.top > rootRect.top + rootRect.height * 0.55)
      .filter((x) => x.left >= rootRect.left - 24 && x.right <= rootRect.right + 24)
      .sort((a, b) => b.bottom - a.bottom || b.right - a.right)[0];
    const bottomConfirm = buttons
      .filter((x) => /^확인$/.test(compact(x.rawText)))
      .filter((x) => x.width <= 320 && x.height <= 90)
      .filter((x) => x.top > rootRect.top + rootRect.height * 0.55)
      .filter((x) => x.left >= rootRect.left - 32 && x.right <= rootRect.right + 32)
      .sort((a, b) => b.bottom - a.bottom || Math.abs((a.left + a.right) - (rootRect.left + rootRect.right)) - Math.abs((b.left + b.right) - (rootRect.left + rootRect.right)))[0];
    const close = buttons
      .filter((x) => /닫기|close|×|x/i.test(x.text))
      .filter(buttonLike)
      .sort((a, b) => b.bottom - a.bottom || b.right - a.right)[0];
    const hit = exact || bottomConfirm || close;
    if (hit) {
      try { hit.el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
      try { hit.el.focus?.(); } catch (e) {}
      const point = await clickAtCenter(hit);
      mark('download_request_list_modal_close_clicked', { text: hit.rawText, tag: hit.targetTag, top: hit.top, left: hit.left, bottom: hit.bottom, right: hit.right, click_x: point.x, click_y: point.y, point_tag: point.pointTag, point_text: point.pointText });
      for (let i = 0; i < 20; i += 1) {
        await sleep(250);
        if (!requestListRoots().length) {
          mark('download_request_list_modal_closed');
          return true;
        }
      }
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); } catch (e) {}
      await sleep(700);
      if (!requestListRoots().length) {
        mark('download_request_list_modal_closed_after_escape_fallback');
        return true;
      }
      const fallbackHit = { el: root, rawText: 'bottom_center_fallback', targetTag: 'root', top: rootRect.bottom - 42, left: rootRect.left + 24, right: rootRect.right - 24, bottom: rootRect.bottom - 12 };
      const fallbackPoint = await clickAtCenter(fallbackHit);
      mark('download_request_list_modal_bottom_center_fallback_clicked', { click_x: fallbackPoint.x, click_y: fallbackPoint.y, point_tag: fallbackPoint.pointTag, point_text: fallbackPoint.pointText });
      await sleep(900);
      if (!requestListRoots().length) {
        mark('download_request_list_modal_closed_after_bottom_center_fallback');
        return true;
      }
      mark('download_request_list_modal_close_failed', { remaining: requestListRoots().length, root_top: rootRect.top, root_left: rootRect.left, root_width: rootRect.width, root_height: rootRect.height, candidates: buttons.slice(0, 8).map((x) => ({ text: x.rawText, top: x.top, left: x.left, right: x.right, bottom: x.bottom, width: x.width, height: x.height, tag: x.targetTag })) });
      return false;
    }
    mark('download_request_list_modal_confirm_not_found', { root_top: rootRect.top, root_left: rootRect.left, root_width: rootRect.width, root_height: rootRect.height, candidates: buttons.slice(0, 8).map((x) => ({ text: x.rawText, top: x.top, left: x.left, right: x.right, bottom: x.bottom, width: x.width, height: x.height, tag: x.targetTag })) });
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); } catch (e) {}
    mark('download_request_list_modal_escape_close');
    await sleep(800);
    return requestListRoots().length === 0;
  };
  const ensureRequestListClosed = async (timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (!requestListRoots().length) return true;
      await closeRequestListModal();
      if (!requestListRoots().length) return true;
      await sleep(500);
    }
    if (requestListRoots().length && isRequestListEmptyNow()) {
      mark('download_request_list_modal_still_open_but_empty_reload', { remaining: requestListRoots().length });
      try { location.href = targetUrl; } catch (e) {}
      await sleep(5000);
      if (!requestListRoots().length) {
        mark('download_request_list_modal_cleared_by_reload');
        return true;
      }
    }
    mark('download_request_list_modal_still_open', { remaining: requestListRoots().length });
    return false;
  };
  const openRequestListModal = async (timeout = 20000) => {
    if (requestListRoots().length) return true;
    const opened = await clickText([/다운로드요청목록/, /요청목록/, /downloadrequestlist|downloadlist/i], timeout);
    if (!opened) mark('download_list_button_not_found');
    await sleep(1500);
    return opened || requestListRoots().length > 0;
  };
  const requestRowsOf = (root) => Array.from(root.querySelectorAll('tbody tr,[role="row"],tr,[class*="row"],[class*="Row"]'))
    .filter(isVisible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { el, text: compact(textOf(el)), rawText: textOf(el), width: r.width, height: r.height, top: r.top, left: r.left };
    })
    .filter((x) => x.width >= 300 && x.height >= 18)
    .filter((x) => /20\d{2}\.\d{2}\.\d{2}|godl1004|다운로드|준비중|만료/.test(x.text))
    .filter((x) => !/전체선택|요청일시분석단위기간게재위치오디언스요청자상태파일생성일시/.test(x.text));
  const clickConfirmInAnyModal = async (timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const roots = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"],body > div,body > section'))
        .filter(isVisible)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width >= 240 && r.height >= 120;
        });
      for (const root of roots) {
        const controls = Array.from(root.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],span,div'))
          .filter(isVisible)
          .map((el) => {
            const target = clickableOf(el);
            const r = el.getBoundingClientRect();
            const tr = target.getBoundingClientRect();
            const disabled = !!(target.disabled || target.getAttribute?.('aria-disabled') === 'true');
            const targetTag = String(target.tagName || '').toLowerCase();
            const targetRole = String(target.getAttribute?.('role') || '').toLowerCase();
            return { el: target, disabled, rawText: textOf(el) || textOf(target), text: compact(textOf(el)) + ' ' + compact(textOf(target)) + ' ' + compact(String(target.className || '')), width: tr.width, height: tr.height, right: tr.right, bottom: tr.bottom, targetTag, targetRole };
          })
          .filter((x) => !x.disabled && x.width >= 20 && x.height >= 10)
          .filter((x) => x.targetTag === 'button' || x.targetTag === 'a' || x.targetTag === 'input' || x.targetRole === 'button' || (x.width <= 260 && x.height <= 72 && /btn|button|primary|solid/i.test(x.text)));
        controls.sort((a, b) => b.bottom - a.bottom || b.right - a.right);
        const hit = controls.find((x) => /^확인$/.test(compact(x.rawText))) || controls.find((x) => /확인|삭제|delete|ok/i.test(x.text));
        if (hit) {
          const result = await clickElement(hit.el);
          mark('modal_confirm_clicked', { text: result.text || hit.rawText });
          await sleep(1000);
          return true;
        }
      }
      await sleep(500);
    }
    return false;
  };
  const hasRequestLimitWarning = () => /보고서다운로드는최대50개까지요청가능합니다|최대50개까지요청가능|다운로드요청목록에서더이상사용하지않은보고서파일을삭제해주세요|더이상사용하지않은보고서파일을삭제해주세요/.test(compact(String(document.body?.innerText || '')));
  const hasDeleteRequestConfirmText = () => /요청내역을삭제하시겠습니까|요청내역삭제|요청정보를삭제하시겠습니까|요청정보삭제|삭제하시겠습니까/.test(compact(String(document.body?.innerText || '')));
  const isRequestListEmptyNow = () => {
    const roots = requestListRoots();
    const root = roots[0];
    if (!root) return true;
    const rowsNow = requestRowsOf(root);
    const textNow = compact(String(root.innerText || document.body?.innerText || ''));
    return rowsNow.length === 0 || /다운로드요청내역이없습니다|요청내역이없습니다|내역이없습니다/.test(textNow);
  };
  const clickDeleteRequestConfirmModal = async (timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const roots = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"],body > div,body > section'))
        .filter(isVisible)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const text = compact(textOf(el));
          return { el, text, width: r.width, height: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom, area: r.width * r.height };
        })
        .filter((x) => x.width >= 240 && x.height >= 120)
        .filter((x) => /요청내역을삭제하시겠습니까|요청내역삭제|요청정보를삭제하시겠습니까|요청정보삭제|다운로드받을수없습니다|삭제하시겠습니까/.test(x.text))
        .sort((a, b) => a.area - b.area || b.top - a.top);
      for (const root of roots) {
        const controls = Array.from(root.el.querySelectorAll('button,a,[role="button"]'))
          .filter(isVisible)
          .map((el) => {
            const r = el.getBoundingClientRect();
            const disabled = !!(el.disabled || el.getAttribute?.('aria-disabled') === 'true');
            const rawText = textOf(el);
            const text = compact(rawText) + ' ' + compact(String(el.className || ''));
            return { el, disabled, rawText, text, width: r.width, height: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom };
          })
          .filter((x) => !x.disabled && x.width >= 20 && x.height >= 10)
          .filter((x) => /^확인$/.test(compact(x.rawText)) || /확인|ok/i.test(x.text))
          .sort((a, b) => b.right - a.right || b.bottom - a.bottom);
        const hit = controls[0];
        if (hit) {
          const result = await clickElement(hit.el);
          mark('download_request_delete_confirm_clicked', { text: result.text || hit.rawText, root_text: root.text.slice(0, 140), top: hit.top, left: hit.left });
          await sleep(1200);
          return true;
        }
      }
      await sleep(500);
    }
    mark('download_request_delete_confirm_not_found');
    return false;
  };
  const recoverFromRequestLimitPopup = async (stage = 'download_request_limit_recovery') => {
    mark(stage + '_start', { has_limit_warning: hasRequestLimitWarning() });
    await clickConfirmInAnyModal(8000);
    await sleep(1000);
    const opened = await openRequestListModal(20000);
    mark(stage + '_list_opened', { opened, roots: requestListRoots().length });
    const cleanup = await clearRequestListIfNeeded(true);
    mark(stage + '_cleanup_done', { checked: !!cleanup?.checked, cleared: !!cleanup?.cleared, row_count: cleanup?.row_count || 0, error: cleanup?.error || '' });
    if (!cleanup?.checked) {
      return { ok: false, error: 'gfa_request_list_not_opened_for_force_cleanup' };
    }
    if ((cleanup?.row_count || 0) > 0 && cleanup?.cleared !== true) {
      return { ok: false, error: String(cleanup?.error || 'gfa_request_list_force_cleanup_failed') };
    }
    if (!(await ensureRequestListClosed(8000))) {
      return { ok: false, error: 'gfa_request_list_modal_not_closed_after_force_cleanup' };
    }
    return { ok: true, latest_row_text: '' };
  };
  const clearRequestListIfNeeded = async (force = false) => {
    await openRequestListModal(20000);
    const roots = requestListRoots();
    if (!roots.length) return { checked: false, cleared: false, row_count: 0 };
    const root = roots.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    })[0];
    const rows = requestRowsOf(root).sort((a, b) => a.top - b.top || a.left - b.left);
    const latestRowText = rows[0]?.rawText || '';
    mark('download_request_list_capacity_checked', { row_count: rows.length, force });
    if (rows.length === 0) {
      mark('download_request_list_empty_skip_cleanup', { force });
      await closeRequestListModal();
      return { checked: true, cleared: false, row_count: 0, latest_row_text: '' };
    }
    if (!force && rows.length < 45) {
      if (force) mark('download_request_list_force_cleanup_skipped_low_count', { row_count: rows.length });
      await closeRequestListModal();
      return { checked: true, cleared: false, row_count: rows.length, latest_row_text: latestRowText };
    }
    const rootRectForSelectAll = root.getBoundingClientRect();
    const dataRowElements = rows.map((row) => row.el).filter(Boolean);
    const firstDataRowTop = rows.length ? Math.min(...rows.map((row) => row.top || Number.POSITIVE_INFINITY)) : Number.POSITIVE_INFINITY;
    const isInsideDataRow = (el) => {
      let cur = el;
      for (let i = 0; i < 14 && cur && cur !== root; i += 1) {
        if (dataRowElements.some((rowEl) => rowEl === cur || rowEl.contains(cur))) return true;
        const tag = String(cur.tagName || '').toLowerCase();
        const role = String(cur.getAttribute?.('role') || '').toLowerCase();
        const cls = String(cur.className || '');
        const txt = compact(textOf(cur));
        if ((tag === 'tr' || role === 'row' || /row/i.test(cls))
          && /20\d{2}\.\d{2}\.\d{2}|godl1004|다운로드|준비중|만료/.test(txt)
          && !/전체선택|요청일시분석단위기간게재위치오디언스요청자상태파일생성일시/.test(txt)) return true;
        if (/20\d{2}\.\d{2}\.\d{2}|godl1004|다운로드|준비중|만료/.test(txt)
          && !/전체선택|요청일시분석단위기간게재위치오디언스요청자상태파일생성일시/.test(txt)) return true;
        cur = cur.parentElement;
      }
      return false;
    };
    const isHeaderLike = (el, top, left) => {
      let cur = el;
      for (let i = 0; i < 12 && cur && cur !== root; i += 1) {
        const tag = String(cur.tagName || '').toLowerCase();
        const role = String(cur.getAttribute?.('role') || '').toLowerCase();
        const cls = String(cur.className || '');
        const txt = compact(textOf(cur));
        if (tag === 'thead' || role === 'columnheader' || /head|header/i.test(cls) || /전체선택|전체 선택/.test(txt)) return true;
        cur = cur.parentElement;
      }
      const inTopLeftBand =
        top <= Math.min(firstDataRowTop - 4, rootRectForSelectAll.top + Math.max(180, rootRectForSelectAll.height * 0.34))
        && left <= rootRectForSelectAll.left + Math.max(180, rootRectForSelectAll.width * 0.28);
      return inTopLeftBand;
    };
    const selectAllLabels = Array.from(root.querySelectorAll('label,span,div,th,[role="columnheader"]'))
      .filter(isVisible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, text: compact(textOf(el)), top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cy: r.top + r.height / 2 };
      })
      .filter((x) => /^전체선택$|^전체 선택$/.test(x.text))
      .filter((x) => x.width <= 140 && x.height <= 48)
      .filter((x) => x.top <= rootRectForSelectAll.top + 180 && x.left <= rootRectForSelectAll.left + 220)
      .sort((a, b) => a.top - b.top || a.left - b.left);
    const nearSelectAllLabel = (top, left, right) => selectAllLabels.some((label) => {
      const cy = top;
      const verticalOk = Math.abs(cy - label.cy) <= 32 || (top >= label.top - 16 && top <= label.bottom + 16);
      const horizontalOk = left <= label.right + 24 && right >= label.left - 80;
      return verticalOk && horizontalOk;
    });
    const inStrictTopLeftHeaderBand = (top, left) =>
      rows.length > 0
      && top <= rootRectForSelectAll.top + 165
      && left <= rootRectForSelectAll.left + 150
      && top < firstDataRowTop - 12;
    const selectAllCandidates = Array.from(root.querySelectorAll('input[type="checkbox"],[role="checkbox"]'))
      .filter(isVisible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const rawText = textOf(el);
        const tag = String(el.tagName || '').toLowerCase();
        const type = String(el.getAttribute?.('type') || '').toLowerCase();
        const text = compact(rawText);
        const top = r.top;
        const left = r.left;
        let score = 0;
        const insideDataRow = isInsideDataRow(el);
        const headerLike = isHeaderLike(el, top, left);
        const labelNear = nearSelectAllLabel(top + r.height / 2, left, r.right);
        const topLeftHeaderBand = inStrictTopLeftHeaderBand(top, left);
        if (/전체선택|전체 선택/.test(text)) score += 600;
        if (tag === 'input' && type === 'checkbox') score += 250;
        if (String(el.getAttribute?.('role') || '').toLowerCase() === 'checkbox') score += 230;
        if (top < firstDataRowTop) score += 220;
        if (top < rootRectForSelectAll.top + 180) score += 100;
        if (left < rootRectForSelectAll.left + 180) score += 120;
        if (headerLike) score += 900;
        if (labelNear) score += 1200;
        if (topLeftHeaderBand) score += 800;
        if (insideDataRow) score -= 2000;
        return { el, rawText, text, tag, type, width: r.width, height: r.height, top, left, score, insideDataRow, headerLike, labelNear, topLeftHeaderBand, role: String(el.getAttribute?.('role') || '').toLowerCase() };
      })
      .filter((x) => (x.tag === 'input' && x.type === 'checkbox') || x.role === 'checkbox')
      .filter((x) => !x.insideDataRow)
      .filter((x) => x.labelNear || x.topLeftHeaderBand)
      .sort((a, b) => b.score - a.score || a.top - b.top || a.left - b.left);
    const selectAll = selectAllCandidates[0];
    if (!selectAll) {
      mark('download_request_list_select_all_not_found', { row_count: rows.length, force, first_data_row_top: firstDataRowTop, root_top: rootRectForSelectAll.top, root_left: rootRectForSelectAll.left, labels: selectAllLabels.slice(0, 3).map((x) => ({ text: x.text, top: x.top, left: x.left })) });
      await closeRequestListModal();
      return { checked: true, cleared: false, row_count: rows.length, latest_row_text: latestRowText, error: 'select_all_not_found' };
    }
    await clickElement(selectAll.el);
    mark('download_request_list_select_all_clicked', { text: selectAll.rawText || selectAll.tag, top: selectAll.top, left: selectAll.left, score: selectAll.score, header_like: selectAll.headerLike, label_near: selectAll.labelNear, top_left_header: selectAll.topLeftHeaderBand, candidates: selectAllCandidates.slice(0, 5).map((x) => ({ text: x.rawText || x.tag || x.role, top: x.top, left: x.left, score: x.score, header_like: x.headerLike, label_near: x.labelNear, top_left_header: x.topLeftHeaderBand })) });
    await sleep(800);
    const deleteScope = Array.from(new Set([root, document.body])).filter(Boolean);
    const deleteHit = deleteScope.flatMap((scope) => Array.from(scope.querySelectorAll('button,a,[role="button"],span,div')))
      .filter(isVisible)
      .map((el) => {
        const target = clickableOf(el);
        const r = el.getBoundingClientRect();
        const tr = target.getBoundingClientRect();
        const disabled = !!(target.disabled || target.getAttribute?.('aria-disabled') === 'true');
        const rawText = textOf(el) || textOf(target);
        const text = compact(rawText) + ' ' + compact(textOf(target)) + ' ' + compact(String(target.className || ''));
        let score = 0;
        if (/^삭제$/.test(compact(rawText))) score += 700;
        if (/선택삭제|삭제/.test(text)) score += 500;
        if (/다운로드|요청|목록|전체선택/.test(text)) score -= 500;
        if (tr.top < root.getBoundingClientRect().top + 140) score += 100;
        if (tr.left > root.getBoundingClientRect().left + root.getBoundingClientRect().width * 0.45) score += 60;
        return { el: target, disabled, rawText, text, width: Math.max(r.width, tr.width), height: Math.max(r.height, tr.height), top: Math.min(r.top, tr.top), left: Math.min(r.left, tr.left), score };
      })
      .filter((x) => !x.disabled && x.score > 0 && x.width >= 12 && x.height >= 8)
      .sort((a, b) => b.score - a.score || a.top - b.top || b.left - a.left)[0];
    if (!deleteHit) {
      mark('download_request_list_delete_not_found', { row_count: rows.length, force });
      await closeRequestListModal();
      return { checked: true, cleared: false, row_count: rows.length, latest_row_text: latestRowText, error: 'delete_not_found' };
    }
    await clickElement(deleteHit.el);
    mark('download_request_list_delete_clicked', { row_count: rows.length });
    const deleteConfirmed = await clickDeleteRequestConfirmModal(8000);
    if (!deleteConfirmed) {
      await sleep(1200);
      const currentRoots = requestListRoots();
      const currentRoot = currentRoots[0];
      const currentRows = currentRoot ? requestRowsOf(currentRoot) : [];
      const currentText = compact(String(currentRoot?.innerText || document.body?.innerText || ''));
      const looksEmpty = currentRows.length === 0 || /다운로드요청내역이없습니다|요청내역이없습니다|내역이없습니다/.test(currentText);
      if (looksEmpty) {
        mark('download_request_delete_confirm_missing_but_list_empty', { before_row_count: rows.length, current_row_count: currentRows.length });
        await closeRequestListModal();
        return { checked: true, cleared: true, row_count: rows.length, latest_row_text: '' };
      }
      await closeRequestListModal();
      if (rows.length < 45) {
        mark('download_request_delete_confirm_missing_but_below_limit_continue', { row_count: rows.length, current_row_count: currentRows.length });
        return { checked: true, cleared: false, row_count: rows.length, latest_row_text: latestRowText, warning: 'delete_confirm_not_found_but_below_limit' };
      }
      return { checked: true, cleared: false, row_count: rows.length, latest_row_text: latestRowText, error: 'delete_confirm_not_found' };
    }
    await sleep(1200);
    for (let i = 0; i < 3 && hasDeleteRequestConfirmText(); i += 1) {
      const clickedAgain = await clickDeleteRequestConfirmModal(2500);
      if (!clickedAgain) await clickConfirmInAnyModal(2500);
      await sleep(900);
    }
    await clickConfirmInAnyModal(2500);
    await sleep(800);
    const closedAfterDelete = await closeRequestListModal();
    if (!closedAfterDelete && requestListRoots().length) {
      if (isRequestListEmptyNow()) {
        mark('download_request_list_close_after_delete_failed_but_empty', { row_count: rows.length });
        return { checked: true, cleared: true, row_count: rows.length, latest_row_text: '', warning: 'request_list_close_after_delete_failed_but_empty' };
      }
      return { checked: true, cleared: false, row_count: rows.length, latest_row_text: latestRowText, error: 'request_list_close_after_delete_failed' };
    }
    return { checked: true, cleared: true, row_count: rows.length, latest_row_text: '' };
  };
  const clickLatestDownloadWithReopen = async (timeout = 720000, baselineLatestRowText = '') => {
    const started = Date.now();
    const baselineLatestRowCompact = compact(baselineLatestRowText);
    while (Date.now() - started < timeout) {
      if (hasRequestLimitWarning()) {
        const recovery = await recoverFromRequestLimitPopup('download_request_limit_during_wait');
        if (!recovery.ok) {
          mark('download_request_limit_during_wait_failed', { error: recovery.error || '' });
          return false;
        }
        await sleep(1500);
      }
      if (!requestListRoots().length) {
        await openRequestListModal(20000);
      }
      const roots = requestListRoots();
      if (roots.length) {
        const root = roots.sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return (ar.width * ar.height) - (br.width * br.height);
        })[0];
        mark('download_request_list_modal_found', { text: textOf(root).slice(0, 180) });
        const rowCandidates = requestRowsOf(root);
        rowCandidates.sort((a, b) => a.top - b.top || a.left - b.left);
        const latestRow = rowCandidates[0];
        if (latestRow) {
          mark('download_request_latest_row_seen', { text: latestRow.rawText.slice(0, 220), top: latestRow.top, left: latestRow.left });
          if (baselineLatestRowCompact && compact(latestRow.rawText) === baselineLatestRowCompact) {
            mark('download_request_latest_row_is_previous', { baseline: baselineLatestRowText.slice(0, 220), latest: latestRow.rawText.slice(0, 220) });
            await closeRequestListModal();
            await sleep(3000);
            continue;
          }
          if (/준비중/.test(latestRow.text) && !/다운로드/.test(latestRow.text)) {
            mark('download_request_latest_row_still_preparing', { row: latestRow.rawText.slice(0, 180) });
            await sleep(3000);
            continue;
          }
          const rowHits = Array.from(latestRow.el.querySelectorAll('button,a,[role="button"],span,div'))
            .filter(isVisible)
            .map((el) => {
              const r = el.getBoundingClientRect();
              const rawText = textOf(el);
              const text = compact(rawText) + ' ' + compact(String(el.className || ''));
              const tag = String(el.tagName || '').toLowerCase();
              const role = String(el.getAttribute?.('role') || '').toLowerCase();
              return { el, rawText, text, tag, role, width: r.width, height: r.height, top: r.top, left: r.left };
            })
            .filter((x) => /^다운로드$/.test(compact(x.rawText)))
            .filter((x) => x.width >= 20 && x.height >= 8);
          rowHits.sort((a, b) => {
            const ab = (a.tag === 'a' || a.tag === 'button' || a.role === 'button') ? 1 : 0;
            const bb = (b.tag === 'a' || b.tag === 'button' || b.role === 'button') ? 1 : 0;
            return bb - ab || a.top - b.top || a.left - b.left || a.width - b.width;
          });
          const hit = rowHits[0];
          if (hit) {
            const result = await clickElement(hit.el);
            mark('download_request_latest_row_download_clicked', { text: result.text || hit.rawText, tag: result.tag, className: result.className, row: latestRow.rawText.slice(0, 180), top: hit.top, left: hit.left });
            await sleep(1200);
            return true;
          }
          mark('download_request_latest_row_download_not_ready', { row: latestRow.rawText.slice(0, 180) });
          await sleep(3000);
          continue;
        }
        await closeRequestListModal();
      }
      await sleep(3000);
    }
    return false;
  };
  if (!location.href.includes('/da/report/performance')) {
    location.href = targetUrl;
    await sleep(5000);
  }
  mark('page_ready', { href: location.href, title: document.title });
  const body = () => String(document.body?.innerText || '');
  if (/로그인|login/i.test(body()) && !/다운로드/i.test(body())) {
    return { ok: false, clicked: false, human_action_required: true, human_action_reason: 'login_required', stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, error: 'login_required', via: 'naver_gfa_performance_report_cdp' };
  }
  if (/조회된내역이없습니다|기간과필터조건을확인|조회내역이없습니다/.test(compact(body()))) {
    mark('gfa_report_no_data_detected');
    return { ok: true, clicked: true, requested: false, skipped: true, gfa_no_data: true, ad_unit: new URLSearchParams(location.search).get('adUnit') || 'CREATIVE', stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, body_sample: body().slice(0, 900), error: null, via: 'naver_gfa_performance_report_cdp' };
  }
  let baselineListState = { checked: false, cleared: false, row_count: 0, latest_row_text: '' };
  if (clearRequestListAtStart) {
    baselineListState = await clearRequestListIfNeeded(true);
    mark('download_request_list_initial_cleanup_done', { row_count: baselineListState?.row_count || 0, cleared: !!baselineListState?.cleared, error: baselineListState?.error || '', warning: baselineListState?.warning || '' });
    if (!baselineListState?.checked) {
      return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, body_sample: body().slice(0, 900), error: 'gfa_request_list_not_opened_before_request', via: 'naver_gfa_performance_report_cdp' };
    }
    if ((baselineListState?.row_count || 0) >= 45 && baselineListState?.cleared !== true) {
      return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, body_sample: body().slice(0, 900), error: String(baselineListState?.error || 'gfa_request_list_force_cleanup_failed_before_request'), via: 'naver_gfa_performance_report_cdp' };
    }
  } else if (skipInitialRequestListCheck) {
    mark('download_request_list_initial_check_skipped');
  } else {
    baselineListState = await clearRequestListIfNeeded(false);
  }
  let baselineLatestRowText = baselineListState?.latest_row_text || '';
  if (!(await ensureRequestListClosed(8000))) {
    return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, body_sample: body().slice(0, 900), error: 'gfa_request_list_modal_not_closed_before_request', via: 'naver_gfa_performance_report_cdp' };
  }
  let requested = await clickText([/다운로드요청(?!목록)/, /downloadrequest(?!list)/i], 20000);
  if (!requested && hasRequestLimitWarning()) {
    mark('download_request_limit_possible_retry_after_cleanup');
    const recovery = await recoverFromRequestLimitPopup('download_request_limit_before_request');
    if (!recovery.ok) {
      return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, body_sample: body().slice(0, 900), error: recovery.error || 'gfa_request_list_modal_not_closed_after_cleanup', via: 'naver_gfa_performance_report_cdp' };
    }
    baselineLatestRowText = String(recovery.latest_row_text || '');
    requested = await clickText([/다운로드요청(?!목록)/, /downloadrequest(?!list)/i], 20000);
  }
  if (!requested) {
    return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, body_sample: body().slice(0, 900), error: 'gfa_download_request_button_not_found', via: 'naver_gfa_performance_report_cdp' };
  }
  await sleep(1200);
  let confirmed = false;
  if (requestListRoots().length) {
    mark('auto_opened_request_list_detected_before_confirm');
    if (!(await closeRequestListModal())) {
      return { ok: false, clicked: false, requested, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, body_sample: body().slice(0, 900), error: 'gfa_auto_request_list_not_closed_before_confirm', via: 'naver_gfa_performance_report_cdp' };
    }
    confirmed = true;
    await sleep(3000);
  } else {
    confirmed = await clickDownloadRequestConfirm(15000);
  }
  if (!confirmed && hasRequestLimitWarning()) {
    mark('download_request_confirm_limit_retry_after_cleanup');
    const recovery = await recoverFromRequestLimitPopup('download_request_limit_after_confirm');
    if (!recovery.ok) {
      return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, body_sample: body().slice(0, 900), error: recovery.error || 'gfa_request_list_modal_not_closed_after_confirm_cleanup', via: 'naver_gfa_performance_report_cdp' };
    }
    baselineLatestRowText = String(recovery.latest_row_text || '');
    requested = await clickText([/다운로드요청(?!목록)/, /downloadrequest(?!list)/i], 20000);
    if (!requested) {
      return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, body_sample: body().slice(0, 900), error: 'gfa_download_request_button_not_found_after_cleanup', via: 'naver_gfa_performance_report_cdp' };
    }
    confirmed = await clickDownloadRequestConfirm(15000);
  }
  if (!confirmed && /다운로드를요청하시겠습니까|다운로드가능시점/.test(compact(body()))) {
    return { ok: false, clicked: false, requested, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, body_sample: body().slice(0, 900), error: 'gfa_download_request_confirm_not_found', via: 'naver_gfa_performance_report_cdp' };
  }
  if (confirmed) {
    await sleep(1200);
    if (requestListRoots().length) {
      mark('auto_opened_request_list_detected_after_confirm');
      await closeRequestListModal();
      await sleep(3000);
    } else {
      await clickDownloadRequestStatusConfirm(5000);
    }
  }
  await sleep(3000);
  if (requestListRoots().length) {
    mark('auto_opened_request_list_detected');
    await closeRequestListModal();
    await sleep(3000);
  }
  const downloaded = await clickLatestDownloadWithReopen(720000, baselineLatestRowText);
  return { ok: downloaded, clicked: downloaded, requested, list_clicked: downloaded, baseline_latest_row: baselineLatestRowText.slice(0, 220), stage_log: stageLog, date_from: dateFrom, date_to: dateTo, page_url: location.href, title: document.title, body_sample: body().slice(0, 900), error: downloaded ? null : 'gfa_download_file_button_not_found', via: 'naver_gfa_performance_report_cdp' };
})()
"@
	if ($null -ne $Page) {
		return Invoke-CdpEvaluateOnPage -Page $Page -expression $expression -timeoutMs 3600000
	}
	return Invoke-CdpEvaluate -port $port -expression $expression -timeoutMs 3600000
}

function Invoke-AdsSearchwordReportDownload([int]$port, [string]$url, [string]$dateFrom, [string]$dateTo, [bool]$KeepPageAndStepPrev = $false) {
	$urlJson = $url | ConvertTo-Json -Compress
	$dateFromJson = $dateFrom | ConvertTo-Json -Compress
	$dateToJson = $dateTo | ConvertTo-Json -Compress
	$keepPageAndStepPrevJson = $KeepPageAndStepPrev | ConvertTo-Json -Compress
	$trustedFrom = (([string]$dateFrom).Replace("-", ".")).TrimEnd(".")
	$trustedTo = (([string]$dateTo).Replace("-", ".")).TrimEnd(".")
	if (-not [string]::IsNullOrWhiteSpace($trustedFrom)) { $trustedFrom = $trustedFrom + "." }
	if (-not [string]::IsNullOrWhiteSpace($trustedTo)) { $trustedTo = $trustedTo + "." }
	$trustedPrepExpression = @"
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const compact = (v) => norm(v).replace(/\s+/g, '');
  const textOf = (el) => String((el && (el.innerText || el.textContent || el.value)) || '');
  const visible = (el) => !!el && !el.disabled && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const clickElement = async (el) => {
    try { el.focus?.(); } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {}
    el.click();
    await sleep(900);
    return true;
  };
  const allControls = () => Array.from(document.querySelectorAll('button,a,[role="button"],input,div,span,label')).filter(visible);
  const clickAnyText = async (patterns, timeoutMs = 0) => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const hit = allControls().find((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 10 || rect.width > window.innerWidth * 0.9 || rect.height > window.innerHeight * 0.5) return false;
        const hay = compact(textOf(el)) + ' ' + compact(String(el.className || '')) + ' ' + compact(String(el.getAttribute('aria-label') || '')) + ' ' + compact(String(el.getAttribute('title') || ''));
        return patterns.some((re) => re.test(hay));
      });
      if (hit) return await clickElement(hit);
      if (Date.now() >= deadline) return false;
      await sleep(500);
    }
  };
  const isCalendarOpen = () => Array.from(document.querySelectorAll('.calendar_lypop,.DayPicker,[class*="calendar"],[class*="datepicker"]')).some(visible)
    || Array.from(document.querySelectorAll('input')).filter((el) => visible(el) && /\d{4}[.-]\d{2}[.-]\d{2}/.test(String(el.value || ''))).length >= 2;
  const clickDateRangeControl = async () => {
    const candidates = Array.from(document.querySelectorAll('input,button,[role="button"],a,div,span')).filter(visible);
    const hit = candidates.find((el) => /\d{4}[.-]\d{2}[.-]\d{2}/.test(String(el.value || textOf(el) || el.getAttribute('aria-label') || el.getAttribute('title') || '')));
    if (!hit) return false;
    let p = hit;
    for (let i = 0; i < 8 && p; i += 1) {
      const tag = String(p.tagName || '').toLowerCase();
      const role = String(p.getAttribute?.('role') || '').toLowerCase();
      const cls = String(p.className || '');
      const r = p.getBoundingClientRect();
      if ((tag === 'button' || tag === 'a' || role === 'button' || /button|btn|datepicker|calendar|select|dropdown/i.test(cls)) && r.width > 10 && r.height > 10) {
        return await clickElement(p);
      }
      p = p.parentElement;
    }
    return await clickElement(hit);
  };
  const focusDateInput = async (index) => {
    const inputs = Array.from(document.querySelectorAll('input')).filter((el) => visible(el) && !/hidden|checkbox|radio/i.test(String(el.type || '')))
      .filter((el) => /\d{4}[.-]\d{2}[.-]\d{2}|날짜|기간|시작|종료|start|end|from|to/i.test(String(el.value || el.placeholder || el.getAttribute('aria-label') || el.name || el.id || '')))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.top - br.top || ar.left - br.left;
      })
      .slice(0, 2);
    const el = inputs[index];
    if (!el) return { ok: false, values: inputs.map((one) => String(one.value || '')) };
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
    try { el.focus?.(); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    try { el.select?.(); } catch (e) {}
    try { el.setSelectionRange?.(0, String(el.value || '').length); } catch (e) {}
    await sleep(250);
    return { ok: document.activeElement === el, value: String(el.value || ''), values: inputs.map((one) => String(one.value || '')) };
  };
  let bodyText = document.body?.innerText || '';
  if (/플랫폼이\s*업데이트|새로고침\s*해\s*주세요/.test(bodyText)) {
    await clickAnyText([/^새로고침$/, /새로고침/], 2500);
    await sleep(3500);
    bodyText = document.body?.innerText || '';
  }
  const settingsAlreadyOpen = /보고서\s*항목\s*목록|보고서\s*설정하기/.test(bodyText) && /캠페인|검색어|일별/.test(bodyText);
  const openedSettings = settingsAlreadyOpen || (await clickAnyText([/보고서설정하기/, /보고서설정/, /설정하기/], 4000));
  await sleep(600);
  if (!isCalendarOpen()) {
    await clickDateRangeControl();
    await sleep(700);
  }
  const focus = await focusDateInput(0);
  return { ok: !!focus.ok, openedSettings, calendarOpen: isCalendarOpen(), focus };
})()
"@
	if ($false) {
	try {
		$trustedPrep = @(Invoke-CdpEvaluate -port $port -expression $trustedPrepExpression -timeoutMs 20000) | Select-Object -Last 1
		if ($trustedPrep -and ($trustedPrep.ok -eq $true)) {
			Invoke-CdpTrustedTextInput -port $port -Text $trustedFrom -DelayMs 85
			$trustedFocusToExpression = @"
(async () => {
  const visible = (el) => !!el && !el.disabled && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const inputs = Array.from(document.querySelectorAll('input')).filter((el) => visible(el) && !/hidden|checkbox|radio/i.test(String(el.type || '')))
    .filter((el) => /\d{4}[.-]\d{2}[.-]\d{2}|날짜|기간|시작|종료|start|end|from|to/i.test(String(el.value || el.placeholder || el.getAttribute('aria-label') || el.name || el.id || '')))
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    })
    .slice(0, 2);
  const el = inputs[1];
  if (!el) return { ok: false, values: inputs.map((one) => String(one.value || '')) };
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
  try { el.focus?.(); } catch (e) {}
  try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
  try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
  try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
  try { el.select?.(); } catch (e) {}
  try { el.setSelectionRange?.(0, String(el.value || '').length); } catch (e) {}
  await new Promise((resolve) => setTimeout(resolve, 250));
  return { ok: document.activeElement === el, value: String(el.value || ''), values: inputs.map((one) => String(one.value || '')) };
})()
"@
			$trustedFocusTo = @(Invoke-CdpEvaluate -port $port -expression $trustedFocusToExpression -timeoutMs 10000) | Select-Object -Last 1
			if ($trustedFocusTo -and ($trustedFocusTo.ok -eq $true)) {
				Invoke-CdpTrustedTextInput -port $port -Text $trustedTo -DelayMs 85
				Start-Sleep -Milliseconds 400
				$trustedConfirmExpression = @"
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const compact = (v) => norm(v).replace(/\s+/g, '');
  const visible = (el) => !!el && !el.disabled && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const textOf = (el) => String((el && (el.innerText || el.textContent || el.value)) || '');
  const inputs = Array.from(document.querySelectorAll('input')).filter((el) => visible(el) && !/hidden|checkbox|radio/i.test(String(el.type || '')))
    .filter((el) => /\d{4}[.-]\d{2}[.-]\d{2}|날짜|기간|시작|종료|start|end|from|to/i.test(String(el.value || el.placeholder || el.getAttribute('aria-label') || el.name || el.id || '')))
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    })
    .slice(0, 2);
  const toEl = inputs[1];
  for (const el of inputs) {
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: String(el.value || '') })); } catch (e) {
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    }
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  }
  await sleep(250);
  if (toEl) {
    try { toEl.focus?.(); } catch (e) {}
    try { const len = String(toEl.value || '').length; toEl.setSelectionRange?.(len, len); } catch (e) {}
    await sleep(180);
  }
  const buttons = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],span,div')).filter(visible);
  const candidates = buttons
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const txt = compact(textOf(el));
      let score = 0;
      if (/확인|적용|조회|ok|apply/i.test(txt)) score += 300;
      if (/취소|닫기|close|cancel/i.test(txt)) score -= 300;
      if (rect.top >= 180) score += 30;
      if (rect.left >= window.innerWidth * 0.5) score += 30;
      if (rect.width >= 30 && rect.height >= 18) score += 20;
      return { el, rect, txt, score };
    })
    .filter((item) => item.score > 0 && item.rect.width >= 24 && item.rect.height >= 16)
    .sort((a, b) => b.score - a.score || b.rect.top - a.rect.top || b.rect.left - a.rect.left);
  const hit = candidates[0];
  if (!hit) return { ok: false, values: inputs.map((one) => String(one.value || '')) };
  return {
    ok: true,
    text: norm(textOf(hit.el)),
    x: Math.round(hit.rect.left + hit.rect.width / 2),
    y: Math.round(hit.rect.top + hit.rect.height / 2),
    values: inputs.map((one) => String(one.value || '')),
    activeEndInput: document.activeElement === toEl,
  };
})()
"@
				$trustedConfirm = @(Invoke-CdpEvaluate -port $port -expression $trustedConfirmExpression -timeoutMs 10000) | Select-Object -Last 1
				if ($trustedConfirm -and ($trustedConfirm.ok -eq $true)) {
					Invoke-CdpTrustedMouseClick -port $port -X ([double]$trustedConfirm.x) -Y ([double]$trustedConfirm.y)
					Start-Sleep -Milliseconds 1800
				}
			}
		}
	} catch {
		Write-Warn ("trusted date prefill failed: {0}" -f $_.Exception.Message)
	}
	}
	$expression = @"
(async () => {
  const targetUrl = $urlJson;
  const dateFrom = $dateFromJson;
  const dateTo = $dateToJson;
  const keepPageAndStepPrev = $keepPageAndStepPrevJson;
  const stageLog = [];
  const mark = (stage, extra = {}) => { stageLog.push({ stage, ...extra }); };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const compact = (v) => norm(v).replace(/\s+/g, '');
  const textOf = (el) => String((el && (el.innerText || el.textContent || el.value)) || '');
  const setNativeValue = (el, value, opts = {}) => {
    const emitInput = opts.emitInput !== false;
    const emitChange = !!opts.emitChange;
    const emitBlur = !!opts.emitBlur;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    if (emitInput) el.dispatchEvent(new Event('input', { bubbles: true }));
    if (emitChange) el.dispatchEvent(new Event('change', { bubbles: true }));
    if (emitBlur) el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const visible = (el) => !!el && !el.disabled && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const controls = () => Array.from(document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]'))
    .filter(visible)
    .filter((el) => {
      const t = compact(textOf(el) + ' ' + String(el.className || '') + ' ' + String(el.getAttribute('aria-label') || '') + ' ' + String(el.getAttribute('title') || ''));
      const tag = String(el.tagName || '').toLowerCase();
      return ['button', 'a', 'input'].includes(tag) || String(el.getAttribute('role') || '') === 'button' || /button|btn/.test(t);
    });
  const clickElement = async (el) => {
    try { el.focus?.(); } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {}
    el.click();
    await sleep(1200);
    return true;
  };
  const clickByText = async (patterns, timeoutMs = 0) => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const hit = controls().find((el) => patterns.some((re) => re.test(compact(textOf(el)) + ' ' + String(el.className || '') + ' ' + String(el.getAttribute('aria-label') || '') + ' ' + String(el.getAttribute('title') || ''))));
      if (hit) return await clickElement(hit);
      if (Date.now() >= deadline) return false;
      await sleep(800);
    }
  };
  const clickAnyText = async (patterns, timeoutMs = 0) => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const all = Array.from(document.querySelectorAll('button,a,[role="button"],input,div,span,label')).filter(visible);
      const hit = all.find((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 10 || rect.width > window.innerWidth * 0.9 || rect.height > window.innerHeight * 0.5) return false;
        const hay = compact(textOf(el)) + ' ' + compact(String(el.className || '')) + ' ' + compact(String(el.getAttribute('aria-label') || '')) + ' ' + compact(String(el.getAttribute('title') || ''));
        return patterns.some((re) => re.test(hay));
      });
      if (hit) return await clickElement(hit);
      if (Date.now() >= deadline) return false;
      await sleep(800);
    }
  };
  let bodyText = document.body?.innerText || '';
  const title = document.title || '';
  if (/login|로그인|nid\.naver|권한|보안\s*확인|captcha|캡차/i.test(location.href + ' ' + title + ' ' + bodyText.slice(0, 1500))) {
    mark('login_required');
    return { ok: false, clicked: false, stage_log: stageLog, human_action_required: true, human_action_reason: 'login_required', page_url: location.href, title, error: 'login_required' };
  }
  if (/플랫폼이\s*업데이트|새로고침\s*해\s*주세요/.test(bodyText)) {
    mark('platform_refresh_required');
    const refreshed = await clickByText([/^새로고침$/, /새로고침/], 2500) || await clickAnyText([/^새로고침$/, /새로고침/], 2500);
    mark(refreshed ? 'platform_refresh_clicked' : 'platform_refresh_button_not_found');
    if (refreshed) {
      await sleep(4500);
      bodyText = document.body?.innerText || '';
    }
  }
  for (let i = 0; i < 8; i += 1) {
    bodyText = document.body?.innerText || '';
    if (/검색어\s*보고서|보고서\s*설정하기|다운로드/i.test(bodyText)) {
      mark('page_ready', { attempt: i + 1 });
      break;
    }
    await sleep(500);
  }
  if (!/검색어\s*보고서|보고서\s*설정하기|다운로드/i.test(bodyText)) {
    mark('page_not_ready', { waitedMs: 4000 });
    return { ok: false, clicked: false, stage_log: stageLog, human_action_required: true, human_action_reason: 'ads_report_page_not_ready', page_url: location.href, title, body_sample: bodyText.slice(0, 900), error: 'ads_report_page_not_ready' };
  }
  const dot = (ymd) => {
    const base = String(ymd || '').replace(/-/g, '.').replace(/\.+$/, '');
    return base ? (base + '.') : '';
  };
  const digits = (value) => String(value || '').replace(/\D+/g, '');
  const ymdDigits = (ymd) => String(ymd || '').replace(/\D+/g, '').slice(0, 8);
  const rangeWanted = dot(dateFrom) + '→' + dot(dateTo);
  const visibleDateDigits = () => {
    const out = [];
    const seen = new Set();
    for (const el of Array.from(document.querySelectorAll('input,button,a,[role="button"],div,span')).filter(visible)) {
      const rect = el.getBoundingClientRect();
      if (rect.top < 80 || rect.top > 360 || rect.left < window.innerWidth * 0.45) continue;
      const raw = String(textOf(el) || '');
      const matches = raw.match(/\d{4}[.-]\d{2}[.-]\d{2}\.?/g) || [];
      for (const one of matches) {
        const d = digits(one).slice(0, 8);
        if (d && !seen.has(d)) {
          seen.add(d);
          out.push(d);
        }
      }
    }
    return out;
  };
  const rangeApplied = (value) => {
    const from = ymdDigits(dateFrom);
    const to = ymdDigits(dateTo);
    if (!from || !to) return false;
    const rangeDigits = visibleDateDigits();
    const valueDigits = String(value || '').match(/\d{4}[.-]\d{2}[.-]\d{2}\.?/g)?.map((one) => digits(one).slice(0, 8)) || [];
    const all = new Set([...rangeDigits, ...valueDigits]);
    return all.has(from) && all.has(to);
  };
  let dateApplied = false;
  const isCalendarOpen = () => {
    if (Array.from(document.querySelectorAll('.calendar_lypop,.DayPicker,[class*="calendar"],[class*="datepicker"]')).some(visible)) return true;
    const inputs = Array.from(document.querySelectorAll('input')).filter((el) => visible(el) && !/hidden|checkbox|radio/i.test(String(el.type || '')));
    const dateInputs = inputs
      .filter((el) => /\d{4}[.-]\d{2}[.-]\d{2}|날짜|기간|시작|종료|start|end|from|to/i.test(String(el.value || el.placeholder || el.getAttribute('aria-label') || el.name || el.id || '')))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.top - br.top || ar.left - br.left;
      })
      .slice(0, 2);
    if (dateInputs.length < 2) return false;
    const sameRow = Math.abs(dateInputs[0].getBoundingClientRect().top - dateInputs[1].getBoundingClientRect().top) <= 12;
    const nearbyActions = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],span,div'))
      .filter(visible)
      .some((el) => /확인|취소|적용|조회/.test(compact(textOf(el))));
    return sameRow && nearbyActions;
  };
  const getCalendarLayers = () => Array.from(document.querySelectorAll('.calendar_lypop,.DayPicker,[class*="calendar"],[class*="datepicker"]')).filter(visible);
  const clickDateRangeControl = async () => {
    const clickableParent = (el) => {
      let p = el;
      for (let i = 0; i < 8 && p; i += 1) {
        const tag = String(p.tagName || '').toLowerCase();
        const role = String(p.getAttribute?.('role') || '').toLowerCase();
        const cls = String(p.className || '');
        const r = p.getBoundingClientRect();
        if ((tag === 'button' || tag === 'a' || role === 'button' || /button|btn|datepicker|calendar|select|dropdown/i.test(cls)) && r.width > 10 && r.height > 10) return p;
        p = p.parentElement;
      }
      return el;
    };
    const candidates = Array.from(document.querySelectorAll('input,button,[role="button"],a')).filter(visible);
    const datePattern = /\d{4}[.-]\d{2}[.-]\d{2}/;
    let hit = candidates.find((el) => datePattern.test(String(el.value || textOf(el) || el.getAttribute('aria-label') || el.getAttribute('title') || '')));
    if (!hit) {
      const all = Array.from(document.querySelectorAll('div,span,label')).filter(visible);
      hit = all.find((el) => {
        const txt = norm(textOf(el));
        if (!datePattern.test(txt)) return false;
        const r = el.getBoundingClientRect();
        return r.top >= 120 && r.top <= 420 && r.left >= window.innerWidth * 0.45;
      });
    }
    if (!hit) { mark('date_range_control_not_found'); return false; }
    await clickElement(clickableParent(hit));
    await sleep(900);
    mark('date_range_control_clicked');
    return true;
  };
  const describeCalendarElement = (el) => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      tag: String(el.tagName || '').toLowerCase(),
      text: norm(textOf(el)).slice(0, 120),
      cls: String(el.className || '').slice(0, 120),
      aria: String(el.getAttribute?.('aria-label') || '').slice(0, 120),
      title: String(el.getAttribute?.('title') || '').slice(0, 120),
      dataDate: String(el.getAttribute?.('data-date') || el.getAttribute?.('datetime') || '').slice(0, 80),
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  };
  const calendarDiagnostics = (ymd = '') => {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const monthNeedlesForYmd = m ? [m[1] + '년 ' + String(Number(m[2])) + '월', m[1] + '년 ' + m[2] + '월', m[1] + '.' + m[2]] : [];
    const monthCandidates = Array.from(document.querySelectorAll('.calendar_lypop .DayPicker-Month,.calendar_lypop [class*="Month"],.calendar_lypop table,.calendar_lypop [role="grid"],[class*="calendar"] [class*="month"],[class*="Calendar"] [class*="Month"]'))
      .filter(visible)
      .slice(0, 12)
      .map((el) => ({ ...describeCalendarElement(el), matchesTargetMonth: monthNeedlesForYmd.some((n) => compact(textOf(el)).includes(compact(n))) }));
    const dateCellCandidates = Array.from(document.querySelectorAll('button,[role="button"],td,div,span,a'))
      .filter(visible)
      .filter((el) => {
        const raw = [textOf(el), el.getAttribute?.('aria-label'), el.getAttribute?.('title'), el.getAttribute?.('data-date'), el.getAttribute?.('datetime')].join(' ');
        return /\d{1,2}|[0-9]{4}[.-][0-9]{2}[.-][0-9]{2}/.test(raw);
      })
      .slice(0, 40)
      .map(describeCalendarElement);
    const scrollContainers = Array.from(document.querySelectorAll('.calendar_lypop,[class*="calendar"],[class*="Calendar"],[class*="datepicker"],[class*="DatePicker"],div'))
      .filter(visible)
      .filter((el) => {
        try {
          const style = window.getComputedStyle(el);
          return /(auto|scroll)/i.test(style.overflowY || '') || el.scrollHeight > el.clientHeight + 20;
        } catch (e) { return false; }
      })
      .slice(0, 8)
      .map((el) => {
        const base = describeCalendarElement(el);
        return { ...base, scrollTop: Math.round(el.scrollTop || 0), scrollHeight: Math.round(el.scrollHeight || 0), clientHeight: Math.round(el.clientHeight || 0) };
      });
    return { ymd, monthCandidates, dateCellCandidates, scrollContainers, visibleDateDigits: visibleDateDigits?.() || [] };
  };
  const clickCalendarDate = async (ymd) => {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const year = m[1];
    const month = String(Number(m[2]));
    const month2 = m[2];
    const day = String(Number(m[3]));
    const attrsNeedles = [ymd, year + '.' + month2 + '.' + m[3], year + '년 ' + month + '월 ' + day + '일', year + '년 ' + month2 + '월 ' + day + '일'];
    const monthNeedles = [year + '년 ' + month + '월', year + '년 ' + month2 + '월', year + '.' + month2];
    const findMonthBlock = () => {
      const monthBlocks = Array.from(document.querySelectorAll('.calendar_lypop .DayPicker-Month,.calendar_lypop [class*="Month"],.calendar_lypop table,.calendar_lypop [role="grid"],[class*="calendar"] [class*="month"],[class*="Calendar"] [class*="Month"]')).filter(visible);
      return monthBlocks.find((el) => {
        const txt = compact((el.textContent || '').slice(0, 2000));
        return monthNeedles.some((n) => txt.includes(compact(n)));
      });
    };
    const scrollIntoMonth = async () => {
      let block = findMonthBlock();
      const scrollParents = Array.from(document.querySelectorAll('.calendar_lypop,[class*="calendar"],[class*="Calendar"],[class*="datepicker"],[class*="DatePicker"],div'))
        .filter(visible)
        .filter((el) => {
          try {
            const style = window.getComputedStyle(el);
            return /(auto|scroll)/i.test(style.overflowY || '') || el.scrollHeight > el.clientHeight + 20;
          } catch (e) { return false; }
        });
      for (let step = 0; !block && step < 14; step += 1) {
        for (const scroller of scrollParents) {
          scroller.scrollTop = Math.min(scroller.scrollHeight, (scroller.scrollTop || 0) + Math.max(120, scroller.clientHeight * 0.7));
        }
        await sleep(250);
        block = findMonthBlock();
      }
      if (!block) { mark('month_block_not_found', { ymd, diagnostics: calendarDiagnostics(ymd) }); return false; }
      try { block.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
      let p = block.parentElement;
      for (let i = 0; i < 6 && p; i += 1) {
        try {
          const style = window.getComputedStyle(p);
          if (/(auto|scroll)/i.test(style.overflowY || '') || p.scrollHeight > p.clientHeight + 20) {
            const rect = block.getBoundingClientRect();
            const parentRect = p.getBoundingClientRect();
            p.scrollTop += rect.top - parentRect.top - parentRect.height / 3;
            break;
          }
        } catch (e) {}
        p = p.parentElement;
      }
      await sleep(500);
      mark('month_detected', { ymd, month: describeCalendarElement(block), diagnostics: calendarDiagnostics(ymd) });
      return true;
    };
    const monthReady = await scrollIntoMonth();
    if (!monthReady) {
      mark('date_click_blocked_month_unverified', { ymd });
      return false;
    }
    const all = Array.from(document.querySelectorAll('button,[role="button"],td,div,span,a'));
    const scored = [];
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (!(rect.width >= 8 && rect.height >= 8)) continue;
      const txt = compact(textOf(el));
      if (txt !== day) continue;
      const attrText = compact([
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('data-date'),
        el.getAttribute('datetime'),
        el.className,
      ].join(' '));
      let ancestorText = '';
      let p = el;
      for (let i = 0; i < 8 && p; i += 1) {
        ancestorText += ' ' + compact(textOf(p).slice(0, 1500));
        p = p.parentElement;
      }
      let score = 0;
      if (attrsNeedles.some((n) => attrText.includes(compact(n)))) score += 100;
      if (monthNeedles.some((n) => ancestorText.includes(compact(n)))) score += 50;
      if (rect.top >= 0 && rect.bottom <= window.innerHeight) score += 10;
      if (rect.width >= 10 && rect.height >= 10) score += 5;
      if (rect.left > window.innerWidth * 0.45) score += 5;
      if (/disabled|outside|prev|next/i.test(String(el.className || '') + ' ' + String(el.getAttribute('aria-disabled') || ''))) score -= 100;
      if (score > 0) scored.push({ el, score, top: rect.top, left: rect.left });
    }
    scored.sort((a, b) => b.score - a.score || a.top - b.top || a.left - b.left);
    if (!scored.length) { mark('date_cell_not_found', { ymd, diagnostics: calendarDiagnostics(ymd) }); return false; }
    await clickElement(scored[0].el);
    await sleep(700);
    mark('date_cell_verified', { ymd, picked: describeCalendarElement(scored[0].el), score: scored[0].score });
    mark('date_clicked', { ymd });
    return true;
  };
  const ensureCalendarOpen = async () => {
    if (isCalendarOpen()) return true;
    const opened = await clickDateRangeControl();
    await sleep(700);
    const ok = opened || isCalendarOpen();
    mark(ok ? 'calendar_open' : 'calendar_not_open');
    return ok;
  };
  const readCurrentRange = () => {
    const explicit = norm((document.querySelector('.date_select .btn.select_data,[data-test-id="DateRangeFixedArea_click_toggle"],[class*="DateRange"],[class*="date_range"],[class*="dateRange"]')?.innerText || document.querySelector('.date_select .btn.select_data,[data-test-id="DateRangeFixedArea_click_toggle"],[class*="DateRange"],[class*="date_range"],[class*="dateRange"]')?.textContent || ''));
    if (explicit) return explicit;
    const needles = [dot(dateFrom), dot(dateTo), String(dateFrom || '').replace(/-/g, '.'), String(dateTo || '').replace(/-/g, '.')].filter(Boolean);
    const hit = Array.from(document.querySelectorAll('button,a,[role="button"],input,div,span')).filter(visible).find((el) => {
      const txt = norm(textOf(el));
      return needles.every((n) => compact(txt).includes(compact(n)));
    });
    return norm(textOf(hit));
  };
  const waitForCalendarClose = async () => {
    for (let i = 0; i < 20; i += 1) {
      if (!isCalendarOpen()) {
        mark('calendar_closed_after_confirm', { attempt: i + 1 });
        return true;
      }
      await sleep(200);
    }
    mark('calendar_still_open_after_confirm');
    return false;
  };
  const waitForRangeApplied = async () => {
    let lastRange = '';
    for (let i = 0; i < 24; i += 1) {
      lastRange = readCurrentRange();
      if (rangeApplied(lastRange)) {
        mark('range_visible_after_confirm', { currentRange: lastRange, attempt: i + 1 });
        return { ok: true, currentRange: lastRange };
      }
      await sleep(250);
    }
    mark('range_not_visible_after_confirm', { currentRange: lastRange });
    return { ok: false, currentRange: lastRange };
  };
  let appliedTemplate = null;
  const parseYmdLocal = (ymd) => {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  const formatYmd = (dt) => {
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
    const y = String(dt.getFullYear());
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  };
  const addDays = (dt, days) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + days);
  const chooseRangeTemplate = () => {
    const from = parseYmdLocal(dateFrom);
    const to = parseYmdLocal(dateTo);
    if (!from || !to || from > to) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = addDays(today, -1);
    const spanDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    if (spanDays > 0 && spanDays <= 7 && to <= yesterday) {
      const baseSince = addDays(today, -7);
      const baseUntil = yesterday;
      const shiftDays = Math.round((to.getTime() - baseUntil.getTime()) / 86400000);
      if (shiftDays % 7 === 0) {
        return {
          label: '최근 7일(오늘 제외)',
          since: formatYmd(from),
          until: formatYmd(to),
          baseSince: formatYmd(baseSince),
          baseUntil: formatYmd(baseUntil),
          moveDirection: shiftDays < 0 ? 'prev' : shiftDays > 0 ? 'next' : '',
          moveSteps: Math.abs(shiftDays / 7),
        };
      }
    }
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
    const quarterStart = new Date(today.getFullYear(), quarterStartMonth, 1);
    const lastQuarterStart = new Date(today.getFullYear(), quarterStartMonth - 3, 1);
    const lastQuarterEnd = new Date(today.getFullYear(), quarterStartMonth, 0);
    const fixedCandidates = [
      { label: '어제', since: yesterday, until: yesterday },
      { label: '이번달', since: monthStart, until: yesterday },
      { label: '지난달', since: lastMonthStart, until: lastMonthEnd },
      { label: '이번 분기', since: quarterStart, until: yesterday },
      { label: '지난 분기', since: lastQuarterStart, until: lastQuarterEnd },
    ];
    for (const one of fixedCandidates) {
      if (one.since <= from && one.until >= to) {
        return { label: one.label, since: formatYmd(one.since), until: formatYmd(one.until) };
      }
    }
    const rollingCandidates = [
      { label: '최근 7일(오늘 제외)', days: 7 },
      { label: '최근 30일(오늘 제외)', days: 30 },
      { label: '최근 90일(오늘 제외)', days: 90 },
      { label: '최근 365일(오늘 제외)', days: 365 },
    ];
    for (const one of rollingCandidates) {
      const since = addDays(today, -one.days);
      const until = yesterday;
      if (since <= from && until >= to) {
        return { label: one.label, since: formatYmd(since), until: formatYmd(until) };
      }
    }
    return null;
  };
  const clickPeriodMove = async (direction, steps) => {
    const total = Number(steps || 0);
    if (!direction || total <= 0) return true;
    const isPrev = direction === 'prev';
    for (let i = 0; i < total; i += 1) {
      const all = Array.from(document.querySelectorAll('button,a,[role="button"],input,div,span')).filter(visible);
      const candidates = all
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const txt = compact(textOf(el));
          const attr = compact(String(el.getAttribute?.('aria-label') || '') + ' ' + String(el.getAttribute?.('title') || ''));
          let score = 0;
          if (isPrev && /^[<‹〈]$/.test(txt)) score += 300;
          if (!isPrev && /^[>›〉]$/.test(txt)) score += 300;
          if (isPrev && /이전|prev|previous/i.test(attr)) score += 250;
          if (!isPrev && /다음|next/i.test(attr)) score += 250;
          if (rect.top >= 160 && rect.top <= 330) score += 80;
          if (rect.left >= window.innerWidth * 0.65) score += 60;
          if (rect.width >= 24 && rect.width <= 80 && rect.height >= 24 && rect.height <= 80) score += 40;
          if (/접기|다운로드|보고서/.test(txt + attr)) score -= 250;
          return { el, rect, txt, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.rect.left - b.rect.left);
      if (!candidates.length) {
        mark('date_period_move_button_not_found', { direction, step: i + 1, steps: total });
        return false;
      }
      await clickElement(candidates[0].el);
      await sleep(900);
      mark('date_period_moved', { direction, step: i + 1, steps: total, currentRange: readCurrentRange() });
    }
    return true;
  };
  const templateRangeApplied = (value, template) => {
    if (!template) return false;
    const sinceDigits = ymdDigits(template.since);
    const untilDigits = ymdDigits(template.until);
    const rangeDigits = visibleDateDigits();
    const valueDigits = String(value || '').match(/\d{4}[.-]\d{2}[.-]\d{2}\.?/g)?.map((one) => digits(one).slice(0, 8)) || [];
    const all = new Set([...rangeDigits, ...valueDigits]);
    return !!sinceDigits && !!untilDigits && all.has(sinceDigits) && all.has(untilDigits);
  };
  const applyDateTemplate = async () => {
    const template = chooseRangeTemplate();
    if (!template) {
      mark('date_template_not_available', { dateFrom, dateTo });
      return false;
    }
    if (!isCalendarOpen()) {
      await ensureCalendarOpen();
      await sleep(500);
    }
    const labelCompact = compact(template.label);
    const controls0 = Array.from(document.querySelectorAll('button,a,[role="button"],input,div,span,label')).filter(visible);
    const candidates = controls0
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const txt = compact(textOf(el));
        const attr = compact(String(el.getAttribute?.('aria-label') || '') + ' ' + String(el.getAttribute?.('title') || ''));
        let score = 0;
        if (txt === labelCompact || attr === labelCompact) score += 300;
        if (txt.includes(labelCompact) || attr.includes(labelCompact)) score += 120;
        if (rect.height >= 16 && rect.height <= 70 && rect.width >= 40 && rect.width <= 280) score += 40;
        if (rect.left < window.innerWidth * 0.65) score += 20;
        if (/최근|어제|오늘제외/.test(txt)) score += 20;
        if (rect.height > 120 || rect.width > 420) score -= 200;
        return { el, rect, txt, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    if (!candidates.length) {
      mark('date_template_button_not_found', { template });
      return false;
    }
    await clickElement(candidates[0].el);
    await sleep(900);
    mark('date_template_clicked', { template, text: norm(textOf(candidates[0].el)) });
    if (template.moveSteps) {
      const moved = await clickPeriodMove(template.moveDirection, template.moveSteps);
      if (!moved) return false;
    }
    let currentRange = readCurrentRange();
    if (templateRangeApplied(currentRange, template)) {
      mark('date_template_range_verified_without_confirm', { template, currentRange });
      appliedTemplate = template;
      return true;
    }
    const dateInputs = Array.from(document.querySelectorAll('input')).filter((el) => visible(el) && !/hidden|checkbox|radio/i.test(String(el.type || '')))
      .filter((el) => /\d{4}[.-]\d{2}[.-]\d{2}|날짜|기간|시작|종료|start|end|from|to/i.test(String(el.value || el.placeholder || el.getAttribute('aria-label') || el.name || el.id || '')))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.top - br.top || ar.left - br.left;
      })
      .slice(0, 2);
    const applied = await clickCalendarConfirm(dateInputs);
    await waitForCalendarClose();
    await sleep(1200);
    currentRange = readCurrentRange();
    const ok = templateRangeApplied(currentRange, template);
    mark(ok ? 'date_template_range_verified' : 'date_template_range_verify_failed', { template, currentRange, applied });
    if (ok) {
      appliedTemplate = template;
      return true;
    }
    return false;
  };
  const findDatePopupRoot = (dateInputs = []) => {
    const seed = dateInputs.find(Boolean) || null;
    let p = seed;
    while (p) {
      try {
        const rect = p.getBoundingClientRect();
        if (rect.width >= 220 && rect.height >= 180) {
          const containsBothInputs = dateInputs.every((input) => input && p.contains(input));
          const hasConfirm = Array.from(p.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],span,div')).some((el) => visible(el) && /확인/.test(compact(textOf(el))));
          if (containsBothInputs && hasConfirm) return p;
        }
      } catch (e) {}
      p = p.parentElement;
    }
    return getCalendarLayers().sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0] || null;
  };
  const describeElement = (el) => {
    if (!el) return null;
    try {
      const rect = el.getBoundingClientRect();
      return {
        tag: String(el.tagName || '').toLowerCase(),
        text: norm(textOf(el)).slice(0, 80),
        className: String(el.className || '').slice(0, 120),
        id: String(el.id || '').slice(0, 80),
        role: String(el.getAttribute?.('role') || '').slice(0, 40),
        value: String(el.value || '').slice(0, 80),
        rect: {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    } catch (e) {
      return { tag: String(el.tagName || '').toLowerCase(), text: norm(textOf(el)).slice(0, 80), error: String(e && e.message || e) };
    }
  };
  const getCalendarDebugState = (dateInputs = []) => {
    const layers = getCalendarLayers();
    const popupRoot = findDatePopupRoot(dateInputs);
    const scope = popupRoot || document;
    const confirmCandidates = Array.from(scope.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],span,div'))
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const txt = compact(textOf(el));
        return {
          text: norm(textOf(el)).slice(0, 40),
          compactText: txt.slice(0, 40),
          tag: String(el.tagName || '').toLowerCase(),
          className: String(el.className || '').slice(0, 80),
          rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
        };
      })
      .filter((item) => item.rect.width >= 30 && item.rect.height >= 18)
      .slice(0, 12);
    const rangeMatches = Array.from(document.querySelectorAll('button,a,[role="button"],input,div,span'))
      .filter(visible)
      .map((el) => norm(textOf(el)))
      .filter(Boolean)
      .filter((txt) => /\d{4}[.]\d{2}[.]\d{2}/.test(txt))
      .slice(0, 6);
    return {
      isCalendarOpen: isCalendarOpen(),
      layerCount: layers.length,
      layers: layers.slice(0, 4).map((el) => describeElement(el)),
      popupRoot: describeElement(popupRoot),
      activeElement: describeElement(document.activeElement),
      currentRange: readCurrentRange(),
      inputs: dateInputs.map((el) => describeElement(el)),
      confirmCandidates,
      rangeMatches,
    };
  };
  const clickCalendarConfirm = async (dateInputs = []) => {
    const popupRoot = findDatePopupRoot(dateInputs);
    const scope = popupRoot || document;
    const popupRect = popupRoot?.getBoundingClientRect?.() || { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
    const buttons = Array.from(scope.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],span,div')).filter(visible);
    const candidates = buttons
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const txt = compact(textOf(el));
        const tag = String(el.tagName || '').toLowerCase();
        let score = 0;
        if (/확인|적용|조회|ok|apply/i.test(txt)) score += 300;
        if (/취소|닫기|close|cancel/i.test(txt)) score -= 300;
        if (/^[<>]$/.test(txt)) score -= 200;
        if (rect.width >= 30 && rect.height >= 18) score += 10;
        if (tag === 'button' || tag === 'a' || tag === 'input') score += 20;
        if (rect.top >= popupRect.top + (popupRect.height * 0.72)) score += 80;
        if (rect.left >= popupRect.left + (popupRect.width * 0.5)) score += 40;
        return { el, rect, txt, score, tag };
      })
      .filter((item) => item.rect.width >= 30 && item.rect.height >= 18)
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.rect.top - a.rect.top || b.rect.left - a.rect.left);
    if (!candidates.length) {
      mark('calendar_confirm_not_found', { popupFound: !!popupRoot, debug: getCalendarDebugState(dateInputs) });
      return false;
    }
    await clickElement(candidates[0].el);
    await sleep(1200);
    mark('calendar_confirm_clicked', { text: norm(textOf(candidates[0].el)), popupFound: !!popupRoot, score: candidates[0].score, tag: candidates[0].tag, debug: getCalendarDebugState(dateInputs) });
    return true;
  };
  const applyDateInputs = async () => {
    const inputs = Array.from(document.querySelectorAll('input')).filter((el) => visible(el) && !/hidden|checkbox|radio/i.test(String(el.type || '')));
    const dateInputs = inputs
      .filter((el) => /\d{4}[.-]\d{2}[.-]\d{2}|날짜|기간|시작|종료|start|end|from|to/i.test(String(el.value || el.placeholder || el.getAttribute('aria-label') || el.name || el.id || '')))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.top - br.top || ar.left - br.left;
      })
      .slice(0, 2);
    if (dateInputs.length >= 2) {
      mark('date_header_inputs_found', { values: dateInputs.map((el) => String(el.value || '')) });
      const waitForInputDigits = async (el, expectedDigits, label) => {
        let lastValue = String(el.value || '');
        for (let i = 0; i < 20; i += 1) {
          lastValue = String(el.value || '');
          if (digits(lastValue).slice(0, 8) === expectedDigits) {
            mark('date_header_input_stable', { target: label, actual: lastValue, attempt: i + 1 });
            return true;
          }
          await sleep(150);
        }
        mark('date_header_input_not_stable', { target: label, actual: lastValue, actualDigits: digits(lastValue), expectedDigits });
        return false;
      };
      const waitForBothInputsVerified = async (fromEl, toEl, requestedFrom, requestedTo) => {
        const expectedFrom = ymdDigits(dateFrom);
        const expectedTo = ymdDigits(dateTo);
        let actualFrom = String(fromEl?.value || '');
        let actualTo = String(toEl?.value || '');
        for (let i = 0; i < 20; i += 1) {
          actualFrom = String(fromEl?.value || '');
          actualTo = String(toEl?.value || '');
          if (digits(actualFrom) === expectedFrom && digits(actualTo) === expectedTo) {
            mark('date_header_inputs_verified_before_confirm', { actualFrom, actualTo, requestedFrom, requestedTo, attempt: i + 1 });
            return true;
          }
          await sleep(150);
        }
        mark('date_header_inputs_verify_failed_before_confirm', { actualFrom, actualTo, requestedFrom, requestedTo });
        return false;
      };
      const commitDateInput = async (el, label) => {
        if (!el) return;
        try { el.focus?.(); } catch (e) {}
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        await sleep(180);
        mark('date_header_input_committed', { target: label, actual: String(el.value || '') });
      };
      const commitDateInputs = async (fromEl, toEl, requestedFrom, requestedTo) => {
        await commitDateInput(fromEl, 'from');
        await commitDateInput(toEl, 'to');
        mark('date_header_inputs_commit_requested', { requestedFrom, requestedTo, actualFrom: String(fromEl?.value || ''), actualTo: String(toEl?.value || '') });
      };
      const focusEndInputForConfirm = async (el) => {
        if (!el) return false;
        try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
        try { el.focus?.(); } catch (e) {}
        try {
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (e) {}
        try {
          const len = String(el.value || '').length;
          el.setSelectionRange?.(len, len);
        } catch (e) {}
        await sleep(180);
        const active = document.activeElement === el;
        mark(active ? 'date_header_to_focused_before_confirm' : 'date_header_to_focus_failed_before_confirm', {
          actual: String(el.value || ''),
          activeTag: String(document.activeElement?.tagName || '').toLowerCase(),
          activeText: norm(textOf(document.activeElement)).slice(0, 60),
        });
        return active;
      };
      const typeTextLikeUser = async (el, value, label) => {
        if (!el) return false;
        try { el.focus?.(); } catch (e) {}
        try { el.select?.(); } catch (e) {}
        try { el.setSelectionRange?.(0, String(el.value || '').length); } catch (e) {}
        try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true })); } catch (e) {}
        try { el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true })); } catch (e) {}
        try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true, cancelable: true })); } catch (e) {}
        setNativeValue(el, '', { emitInput: true, emitChange: false, emitBlur: false });
        try { el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', bubbles: true, cancelable: true })); } catch (e) {}
        await sleep(120);
        for (const ch of String(value || '')) {
          const key = ch;
          const code = /\d/.test(ch) ? ('Digit' + ch) : (ch === '.' ? 'Period' : '');
          try { el.focus?.(); } catch (e) {}
          try { el.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })); } catch (e) {}
          let canceled = false;
          try {
            canceled = !el.dispatchEvent(new InputEvent('beforeinput', { data: ch, inputType: 'insertText', bubbles: true, cancelable: true }));
          } catch (e) {}
          if (!canceled) {
            try {
              const start = Number.isFinite(el.selectionStart) ? el.selectionStart : String(el.value || '').length;
              const end = Number.isFinite(el.selectionEnd) ? el.selectionEnd : start;
              const current = String(el.value || '');
              const next = current.slice(0, start) + ch + current.slice(end);
              setNativeValue(el, next, { emitInput: false, emitChange: false, emitBlur: false });
              try { el.setSelectionRange?.(start + ch.length, start + ch.length); } catch (e) {}
            } catch (e) {
              setNativeValue(el, String(el.value || '') + ch, { emitInput: false, emitChange: false, emitBlur: false });
            }
            try { el.dispatchEvent(new InputEvent('input', { data: ch, inputType: 'insertText', bubbles: true })); } catch (e) {
              try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
            }
          }
          try { el.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true })); } catch (e) {}
          await sleep(85);
        }
        mark('date_header_typed_like_user', { target: label, requested: value, actual: String(el.value || '') });
        return true;
      };
      const typeDate = async (el, value, label) => {
        const expectedDigits = digits(value).slice(0, 8);
        try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
        try { el.focus?.(); } catch (e) {}
        try { el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
        try { el.select?.(); } catch (e) {}
        try { el.setSelectionRange?.(0, String(el.value || '').length); } catch (e) {}
        try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true })); } catch (e) {}
        try { el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true })); } catch (e) {}
        try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true, cancelable: true })); } catch (e) {}
        try { el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', bubbles: true, cancelable: true })); } catch (e) {}
        try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true })); } catch (e) {}
        try { el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true })); } catch (e) {}
        await typeTextLikeUser(el, value, label);
        await waitForInputDigits(el, expectedDigits, label);
        await sleep(500);
        mark(digits(el.value) === expectedDigits ? 'date_header_input_typed' : 'date_header_input_mismatch', { target: label, requested: value, actual: String(el.value || ''), actualDigits: digits(el.value), expectedDigits });
      };
      const requestedFrom = dot(dateFrom);
      const requestedTo = dot(dateTo);
      let actualFrom = String(dateInputs[0].value || '');
      let actualTo = String(dateInputs[1].value || '');
      let inputsOk = digits(actualFrom) === ymdDigits(dateFrom) && digits(actualTo) === ymdDigits(dateTo);
      if (inputsOk) {
        mark('date_header_inputs_prefilled_by_cdp', { actualFrom, actualTo, requestedFrom, requestedTo });
      } else {
        await typeDate(dateInputs[0], requestedFrom, 'from');
        await commitDateInput(dateInputs[0], 'from_before_to');
      }
      const fromAfterCommit = String(dateInputs[0].value || '');
      if (digits(fromAfterCommit) !== ymdDigits(dateFrom)) {
        mark('date_header_from_commit_failed_before_to', { actualFrom: fromAfterCommit, requestedFrom });
        return false;
      }
      if (!inputsOk) {
        await typeDate(dateInputs[1], requestedTo, 'to');
      }
      actualFrom = String(dateInputs[0].value || '');
      actualTo = String(dateInputs[1].value || '');
      inputsOk = digits(actualFrom) === ymdDigits(dateFrom) && digits(actualTo) === ymdDigits(dateTo);
      if (!inputsOk && digits(actualFrom) !== ymdDigits(dateFrom) && digits(actualTo) === ymdDigits(dateTo)) {
        mark('date_header_from_rewrite_after_to', { actualFrom, actualTo, requestedFrom, requestedTo });
        return false;
      }
      mark(inputsOk ? 'date_header_inputs_typed' : 'date_header_input_verify_failed', { actualFrom, actualTo, requestedFrom, requestedTo });
      if (!inputsOk) return false;
      const inputsVerified = await waitForBothInputsVerified(dateInputs[0], dateInputs[1], requestedFrom, requestedTo);
      if (!inputsVerified) return false;
      await commitDateInputs(dateInputs[0], dateInputs[1], requestedFrom, requestedTo);
      const inputsVerifiedAfterCommit = await waitForBothInputsVerified(dateInputs[0], dateInputs[1], requestedFrom, requestedTo);
      mark(inputsVerifiedAfterCommit ? 'date_header_inputs_verified_after_commit' : 'date_header_inputs_verify_failed_after_commit', { actualFrom: String(dateInputs[0].value || ''), actualTo: String(dateInputs[1].value || ''), requestedFrom, requestedTo });
      if (!inputsVerifiedAfterCommit) return false;
      await focusEndInputForConfirm(dateInputs[1]);
      const popupRootBeforeConfirm = findDatePopupRoot(dateInputs);
      const calendarStillUsable = isCalendarOpen() || !!popupRootBeforeConfirm;
      mark('calendar_state_before_confirm', { debug: getCalendarDebugState(dateInputs), calendarStillUsable });
      if (!calendarStillUsable) {
        mark('calendar_closed_before_confirm', { debug: getCalendarDebugState(dateInputs), calendarStillUsable });
        return false;
      }
      const applied = await clickCalendarConfirm(dateInputs);
      await waitForCalendarClose();
      await sleep(1200);
      mark(applied ? 'date_header_inputs_applied' : 'date_header_input_apply_button_missing');
      if (!applied) return false;
      const afterConfirm = await waitForRangeApplied();
      return !!afterConfirm.ok;
    }
    mark('date_header_inputs_not_found');
    return false;
  };
  const bodyTextBeforeSettings = document.body?.innerText || '';
  const settingsAlreadyOpen = /보고서\s*항목\s*목록|보고서\s*설정하기/.test(bodyTextBeforeSettings) && /캠페인|검색어|일별/.test(bodyTextBeforeSettings);
  const reportSettingsOpened = settingsAlreadyOpen || (await clickByText([/보고서설정하기/, /보고서설정/, /설정하기/], 5000))
    || (await clickAnyText([/보고서설정하기/, /보고서설정/, /설정하기/], 5000));
  mark(reportSettingsOpened ? 'report_settings_opened' : 'report_settings_not_found', { settingsAlreadyOpen });
  await sleep(1200);
  if (!reportSettingsOpened) {
    return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, human_action_required: true, human_action_reason: 'ads_report_settings_not_opened', page_url: location.href, title, body_sample: (document.body?.innerText || '').slice(0, 900), error: 'ads_report_settings_not_opened' };
  }
  const ensureReportColumnChecked = async (labelText) => {
    const labelCompact = compact(labelText);
    const checkedState = (node) => {
      if (!node) return false;
      const ariaChecked = String(node.getAttribute?.('aria-checked') || '').toLowerCase();
      const ariaSelected = String(node.getAttribute?.('aria-selected') || '').toLowerCase();
      const ariaPressed = String(node.getAttribute?.('aria-pressed') || '').toLowerCase();
      if (ariaChecked === 'true' || ariaSelected === 'true' || ariaPressed === 'true') return true;
      if (node.tagName === 'INPUT' && /checkbox|radio/i.test(String(node.type || ''))) return !!node.checked;
      const cls = String(node.className || '');
      return /(^|[-_\s])(checked|selected|active|on)([-_\s]|$)/i.test(cls);
    };
    const findControl = () => {
      const all = Array.from(document.querySelectorAll('label,li,tr,div,span,button,[role="checkbox"],input[type="checkbox"]')).filter(visible);
      const rows = all
        .map((el) => {
          const txt = compact(textOf(el));
          const rect = el.getBoundingClientRect();
          let score = 0;
          if (txt === labelCompact) score += 400;
          if (txt.includes(labelCompact)) score += 180;
          if (/보고서항목목록|보고서설정하기|캠페인|광고그룹|검색어|일별/.test(txt)) score += 20;
          if (rect.width > 20 && rect.width < 900 && rect.height > 10 && rect.height < 120) score += 20;
          if (rect.top >= 80 && rect.top <= window.innerHeight - 20) score += 20;
          return { el, txt, rect, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || a.rect.left - b.rect.left);
      for (const row of rows) {
        let scope = row.el;
        for (let i = 0; i < 5 && scope; i += 1) {
          const scopeText = compact(textOf(scope));
          if (scopeText.includes(labelCompact)) {
            const control = scope.matches?.('input[type="checkbox"],[role="checkbox"],button[aria-checked],[aria-pressed]')
              ? scope
              : scope.querySelector?.('input[type="checkbox"],[role="checkbox"],button[aria-checked],[aria-pressed]');
            if (control) return { row: scope, control };
          }
          scope = scope.parentElement;
        }
        return { row: row.el, control: row.el };
      }
      return null;
    };
    const hit = findControl();
    if (!hit) {
      mark('report_column_not_found', { label: labelText });
      return false;
    }
    const selected = checkedState(hit.control) || checkedState(hit.row);
    if (hit.control === hit.row && !selected && compact(textOf(hit.row)) === labelCompact) {
      mark('report_column_selected_chip_visible', { label: labelText, text: norm(textOf(hit.row)).slice(0, 120) });
      return true;
    }
    if (!selected) {
      await clickElement(hit.control || hit.row);
      await sleep(700);
    }
    const selectedAfter = checkedState(hit.control) || checkedState(hit.row);
    mark(selectedAfter ? 'report_column_checked' : 'report_column_check_unverified', { label: labelText, wasSelected: selected, text: norm(textOf(hit.row)).slice(0, 120) });
    return selectedAfter;
  };
  const dailyColumnReady = await ensureReportColumnChecked('일별');
  if (!dailyColumnReady) {
    return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, human_action_required: true, human_action_reason: 'ads_report_daily_column_not_selected', page_url: location.href, title, body_sample: (document.body?.innerText || '').slice(0, 900), error: 'ads_report_daily_column_not_selected' };
  }
  if (keepPageAndStepPrev) {
    const moved = await clickPeriodMove('prev', 1);
    await sleep(700);
    const movedRange = readCurrentRange();
    dateApplied = moved && rangeApplied(movedRange);
    mark(dateApplied ? 'date_period_prev_range_verified' : 'date_period_prev_range_verify_failed', { currentRange: movedRange });
    if (!dateApplied) {
      return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, date_applied: false, current_range: movedRange, expected_range: rangeWanted, human_action_required: true, human_action_reason: 'ads_report_date_not_applied', page_url: location.href, title, body_sample: (document.body?.innerText || '').slice(0, 900), error: 'ads_report_date_not_applied' };
    }
  }
  if (!dateApplied) {
    await ensureCalendarOpen();
    await sleep(800);
  }
  if (!dateApplied) {
    dateApplied = await applyDateTemplate();
  }
  if (!dateApplied) {
    dateApplied = await applyDateInputs();
    if (dateApplied) {
      const inputRange = readCurrentRange();
      if (rangeApplied(inputRange)) {
        mark('date_inputs_range_verified', { currentRange: inputRange });
      } else {
        mark('date_inputs_verify_failed', { currentRange: inputRange });
        dateApplied = false;
      }
    }
  }
  const currentRange = readCurrentRange();
  dateApplied = dateApplied && (rangeApplied(currentRange) || templateRangeApplied(currentRange, appliedTemplate));
  mark(dateApplied ? 'range_verified' : 'range_verify_failed', { currentRange });
  if (!dateApplied && String(dateFrom || '') !== String(dateTo || '')) {
    return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, date_applied: false, current_range: currentRange, expected_range: rangeWanted, human_action_required: true, human_action_reason: 'ads_report_date_not_applied', page_url: location.href, title, body_sample: (document.body?.innerText || '').slice(0, 900), error: 'ads_report_date_not_applied' };
  }
  if (!dateApplied && String(dateFrom || '') === String(dateTo || '')) {
    return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, date_applied: false, current_range: currentRange, expected_range: rangeWanted, human_action_required: true, human_action_reason: 'ads_report_date_not_applied', page_url: location.href, title, body_sample: (document.body?.innerText || '').slice(0, 900), error: 'ads_report_date_not_applied' };
  }
  bodyText = document.body?.innerText || '';
  const clicked = (await clickByText([/^다운로드$/, /다운로드/, /download/i], 8000))
    || (await clickAnyText([/^다운로드$/, /다운로드/, /download/i], 5000));
  await sleep(1200);
  mark(clicked ? 'download_clicked' : 'download_button_not_found');
  const button_sample = controls().slice(0, 30).map((el) => norm(textOf(el)).slice(0, 80)).filter(Boolean);
  return { ok: clicked, clicked, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, current_range: currentRange, date_applied: dateApplied, expected_range: rangeWanted, human_action_required: false, page_url: location.href, title, body_sample: bodyText.slice(0, 900), button_sample, error: clicked ? null : 'ads_searchword_download_button_not_found', via: 'naver_ads_searchword_report_cdp' };
})()
"@
	$evaluated = @(Invoke-CdpEvaluate -port $port -expression $expression -timeoutMs 90000) | Select-Object -Last 1
	Write-Output -NoEnumerate $evaluated
}

function Invoke-AdsSearchwordReportDownload7DayStep([int]$port, [string]$url, [string]$dateFrom, [string]$dateTo, [bool]$StepPrevOnly = $false) {
	$urlJson = $url | ConvertTo-Json -Compress
	$dateFromJson = $dateFrom | ConvertTo-Json -Compress
	$dateToJson = $dateTo | ConvertTo-Json -Compress
	$stepPrevOnlyJson = $StepPrevOnly | ConvertTo-Json -Compress
	$expression = @"
(async () => {
  const targetUrl = $urlJson;
  const dateFrom = $dateFromJson;
  const dateTo = $dateToJson;
  const stepPrevOnly = $stepPrevOnlyJson;
  const stageLog = [];
  const mark = (stage, extra = {}) => {
    const entry = { stage, ...extra, ts: new Date().toISOString(), href: location.href, scrollY: Math.round(window.scrollY || 0) };
    stageLog.push(entry);
    try {
      window.__erp2AdsSearchwordDebug = {
        updatedAt: entry.ts,
        stage,
        stage_log: stageLog.slice(-80),
        date_from: dateFrom,
        date_to: dateTo,
        page_url: location.href,
        title: document.title || '',
        body_sample: String(document.body?.innerText || '').slice(0, 900),
      };
    } catch (e) {}
    return entry;
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const compact = (v) => norm(v).replace(/\s+/g, '');
  const textOf = (el) => String((el && (el.innerText || el.textContent || el.value)) || '');
  const visible = (el) => !!el && !el.disabled && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const digits = (value) => String(value || '').replace(/\D+/g, '').slice(0, 8);
  const wantedFrom = digits(dateFrom);
  const wantedTo = digits(dateTo);
  const pageText = () => norm(document.body?.innerText || '');
  const clickElement = async (el, delayMs = 900) => {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
    try { el.focus?.(); } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {}
    try { el.click(); } catch (e) { return false; }
    await sleep(delayMs);
    return true;
  };
  const clickElementNoScroll = async (el, delayMs = 700) => {
    if (!el) return false;
    try { el.focus?.({ preventScroll: true }); } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {}
    try { el.click(); } catch (e) { return false; }
    await sleep(delayMs);
    return true;
  };
  const controls = () => Array.from(document.querySelectorAll('button,a,[role="button"],input,div,span,label')).filter(visible);
  const describeUiElement = (el) => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      tag: String(el.tagName || '').toLowerCase(),
      text: norm(textOf(el)).slice(0, 160),
      cls: String(el.className || '').slice(0, 120),
      aria: String(el.getAttribute?.('aria-label') || '').slice(0, 120),
      title: String(el.getAttribute?.('title') || '').slice(0, 120),
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  };
  const collectDateStrategyDiagnostics = () => {
    const all = controls();
    const templateCandidates = all
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const hay = compact(textOf(el)) + ' ' + compact(String(el.getAttribute?.('aria-label') || '')) + ' ' + compact(String(el.getAttribute?.('title') || '')) + ' ' + compact(String(el.className || ''));
        let score = 0;
        if (/최근/.test(hay)) score += 160;
        if (/7일|7\s*일|일주일|week/i.test(hay)) score += 140;
        if (/오늘제외|오늘\s*제외|excludingtoday/i.test(hay)) score += 80;
        if (/어제|이번달|지난달|기간|날짜/.test(hay)) score += 30;
        if (rect.width > 20 && rect.height > 10 && rect.width < window.innerWidth * 0.9) score += 10;
        return { ...describeUiElement(el), score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    const rangeCandidates = all
      .map(describeUiElement)
      .filter((item) => /\d{4}[.-]\d{2}[.-]\d{2}/.test(item?.text || ''))
      .slice(0, 12);
    const scrollContainers = Array.from(document.querySelectorAll('[class*="calendar"],[class*="Calendar"],[class*="datepicker"],[class*="DatePicker"],div'))
      .filter(visible)
      .filter((el) => {
        try {
          const style = window.getComputedStyle(el);
          return /(auto|scroll)/i.test(style.overflowY || '') || el.scrollHeight > el.clientHeight + 20;
        } catch (e) { return false; }
      })
      .slice(0, 8)
      .map((el) => ({ ...describeUiElement(el), scrollTop: Math.round(el.scrollTop || 0), scrollHeight: Math.round(el.scrollHeight || 0), clientHeight: Math.round(el.clientHeight || 0) }));
    return { templateCandidates, rangeCandidates, scrollContainers, visibleDateDigits: visibleDateDigits() };
  };
  const visibleDateDigits = () => {
    const out = [];
    const seen = new Set();
    for (const el of controls()) {
      const rect = el.getBoundingClientRect();
      if (rect.top < 80 || rect.top > 360 || rect.left < window.innerWidth * 0.42) continue;
      const raw = String(textOf(el) || '');
      const matches = raw.match(/\d{4}[.-]\d{2}[.-]\d{2}\.?/g) || [];
      for (const one of matches) {
        const d = digits(one);
        if (d && !seen.has(d)) {
          seen.add(d);
          out.push(d);
        }
      }
    }
    return out;
  };
  const readCurrentRange = () => {
    const candidates = controls()
      .map((el) => norm(textOf(el)))
      .filter((txt) => /\d{4}[.-]\d{2}[.-]\d{2}/.test(txt))
      .slice(0, 10);
    return candidates.join(' | ');
  };
  const rangeMatchesRequested = () => {
    const found = new Set(visibleDateDigits());
    return !!wantedFrom && !!wantedTo && found.has(wantedFrom) && found.has(wantedTo);
  };
  const clickText = async (patterns, timeoutMs = 4000, label = 'text') => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const candidates = controls()
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const hay = compact(textOf(el)) + ' ' + compact(String(el.getAttribute?.('aria-label') || '')) + ' ' + compact(String(el.getAttribute?.('title') || '')) + ' ' + compact(String(el.className || ''));
          const text = norm(textOf(el));
          const isOversized = rect.width > 700 || rect.height > 180 || rect.width > window.innerWidth * 0.85 || rect.height > window.innerHeight * 0.35;
          let score = 0;
          if (patterns.some((re) => re.test(hay))) score += 300;
          if (/취소|닫기|close|cancel/i.test(hay)) score -= 300;
          if (rect.width >= 20 && rect.height >= 10) score += 10;
          if (isOversized || text.length > 300) score -= 500;
          return { el, score, hay, info: describeUiElement(el) };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      const hit = candidates[0]?.el;
      if (hit) return clickElement(hit);
      await sleep(400);
    }
    mark(label + '_not_found', { diagnostics: collectDateStrategyDiagnostics() });
    return false;
  };
  const clickDownloadButton = async () => {
    const candidates = controls()
      .map((el) => {
        const info = describeUiElement(el);
        const rect = el.getBoundingClientRect();
        const tag = String(el.tagName || '').toLowerCase();
        const role = String(el.getAttribute?.('role') || '').toLowerCase();
        const text = norm(textOf(el));
        const hay = compact(text) + ' ' + compact(String(el.getAttribute?.('aria-label') || '')) + ' ' + compact(String(el.getAttribute?.('title') || '')) + ' ' + compact(String(el.className || ''));
        const isOversized = rect.width > 260 || rect.height > 80 || rect.width > window.innerWidth * 0.3 || rect.height > window.innerHeight * 0.15;
        let score = 0;
        if (/^다운로드$|^download$/i.test(text)) score += 700;
        else if (/다운로드|download/i.test(hay)) score += 260;
        if (tag === 'button' || tag === 'a' || role === 'button') score += 160;
        if (/ad-cms-btn|btn|button/i.test(String(el.className || ''))) score += 80;
        if (rect.top >= 180 && rect.top <= 340) score += 70;
        if (rect.left >= window.innerWidth * 0.3) score += 30;
        if (text.length > 30 || /저장\s*다운로드|보고서\s*형식/.test(text)) score -= 420;
        if (isOversized) score -= 600;
        return { el, score, info };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    mark('download_button_candidates', { candidates: candidates.slice(0, 8).map((item) => ({ ...item.info, score: item.score })) });
    const hit = candidates[0];
    if (!hit) return false;
    mark('download_button_candidate_clicked', { candidate: hit.info, score: hit.score });
    try { hit.el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
    try { hit.el.focus?.(); } catch (e) {}
    setTimeout(() => {
      try {
        hit.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        hit.el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        hit.el.click();
      } catch (e) {}
    }, 0);
    return true;
  };
  const clickDownloadConfirmIfNeeded = async () => {
    const before = pageText();
    if (!/계속|확인|동의|다운로드.*하시겠|다운로드.*진행|download/i.test(before)) {
      mark('download_confirm_not_detected', { bodySample: before.slice(0, 350) });
      return false;
    }
    const candidates = controls()
      .map((el) => {
        const info = describeUiElement(el);
        const rect = el.getBoundingClientRect();
        const tag = String(el.tagName || '').toLowerCase();
        const role = String(el.getAttribute?.('role') || '').toLowerCase();
        const text = norm(textOf(el));
        const hay = compact(text) + ' ' + compact(String(el.getAttribute?.('aria-label') || '')) + ' ' + compact(String(el.getAttribute?.('title') || '')) + ' ' + compact(String(el.className || ''));
        let score = 0;
        if (/^확인$|^다운로드$|^계속$|^동의$|^ok$|^confirm$/i.test(text)) score += 500;
        if (/확인|다운로드|계속|동의|ok|confirm/i.test(hay)) score += 160;
        if (tag === 'button' || tag === 'a' || role === 'button') score += 140;
        if (/취소|닫기|cancel|close/i.test(hay)) score -= 500;
        if (rect.width > 260 || rect.height > 100 || text.length > 40) score -= 300;
        return { el, score, info };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    mark('download_confirm_candidates', { candidates: candidates.slice(0, 8).map((item) => ({ ...item.info, score: item.score })) });
    const hit = candidates[0];
    if (!hit) return false;
    mark('download_confirm_clicked', { candidate: hit.info, score: hit.score });
    return clickElement(hit.el, 1200);
  };
  const clickRecent7Template = async () => {
    const patterns = [/최근\s*7\s*일\s*\(?\s*오늘\s*제외\s*\)?/i, /최근\s*7\s*일/i, /7\s*일/i, /일주일/i, /week/i];
    const clicked = await clickText(patterns, 6500, 'recent_7_template');
    if (clicked) return true;
    const diagnostics = collectDateStrategyDiagnostics();
    const best = diagnostics.templateCandidates[0];
    if (best && best.score >= 120) {
      const all = controls();
      const target = all.find((el) => {
        const info = describeUiElement(el);
        return info && info.text === best.text && info.rect.top === best.rect.top && info.rect.left === best.rect.left;
      });
      if (target) {
        mark('recent_7_template_fallback_candidate', { candidate: best, diagnostics });
        return clickElement(target, 900);
      }
    }
    return false;
  };
  const isDateRangePickerOpen = () => /최근\s*7\s*일|최근7일|어제|이번주|지난주|이번달|지난달|최근\s*30\s*일|최근\s*90\s*일/.test(pageText());
  const clickDateRangeConfirm = async () => {
    if (!isDateRangePickerOpen()) {
      mark('date_range_confirm_skipped_picker_not_open', { currentRange: readCurrentRange(), visibleDateDigits: visibleDateDigits() });
      return false;
    }
    const pickerRoots = controls()
      .map((el) => {
        let cur = el;
        for (let i = 0; cur && i < 6; i += 1, cur = cur.parentElement) {
          const txt = norm(textOf(cur));
          if (/최근\s*7\s*일|최근7일|어제|이번주|지난주|이번달|지난달/.test(txt) && /확인|적용|조회/.test(txt)) return cur;
        }
        return null;
      })
      .filter(Boolean);
    const scope = pickerRoots[0] || document;
    const scopeRect = scope.getBoundingClientRect?.() || { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
    const candidates = Array.from(scope.querySelectorAll?.('button,a,[role="button"],input[type="button"],input[type="submit"],span,div') || [])
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const tag = String(el.tagName || '').toLowerCase();
        const role = String(el.getAttribute?.('role') || '').toLowerCase();
        const text = norm(textOf(el));
        const txt = compact(text);
        const cls = compact(String(el.className || ''));
        let score = 0;
        if (/^확인$|^적용$|^조회$|^ok$|^apply$|^confirm$/i.test(txt)) score += 700;
        if (/확인|적용|조회|ok|apply|confirm/i.test(txt)) score += 220;
        if (tag === 'button' || tag === 'a' || tag === 'input' || role === 'button') score += 160;
        if (/ad-cms-btn|btn|button/i.test(cls)) score += 60;
        if (rect.top >= scopeRect.top + scopeRect.height * 0.5) score += 80;
        if (rect.left >= scopeRect.left + scopeRect.width * 0.45) score += 60;
        if (/취소|닫기|cancel|close|다운로드|download/i.test(txt + cls)) score -= 600;
        if (rect.width < 24 || rect.height < 16 || rect.width > 260 || rect.height > 90 || text.length > 30) score -= 250;
        return { el, score, info: describeUiElement(el) };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    mark('date_range_confirm_candidates', { pickerRoot: describeUiElement(scope), candidates: candidates.slice(0, 8).map((item) => ({ ...item.info, score: item.score })) });
    if (!candidates.length) return false;
    mark('date_range_confirm_clicked', { candidate: candidates[0].info, score: candidates[0].score });
    return clickElementNoScroll(candidates[0].el, 1200);
  };
  const clickDateRangeControl = async () => {
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch (e) { try { window.scrollTo(0, 0); } catch (_) {} }
    await sleep(200);
    const clickableFor = (el) => {
      let cur = el;
      for (let i = 0; cur && i < 5; i += 1, cur = cur.parentElement) {
        const tag = String(cur.tagName || '').toLowerCase();
        const role = String(cur.getAttribute?.('role') || '').toLowerCase();
        if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'label' || role === 'button' || cur.onclick || cur.tabIndex >= 0) return cur;
      }
      return el;
    };
    const modalHasTemplate = () => /최근\s*7일|최근7일|어제|이번달|지난달/.test(pageText());
    const candidates = controls()
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = norm(textOf(el));
        const isOversized = rect.width > 700 || rect.height > 140 || rect.width > window.innerWidth * 0.85 || rect.height > window.innerHeight * 0.3;
        if (isOversized || text.length > 500) return { el: clickableFor(el), rect, text, score: -1000 };
        const dateCount = Math.min((text.match(/\d{4}[.-]\d{2}[.-]\d{2}\.?/g) || []).length, 2);
        let score = 0;
        if (dateCount > 0) score += dateCount * 220;
        if (/[~\-–]/.test(text)) score += 80;
        if (/기간|날짜|조회\s*기간|일자/.test(text)) score += 60;
        if (rect.top >= 80 && rect.top <= 360) score += 120;
        if (rect.top > window.innerHeight * 0.55) score -= 300;
        if (rect.left >= window.innerWidth * 0.35) score += 40;
        if (rect.width >= 80 && rect.width <= 620 && rect.height >= 18 && rect.height <= 90) score += 50;
        if (/다운로드|보고서\s*항목|검색어\s*보고서|설정하기/.test(text)) score -= 250;
        return { el: clickableFor(el), rect, text, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || b.rect.left - a.rect.left);
    mark('date_range_control_candidates', { candidates: candidates.slice(0, 6).map((item) => ({ text: item.text.slice(0, 120), score: item.score, rect: { top: Math.round(item.rect.top), left: Math.round(item.rect.left), width: Math.round(item.rect.width), height: Math.round(item.rect.height) } })) });
    for (const item of candidates.slice(0, 8)) {
      const clicked = await clickElementNoScroll(item.el, 600);
      if (!clicked) continue;
      for (let i = 0; i < 8; i += 1) {
        if (modalHasTemplate()) return true;
        await sleep(250);
      }
    }
    return false;
  };
  const clickPrevPeriod = async () => {
    const clickableForPointTarget = (el) => {
      let cur = el;
      for (let i = 0; cur && i < 6; i += 1, cur = cur.parentElement) {
        const tag = String(cur.tagName || '').toLowerCase();
        const role = String(cur.getAttribute?.('role') || '').toLowerCase();
        if (tag === 'button' || tag === 'a' || tag === 'input' || role === 'button' || cur.onclick || cur.tabIndex >= 0) return cur;
      }
      return el;
    };
    const clickPointNoScroll = async (point, delayMs = 1200) => {
      const target = document.elementFromPoint(point.x, point.y);
      if (!target) return false;
      try { target.focus?.({ preventScroll: true }); } catch (e) {}
      const eventInit = { bubbles: true, cancelable: true, view: window, clientX: point.x, clientY: point.y };
      try {
        target.dispatchEvent(new MouseEvent('pointerdown', eventInit));
        target.dispatchEvent(new MouseEvent('mousedown', eventInit));
        target.dispatchEvent(new MouseEvent('mouseup', eventInit));
        target.dispatchEvent(new MouseEvent('click', eventInit));
      } catch (e) {
        try { target.click?.(); } catch (_) { return false; }
      }
      await sleep(delayMs);
      return true;
    };
    const dateRangeItems = controls()
      .map((el) => ({ el, rect: el.getBoundingClientRect(), text: norm(textOf(el)), info: describeUiElement(el) }))
      .filter((item) => {
        const matches = item.text.match(/\d{4}[.-]\d{2}[.-]\d{2}\.?/g) || [];
        return matches.length >= 2
          && item.rect.top >= 120
          && item.rect.top <= 520
          && item.rect.left >= Math.min(220, window.innerWidth * 0.25)
          && item.rect.width >= 80
          && item.rect.width <= 720
          && item.rect.height >= 20
          && item.rect.height <= 90;
      })
      .sort((a, b) => a.rect.width - b.rect.width || b.rect.left - a.rect.left);
    const rangeRect = dateRangeItems[0]?.rect || null;
    const firstDateTextLeft = rangeRect ? Math.min(
      ...controls()
        .map((el) => ({ rect: el.getBoundingClientRect(), text: norm(textOf(el)) }))
        .filter((item) => {
          const matches = item.text.match(/\d{4}[.-]\d{2}[.-]\d{2}\.?/g) || [];
          return matches.length === 1
            && item.rect.left >= rangeRect.left
            && item.rect.left <= rangeRect.right
            && item.rect.top <= rangeRect.bottom
            && item.rect.bottom >= rangeRect.top;
        })
        .map((item) => item.rect.left)
    ) : Infinity;
    const candidates = controls()
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const rawText = norm(textOf(el));
        const txt = compact(rawText);
        const attr = compact(String(el.getAttribute?.('aria-label') || '') + ' ' + String(el.getAttribute?.('title') || ''));
        const cls = compact(String(el.className || ''));
        const inPopover = !!el.closest?.('[class*="popover"],[class*="Popover"],[class*="calendar"],[class*="Calendar"],[class*="datepicker"],[class*="DatePicker"]');
        const hasDateText = /\d{4}[.-]\d{2}[.-]\d{2}/.test(rawText);
        const smallButton = rect.width >= 18 && rect.width <= 64 && rect.height >= 18 && rect.height <= 64;
        const directionSignal = /^[<‹〈←]$/.test(txt) || /이전|prev|previous|left/i.test(attr + cls);
        const rightOfDateRange = !!rangeRect
          && rect.left >= rangeRect.right - 8
          && rect.left <= rangeRect.right + 130
          && rect.top <= rangeRect.bottom + 8
          && rect.bottom >= rangeRect.top - 8
          && smallButton;
        const leftOfDateRange = !!rangeRect
          && rect.right >= rangeRect.left - 130
          && rect.right <= rangeRect.left + 12
          && rect.top <= rangeRect.bottom + 8
          && rect.bottom >= rangeRect.top - 8
          && smallButton;
        let score = 0;
        if (!smallButton || hasDateText || txt.length > 20 || inPopover || (!directionSignal && !rightOfDateRange && !leftOfDateRange)) score -= 1000;
        if (/^[<‹〈←]$/.test(txt)) score += 420;
        if (/이전|prev|previous/i.test(attr)) score += 250;
        if (leftOfDateRange) score += 900;
        if (rightOfDateRange) score += 700;
        if (rangeRect && Math.abs((rect.top + rect.bottom) / 2 - (rangeRect.top + rangeRect.bottom) / 2) <= 16) score += 120;
        if (rect.top >= 120 && rect.top <= 520) score += 80;
        if (/ad-cms-btn|btn|button/i.test(cls)) score += 40;
        if (/접기|다운로드|보고서|저장|캘린더|calendar|월|month|다음|next|[>›〉→]/i.test(txt + attr + cls)) score -= 300;
        return { el, rect, txt, attr, cls, inPopover, rightOfDateRange, directionSignal, score, info: describeUiElement(el) };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.rect.left - b.rect.left);
    mark('prev_period_candidates', { dateRange: dateRangeItems[0]?.info || null, candidates: candidates.slice(0, 10).map((item) => ({ ...item.info, score: item.score, inPopover: item.inPopover, rightOfDateRange: item.rightOfDateRange, leftOfDateRange: item.leftOfDateRange, directionSignal: item.directionSignal })) });
    if (!candidates.length && rangeRect) {
      const y = Math.round((rangeRect.top + rangeRect.bottom) / 2);
      const rawPoints = [
        ...[12, 24, 38, 54, 74, 96, 120].map((delta) => ({ x: Math.round(rangeRect.left - delta), y, zone: 'left_of_date_range' })),
        ...[8, 16, 24, 34, 46, 60, 78, 96, 116].map((delta) => ({ x: Math.round(rangeRect.right + delta), y, zone: 'right_of_date_range' })),
        ...[8, 16, 24].map((delta) => ({ x: Math.round(rangeRect.right - delta), y, zone: 'inside_right_edge' })),
      ];
      const seenPoints = new Set();
      const points = rawPoints.filter((point) => Number.isFinite(point.x) && !seenPoints.has(point.x + ':' + point.y) && seenPoints.add(point.x + ':' + point.y));
      const pointCandidates = [];
      const rawPointSamples = [];
      for (const point of points) {
        if (point.x < 0) continue;
        const raw = document.elementFromPoint(point.x, point.y);
        const el = clickableForPointTarget(raw);
        if (!el || !visible(el)) continue;
        const rect = el.getBoundingClientRect();
        const text = norm(textOf(el));
        const hay = compact(text) + ' ' + compact(String(el.getAttribute?.('aria-label') || '')) + ' ' + compact(String(el.getAttribute?.('title') || '')) + ' ' + compact(String(el.className || ''));
        const hasDateText = /\d{4}[.-]\d{2}[.-]\d{2}/.test(text);
        const inPopover = !!el.closest?.('[class*="popover"],[class*="Popover"],[class*="calendar"],[class*="Calendar"],[class*="datepicker"],[class*="DatePicker"]');
        const rightOfDateRangePoint = point.x >= rangeRect.right - 30 && point.x <= rangeRect.right + 130 && point.y >= rangeRect.top - 8 && point.y <= rangeRect.bottom + 8;
        const leftOfDateRangePoint = point.x >= rangeRect.left - 130 && point.x <= rangeRect.left + 12 && point.y >= rangeRect.top - 8 && point.y <= rangeRect.bottom + 8;
        rawPointSamples.push({ point, raw: describeUiElement(raw), clickable: describeUiElement(el), hasDateText, inPopover, rightOfDateRangePoint, leftOfDateRangePoint });
        if (hasDateText || inPopover || /다운로드|보고서|저장|접기|다음|next|[>›〉→]/i.test(hay)) continue;
        if ((!rightOfDateRangePoint && !leftOfDateRangePoint) || rect.top > rangeRect.bottom + 8 || rect.bottom < rangeRect.top - 8) continue;
        pointCandidates.push({ el, point, info: describeUiElement(el) });
      }
      mark('prev_period_point_candidates', { dateRange: dateRangeItems[0]?.info || null, firstDateTextLeft: Number.isFinite(firstDateTextLeft) ? Math.round(firstDateTextLeft) : null, rawPointSamples: rawPointSamples.slice(0, 16), candidates: pointCandidates.slice(0, 8).map((item) => ({ point: item.point, ...item.info })) });
      if (pointCandidates.length) {
        mark('prev_period_point_clicked', { point: pointCandidates[0].point, candidate: pointCandidates[0].info });
        return clickPointNoScroll(pointCandidates[0].point, 1200);
      }
      return false;
    }
    if (!candidates.length) return false;
    mark('prev_period_candidate_clicked', { candidate: candidates[0].info, score: candidates[0].score, inPopover: candidates[0].inPopover, rightOfDateRange: candidates[0].rightOfDateRange, directionSignal: candidates[0].directionSignal });
    return clickElementNoScroll(candidates[0].el, 1200);
  };
  const ensureInitialRecent7 = async () => {
    if (rangeMatchesRequested()) {
      mark('initial_range_already_visible', { currentRange: readCurrentRange(), visibleDateDigits: visibleDateDigits() });
      return true;
    }
    const opened = await clickDateRangeControl();
    mark(opened ? 'date_range_control_opened' : 'date_range_control_not_found', { currentRange: readCurrentRange() });
    if (!opened) return false;
    const selected = await clickRecent7Template();
    mark(selected ? 'recent_7_template_clicked' : 'recent_7_template_not_found', { currentRange: readCurrentRange(), diagnostics: collectDateStrategyDiagnostics() });
    if (!selected) return false;
    const confirmed = await clickDateRangeConfirm();
    mark(confirmed ? 'recent_7_confirm_clicked' : 'recent_7_confirm_not_found', { currentRange: readCurrentRange(), pickerOpen: isDateRangePickerOpen(), visibleDateDigits: visibleDateDigits() });
    if (!confirmed) return false;
    for (let i = 0; i < 16; i += 1) {
      const pickerOpen = isDateRangePickerOpen();
      if (!pickerOpen && rangeMatchesRequested()) {
        mark('initial_7day_range_verified_after_confirm', { currentRange: readCurrentRange(), visibleDateDigits: visibleDateDigits(), attempt: i + 1 });
        return true;
      }
      await sleep(300);
    }
    mark('initial_7day_range_ready_for_step_prev', { currentRange: readCurrentRange(), pickerOpen: isDateRangePickerOpen(), visibleDateDigits: visibleDateDigits() });
    return true;
  };
  const stepPrevAndVerify = async () => {
    const maxClicks = 20;
    for (let clickAttempt = 0; clickAttempt < maxClicks; clickAttempt += 1) {
      const beforeRange = readCurrentRange();
      const beforeDigits = visibleDateDigits();
      const moved = await clickPrevPeriod();
      mark(moved ? 'prev_period_clicked' : 'prev_period_button_not_found', { clickAttempt: clickAttempt + 1, beforeRange, beforeDigits, afterClickRange: readCurrentRange(), diagnostics: collectDateStrategyDiagnostics() });
      if (!moved) return false;
      for (let i = 0; i < 8; i += 1) {
        if (rangeMatchesRequested()) {
          mark('prev_period_range_verified', { currentRange: readCurrentRange(), visibleDateDigits: visibleDateDigits(), clickAttempt: clickAttempt + 1, verifyAttempt: i + 1 });
          return true;
        }
        await sleep(300);
      }
      mark('prev_period_click_not_target_yet', { currentRange: readCurrentRange(), visibleDateDigits: visibleDateDigits(), clickAttempt: clickAttempt + 1 });
    }
    mark('prev_period_range_verify_failed', { currentRange: readCurrentRange(), visibleDateDigits: visibleDateDigits(), maxClicks });
    return false;
  };

  const title = document.title || '';
  let bodyText = pageText();
  if (/login|로그인|nid\.naver|권한|보안\s*확인|captcha|캡차/i.test(location.href + ' ' + title + ' ' + bodyText.slice(0, 1500))) {
    mark('login_required');
    return { ok: false, clicked: false, stage_log: stageLog, human_action_required: true, human_action_reason: 'login_required', page_url: location.href, title, error: 'login_required' };
  }
  if (!/검색어\s*보고서|보고서\s*설정하기|다운로드/i.test(bodyText)) {
    for (let i = 0; i < 8; i += 1) {
      await sleep(500);
      bodyText = pageText();
      if (/검색어\s*보고서|보고서\s*설정하기|다운로드/i.test(bodyText)) break;
    }
  }
  if (!/검색어\s*보고서|보고서\s*설정하기|다운로드/i.test(bodyText)) {
    mark('page_not_ready');
    return { ok: false, clicked: false, stage_log: stageLog, human_action_required: true, human_action_reason: 'ads_report_page_not_ready', page_url: location.href, title, body_sample: bodyText.slice(0, 900), error: 'ads_report_page_not_ready' };
  }

  const settingsOpened = /보고서\s*항목\s*목록|보고서\s*설정하기/.test(bodyText) || await clickText([/보고서설정하기/, /보고서설정/, /설정하기/], 5000);
  mark(settingsOpened ? 'report_settings_ready' : 'report_settings_not_found');
  if (!settingsOpened) {
    return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, human_action_required: true, human_action_reason: 'ads_report_settings_not_opened', page_url: location.href, title, body_sample: bodyText.slice(0, 900), error: 'ads_report_settings_not_opened' };
  }
  const ensureReportColumnChecked = async (labelText) => {
    const labelCompact = compact(labelText);
    const checkedState = (node) => {
      if (!node) return false;
      const ariaChecked = String(node.getAttribute?.('aria-checked') || '').toLowerCase();
      const ariaSelected = String(node.getAttribute?.('aria-selected') || '').toLowerCase();
      const ariaPressed = String(node.getAttribute?.('aria-pressed') || '').toLowerCase();
      if (ariaChecked === 'true' || ariaSelected === 'true' || ariaPressed === 'true') return true;
      if (node.tagName === 'INPUT' && /checkbox|radio/i.test(String(node.type || ''))) return !!node.checked;
      return /(^|[-_\s])(checked|selected|active|on)([-_\s]|$)/i.test(String(node.className || ''));
    };
    const rows = Array.from(document.querySelectorAll('label,li,tr,div,span,button,[role="checkbox"],input[type="checkbox"]'))
      .filter(visible)
      .map((el) => {
        const txt = compact(textOf(el));
        const rect = el.getBoundingClientRect();
        let score = 0;
        if (txt === labelCompact) score += 400;
        if (txt.includes(labelCompact)) score += 180;
        if (rect.width > 20 && rect.width < 900 && rect.height > 10 && rect.height < 120) score += 20;
        if (rect.top >= 80 && rect.top <= window.innerHeight - 20) score += 20;
        return { el, txt, rect, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    for (const row of rows) {
      let scope = row.el;
      for (let i = 0; i < 5 && scope; i += 1) {
        if (compact(textOf(scope)).includes(labelCompact)) {
          const control = scope.matches?.('input[type="checkbox"],[role="checkbox"],button[aria-checked],[aria-pressed]')
            ? scope
            : scope.querySelector?.('input[type="checkbox"],[role="checkbox"],button[aria-checked],[aria-pressed]');
          const target = control || scope;
          const selected = checkedState(target) || checkedState(scope);
          if (!control && !selected && compact(textOf(scope)) === labelCompact) {
            mark('report_column_selected_chip_visible', { label: labelText, text: norm(textOf(scope)).slice(0, 120) });
            return true;
          }
          if (!selected) {
            await clickElement(target);
            await sleep(700);
          }
          const selectedAfter = checkedState(target) || checkedState(scope);
          mark(selectedAfter ? 'report_column_checked' : 'report_column_check_unverified', { label: labelText, wasSelected: selected, text: norm(textOf(scope)).slice(0, 120) });
          return selectedAfter;
        }
        scope = scope.parentElement;
      }
    }
    mark('report_column_not_found', { label: labelText });
    return false;
  };
  const dailyColumnReady = await ensureReportColumnChecked('일별');
  if (!dailyColumnReady) {
    return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, human_action_required: true, human_action_reason: 'ads_report_daily_column_not_selected', page_url: location.href, title, body_sample: pageText().slice(0, 900), error: 'ads_report_daily_column_not_selected' };
  }

  let dateApplied = false;
  if (stepPrevOnly) {
    dateApplied = await stepPrevAndVerify();
  } else {
    const initialReady = await ensureInitialRecent7();
    dateApplied = initialReady && rangeMatchesRequested();
    if (initialReady && !dateApplied) {
      mark('initial_recent_7_ready_then_step_prev', { currentRange: readCurrentRange(), visibleDateDigits: visibleDateDigits() });
      dateApplied = await stepPrevAndVerify();
    }
  }
  const currentRange = readCurrentRange();
  mark(dateApplied ? 'range_verified' : 'range_verify_failed', { currentRange, visibleDateDigits: visibleDateDigits() });
  if (!dateApplied) {
    return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, date_applied: false, current_range: currentRange, expected_range: dateFrom + '~' + dateTo, human_action_required: true, human_action_reason: 'ads_report_date_not_applied', page_url: location.href, title, body_sample: pageText().slice(0, 900), error: 'ads_report_date_not_applied' };
  }

  const queryClicked = await clickText([/^조회하기$/, /^조회$/, /조회하기/], 8000);
  mark(queryClicked ? 'query_clicked_after_date_range' : 'query_button_not_found_after_date_range', { currentRange: readCurrentRange(), visibleDateDigits: visibleDateDigits() });
  if (!queryClicked) {
    return { ok: false, clicked: false, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, date_applied: dateApplied, current_range: currentRange, expected_range: dateFrom + '~' + dateTo, human_action_required: true, human_action_reason: 'ads_report_query_button_not_clicked', page_url: location.href, title, body_sample: pageText().slice(0, 900), error: 'ads_report_query_button_not_clicked' };
  }
  await sleep(3500);
  const rangeAfterQuery = readCurrentRange();
  mark('query_wait_after_date_range', { currentRange: rangeAfterQuery, visibleDateDigits: visibleDateDigits() });

  const clicked = await clickDownloadButton();
  await sleep(900);
  const confirmed = clicked ? await clickDownloadConfirmIfNeeded() : false;
  await sleep(1200);
  mark(clicked ? 'download_clicked' : 'download_button_not_found', { currentRange: readCurrentRange(), confirmed, postDownloadText: pageText().slice(0, 600) });
  const button_sample = controls().slice(0, 30).map((el) => norm(textOf(el)).slice(0, 80)).filter(Boolean);
  return { ok: clicked, clicked, confirmed, stage_log: stageLog, date_from: dateFrom, date_to: dateTo, current_range: currentRange, date_applied: dateApplied, expected_range: dateFrom + '~' + dateTo, human_action_required: false, page_url: location.href, title, body_sample: pageText().slice(0, 900), button_sample, error: clicked ? null : 'ads_searchword_download_button_not_found', via: 'naver_ads_searchword_report_cdp_7day_step' };
})()
"@
	$evaluated = @(Invoke-CdpEvaluate -port $port -expression $expression -timeoutMs 90000) | Select-Object -Last 1
	Write-Output -NoEnumerate $evaluated
}

function Invoke-AdsSearchwordDebugSnapshot([int]$port) {
	$expression = @"
(async () => {
  try {
    const debug = window.__erp2AdsSearchwordDebug || null;
    if (!debug) {
      return { ok: false, error: 'ads_searchword_debug_snapshot_missing', page_url: location.href, title: document.title || '', body_sample: String(document.body?.innerText || '').slice(0, 900) };
    }
    return { ok: true, ...debug };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), page_url: location.href, title: document.title || '' };
  }
})()
"@
	$evaluated = @(Invoke-CdpEvaluate -port $port -expression $expression -timeoutMs 5000) | Select-Object -Last 1
	Write-Output -NoEnumerate $evaluated
}

function Get-ReviewExcelRangeFromUrl([string]$url) {
	$out = @{ dateFrom = ""; dateTo = "" }
	try {
		if ($url -match "analyticsReviewDateFrom=([0-9]{4}-[0-9]{2}-[0-9]{2})") { $out.dateFrom = $Matches[1] }
		if ($url -match "analyticsReviewDateTo=([0-9]{4}-[0-9]{2}-[0-9]{2})") { $out.dateTo = $Matches[1] }
	} catch {}
	return $out
}

function Get-ReviewReplyBackfillIdsFromUrl([string]$url) {
	try {
		$decoded = [System.Uri]::UnescapeDataString([string]($url ?? ""))
		if ($decoded -match "analyticsReplyBackfillIds=([^&#]+)") {
			return @(([string]$Matches[1]).Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
		}
	} catch {}
	return @()
}

function Invoke-ReviewReplyBackfillCdp([int]$port, [string]$url, [array]$targetIds) {
	$urlJson = $url | ConvertTo-Json -Compress
	$idsJson = ConvertTo-Json -InputObject @($targetIds) -Compress
	$expression = @"
(async () => {
  const targetUrl = $urlJson;
  const rawTargetIds = $idsJson;
  const targetIds = new Set((Array.isArray(rawTargetIds) ? rawTargetIds : [rawTargetIds]).map((one) => String(one || '').trim()).filter(Boolean));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const compact = (value) => String(value || '').replace(/\s+/g, '');
  const setNativeValue = (el, value) => {
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  };
  if (!location.href.includes('sell.smartstore.naver.com') || (!location.href.includes('/review/search') && !location.href.includes('/review/manage'))) {
    location.href = targetUrl || 'https://sell.smartstore.naver.com/#/review/search';
    await sleep(3500);
  }
  const bodyText = norm(document.body?.innerText || '');
  if (/login|로그인|accounts\.commerce|nid\.naver/i.test(location.href) || /로그인/.test(bodyText)) {
    return { error: 'login_required', human_action_required: true, human_action_reason: 'login_required', page_url: location.href, items: [] };
  }
  if (!targetIds.size) return { error: 'target_review_ids_empty', items: [] };
  const form = document.querySelector('form[name="vm.searchForm"]');
  if (form) {
    const textarea = form.querySelector('[ng-model="vm.searchFormData.viewData.searchKeyword"]') || form.querySelector('textarea');
    const keywordTypeInput = form.querySelector('[ng-model="vm.searchFormData.viewData.searchKeywordType"]');
    if (keywordTypeInput) setNativeValue(keywordTypeInput, 'IDS');
    if (textarea) setNativeValue(textarea, Array.from(targetIds).join('\n'));
    try {
      const scope = (window.angular && window.angular.element(form).scope && window.angular.element(form).scope()) || null;
      const parentScope = scope?.[String.fromCharCode(36) + 'parent'] || null;
      const vm = scope?.vm || parentScope?.vm || null;
      if (vm?.searchFormData?.viewData) {
        vm.searchFormData.viewData.searchKeywordType = 'IDS';
        vm.searchFormData.viewData.searchKeyword = Array.from(targetIds).join('\n');
        const applyAsync = scope?.[String.fromCharCode(36) + 'applyAsync'];
        if (typeof applyAsync === 'function') applyAsync.call(scope);
        else {
          const apply = scope?.[String.fromCharCode(36) + 'apply'];
          if (typeof apply === 'function') apply.call(scope);
        }
      }
    } catch (_) {}
    const submitBtn = Array.from(form.querySelectorAll('button, a, [role=button]')).find((el) => {
      const txt = compact(el.innerText || el.textContent || '');
      return txt === '검색하기' || txt === '검색';
    });
    if (submitBtn) submitBtn.click();
    else if (form.requestSubmit) form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await sleep(2200);
  }
  const results = [];
  const seen = new Set();
  let rowCount = 0;
  let matchedRows = 0;
  let openedCount = 0;
  let scopedCloseCount = 0;
  let unscopedDialogCount = 0;
  const rowSamples = [];
  const isVisible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 10 && rect.height > 10;
  };
  const detailDialogRoots = () => Array.from(document.querySelectorAll('[role=dialog],[aria-modal=true],[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"]'))
    .filter((el) => {
      if (!isVisible(el)) return false;
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'html' || tag === 'body') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width >= window.innerWidth * 0.99 && rect.height >= window.innerHeight * 0.99) return false;
      return true;
    })
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    });
  const findReviewDetailDialog = (reviewId) => {
    const rid = String(reviewId || '').trim();
    const roots = detailDialogRoots();
    const looksLikeDetail = (root) => {
      const text = compact(root.innerText || root.textContent || '');
      return /리뷰글번호|관련리뷰글번호|판매자답글|사장님답글|답글등록일/.test(text)
        && (!rid || text.includes(rid));
    };
    return roots.find(looksLikeDetail)
      || roots.find((root) => /리뷰글번호|관련리뷰글번호|판매자답글|사장님답글|답글등록일/.test(compact(root.innerText || root.textContent || '')))
      || null;
  };
  const extractionCounts = {};
  const UI_LINE_RE = /최소\s*5자|리뷰\s*신고|답글\s*등록|답글\s*수정|답글\s*삭제|등록하기|이전\s*리뷰|다음\s*리뷰|리뷰\s*정보|리뷰\s*도움수|베스트리뷰여부|리뷰전시여부|리뷰타입|재구매\s*여부|구독유형|IE환경|신고하기|답글을\s*입력/;
  const COUNTER_RE = /^\d{1,4}$|^\d{1,4}\s*\/\s*[1-9],?\d{3}(\s*\(.*\))?$/;
  const classifyReplyValue = (value) => {
    const v = String(value || '').replace(/\s+/g, ' ').trim();
    if (!v) return 'EMPTY';
    if (/^[\d\s,.\/:%-]+$/.test(v) || COUNTER_RE.test(v)) return 'COUNTER';
    if (UI_LINE_RE.test(v) || /\d{1,4}\s*\/\s*[1-9],?\d{3}/.test(v)) return 'UI';
    if (v.length < 2) return 'EMPTY';
    return 'VALID';
  };
  const classifyReplyExtraction = (textareaValues, lines, hasEditor) => {
    let sawCounter = false;
    let sawUi = false;
    let uiSample = '';
    for (const value of textareaValues.slice().reverse()) {
      const kind = classifyReplyValue(value);
      if (kind === 'VALID') return { status: 'VALID_REPLY', text: String(value).replace(/\s+/g, ' ').trim() };
      if (kind === 'COUNTER') sawCounter = true;
      if (kind === 'UI') { sawUi = true; uiSample = uiSample || value; }
    }
    const labelIndex = lines.findIndex((line) => ['판매자답글', '사장님답글', '답글'].includes(compact(line)));
    if (labelIndex >= 0) {
      const parts = [];
      for (const line of lines.slice(labelIndex + 1)) {
        const c = compact(line);
        if (/^(리뷰글번호|답글등록일시|작성일|등록일|구매자평점|상품명|전시상태)/.test(c)) continue;
        if (['닫기', '확인', '취소'].includes(c)) continue;
        const kind = classifyReplyValue(line);
        if (kind === 'COUNTER') { sawCounter = true; break; }
        if (kind === 'UI') { sawUi = true; uiSample = uiSample || line; break; }
        parts.push(line);
      }
      const candidate = norm(parts.join(' '));
      if (classifyReplyValue(candidate) === 'VALID') return { status: 'VALID_REPLY', text: candidate };
    }
    if (hasEditor && textareaValues.every((value) => classifyReplyValue(value) !== 'VALID')) {
      if (sawUi && !textareaValues.some((value) => String(value || '').trim())) return { status: 'EMPTY_REPLY_EDITOR', sample: uiSample };
      if (sawCounter && !sawUi) return { status: textareaValues.some((value) => String(value || '').trim()) ? 'COUNTER_ONLY' : 'EMPTY_REPLY_EDITOR', sample: textareaValues.join(' | ') };
      if (!sawUi) return { status: 'EMPTY_REPLY_EDITOR', sample: '' };
    }
    if (sawUi) return { status: 'SELLER_CENTER_UI_ONLY', sample: uiSample };
    if (sawCounter) return { status: 'COUNTER_ONLY', sample: textareaValues.join(' | ') };
    return { status: 'EXTRACTION_FAILED', sample: '' };
  };
  const closeReviewDetailDialog = async (dialog) => {
    if (!dialog || dialog === document.body) {
      unscopedDialogCount += 1;
      return false;
    }
    const buttons = Array.from(dialog.querySelectorAll('button, a, [role=button]')).filter((el) => isVisible(el));
    const closeBtn = buttons.find((el) => {
      const txt = compact(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
      return txt === '닫기' || txt === '닫힘' || txt === 'Close' || /닫기$|close$/i.test(txt);
    });
    if (!closeBtn) return false;
    closeBtn.click();
    await sleep(400);
    scopedCloseCount += 1;
    return true;
  };
  for (let step = 0; step < 80; step += 1) {
    const rows = Array.from(document.querySelectorAll('.ag-body-viewport [role="row"].ag-row, .ag-center-cols-container [role="row"].ag-row, [role="row"].ag-row'));
    rowCount += rows.length;
    if (!rows.length) break;
    for (const row of rows) {
      const rowText = norm(row.innerText || row.textContent || '');
      if (rowSamples.length < 5) rowSamples.push(rowText.slice(0, 500));
      const link = row.querySelector('[ng-click*="openReviewDetailModal"], a[ng-click*="openReviewDetailModal"]');
      const ngClick = String(link?.getAttribute('ng-click') || '');
      const reviewId = (ngClick.match(/openReviewDetailModal\((\d+)/) || [null, null])[1] || (rowText.match(/(?:^|\s|-)(\d{8,})(?:\s|$)/) || [null, null])[1] || null;
      if (!reviewId || seen.has(reviewId) || !targetIds.has(reviewId)) continue;
      matchedRows += 1;
      const target = row.querySelector('[col-id="reviewContent"] a[ng-click*="openReviewDetailModal"]') || link;
      if (!target) continue;
      target.click();
      openedCount += 1;
      await sleep(900);
      const dialog = findReviewDetailDialog(reviewId);
      if (!dialog) {
        unscopedDialogCount += 1;
        continue;
      }
      const lines = String(dialog?.innerText || '').replace(/\r/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
      const joined = lines.join('\n');
      const idMatch = joined.match(/리뷰글번호\s*[:：]?\s*(\d{6,})/) || joined.match(/관련리뷰글번호\s*[:：]?\s*(\d{6,})/);
      const dateMatch = joined.match(/답글등록일시\s*[:：]?\s*([0-9.\-:\s]+)/) || joined.match(/답글등록일\s*[:：]?\s*([0-9.\-:\s]+)/);
      const visibleTextareas = Array.from(dialog.querySelectorAll('textarea')).filter((el) => isVisible(el));
      const extraction = classifyReplyExtraction(
        visibleTextareas.map((el) => String(el.value || el.textContent || '').trim()),
        lines,
        visibleTextareas.length > 0,
      );
      const finalId = (idMatch ? idMatch[1] : reviewId) || reviewId;
      if (finalId) {
        if (extraction.status === 'VALID_REPLY') {
          seen.add(finalId);
          results.push({ review_id_original: finalId, reply_text: extraction.text, reply_written_at: dateMatch ? dateMatch[1] : null, extraction_status: 'VALID_REPLY' });
        } else if (extraction.status !== 'EXTRACTION_FAILED') {
          seen.add(finalId);
          extractionCounts[extraction.status] = (extractionCounts[extraction.status] || 0) + 1;
          results.push({ review_id_original: finalId, reply_text: '', reply_written_at: null, extraction_status: extraction.status, rejected_sample: String(extraction.sample || '').slice(0, 300) });
        } else {
          extractionCounts.EXTRACTION_FAILED = (extractionCounts.EXTRACTION_FAILED || 0) + 1;
        }
      }
      await closeReviewDetailDialog(dialog);
    }
    if (targetIds.size && Array.from(targetIds).every((id) => seen.has(id))) break;
    const viewport = document.querySelector('.ag-body-viewport') || document.querySelector('.ag-center-cols-viewport');
    if (!viewport) break;
    const before = Number(viewport.scrollTop || 0);
    const maxScroll = Math.max(0, Number(viewport.scrollHeight || 0) - Number(viewport.clientHeight || 0));
    viewport.scrollTop = Math.min(maxScroll, before + Math.max(220, Math.floor(Number(viewport.clientHeight || 0) * 0.85)));
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(900);
    if (Number(viewport.scrollTop || 0) <= before + 5) break;
  }
  return { items: results, collected: results.filter((one) => one.extraction_status === 'VALID_REPLY').length, extraction_counts: extractionCounts, target_count: targetIds.size, row_count: rowCount, matched_rows: matchedRows, opened_count: openedCount, scoped_close_count: scopedCloseCount, unscoped_dialog_count: unscopedDialogCount, row_samples: rowSamples, page_url: location.href, via: 'smartstore_review_reply_backfill_cdp' };
})()
"@
	$evaluated = @(Invoke-CdpEvaluate -port $port -expression $expression -timeoutMs 150000) | Select-Object -Last 1
	Write-Output -NoEnumerate $evaluated
}

function Invoke-ReviewExcelDownload([int]$port, [string]$url, [string]$dateFrom, [string]$dateTo) {
	$urlJson = $url | ConvertTo-Json -Compress
	$dateFromJson = $dateFrom | ConvertTo-Json -Compress
	$dateToJson = $dateTo | ConvertTo-Json -Compress
	$expression = @"
(async () => {
  const targetUrl = $urlJson;
  const dateFrom = $dateFromJson;
  const dateTo = $dateToJson;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (v) => String(v || '').replace(/\s+/g, '').trim();
  const textOf = (el) => String((el && (el.innerText || el.textContent || el.value)) || '');
  const doc = document;
  const title = document.title || '';
  let bodyText = document.body?.innerText || '';
  if (/login|로그인|accounts\.commerce|nid\.naver/i.test(location.href + ' ' + title + ' ' + bodyText.slice(0, 1000))) {
    return { ok: false, clicked: false, human_action_required: true, human_action_reason: 'login_required', page_url: location.href, title, error: 'login_required' };
  }
  for (let i = 0; i < 15; i += 1) {
    bodyText = document.body?.innerText || '';
    if (/리뷰관리|리뷰\s*관리|customer-reviews|review\/search/i.test(bodyText + ' ' + location.href)) break;
    await sleep(1000);
  }
  if (!/리뷰관리|리뷰\s*관리|customer-reviews|review\/search/i.test(bodyText + ' ' + location.href)) {
    return { ok: false, clicked: false, human_action_required: true, human_action_reason: 'review_page_not_ready', page_url: location.href, title, body_sample: bodyText.slice(0, 700), error: 'review_page_not_ready' };
  }
  const fmtDot = (ymd) => {
    const s = String(ymd || '').replace(/-/g, '.').trim();
    return s && !s.endsWith('.') ? s + '.' : s;
  };
  const setNativeValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const inputs = Array.from(doc.querySelectorAll('input')).filter((el) => {
    const s = String(el.value || el.placeholder || el.getAttribute('aria-label') || '');
    return /\d{4}[.-]\d{2}[.-]\d{2}|날짜|시작|종료|기간/i.test(s);
  });
  const dateInputs = inputs.filter((el) => !String(el.type || '').match(/hidden|checkbox|radio/i)).slice(0, 2);
  if (dateInputs.length >= 2) {
    setNativeValue(dateInputs[0], fmtDot(dateFrom));
    setNativeValue(dateInputs[1], fmtDot(dateTo));
    await sleep(600);
  }
  const controls = () => Array.from(doc.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]'))
    .filter((el) => !el.disabled && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const visibleButtons = () => Array.from(doc.querySelectorAll('button,input[type="button"],input[type="submit"]'))
    .filter((el) => !el.disabled && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const clickElement = async (hit) => {
    try { hit.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    hit.click();
    await sleep(1800);
    return true;
  };
  const clickMatch = async (patterns, timeoutMs = 0) => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const hit = controls().find((el) => patterns.some((re) => re.test(norm(textOf(el)) + ' ' + String(el.className || '') + ' ' + String(el.getAttribute('aria-label') || ''))));
      if (hit) return await clickElement(hit);
      if (Date.now() >= deadline) return false;
      await sleep(1000);
    }
  };
  const clickExactButton = async (matcher, timeoutMs = 0) => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const candidates = visibleButtons().filter((el) => matcher({
        text: norm(textOf(el)),
        cls: String(el.className || ''),
        type: String(el.getAttribute('type') || ''),
        el,
      }));
      if (candidates.length > 0) {
        candidates.sort((a, b) => (b.getBoundingClientRect?.().top || 0) - (a.getBoundingClientRect?.().top || 0));
        return await clickElement(candidates[0]);
      }
      if (Date.now() >= deadline) return false;
      await sleep(1000);
    }
  };
  const searched = await clickExactButton((x) => x.text === '검색' && /submit|button/i.test(x.type || 'button'), 5000);
  await sleep(2500);
  const clicked = await clickExactButton((x) => x.text === '엑셀다운' || (/progress-button/.test(x.cls) && /엑셀다운/.test(x.text)), 8000);
  await sleep(800);
  const afterDownloadClickText = document.body?.innerText || '';
  const noReviews = /해당\s*(날짜|기간).*리뷰가\s*없|리뷰가\s*없습니다|조회된\s*리뷰가\s*없|검색\s*결과가\s*없/i.test(afterDownloadClickText);
  if (noReviews) {
    const acknowledged = await clickExactButton((x) => x.text === '확인' || x.text === '닫기', 5000);
    return { ok: true, clicked, acknowledged, no_reviews: true, date_from: dateFrom, date_to: dateTo, human_action_required: false, page_url: location.href, title, body_sample: afterDownloadClickText.slice(0, 700), error: null, via: 'smartstore_review_excel_cdp' };
  }
  const confirmed = /리뷰\s*다운로드|다운로드.*계속|계속하시겠습니까|활용에\s*유의/i.test(afterDownloadClickText)
    ? await clickExactButton((x) => x.text === '확인' || x.text === '동의' || x.text === '계속', 5000)
    : false;
  await sleep(1000);
  const button_sample = controls().slice(-30).map((el) => norm(textOf(el)).slice(0, 80)).filter(Boolean);
  return { ok: clicked, clicked, confirmed, searched, date_from: dateFrom, date_to: dateTo, human_action_required: false, page_url: location.href, title, body_sample: (document.body?.innerText || bodyText).slice(0, 700), button_sample, error: clicked ? null : 'review_excel_download_button_not_found', via: 'smartstore_review_excel_cdp' };
})()
"@
	$evaluated = @(Invoke-CdpEvaluate -port $port -expression $expression -timeoutMs 60000) | Select-Object -Last 1
	Write-Output -NoEnumerate $evaluated
}

function Submit-ReviewExcelUpload([string]$ApiBaseUrl, [string]$BearerToken, [string]$FilePath) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl) -or [string]::IsNullOrWhiteSpace($FilePath)) { throw "upload_required_args_missing" }
	$headers = New-CollectorApiHeaders -BearerToken $BearerToken
	$uri = $ApiBaseUrl.TrimEnd("/") + "/reviews/import-smartstore-file"
	return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Form @{ file = Get-Item -LiteralPath $FilePath } -TimeoutSec 180
}

function Get-MetricValue($Metrics, [string]$Name) {
	if ($null -eq $Metrics) { return $null }
	try {
		if ($Metrics -is [hashtable] -and $Metrics.ContainsKey($Name)) { return $Metrics[$Name] }
	} catch {}
	try { return $Metrics.$Name } catch { return $null }
}

function Get-MetricString($Metrics, [string]$Name, [string]$Default = "") {
	$value = Get-MetricValue $Metrics $Name
	if ($null -eq $value) { return $Default }
	$text = [string]$value
	if ([string]::IsNullOrWhiteSpace($text)) { return $Default }
	return $text
}

function Test-CollectorHumanActionRequired($Metrics) {
	$flag = Get-MetricValue $Metrics "human_action_required"
	if ($flag -eq $true) { return $true }
	$errorText = [string](Get-MetricValue $Metrics "error")
	if ($errorText -match "login_required|security_check|captcha|blocked|human_action") { return $true }
	return $false
}

function Invoke-GfaRequestListTrustedCloseFallback([int]$port) {
	$expression = @"
(() => {
  const textOf = (el) => String(el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || el?.value || '').trim();
  const compact = (s) => String(s || '').replace(/\s+/g, '');
  const isVisible = (el) => {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0.05 && r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0;
  };
  const roots = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"],body > div,body > section'))
    .filter(isVisible)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const t = compact(textOf(el));
      return r.width >= 420 && r.height >= 260 && /다운로드요청목록/.test(t) && /요청일시|파일생성일시|요청자|상태/.test(t);
    });
  if (!roots.length) return { ok: false, reason: 'request_list_not_open' };
  const root = roots.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return (br.width * br.height) - (ar.width * ar.height);
  })[0];
  const rr = root.getBoundingClientRect();
  const candidates = Array.from(root.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"],span,div'))
    .filter(isVisible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const rawText = textOf(el);
      const tag = String(el.tagName || '');
      const cls = String(el.className || '');
      const role = String(el.getAttribute?.('role') || '');
      const score =
        (/^확인$/.test(compact(rawText)) ? 10000 : 0) +
        ((tag === 'BUTTON' || role.toLowerCase() === 'button' || /btn|button/i.test(cls)) ? 2000 : 0) +
        (r.top > rr.top + rr.height * 0.65 ? 1000 : 0) -
        Math.min(1200, Math.round((r.width * r.height) / 500));
      return { el, rawText, tag, cls, role, top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height, score };
    })
    .filter((x) => /^확인$/.test(compact(x.rawText)))
    .filter((x) => x.top > rr.top + rr.height * 0.55)
    .filter((x) => x.left >= rr.left - 24 && x.right <= rr.right + 24)
    .sort((a, b) => b.score - a.score || (a.width * a.height) - (b.width * b.height) || b.bottom - a.bottom);
  const hit = candidates[0];
  if (!hit) return { ok: false, reason: 'confirm_not_found', roots: roots.length };
  return { ok: true, x: (hit.left + hit.right) / 2, y: (hit.top + hit.bottom) / 2, text: hit.rawText, tag: hit.tag, width: hit.width, height: hit.height, score: hit.score, roots: roots.length };
})()
"@
	try {
		$hit = @(Invoke-CdpEvaluate -port $port -expression $expression -timeoutMs 5000) | Select-Object -Last 1
		if ((Get-MetricValue $hit "ok") -ne $true) { return $false }
		$x = [double](Get-MetricValue $hit "x")
		$y = [double](Get-MetricValue $hit "y")
		if ($x -le 0 -or $y -le 0) { return $false }
		Invoke-CdpTrustedMouseClick -port $port -X $x -Y $y
		Start-Sleep -Milliseconds 900
		$closed = @(Invoke-CdpEvaluate -port $port -expression "(() => !Array.from(document.querySelectorAll('[role=`"dialog`"],[aria-modal=`"true`"],[class*=modal],[class*=Modal],[class*=dialog],[class*=Dialog],body > div,body > section')).filter((el)=>{ const s=getComputedStyle(el); const r=el.getBoundingClientRect(); const t=String(el.innerText||el.textContent||'').replace(/\s+/g,''); return s.display!=='none' && s.visibility!=='hidden' && r.width>=420 && r.height>=260 && /다운로드요청목록/.test(t) && /요청일시|파일생성일시|요청자|상태/.test(t); }).length)()" -timeoutMs 5000) | Select-Object -Last 1
		return ($closed -eq $true)
	} catch {
		return $false
	}
}

function Get-CdpPages([int]$port) {
	$tabsResponse = Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/list" -f $port) -TimeoutSec 3
	$tabs = @($tabsResponse)
	if ($tabs.Count -eq 1 -and $tabs[0] -is [array]) { $tabs = @($tabs[0]) }
	return @($tabs | Where-Object { $_.type -eq "page" })
}

function Test-HostChromeLoggedIn([int]$port, [string]$targetUrl) {
	$pages = @(Get-CdpPages -port $port)
	foreach ($page in $pages) {
		$url = [string]($page.url ?? "")
		if ([string]::IsNullOrWhiteSpace($url)) { continue }
		if ($url -match "accounts\.commerce\.naver\.com|nid\.naver\.com|login|authorize") { continue }
		if ($url -match "sell\.smartstore\.naver\.com" -or (-not [string]::IsNullOrWhiteSpace($targetUrl) -and $targetUrl -match "sell\.smartstore\.naver\.com" -and $url -match "smartstore")) {
			try {
				$state = @(Invoke-CdpEvaluate -port $port -expression "(() => { const text = String(document.body?.innerText || ''); const url = String(location.href || ''); return { loggedIn: /sell\.smartstore\.naver\.com/i.test(url) && !/login-callback|accounts\.commerce\.naver\.com|nid\.naver\.com/i.test(url) && !/로그인|아이디|비밀번호|보안\s*확인|captcha|캡차/i.test(text.slice(0, 2000)) }; })()" -timeoutMs 5000) | Select-Object -Last 1
				if ((Get-MetricValue $state "loggedIn") -eq $true) { return $true }
			} catch {}
			continue
		}
		if ($url -match "ads\.naver\.com" -or (-not [string]::IsNullOrWhiteSpace($targetUrl) -and $targetUrl -match "ads\.naver\.com" -and $url -match "ads\.naver\.com")) {
			try {
				$state = @(Invoke-CdpEvaluate -port $port -expression "(() => { const text = String(document.body?.innerText || ''); const url = String(location.href || ''); return { loggedIn: /ads\.naver\.com/i.test(url) && !/^\s*로그인\s*$|아이디|비밀번호|로그인\s*상태\s*유지|네이버\s*로그인/i.test(text.slice(0, 2000)) }; })()" -timeoutMs 5000) | Select-Object -Last 1
				if ((Get-MetricValue $state "loggedIn") -eq $true) { return $true }
			} catch {}
		}
	}
	return $false
}

function Invoke-NaverLoginAutoClick([int]$port, [string]$targetUrl) {
	$targetUrlJson = $targetUrl | ConvertTo-Json -Compress
	$expression = @"
(async () => {
  const targetUrl = $targetUrlJson;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const textOf = (el) => norm([el?.innerText, el?.textContent, el?.value, el?.ariaLabel, el?.title, el?.getAttribute?.('aria-label')].filter(Boolean).join(' '));
  const visible = (el) => !!el && !el.disabled && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const click = async (el) => {
    const clickableSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"], [tabindex], label';
    let target = el;
    try {
      const closest = el.closest?.(clickableSelector);
      if (closest && visible(closest)) target = closest;
    } catch (e) {}
    try {
      const child = Array.from((target || el).querySelectorAll?.(clickableSelector) || []).find(visible);
      if (child) target = child;
    } catch (e) {}
    try { target.scrollIntoView?.({ block: 'center', inline: 'center' }); } catch (e) {}
    await sleep(120);
    let dispatchTarget = target;
    try {
      const rect = target.getBoundingClientRect();
      const x = Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
      dispatchTarget = document.elementFromPoint(x, y) || target;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        dispatchTarget.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
      }
    } catch (e) {}
    try { dispatchTarget.focus?.(); } catch (e) {}
    try { dispatchTarget.click?.(); } catch (e) {}
    try { target.click?.(); } catch (e) {}
    return true;
  };
  const pageUrl = location.href || '';
  const pageHost = location.hostname || '';
  const pageText = norm(document.body?.innerText || '');
  const controls = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], label, li, article, section, div, .login, .btn_login, .LoginButton, .AccountButton'));
  const findControl = (predicate) => controls.find((el) => visible(el) && predicate(textOf(el), el));
  const smartstoreLoginUrl = 'https://accounts.commerce.naver.com/login?url=https%3A%2F%2Fsell.smartstore.naver.com%2F%23%2Flogin-callback';
  const isSmartstoreTarget = /sell\.smartstore\.naver\.com/i.test(String(targetUrl || ''));

  if (isSmartstoreTarget && /sell\.smartstore\.naver\.com/i.test(pageUrl) && /\/home(?:[?#].*)?$/i.test(pageUrl)) {
    location.href = smartstoreLoginUrl;
    return { ok: true, action: 'navigate_smartstore_login_from_home', page_url: pageUrl, body_sample: pageText.slice(0, 180) };
  }

  if (/(^|\.)naver\.com$/i.test(pageHost) && !/accounts\.commerce\.naver\.com|nid\.naver\.com|ads\.naver\.com|sell\.smartstore\.naver\.com/i.test(pageHost)) {
    return { ok: false, action: 'naver_main_wait_user', page_url: pageUrl, body_sample: pageText.slice(0, 160) };
  }

  if (/accounts\.commerce\.naver\.com/i.test(pageUrl)) {
    const accountCardPattern = /현재\s*로그인\s*중인\s*네이버\s*아이디|로그인\s*중인\s*네이버\s*아이디|간편\s*로그인/i;
    const lowerLoginPattern = /다른\s*아이디|이메일|비밀번호|ID\s*\/?\s*전화번호|QR\s*코드|네이버\s*아이디로\s*로그인|로그인\s*상태\s*유지/i;
    const accountCandidates = controls
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = textOf(el);
        return { el, rect, text, area: Math.max(0, rect.width) * Math.max(0, rect.height) };
      })
      .filter(({ rect, text }) =>
        accountCardPattern.test(text) &&
        !lowerLoginPattern.test(text) &&
        !/^로그인$/i.test(text) &&
        rect.width >= 180 &&
        rect.width <= Math.min(900, window.innerWidth - 20) &&
        rect.height >= 40 &&
        rect.height <= 180 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
      )
      .sort((a, b) => a.area - b.area);
    const accountCardInfo = accountCandidates[0] || null;
    const accountCard = accountCardInfo?.el || null;
    if (accountCard) {
      const clickKey = 'erp2SmartstoreSavedAccountAutoClickCount';
      let clickCount = 0;
      try { clickCount = Number(sessionStorage.getItem(clickKey) || '0') || 0; } catch (e) {}
      if (clickCount >= 2) {
        return { ok: false, action: 'smartstore_saved_account_click_limit_wait_user', page_url: pageUrl, text: textOf(accountCard).slice(0, 120) };
      }
      try { sessionStorage.setItem(clickKey, String(clickCount + 1)); } catch (e) {}
      const rect = accountCard.getBoundingClientRect();
      const x = Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
      await click(accountCard);
      return { ok: true, action: 'trusted_click_smartstore_saved_account', page_url: pageUrl, x, y, rect_w: rect.width, rect_h: rect.height, text: textOf(accountCard).slice(0, 120) };
    }
    return { ok: false, action: 'smartstore_saved_account_not_found_wait_user', page_url: pageUrl, body_sample: pageText.slice(0, 240) };
  }

  if (isSmartstoreTarget && /sell\.smartstore\.naver\.com/i.test(pageUrl) && (/login-callback|로그인|아이디|비밀번호|보안\s*확인|captcha|캡차/i.test(pageUrl + ' ' + pageText))) {
    location.href = smartstoreLoginUrl;
    return { ok: true, action: 'navigate_smartstore_login_from_callback', page_url: pageUrl, body_sample: pageText.slice(0, 180) };
  }

  if (/nid\.naver\.com|ads\.naver\.com/i.test(pageUrl) || /네이버\s*로그인|로그인\s*상태\s*유지|아이디|비밀번호/i.test(pageText)) {
    const loginButton = findControl((text, el) => {
      const id = String(el.id || '');
      const cls = String(el.className || '');
      return /^로그인$/.test(text) || /로그인/.test(text) || /log\.login|btn_login|log\.login/i.test(id + ' ' + cls);
    });
    if (loginButton) {
      await click(loginButton);
      return { ok: true, action: 'clicked_naver_login', page_url: pageUrl, text: textOf(loginButton).slice(0, 120) };
    }
  }

  if (isSmartstoreTarget && !/accounts\.commerce\.naver\.com|sell\.smartstore\.naver\.com/i.test(pageUrl)) {
    location.href = smartstoreLoginUrl;
    return { ok: true, action: 'navigate_smartstore_login', page_url: pageUrl };
  }

  return { ok: false, action: 'no_login_button_found', page_url: pageUrl, title: document.title || '', body_sample: pageText.slice(0, 300) };
})()
"@
	try {
		$result = @(Invoke-CdpEvaluate -port $port -expression $expression -timeoutMs 10000) | Select-Object -Last 1
		$action = [string](Get-MetricValue $result "action")
		if ($action -eq "trusted_click_smartstore_saved_account") {
			$x = [double](Get-MetricValue $result "x")
			$y = [double](Get-MetricValue $result "y")
			if ($x -gt 0 -and $y -gt 0) {
				Invoke-CdpTrustedMouseClick -port $port -X $x -Y $y
				Start-Sleep -Milliseconds 2500
				$afterClick = @{}
				try {
					$afterClick = @(Invoke-CdpEvaluate -port $port -expression "(() => ({ url: String(location.href || ''), title: String(document.title || '') }))()" -timeoutMs 5000) | Select-Object -Last 1
				} catch {}
				$result = @{
					ok = $true
					action = "clicked_smartstore_saved_account_trusted"
					page_url = (Get-MetricValue $result "page_url")
					after_url = (Get-MetricValue $afterClick "url")
					after_title = (Get-MetricValue $afterClick "title")
					text = (Get-MetricValue $result "text")
					x = $x
					y = $y
				}
			}
		}
		Write-Output -NoEnumerate $result
	} catch {
		Write-Output -NoEnumerate @{ ok = $false; action = "login_auto_click_failed"; error = $_.Exception.Message }
	}
}

function Wait-HostChromeLogin([int]$port, [string]$targetUrl, [int]$TimeoutSec = 3600) {
	$deadline = (Get-Date).AddSeconds($TimeoutSec)
	while ((Get-Date) -lt $deadline) {
		try {
			if (Test-HostChromeLoggedIn -port $port -targetUrl $targetUrl) { return $true }
		} catch {}
		Start-Sleep -Seconds 3
	}
	throw "login_wait_timeout"
}

function Wait-HostChromeLoginOrCancel([int]$port, [string]$targetUrl, [int]$TimeoutSec, [string]$ApiBaseUrl, [string]$BearerToken, [string]$DeviceId, [string]$JobId, [string]$Url) {
	$deadline = (Get-Date).AddSeconds($TimeoutSec)
	$lastStatusWrite = [DateTime]::MinValue
	$lastAutoClick = [DateTime]::MinValue
	$nextAutoClickAt = [DateTime]::MinValue
	while ((Get-Date) -lt $deadline) {
		if (((Get-Date) - $lastStatusWrite).TotalSeconds -ge 15) {
			Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $JobId; url = $Url; reason = "login_required"; loginCheck = "waiting" }
			$lastStatusWrite = Get-Date
		}
		if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $JobId -BearerToken $BearerToken) {
			Write-BackgroundStatus @{ running = $true; state = "POLLING"; apiBaseUrl = $ApiBaseUrl; jobId = $JobId; url = $Url; reason = "user_cancelled"; lastCancelledJobId = $JobId }
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $JobId -DeviceId $DeviceId -Url $Url -Status "CANCELLED" -Note "user_cancelled" -BearerToken $BearerToken | Out-Null
			return $false
		}
		try {
			if (Test-HostChromeLoggedIn -port $port -targetUrl $targetUrl) {
				if ($targetUrl -match "sell\.smartstore\.naver\.com|ads\.naver\.com") {
					try {
						Invoke-CdpNavigate -port $port -url $targetUrl
						Start-Sleep -Seconds 5
					} catch {}
				}
				return $true
			}
		} catch {}
		if ((Get-Date) -ge $nextAutoClickAt -and ((Get-Date) - $lastAutoClick).TotalSeconds -ge 8) {
			try {
				$autoClick = Invoke-NaverLoginAutoClick -port $port -targetUrl $targetUrl
				$action = [string](Get-MetricValue $autoClick "action")
				if (-not [string]::IsNullOrWhiteSpace($action) -and $action -ne "no_login_button_found") {
					if ($action -match "click_limit_wait_user|naver_main_wait_user") {
						Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $JobId; url = $Url; reason = "login_required"; loginCheck = "auto_click_limit"; loginAction = $action }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $JobId -DeviceId $DeviceId -Url $Url -Status "LOGIN_REQUIRED" -Note ("login_auto_click_limit: {0}" -f $action) -BearerToken $BearerToken | Out-Null
						$nextAutoClickAt = (Get-Date).AddSeconds(60)
					} else {
						$x0 = [string](Get-MetricValue $autoClick "x")
						$y0 = [string](Get-MetricValue $autoClick "y")
						$rectW0 = [string](Get-MetricValue $autoClick "rect_w")
						$rectH0 = [string](Get-MetricValue $autoClick "rect_h")
						$afterUrl0 = [string](Get-MetricValue $autoClick "after_url")
						$eventNote = "login_auto_click: $action"
						if (-not [string]::IsNullOrWhiteSpace($x0) -and -not [string]::IsNullOrWhiteSpace($y0)) { $eventNote = "$eventNote x=$x0 y=$y0" }
						if (-not [string]::IsNullOrWhiteSpace($rectW0) -and -not [string]::IsNullOrWhiteSpace($rectH0)) { $eventNote = "$eventNote rect=${rectW0}x${rectH0}" }
						if (-not [string]::IsNullOrWhiteSpace($afterUrl0)) { $eventNote = "$eventNote after=$afterUrl0" }
						Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $JobId; url = $Url; reason = "login_required"; loginCheck = "auto_click"; loginAction = $action; loginClickX = $x0; loginClickY = $y0; loginAfterUrl = $afterUrl0 }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $JobId -DeviceId $DeviceId -Url $Url -Status "RETRYING" -Note $eventNote -BearerToken $BearerToken | Out-Null
						$nextAutoClickAt = if ($action -match "clicked_smartstore_saved_account") { (Get-Date).AddSeconds(25) } else { (Get-Date).AddSeconds(8) }
					}
				}
			} catch {}
			$lastAutoClick = Get-Date
		}
		Start-Sleep -Seconds 3
	}
	throw "login_wait_timeout"
}

function Wait-HostChromeHumanActionOrCancel([int]$port, [int]$TimeoutSec, [string]$ApiBaseUrl, [string]$BearerToken, [string]$DeviceId, [string]$JobId, [string]$Url, [string]$Reason = "human_action_required") {
	$deadline = (Get-Date).AddSeconds($TimeoutSec)
	$lastStatusWrite = [DateTime]::MinValue
	try { Show-HostChrome -port $port | Out-Null } catch {}
	while ((Get-Date) -lt $deadline) {
		if (((Get-Date) - $lastStatusWrite).TotalSeconds -ge 15) {
			Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $JobId; url = $Url; reason = $Reason; humanAction = "waiting" }
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $JobId -DeviceId $DeviceId -Url $Url -Status "HUMAN_ACTION_REQUIRED" -Note $Reason -BearerToken $BearerToken | Out-Null
			$lastStatusWrite = Get-Date
		}
		if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $JobId -BearerToken $BearerToken) {
			Write-BackgroundStatus @{ running = $true; state = "POLLING"; apiBaseUrl = $ApiBaseUrl; jobId = $JobId; url = $Url; reason = "user_cancelled"; lastCancelledJobId = $JobId }
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $JobId -DeviceId $DeviceId -Url $Url -Status "CANCELLED" -Note "user_cancelled" -BearerToken $BearerToken | Out-Null
			return $false
		}
		try {
			$state = @(Invoke-CdpEvaluate -port $port -expression @'
(() => {
  const text = String(document.body?.innerText || '');
  const url = String(location.href || '');
  const title = String(document.title || '');
  const sample = (url + ' ' + title + ' ' + text.slice(0, 2000));
  const blocked = /보안\s*확인|자동입력|captcha|캡차|로봇이\s*아닙니다|비정상적인\s*접근/i.test(sample);
  return { ok: !blocked, page_url: url, title };
})()
'@ -timeoutMs 5000) | Select-Object -Last 1
			if ((Get-MetricValue $state "ok") -eq $true) {
				return $true
			}
		} catch {}
		Start-Sleep -Seconds 3
	}
	throw "human_action_wait_timeout"
}

function Wait-GfaInventoryLoginOrCancel([int]$port, [string]$targetUrl, [int]$TimeoutSec, [string]$ApiBaseUrl, [string]$BearerToken, [string]$DeviceId, [string]$JobId, [string]$Url) {
	$deadline = (Get-Date).AddSeconds($TimeoutSec)
	$lastStatusWrite = [DateTime]::MinValue
	try { Show-HostChrome -port $port | Out-Null } catch {}
	while ((Get-Date) -lt $deadline) {
		if (((Get-Date) - $lastStatusWrite).TotalSeconds -ge 15) {
			Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $JobId; url = $Url; reason = "login_required"; loginCheck = "waiting" }
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $JobId -DeviceId $DeviceId -Url $Url -Status "LOGIN_REQUIRED" -Note "login_required" -BearerToken $BearerToken | Out-Null
			$lastStatusWrite = Get-Date
		}
		if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $JobId -BearerToken $BearerToken) {
			Write-BackgroundStatus @{ running = $true; state = "POLLING"; apiBaseUrl = $ApiBaseUrl; jobId = $JobId; url = $Url; reason = "user_cancelled"; lastCancelledJobId = $JobId }
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $JobId -DeviceId $DeviceId -Url $Url -Status "CANCELLED" -Note "user_cancelled" -BearerToken $BearerToken | Out-Null
			return $false
		}
		try {
			if (Test-HostChromeLoggedIn -port $port -targetUrl $targetUrl) {
				try {
					Invoke-CdpNavigate -port $port -url $targetUrl
					Start-Sleep -Seconds 5
				} catch {}
				return $true
			}
		} catch {}
		Start-Sleep -Seconds 3
	}
	throw "login_wait_timeout"
}

function Restore-HostChromeWindowByWin32([int]$port) {
	$code = @"
using System;
using System.Runtime.InteropServices;
public static class HostChromeWin32 {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
  public const int SW_MAXIMIZE = 3;
}
"@
	try { Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue } catch {}
	$needlePort = "--remote-debugging-port=$port"
	$restored = $false
	foreach ($proc in @(Get-Process -Name chrome -ErrorAction SilentlyContinue)) {
		if ($proc.MainWindowHandle -eq [IntPtr]::Zero) { continue }
		$cim = $null
		try { $cim = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $proc.Id) -ErrorAction SilentlyContinue } catch { $cim = $null }
		$cmd = [string]($cim.CommandLine ?? "")
		if ([string]::IsNullOrWhiteSpace($cmd)) { continue }
		if (($cmd -notlike "*$needlePort*") -and ($cmd -notlike "*ERP2-Analytics-HostChrome*")) { continue }
		try {
			if ([HostChromeWin32]::IsIconic($proc.MainWindowHandle)) {
				[void][HostChromeWin32]::ShowWindow($proc.MainWindowHandle, [HostChromeWin32]::SW_RESTORE)
			}
			[void][HostChromeWin32]::ShowWindow($proc.MainWindowHandle, [HostChromeWin32]::SW_SHOW)
			[void][HostChromeWin32]::ShowWindow($proc.MainWindowHandle, [HostChromeWin32]::SW_MAXIMIZE)
			[void][HostChromeWin32]::BringWindowToTop($proc.MainWindowHandle)
			[void][HostChromeWin32]::SetForegroundWindow($proc.MainWindowHandle)
			$restored = $true
		} catch {}
	}
	return $restored
}

function Hide-HostChrome([int]$port) {
	try {
		$pages = @(Get-CdpPages -port $port | Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl } | Select-Object -First 1)
		if ($pages.Count -gt 0) {
			$page = $pages[0]
			$window = Invoke-CdpJsonCommand -wsUrl ([string]$page.webSocketDebuggerUrl) -method "Browser.getWindowForTarget" -params @{ targetId = [string]$page.id } -id 9201 -timeoutMs 5000
			$windowId = $window.windowId
			if ($null -ne $windowId) {
				Invoke-CdpJsonCommand -wsUrl ([string]$page.webSocketDebuggerUrl) -method "Browser.setWindowBounds" -params @{ windowId = $windowId; bounds = @{ windowState = "minimized" } } -id 9202 -timeoutMs 5000 | Out-Null
				return $true
			}
		}
	} catch {}
	return $false
}

function Show-HostChrome([int]$port) {
	$cdpOk = $false
	try {
		$pages = @(Get-CdpPages -port $port | Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl } | Select-Object -First 1)
		if ($pages.Count -gt 0) {
			$page = $pages[0]
			$window = Invoke-CdpJsonCommand -wsUrl ([string]$page.webSocketDebuggerUrl) -method "Browser.getWindowForTarget" -params @{ targetId = [string]$page.id } -id 9203 -timeoutMs 5000
			$windowId = $window.windowId
			if ($null -ne $windowId) {
				# minimized -> maximized is flaky on some Chrome builds; restore to normal first.
				try {
					Invoke-CdpJsonCommand -wsUrl ([string]$page.webSocketDebuggerUrl) -method "Browser.setWindowBounds" -params @{ windowId = $windowId; bounds = @{ windowState = "normal" } } -id 9204 -timeoutMs 5000 | Out-Null
				} catch {}
				Invoke-CdpJsonCommand -wsUrl ([string]$page.webSocketDebuggerUrl) -method "Browser.setWindowBounds" -params @{ windowId = $windowId; bounds = @{ windowState = "maximized" } } -id 9205 -timeoutMs 5000 | Out-Null
				$cdpOk = $true
			}
		}
	} catch {}
	$winOk = $false
	try { $winOk = [bool](Restore-HostChromeWindowByWin32 -port $port) } catch { $winOk = $false }
	return ($cdpOk -or $winOk)
}

function Send-CollectorEvent([string]$ApiBaseUrl, [string]$JobId, [string]$DeviceId, [string]$Url, [string]$Status, [string]$Note, [string]$BearerToken) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl)) { return $false }
	try {
		$headers = New-CollectorApiHeaders -BearerToken $BearerToken -ContentType "application/json"
		$payload = @{
			job_id = $JobId
			device_id = $DeviceId
			url = $Url
			status = $Status
			note = $Note
		} | ConvertTo-Json -Depth 10 -Compress
		Invoke-RestMethod -Method Post -Uri ($ApiBaseUrl.TrimEnd("/") + "/search-rank/page-metrics/local-collector/prototype-events") -Headers $headers -Body $payload -TimeoutSec 10 | Out-Null
		return $true
	} catch {
		Write-Warn ("collector event failed: {0}" -f $_.Exception.Message)
		return $false
	}
}

function Get-BackgroundStatusPath {
	if (-not (Test-Path -LiteralPath $UserDataDir)) { New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null }
	return (Join-Path $UserDataDir "collector-background.status.json")
}

function Get-BackgroundPidPath {
	if (-not (Test-Path -LiteralPath $UserDataDir)) { New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null }
	return (Join-Path $UserDataDir "collector-background.pid")
}

function Get-BackgroundConfigPath {
	if (-not (Test-Path -LiteralPath $UserDataDir)) { New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null }
	return (Join-Path $UserDataDir "collector-background.config.json")
}

function Write-BackgroundConfig([hashtable]$Config) {
	try {
		$Config["updated_at"] = (Get-Date).ToString("s")
		$Config | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Get-BackgroundConfigPath) -Encoding UTF8
	} catch {
		Write-Warn ("background config write failed: {0}" -f $_.Exception.Message)
	}
}

function Write-BackgroundStatus([hashtable]$Status) {
	try {
		$Status["updated_at"] = (Get-Date).ToString("s")
		$Status["agentVersion"] = $AgentVersion
		$Status["agentManageNo"] = $AgentManageNo
		$Status["chromeUserDataDir"] = $script:HostChromeUserDataDir
		$Status["chromeProfileDir"] = $script:HostChromeProfileDir
		$Status["chromeProfileLabel"] = $script:HostChromeProfileLabel
		$Status["pid"] = $PID
		$Status | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Get-BackgroundStatusPath) -Encoding UTF8
	} catch {
		Write-Warn ("background status write failed: {0}" -f $_.Exception.Message)
	}
}

function Read-BackgroundStatus {
	$pidPath = Get-BackgroundPidPath
	$statusPath = Get-BackgroundStatusPath
	$pidText = ""
	$running = $false
	try {
		if (Test-Path -LiteralPath $pidPath) {
			$pidText = (Get-Content -LiteralPath $pidPath -Raw).Trim()
			if ($pidText) { $running = $null -ne (Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue) }
		}
	} catch {}
	$status = @{}
	try {
		if (Test-Path -LiteralPath $statusPath) {
			$status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json -AsHashtable
		}
	} catch { $status = @{} }
	$status["running"] = $running
	$status["pid"] = $pidText
	$status["agentVersion"] = $AgentVersion
	$status["agentManageNo"] = $AgentManageNo
	$status["chromeUserDataDir"] = $script:HostChromeUserDataDir
	$status["chromeProfileDir"] = $script:HostChromeProfileDir
	$status["chromeProfileLabel"] = $script:HostChromeProfileLabel
	return $status
}

function Stop-CollectorBackgroundProcess {
	$status = Read-BackgroundStatus
	$pidText = [string]($status["pid"] ?? "")
	if ($pidText) {
		try { Stop-Process -Id ([int]$pidText) -Force -ErrorAction SilentlyContinue } catch {}
	}
	try { Remove-Item -LiteralPath (Get-BackgroundPidPath) -Force -ErrorAction SilentlyContinue } catch {}
	try { Remove-Item -LiteralPath (Get-BackgroundConfigPath) -Force -ErrorAction SilentlyContinue } catch {}
	Write-BackgroundStatus @{ running = $false; state = "STOPPED" }
	return $pidText
}

function Get-GfaCreativeDetailExpectedName([string]$url) {
	try {
		$uri = [Uri]$url
		$pairs = $uri.Query.TrimStart("?").Split("&", [System.StringSplitOptions]::RemoveEmptyEntries)
		foreach ($pair in $pairs) {
			$kv = $pair.Split("=", 2)
			if ($kv.Count -eq 2 -and $kv[0] -eq "analyticsGfaCreativeName") {
				return [Uri]::UnescapeDataString($kv[1].Replace("+", " "))
			}
		}
	} catch {}
	return ""
}

function Normalize-GfaCreativeDetailText([object]$value) {
	$text = ([string]($value ?? "")).Trim()
	return [regex]::Replace($text, "\s+", "")
}

function Test-GfaCreativeDetailMeaningful($metrics) {
	if ($null -eq $metrics) { return $false }
	$err = [string](Get-MetricValue $metrics "error")
	if (-not [string]::IsNullOrWhiteSpace($err)) { return $false }
	foreach ($key in @("image_url", "landing_url")) {
		$value = [string](Get-MetricValue $metrics $key)
		if ($value -match "^https?://") { return $true }
	}
	foreach ($key in @("primary_text", "headline", "description", "cta")) {
		$value = [string](Get-MetricValue $metrics $key)
		if (-not [string]::IsNullOrWhiteSpace($value)) { return $true }
	}
	return $false
}

function Test-GfaCreativeDetailExpectedMatch($metrics, [string]$expectedName) {
	$expected = Normalize-GfaCreativeDetailText $expectedName
	if ([string]::IsNullOrWhiteSpace($expected)) { return $true }
	$actual = Normalize-GfaCreativeDetailText (Get-MetricValue $metrics "creative_name")
	if ([string]::IsNullOrWhiteSpace($actual)) { return $false }
	return ($actual -eq $expected -or $actual.Contains($expected) -or $expected.Contains($actual))
}

function Get-GfaCreativeDetailFallbackUrls([string]$url) {
	$out = New-Object 'System.Collections.Generic.List[string]'
	try {
		$m = [regex]::Match($url, "creativeNo=(\d+)")
		if (-not $m.Success) { return @() }
		$baseNo = [int64]$m.Groups[1].Value
		foreach ($delta in @(-1, 1, -2, 2)) {
			$n = $baseNo + [int64]$delta
			if ($n -le 0) { continue }
			$out.Add(([regex]::Replace($url, "creativeNo=\d+", ("creativeNo={0}" -f $n), 1))) | Out-Null
		}
	} catch {}
	return @($out.ToArray())
}

function Resolve-GfaCreativeDetailMetrics([int]$port, [string]$url, [string]$ApiBaseUrl, [string]$BearerToken, [string]$DeviceId, [string]$JobId) {
	$expectedName = Get-GfaCreativeDetailExpectedName $url
	$metrics = Invoke-GfaCreativeDetailCollect -port $port -url $url
	if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
	if ((Test-GfaCreativeDetailMeaningful $metrics) -and (Test-GfaCreativeDetailExpectedMatch $metrics $expectedName)) {
		return $metrics
	}
	$originalErr = [string](Get-MetricValue $metrics "error")
	if ([string]::IsNullOrWhiteSpace($originalErr)) { $originalErr = "gfa_creative_detail_fields_not_found" }
	foreach ($candidateUrl in (Get-GfaCreativeDetailFallbackUrls $url)) {
		try {
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $JobId -DeviceId $DeviceId -Url $candidateUrl -Status "RETRYING" -Note "gfa_creative_no_fallback_probe" -BearerToken $BearerToken | Out-Null
			Invoke-CdpNavigate -port $port -url $candidateUrl
			Start-Sleep -Seconds 5
			$candidate = Invoke-GfaCreativeDetailCollect -port $port -url $candidateUrl
			if ($candidate -is [array] -and $candidate.Count -gt 0) { $candidate = $candidate[$candidate.Count - 1] }
			if ((Test-GfaCreativeDetailMeaningful $candidate) -and (Test-GfaCreativeDetailExpectedMatch $candidate $expectedName)) {
				try {
					$candidate | Add-Member -NotePropertyName "requested_detail_url" -NotePropertyValue $url -Force
					$candidate | Add-Member -NotePropertyName "resolved_detail_url" -NotePropertyValue $candidateUrl -Force
					$candidate | Add-Member -NotePropertyName "creative_no_resolved_by" -NotePropertyValue "adjacent_probe" -Force
				} catch {}
				return $candidate
			}
		} catch {
			Write-Info ("gfa_creative_no_fallback_failed: url={0}, error={1}" -f $candidateUrl, $_.Exception.Message)
		}
	}
	if ($null -ne $metrics) {
		try { $metrics | Add-Member -NotePropertyName "error" -NotePropertyValue $originalErr -Force } catch {}
		return $metrics
	}
	return @{ ok = $false; error = $originalErr; via = "naver_gfa_creative_detail_cdp" }
}

function Invoke-AdRankDiagnosisCollect([int]$port, [string]$url, $Plan, $Page = $null) {
	$planJson = ($Plan | ConvertTo-Json -Depth 80 -Compress)
	if ([string]::IsNullOrWhiteSpace($planJson)) { $planJson = "{}" }
	try {
		$page0 = if ($null -ne $Page) { $Page } else { Get-CdpPage -port $port }
		$currentUrl = [string]($page0.url ?? "")
		if ([string]::IsNullOrWhiteSpace($currentUrl) -or $currentUrl -notmatch "ads\.naver\.com/.*/exposure-status") {
			if ($null -ne $Page) { Invoke-CdpNavigateOnPage -Page $Page -url $url } else { Invoke-CdpNavigate -port $port -url $url }
			Start-Sleep -Seconds 6
		}
	} catch {
		if ($null -ne $Page) { Invoke-CdpNavigateOnPage -Page $Page -url $url } else { Invoke-CdpNavigate -port $port -url $url }
		Start-Sleep -Seconds 6
	}
	$expression = @'
(async () => {
  const plan = __PLAN_JSON__;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (v) => String(v || '').replace(/\s+/g, '').trim();
  const textOf = (el) => String(el?.innerText || el?.textContent || '').trim();
  const stageLog = [];
  const mark = (stage, data = {}) => stageLog.push({ stage, at: new Date().toISOString(), ...data });
  let queryChangeBlockedUntil = 0;
  const mouse = (el) => {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    const rect = el.getBoundingClientRect?.();
    const x = rect ? Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)) : 1;
    const y = rect ? Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)) : 1;
    const target = document.elementFromPoint(x, y) || el;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })); } catch (e) {}
    }
    try { target.click?.(); } catch (e) {}
    return true;
  };
  const singleClick = (el) => {
    if (!el) return { ok: false };
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    const rect = el.getBoundingClientRect?.();
    const x = rect ? Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)) : 1;
    const y = rect ? Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)) : 1;
    const target = document.elementFromPoint(x, y) || el;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      try { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })); } catch (e) {}
    }
    try { target.click?.(); } catch (e) {}
    return { ok: true, tag: target.tagName, text: textOf(target).slice(0, 100), className: String(target.className || '').slice(0, 160) };
  };
  const nativeClickOnce = (el) => {
    if (!el) return { ok: false };
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    try { el.focus?.(); } catch (e) {}
    try { el.click?.(); } catch (e) { return { ok: false, error: String(e?.message || e) }; }
    return { ok: true, tag: el.tagName, text: textOf(el).slice(0, 100), className: String(el.className || '').slice(0, 160) };
  };
  const fire = (el, type) => el?.dispatchEvent(new Event(type, { bubbles: true }));
  const cssEscape = (value) => {
    try { return window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&'); } catch (e) { return String(value || ''); }
  };
  const all = () => Array.from(document.querySelectorAll('button,a,input,textarea,[role="button"],[role="radio"],[role="tab"],[role="option"],[role="combobox"],label,div,span'));
  const isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const clickText = async (needles, timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = all().map((el) => {
        if (!isVisible(el)) return null;
        const t = norm(textOf(el) || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || el.getAttribute?.('placeholder'));
        const matchedNeedle = needles.find((n) => typeof n === 'string' ? t.includes(norm(n)) : n.test(t));
        if (!matchedNeedle) return null;
        const target = typeof matchedNeedle === 'string' ? norm(matchedNeedle) : '';
        const rect = el.getBoundingClientRect();
        const tag = String(el.tagName || '').toLowerCase();
        const role = String(el.getAttribute?.('role') || '').toLowerCase();
        const cls = String(el.className || '');
        const score =
          (target && t === target ? 1200 : 0) +
          (target && t.includes(target) && t.length <= target.length + 4 ? 700 : 0) +
          (tag === 'button' || role === 'button' || /btn|button/i.test(cls) ? 260 : 0) +
          (role === 'tab' || /tab/i.test(cls) ? 120 : 0) +
          (rect.width >= 40 && rect.width <= 260 && rect.height >= 24 && rect.height <= 80 ? 140 : 0) -
          Math.max(0, t.length - (target.length || 20));
        return { el, score, text: t };
      }).filter(Boolean).sort((a, b) => b.score - a.score)[0]?.el || null;
      if (found) {
        const clickInfo = nativeClickOnce(found);
        mark('click_text', { needles: needles.map((n) => String(n)).join('|'), clicked: textOf(found).slice(0, 80), tag: found.tagName, className: String(found.className || '').slice(0, 120), click_once: true, click_info: clickInfo });
        await sleep(450);
        return true;
      }
      await sleep(300);
    }
    return false;
  };
  const diagnosisKeywordInput = () => Array.from(document.querySelectorAll('input,textarea')).find((el) => {
    const placeholder = String(el.getAttribute('placeholder') || '');
    const aria = String(el.getAttribute('aria-label') || '');
    const t = `${placeholder} ${aria} ${textOf(el)}`;
    return isVisible(el) && /키워드/.test(t) && !/등록한\s*광고\s*정보|통합\s*검색/.test(t);
  });
  const shoppingExposureInput = () => document.querySelector('input[type="radio"][value="SHOPPING_STATUS_VIEW"]');
  const shoppingExposureLabel = () => {
    const input = shoppingExposureInput();
    const byFor = input?.id ? document.querySelector(`label[for="${cssEscape(input.id)}"]`) : null;
    if (byFor) return byFor;
    const direct = input?.closest('label');
    if (direct) return direct;
    const labels = Array.from(document.querySelectorAll('label,[role="radio"],span,div')).filter((el) => isVisible(el));
    return labels
      .filter((el) => norm(textOf(el)).includes(norm('쇼핑검색')) && norm(textOf(el)).includes(norm('노출현황보기')))
      .sort((a, b) => textOf(a).length - textOf(b).length)[0] || null;
  };
  const selectedExposureValue = () => {
    const checked = Array.from(document.querySelectorAll('input[type="radio"]')).find((el) => el.checked && /STATUS/.test(String(el.value || '')));
    return String(checked?.value || '');
  };
  const selectShoppingExposureMode = async () => {
    const input = shoppingExposureInput();
    if (!input) return false;
    if (selectedExposureValue() === 'SHOPPING_STATUS_VIEW' && diagnosisKeywordInput()) {
      mark('select_shopping_exposure_unchanged', { selected: selectedExposureValue() });
      return true;
    }
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const label = shoppingExposureLabel();
      mark('select_shopping_exposure_attempt', { attempt, selected: selectedExposureValue(), label_text: textOf(label).slice(0, 120) });
      mouse(label || input);
      await sleep(500);
      if (selectedExposureValue() !== 'SHOPPING_STATUS_VIEW') {
        mouse(input);
        fire(input, 'click');
        fire(input, 'input');
        fire(input, 'change');
        await sleep(700);
      }
      if (selectedExposureValue() === 'SHOPPING_STATUS_VIEW') break;
    }
    if (selectedExposureValue() !== 'SHOPPING_STATUS_VIEW') return false;
    const started = Date.now();
    while (Date.now() - started < 8000) {
      if (selectedExposureValue() !== 'SHOPPING_STATUS_VIEW') return false;
      if (diagnosisKeywordInput()) return true;
      await sleep(300);
    }
    return false;
  };
  const nativeSetValue = (el, value) => {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
    fire(el, 'input');
    fire(el, 'change');
  };
  const setKeyword = async (keyword) => {
    if (selectedExposureValue() !== 'SHOPPING_STATUS_VIEW') return { ok: false, changed: false };
    const input = diagnosisKeywordInput();
    if (!input) return { ok: false, changed: false };
    const current = String(input.value || '').trim();
    if (norm(current) === norm(keyword)) {
      mark('keyword_unchanged', { keyword });
      return { ok: true, changed: false };
    }
    input.focus();
    nativeSetValue(input, keyword);
    await sleep(300);
    mark('keyword_changed', { keyword, previous: current });
    return { ok: true, changed: true };
  };
  const optionText = (type, value) => {
    const v = String(value || '').trim();
    if (type === 'age') {
      if (v === '60+' || v === '60세 이상' || v === '60세이상') return '60세 이상';
      if (v === 'unknown' || v === '알 수 없음' || v === '알수없음') return '알 수 없음';
      return v.replace('-', '~') + '세';
    }
    if (type === 'gender') return v === 'female' ? '여성' : v === 'male' ? '남성' : '알 수 없음';
    return v;
  };
  const fieldControlByLabel = (labelText) => {
    const labelNorm = norm(labelText);
    const labels = all()
      .filter((el) => isVisible(el))
      .map((el) => ({ el, text: norm(textOf(el)), rect: el.getBoundingClientRect() }))
      .filter((x) => x.text === labelNorm)
      .sort((a, b) => (a.text.length - b.text.length) || (a.rect.left - b.rect.left));
    const label = labels[0];
    if (!label) return null;
    const y = label.rect.top + label.rect.height / 2;
    const candidates = Array.from(document.querySelectorAll('button,input,[role="button"],[role="combobox"],[aria-haspopup="listbox"],[aria-expanded],div'))
      .filter((el) => isVisible(el))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = norm(textOf(el) || el.getAttribute?.('placeholder') || el.getAttribute?.('aria-label') || el.getAttribute?.('title'));
        const cls = String(el.className || '');
        const role = String(el.getAttribute?.('role') || '');
        const score =
          (Math.abs((rect.top + rect.height / 2) - y) <= 28 ? 800 : 0) +
          (rect.left > label.rect.right ? 500 : 0) +
          (/알수없음|남성|여성|세/.test(text) ? 280 : 0) +
          (/select|dropdown|combobox|button|btn/i.test(`${cls} ${role}`) ? 160 : 0) +
          (rect.width >= 120 && rect.width <= 520 ? 90 : 0) -
          Math.max(0, rect.left - label.rect.right);
        return { el, rect, text, score };
      })
      .filter((x) => x.score > 900 && x.rect.width > 40 && x.rect.height > 20)
      .filter((x) => x.rect.width >= 100 && x.rect.width <= 620 && x.rect.height >= 28 && x.rect.height <= 70)
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.el || null;
  };
  const dropdownOptionByText = (valueText) => {
    const target = norm(valueText);
    return all()
      .filter((el) => isVisible(el))
      .map((el) => {
        const optionEl = el.closest?.('.ad-cms-select-item-option') || el;
        const text = norm(textOf(optionEl));
        const role = String(optionEl.getAttribute?.('role') || '');
        const rect = optionEl.getBoundingClientRect();
        const cls = String(optionEl.className || '');
        const score =
          (text === target ? 1200 : (text.includes(target) && text.length <= target.length + 3) ? 700 : 0) +
          (/option|menuitem|button/i.test(role) ? 160 : 0) +
          (/select-item-option|option/i.test(cls) ? 220 : 0) +
          (rect.width >= 80 && rect.height >= 20 ? 60 : 0) -
          Math.max(0, text.length - target.length);
        return { el: optionEl, text, score, rect };
      })
      .filter((x) => x.score >= 900 && x.rect.height >= 24 && x.rect.height <= 70)
      .sort((a, b) => b.score - a.score)[0]?.el || null;
  };
  const closeDropdowns = async () => {
    for (const target of [document.activeElement, document.body, window]) {
      try { target?.dispatchEvent?.(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true })); } catch (e) {}
      try { target?.dispatchEvent?.(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true })); } catch (e) {}
    }
    await sleep(180);
  };
  const selectByLabel = async (labelText, valueText) => {
    await closeDropdowns();
    const control = fieldControlByLabel(labelText);
    mark('select_dropdown_control', { labelText, valueText, found: Boolean(control), current: textOf(control).slice(0, 80) });
    if (!control) return { ok: false, changed: false };
    if (norm(textOf(control)) === norm(valueText) || norm(textOf(control)).includes(norm(valueText))) {
      await closeDropdowns();
      mark('select_dropdown_unchanged', { labelText, valueText });
      return { ok: true, changed: false };
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      mouse(control);
      await sleep(500);
      const option = dropdownOptionByText(valueText);
      mark('select_dropdown_option', { labelText, valueText, attempt, found: Boolean(option), option_text: textOf(option).slice(0, 80) });
      if (option) {
        mouse(option);
        await sleep(500);
        await closeDropdowns();
        const refreshed = fieldControlByLabel(labelText);
        if (!refreshed || norm(textOf(refreshed)).includes(norm(valueText))) {
          mark('select_dropdown_changed', { labelText, valueText });
          return { ok: true, changed: true };
        }
      }
      await sleep(300);
    }
    return { ok: false, changed: false };
  };
  const queryButtonState = () => {
    const button = all().map((el) => {
      if (!isVisible(el)) return null;
      const text = norm(textOf(el) || el.getAttribute?.('aria-label') || el.getAttribute?.('title'));
      if (!text.includes('조회하기')) return null;
      const rect = el.getBoundingClientRect();
      const tag = String(el.tagName || '').toLowerCase();
      const role = String(el.getAttribute?.('role') || '').toLowerCase();
      const cls = String(el.className || '');
      const score =
        (text === '조회하기' ? 1200 : 0) +
        (tag === 'button' || role === 'button' || /btn|button/i.test(cls) ? 260 : 0) +
        (rect.width >= 40 && rect.width <= 260 && rect.height >= 24 && rect.height <= 80 ? 140 : 0) -
        Math.max(0, text.length - 4);
      return { el, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score)[0]?.el || null;
    const expanded = all().some((el) => isVisible(el) && String(el.getAttribute?.('aria-expanded') || '').toLowerCase() === 'true');
    const disabled = !button || button.disabled || button.getAttribute?.('disabled') != null || String(button.getAttribute?.('aria-disabled') || '').toLowerCase() === 'true';
    return { found: Boolean(button), disabled: Boolean(disabled), expanded: Boolean(expanded), text: textOf(button).slice(0, 80) };
  };
  const waitForQueryReady = async () => {
    await closeDropdowns();
    await sleep(1200);
    const started = Date.now();
    let state = queryButtonState();
    while (Date.now() - started < 5000) {
      state = queryButtonState();
      if (state.found && !state.disabled) {
        mark('query_button_ready', state);
        return true;
      }
      await closeDropdowns();
      await sleep(350);
    }
    mark('query_button_not_ready', state);
    return false;
  };
  const resultState = () => {
    const bodyText = String(document.body?.innerText || '');
    const normalized = norm(bodyText);
    const rows = Array.from(document.querySelectorAll('table tbody tr, [role="row"]'))
      .filter((el) => isVisible(el) && norm(textOf(el)).length > 0);
    const loading = /조회중|로딩|불러오는중|Loading/i.test(bodyText);
    const noResult = /조회된\s*내역이\s*없습니다|결과가\s*없습니다|광고\s*미노출/i.test(bodyText);
    const hasResultHeader = normalized.includes('조회결과') || normalized.includes('최대100개까지보여집니다');
    const visibleErrorTexts = Array.from(document.querySelectorAll('div,span,p,[role="alert"],[class*="toast"],[class*="message"],[class*="notification"]'))
      .filter((el) => isVisible(el))
      .map((el) => textOf(el).replace(/\s+/g, ' ').trim())
      .filter((text) => text && text.length <= 260 && /요청.*실패|잠시\s*후\s*다시|오류가\s*발생|조회.*실패/i.test(text));
    const rateLimitTexts = visibleErrorTexts.filter((text) => /요청이\s*몰려|잠시\s*후\s*다시|조회에\s*실패|요청.*실패/i.test(text));
    const hasUsableRows = hasResultHeader && rows.length > 0;
    const resultSettled = hasResultHeader && (rows.length > 0 || noResult);
    const rateLimitVisible = rateLimitTexts.length > 0 && !loading;
    const rateLimited = rateLimitVisible && !hasUsableRows && !resultSettled;
    // Naver keeps old "요청이 몰려" text in the page DOM after a later successful result.
    // Once a result table is visible, treat stale non-rate-limit error text as non-blocking.
    const errorToast = visibleErrorTexts.length > 0 && !resultSettled && !loading && (rateLimited || !hasUsableRows);
    return {
      hasResultHeader,
      rowCount: rows.length,
      noResult,
      loading,
      errorToast,
      rateLimited,
      rateLimitVisible,
      visibleErrorTexts: visibleErrorTexts.slice(0, 3),
      rateLimitTexts: rateLimitTexts.slice(0, 3),
      signature: rows.slice(0, 8).map((el) => norm(textOf(el)).slice(0, 160)).join('|').slice(0, 1000),
      sample: bodyText.slice(0, 500),
    };
  };
  const waitForRequestNoiseToSettle = async (reason = 'request_noise') => {
    const started = Date.now();
    let state = resultState();
    while (Date.now() - started < 20000) {
      state = resultState();
      if (state.rateLimited || state.rateLimitVisible) {
        mark('request_rate_limited_retry_without_wait', { reason, waited_ms: Date.now() - started, state });
        return true;
      }
      if (!state.errorToast && !state.loading) {
        mark('request_noise_clear_fast', { reason, waited_ms: Date.now() - started, state });
        return true;
      }
      await sleep(1000);
    }
    mark('request_noise_still_present', { reason, state });
    return !(state.rateLimited || state.rateLimitVisible);
  };
  const waitForSafeConditionChange = async (reason = 'condition_change') => {
    const remaining = queryChangeBlockedUntil - Date.now();
    if (remaining > 0) {
      mark('condition_change_blocked', { reason, wait_ms: remaining });
      await sleep(remaining);
    }
    const firstState = resultState();
    const canFastAdvance =
      (reason === 'before_condition_start' || reason === 'before_placement_tab_click') &&
      !firstState.loading &&
      !firstState.errorToast &&
      !firstState.rateLimited &&
      !firstState.rateLimitVisible;
    if (canFastAdvance) {
      mark('condition_change_fast_safe', { reason, state: firstState });
      return true;
    }
    const started = Date.now();
    let rateLimitedSince = 0;
    let state = resultState();
    let idleSince = 0;
    let lastSignature = '';
    while (Date.now() - started < 20000) {
      state = resultState();
      if (state.rateLimited || state.rateLimitVisible) {
        if (!rateLimitedSince) {
          rateLimitedSince = Date.now();
          mark('condition_change_rate_limited_observed', { reason, waited_ms: Date.now() - started, state });
        }
        if (Date.now() - rateLimitedSince >= 20000) {
          mark('condition_change_rate_limited', { reason, waited_ms: Date.now() - started, rate_limited_ms: Date.now() - rateLimitedSince, state });
          throw new Error('ad_rank_rate_limited');
        }
        await sleep(1000);
        continue;
      } else {
        rateLimitedSince = 0;
      }
      const signatureStable = !state.signature || state.signature === lastSignature;
      if (state.signature !== lastSignature) {
        lastSignature = state.signature || '';
        idleSince = 0;
      }
      if (!state.loading && !state.errorToast && signatureStable) {
        if (!idleSince) idleSince = Date.now();
        if (Date.now() - idleSince >= 1000) {
          mark('condition_change_safe', { reason, waited_ms: Date.now() - started, idle_ms: Date.now() - idleSince, state });
          return true;
        }
      } else {
        idleSince = 0;
      }
      await sleep(1000);
    }
    mark('condition_change_forced_after_wait', { reason, state });
    return false;
  };
  const waitForQueryResult = async (keyword, condition, beforeSignature, options = {}) => {
    // Proceed as soon as the result area is visibly rendered and stable.
    await sleep(700);
    const started = Date.now();
    const timeoutMs = Number(options.timeoutMs || 20000);
    const returnPendingOnTimeout = options.returnPendingOnTimeout === true;
    const requireSignatureChanged = options.requireSignatureChanged === true;
    const minElapsedMs = Number(options.minElapsedMs || 0);
    let state = resultState();
    let stableSince = 0;
    let lastSignature = '';
    while (Date.now() - started < timeoutMs) {
      state = resultState();
      if (state.signature && state.signature === lastSignature) {
        if (!stableSince) stableSince = Date.now();
      } else {
        lastSignature = state.signature || '';
        stableSince = Date.now();
      }
      const stableMs = Date.now() - stableSince;
      const elapsedMs = Date.now() - started;
      const signatureChanged = Boolean(state.signature && state.signature !== beforeSignature);
      const sameResultSettled = stableMs >= 1800 && elapsedMs >= minElapsedMs;
      const stableEnough = signatureChanged ? stableMs >= 900 : sameResultSettled;
      if (state.rateLimitVisible || state.rateLimited) {
        mark('query_result_rate_limited_immediate_retry', { keyword, condition, elapsedMs, state });
        queryChangeBlockedUntil = Date.now() + 300;
        return { ok: false, error: 'ad_rank_rate_limited', state };
      }
      if (state.hasResultHeader && !state.loading && (state.rowCount > 0 || state.noResult) && elapsedMs >= minElapsedMs && stableEnough && (!requireSignatureChanged || signatureChanged)) {
        mark('query_result_ready', { keyword, condition, state, stableMs, elapsedMs, signatureChanged });
        queryChangeBlockedUntil = Date.now() + 3000;
        return { ok: true, state };
      }
      if (state.errorToast) {
        if (state.rateLimited) {
          mark('query_result_rate_limited_error_to_immediate_retry', { keyword, condition, elapsedMs, state });
          queryChangeBlockedUntil = Date.now() + 300;
          return { ok: false, error: 'ad_rank_rate_limited', state };
        }
        mark('query_result_error', { keyword, condition, state });
        queryChangeBlockedUntil = Date.now() + 60000;
        return { ok: false, error: 'query_result_error', state };
      }
      await sleep(600);
    }
    mark('query_result_timeout', { keyword, condition, state });
    queryChangeBlockedUntil = Date.now() + (returnPendingOnTimeout ? 300 : 60000);
    return { ok: false, error: returnPendingOnTimeout ? 'query_result_pending' : 'query_result_timeout', state };
  };
  const runQueryWithBackoff = async (keyword, condition) => {
    const maxQueryAttempts = 3;
    for (let attempt = 1; attempt <= maxQueryAttempts; attempt += 1) {
      if (!(await waitForRequestNoiseToSettle(`before_query_attempt_${attempt}`))) {
        throw new Error('ad_rank_rate_limited');
      }
      if (!(await waitForQueryReady())) throw new Error('query_button_not_ready');
      const beforeQueryState = resultState();
      if (!(await clickText(['조회하기'], 5000))) throw new Error('query_button_click_failed');
      queryChangeBlockedUntil = Date.now() + 20000;
      mark('query_clicked_guard_started', { keyword, condition, attempt, blocked_until_ms: queryChangeBlockedUntil });
      const queryReady = await waitForQueryResult(keyword, condition, beforeQueryState.signature);
      if (queryReady.ok) return queryReady;
      mark('query_attempt_failed', { keyword, condition, attempt, error: queryReady.error, state: queryReady.state });
      if (queryReady.error === 'ad_rank_rate_limited') {
        if (attempt < maxQueryAttempts) {
          mark('query_rate_limited_retry_same_condition_immediate', { keyword, condition, attempt });
          continue;
        }
        throw new Error('ad_rank_rate_limited');
      }
      if (queryReady.error === 'query_result_error') {
        await sleep(3000);
        continue;
      }
      if (attempt < maxQueryAttempts) {
        await sleep(3000);
        continue;
      }
      return queryReady;
    }
    return { ok: false, error: 'query_retry_exhausted', state: resultState() };
  };
  const placementControl = (placementText) => {
    const target = norm(placementText);
    const aliases = target.includes('통합검색모바일') ? ['네이버통합검색모바일', '통합검색모바일']
      : target.includes('통합검색PC') ? ['네이버통합검색PC', '통합검색PC']
      : target.includes('쇼핑검색모바일') ? ['네이버쇼핑검색모바일', '쇼핑검색모바일']
      : target.includes('쇼핑검색PC') ? ['네이버쇼핑검색PC', '쇼핑검색PC']
      : [target];
    const optionClickable = (el) => {
      const baseText = norm(textOf(el));
      const baseRect = el.getBoundingClientRect();
      const label = el.closest?.('label');
      if (label) return label;
      let cur = el;
      for (let i = 0; i < 6 && cur; i += 1) {
        const role = String(cur.getAttribute?.('role') || '').toLowerCase();
        const cls = String(cur.className || '');
        const curText = norm(textOf(cur));
        const rect = cur.getBoundingClientRect();
        const scoped =
          baseText &&
          curText.includes(baseText) &&
          curText.length <= baseText.length + 24 &&
          rect.width <= baseRect.width + 120 &&
          rect.height <= baseRect.height + 40;
        if (
          scoped &&
          (
            cur.querySelector?.('input[type="radio"],input[type="checkbox"]') ||
            role === 'radio' ||
            role === 'tab' ||
            role === 'button' ||
            /radio|checkbox|tab|button|btn|item|option/i.test(cls)
          )
        ) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return el.closest?.('[role="tab"],button,a,[role="button"],li') || el;
    };
    return all()
      .filter((el) => isVisible(el))
      .map((el) => {
        const text = norm(textOf(el) || el.getAttribute?.('aria-label') || el.getAttribute?.('title'));
        const matched = aliases.some((alias) => text === alias || (text.includes(alias) && text.length <= alias.length + 6));
        if (!matched) return null;
        const clickable = optionClickable(el);
        const rect = clickable.getBoundingClientRect();
        const role = String(clickable.getAttribute?.('role') || '').toLowerCase();
        const cls = String(clickable.className || '');
        const exactScore = aliases.some((alias) => text === alias) ? 1200 : 0;
        const score =
          exactScore +
          (role === 'tab' || /tab/i.test(cls) ? 320 : 0) +
          (/active|selected|on|checked/i.test(cls) ? 180 : 0) +
          (rect.width >= 70 && rect.width <= 360 && rect.height >= 24 && rect.height <= 90 ? 140 : 0) -
          Math.max(0, text.length - target.length);
        return { el: clickable, text, score, rect };
      })
      .filter(Boolean)
      .filter((x, idx, arr) => arr.findIndex((y) => y.el === x.el) === idx)
      .sort((a, b) => b.score - a.score)[0]?.el || null;
  };
  const controlInput = (control) => {
    if (!control) return null;
    if (control.matches?.('input[type="radio"],input[type="checkbox"]')) return control;
    const nested = control.querySelector?.('input[type="radio"],input[type="checkbox"]');
    if (nested) return nested;
    const forId = control.getAttribute?.('for');
    if (forId) {
      const byFor = document.getElementById(forId);
      if (byFor?.matches?.('input[type="radio"],input[type="checkbox"]')) return byFor;
    }
    return null;
  };
  const placementActiveByElement = (el) => {
    const directInput = controlInput(el);
    if (directInput) return Boolean(directInput.checked);
    const baseText = norm(textOf(el));
    const baseRect = el.getBoundingClientRect?.() || { width: 0, height: 0 };
    const chain = [];
    let cur = el;
    for (let i = 0; i < 5 && cur; i += 1) {
      chain.push(cur);
      cur = cur.parentElement;
    }
    return chain.some((node) => {
      if (node.matches?.('input[type="radio"],input[type="checkbox"]')) return Boolean(node.checked);
      const nodeText = norm(textOf(node));
      const rect = node.getBoundingClientRect?.() || { width: 0, height: 0 };
      const scoped =
        !baseText ||
        (
          nodeText.includes(baseText) &&
          nodeText.length <= baseText.length + 24 &&
          rect.width <= baseRect.width + 120 &&
          rect.height <= baseRect.height + 40
        );
      if (!scoped) return false;
      const cls = String(node.className || '');
      const ariaSelected = String(node.getAttribute?.('aria-selected') || '').toLowerCase();
      const ariaCurrent = String(node.getAttribute?.('aria-current') || '').toLowerCase();
      const pressed = String(node.getAttribute?.('aria-pressed') || '').toLowerCase();
      return ariaSelected === 'true' || ariaCurrent === 'true' || pressed === 'true' || /(^|[-_\s])(active|selected|on|checked)([-_\s]|$)/i.test(cls);
    });
  };
  const clickPlacementTab = async (placementText) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const control = placementControl(placementText);
      mark('placement_control', { placementText, attempt, found: Boolean(control), text: textOf(control).slice(0, 100), className: String(control?.className || '').slice(0, 160) });
      if (!control) {
        await sleep(500);
        continue;
      }
      if (placementActiveByElement(control)) {
        mark('placement_unchanged', { placementText });
        return { ok: true, changed: false };
      }
      const input = controlInput(control);
      mark('placement_click_prepare', { placementText, attempt, control_text: textOf(control).slice(0, 100), input_found: Boolean(input), input_checked: Boolean(input?.checked) });
      const clickTarget = input || control;
      const clickInfo = singleClick(clickTarget);
      await sleep(700);
      const refreshed = placementControl(placementText);
      const activeAfter = refreshed ? placementActiveByElement(refreshed) : false;
      mark('placement_clicked', { placementText, attempt, control_text: textOf(control).slice(0, 100), click_target: clickInfo, active_after: activeAfter });
      if (activeAfter) return { ok: true, changed: true };
      if (!input) {
        mark('placement_clicked_unverified_continue', { placementText, attempt, reason: 'no_input_state_to_verify' });
        return { ok: true, changed: true };
      }
      await sleep(700);
    }
    return { ok: false, changed: false };
  };
  const waitForPlacementReady = async (placementText) => {
    const target = norm(placementText);
    const started = Date.now();
    let state = resultState();
    while (Date.now() - started < 8000) {
      state = resultState();
      const active = all().some((el) => {
        if (!isVisible(el)) return false;
        const text = norm(textOf(el));
        if (text !== target) return false;
        const cls = String(el.className || '');
        const aria = String(el.getAttribute?.('aria-selected') || '').toLowerCase();
        return aria === 'true' || /active|selected|primary|checked/i.test(cls);
      });
      if (active && !state.loading && (state.rowCount > 0 || state.noResult || state.hasResultHeader)) {
        mark('placement_result_ready', { placementText, state });
        return true;
      }
      await sleep(400);
    }
    mark('placement_result_not_ready', { placementText, state });
    return false;
  };
  const waitForPlacementActive = async (placementText) => {
    const target = norm(placementText);
    const started = Date.now();
    while (Date.now() - started < 8000) {
      const control = placementControl(placementText);
      const active = control ? placementActiveByElement(control) : false;
      if (active) {
        mark('placement_active', { placementText });
        await sleep(900);
        return true;
      }
      await sleep(400);
    }
    mark('placement_not_active', { placementText });
    return false;
  };
  const placementLabel = (placement) => ({
    'mobile-search': '네이버 통합검색 모바일',
    'pc-search': '네이버 통합검색 PC',
    'mobile-shopping': '네이버 쇼핑검색 모바일',
    'pc-shopping': '네이버 쇼핑검색 PC',
  }[placement] || placement);
  const productIdFromUrl = (u) => {
    const m = String(u || '').match(/\/products\/(\d+)/);
    return m ? m[1] : '';
  };
  const compactMatchText = (value) => String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}%+]/gu, '');
  const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasExactCompactToken = (text, token) => {
    if (!token) return false;
    return new RegExp(`(^|[^0-9])${escapeRegExp(token)}($|[^0-9])`, 'u').test(text);
  };
  const productNameSignals = (name) => {
    const compact = compactMatchText(name);
    const stopWords = new Set(['헤나', '헤나염색', '천연', '염색약', '새치', '가루', '오일', '사용하면', '좋은', '헤어', '모발', '관리']);
    const terms = Array.from(String(name || '').matchAll(/[\p{L}\p{N}%+]+/gu))
      .map((m) => compactMatchText(m[0]))
      .filter((term) => term.length >= 2 && !/^\d/.test(term) && !stopWords.has(term));
    const quantities = Array.from(compact.matchAll(/\d+(?:개|회분|g|ml|%)?/gu)).map((m) => m[0]).filter((term) => term.length >= 2);
    return { compact, terms: Array.from(new Set(terms)), quantities: Array.from(new Set(quantities)) };
  };
  const packageCountOf = (value) => {
    const m = compactMatchText(value).match(/(\d+)(?:개|팩)/u);
    return m ? String(m[1]) : '';
  };
  const packageAliasesOf = (pack) => {
    const n = String(pack || '').trim();
    return n ? [`${n}개`, `${n}팩`].map(compactMatchText) : [];
  };
  const hasPackageAlias = (text, pack) => {
    const compact = compactMatchText(text);
    return packageAliasesOf(pack).some((token) => hasExactCompactToken(compact, token));
  };
  const rowHasProductImage = (row) => {
    const images = Array.isArray(row?.images) ? row.images : [];
    return images.some((img) => {
      const src = String(img?.src || '').trim();
      if (!src || /^data:/i.test(src) || /\.svg(?:$|\?)/i.test(src)) return false;
      const width = Number(img?.width || 0);
      const height = Number(img?.height || 0);
      return width >= 40 && height >= 40;
    });
  };
  const imageKeyOf = (value) => {
    const src = String(value || '').trim();
    if (!src || /^data:/i.test(src)) return '';
    try {
      const u = new URL(src, location.href);
      return decodeURIComponent(u.pathname || '').toLowerCase().replace(/\/+/g, '/');
    } catch (e) {
      return src.split('?')[0].toLowerCase();
    }
  };
  const rowImageMatchesProduct = (product, row) => {
    const productKey = imageKeyOf(product?.image_url || product?.imageUrl || '');
    if (!productKey) return false;
    const productTail = productKey.split('/').filter(Boolean).slice(-2).join('/');
    if (productTail.length < 12) return false;
    const images = Array.isArray(row?.images) ? row.images : [];
    return images.some((img) => {
      const rowKey = imageKeyOf(img?.src || '');
      if (!rowKey) return false;
      const rowTail = rowKey.split('/').filter(Boolean).slice(-2).join('/');
      return rowKey === productKey || rowKey.includes(productTail) || (rowTail.length >= 12 && productKey.includes(rowTail));
    });
  };
  const trackedBrandRequired = (name) => /수자타|더수자타|thesujata/u.test(String(name || ''));
  const rowHasTrackedBrand = (value) => /수자타|더수자타|thesujata/u.test(String(value || ''));
  const matchesProductNameByText = (name, rowText, row = null, product = null) => {
    const titleText = String(row?.title || rowText || '');
    const text = compactMatchText(titleText);
    if (!text) return false;
    const signals = productNameSignals(name || '');
    if (!signals.compact) return false;
    const productPack = packageCountOf(name);
    const rowPack = packageCountOf(titleText);
    if (trackedBrandRequired(name) && !rowHasTrackedBrand(titleText)) {
      return false;
    }
    if (trackedBrandRequired(name) && productPack && ['1', '2', '5', '11'].includes(productPack)) {
      if (!hasPackageAlias(titleText, productPack)) return false;
      // Naver Ads sometimes serves row thumbnails through a different image URL than product metadata.
      // Treat image equality as a positive signal, not a hard blocker; brand + exact pack count is the invariant.
      return true;
    }
    if (row?.starred) {
      return Boolean(productPack && rowPack && productPack === rowPack && /수자타|수자타헤나/u.test(titleText));
    }
    if (signals.compact.length >= 10 && (text === signals.compact || text.includes(signals.compact) || signals.compact.includes(text))) {
      return true;
    }
    if (signals.quantities.length && !signals.quantities.some((token) => hasExactCompactToken(text, token))) return false;
    let score = 0;
    for (const token of signals.terms) {
      if (text.includes(token)) score += Math.min(12, Math.max(3, token.length));
    }
    for (const token of signals.quantities) {
      if (hasExactCompactToken(text, token)) score += 10;
    }
    if (signals.compact.length >= 10 && text.includes(signals.compact.slice(0, Math.min(18, signals.compact.length)))) score += 14;
    return score >= 12;
  };
  const matchesProductByText = (product, rowText, row = null) => {
    const names = [product.name, ...(Array.isArray(product.match_names) ? product.match_names : []), product.mall_name]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    return Array.from(new Set(names)).some((name) => matchesProductNameByText(name, rowText, row, product));
  };
  const extractRanks = (products, keyword, condition) => {
    const productIds = products.map((p) => ({ ...p, product_id: productIdFromUrl(p.product_url) })).filter((p) => p.product_id);
    const rankLimit = Math.max(1, Math.min(Number(plan.rank_limit || 92) || 92, 92));
    const anchors = Array.from(document.querySelectorAll('a[href*="/products/"], a[href*="smartstore.naver.com"]'));
    const seen = new Set();
    const ranked = [];
    for (const a of anchors) {
      const href = String(a.href || a.getAttribute('href') || '');
      const pid = productIdFromUrl(href);
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      const container = a.closest('li,div,article') || a;
      const images = Array.from(container.querySelectorAll('img')).map((img) => {
        const rect = img.getBoundingClientRect();
        return { src: img.currentSrc || img.src || '', alt: img.alt || '', width: Math.round(rect.width || img.naturalWidth || 0), height: Math.round(rect.height || img.naturalHeight || 0) };
      });
      ranked.push({ product_id: pid, href, text: textOf(container).slice(0, 500), images });
      if (ranked.length >= rankLimit) break;
    }
    if (!ranked.length) {
      const rowElements = Array.from(document.querySelectorAll('table tbody tr, [role="row"]'))
        .filter((el) => isVisible(el) && norm(textOf(el)).length > 0);
      for (const rowEl of rowElements) {
        const cells = Array.from(rowEl.querySelectorAll('td,[role="cell"],th'));
        const titleCell = cells[3] || rowEl.querySelector('.font-weight-bold') || rowEl;
        const text = textOf(rowEl).slice(0, 800);
        if (!text) continue;
        const images = Array.from(rowEl.querySelectorAll('img')).map((img) => {
          const rect = img.getBoundingClientRect();
          return { src: img.currentSrc || img.src || '', alt: img.alt || '', width: Math.round(rect.width || img.naturalWidth || 0), height: Math.round(rect.height || img.naturalHeight || 0) };
        });
        ranked.push({ product_id: '', href: '', text, title: textOf(titleCell).slice(0, 400), starred: Boolean(rowEl.querySelector('i.fa-star,.fa.fa-star')), images });
        if (ranked.length >= rankLimit) break;
      }
      mark('rank_rows_text_fallback', { keyword, condition, row_count: ranked.length, sample: ranked.slice(0, 3).map((r, i) => `${i + 1}. ${r.text}`).join('\n').slice(0, 1200) });
    }
    return productIds.map((p) => {
      const idx = ranked.findIndex((r) => (r.product_id && r.product_id === p.product_id) || (!r.product_id && matchesProductByText(p, r.text, r)));
      const matched = idx >= 0 ? ranked[idx] : null;
      const hasStarSignal = Boolean(matched && Object.prototype.hasOwnProperty.call(matched, 'starred'));
      const adType = matched && hasStarSignal ? (matched.starred ? 'search_ad' : 'advoost') : null;
      return {
        date: new Date().toISOString().slice(0, 10),
        time_slot: 'daily',
        product_url: p.product_url,
        keyword,
        gender: condition.gender,
        age_band: condition.age_band,
        placement: condition.placement,
        visible: idx >= 0,
        rank: idx >= 0 ? idx + 1 : null,
        competitor_count_above: idx >= 0 ? idx : null,
        ad_type: adType,
        status: idx >= 0 ? 'success' : 'not_visible',
        page_url: location.href,
        raw_text_sample: ranked.map((r, i) => `${i + 1}. ${r.text}`).join('\n').slice(0, 6000),
      };
    });
  };
  const asArray = (value) => (Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]));
  const products = asArray(plan.products);
  const keywords = asArray(plan.keywords);
  const conditions = asArray(plan.conditions);
  const rows = [];
  if (!products.length || !keywords.length || !conditions.length) {
    return { ok: false, error: 'ad_rank_plan_empty', rows: [], stage_log: stageLog, via: 'naver_ads_exposure_status_cdp' };
  }
  if (/로그인|login/i.test(String(document.body?.innerText || ''))) {
    return { ok: false, error: 'login_required', human_action_required: true, human_action_reason: 'login_required', rows: [], page_url: location.href, stage_log: stageLog, via: 'naver_ads_exposure_status_cdp' };
  }
  const shoppingModeReady = await selectShoppingExposureMode();
  if (!shoppingModeReady) {
    return { ok: false, error: 'shopping_exposure_mode_not_ready', rows: [], page_url: location.href, stage_log: stageLog, via: 'naver_ads_exposure_status_cdp' };
  }
  for (const keyword of keywords) {
    for (const condition of conditions) {
      try {
        mark('condition_start', { keyword, condition });
        await waitForSafeConditionChange('before_condition_start');
        const keywordState = await setKeyword(keyword);
        if (!keywordState.ok) throw new Error('diagnosis_keyword_input_not_found');
        const ageState = await selectByLabel('연령', optionText('age', condition.age_band));
        if (!ageState.ok) throw new Error('age_select_failed');
        const genderState = await selectByLabel('성별', optionText('gender', condition.gender));
        if (!genderState.ok) throw new Error('gender_select_failed');
        const placementText = placementLabel(condition.placement);
        const demographicChanged = Boolean(keywordState.changed || ageState.changed || genderState.changed);
        let queryReady = null;
        const manualQueryAllowed = condition.manual_query_allowed !== false;
        if (manualQueryAllowed) {
          mark('manual_query_required', { keyword, condition, demographicChanged, placementText, manualQueryAllowed, reason: 'current_placement_first_in_sweep' });
          queryReady = await runQueryWithBackoff(keyword, condition);
        } else {
          await waitForSafeConditionChange('before_placement_tab_click');
          const beforePlacementState = resultState();
          const placementState = await clickPlacementTab(placementText);
          if (!placementState.ok) throw new Error('placement_tab_click_failed');
          if (!placementState.changed) {
            mark('placement_not_changed_before_auto_sweep', { keyword, condition, demographicChanged, placementText, manualQueryAllowed });
            throw new Error('placement_not_changed_before_auto_sweep');
          }
          // Changing the placement tab triggers Naver Ads to run the query automatically.
          // Do not click "조회하기" again here, or Naver shows the crowded request popup.
          queryChangeBlockedUntil = Date.now() + 20000;
          mark('placement_auto_query_wait', { keyword, condition, demographicChanged, placementText });
          queryReady = await waitForQueryResult(keyword, condition, beforePlacementState.signature, { timeoutMs: 12000, returnPendingOnTimeout: true, requireSignatureChanged: true });
          if (!queryReady.ok && ['query_result_pending', 'ad_rank_rate_limited', 'query_result_timeout', 'query_result_error'].includes(queryReady.error || '')) {
            mark('placement_auto_query_no_output_click_manual_query', { keyword, condition, error: queryReady.error, waited_ms: 12000 });
            queryReady = await runQueryWithBackoff(keyword, { ...condition, manual_query_allowed: true });
          }
        }
        if (!queryReady.ok) throw new Error(queryReady.error || 'query_result_not_ready');
        rows.push(...extractRanks(products, keyword, condition));
        mark('condition_done', { keyword, placement: condition.placement, total_rows: rows.length });
        mark('condition_advance_after_verified_result', { keyword, placement: condition.placement });
      } catch (e) {
        const msg = String(e?.message || e);
        for (const p of products) {
          rows.push({
            date: new Date().toISOString().slice(0, 10),
            time_slot: 'daily',
            product_url: p.product_url,
            keyword,
            gender: condition.gender,
            age_band: condition.age_band,
            placement: condition.placement,
            visible: false,
            rank: null,
            status: 'failed',
            error: msg,
            page_url: location.href,
          });
        }
        mark('condition_failed', { keyword, condition, error: msg });
        if (msg === 'ad_rank_rate_limited') {
          return { ok: false, error: msg, rows, rows_count: rows.length, product_count: products.length, keyword_count: keywords.length, condition_count: conditions.length, stage_log: stageLog, page_url: location.href, via: 'naver_ads_exposure_status_cdp' };
        }
      }
    }
  }
  return { ok: true, rows, rows_count: rows.length, product_count: products.length, keyword_count: keywords.length, condition_count: conditions.length, stage_log: stageLog, page_url: location.href, via: 'naver_ads_exposure_status_cdp' };
})()
'@
	$expression = $expression.Replace("__PLAN_JSON__", $planJson)
	if ($null -ne $Page) {
		return Invoke-CdpEvaluateOnPage -Page $Page -expression $expression -timeoutMs 240000
	}
	return Invoke-CdpEvaluate -port $port -expression $expression -timeoutMs 240000
}

function Invoke-CollectorJob([string]$ApiBaseUrl, [string]$BearerToken, [string]$DeviceId, $Job) {
	$jobId = [string]($Job.job_id ?? "")
	$urls = @($Job.urls)
	$mode = ([string]($Job.mode ?? "page_metrics")).Trim().ToLowerInvariant()
	if ([string]::IsNullOrWhiteSpace($jobId) -or $urls.Count -eq 0) { return }
	Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url "" -Status "CLAIMED" -Note "background_collector_claimed" -BearerToken $BearerToken | Out-Null
	if ($mode -eq "shopping_rank_mobile_organic_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		$url = [string]($urls[0] ?? "https://msearch.shopping.naver.com/search")
		$keywords = @()
		try { $keywords = @($Job.params.keywords) } catch { $keywords = @() }
		$rankLimit = 40
		try { $rankLimit = [int]($Job.params.rank_limit ?? 40) } catch { $rankLimit = 40 }
		if ($rankLimit -le 0 -or $rankLimit -gt 40) { $rankLimit = 40 }
		try {
			Write-BackgroundStatus @{ running = $true; state = "SCRAPING_MOBILE_ORGANIC_RANK"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; total = $keywords.Count; chromeProfileDir = $script:HostChromeProfileDir; chromeProfileLabel = $script:HostChromeProfileLabel }
			$chromeAction = Start-HostChrome -port $CdpPort -startUrl $url -profileDir $script:HostChromeProfileDir
			$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
			if (-not $ready) { throw "cdp_port_not_open" }
			$page = Ensure-CdpPageTarget -port $CdpPort -startUrl $url
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "SCRAPING" -Note ("mobile_organic_rank_home_start: profile={0}" -f $script:HostChromeProfileLabel) -BearerToken $BearerToken | Out-Null

			$allRows = New-Object 'System.Collections.Generic.List[object]'
			$allRankedItems = New-Object 'System.Collections.Generic.List[object]'
			$partialRows = New-Object 'System.Collections.Generic.List[object]'
			$partialRankedItems = New-Object 'System.Collections.Generic.List[object]'
			$partialFailed = 0
			$partialKeywordCount = 0
			$partialSaveBatchSize = 40
			$failed = 0
			$idx = 0
			foreach ($entry in $keywords) {
				if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
				$idx += 1
				$keyword = [string]($entry.keyword ?? "")
				$productUrls = @($entry.product_urls)
				if ([string]::IsNullOrWhiteSpace($keyword) -or $productUrls.Count -le 0) { continue }
				$keywordStartedAt = Get-Date
				Write-BackgroundStatus @{ running = $true; state = "SCRAPING_MOBILE_ORGANIC_RANK"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; progress = $idx; total = $keywords.Count; keyword = $keyword }
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "SCRAPING" -Note ("mobile_organic_keyword_start {0}/{1}: {2}" -f $idx, $keywords.Count, $keyword) -BearerToken $BearerToken | Out-Null
				try {
					$expectedKeywordLiteral = $keyword | ConvertTo-Json -Compress
					$searchUrl = "https://msearch.shopping.naver.com/search/all?query=" + [Uri]::EscapeDataString($keyword)
					Invoke-CdpNavigateOnPage -Page $page -url $searchUrl | Out-Null
					Start-Sleep -Milliseconds 800
					$resultReady = $null
					for ($waitTry = 0; $waitTry -lt 12; $waitTry++) {
						Start-Sleep -Milliseconds 350
						$resultReadyExpression = @'
(async () => {
  const expectedKeyword = __EXPECTED_KEYWORD__;
  const normalize = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const compact = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const url = String(location.href || '');
  const title = String(document.title || '');
  const text = compact(document.body?.innerText || '');
  const params = new URLSearchParams(location.search || '');
  const query = params.get('query') || params.get('oquery') || '';
  const queryMatches = normalize(query) === normalize(expectedKeyword);
  const isSearchUrl = /(^|\.)msearch\.shopping\.naver\.com$/i.test(location.hostname || '') && /\/search/i.test(location.pathname || '');
  const stillInputOverlay = /최근\s*검색어|검색어를\s*입력|상품명\s*또는\s*브랜드/i.test(text.slice(0, 500)) && !/쇼핑검색|상품\s*목록|검색결과/i.test(text.slice(0, 1500));
  const hasResultChrome = /쇼핑검색|상품\s*목록|검색결과|가격비교|네이버플러스/i.test(text.slice(0, 2500));
  const html = document.documentElement ? String(document.documentElement.innerHTML || '') : '';
  const hasCardData = /themeSource|purchaseConditionInfos|collection|adId|nvMid/i.test(html);
  const hasLoadedBody = text.length > 500 && !/페이지를\s*찾을\s*수\s*없|오류가\s*발생/i.test(text.slice(0, 1200));
  if (/보안\s*확인|자동입력|captcha|캡차|로봇이\s*아닙니다|접속이\s*제한|비정상적인\s*접근/i.test(text.slice(0, 2000))) {
    return { ok: false, fatal: true, reason: 'mobile_search_restricted_or_captcha', url, title, query, body_sample: text.slice(0, 600) };
  }
  const ready = isSearchUrl && queryMatches && !stillInputOverlay && (hasResultChrome || hasCardData || hasLoadedBody);
  return { ok: ready, waiting: !ready, url, title, query, expected_keyword: expectedKeyword, query_matches: queryMatches, is_search_url: isSearchUrl, still_input_overlay: stillInputOverlay, has_result_chrome: hasResultChrome, has_card_data: hasCardData, has_loaded_body: hasLoadedBody, body_sample: text.slice(0, 400) };
})()
'@
						$resultReadyExpression = $resultReadyExpression.Replace("__EXPECTED_KEYWORD__", $expectedKeywordLiteral)
						$resultReady = @(Invoke-CdpEvaluateOnPage -Page $page -expression $resultReadyExpression -timeoutMs 5000) | Select-Object -Last 1
						if ((Get-MetricValue $resultReady "fatal") -eq $true) { break }
						if ((Get-MetricValue $resultReady "ok") -eq $true) { break }
					}
					if ((Get-MetricValue $resultReady "ok") -ne $true) {
						$waitReason = [string](Get-MetricValue $resultReady "reason")
						if ([string]::IsNullOrWhiteSpace($waitReason)) { $waitReason = "mobile_search_result_not_ready" }
						$waitTitle = [string](Get-MetricValue $resultReady "title")
						$waitSample = ([string](Get-MetricValue $resultReady "body_sample")) -replace "\s+", " "
						if ($waitSample.Length -gt 180) { $waitSample = $waitSample.Substring(0, 180) }
						$waitExtra = ""
						if (-not [string]::IsNullOrWhiteSpace($waitTitle)) { $waitExtra += (" title={0}" -f $waitTitle) }
						if (-not [string]::IsNullOrWhiteSpace($waitSample)) { $waitExtra += (" sample={0}" -f $waitSample) }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url ([string](Get-MetricValue $resultReady "url")) -Status "FAILED" -Note ("mobile_organic_result_wait_failed {0}/{1}: {2} {3}{4}" -f $idx, $keywords.Count, $keyword, $waitReason, $waitExtra) -BearerToken $BearerToken | Out-Null
						throw $waitReason
					}
					Start-Sleep -Milliseconds 250
					$planJson = @{ keyword = $keyword; product_urls = @($productUrls); rank_limit = $rankLimit } | ConvertTo-Json -Depth 8 -Compress
					$planLiteral = $planJson | ConvertTo-Json -Compress
					$expression = @'
(async () => {
  const plan = JSON.parse(__PLAN_JSON__);
  const compact = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const pageText = compact(document.body?.innerText || '');
  if (/쇼핑\s*서비스\s*접속이\s*일시적으로\s*제한|접속이\s*제한|비정상적인\s*접근|보안\s*확인|자동입력|captcha|캡차|로봇이\s*아닙니다/i.test(pageText.slice(0, 2000))) {
    return { ok: false, fatal: true, error: 'mobile_search_restricted_or_captcha', page_url: location.href, title: document.title, body_sample: pageText.slice(0, 800) };
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const smoothScrollSearchResults = async () => {
    try {
      window.scrollBy({ top: 420, left: 0, behavior: 'smooth' });
      await sleep(280);
      window.scrollBy({ top: 760, left: 0, behavior: 'smooth' });
      await sleep(420);
    } catch (_) {
      try { window.scrollBy(0, 1180); } catch (_) {}
      await sleep(300);
    }
  };
  await smoothScrollSearchResults();
  const productIdFromUrl = (u) => {
    const m = String(u || '').match(/\/products\/(\d+)/);
    return m ? m[1] : '';
  };
  const productIds = new Map();
  (plan.product_urls || []).forEach((u) => {
    const id = productIdFromUrl(u);
    if (id) productIds.set(id, String(u || ''));
  });
  const allowedProductSpecs = new Map([
    ['4743750201', { itemId: '82288271914', productName: '새치 헤나 염색약 유기농 비건 천연 염색약 가루 1개' }],
    ['5897739461', { itemId: '83442238949', productName: '수자타 헤나 염색약 천연 염색약 가루 5개+호호바 오일' }],
    ['11043833896', { itemId: '88588340117', productName: '수자타 헤나 염색약 천연 염색약 가루 2개+호호바 오일' }],
    ['5532661755', { itemId: '83077157355', productName: '수자타 헤나 염색약 천연 염색약 가루 11개+호호바 오일' }],
    ['5787615984', { itemId: '83332115398', productName: '수자타 호호바오일 페이스 헤어 블랙헤드 냉압착 비정제 퓨어 100%' }],
    ['12874366496', { itemId: '90418877488', productName: '수자타 천연 허브 헤어팩 가루 100% 헤나염색 후 두피 모발 관리' }],
    ['9793965623', { itemId: '87338467896', productName: '수자타헤나 염색 후 사용하면 좋은 맥주효모 탈모 샴푸' }],
  ]);
  const targetItemIds = new Map();
  for (const [trackedId, trackedUrl] of productIds.entries()) {
    const spec = allowedProductSpecs.get(String(trackedId));
    if (spec && spec.itemId) targetItemIds.set(String(spec.itemId), { trackedId: String(trackedId), trackedUrl, spec });
  }
  const rankLimit = Math.max(1, Math.min(Number(plan.rank_limit || 40), 40));
  const blobs = [];
  document.querySelectorAll('script, script[type="application/json"]').forEach((s) => {
    const t = s.textContent || '';
    if (t.includes('themeSource') || t.includes('purchaseConditionInfos') || t.includes('"collection"') || t.includes('"adId"')) blobs.push(t);
  });
  blobs.push(document.documentElement ? document.documentElement.innerHTML || '' : '');
  try {
    const resourceUrls = Array.from(performance.getEntriesByType('resource') || [])
      .map((entry) => String(entry.name || ''))
      .filter((name) => /msearch\.shopping\.naver\.com/i.test(name) && /(?:\/api\/search\/all|\/search\/all|all\?)/i.test(name) && /[?&]query=/.test(name))
      .slice(-6);
    for (const resourceUrl of resourceUrls) {
      try {
        const resp = await fetch(resourceUrl, { credentials: 'include' });
        const text = await resp.text();
        if (text && (text.includes('themeSource') || text.includes('"collection"'))) blobs.push(text);
      } catch (_) {}
    }
  } catch (_) {}
  const combined = blobs.join('\n');
  const extractBalancedObjectAt = (text, open) => {
    if (text[open] !== '{') return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = open; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(open, i + 1);
      }
    }
    return null;
  };
  const collectLexicalItemsFromObject = (payload, out) => {
    const walk = (obj, depth = 0) => {
      if (!obj || depth > 14 || out.length > 500) return;
      if (Array.isArray(obj)) {
        for (const value of obj) walk(value, depth + 1);
        return;
      }
      if (typeof obj !== 'object') return;
      const item = obj.item && typeof obj.item === 'object' ? obj.item : obj;
      if (
        item
        && typeof item === 'object'
        && String(item.collection || '') === 'product'
        && String(item.themeSource || '') === 'lexical'
        && !item.adId
        && targetItemIds.has(String(item.id || ''))
      ) {
        out.push({ item, raw: JSON.stringify(item) });
      }
      for (const value of Object.values(obj)) walk(value, depth + 1);
    };
    walk(payload);
  };
  const lexicalItems = [];
  for (const blob of blobs) {
    try {
      const parsed = JSON.parse(blob);
      collectLexicalItemsFromObject(parsed, lexicalItems);
      continue;
    } catch (_) {}
    const itemKey = /"item"\s*:\s*\{/g;
    let match;
    while ((match = itemKey.exec(blob)) !== null && lexicalItems.length < 500) {
      const open = blob.indexOf('{', match.index + match[0].indexOf('{'));
      const raw = open >= 0 ? extractBalancedObjectAt(blob, open) : null;
      if (!raw) continue;
      try {
        const item = JSON.parse(raw);
        if (
          String(item.collection || '') === 'product'
          && String(item.themeSource || '') === 'lexical'
          && !item.adId
          && targetItemIds.has(String(item.id || ''))
        ) {
          lexicalItems.push({ item, raw });
        }
      } catch (_) {}
    }
  }
  const rankedByProductId = new Map();
  for (const entry of lexicalItems) {
    const item = entry.item || {};
    const itemId = String(item.id || '');
    const target = targetItemIds.get(itemId);
    if (!target) continue;
    const rankValue = Number(item.rank || 0);
    if (!Number.isFinite(rankValue) || rankValue <= 0 || rankValue > rankLimit) continue;
    const rank = rankValue;
    const rankedItem = {
      keyword: String(plan.keyword || ''),
      rank,
      product_id: target.trackedId,
      product_url: target.trackedUrl,
      tracked_product_id: target.trackedId,
      tracked_product_url: target.trackedUrl,
      channel_product_id: target.trackedId,
      original_mall_product_id: target.trackedId,
      matched_item_id: itemId,
      search_item_id: itemId,
      nv_mid: Number(itemId) || 0,
      product_title: compact(item.productTitle || item.productName || target.spec.productName || ''),
      mall_name: compact(item.mallName || item.channelName || ''),
      price: Number(item.price || item.lowPrice || item.salePrice || 0) || 0,
      purchase_cnt: Number(item.purchaseCnt || item.purchaseCount || item.buyCount || 0) || 0,
      image_url: String(item.imageUrl || item.image || item.thumbnailImageUrl || '') || null,
      collection: String(item.collection || ''),
      theme_source: String(item.themeSource || ''),
      card_type: 'LEXICAL_PRODUCT',
      source_type: 'MSEARCH',
      sas_type: null,
      card_json: entry.raw || JSON.stringify(item),
      rank_source: 'naver_msearch_lexical_product_top40'
    };
    const prev = rankedByProductId.get(target.trackedId);
    if (!prev || Number(rankedItem.rank || 0) < Number(prev.rank || 0)) rankedByProductId.set(target.trackedId, rankedItem);
  }
  const ranked = Array.from(rankedByProductId.values()).sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0)).slice(0, rankLimit);
  const rows = [];
  (plan.product_urls || []).forEach((u) => {
    const id = productIdFromUrl(u);
    const hit = ranked.find((x) => x.tracked_product_id === id);
    rows.push({
      keyword: String(plan.keyword || ''),
      product_url: String(u || ''),
      product_id: id,
      rank: hit ? Number(hit.rank || 0) : 0,
      matched_item_id: hit ? String(hit.matched_item_id || hit.search_item_id || '') : '',
      source: 'naver_msearch_lexical_product_top40'
    });
  });
  return {
    ok: true,
    rows,
    rows_count: rows.length,
    ranked_items: ranked,
    ranked_items_count: ranked.length,
    keyword: String(plan.keyword || ''),
    page_url: location.href,
    title: document.title,
    visible_count: rows.filter((r) => r.rank > 0).length,
    ranked_id_count: ranked.length,
    match_source: 'naver_msearch_lexical_item_id',
    via: 'shopping_rank_mobile_organic_cdp'
  };
})()
'@
					$expression = $expression.Replace("__PLAN_JSON__", $planLiteral)
					$metrics = @(Invoke-CdpEvaluateOnPage -Page $page -expression $expression -timeoutMs 60000) | Select-Object -Last 1
					if ((Get-MetricValue $metrics "ok") -ne $true) {
						$failed += 1
						$err = [string](Get-MetricValue $metrics "error")
						if ([string]::IsNullOrWhiteSpace($err)) { $err = "mobile_organic_rank_failed" }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note ("mobile_organic_keyword_failed {0}/{1}: {2} {3}" -f $idx, $keywords.Count, $keyword, $err) -BearerToken $BearerToken | Out-Null
						if ((Get-MetricValue $metrics "fatal") -eq $true) { break }
						continue
					}
					foreach ($row in @(Get-MetricValue $metrics "rows")) { $allRows.Add($row) | Out-Null }
					foreach ($rankedItem in @(Get-MetricValue $metrics "ranked_items")) { $allRankedItems.Add($rankedItem) | Out-Null }
					foreach ($row in @(Get-MetricValue $metrics "rows")) { $partialRows.Add($row) | Out-Null }
					foreach ($rankedItem in @(Get-MetricValue $metrics "ranked_items")) { $partialRankedItems.Add($rankedItem) | Out-Null }
					$partialKeywordCount += 1
					$rankedIdCount = [int](Get-MetricValue $metrics "ranked_id_count")
					$visibleCount = [int](Get-MetricValue $metrics "visible_count")
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url ([string](Get-MetricValue $metrics "page_url")) -Status "SCRAPING" -Note ("mobile_organic_keyword_done {0}/{1}: rows={2} visible={3} ranked={4}" -f $idx, $keywords.Count, @(Get-MetricValue $metrics "rows").Count, $visibleCount, $rankedIdCount) -BearerToken $BearerToken | Out-Null
					if ($partialKeywordCount -ge $partialSaveBatchSize) {
						$partialResult = @{
							url = $url
							ok = ($partialFailed -eq 0)
							metrics = @{
								rows = @($partialRows.ToArray())
								ranked_items = @($partialRankedItems.ToArray())
								rows_count = $partialRows.Count
								ranked_items_count = $partialRankedItems.Count
								failed_keywords = $partialFailed
								target_date = [string]($Job.target_date ?? "")
								via = "shopping_rank_mobile_organic_cdp"
								partial = $true
							}
							error = $(if ($partialFailed -gt 0) { "failed_keywords=$partialFailed" } else { $null })
						}
						Submit-CollectorPartialResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($partialResult) | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url ([string](Get-MetricValue $metrics "page_url")) -Status "SCRAPING" -Note ("mobile_organic_partial_saved: keywords={0} rows={1} ranked={2} failed={3}" -f $partialKeywordCount, $partialRows.Count, $partialRankedItems.Count, $partialFailed) -BearerToken $BearerToken | Out-Null
						$partialRows.Clear()
						$partialRankedItems.Clear()
						$partialFailed = 0
						$partialKeywordCount = 0
					}
				} catch {
					$failed += 1
					$partialFailed += 1
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note ("mobile_organic_keyword_error {0}/{1}: {2} {3}" -f $idx, $keywords.Count, $keyword, $_.Exception.Message) -BearerToken $BearerToken | Out-Null
				}
				try {
					$elapsedMs = [int](((Get-Date) - $keywordStartedAt).TotalMilliseconds)
					$targetMs = Get-Random -Minimum 6500 -Maximum 7501
					$remainingMs = [Math]::Max(0, $targetMs - $elapsedMs)
					if ($remainingMs -gt 0) {
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "SCRAPING" -Note ("mobile_organic_keyword_throttle {0}/{1}: elapsed_ms={2} sleep_ms={3}" -f $idx, $keywords.Count, $elapsedMs, $remainingMs) -BearerToken $BearerToken | Out-Null
						Start-Sleep -Milliseconds $remainingMs
					}
				} catch {}
			}
			if ($partialKeywordCount -gt 0 -or $partialRows.Count -gt 0 -or $partialRankedItems.Count -gt 0 -or $partialFailed -gt 0) {
				$partialResult = @{
					url = $url
					ok = ($partialFailed -eq 0)
					metrics = @{
						rows = @($partialRows.ToArray())
						ranked_items = @($partialRankedItems.ToArray())
						rows_count = $partialRows.Count
						ranked_items_count = $partialRankedItems.Count
						failed_keywords = $partialFailed
						target_date = [string]($Job.target_date ?? "")
						via = "shopping_rank_mobile_organic_cdp"
						partial = $true
					}
					error = $(if ($partialFailed -gt 0) { "failed_keywords=$partialFailed" } else { $null })
				}
				Submit-CollectorPartialResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($partialResult) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "SCRAPING" -Note ("mobile_organic_partial_saved_final: keywords={0} rows={1} ranked={2} failed={3}" -f $partialKeywordCount, $partialRows.Count, $partialRankedItems.Count, $partialFailed) -BearerToken $BearerToken | Out-Null
			}
			$collectedResults.Add(@{ url = $url; ok = ($failed -eq 0); metrics = @{ rows = @($allRows.ToArray()); ranked_items = @($allRankedItems.ToArray()); rows_count = $allRows.Count; ranked_items_count = $allRankedItems.Count; failed_keywords = $failed; target_date = [string]($Job.target_date ?? ""); via = "shopping_rank_mobile_organic_cdp" }; error = $(if ($failed -gt 0) { "failed_keywords=$failed" } else { $null }) }) | Out-Null
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status $(if ($failed -gt 0) { "FAILED" } else { "DONE" }) -Note ("mobile_organic_rank_collected: rows={0} ranked={1} failed={2}" -f $allRows.Count, $allRankedItems.Count, $failed) -BearerToken $BearerToken | Out-Null
		} catch {
			$msg = $_.Exception.Message
			$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = @{ error = $msg; via = "shopping_rank_mobile_organic_host_agent" } }) | Out-Null
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $msg -BearerToken $BearerToken | Out-Null
		}
		Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		return
	}
	if ($mode -eq "shopping_rank_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		$url = [string]($urls[0] ?? "https://www.naver.com")
		$keywords = @()
		try { $keywords = @($Job.params.keywords) } catch { $keywords = @() }
		$originalKeywordCount = $keywords.Count
		$shoppingRankSafetyKeywordLimit = 1
		if ($shoppingRankSafetyKeywordLimit -gt 0 -and $keywords.Count -gt $shoppingRankSafetyKeywordLimit) {
			$keywords = @($keywords | Select-Object -First $shoppingRankSafetyKeywordLimit)
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "INFO" -Note ("shopping_rank_safety_keyword_limit: {0}->{1}" -f $originalKeywordCount, $keywords.Count) -BearerToken $BearerToken | Out-Null
		}
		$rankLimit = 40
		try {
			if ($null -ne $Job.params -and $null -ne $Job.params.rank_limit) { $rankLimit = [int]$Job.params.rank_limit }
		} catch { $rankLimit = 40 }
				$allRows = New-Object 'System.Collections.Generic.List[object]'
		$allRankedItems = New-Object 'System.Collections.Generic.List[object]'
		$failed = 0
		$attempt = 0
		$done = $false
		while ($attempt -lt 3 -and -not $done) {
			$attempt += 1
			try {
				Write-BackgroundStatus @{ running = $true; state = "SCRAPING_SHOPPING_RANK"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; attempt = $attempt; total = $keywords.Count; chromeProfileDir = $script:HostChromeProfileDir; chromeProfileLabel = $script:HostChromeProfileLabel }
				$startUrl = $url
				$chromeAction = Start-HostChrome -port $CdpPort -startUrl $startUrl -profileDir $script:HostChromeProfileDir
				$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
				if (-not $ready) { throw "cdp_port_not_open" }
				$page = Ensure-CdpPageTarget -port $CdpPort -startUrl $startUrl
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $startUrl -Status "SCRAPING" -Note ("shopping_rank_shopping_home_start: profile={0}" -f $script:HostChromeProfileLabel) -BearerToken $BearerToken | Out-Null
				if ($false -and $keywords.Count -gt 0) {
					$entryKeyword = [string]($keywords[0].keyword ?? "")
					if (-not [string]::IsNullOrWhiteSpace($entryKeyword)) {
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url "https://www.naver.com" -Status "SCRAPING" -Note ("shopping_rank_naver_entry_start: {0}" -f $entryKeyword) -BearerToken $BearerToken | Out-Null
						Invoke-CdpNavigateOnPage -Page $page -url "https://www.naver.com"
						Start-Sleep -Seconds 3
						$entrySearchExpression = @'
(() => {
  const compact = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 40 && r.height > 12;
  };
  const hit = Array.from(document.querySelectorAll('input, textarea')).filter(visible).map((el) => {
    const text = compact([el.getAttribute('title'), el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.name, el.id, el.className].join(' '));
    const r = el.getBoundingClientRect();
    let score = 0;
    if (/검색|query|search/i.test(text)) score += 1000;
    if (r.top < window.innerHeight * 0.35) score += 100;
    return { el, score };
  }).sort((a, b) => b.score - a.score)[0];
  if (!hit) return { ok: false, reason: 'naver_search_input_not_found', page_url: location.href, title: document.title };
  const input = hit.el;
  const r = input.getBoundingClientRect();
  return { ok: true, action: 'naver_search_input_found', x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, page_url: location.href, title: document.title };
})()
'@
						$entrySearch = @(Invoke-CdpEvaluateOnPage -Page $page -expression $entrySearchExpression -timeoutMs 10000) | Select-Object -Last 1
						if ((Get-MetricValue $entrySearch "ok") -ne $true) { throw ([string](Get-MetricValue $entrySearch "reason")) }
						Invoke-CdpTrustedMouseClick -port $CdpPort -X ([double](Get-MetricValue $entrySearch "x")) -Y ([double](Get-MetricValue $entrySearch "y"))
						Start-Sleep -Milliseconds 180
						Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyDown"; key = "Control"; code = "ControlLeft"; windowsVirtualKeyCode = 17; nativeVirtualKeyCode = 17; modifiers = 2 } -id 9381 -timeoutMs 5000 | Out-Null
						Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyDown"; key = "a"; code = "KeyA"; windowsVirtualKeyCode = 65; nativeVirtualKeyCode = 65; modifiers = 2 } -id 9382 -timeoutMs 5000 | Out-Null
						Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyUp"; key = "a"; code = "KeyA"; windowsVirtualKeyCode = 65; nativeVirtualKeyCode = 65; modifiers = 2 } -id 9383 -timeoutMs 5000 | Out-Null
						Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyUp"; key = "Control"; code = "ControlLeft"; windowsVirtualKeyCode = 17; nativeVirtualKeyCode = 17; modifiers = 0 } -id 9384 -timeoutMs 5000 | Out-Null
						Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyDown"; key = "Backspace"; code = "Backspace"; windowsVirtualKeyCode = 8; nativeVirtualKeyCode = 8 } -id 9385 -timeoutMs 5000 | Out-Null
						Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyUp"; key = "Backspace"; code = "Backspace"; windowsVirtualKeyCode = 8; nativeVirtualKeyCode = 8 } -id 9386 -timeoutMs 5000 | Out-Null
						Invoke-CdpPageCommand -port $CdpPort -method "Input.insertText" -params @{ text = $entryKeyword } -id 9387 -timeoutMs 5000 | Out-Null
						Start-Sleep -Milliseconds 350
						$entrySubmit = @(Invoke-CdpEvaluateOnPage -Page $page -expression @'
(() => {
  const compact = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 10 && r.height > 10;
  };
  const active = document.activeElement;
  const form = active && active.closest ? active.closest('form') : null;
  const controls = Array.from((form || document).querySelectorAll('button, input[type="submit"], a, [role="button"]')).filter(visible);
  const hit = controls.find((el) => /검색|search/i.test(compact([el.innerText, el.textContent, el.value, el.title, el.getAttribute('aria-label'), el.id, el.className].join(' '))))
    || controls.find((el) => /btn|search/i.test(String(el.id || '') + ' ' + String(el.className || '')))
    || controls[0];
  if (!hit) return { ok: false, reason: 'naver_search_submit_button_not_found', page_url: location.href, title: document.title };
  try { hit.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
  const r = hit.getBoundingClientRect();
  return { ok: true, action: 'naver_search_submit_button_found', x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, page_url: location.href, title: document.title };
})()
'@ -timeoutMs 10000) | Select-Object -Last 1
						if ((Get-MetricValue $entrySubmit "ok") -eq $true) {
							Invoke-CdpTrustedMouseClick -port $CdpPort -X ([double](Get-MetricValue $entrySubmit "x")) -Y ([double](Get-MetricValue $entrySubmit "y"))
						} else {
							Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url "https://www.naver.com" -Status "RETRYING" -Note ([string](Get-MetricValue $entrySubmit "reason")) -BearerToken $BearerToken | Out-Null
							Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "rawKeyDown"; key = "Enter"; code = "Enter"; windowsVirtualKeyCode = 13; nativeVirtualKeyCode = 13 } -id 9388 -timeoutMs 5000 | Out-Null
							Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyUp"; key = "Enter"; code = "Enter"; windowsVirtualKeyCode = 13; nativeVirtualKeyCode = 13 } -id 9389 -timeoutMs 5000 | Out-Null
						}
						Start-Sleep -Seconds 5
						$entryAfterSubmit = @(Invoke-CdpEvaluateOnPage -Page $page -expression @'
(() => {
  const compact = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const url = String(location.href || '');
  const title = String(document.title || '');
  const body = compact(document.body?.innerText || '').slice(0, 800);
  const stillMain = /(^|\.)naver\.com$/i.test(location.hostname) && !/search/i.test(url);
  return { ok: !stillMain, url, title, body_sample: body };
})()
'@ -timeoutMs 5000) | Select-Object -Last 1
						if ((Get-MetricValue $entryAfterSubmit "ok") -ne $true) {
							$bodySample = [string](Get-MetricValue $entryAfterSubmit "body_sample")
							Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url ([string](Get-MetricValue $entryAfterSubmit "url")) -Status "FAILED" -Note ("naver_main_search_submit_failed: {0}" -f $bodySample.Substring(0, [Math]::Min(180, $bodySample.Length))) -BearerToken $BearerToken | Out-Null
							throw "naver_main_search_submit_failed"
						}
						$moreLink = @(Invoke-CdpEvaluateOnPage -Page $page -expression @'
(() => {
  const compact = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 30 && r.height > 10;
  };
  const controls = Array.from(document.querySelectorAll('a, button, [role="button"]')).filter(visible);
  const hit = controls.find((el) => /네이버\s*가격비교\s*더보기|가격비교\s*더보기/i.test(compact(el.innerText || el.textContent || el.getAttribute('aria-label') || '')))
    || controls.find((el) => /search\.shopping\.naver\.com\/search\/all/i.test(String(el.href || el.getAttribute('href') || '')));
  if (!hit) {
    return {
      ok: false,
      reason: 'naver_price_compare_more_not_found',
      page_url: location.href,
      title: document.title,
      body_sample: compact(document.body?.innerText || '').slice(0, 800),
    };
  }
  try { hit.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
  const href = String(hit.href || hit.getAttribute('href') || '');
  const r = hit.getBoundingClientRect();
  return { ok: true, action: 'naver_price_compare_more_found', href, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, page_url: location.href };
})()
'@ -timeoutMs 10000) | Select-Object -Last 1
						if ((Get-MetricValue $moreLink "ok") -ne $true) { throw ([string](Get-MetricValue $moreLink "reason")) }
						Invoke-CdpTrustedMouseClick -port $CdpPort -X ([double](Get-MetricValue $moreLink "x")) -Y ([double](Get-MetricValue $moreLink "y"))
						Start-Sleep -Seconds 5
						$tokenDiag = @(Invoke-CdpEvaluateOnPage -Page $page -expression @'
(() => {
  const keys = (store) => {
    try { return Array.from({ length: store.length }, (_, i) => store.key(i)).filter(Boolean).slice(0, 20); } catch (e) { return ['ERR:' + e.message]; }
  };
  const cookieNames = String(document.cookie || '').split(';').map((x) => x.trim().split('=')[0]).filter(Boolean).slice(0, 20);
  return {
    ok: true,
    url: location.href,
    title: document.title,
    cookie_names: cookieNames,
    local_storage_keys: keys(localStorage),
    session_storage_keys: keys(sessionStorage),
    webdriver: navigator.webdriver === true,
  };
})()
'@ -timeoutMs 5000) | Select-Object -Last 1
						$diagCookieNames = @((Get-MetricValue $tokenDiag "cookie_names") | Select-Object -First 8)
						$diagLocalKeys = @((Get-MetricValue $tokenDiag "local_storage_keys") | Select-Object -First 8)
						$diagSessionKeys = @((Get-MetricValue $tokenDiag "session_storage_keys") | Select-Object -First 8)
						$diagWebdriver = [string](Get-MetricValue $tokenDiag "webdriver")
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url ([string](Get-MetricValue $tokenDiag "url")) -Status "SCRAPING" -Note ("shopping_rank_browser_token_keys: cookies={0} local={1} session={2} webdriver={3}" -f ($diagCookieNames -join "|"), ($diagLocalKeys -join "|"), ($diagSessionKeys -join "|"), $diagWebdriver) -BearerToken $BearerToken | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url "https://www.naver.com" -Status "SCRAPING" -Note "shopping_rank_naver_entry_done" -BearerToken $BearerToken | Out-Null
					}
				}
				$pageReady = $false
				for ($readyAttempt = 1; $readyAttempt -le 30; $readyAttempt += 1) {
					$readyState = @(Invoke-CdpEvaluateOnPage -Page $page -expression @'
(() => {
  const visible = (el) => { const s=getComputedStyle(el); const r=el.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && r.width>20 && r.height>10; };
  const compact = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).filter(visible);
  const hasSearchInput = inputs.some((el) => /검색|상품|브랜드|입력|query|search/i.test(compact([el.getAttribute('placeholder'), el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('name'), el.id, el.className].join(' '))));
  return { ok: hasSearchInput, input_count: inputs.length, page_url: location.href, title: document.title };
})()
'@ -timeoutMs 5000) | Select-Object -Last 1
					if ((Get-MetricValue $readyState "ok") -eq $true) {
						$pageReady = $true
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "SCRAPING" -Note ("shopping_rank_page_ready: {0}s" -f $readyAttempt) -BearerToken $BearerToken | Out-Null
						break
					}
					Start-Sleep -Seconds 1
				}
				if (-not $pageReady) {
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "shopping_rank_page_ready_timeout_after_30s" -BearerToken $BearerToken | Out-Null
				}
				$idx = 0
				$fatalShoppingError = $null
				$shoppingRankDelayMinSec = 6
				$shoppingRankDelayMaxSec = 7
				$shoppingRankBatchSize = 50
				$shoppingRankBatchPauseMinSec = 60
				$shoppingRankBatchPauseMaxSec = 120
				foreach ($entry in $keywords) {
					if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
					if (-not [string]::IsNullOrWhiteSpace($fatalShoppingError)) { break }
					$idx += 1
					$keyword = [string]($entry.keyword ?? "")
					$productUrls = @($entry.product_urls)
					if ([string]::IsNullOrWhiteSpace($keyword) -or $productUrls.Count -le 0) { continue }
					Write-BackgroundStatus @{ running = $true; state = "SCRAPING_SHOPPING_RANK"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; attempt = $attempt; progress = $idx; total = $keywords.Count; keyword = $keyword }
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "SCRAPING" -Note ("shopping_rank_keyword_start {0}/{1}: {2}" -f $idx, $keywords.Count, $keyword) -BearerToken $BearerToken | Out-Null
					try {
					$inputHit = @(Invoke-CdpEvaluateOnPage -Page $page -expression @'
(() => {
  window.scrollTo(0, 0);
  const visible = (el) => { const s=getComputedStyle(el); const r=el.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && r.width>20 && r.height>10; };
  const compact = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const pageText = compact(document.body?.innerText || '');
  if (/nid\.naver\.com|login/i.test(location.href) || /NAVER\s*로그인|로그인\s*상태\s*유지|아이디|비밀번호/i.test(pageText.slice(0, 2000))) {
    return { ok: false, reason: 'naver_login_required', human_action_required: true, page_url: location.href, title: document.title, body_sample: pageText.slice(0, 800) };
  }
  if (/보안\s*확인|자동입력|captcha|캡차|로봇이\s*아닙니다/i.test(pageText.slice(0, 2000))) {
    return { ok: false, reason: 'shopping_rank_human_verification_required', human_action_required: true, page_url: location.href, title: document.title, body_sample: pageText.slice(0, 800) };
  }
  if (/쇼핑\s*서비스\s*접속이\s*일시적으로\s*제한|쇼핑서비스접속이일시적으로제한|짧은\s*시간\s*내\s*너무\s*많은\s*요청|비정상적인\s*접근/i.test(pageText.slice(0, 2000))) {
    return { ok: false, reason: 'shopping_service_restricted', fatal: true, page_url: location.href, title: document.title, body_sample: pageText.slice(0, 800) };
  }
  const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).filter(visible);
  const hit = inputs.map((el) => {
    const r = el.getBoundingClientRect();
    const t = compact([el.getAttribute('placeholder'), el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('name'), el.id, el.className].join(' '));
    let score = 0;
    if (/검색|상품|브랜드|입력|query|search/i.test(t)) score += 1000;
    if (r.top < window.innerHeight * 0.45) score += 200;
    if (r.width > 180) score += 100;
    return { el, score, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, text: t };
  }).sort((a, b) => b.score - a.score)[0];
  if (!hit) return { ok: false, reason: 'shopping_search_input_not_found', input_count: inputs.length, page_url: location.href, title: document.title };
  hit.el.focus();
  return { ok: true, x: hit.x, y: hit.y, text: hit.text, page_url: location.href, title: document.title };
})()
'@ -timeoutMs 10000) | Select-Object -Last 1
					if ((Get-MetricValue $inputHit "ok") -ne $true) {
						$inputReason = [string](Get-MetricValue $inputHit "reason")
						if ([string]::IsNullOrWhiteSpace($inputReason)) { $inputReason = "shopping_search_input_not_found" }
						if ((Get-MetricValue $inputHit "human_action_required") -eq $true -or $inputReason -match "login_required|naver_login_required|captcha|security|human_verification|보안|캡차|자동입력|로봇|로그인|아이디|비밀번호") {
							Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $inputReason; attempt = $attempt; progress = $idx; total = $keywords.Count }
							Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "HUMAN_ACTION_REQUIRED" -Note $inputReason -BearerToken $BearerToken | Out-Null
							if (-not (Wait-HostChromeHumanActionOrCancel -port $CdpPort -TimeoutSec 86400 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url -Reason $inputReason)) { return }
							Hide-HostChrome -port $CdpPort | Out-Null
							$inputHit = @(Invoke-CdpEvaluateOnPage -Page $page -expression @'
(() => {
  window.scrollTo(0, 0);
  const visible = (el) => { const s=getComputedStyle(el); const r=el.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && r.width>20 && r.height>10; };
  const compact = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const pageText = compact(document.body?.innerText || '');
  if (/nid\.naver\.com|login/i.test(location.href) || /NAVER\s*로그인|로그인\s*상태\s*유지|아이디|비밀번호/i.test(pageText.slice(0, 2000))) {
    return { ok: false, reason: 'naver_login_required', human_action_required: true, page_url: location.href, title: document.title, body_sample: pageText.slice(0, 800) };
  }
  const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).filter(visible);
  const hit = inputs.map((el) => {
    const r = el.getBoundingClientRect();
    const t = compact([el.getAttribute('placeholder'), el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('name'), el.id, el.className].join(' '));
    let score = 0;
    if (/검색|상품|브랜드|입력|query|search/i.test(t)) score += 1000;
    if (r.top < window.innerHeight * 0.45) score += 200;
    if (r.width > 180) score += 100;
    return { el, score, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, text: t };
  }).sort((a, b) => b.score - a.score)[0];
  if (!hit) return { ok: false, reason: 'shopping_search_input_not_found', input_count: inputs.length, page_url: location.href, title: document.title };
  hit.el.focus();
  return { ok: true, x: hit.x, y: hit.y, text: hit.text, page_url: location.href, title: document.title };
})()
'@ -timeoutMs 10000) | Select-Object -Last 1
							$inputReason = [string](Get-MetricValue $inputHit "reason")
						}
						if ((Get-MetricValue $inputHit "ok") -ne $true) {
							if ([string]::IsNullOrWhiteSpace($inputReason)) { $inputReason = "shopping_search_input_not_found" }
							if ((Get-MetricValue $inputHit "fatal") -eq $true -or $inputReason -match "mobile_search_restricted_or_captcha|shopping_service_restricted|shopping_access_limited|http_403|http_418|http_429|captcha|security|보안|제한|비정상") {
								$fatalShoppingError = $inputReason
								Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note ("shopping_rank_fatal_input {0}/{1}: {2} {3}" -f $idx, $keywords.Count, $keyword, $inputReason) -BearerToken $BearerToken | Out-Null
								break
							}
							throw $inputReason
						}
					}
					$inputPageUrl = [string](Get-MetricValue $inputHit "page_url")
					$inputTitle = [string](Get-MetricValue $inputHit "title")
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $inputPageUrl -Status "SCRAPING" -Note ("shopping_rank_input_ready {0}/{1}: {2} title={3}" -f $idx, $keywords.Count, $keyword, $inputTitle) -BearerToken $BearerToken | Out-Null
					try {
						Invoke-CdpTrustedMouseClick -port $CdpPort -X ([double](Get-MetricValue $inputHit "x")) -Y ([double](Get-MetricValue $inputHit "y"))
					} catch {
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("shopping_rank_mouse_click_fallback {0}/{1}: {2}" -f $idx, $keywords.Count, $_.Exception.Message) -BearerToken $BearerToken | Out-Null
					}
					Start-Sleep -Milliseconds 150
					Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyDown"; key = "Control"; code = "ControlLeft"; windowsVirtualKeyCode = 17; nativeVirtualKeyCode = 17; modifiers = 2 } -id 9401 -timeoutMs 5000 | Out-Null
					Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyDown"; key = "a"; code = "KeyA"; windowsVirtualKeyCode = 65; nativeVirtualKeyCode = 65; modifiers = 2 } -id 9402 -timeoutMs 5000 | Out-Null
					Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyUp"; key = "a"; code = "KeyA"; windowsVirtualKeyCode = 65; nativeVirtualKeyCode = 65; modifiers = 2 } -id 9403 -timeoutMs 5000 | Out-Null
					Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyUp"; key = "Control"; code = "ControlLeft"; windowsVirtualKeyCode = 17; nativeVirtualKeyCode = 17; modifiers = 0 } -id 9404 -timeoutMs 5000 | Out-Null
					Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyDown"; key = "Backspace"; code = "Backspace"; windowsVirtualKeyCode = 8; nativeVirtualKeyCode = 8 } -id 9405 -timeoutMs 5000 | Out-Null
					Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyUp"; key = "Backspace"; code = "Backspace"; windowsVirtualKeyCode = 8; nativeVirtualKeyCode = 8 } -id 9406 -timeoutMs 5000 | Out-Null
					Invoke-CdpPageCommand -port $CdpPort -method "Input.insertText" -params @{ text = $keyword } -id 9407 -timeoutMs 5000 | Out-Null
					Start-Sleep -Milliseconds 250
					Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "rawKeyDown"; key = "Enter"; code = "Enter"; windowsVirtualKeyCode = 13; nativeVirtualKeyCode = 13 } -id 9408 -timeoutMs 5000 | Out-Null
					Invoke-CdpPageCommand -port $CdpPort -method "Input.dispatchKeyEvent" -params @{ type = "keyUp"; key = "Enter"; code = "Enter"; windowsVirtualKeyCode = 13; nativeVirtualKeyCode = 13 } -id 9409 -timeoutMs 5000 | Out-Null
					Start-Sleep -Seconds 3
					$postSearchGuard = @(Invoke-CdpEvaluateOnPage -Page $page -expression @'
(() => {
  const compact = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const text = compact(document.body?.innerText || '');
  const sample = text.slice(0, 1000);
  if (/쇼핑\s*서비스\s*접속이\s*일시적으로\s*제한|쇼핑서비스접속이일시적으로제한|짧은\s*시간\s*내\s*너무\s*많은\s*요청|비정상적인\s*접근|자동입력|captcha|캡차|로봇이\s*아닙니다/i.test(sample)) {
    return { ok: false, reason: 'shopping_service_restricted_after_search', page_url: location.href, title: document.title, body_sample: sample };
  }
  return { ok: true, page_url: location.href, title: document.title, body_sample: sample };
})()
'@ -timeoutMs 10000) | Select-Object -Last 1
					if ((Get-MetricValue $postSearchGuard "ok") -ne $true) {
						$inputPageUrl = [string](Get-MetricValue $postSearchGuard "page_url")
						$inputTitle = [string](Get-MetricValue $postSearchGuard "title")
						$fatalShoppingError = [string](Get-MetricValue $postSearchGuard "reason")
						if ([string]::IsNullOrWhiteSpace($fatalShoppingError)) { $fatalShoppingError = "shopping_service_restricted_after_search" }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $inputPageUrl -Status "FAILED" -Note ("shopping_rank_post_search_restricted {0}/{1}: {2} title={3}" -f $idx, $keywords.Count, $keyword, $inputTitle) -BearerToken $BearerToken | Out-Null
						break
					}
					$planJson = @{ keyword = $keyword; product_urls = @($productUrls); rank_limit = $rankLimit; skip_search = $true } | ConvertTo-Json -Depth 8 -Compress
					$planLiteral = $planJson | ConvertTo-Json -Compress
					$expression = @'
(async () => {
  const plan = JSON.parse(__PLAN_JSON__);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const compact = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const trackedIdOf = (url) => {
    const m = String(url || '').match(/\/products\/(\d+)/);
    return m ? m[1] : '';
  };
  const mainProductIdOf = (url) => {
    const m = String(url || '').match(/smartstore\.naver\.com\/main\/products\/(\d+)/i);
    return m ? m[1] : '';
  };
  const productUrls = Array.isArray(plan.product_urls) ? plan.product_urls.map(String) : [];
  const productIds = new Map(productUrls.map((u) => [trackedIdOf(u), u]).filter(([id]) => !!id));
  const rows = productUrls.map((u) => ({ product_url: u, keyword: String(plan.keyword || ''), rank: 0, status: 'not_visible' }));
  const restrictedPattern = /쇼핑\s*서비스\s*접속이\s*일시적으로\s*제한|쇼핑서비스접속이일시적으로제한|짧은\s*시간\s*내\s*너무\s*많은\s*요청|비정상적인\s*접근|보안\s*확인|captcha|캡차/i;
  const humanVerifyPattern = /보안\s*확인|자동입력|captcha|캡차|로봇이\s*아닙니다/i;
  const restrictedResult = (stage) => {
    const body = compact(document.body?.innerText || '').slice(0, 2000);
    const human = humanVerifyPattern.test(body);
    return {
      ok: false,
      fatal: !human,
      human_action_required: human,
      error: human ? 'shopping_rank_human_verification_required' : 'shopping_service_restricted',
      stage,
      rows,
      page_url: location.href,
      title: document.title,
      body_sample: body.slice(0, 800),
    };
  };
  const setRank = (productUrl, rank) => {
    const row = rows.find((x) => x.product_url === productUrl);
    if (row && (!row.rank || row.rank <= 0 || rank < row.rank)) {
      row.rank = rank;
      row.status = 'ok';
    }
  };
  if (!plan.skip_search && !/search\.shopping\.naver\.com/i.test(location.hostname)) {
    location.href = 'https://search.shopping.naver.com/home';
    await sleep(4000);
  }
  if (restrictedPattern.test(compact(document.body?.innerText || '').slice(0, 2000))) {
    return restrictedResult('before_keyword_search');
  }
  if (!plan.skip_search) {
  let input = Array.from(document.querySelectorAll('input')).find((el) => {
    const p = compact(el.getAttribute('placeholder'));
    const t = compact(el.getAttribute('title'));
    const n = compact(el.getAttribute('name'));
    return /상품|브랜드|검색|입력|query/i.test(p + ' ' + t + ' ' + n);
  }) || document.querySelector('input[type="search"], input[name="query"], input');
  if (!input) return { ok: false, error: 'shopping_search_input_not_found', rows, page_url: location.href, title: document.title, body_sample: compact(document.body?.innerText || '').slice(0, 800) };
  input.focus();
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.value = String(plan.keyword || '');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(plan.keyword || '') }));
  await sleep(250);
  const form = input.closest('form');
  if (form && typeof form.requestSubmit === 'function') {
    form.requestSubmit();
  } else {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }
  await sleep(3000);
  }
  const blockedText = compact(document.body?.innerText || '');
  if (restrictedPattern.test(blockedText.slice(0, 2000))) {
    return restrictedResult('after_keyword_search');
  }

  const isAdItem = (raw) => {
    if (!raw || typeof raw !== 'object') return false;
    if (raw.adId || raw.adType || raw.adProductName || raw.adsrTypeCd) return true;
    const text = compact([raw.productTitle, raw.productName, raw.title, raw.name, raw.adProductName].join(' '));
    return /(^|\s)광고(\s|$)|AD\s*상품|파워링크/i.test(text);
  };

  const collectCompositeItems = (payload) => {
    const out = [];
    const walk = (obj, depth = 0) => {
      if (!obj || depth > 10 || out.length > 300) return;
      if (Array.isArray(obj)) {
        for (const v of obj) walk(v, depth + 1);
        return;
      }
      if (typeof obj !== 'object') return;
      const composite = obj.compositeList;
      if (composite && typeof composite === 'object' && Array.isArray(composite.list)) {
        for (const row of composite.list) {
          const raw = row && typeof row === 'object' && row.item ? row.item : row;
          if (raw && typeof raw === 'object') out.push(raw);
        }
      }
      for (const v of Object.values(obj)) walk(v, depth + 1);
    };
    walk(payload);
    return out;
  };

  const collectMainProductItems = (payload) => {
    const out = [];
    const seen = new Set();
    const walk = (obj, depth = 0) => {
      if (!obj || depth > 12 || out.length > 400) return;
      if (Array.isArray(obj)) {
        for (const v of obj) walk(v, depth + 1);
        return;
      }
      if (typeof obj !== 'object') return;
      const urls = [obj.mallProductUrl, obj.mallPcUrl, obj.productUrl, obj.link, obj.url]
        .map((v) => String(v || ''))
        .filter(Boolean);
      for (const u of urls) {
        const id = mainProductIdOf(u);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, url: u, raw: obj });
        break;
      }
      for (const v of Object.values(obj)) walk(v, depth + 1);
    };
    walk(payload);
    return out;
  };

  const toRankedItem = (item, rank) => {
    const id = String(item.id || '');
    const url0 = String(item.url || '');
    const url = /smartstore\.naver\.com\/main\/products\/\d+/i.test(url0)
      ? url0
      : (id ? ('https://smartstore.naver.com/main/products/' + id) : '');
    const raw = item.raw && typeof item.raw === 'object' ? item.raw : {};
    return {
      keyword: String(plan.keyword || ''),
      rank: Number(rank) || 0,
      product_id: id,
      product_url: url,
      product_title: compact(raw.productTitle || raw.productName || raw.title || raw.name || ''),
      mall_name: compact(raw.mallName || raw.channelName || raw.storeName || ''),
      price: Number(raw.price || raw.lowPrice || 0) || 0,
      purchase_cnt: Number(raw.purchaseCnt || raw.buyCount || raw.purchaseCount || 0) || 0,
      image_url: String(raw.imageUrl || raw.image || raw.thumbnailImageUrl || '') || null,
    };
  };

  let source = 'none';
  let rankedItems = [];
  let apiStatus = null;
  let apiError = null;

  // 1) __NEXT_DATA__ / embedded JSON scripts.
  // Do not issue an extra fetch to search.shopping.naver.com/api/search/all.
  // The collector should only read data already loaded by the visible page flow.
  if (rankedItems.length <= 0) {
    try {
      const payloads = [];
      const next = document.querySelector('#__NEXT_DATA__');
      if (next && next.textContent) payloads.push(JSON.parse(next.textContent));
      for (const s of Array.from(document.querySelectorAll('script[type="application/json"]')).slice(0, 20)) {
        try { payloads.push(JSON.parse(s.textContent || '')); } catch {}
      }
      const uniq = [];
      const seen = new Set();
      for (const payload of payloads) {
        const composite = collectCompositeItems(payload);
        const candidates = composite.length
          ? composite.map((raw) => {
              const u = String(raw.mallProductUrl || raw.mallPcUrl || '');
              const id = mainProductIdOf(u) || String(raw.mallProductId || '');
              return id ? { id, url: u || ('https://smartstore.naver.com/main/products/' + id), raw } : null;
            }).filter(Boolean)
          : collectMainProductItems(payload);
        for (const item of candidates) {
          if (!item.id || seen.has(item.id)) continue;
          if (isAdItem(item.raw)) continue;
          seen.add(item.id);
          uniq.push(item);
          if (uniq.length >= Number(plan.rank_limit || 40)) break;
        }
        if (uniq.length > 0) break;
      }
      if (uniq.length > 0) {
        rankedItems = uniq.map((item, idx) => toRankedItem(item, idx + 1));
        source = 'page_json_main_products';
      }
    } catch {}
  }

  // 2) last resort: HTML text scan for unique main/products/<ID>
  if (rankedItems.length <= 0) {
    const html = String(document.documentElement && document.documentElement.innerHTML || '');
    const re = /smartstore\.naver\.com\/main\/products\/(\d+)/gi;
    const uniq = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(html)) !== null) {
      const id = m[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      uniq.push({ id, url: 'https://smartstore.naver.com/main/products/' + id, raw: {} });
      if (uniq.length >= Number(plan.rank_limit || 40)) break;
    }
    if (uniq.length > 0) {
      rankedItems = uniq.map((item, idx) => toRankedItem(item, idx + 1));
      source = 'html_main_products';
    }
  }

  // Tracked ranks are derived from saved main/products order (same ID).
  rankedItems.forEach((item) => {
    if (item.product_id && productIds.has(item.product_id)) {
      setRank(productIds.get(item.product_id), item.rank);
    }
  });

  return {
    ok: true,
    rows,
    rows_count: rows.length,
    ranked_items: rankedItems,
    ranked_items_count: rankedItems.length,
    keyword: String(plan.keyword || ''),
    page_url: location.href,
    title: document.title,
    visible_count: rows.filter((r) => r.rank > 0).length,
    ranked_id_count: rankedItems.length,
    ranked_url_sample: rankedItems.slice(0, 8).map((x) => x.product_url),
    match_source: source,
    api_status: apiStatus,
    api_error: apiError,
    via: 'shopping_rank_cdp_main_products_store'
  };
})()
'@
					$expression = $expression.Replace("__PLAN_JSON__", $planLiteral)
					$metrics = @(Invoke-CdpEvaluateOnPage -Page $page -expression $expression -timeoutMs 90000) | Select-Object -Last 1
					if ((Get-MetricValue $metrics "ok") -ne $true) {
						$failed += 1
						$err = [string](Get-MetricValue $metrics "error")
						if ([string]::IsNullOrWhiteSpace($err)) { $err = "shopping_rank_cdp_failed" }
						if ((Get-MetricValue $metrics "human_action_required") -eq $true -or $err -match "captcha|security|human_verification|보안|캡차|자동입력|로봇") {
							Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $err; attempt = $attempt; progress = $idx; total = $keywords.Count }
							Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "HUMAN_ACTION_REQUIRED" -Note $err -BearerToken $BearerToken | Out-Null
							if (-not (Wait-HostChromeHumanActionOrCancel -port $CdpPort -TimeoutSec 86400 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url -Reason $err)) { return }
							Hide-HostChrome -port $CdpPort | Out-Null
							$metrics = @(Invoke-CdpEvaluateOnPage -Page $page -expression $expression -timeoutMs 90000) | Select-Object -Last 1
							$err = [string](Get-MetricValue $metrics "error")
							if ([string]::IsNullOrWhiteSpace($err)) { $err = "shopping_rank_cdp_failed" }
						}
						if ((Get-MetricValue $metrics "ok") -ne $true) {
							$isFatal = (Get-MetricValue $metrics "fatal") -eq $true -or $err -match "mobile_search_restricted_or_captcha|shopping_service_restricted|shopping_access_limited|http_403|http_418|http_429|captcha|security|보안|제한|비정상"
							if ($isFatal) {
								$fatalShoppingError = $err
								Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note ("shopping_rank_fatal_stop {0}/{1}: {2} {3}" -f $idx, $keywords.Count, $keyword, $err) -BearerToken $BearerToken | Out-Null
								break
							}
							Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("shopping_rank_keyword_failed {0}/{1}: {2} {3}" -f $idx, $keywords.Count, $keyword, $err) -BearerToken $BearerToken | Out-Null
						}
					}
					$rows = @(Get-MetricValue $metrics "rows")
					foreach ($row in $rows) { $allRows.Add($row) | Out-Null }
					$rankedItems = @(Get-MetricValue $metrics "ranked_items")
					foreach ($rankedItem in $rankedItems) { $allRankedItems.Add($rankedItem) | Out-Null }
					$visibleCount = [int](Get-MetricValue $metrics "visible_count")
					$matchSource = [string](Get-MetricValue $metrics "match_source")
					$rankedIdCount = [int](Get-MetricValue $metrics "ranked_id_count")
					if ($rankedIdCount -le 0 -and $rankedItems.Count -le 0) {
						$fatalShoppingError = "shopping_rank_no_ranked_items"
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note ("shopping_rank_empty_serp_fatal {0}/{1}: {2} rows={3} source={4}" -f $idx, $keywords.Count, $keyword, $rows.Count, $matchSource) -BearerToken $BearerToken | Out-Null
						break
					}
					$urlSample = @((Get-MetricValue $metrics "ranked_url_sample") | Select-Object -First 2)
					$sampleNote = if ($urlSample.Count -gt 0) { (" sample={0}" -f ($urlSample -join ",")) } else { "" }
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "SCRAPING" -Note ("shopping_rank_keyword_done {0}/{1}: rows={2} visible={3} ranked_main={4} source={5}{6}" -f $idx, $keywords.Count, $rows.Count, $visibleCount, $rankedIdCount, $matchSource, $sampleNote) -BearerToken $BearerToken | Out-Null
					} catch {
						$failed += 1
						$msg = $_.Exception.Message
						if ([string]::IsNullOrWhiteSpace($msg)) { $msg = "shopping_rank_keyword_exception" }
						if ($msg -match "mobile_search_restricted_or_captcha|shopping_service_restricted|shopping_access_limited|http_403|http_418|http_429|captcha|security|보안|제한|비정상") {
							$fatalShoppingError = $msg
							Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note ("shopping_rank_fatal_exception {0}/{1}: {2} {3}" -f $idx, $keywords.Count, $keyword, $msg) -BearerToken $BearerToken | Out-Null
							break
						}
						foreach ($productUrl in $productUrls) {
							$allRows.Add(@{ product_url = [string]$productUrl; keyword = $keyword; rank = 0; status = "failed"; error = $msg }) | Out-Null
						}
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("shopping_rank_keyword_exception {0}/{1}: {2} {3}" -f $idx, $keywords.Count, $keyword, $msg) -BearerToken $BearerToken | Out-Null
					}
					if ($idx -lt $keywords.Count) {
						if ($shoppingRankBatchSize -gt 0 -and ($idx % $shoppingRankBatchSize) -eq 0) {
							$pauseSec = Get-Random -Minimum $shoppingRankBatchPauseMinSec -Maximum ($shoppingRankBatchPauseMaxSec + 1)
							Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("shopping_rank_batch_pause_after_{0}: {1}s" -f $idx, $pauseSec) -BearerToken $BearerToken | Out-Null
							Start-Sleep -Seconds $pauseSec
						} else {
							$delaySec = Get-Random -Minimum $shoppingRankDelayMinSec -Maximum ($shoppingRankDelayMaxSec + 1)
							try {
								Invoke-CdpEvaluateOnPage -Page $page -expression @'
(() => {
  const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  if (maxY <= 0) return { ok: true, action: 'scroll_skip' };
  const downY = Math.min(maxY, Math.max(180, Math.round(window.innerHeight * 0.55)));
  window.scrollTo({ top: downY, behavior: 'smooth' });
  setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 550);
  return { ok: true, action: 'scroll_down_up', y: downY };
})()
'@ -timeoutMs 3000 | Out-Null
								Start-Sleep -Milliseconds 900
							} catch {}
							Start-Sleep -Seconds $delaySec
						}
					}
				}
				if (-not [string]::IsNullOrWhiteSpace($fatalShoppingError)) {
					$collectedResults.Add(@{ url = $url; ok = $false; error = $fatalShoppingError; metrics = @{ error = $fatalShoppingError; fatal = $true; rows = @($allRows.ToArray()); ranked_items = @($allRankedItems.ToArray()); target_date = [string]($Job.target_date ?? ""); via = "shopping_rank_cdp_main_products_store" } }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note ("shopping_rank_cdp_fatal_stop: {0}" -f $fatalShoppingError) -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
				$collectedResults.Add(@{ url = $url; ok = ($failed -eq 0); metrics = @{ rows = @($allRows.ToArray()); ranked_items = @($allRankedItems.ToArray()); rows_count = $allRows.Count; ranked_items_count = $allRankedItems.Count; failed_keywords = $failed; target_date = [string]($Job.target_date ?? ""); via = "shopping_rank_cdp_main_products_store" }; error = $(if ($failed -gt 0) { "failed_keywords=$failed" } else { $null }) }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("shopping_rank_cdp_collected: rows={0} ranked_main={1} failed={2}" -f $allRows.Count, $allRankedItems.Count, $failed) -BearerToken $BearerToken | Out-Null
				$done = $true
			} catch {
				$msg = $_.Exception.Message
				if ($msg -eq "user_cancelled") {
					$collectedResults.Add(@{ url = $url; ok = $false; error = "user_cancelled"; metrics = @{ error = "user_cancelled"; via = "shopping_rank_cdp_host_agent" } }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "CANCELLED" -Note "user_cancelled" -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
				if ($msg -like "cdp_profile_in_use_by_regular_chrome*") {
					$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = @{ error = $msg; fatal = $true; via = "shopping_rank_cdp_host_agent" } }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $msg -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
				Write-BackgroundStatus @{ running = $true; state = "ERROR_SHOPPING_RANK"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; attempt = $attempt; error = $msg }
				if ($attempt -lt 3) {
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("shopping_rank_retry: {0}" -f $msg) -BearerToken $BearerToken | Out-Null
					Start-Sleep -Seconds 5
					continue
				}
				$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = @{ error = $msg; via = "shopping_rank_cdp_host_agent" } }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $msg -BearerToken $BearerToken | Out-Null
				$done = $true
			}
		}
		Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		return
	}
	if ($mode -eq "ad_rank_diagnosis_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		$url = [string]($urls[0] ?? "https://ads.naver.com/manage/ad-accounts/1728828/sa/tool/exposure-status")
		$plan = if ($null -ne $Job.params -and $null -ne $Job.params.plan) { $Job.params.plan } else { @{} }
		$targetDate = [string]($Job.target_date ?? "")
		$attempt = 0
		$done = $false
		while ($attempt -lt 3 -and -not $done) {
			$attempt += 1
			try {
				Write-BackgroundStatus @{ running = $true; state = "SCRAPING_AD_RANK_DIAGNOSIS"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; attempt = $attempt }
				$chromeAction = Start-HostChrome -port $CdpPort -startUrl $url -profileDir "Default"
				$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
				if (-not $ready) { throw "cdp_port_not_open" }
				if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
				Close-CdpPagesByUrlRegex -port $CdpPort -UrlRegex "ads\.naver\.com/.*/exposure-status"
				$page = New-CdpPageForUrl -port $CdpPort -url $url
				Invoke-CdpNavigateOnPage -Page $page -url $url
				Start-Sleep -Seconds 5
				$products = @($plan.products)
				$keywords = @($plan.keywords)
				$placementOrder = @{
					"mobile-search" = 0
					"pc-search" = 1
					"mobile-shopping" = 2
					"pc-shopping" = 3
				}
				$conditions = @($plan.conditions) | Sort-Object `
					@{ Expression = { [string]($_.gender ?? "") } }, `
					@{ Expression = { [string]($_.age_band ?? "") } }, `
					@{ Expression = {
						$key = [string]($_.placement ?? "")
						if ($placementOrder.ContainsKey($key)) { [int]$placementOrder[$key] } else { 999 }
					} }
				# retry_incomplete: plan.units 가 있으면 (키워드×조건×해당 상품만) 순회.
				# 없으면 기존처럼 keywords × conditions × 전체 products 카테시안.
				# 주의: units 키가 없으면 $plan.units 는 $null 이고, @($null).Count 는 1 이다.
				# 그래서 "없는 units"를 retry plan 으로 오인해 0건 종료하는 버그가 난다.
				$workUnits = New-Object 'System.Collections.Generic.List[object]'
				$planUnits = @()
				try {
					$rawUnits = $null
					if ($plan -is [System.Collections.IDictionary]) {
						if ($plan.Contains('units')) { $rawUnits = $plan['units'] }
					} else {
						$unitsProp = $plan.PSObject.Properties['units']
						if ($null -ne $unitsProp) { $rawUnits = $unitsProp.Value }
					}
					if ($null -ne $rawUnits) {
						$planUnits = @($rawUnits | Where-Object { $null -ne $_ })
					}
				} catch { $planUnits = @() }
				$leftToRightPlacements = @("mobile-search", "pc-search", "mobile-shopping", "pc-shopping")
				$rightToLeftPlacements = @("pc-shopping", "mobile-shopping", "pc-search", "mobile-search")
				$currentPlacementForSweep = "mobile-search"
				if ($planUnits.Count -gt 0) {
					$unitGroupKeys = New-Object 'System.Collections.Generic.List[string]'
					$unitsByDemographic = @{}
					foreach ($unit in $planUnits) {
						$unitKeyword = [string]($unit.keyword ?? "")
						if ([string]::IsNullOrWhiteSpace($unitKeyword)) { continue }
						$unitProducts = @($unit.products)
						if ($unitProducts.Count -le 0) { $unitProducts = @($products) }
						$unitCondition = $unit.condition
						$gender0 = [string]($unitCondition.gender ?? "")
						$ageBand0 = [string]($unitCondition.age_band ?? "")
						$placement0 = [string]($unitCondition.placement ?? "")
						if ([string]::IsNullOrWhiteSpace($gender0) -or [string]::IsNullOrWhiteSpace($ageBand0) -or [string]::IsNullOrWhiteSpace($placement0)) {
							$workUnits.Add(@{
								keyword = $unitKeyword
								condition = $unitCondition
								products = $unitProducts
							}) | Out-Null
							continue
						}
						$groupKey0 = ("{0}|{1}|{2}" -f $unitKeyword, $gender0, $ageBand0)
						if (-not $unitsByDemographic.ContainsKey($groupKey0)) {
							$unitsByDemographic[$groupKey0] = @{}
							$unitGroupKeys.Add($groupKey0) | Out-Null
						}
						if (-not $unitsByDemographic[$groupKey0].ContainsKey($placement0)) {
							$unitsByDemographic[$groupKey0][$placement0] = New-Object 'System.Collections.ArrayList'
						}
						$unitsByDemographic[$groupKey0][$placement0].Add(@{
							keyword = $unitKeyword
							condition = $unitCondition
							products = $unitProducts
						}) | Out-Null
					}
					foreach ($groupKey in $unitGroupKeys) {
						$placementSequence = if ($currentPlacementForSweep -eq "pc-shopping") { $rightToLeftPlacements } else { $leftToRightPlacements }
						$unitsForGroup = $unitsByDemographic[$groupKey]
						$lastPlacementInGroup = $currentPlacementForSweep
						$emittedInGroup = 0
						foreach ($placementKey in $placementSequence) {
							if (-not $unitsForGroup.ContainsKey($placementKey)) { continue }
							foreach ($unitRecord in @($unitsForGroup[$placementKey])) {
								$manualQueryAllowed = ($emittedInGroup -eq 0)
								$workUnits.Add(@{
									keyword = $unitRecord.keyword
									condition = $unitRecord.condition
									products = @($unitRecord.products)
									placement_sweep = $true
									placement_sweep_direction = $(if ($currentPlacementForSweep -eq "pc-shopping") { "right_to_left" } else { "left_to_right" })
									manual_query_allowed = $manualQueryAllowed
								}) | Out-Null
								$emittedInGroup += 1
							}
							$lastPlacementInGroup = $placementKey
						}
						$currentPlacementForSweep = $lastPlacementInGroup
					}
				} else {
					$demographicKeys = New-Object 'System.Collections.Generic.List[string]'
					$conditionsByDemographic = @{}
					foreach ($condition in $conditions) {
						$gender0 = [string]($condition.gender ?? "")
						$ageBand0 = [string]($condition.age_band ?? "")
						$placement0 = [string]($condition.placement ?? "")
						if ([string]::IsNullOrWhiteSpace($gender0) -or [string]::IsNullOrWhiteSpace($ageBand0) -or [string]::IsNullOrWhiteSpace($placement0)) { continue }
						$key0 = ("{0}|{1}" -f $gender0, $ageBand0)
						if (-not $conditionsByDemographic.ContainsKey($key0)) {
							$conditionsByDemographic[$key0] = @{}
							$demographicKeys.Add($key0) | Out-Null
						}
						$conditionsByDemographic[$key0][$placement0] = $condition
					}
					foreach ($keyword in $keywords) {
						$keywordText = [string]($keyword ?? "")
						if ([string]::IsNullOrWhiteSpace($keywordText)) { continue }
						foreach ($demoKey in $demographicKeys) {
							$placementSequence = if ($currentPlacementForSweep -eq "pc-shopping") { $rightToLeftPlacements } else { $leftToRightPlacements }
							$conditionsForDemo = $conditionsByDemographic[$demoKey]
							$lastPlacementInGroup = $currentPlacementForSweep
							$emittedInGroup = 0
							foreach ($placementKey in $placementSequence) {
								if (-not $conditionsForDemo.ContainsKey($placementKey)) { continue }
								$condition = $conditionsForDemo[$placementKey]
								$manualQueryAllowed = ($emittedInGroup -eq 0)
								$workUnits.Add(@{
									keyword = $keywordText
									condition = $condition
									products = @($products)
									placement_sweep = $true
									placement_sweep_direction = $(if ($currentPlacementForSweep -eq "pc-shopping") { "right_to_left" } else { "left_to_right" })
									manual_query_allowed = $manualQueryAllowed
								}) | Out-Null
								$emittedInGroup += 1
								$lastPlacementInGroup = $placementKey
							}
							$currentPlacementForSweep = $lastPlacementInGroup
						}
					}
				}
				$totalConditions = [Math]::Max(1, $workUnits.Count)
				$displayProgressOffset = 0
				$displayProgressTotal = $totalConditions
				try {
					$offsetCandidate = [int]($plan.resume_progress_offset ?? 0)
					$totalCandidate = [int]($plan.resume_progress_total ?? 0)
					if ($offsetCandidate -ge 0 -and $totalCandidate -gt 0) {
						$displayProgressOffset = $offsetCandidate
						$displayProgressTotal = [Math]::Max($totalCandidate, $totalConditions)
					}
				} catch {
					$displayProgressOffset = 0
					$displayProgressTotal = $totalConditions
				}
				$currentCondition = 0
				$allRows = New-Object 'System.Collections.Generic.List[object]'
				$lastPageUrl = $url
				$lastStageLog = @()
				$isRetryPlan = ($planUnits.Count -gt 0)
				foreach ($workUnit in $workUnits) {
						if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
						$currentCondition += 1
						$keywordText = [string]($workUnit.keyword ?? "")
						$condition = $workUnit.condition
						$unitProducts = @($workUnit.products)
						if ([string]::IsNullOrWhiteSpace($keywordText)) { continue }
						if ($null -eq $condition) { continue }
						if ($unitProducts.Count -le 0) { continue }
						$manualQueryAllowedForUnit = $true
						try {
							if ($workUnit -is [System.Collections.IDictionary] -and $workUnit.Contains('manual_query_allowed')) {
								$manualQueryAllowedForUnit = [bool]$workUnit['manual_query_allowed']
							} else {
								$manualQueryAllowedProp = $workUnit.PSObject.Properties['manual_query_allowed']
								if ($null -ne $manualQueryAllowedProp) { $manualQueryAllowedForUnit = [bool]$manualQueryAllowedProp.Value }
							}
						} catch { $manualQueryAllowedForUnit = $true }
						try {
							$condition | Add-Member -NotePropertyName "manual_query_allowed" -NotePropertyValue $manualQueryAllowedForUnit -Force
						} catch {}
						$conditionId = [string]($condition.condition_id ?? "")
						if ([string]::IsNullOrWhiteSpace($conditionId)) {
							$conditionId = ("{0}:{1}:{2}" -f ([string]($condition.gender ?? "")), ([string]($condition.age_band ?? "")), ([string]($condition.placement ?? "")))
						}
						$displayCurrentCondition = [Math]::Min($displayProgressTotal, $displayProgressOffset + $currentCondition)
						$progressNote = ("ad_rank_condition_start {0}/{1}: keyword={2}, condition={3}, products={4}{5}" -f $displayCurrentCondition, $displayProgressTotal, $keywordText, $conditionId, $unitProducts.Count, $(if ($isRetryPlan) { " (retry)" } else { "" }))
						Write-BackgroundStatus @{ running = $true; state = "SCRAPING_AD_RANK_DIAGNOSIS"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; attempt = $attempt; progress = $displayCurrentCondition; total = $displayProgressTotal; keyword = $keywordText; condition = $conditionId; retry = $isRetryPlan }
						# The partial-results endpoint records authoritative progress.
						# Avoid per-condition browser events here; NAS API/DB writes can add several seconds per condition.
						$subPlan = @{
							products = @($unitProducts)
							keywords = @($keywordText)
							conditions = @($condition)
							rank_limit = 92
							search_unit = $(if ($isRetryPlan) { "retry_incomplete_cells" } else { "keyword_once_for_all_products" })
						}
						$conditionAttempt = 0
						$conditionDone = $false
						$conditionError = ""
						$maxConditionAttempts = 1
						while ($conditionAttempt -lt $maxConditionAttempts -and -not $conditionDone) {
							$conditionAttempt += 1
							try {
								$metrics = Invoke-AdRankDiagnosisCollect -port $CdpPort -url $url -Plan $subPlan -Page $page
								if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
								$metricsStageLog = @(Get-MetricValue $metrics "stage_log")
								if ($metricsStageLog.Count -gt 0) { $lastStageLog = @($metricsStageLog) }
								$metricsPageUrl = [string](Get-MetricValue $metrics "page_url")
								if (-not [string]::IsNullOrWhiteSpace($metricsPageUrl)) { $lastPageUrl = $metricsPageUrl }
								if (Test-CollectorHumanActionRequired $metrics) {
									$reason = [string](Get-MetricValue $metrics "human_action_reason")
									if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
									Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; attempt = $attempt; progress = $currentCondition; total = $totalConditions; conditionAttempt = $conditionAttempt }
									Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "LOGIN_REQUIRED" -Note $reason -BearerToken $BearerToken | Out-Null
									if (-not (Wait-GfaInventoryLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
									Hide-HostChrome -port $CdpPort | Out-Null
									Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
									continue
								}
								if ((Get-MetricValue $metrics "ok") -ne $true) {
									$collectError = [string](Get-MetricValue $metrics "error")
									if ([string]::IsNullOrWhiteSpace($collectError)) { $collectError = "ad_rank_diagnosis_collect_failed" }
									throw $collectError
								}
								$rows = @(Get-MetricValue $metrics "rows")
								foreach ($row in $rows) { $allRows.Add($row) | Out-Null }
								$partialMetrics = @{
									rows = @($rows)
									rows_count = $rows.Count
									target_date = $targetDate
									page_url = $lastPageUrl
									stage_log = @($lastStageLog)
									via = "naver_ads_exposure_status_cdp"
									progress = $displayCurrentCondition
									total = $displayProgressTotal
									keyword = $keywordText
									condition = $conditionId
									retry = $isRetryPlan
								}
								try {
									$partial = Submit-AdRankDiagnosisPartialResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Url $url -Metrics $partialMetrics -Ok $true
								} catch {
									Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("ad_rank_partial_save_failed: {0}" -f $_.Exception.Message) -BearerToken $BearerToken | Out-Null
								}
								$conditionDone = $true
							} catch {
								$conditionError = $_.Exception.Message
								if ($conditionError -eq "user_cancelled") { throw $conditionError }
								if ($conditionAttempt -lt $maxConditionAttempts) {
									Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("ad_rank_condition_retry {0}/{1}: {2}" -f $conditionAttempt, $maxConditionAttempts, $conditionError) -BearerToken $BearerToken | Out-Null
									Start-Sleep -Seconds ([Math]::Min(90, 20 * $conditionAttempt))
									continue
								}
								$errorStageLog = @($lastStageLog)
								if ($conditionError -match "cdp_eval_timeout|cdp_eval_no_response|cdp_websocket_not_found|cdp_page_not_found") {
									$errorStageLog = @(
										@{
											stage = "cdp_external_eval_failed"
											at = (Get-Date).ToUniversalTime().ToString("o")
											error = $conditionError
											keyword = $keywordText
											condition = $conditionId
											recovery = "reset_exposure_status_page_before_next_unit"
										}
									)
								}
								$failedRows = New-Object 'System.Collections.Generic.List[object]'
								foreach ($product in $unitProducts) {
									$productUrl = [string]($product.product_url ?? "")
									if ([string]::IsNullOrWhiteSpace($productUrl)) { continue }
									$failedRow = @{
										product_url = $productUrl
										keyword = $keywordText
										gender = [string]($condition.gender ?? "")
										age_band = [string]($condition.age_band ?? "")
										placement = [string]($condition.placement ?? "")
										visible = $false
										rank = $null
										status = "failed"
										error = $conditionError
										page_url = $lastPageUrl
									}
									$failedRows.Add($failedRow) | Out-Null
									$allRows.Add($failedRow) | Out-Null
								}
								$failedMetrics = @{
									rows = @($failedRows.ToArray())
									rows_count = $failedRows.Count
									target_date = $targetDate
									error = $conditionError
									page_url = $lastPageUrl
									stage_log = @($errorStageLog)
									via = "naver_ads_exposure_status_cdp"
									progress = $displayCurrentCondition
									total = $displayProgressTotal
									keyword = $keywordText
									condition = $conditionId
									retry = $isRetryPlan
								}
								try {
									$partial = Submit-AdRankDiagnosisPartialResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Url $url -Metrics $failedMetrics -Ok $false -ErrorMessage $conditionError
									Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "PARTIAL_SAVED" -Note ("ad_rank_condition_failed_saved {0}/{1}: rows={2} saved={3} error={4}" -f $displayCurrentCondition, $displayProgressTotal, $failedRows.Count, ([string]($partial.saved ?? "")), $conditionError) -BearerToken $BearerToken | Out-Null
								} catch {
									Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note ("ad_rank_failed_row_save_failed: {0}; original={1}" -f $_.Exception.Message, $conditionError) -BearerToken $BearerToken | Out-Null
								}
								if ($conditionError -match "ad_rank_rate_limited") {
									Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "SCRAPING" -Note ("ad_rank_condition_rate_limited_continue_without_wait {0}/{1}: {2}" -f $displayCurrentCondition, $displayProgressTotal, $conditionError) -BearerToken $BearerToken | Out-Null
								}
								if ($conditionError -match "cdp_eval_timeout|cdp_eval_no_response|cdp_websocket_not_found|cdp_page_not_found") {
									Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("ad_rank_cdp_page_reset_after_condition_error {0}/{1}: {2}" -f $displayCurrentCondition, $displayProgressTotal, $conditionError) -BearerToken $BearerToken | Out-Null
									try {
										Close-CdpPagesByUrlRegex -port $CdpPort -UrlRegex "ads\.naver\.com/.*/exposure-status"
										$page = New-CdpPageForUrl -port $CdpPort -url $url
										Invoke-CdpNavigateOnPage -Page $page -url $url
										Start-Sleep -Seconds 5
										$lastPageUrl = $url
										$lastStageLog = @()
									} catch {
										Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("ad_rank_cdp_page_reset_failed: {0}" -f $_.Exception.Message) -BearerToken $BearerToken | Out-Null
									}
								}
								$conditionDone = $true
							}
						}
				}
				$collectedResults.Add(@{ url = $url; ok = $true; metrics = @{ rows = @($allRows.ToArray()); rows_count = $allRows.Count; target_date = $targetDate; page_url = $lastPageUrl; stage_log = @($lastStageLog); via = "naver_ads_exposure_status_cdp" } }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("ad_rank_diagnosis_collected: {0} rows" -f $allRows.Count) -BearerToken $BearerToken | Out-Null
				$done = $true
			} catch {
				$msg = $_.Exception.Message
				if ($msg -eq "user_cancelled") {
					$collectedResults.Add(@{ url = $url; ok = $false; error = "user_cancelled"; metrics = @{ error = "user_cancelled"; via = "naver_ads_exposure_status_cdp" } }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "CANCELLED" -Note "user_cancelled" -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
				if ($msg -match "ad_rank_rate_limited") {
					$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = @{ error = $msg; via = "naver_ads_exposure_status_cdp" } }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note ("ad_rank_rate_limited_stop: {0}" -f $msg) -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
				Write-BackgroundStatus @{ running = $true; state = "ERROR_AD_RANK_DIAGNOSIS"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; attempt = $attempt; error = $msg }
				if ($attempt -lt 3) {
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("ad_rank_diagnosis_retry: {0}" -f $msg) -BearerToken $BearerToken | Out-Null
					Start-Sleep -Seconds 3
					continue
				}
				$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = @{ error = $msg; via = "naver_ads_exposure_status_cdp" } }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $msg -BearerToken $BearerToken | Out-Null
				$done = $true
			}
		}
		Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		return
	}
	if ($mode -eq "reviews_excel_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		foreach ($rawUrl in $urls) {
			$url = [string]($rawUrl ?? "")
			if ([string]::IsNullOrWhiteSpace($url)) { continue }
			$range = Get-ReviewExcelRangeFromUrl -url $url
			$dateFrom = [string]($range.dateFrom ?? "")
			$dateTo = [string]($range.dateTo ?? "")
			$attempt = 0
			$done = $false
			while ($attempt -lt 20 -and -not $done) {
				$attempt += 1
				try {
					Write-BackgroundStatus @{ running = $true; state = "SCRAPING_REVIEW_EXCEL"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; dateFrom = $dateFrom; dateTo = $dateTo; attempt = $attempt }
					$chromeAction = Start-HostChrome -port $CdpPort -startUrl $url -profileDir "Default"
					$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
					if (-not $ready) { throw "cdp_port_not_open" }
					$page = New-CdpPageForUrl -port $CdpPort -url $url
					Invoke-CdpNavigateOnPage -Page $page -url $url
					Start-Sleep -Seconds 7
					Invoke-CdpSetDownloadBehavior -port $CdpPort -downloadPath (Get-DownloadsDirectory)
					$downloadStartedAt = Get-Date
					$metricsItems = @(Invoke-ReviewExcelDownload -port $CdpPort -url $url -dateFrom $dateFrom -dateTo $dateTo)
					$metrics = if ($metricsItems.Count -gt 0) { $metricsItems[$metricsItems.Count - 1] } else { @{} }
					if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
					if ($null -eq $metrics) { throw "review_excel_cdp_empty_result" }
					if (Test-CollectorHumanActionRequired $metrics) {
						$reason = [string](Get-MetricValue $metrics "human_action_reason")
						if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
						Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; attempt = $attempt }
						$statusForReason = if ($reason -eq "login_required") { "LOGIN_REQUIRED" } else { "HUMAN_ACTION_REQUIRED" }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status $statusForReason -Note $reason -BearerToken $BearerToken | Out-Null
						if ($reason -ne "login_required") {
							$collectedResults.Add(@{ url = $url; ok = $false; error = $reason; metrics = @{ date_from = $dateFrom; date_to = $dateTo; error = $reason; via = "smartstore_review_excel_cdp" } }) | Out-Null
							$done = $true
							break
						}
						if (-not (Wait-HostChromeLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
						Hide-HostChrome -port $CdpPort | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
						continue
					}
					if ((Get-MetricValue $metrics "clicked") -ne $true) {
						$downloadError = [string](Get-MetricValue $metrics "error")
						if ([string]::IsNullOrWhiteSpace($downloadError)) { $downloadError = "review_excel_download_not_started" }
						throw $downloadError
					}
					if ((Get-MetricValue $metrics "no_reviews") -eq $true) {
						$metricsOut = @{
							date_from = $dateFrom
							date_to = $dateTo
							no_reviews = $true
							via = "smartstore_review_excel_cdp"
						}
						$collectedResults.Add(@{ url = $url; ok = $true; metrics = $metricsOut }) | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("reviews_excel_cdp_no_reviews: {0}~{1}" -f $dateFrom, $dateTo) -BearerToken $BearerToken | Out-Null
						$done = $true
						break
					}
					$filePath = Wait-ReviewExcelDownload -After $downloadStartedAt -TimeoutSec 30
					$uploadResponse = Submit-ReviewExcelUpload -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -FilePath $filePath
					$metricsOut = @{
						date_from = $dateFrom
						date_to = $dateTo
						download_file = (Split-Path -Leaf $filePath)
						upload_response = $uploadResponse
						via = "smartstore_review_excel_cdp"
					}
					$collectedResults.Add(@{ url = $url; ok = $true; metrics = $metricsOut }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("reviews_excel_cdp_uploaded: {0}~{1}" -f $dateFrom, $dateTo) -BearerToken $BearerToken | Out-Null
					$done = $true
				} catch {
					$msg = $_.Exception.Message
					Write-BackgroundStatus @{ running = $true; state = "ERROR_REVIEW_EXCEL"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; dateFrom = $dateFrom; dateTo = $dateTo; attempt = $attempt; error = $msg }
					if ($msg -eq "cdp_eval_timeout" -and $attempt -lt 3) {
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("reviews_excel_cdp_timeout_retry: attempt={0}" -f $attempt) -BearerToken $BearerToken | Out-Null
						Start-Sleep -Seconds (5 * $attempt)
						continue
					}
					$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = @{ date_from = $dateFrom; date_to = $dateTo; error = $msg; via = "smartstore_review_excel_cdp" } }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $msg -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
			}
			if (-not $done) {
				$collectedResults.Add(@{ url = $url; ok = $false; error = "login_wait_timeout"; metrics = @{ date_from = $dateFrom; date_to = $dateTo; error = "login_wait_timeout" } }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note "login_wait_timeout" -BearerToken $BearerToken | Out-Null
			}
		}
		Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		return
	}
	if ($mode -eq "gfa_campaign_inventory_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		foreach ($rawUrl in $urls) {
			if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) {
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url "" -Status "CANCELLED" -Note "user_cancelled_before_gfa_campaign_inventory" -BearerToken $BearerToken | Out-Null
				break
			}
			$url = [string]($rawUrl ?? "")
			if ([string]::IsNullOrWhiteSpace($url)) { continue }
			$meta = Get-GfaCampaignInventoryUrlMeta $url
			$attempt = 0
			$done = $false
			while ($attempt -lt 10 -and -not $done) {
				$attempt += 1
				$metrics = $null
				try {
					Write-BackgroundStatus @{ running = $true; state = "SCRAPING_GFA_CAMPAIGN_INVENTORY"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; campaignType = $meta.campaignType; attempt = $attempt }
					$chromeAction = Start-HostChrome -port $CdpPort -startUrl $url -profileDir "Default"
					$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
					if (-not $ready) { throw "cdp_port_not_open" }
					if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
					$page = New-CdpPageForUrl -port $CdpPort -url $url
					Invoke-CdpNavigateOnPage -Page $page -url $url
					Start-Sleep -Seconds 7
					if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
					$metrics = Invoke-GfaCampaignInventoryCollect -port $CdpPort -url $url -CampaignType $meta.campaignType -MenuLabel $meta.menuLabel
					if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
					if (Test-CollectorHumanActionRequired $metrics) {
						$reason = [string](Get-MetricValue $metrics "human_action_reason")
						if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
						Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; attempt = $attempt }
						$statusForReason = if ($reason -eq "login_required") { "LOGIN_REQUIRED" } else { "HUMAN_ACTION_REQUIRED" }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status $statusForReason -Note $reason -BearerToken $BearerToken | Out-Null
						if ($reason -ne "login_required") {
							$collectedResults.Add(@{ url = $url; ok = $false; error = $reason; metrics = @{ error = $reason; stage_log = (Get-MetricValue $metrics "stage_log"); via = "naver_gfa_campaign_inventory_cdp" } }) | Out-Null
							$done = $true
							break
						}
						if (-not (Wait-GfaInventoryLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
						Hide-HostChrome -port $CdpPort | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
						continue
					}
					if ((Get-MetricValue $metrics "ok") -ne $true) {
						$collectError = [string](Get-MetricValue $metrics "error")
						if ([string]::IsNullOrWhiteSpace($collectError)) { $collectError = "gfa_campaign_inventory_collect_failed" }
						throw $collectError
					}
					$items = @(Get-MetricValue $metrics "items")
					$uploadResponse = Submit-GfaCampaignInventorySnapshot -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -AdAccountNo $meta.adAccountNo -CampaignType $meta.campaignType -MenuLabel $meta.menuLabel -Items $items
					$metricsOut = @{
						campaign_type = $meta.campaignType
						menu_label = $meta.menuLabel
						items_count = $items.Count
						upload_response = $uploadResponse
						stage_log = (Get-MetricValue $metrics "stage_log")
						page_url = (Get-MetricValue $metrics "page_url")
						via = "naver_gfa_campaign_inventory_cdp"
					}
					$collectedResults.Add(@{ url = $url; ok = $true; metrics = $metricsOut }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("gfa_campaign_inventory_uploaded: {0} rows" -f $items.Count) -BearerToken $BearerToken | Out-Null
					$done = $true
				} catch {
					$msg = $_.Exception.Message
					try {
						$lineNo = [string]($_.InvocationInfo.ScriptLineNumber)
						$offsetNo = [string]($_.InvocationInfo.OffsetInLine)
						if (-not [string]::IsNullOrWhiteSpace($lineNo)) { $msg = ("{0} @line {1}:{2}" -f $msg, $lineNo, $offsetNo) }
					} catch {}
					if ($msg -eq "user_cancelled") {
						$collectedResults.Add(@{ url = $url; ok = $false; error = "user_cancelled"; metrics = @{ error = "user_cancelled"; via = "naver_gfa_campaign_inventory_cdp" } }) | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "CANCELLED" -Note "user_cancelled" -BearerToken $BearerToken | Out-Null
						$done = $true
						break
					}
					Write-BackgroundStatus @{ running = $true; state = "ERROR_GFA_CAMPAIGN_INVENTORY"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; attempt = $attempt; error = $msg }
					$failedMetrics = @{ error = $msg; via = "naver_gfa_campaign_inventory_cdp" }
					try {
						if ($null -ne $metrics) {
							$failedMetrics["stage_log"] = Get-MetricValue $metrics "stage_log"
							$failedMetrics["page_url"] = Get-MetricValue $metrics "page_url"
							$failedMetrics["title"] = Get-MetricValue $metrics "title"
							$failedMetrics["body_sample"] = Get-MetricValue $metrics "body_sample"
						}
					} catch {}
					$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = $failedMetrics }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $msg -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
			}
			if (-not $done) {
				$collectedResults.Add(@{ url = $url; ok = $false; error = "login_wait_timeout"; metrics = @{ error = "login_wait_timeout"; via = "naver_gfa_campaign_inventory_cdp" } }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note "login_wait_timeout" -BearerToken $BearerToken | Out-Null
			}
		}
		Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		return
	}
	if ($mode -eq "gfa_creative_detail_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		foreach ($rawUrl in $urls) {
			if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) {
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url "" -Status "CANCELLED" -Note "user_cancelled_before_gfa_creative_detail" -BearerToken $BearerToken | Out-Null
				break
			}
			$url = [string]($rawUrl ?? "")
			if ([string]::IsNullOrWhiteSpace($url)) { continue }
			$attempt = 0
			$done = $false
			while ($attempt -lt 4 -and -not $done) {
				$attempt += 1
				$metrics = $null
				try {
					Write-BackgroundStatus @{ running = $true; state = "SCRAPING_GFA_CREATIVE_DETAIL"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; attempt = $attempt }
					$chromeAction = Start-HostChrome -port $CdpPort -startUrl $url -profileDir "Default"
					$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
					if (-not $ready) { throw "cdp_port_not_open" }
					if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
					Invoke-CdpNavigate -port $CdpPort -url $url
					Start-Sleep -Seconds 6
					if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
					$metrics = Resolve-GfaCreativeDetailMetrics -port $CdpPort -url $url -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId
					if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
					if (Test-CollectorHumanActionRequired $metrics) {
						$reason = [string](Get-MetricValue $metrics "human_action_reason")
						if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
						Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; attempt = $attempt }
						$statusForReason = if ($reason -eq "login_required") { "LOGIN_REQUIRED" } else { "HUMAN_ACTION_REQUIRED" }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status $statusForReason -Note $reason -BearerToken $BearerToken | Out-Null
						if ($reason -ne "login_required") {
							$collectedResults.Add(@{ url = $url; ok = $false; error = $reason; metrics = @{ error = $reason; stage_log = (Get-MetricValue $metrics "stage_log"); via = "naver_gfa_creative_detail_cdp" } }) | Out-Null
							$done = $true
							break
						}
						Show-HostChrome -port $CdpPort | Out-Null
						if (-not (Wait-HostChromeLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
						Hide-HostChrome -port $CdpPort | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
						continue
					}
					$ok = (Get-MetricValue $metrics "ok") -eq $true
					$err = [string](Get-MetricValue $metrics "error")
					if (-not $ok -and [string]::IsNullOrWhiteSpace($err)) { $err = "gfa_creative_detail_collect_failed" }
					$metricsOut = @{
						detail_url = (Get-MetricValue $metrics "detail_url")
						page_url = (Get-MetricValue $metrics "page_url")
						ad_account_no = (Get-MetricValue $metrics "ad_account_no")
						campaign_id = (Get-MetricValue $metrics "campaign_id")
						adgroup_id = (Get-MetricValue $metrics "adgroup_id")
						creative_id = (Get-MetricValue $metrics "creative_id")
						creative_name = (Get-MetricValue $metrics "creative_name")
						creative_type = (Get-MetricValue $metrics "creative_type")
						profile_name = (Get-MetricValue $metrics "profile_name")
						profile_image_url = (Get-MetricValue $metrics "profile_image_url")
						image_url = (Get-MetricValue $metrics "image_url")
						primary_text = (Get-MetricValue $metrics "primary_text")
						headline = (Get-MetricValue $metrics "headline")
						description = (Get-MetricValue $metrics "description")
						cta = (Get-MetricValue $metrics "cta")
						landing_url = (Get-MetricValue $metrics "landing_url")
						image_candidates = (Get-MetricValue $metrics "image_candidates")
						text_candidates = (Get-MetricValue $metrics "text_candidates")
						stage_log = (Get-MetricValue $metrics "stage_log")
						body_sample = (Get-MetricValue $metrics "body_sample")
						requested_detail_url = (Get-MetricValue $metrics "requested_detail_url")
						resolved_detail_url = (Get-MetricValue $metrics "resolved_detail_url")
						creative_no_resolved_by = (Get-MetricValue $metrics "creative_no_resolved_by")
						via = "naver_gfa_creative_detail_cdp"
					}
					if (-not [string]::IsNullOrWhiteSpace($err)) { $metricsOut["error"] = $err }
					$collectedResults.Add(@{ url = $url; ok = $ok; error = $(if ($ok) { $null } else { $err }); metrics = $metricsOut }) | Out-Null
					$statusText = if ($ok) { "DONE" } else { "FAILED" }
					$noteText = if ($ok) { "gfa_creative_detail_collected" } else { $err }
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status $statusText -Note $noteText -BearerToken $BearerToken | Out-Null
					$done = $true
				} catch {
					$msg = $_.Exception.Message
					if ($msg -eq "user_cancelled") {
						$collectedResults.Add(@{ url = $url; ok = $false; error = "user_cancelled"; metrics = @{ error = "user_cancelled"; via = "naver_gfa_creative_detail_cdp" } }) | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "CANCELLED" -Note "user_cancelled" -BearerToken $BearerToken | Out-Null
						$done = $true
						break
					}
					Write-BackgroundStatus @{ running = $true; state = "ERROR_GFA_CREATIVE_DETAIL"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; attempt = $attempt; error = $msg }
					$failedMetrics = @{ error = $msg; via = "naver_gfa_creative_detail_cdp" }
					try {
						if ($null -ne $metrics) {
							$failedMetrics["stage_log"] = Get-MetricValue $metrics "stage_log"
							$failedMetrics["page_url"] = Get-MetricValue $metrics "page_url"
							$failedMetrics["title"] = Get-MetricValue $metrics "title"
							$failedMetrics["body_sample"] = Get-MetricValue $metrics "body_sample"
						}
					} catch {}
					$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = $failedMetrics }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $msg -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
			}
			if (-not $done) {
				$collectedResults.Add(@{ url = $url; ok = $false; error = "gfa_creative_detail_retry_exhausted"; metrics = @{ error = "gfa_creative_detail_retry_exhausted"; via = "naver_gfa_creative_detail_cdp" } }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note "gfa_creative_detail_retry_exhausted" -BearerToken $BearerToken | Out-Null
			}
		}
		Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		return
	}
	if ($mode -eq "gfa_adgroup_inventory_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		foreach ($rawUrl in $urls) {
			if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) {
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url "" -Status "CANCELLED" -Note "user_cancelled_before_gfa_adgroup_inventory" -BearerToken $BearerToken | Out-Null
				break
			}
			$url = [string]($rawUrl ?? "")
			if ([string]::IsNullOrWhiteSpace($url)) { continue }
			$meta = Get-GfaAdgroupInventoryUrlMeta $url
			$attempt = 0
			$done = $false
			while ($attempt -lt 10 -and -not $done) {
				$attempt += 1
				$metrics = $null
				try {
					Write-BackgroundStatus @{ running = $true; state = "SCRAPING_GFA_ADGROUP_INVENTORY"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; campaignType = $meta.campaignType; attempt = $attempt }
					$chromeAction = Start-HostChrome -port $CdpPort -startUrl $url -profileDir "Default"
					$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
					if (-not $ready) { throw "cdp_port_not_open" }
					if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
					$page = New-CdpPageForUrl -port $CdpPort -url $url
					Invoke-CdpNavigateOnPage -Page $page -url $url
					Start-Sleep -Seconds 7
					if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
					$metrics = Invoke-GfaAdgroupInventoryCollect -port $CdpPort -url $url -CampaignType $meta.campaignType -MenuLabel $meta.menuLabel
					if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
					if (Test-CollectorHumanActionRequired $metrics) {
						$reason = [string](Get-MetricValue $metrics "human_action_reason")
						if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
						Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; attempt = $attempt }
						$statusForReason = if ($reason -eq "login_required") { "LOGIN_REQUIRED" } else { "HUMAN_ACTION_REQUIRED" }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status $statusForReason -Note $reason -BearerToken $BearerToken | Out-Null
						if ($reason -ne "login_required") {
							$collectedResults.Add(@{ url = $url; ok = $false; error = $reason; metrics = @{ error = $reason; stage_log = (Get-MetricValue $metrics "stage_log"); via = "naver_gfa_adgroup_inventory_cdp" } }) | Out-Null
							$done = $true
							break
						}
						Show-HostChrome -port $CdpPort | Out-Null
						if (-not (Wait-HostChromeLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
						Hide-HostChrome -port $CdpPort | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
						continue
					}
					if ((Get-MetricValue $metrics "ok") -ne $true) {
						$collectError = [string](Get-MetricValue $metrics "error")
						if ([string]::IsNullOrWhiteSpace($collectError)) { $collectError = "gfa_adgroup_inventory_collect_failed" }
						throw $collectError
					}
					$items = @(Get-MetricValue $metrics "items")
					$uploadResponse = Submit-GfaAdgroupInventorySnapshot -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -AdAccountNo $meta.adAccountNo -CampaignType $meta.campaignType -MenuLabel $meta.menuLabel -Items $items
					$metricsOut = @{
						campaign_type = $meta.campaignType
						menu_label = $meta.menuLabel
						items_count = $items.Count
						upload_response = $uploadResponse
						stage_log = (Get-MetricValue $metrics "stage_log")
						page_url = (Get-MetricValue $metrics "page_url")
						via = "naver_gfa_adgroup_inventory_cdp"
					}
					$collectedResults.Add(@{ url = $url; ok = $true; metrics = $metricsOut }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("gfa_adgroup_inventory_uploaded: {0} rows" -f $items.Count) -BearerToken $BearerToken | Out-Null
					$done = $true
				} catch {
					$msg = $_.Exception.Message
					if ($msg -eq "user_cancelled") {
						$collectedResults.Add(@{ url = $url; ok = $false; error = "user_cancelled"; metrics = @{ error = "user_cancelled"; via = "naver_gfa_adgroup_inventory_cdp" } }) | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "CANCELLED" -Note "user_cancelled" -BearerToken $BearerToken | Out-Null
						$done = $true
						break
					}
					Write-BackgroundStatus @{ running = $true; state = "ERROR_GFA_ADGROUP_INVENTORY"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; attempt = $attempt; error = $msg }
					$failedMetrics = @{ error = $msg; via = "naver_gfa_adgroup_inventory_cdp" }
					try {
						if ($null -ne $metrics) {
							$failedMetrics["stage_log"] = Get-MetricValue $metrics "stage_log"
							$failedMetrics["page_url"] = Get-MetricValue $metrics "page_url"
							$failedMetrics["title"] = Get-MetricValue $metrics "title"
							$failedMetrics["body_sample"] = Get-MetricValue $metrics "body_sample"
						}
					} catch {}
					$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = $failedMetrics }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $msg -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
			}
			if (-not $done) {
				$collectedResults.Add(@{ url = $url; ok = $false; error = "login_wait_timeout"; metrics = @{ error = "login_wait_timeout"; via = "naver_gfa_adgroup_inventory_cdp" } }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note "login_wait_timeout" -BearerToken $BearerToken | Out-Null
			}
		}
		Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		return
	}
	if ($mode -eq "gfa_performance_report_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		$jobDateFrom = [string]($Job.date_from ?? "")
		$jobDateTo = [string]($Job.date_to ?? "")
		$cancelled = $false
		$gfaRequestListInitialized = $false
		foreach ($rawUrl in $urls) {
			if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) {
				$cancelled = $true
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url "" -Status "CANCELLED" -Note "user_cancelled_before_gfa_url" -BearerToken $BearerToken | Out-Null
				break
			}
			$url = [string]($rawUrl ?? "")
			if ([string]::IsNullOrWhiteSpace($url)) { continue }
			$dateFrom = $jobDateFrom
			$dateTo = $jobDateTo
			try { if ($url -match "analyticsGfaDateFrom=([0-9]{4}-[0-9]{2}-[0-9]{2})") { $dateFrom = $Matches[1] } } catch {}
			try { if ($url -match "analyticsGfaDateTo=([0-9]{4}-[0-9]{2}-[0-9]{2})") { $dateTo = $Matches[1] } } catch {}
			try {
				if (($url -match "dateRange=([0-9]{4}-[0-9]{2}-[0-9]{2})(?:%2C|,)([0-9]{4}-[0-9]{2}-[0-9]{2})")) {
					$dateFrom = $Matches[1]
					$dateTo = $Matches[2]
				}
			} catch {}
			$adUnit = "CREATIVE"
			try {
				if ($url -match "(?:[?&])adUnit=([^&]+)") {
					$adUnit = [System.Uri]::UnescapeDataString($Matches[1]).ToUpperInvariant()
				}
			} catch {}
			$attempt = 0
			$maxGfaAttempts = 5
			$done = $false
			while ($attempt -lt $maxGfaAttempts -and -not $done) {
				if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) {
					$cancelled = $true
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "CANCELLED" -Note "user_cancelled_before_gfa_attempt" -BearerToken $BearerToken | Out-Null
					break
				}
				$attempt += 1
				$metrics = $null
				try {
					Write-BackgroundStatus @{ running = $true; state = "SCRAPING_GFA_PERFORMANCE_REPORT"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; dateFrom = $dateFrom; dateTo = $dateTo; attempt = $attempt }
					$chromeAction = Start-HostChrome -port $CdpPort -startUrl $url -profileDir "Default"
					$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
					if (-not $ready) { throw "cdp_port_not_open" }
					if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
					$page = New-CdpPageForUrl -port $CdpPort -url $url
					Invoke-CdpNavigateOnPage -Page $page -url $url
					Start-Sleep -Seconds 7
					if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
					Invoke-CdpSetDownloadBehavior -port $CdpPort -downloadPath (Get-DownloadsDirectory)
					$downloadStartedAt = Get-Date
					$clearRequestListForThisUrl = (-not $gfaRequestListInitialized)
					$skipInitialRequestListCheckForThisUrl = $gfaRequestListInitialized
					$metrics = Invoke-GfaPerformanceReportDownload -port $CdpPort -url $url -dateFrom $dateFrom -dateTo $dateTo -ClearRequestListAtStart:$clearRequestListForThisUrl -SkipInitialRequestListCheck:$skipInitialRequestListCheckForThisUrl -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Page $page
					$metrics = @($metrics) | Select-Object -Last 1
					if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
					if (Test-CollectorHumanActionRequired $metrics) {
						$reason = [string](Get-MetricValue $metrics "human_action_reason")
						if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
						Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; attempt = $attempt }
						$statusForReason = if ($reason -eq "login_required") { "LOGIN_REQUIRED" } else { "HUMAN_ACTION_REQUIRED" }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status $statusForReason -Note $reason -BearerToken $BearerToken | Out-Null
						if ($reason -ne "login_required") {
							$collectedResults.Add(@{ url = $url; ok = $false; error = $reason; metrics = @{ date_from = $dateFrom; date_to = $dateTo; error = $reason; stage_log = (Get-MetricValue $metrics "stage_log"); via = "naver_gfa_performance_report_cdp" } }) | Out-Null
							$done = $true
							break
						}
						Show-HostChrome -port $CdpPort | Out-Null
						if (-not (Wait-HostChromeLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
						Hide-HostChrome -port $CdpPort | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
						continue
					}
					if ((Get-MetricValue $metrics "gfa_no_data") -eq $true) {
						$metricsOut = @{
							date_from = $dateFrom
							date_to = $dateTo
							ad_unit = $adUnit
							gfa_no_data = $true
							stage_log = (Get-MetricValue $metrics "stage_log")
							via = "naver_gfa_performance_report_cdp"
						}
						$collectedResults.Add(@{ url = $url; ok = $true; metrics = $metricsOut }) | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("gfa_performance_report_no_data: {0}~{1} {2}" -f $dateFrom, $dateTo, $adUnit) -BearerToken $BearerToken | Out-Null
						$done = $true
						continue
					}
					$gfaRequestListInitialized = $true
					if ((Get-MetricValue $metrics "clicked") -ne $true) {
						$downloadError = [string](Get-MetricValue $metrics "error")
						if ([string]::IsNullOrWhiteSpace($downloadError)) { $downloadError = "gfa_performance_report_download_not_started" }
						if ($downloadError -match "gfa_request_list_modal_not_closed|gfa_auto_request_list_not_closed" -and $attempt -lt $maxGfaAttempts) {
							if (Invoke-GfaRequestListTrustedCloseFallback -port $CdpPort) {
								Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "gfa_request_list_trusted_close_retry" -BearerToken $BearerToken | Out-Null
								continue
							}
						}
						throw $downloadError
					}
					$filePath = Wait-GfaPerformanceReportDownload -After $downloadStartedAt -TimeoutSec 120 -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken
					if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) { throw "user_cancelled" }
					$uploadResponse = Submit-GfaPerformanceReportUpload -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -FilePath $filePath -AdUnit $adUnit
					$metricsOut = @{
						date_from = $dateFrom
						date_to = $dateTo
						ad_unit = $adUnit
						download_file = (Split-Path -Leaf $filePath)
						upload_response = $uploadResponse
						stage_log = (Get-MetricValue $metrics "stage_log")
						via = "naver_gfa_performance_report_cdp"
					}
					$collectedResults.Add(@{ url = $url; ok = $true; metrics = $metricsOut }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("gfa_performance_report_cdp_uploaded: {0}~{1}" -f $dateFrom, $dateTo) -BearerToken $BearerToken | Out-Null
					$done = $true
				} catch {
					$msg = $_.Exception.Message
					if ($msg -eq "user_cancelled") {
						$cancelled = $true
						$collectedResults.Add(@{ url = $url; ok = $false; error = "user_cancelled"; metrics = @{ date_from = $dateFrom; date_to = $dateTo; error = "user_cancelled"; via = "naver_gfa_performance_report_cdp" } }) | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "CANCELLED" -Note "user_cancelled" -BearerToken $BearerToken | Out-Null
						$done = $true
						break
					}
					$isGfaTransientError = ($msg -match "cdp_eval_timeout|Inspected target navigated or closed|gfa_performance_report_download_timeout|gfa_download_file_button_not_found|gfa_performance_report_download_not_started|gfa_request_list_modal_not_closed|gfa_auto_request_list_not_closed|gfa_download_request_confirm_not_found")
					if ($msg -match "gfa_request_list_modal_not_closed|gfa_auto_request_list_not_closed" -and $attempt -lt $maxGfaAttempts) {
						if (Invoke-GfaRequestListTrustedCloseFallback -port $CdpPort) {
							Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "gfa_request_list_trusted_close_retry_after_error" -BearerToken $BearerToken | Out-Null
							continue
						}
					}
					if ($isGfaTransientError -and $attempt -lt $maxGfaAttempts) {
						$gfaRequestListInitialized = $false
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("gfa_performance_transient_retry: {0} ({1}/{2})" -f $msg, $attempt, $maxGfaAttempts) -BearerToken $BearerToken | Out-Null
						Start-Sleep -Seconds 3
						continue
					}
					Write-BackgroundStatus @{ running = $true; state = "ERROR_GFA_PERFORMANCE_REPORT"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; dateFrom = $dateFrom; dateTo = $dateTo; attempt = $attempt; error = $msg }
					$failedMetrics = @{ date_from = $dateFrom; date_to = $dateTo; error = $msg; via = "naver_gfa_performance_report_cdp" }
					try {
						if ($null -ne $metrics) {
							$failedMetrics["stage_log"] = Get-MetricValue $metrics "stage_log"
							$failedMetrics["page_url"] = Get-MetricValue $metrics "page_url"
							$failedMetrics["title"] = Get-MetricValue $metrics "title"
							$failedMetrics["body_sample"] = Get-MetricValue $metrics "body_sample"
						}
					} catch {}
					$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = $failedMetrics }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $msg -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
			}
			if ($cancelled) { break }
			if (-not $done) {
				$retryError = "gfa_performance_retry_exhausted"
				$collectedResults.Add(@{ url = $url; ok = $false; error = $retryError; metrics = @{ date_from = $dateFrom; date_to = $dateTo; ad_unit = $adUnit; error = $retryError; via = "naver_gfa_performance_report_cdp" } }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $retryError -BearerToken $BearerToken | Out-Null
			}
		}
		if ($cancelled) {
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url "" -Status "CANCELLED" -Note "user_cancelled_gfa_loop_stopped" -BearerToken $BearerToken | Out-Null
			try { Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null } catch {}
		} else {
			Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		}
		return
	}
	if ($mode -eq "ads_creative_report_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		$jobDateFrom = [string]($Job.date_from ?? "")
		$jobDateTo = [string]($Job.date_to ?? "")
		$adsCreativePageReady = $false
		$adsCreativeUiCompletedCount = 0
		foreach ($rawUrl in $urls) {
			$url = [string]($rawUrl ?? "")
			if ([string]::IsNullOrWhiteSpace($url)) { continue }
			$range = Get-AdsCreativeReportRange $url
			$dateFrom = [string]($range.dateFrom ?? "")
			$dateTo = [string]($range.dateTo ?? "")
			$expectedDateFrom = if (-not [string]::IsNullOrWhiteSpace($jobDateFrom)) { $jobDateFrom } else { $dateFrom }
			$expectedDateTo = if (-not [string]::IsNullOrWhiteSpace($jobDateTo)) { $jobDateTo } else { $dateTo }
			$chunkDays = 0
			try {
				$chunkDays = ([datetime]::Parse($dateTo) - [datetime]::Parse($dateFrom)).Days + 1
			} catch {
				throw ("ads_creative_invalid_chunk_range: {0}~{1}" -f $dateFrom, $dateTo)
			}
			if ($chunkDays -lt 1 -or $chunkDays -gt 7) {
				throw ("ads_creative_chunk_exceeds_7_days: {0}~{1} ({2} days)" -f $dateFrom, $dateTo, $chunkDays)
			}
			$navUrl = Remove-AdsCreativeReportRangeParams $url
			$attempt = 0
			$done = $false
			while ($attempt -lt 20 -and -not $done) {
				$attempt += 1
				try {
					Write-BackgroundStatus @{ running = $true; state = "SCRAPING_ADS_CREATIVE_REPORT"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $navUrl; dateFrom = $dateFrom; dateTo = $dateTo; chunkDays = $chunkDays; requestedDateFrom = $expectedDateFrom; requestedDateTo = $expectedDateTo; attempt = $attempt }
					$chromeAction = Start-HostChrome -port $CdpPort -startUrl $navUrl -profileDir "Default"
					$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
					if (-not $ready) { throw "cdp_port_not_open" }
					$shouldStepPrev = ($adsCreativeUiCompletedCount -gt 0)
					if (-not $adsCreativePageReady) {
						Invoke-CdpNavigate -port $CdpPort -url $navUrl
						Start-Sleep -Seconds 7
						$adsCreativePageReady = $true
					} elseif ($shouldStepPrev) {
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("ads_creative_keep_page_for_next_7day: {0}~{1}" -f $dateFrom, $dateTo) -BearerToken $BearerToken | Out-Null
						Start-Sleep -Milliseconds 800
					} else {
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("ads_creative_keep_page_for_initial_7day: {0}~{1}" -f $dateFrom, $dateTo) -BearerToken $BearerToken | Out-Null
						Start-Sleep -Milliseconds 800
					}
					Invoke-CdpSetDownloadBehavior -port $CdpPort -downloadPath (Get-DownloadsDirectory)
					$downloadStartedAt = Get-Date
					$metricsItems = @(Invoke-AdsSearchwordReportDownload7DayStep -port $CdpPort -url $url -dateFrom $dateFrom -dateTo $dateTo -StepPrevOnly $shouldStepPrev)
					$metrics = if ($metricsItems.Count -gt 0) { $metricsItems[$metricsItems.Count - 1] } else { @{} }
					if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
					if ($null -eq $metrics) { throw "ads_creative_report_cdp_empty_result" }
					if (Test-CollectorHumanActionRequired $metrics) {
						$reason = [string](Get-MetricValue $metrics "human_action_reason")
						if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
						Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; attempt = $attempt }
						$statusForReason = if ($reason -eq "login_required") { "LOGIN_REQUIRED" } else { "HUMAN_ACTION_REQUIRED" }
						$stageLog = Get-MetricValue $metrics "stage_log"
						$currentRange = [string](Get-MetricValue $metrics "current_range")
						$expectedRange = [string](Get-MetricValue $metrics "expected_range")
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status $statusForReason -Note $reason -BearerToken $BearerToken | Out-Null
						if ($reason -ne "login_required") {
							$collectedResults.Add(@{ url = $url; ok = $false; error = $reason; metrics = @{ date_from = $dateFrom; date_to = $dateTo; error = $reason; current_range = $currentRange; expected_range = $expectedRange; date_applied = (Get-MetricValue $metrics "date_applied"); stage_log = $stageLog; page_url = (Get-MetricValue $metrics "page_url"); title = (Get-MetricValue $metrics "title"); via = "naver_ads_creative_report_cdp" } }) | Out-Null
							$done = $true
							break
						}
						Show-HostChrome -port $CdpPort | Out-Null
						if (-not (Wait-HostChromeLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
						Hide-HostChrome -port $CdpPort | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
						continue
					}
					if ((Get-MetricValue $metrics "clicked") -ne $true) {
						$downloadError = [string](Get-MetricValue $metrics "error")
						if ([string]::IsNullOrWhiteSpace($downloadError)) { $downloadError = "ads_creative_report_download_not_started" }
						throw $downloadError
					}
					$filePath = Wait-AdsCreativeReportDownload -After $downloadStartedAt -TimeoutSec 90
					$uploadResponse = Submit-AdsCreativeReportUpload -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -FilePath $filePath
					$metricsOut = @{
						date_from = $dateFrom
						date_to = $dateTo
						chunk_days = $chunkDays
						requested_date_from = $expectedDateFrom
						requested_date_to = $expectedDateTo
						download_file = (Split-Path -Leaf $filePath)
						upload_response = $uploadResponse
						via = "naver_ads_creative_report_cdp"
					}
					$collectedResults.Add(@{ url = $url; ok = $true; metrics = $metricsOut }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("ads_creative_report_cdp_uploaded: {0}~{1}" -f $dateFrom, $dateTo) -BearerToken $BearerToken | Out-Null
					$adsCreativeUiCompletedCount += 1
					$done = $true
				} catch {
					$msg = $_.Exception.Message
					$stageLog = $null
					$currentRange = ""
					$expectedRange = ""
					try {
						if ($null -ne $metrics) {
							$stageLog = Get-MetricValue $metrics "stage_log"
							$currentRange = [string](Get-MetricValue $metrics "current_range")
							$expectedRange = [string](Get-MetricValue $metrics "expected_range")
						}
					} catch {}
					Write-BackgroundStatus @{ running = $true; state = "ERROR_ADS_CREATIVE_REPORT"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; dateFrom = $dateFrom; dateTo = $dateTo; attempt = $attempt; error = $msg }
					$failedMetrics = @{ date_from = $dateFrom; date_to = $dateTo; error = $msg; via = "naver_ads_creative_report_cdp" }
					if ($null -ne $stageLog -and @($stageLog).Count -gt 0) {
						$failedMetrics["stage_log"] = $stageLog
						$failedMetrics["current_range"] = $currentRange
						$failedMetrics["expected_range"] = $expectedRange
					}
					$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = $failedMetrics }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $msg -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
			}
			if (-not $done) {
				$collectedResults.Add(@{ url = $url; ok = $false; error = "login_wait_timeout"; metrics = @{ date_from = $dateFrom; date_to = $dateTo; error = "login_wait_timeout"; via = "naver_ads_creative_report_cdp" } }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note "login_wait_timeout" -BearerToken $BearerToken | Out-Null
			}
		}
		Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		return
	}
	if ($mode -eq "ads_searchword_report_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		$jobDateFrom = [string]($Job.date_from ?? "")
		$jobDateTo = [string]($Job.date_to ?? "")
		$adsSearchwordPageReady = $false
		$adsSearchwordUiCompletedCount = 0
		foreach ($rawUrl in $urls) {
			$url = [string]($rawUrl ?? "")
			if ([string]::IsNullOrWhiteSpace($url)) { continue }
			$range = Get-AdsSearchwordReportRange $url
			$dateFrom = [string]($range.dateFrom ?? "")
			$dateTo = [string]($range.dateTo ?? "")
			$expectedDateFrom = if (-not [string]::IsNullOrWhiteSpace($jobDateFrom)) { $jobDateFrom } else { $dateFrom }
			$expectedDateTo = if (-not [string]::IsNullOrWhiteSpace($jobDateTo)) { $jobDateTo } else { $dateTo }
			$chunkDays = 0
			try {
				$chunkDays = ([datetime]::Parse($dateTo) - [datetime]::Parse($dateFrom)).Days + 1
			} catch {
				throw ("ads_searchword_invalid_chunk_range: {0}~{1}" -f $dateFrom, $dateTo)
			}
			if ($chunkDays -lt 1 -or $chunkDays -gt 7) {
				throw ("ads_searchword_chunk_exceeds_7_days: {0}~{1} ({2} days)" -f $dateFrom, $dateTo, $chunkDays)
			}
			$navUrl = Remove-AdsSearchwordReportRangeParams $url
			$attempt = 0
			$done = $false
			while ($attempt -lt 20 -and -not $done) {
				$attempt += 1
				try {
					Write-BackgroundStatus @{ running = $true; state = "SCRAPING_ADS_SEARCHWORD_REPORT"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $navUrl; dateFrom = $dateFrom; dateTo = $dateTo; chunkDays = $chunkDays; requestedDateFrom = $expectedDateFrom; requestedDateTo = $expectedDateTo; attempt = $attempt }
					$chromeAction = Start-HostChrome -port $CdpPort -startUrl $navUrl -profileDir "Default"
					$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
					if (-not $ready) { throw "cdp_port_not_open" }
					$shouldStepPrev = ($adsSearchwordUiCompletedCount -gt 0)
					if (-not $adsSearchwordPageReady) {
						Invoke-CdpNavigate -port $CdpPort -url $navUrl
						Start-Sleep -Seconds 7
						$adsSearchwordPageReady = $true
					} elseif ($shouldStepPrev) {
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("ads_searchword_keep_page_for_next_7day: {0}~{1}" -f $dateFrom, $dateTo) -BearerToken $BearerToken | Out-Null
						Start-Sleep -Milliseconds 800
					} else {
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("ads_searchword_keep_page_for_initial_7day: {0}~{1}" -f $dateFrom, $dateTo) -BearerToken $BearerToken | Out-Null
						Start-Sleep -Milliseconds 800
					}
					Invoke-CdpSetDownloadBehavior -port $CdpPort -downloadPath (Get-DownloadsDirectory)
					$downloadStartedAt = Get-Date
					$metricsItems = @(Invoke-AdsSearchwordReportDownload7DayStep -port $CdpPort -url $url -dateFrom $dateFrom -dateTo $dateTo -StepPrevOnly $shouldStepPrev)
					$metrics = if ($metricsItems.Count -gt 0) { $metricsItems[$metricsItems.Count - 1] } else { @{} }
					if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
					if ($null -eq $metrics) { throw "ads_searchword_report_cdp_empty_result" }
					if (Test-CollectorHumanActionRequired $metrics) {
						$reason = [string](Get-MetricValue $metrics "human_action_reason")
						if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
						Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; attempt = $attempt }
						$statusForReason = if ($reason -eq "login_required") { "LOGIN_REQUIRED" } else { "HUMAN_ACTION_REQUIRED" }
						$stageLog = Get-MetricValue $metrics "stage_log"
						$currentRange = [string](Get-MetricValue $metrics "current_range")
						$expectedRange = [string](Get-MetricValue $metrics "expected_range")
						$lastStage = ""
						try {
							$stageItems = @($stageLog)
							if ($stageItems.Count -gt 0) { $lastStage = [string](Get-MetricValue $stageItems[$stageItems.Count - 1] "stage") }
						} catch {}
						$eventNote = $reason
						if (-not [string]::IsNullOrWhiteSpace($lastStage)) { $eventNote = "$eventNote stage=$lastStage" }
						if (-not [string]::IsNullOrWhiteSpace($expectedRange)) { $eventNote = "$eventNote expected_range_set" }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status $statusForReason -Note $eventNote -BearerToken $BearerToken | Out-Null
						if ($reason -ne "login_required") {
							$collectedResults.Add(@{ url = $url; ok = $false; error = $reason; metrics = @{ date_from = $dateFrom; date_to = $dateTo; error = $reason; current_range = $currentRange; expected_range = $expectedRange; date_applied = (Get-MetricValue $metrics "date_applied"); stage_log = $stageLog; page_url = (Get-MetricValue $metrics "page_url"); title = (Get-MetricValue $metrics "title"); via = "naver_ads_searchword_report_cdp" } }) | Out-Null
							$done = $true
							break
						}
						Show-HostChrome -port $CdpPort | Out-Null
						if (-not (Wait-HostChromeLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
						Hide-HostChrome -port $CdpPort | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
						continue
					}
					if ((Get-MetricValue $metrics "clicked") -ne $true) {
						$downloadError = [string](Get-MetricValue $metrics "error")
						if ([string]::IsNullOrWhiteSpace($downloadError)) { $downloadError = "ads_searchword_report_download_not_started" }
						throw $downloadError
					}
					$filePath = Wait-AdsSearchwordReportDownload -After $downloadStartedAt -TimeoutSec 90
					$uploadResponse = Submit-AdsSearchwordReportUpload -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -FilePath $filePath -DateFrom $dateFrom -DateTo $dateTo
					$metricsOut = @{
						date_from = $dateFrom
						date_to = $dateTo
						chunk_days = $chunkDays
						requested_date_from = $expectedDateFrom
						requested_date_to = $expectedDateTo
						download_file = (Split-Path -Leaf $filePath)
						upload_response = $uploadResponse
						via = "naver_ads_searchword_report_cdp"
					}
					$collectedResults.Add(@{ url = $url; ok = $true; metrics = $metricsOut }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("ads_searchword_report_cdp_uploaded: {0}~{1}" -f $dateFrom, $dateTo) -BearerToken $BearerToken | Out-Null
					$adsSearchwordUiCompletedCount += 1
					$done = $true
				} catch {
					$msg = $_.Exception.Message
					$debugSnapshot = $null
					$stageLog = $null
					$currentRange = ""
					$expectedRange = ""
					$lastStage = ""
					try {
						if ($null -ne $metrics) {
							$stageLog = Get-MetricValue $metrics "stage_log"
							$currentRange = [string](Get-MetricValue $metrics "current_range")
							$expectedRange = [string](Get-MetricValue $metrics "expected_range")
							$stageItems = @($stageLog)
							if ($stageItems.Count -gt 0) { $lastStage = [string](Get-MetricValue $stageItems[$stageItems.Count - 1] "stage") }
						}
					} catch {}
					if ($msg -eq "cdp_eval_timeout") {
						try {
							$debugItems = @(Invoke-AdsSearchwordDebugSnapshot -port $CdpPort)
							if ($debugItems.Count -gt 0) { $debugSnapshot = $debugItems[$debugItems.Count - 1] }
							if ($null -eq $stageLog -or @($stageLog).Count -eq 0) {
								$stageLog = Get-MetricValue $debugSnapshot "stage_log"
								$currentRange = [string](Get-MetricValue $debugSnapshot "current_range")
								$expectedRange = [string](Get-MetricValue $debugSnapshot "expected_range")
								$stageItems = @($stageLog)
								if ($stageItems.Count -gt 0) { $lastStage = [string](Get-MetricValue $stageItems[$stageItems.Count - 1] "stage") }
							}
						} catch {}
					}
					$statusPayload = @{ running = $true; state = "ERROR_ADS_SEARCHWORD_REPORT"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; dateFrom = $dateFrom; dateTo = $dateTo; attempt = $attempt; error = $msg }
					if (-not [string]::IsNullOrWhiteSpace($lastStage)) { $statusPayload["lastStage"] = $lastStage }
					Write-BackgroundStatus $statusPayload
					$failedMetrics = @{ date_from = $dateFrom; date_to = $dateTo; error = $msg; via = "naver_ads_searchword_report_cdp" }
					if ($null -ne $stageLog -and @($stageLog).Count -gt 0) {
						$failedMetrics["stage_log"] = $stageLog
						$failedMetrics["current_range"] = $currentRange
						$failedMetrics["expected_range"] = $expectedRange
					}
					if ($null -ne $debugSnapshot) {
						$failedMetrics["debug_snapshot"] = $debugSnapshot
					}
					$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = $failedMetrics }) | Out-Null
					$eventNote = $msg
					if (-not [string]::IsNullOrWhiteSpace($lastStage)) { $eventNote = "$eventNote stage=$lastStage" }
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $eventNote -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
			}
			if (-not $done) {
				$collectedResults.Add(@{ url = $url; ok = $false; error = "login_wait_timeout"; metrics = @{ date_from = $dateFrom; date_to = $dateTo; error = "login_wait_timeout"; via = "naver_ads_searchword_report_cdp" } }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note "login_wait_timeout" -BearerToken $BearerToken | Out-Null
			}
		}
		Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		return
	}
	if ($mode -eq "review_reply_backfill_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		$totalTargets = 0
		try { $totalTargets = [int]($Job.params.total_targets ?? 0) } catch { $totalTargets = 0 }
		$batchSize = 15
		try { $batchSize = [int]($Job.params.batch_size ?? 15) } catch { $batchSize = 15 }
		if ($batchSize -le 0) { $batchSize = 15 }
		if ($totalTargets -le 0) { $totalTargets = $urls.Count * $batchSize }
		$processedTargets = 0
		$savedTargets = 0
		try { $savedTargets = [int]($Job.params.completed_offset ?? 0) } catch { $savedTargets = 0 }
		if ($savedTargets -lt 0) { $savedTargets = 0 }
		if ($savedTargets -gt $totalTargets) { $savedTargets = $totalTargets }
		$completedOffset = $savedTargets
		foreach ($rawUrl in $urls) {
			$url = [string]($rawUrl ?? "")
			if ([string]::IsNullOrWhiteSpace($url)) { continue }
			$targetIds = @(Get-ReviewReplyBackfillIdsFromUrl -url $url)
			$progressTargets = [Math]::Max(1, $targetIds.Count)
			$urlAttempt = 0
			$urlDone = $false
			while ($urlAttempt -lt 2 -and -not $urlDone) {
				$urlAttempt += 1
			try {
				Write-BackgroundStatus @{ running = $true; state = "SCRAPING_REVIEW_REPLY_BACKFILL"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; progress = $savedTargets; total = $totalTargets; processed = $processedTargets; targetCount = $targetIds.Count; attempt = $urlAttempt }
				$chromeAction = Start-HostChrome -port $CdpPort -startUrl $url -profileDir "Default"
				$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
				if (-not $ready) { throw "cdp_port_not_open" }
				Invoke-CdpNavigate -port $CdpPort -url $url
				Start-Sleep -Seconds 5
				$metricsItems = @(Invoke-ReviewReplyBackfillCdp -port $CdpPort -url $url -targetIds $targetIds)
				$metrics = if ($metricsItems.Count -gt 0) { $metricsItems[$metricsItems.Count - 1] } else { @{} }
				if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
				if ($null -eq $metrics) { throw "review_reply_backfill_cdp_empty_result" }
				if (Test-CollectorHumanActionRequired $metrics) {
					$reason = [string](Get-MetricValue $metrics "human_action_reason")
					if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
					Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; progress = $savedTargets; total = $totalTargets; processed = $processedTargets }
					$statusForReason = if ($reason -eq "login_required") { "LOGIN_REQUIRED" } else { "HUMAN_ACTION_REQUIRED" }
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status $statusForReason -Note $reason -BearerToken $BearerToken | Out-Null
					Show-HostChrome -port $CdpPort | Out-Null
					if (-not (Wait-HostChromeLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
					$metricsItems = @(Invoke-ReviewReplyBackfillCdp -port $CdpPort -url $url -targetIds $targetIds)
					$metrics = if ($metricsItems.Count -gt 0) { $metricsItems[$metricsItems.Count - 1] } else { @{} }
				}
				if ([string](Get-MetricValue $metrics "error")) {
					throw ([string](Get-MetricValue $metrics "error"))
				}
				$resultItem = @{ url = $url; ok = $true; metrics = $metrics }
				$collectedResults.Add($resultItem) | Out-Null
				$processedTargets = [Math]::Min($totalTargets, $processedTargets + $progressTargets)
				$partialSaved = 0
				try {
					$partialResponse = Submit-CollectorPartialResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($resultItem)
					try { $partialSaved = [int]($partialResponse.saved ?? 0) } catch { $partialSaved = 0 }
				} catch {
					Write-Warn ("review_reply_backfill partial save failed: {0}" -f $_.Exception.Message)
				}
				$savedTargets = [Math]::Min($totalTargets, $savedTargets + [Math]::Max(0, $partialSaved))
				$width = [Math]::Max(4, ([string]$totalTargets).Length)
				$processedOverall = [Math]::Min($totalTargets, $completedOffset + $processedTargets)
				$progressLabel = ("{0}/{1}" -f ([string]$processedOverall).PadLeft($width, "0"), ([string]$totalTargets).PadLeft($width, "0"))
				$savedLabel = ([string]$savedTargets).PadLeft($width, "0")
				$remainingLabel = ([string]([Math]::Max(0, $totalTargets - $savedTargets))).PadLeft($width, "0")
				Write-BackgroundStatus @{ running = $true; state = "SCRAPING_REVIEW_REPLY_BACKFILL"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; progress = $savedTargets; total = $totalTargets; processed = $processedTargets; targetCount = $targetIds.Count }
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("수집 진행개수 {0}, 저장개수 {1}, 남은 {2} review_reply_backfill_cdp_collected: {3}" -f $progressLabel, $savedLabel, $remainingLabel, ([string](Get-MetricValue $metrics "collected"))) -BearerToken $BearerToken | Out-Null
				$urlDone = $true
			} catch {
				$msg = $_.Exception.Message
				$isCdpTransient = ($msg -match "cdp_eval_timeout|cdp_eval_no_response|cdp_websocket_not_found|cdp_page_not_found|Inspected target navigated or closed")
				if ($isCdpTransient -and $urlAttempt -lt 2) {
					Write-BackgroundStatus @{ running = $true; state = "RESTARTING_REVIEW_REPLY_BACKFILL_CHROME"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; progress = $savedTargets; total = $totalTargets; processed = $processedTargets; targetCount = $targetIds.Count; attempt = $urlAttempt; error = $msg }
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note ("review_reply_backfill_cdp_restart_chrome_after_{0}" -f $msg) -BearerToken $BearerToken | Out-Null
					try { Stop-HostChrome -port $CdpPort } catch { Write-Warn ("review_reply_backfill chrome restart stop failed: {0}" -f $_.Exception.Message) }
					Start-Sleep -Seconds 3
					continue
				}
				$processedTargets = [Math]::Min($totalTargets, $processedTargets + $progressTargets)
				$width = [Math]::Max(4, ([string]$totalTargets).Length)
				$processedOverall = [Math]::Min($totalTargets, $completedOffset + $processedTargets)
				$progressLabel = ("{0}/{1}" -f ([string]$processedOverall).PadLeft($width, "0"), ([string]$totalTargets).PadLeft($width, "0"))
				$savedLabel = ([string]$savedTargets).PadLeft($width, "0")
				$remainingLabel = ([string]([Math]::Max(0, $totalTargets - $savedTargets))).PadLeft($width, "0")
				$failedItem = @{ url = $url; ok = $false; error = $msg; metrics = @{ error = $msg; via = "smartstore_review_reply_backfill_cdp"; target_count = $targetIds.Count; target_ids = @($targetIds) } }
				Write-BackgroundStatus @{ running = $true; state = "ERROR_REVIEW_REPLY_BACKFILL"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; progress = $savedTargets; total = $totalTargets; processed = $processedTargets; error = $msg }
				$collectedResults.Add($failedItem) | Out-Null
				try { Submit-CollectorPartialResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($failedItem) | Out-Null } catch { Write-Warn ("review_reply_backfill partial failure save failed: {0}" -f $_.Exception.Message) }
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note ("수집 진행개수 {0}, 저장개수 {1}, 남은 {2} {3}" -f $progressLabel, $savedLabel, $remainingLabel, $msg) -BearerToken $BearerToken | Out-Null
				$urlDone = $true
			}
			}
		}
		Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		return
	}
	if ($mode -eq "purchase_keywords_cdp") {
		$collectedResults = New-Object 'System.Collections.Generic.List[object]'
		foreach ($rawUrl in $urls) {
			$url = [string]($rawUrl ?? "")
			if ([string]::IsNullOrWhiteSpace($url)) { continue }
			$targetDate = Get-PurchaseKeywordTargetDate $url
			$attempt = 0
			$done = $false
			while ($attempt -lt 20 -and -not $done) {
				$attempt += 1
				try {
					Write-BackgroundStatus @{ running = $true; state = "SCRAPING_PURCHASE_KEYWORDS"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; date = $targetDate; attempt = $attempt }
					$smartstoreWarmupUrl = "https://accounts.commerce.naver.com/login?url=https%3A%2F%2Fsell.smartstore.naver.com%2F%23%2Flogin-callback"
					$startUrl = if ($attempt -eq 1) { $smartstoreWarmupUrl } else { $url }
					$chromeAction = Start-HostChrome -port $CdpPort -startUrl $startUrl -profileDir "Default"
					$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
					if (-not $ready) { throw "cdp_port_not_open" }
					if ($attempt -eq 1) {
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $smartstoreWarmupUrl -Status "RETRYING" -Note "smartstore_login_warmup_start" -BearerToken $BearerToken | Out-Null
						try {
							Invoke-CdpNavigate -port $CdpPort -url $smartstoreWarmupUrl
							Start-Sleep -Seconds 5
						} catch {}
						Show-HostChrome -port $CdpPort | Out-Null
						if (-not (Wait-HostChromeLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $smartstoreWarmupUrl)) { return }
						Hide-HostChrome -port $CdpPort | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "smartstore_login_warmup_done" -BearerToken $BearerToken | Out-Null
					}
					Invoke-CdpNavigate -port $CdpPort -url $url
					Start-Sleep -Seconds 7
					Invoke-CdpSetDownloadBehavior -port $CdpPort -downloadPath (Get-DownloadsDirectory)
					$downloadStartedAt = Get-Date
					$metricsItems = @(Invoke-PurchaseKeywordDownload -port $CdpPort -url $url -targetDate $targetDate)
					$metrics = if ($metricsItems.Count -gt 0) { $metricsItems[$metricsItems.Count - 1] } else { @{} }
					if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
					if ($null -eq $metrics) { throw "purchase_keyword_cdp_empty_result" }
					if (Test-CollectorHumanActionRequired $metrics) {
						$reason = [string](Get-MetricValue $metrics "human_action_reason")
						if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
						Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; attempt = $attempt }
						$statusForReason = if ($reason -eq "login_required") { "LOGIN_REQUIRED" } else { "HUMAN_ACTION_REQUIRED" }
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status $statusForReason -Note $reason -BearerToken $BearerToken | Out-Null
						if ($reason -ne "login_required") {
							$collectedResults.Add(@{ url = $url; ok = $false; error = $reason; metrics = @{ date = $targetDate; error = $reason; via = "smartstore_purchase_keyword_excel_cdp" } }) | Out-Null
							$done = $true
							break
						}
						Show-HostChrome -port $CdpPort | Out-Null
						if (-not (Wait-HostChromeLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
						Hide-HostChrome -port $CdpPort | Out-Null
						Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
						continue
					}
					if ((Get-MetricValue $metrics "clicked") -ne $true) {
						$downloadError = [string](Get-MetricValue $metrics "error")
						if ([string]::IsNullOrWhiteSpace($downloadError)) { $downloadError = "excel_download_not_started" }
						throw $downloadError
					}
					$filePath = Wait-PurchaseKeywordDownload -After $downloadStartedAt -TimeoutSec 90
					$uploadResponse = Submit-PurchaseKeywordUpload -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -FilePath $filePath -TargetDate $targetDate
					$metricsOut = @{
						date = $targetDate
						download_file = (Split-Path -Leaf $filePath)
						upload_response = $uploadResponse
						via = "smartstore_purchase_keyword_excel_cdp"
					}
					$collectedResults.Add(@{ url = $url; ok = $true; metrics = $metricsOut }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("purchase_keywords_cdp_uploaded: {0}" -f $targetDate) -BearerToken $BearerToken | Out-Null
					$done = $true
				} catch {
					$msg = $_.Exception.Message
					Write-BackgroundStatus @{ running = $true; state = "ERROR_PURCHASE_KEYWORDS"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; date = $targetDate; attempt = $attempt; error = $msg }
					$collectedResults.Add(@{ url = $url; ok = $false; error = $msg; metrics = @{ date = $targetDate; error = $msg; via = "smartstore_purchase_keyword_excel_cdp" } }) | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $msg -BearerToken $BearerToken | Out-Null
					$done = $true
					break
				}
			}
			if (-not $done) {
				$collectedResults.Add(@{ url = $url; ok = $false; error = "login_wait_timeout"; metrics = @{ date = $targetDate; error = "login_wait_timeout" } }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note "login_wait_timeout" -BearerToken $BearerToken | Out-Null
			}
		}
		Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
		return
	}
	$collectedResults = New-Object 'System.Collections.Generic.List[object]'
	foreach ($rawUrl in $urls) {
		if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) {
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $null -Status "CANCELLED" -Note "user_cancelled" -BearerToken $BearerToken | Out-Null
			return
		}
		$url = [string]($rawUrl ?? "")
		if ([string]::IsNullOrWhiteSpace($url)) { continue }
		$attempt = 0
		while ($attempt -lt 20) {
			$attempt += 1
			Write-BackgroundStatus @{ running = $true; state = "SCRAPING"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; attempt = $attempt }
			$chromeAction = Start-HostChrome -port $CdpPort -startUrl $url -profileDir "Default"
			$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
			if (-not $ready) { throw "cdp_port_not_open" }
			if ($mode -eq "purchase_keywords_cdp") {
				$targetDate = Get-PurchaseKeywordTargetDate $url
				$downloadStartedAt = Get-Date
				$metricsItems = @(Invoke-PurchaseKeywordDownload -port $CdpPort -url $url -targetDate $targetDate)
				$metrics = if ($metricsItems.Count -gt 0) { $metricsItems[$metricsItems.Count - 1] } else { @{} }
				if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
				if (Test-CollectorHumanActionRequired $metrics) {
					$reason = [string](Get-MetricValue $metrics "human_action_reason")
					if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
					Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; attempt = $attempt }
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "LOGIN_REQUIRED" -Note $reason -BearerToken $BearerToken | Out-Null
					Show-HostChrome -port $CdpPort | Out-Null
					if (-not (Wait-HostChromeLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
					Hide-HostChrome -port $CdpPort | Out-Null
					Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
					continue
				}
				if ((Get-MetricValue $metrics "clicked") -ne $true) { throw ([string](Get-MetricValue $metrics "error")) }
				$filePath = Wait-PurchaseKeywordDownload -After $downloadStartedAt -TimeoutSec 90
				$uploadResponse = Submit-PurchaseKeywordUpload -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -FilePath $filePath -TargetDate $targetDate
				$metricsOut = @{
					date = $targetDate
					download_file = (Split-Path -Leaf $filePath)
					upload_response = $uploadResponse
					via = "smartstore_purchase_keyword_excel_cdp"
				}
				Submit-CollectorResult -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Url $url -Metrics $metricsOut | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note ("purchase_keywords_cdp_uploaded: {0}" -f $targetDate) -BearerToken $BearerToken | Out-Null
				break
			}
			try {
				$metricsItems = @(Invoke-LocalPageMetricsScrape -port $CdpPort -url $url)
				$metrics = if ($metricsItems.Count -gt 0) { $metricsItems[$metricsItems.Count - 1] } else { @{} }
				if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
			} catch {
				$metrics = @{ error = $_.Exception.Message; via = "local_collector_cdp_dom" }
				$collectedResults.Add(@{ url = $url; ok = $false; error = $_.Exception.Message; metrics = $metrics }) | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note $_.Exception.Message -BearerToken $BearerToken | Out-Null
				break
			}
			if (Test-CollectorHumanActionRequired $metrics) {
				$reason = [string](Get-MetricValue $metrics "human_action_reason")
				if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "human_action_required" }
				Write-BackgroundStatus @{ running = $true; state = "WAITING_USER"; apiBaseUrl = $ApiBaseUrl; jobId = $jobId; url = $url; reason = $reason; attempt = $attempt }
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "LOGIN_REQUIRED" -Note $reason -BearerToken $BearerToken | Out-Null
				Show-HostChrome -port $CdpPort | Out-Null
				if (-not (Wait-HostChromeLoginOrCancel -port $CdpPort -targetUrl $url -TimeoutSec 3600 -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -JobId $jobId -Url $url)) { return }
				Hide-HostChrome -port $CdpPort | Out-Null
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "RETRYING" -Note "login_completed_resume" -BearerToken $BearerToken | Out-Null
				continue
			}
			$collectedResults.Add(@{ url = $url; ok = $true; metrics = $metrics }) | Out-Null
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "DONE" -Note "background_collector_saved" -BearerToken $BearerToken | Out-Null
			break
		}
		if ($attempt -ge 20) {
			$collectedResults.Add(@{ url = $url; ok = $false; error = "login_wait_timeout"; metrics = @{ error = "login_wait_timeout" } }) | Out-Null
			Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $url -Status "FAILED" -Note "login_wait_timeout" -BearerToken $BearerToken | Out-Null
		}
	}
	if (Test-CollectorJobCancelled -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken) {
		Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId $jobId -DeviceId $DeviceId -Url $null -Status "CANCELLED" -Note "user_cancelled" -BearerToken $BearerToken | Out-Null
		return
	}
	Submit-CollectorResults -ApiBaseUrl $ApiBaseUrl -JobId $jobId -BearerToken $BearerToken -Results @($collectedResults.ToArray()) | Out-Null
}

function Invoke-CollectorBackgroundWorker([string]$ApiBaseUrl, [string]$BearerToken, [string]$DeviceId) {
	if ([string]::IsNullOrWhiteSpace($ApiBaseUrl)) { throw "apiBaseUrl_required" }
	if ([string]::IsNullOrWhiteSpace($DeviceId)) { $DeviceId = "host-agent-$env:COMPUTERNAME" }
	$pidPath = Get-BackgroundPidPath
	[System.IO.File]::WriteAllText($pidPath, [string]$PID)
	Write-BackgroundStatus @{ running = $true; state = "STARTED"; apiBaseUrl = $ApiBaseUrl; deviceId = $DeviceId }
	$lastHeartbeatUtc = [DateTime]::MinValue
	$consecutiveAuthFailures = 0
	$consecutiveErrors = 0
	while ($true) {
		try {
			Write-BackgroundStatus @{ running = $true; state = "POLLING"; apiBaseUrl = $ApiBaseUrl; deviceId = $DeviceId }
			$headers = New-CollectorApiHeaders -BearerToken $BearerToken
			if ((([DateTime]::UtcNow) - $lastHeartbeatUtc).TotalSeconds -ge 300) {
				Send-CollectorEvent -ApiBaseUrl $ApiBaseUrl -JobId "" -DeviceId $DeviceId -Url "" -Status "READY" -Note "background_collector_heartbeat" -BearerToken $BearerToken | Out-Null
				$lastHeartbeatUtc = [DateTime]::UtcNow
			}
			$nextUri = $ApiBaseUrl.TrimEnd("/") + "/search-rank/page-metrics/local-collector/jobs/next?device_id=" + [Uri]::EscapeDataString($DeviceId)
			$job = Invoke-RestMethod -Method Get -Uri $nextUri -Headers $headers -TimeoutSec 20
			$consecutiveAuthFailures = 0
			$consecutiveErrors = 0
			if ($job -and $job.job_id) {
				Invoke-CollectorJob -ApiBaseUrl $ApiBaseUrl -BearerToken $BearerToken -DeviceId $DeviceId -Job $job
			} else {
				Start-Sleep -Seconds 10
			}
		} catch {
			$msg = $_.Exception.Message
			$isAuthFailure = ($msg -match "401|Unauthorized|unauthorized")
			if ($isAuthFailure) {
				$consecutiveAuthFailures += 1
				$consecutiveErrors = 0
			} else {
				$consecutiveErrors += 1
				$consecutiveAuthFailures = 0
			}
			$state = if ($isAuthFailure -and $consecutiveAuthFailures -lt 3) { "POLLING_RETRY" } elseif ($isAuthFailure) { "AUTH_EXPIRED" } else { "ERROR" }
			Write-BackgroundStatus @{ running = $true; state = $state; apiBaseUrl = $ApiBaseUrl; deviceId = $DeviceId; error = $msg; authFailureCount = $consecutiveAuthFailures; errorCount = $consecutiveErrors; collectorTokenConfigured = (-not [string]::IsNullOrWhiteSpace($script:CollectorWorkerToken)) }
			Write-Warn ("background collector error: {0}" -f $msg)
			if ($state -eq "AUTH_EXPIRED") {
				Write-BackgroundStatus @{ running = $false; state = "AUTH_EXPIRED"; apiBaseUrl = $ApiBaseUrl; deviceId = $DeviceId; error = $msg; authFailureCount = $consecutiveAuthFailures; errorCount = $consecutiveErrors; collectorTokenConfigured = (-not [string]::IsNullOrWhiteSpace($script:CollectorWorkerToken)); stoppedReason = "auth_expired" }
				try { Remove-Item -LiteralPath (Get-BackgroundPidPath) -Force -ErrorAction SilentlyContinue } catch {}
				break
			}
			Start-Sleep -Seconds 10
		}
	}
}

function Stop-HostChrome([int]$port) {
	# 중요: 자식 pwsh를 WindowStyle Hidden으로 띄우면 일부 PC에서 0xc0000142 등으로 실패해
	# Chrome이 종료되지 않은 채 Host Agent만 /shutdown 되는 경우가 있다.
	# → 동일 프로세스에서 stop 스크립트를 직접 호출한다( collect-via-modal / run-with-host-chrome 과 동일).
	try {
		& $stopScript -Port $port -UserDataDir $script:HostChromeUserDataDir -Force
	} catch {
		Write-Warn ("stop-host-chrome.ps1 실패: {0}" -f $_.Exception.Message)
		throw
	}
}

function Remove-HostAgentAutoStart {
	# 예전 설치본이 남긴 작업 스케줄러가 있으면 force-stop 뒤에도 Host Agent 창이 다시 뜰 수 있다.
	# force-stop 전용 종료에서는 자동 실행 등록 자체를 지워 재발을 막는다.
	$removed = New-Object 'System.Collections.Generic.List[string]'
	foreach ($taskName in @("ERP2-Analytics Host Agent (ensure)", "ERP2-Analytics Host Agent")) {
		try {
			& schtasks.exe /Query /TN "$taskName" | Out-Null
			if ($LASTEXITCODE -eq 0) {
				& schtasks.exe /Delete /TN "$taskName" /F | Out-Null
				if ($LASTEXITCODE -eq 0) { $removed.Add($taskName) | Out-Null }
			}
		} catch {
			# ignore
		}
	}
	return @($removed)
}

function Get-StartHostChromeBridgeHtml {
	return @'
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ERP2 Analytics Host Bridge</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; }
    main { max-width: 720px; margin: 48px auto; padding: 24px; line-height: 1.6; }
    .card { background: rgba(15,23,42,.72); border: 1px solid rgba(148,163,184,.25); border-radius: 14px; padding: 20px; }
    .muted { color: #94a3b8; font-size: 13px; }
    .ok { color: #86efac; }
    .err { color: #fca5a5; white-space: pre-wrap; }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <h2 id="title">Host Chrome 준비 중...</h2>
      <div id="detail" class="muted">로컬 브리지에서 Host Agent를 호출하고 있습니다.</div>
    </div>
  </main>
  <script>
    (() => {
      const MESSAGE_TYPE = 'erp2-analytics-host-agent-bridge';
      const titleEl = document.getElementById('title');
      const detailEl = document.getElementById('detail');
      const params = new URLSearchParams(window.location.search);
      const port = params.get('port') || '9223';
      const profileDir = params.get('profile_dir') || 'Default';
      const startUrl = params.get('start_url') || 'https://search.shopping.naver.com/';
      const openerOrigin = params.get('opener_origin') || '*';

      const render = (title, detail, cls) => {
        if (titleEl) {
          titleEl.textContent = title;
          titleEl.className = cls || '';
        }
        if (detailEl) {
          detailEl.textContent = detail;
          detailEl.className = cls === 'err' ? 'err' : 'muted';
        }
      };

      const send = (payload) => {
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(
              { type: MESSAGE_TYPE, action: 'start-host-chrome', ...payload },
              openerOrigin === '*' ? '*' : openerOrigin,
            );
          }
        } catch {
          try {
            if (window.opener && !window.opener.closed) {
              window.opener.postMessage({ type: MESSAGE_TYPE, action: 'start-host-chrome', ...payload }, '*');
            }
          } catch {}
        }
      };

      const qs = new URLSearchParams({
        port,
        profile_dir: profileDir,
        start_url: startUrl,
      });

      fetch(`/start-host-chrome?${qs.toString()}`, {
        method: 'POST',
        cache: 'no-store',
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ready !== true) {
            const detail = String(data.error || data.hint || `HTTP ${res.status}`).trim();
            render('Host Chrome 준비 실패', detail || 'localhost 브리지에서 Host Chrome 준비 완료를 확인하지 못했습니다.', 'err');
            send({ ok: false, ready: false, error: detail || `HTTP ${res.status}` });
            return;
          }
          render('Host Chrome 준비 완료', '원래 페이지가 이어서 이 창을 사용합니다. 잠시만 기다려 주세요.', 'ok');
          send({ ok: true, ready: true, port: Number(port) || 9223 });
        })
        .catch((error) => {
          const detail = String(error && error.message ? error.message : error || '').trim();
          render('Host Chrome 준비 실패', detail || 'localhost 브리지에서 Host Agent 호출에 실패했습니다.', 'err');
          send({ ok: false, ready: false, error: detail || 'bridge_fetch_failed' });
        });
    })();
  </script>
</body>
</html>
'@
}

function Get-CollectorBackgroundBridgeHtml {
	return @'
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ERP2 Analytics Collector Bridge</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; }
    main { max-width: 720px; margin: 48px auto; padding: 24px; line-height: 1.6; }
    .card { background: rgba(15,23,42,.72); border: 1px solid rgba(148,163,184,.25); border-radius: 14px; padding: 20px; }
    .muted { color: #94a3b8; font-size: 13px; }
    .ok { color: #86efac; }
    .err { color: #fca5a5; white-space: pre-wrap; }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <h2 id="title">Collector 브리지 대기 중...</h2>
      <div id="detail" class="muted">원래 Analytics 화면에서 명령을 기다리고 있습니다.</div>
    </div>
  </main>
  <script>
    (() => {
      const MESSAGE_TYPE = 'erp2-analytics-host-agent-bridge';
      const titleEl = document.getElementById('title');
      const detailEl = document.getElementById('detail');
      const params = new URLSearchParams(window.location.search);
      const openerOrigin = params.get('opener_origin') || '*';

      const render = (title, detail, cls) => {
        if (titleEl) {
          titleEl.textContent = title;
          titleEl.className = cls || '';
        }
        if (detailEl) {
          detailEl.textContent = detail;
          detailEl.className = cls === 'err' ? 'err' : 'muted';
        }
      };

      const send = (payload) => {
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(
              { type: MESSAGE_TYPE, action: 'collector-background', ...payload },
              openerOrigin === '*' ? '*' : openerOrigin,
            );
          }
        } catch {
          try {
            if (window.opener && !window.opener.closed) {
              window.opener.postMessage({ type: MESSAGE_TYPE, action: 'collector-background', ...payload }, '*');
            }
          } catch {}
        }
      };

      const runCommand = async (command) => {
        const name = String(command && command.command || '').trim();
        if (!['status', 'start', 'stop', 'selfUpdate'].includes(name)) {
          throw new Error('unsupported_collector_bridge_command');
        }
        if (name === 'status') {
          const [healthRes, statusRes] = await Promise.all([
            fetch('/health', { cache: 'no-store' }),
            fetch('/collector/background/status', { cache: 'no-store' }),
          ]);
          const health = await healthRes.json().catch(() => ({}));
          const status = await statusRes.json().catch(() => ({}));
          if (!healthRes.ok) throw new Error(`health_http_${healthRes.status}`);
          return { ok: true, health, status };
        }
        if (name === 'stop') {
          const res = await fetch('/collector/background/stop', { method: 'POST', cache: 'no-store' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ok !== true) throw new Error(String(data.error || `stop_http_${res.status}`));
          return { ok: true, result: data };
        }
        if (name === 'selfUpdate') {
          const body = {
            installerUrl: String(command.installerUrl || ''),
            expectedVersion: String(command.expectedVersion || ''),
            expectedManageNo: String(command.expectedManageNo || ''),
          };
          const res = await fetch('/self-update', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ok !== true) throw new Error(String(data.error || `self_update_http_${res.status}`));
          return { ok: true, result: data };
        }
        const body = {
          apiBaseUrl: String(command.apiBaseUrl || ''),
          bearerToken: String(command.bearerToken || ''),
          collectorToken: String(command.collectorToken || ''),
          deviceId: String(command.deviceId || 'settings-data-collection'),
          chromeUserDataDir: String(command.chromeUserDataDir || ''),
          chromeProfileDir: String(command.chromeProfileDir || ''),
          chromeProfileLabel: String(command.chromeProfileLabel || ''),
        };
        const res = await fetch('/collector/background/start', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok !== true) throw new Error(String(data.error || `start_http_${res.status}`));
        return { ok: true, result: data };
      };

      window.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.type !== MESSAGE_TYPE || data.action !== 'collector-background-command') return;
        render('Collector 명령 실행 중...', String(data.command || ''), 'muted');
        runCommand(data)
          .then((result) => {
            render('Collector 명령 완료', '원래 Analytics 화면으로 결과를 전달했습니다.', 'ok');
            send({ ok: true, requestId: data.requestId || '', command: data.command || '', ...result });
            window.setTimeout(() => window.close(), 600);
          })
          .catch((error) => {
            const detail = String(error && error.message ? error.message : error || '').trim();
            render('Collector 명령 실패', detail || 'collector_bridge_failed', 'err');
            send({ ok: false, requestId: data.requestId || '', command: data.command || '', error: detail || 'collector_bridge_failed' });
          });
      });

      render('Collector 브리지 준비됨', '원래 Analytics 화면에서 명령을 전송합니다.', 'ok');
      send({ ok: true, ready: true });
    })();
  </script>
</body>
</html>
'@
}

if ($BackgroundWorker) {
	$script:CollectorWorkerToken = [string]($WorkerCollectorToken ?? "")
	Invoke-CollectorBackgroundWorker -ApiBaseUrl $WorkerApiBaseUrl -BearerToken $WorkerBearerToken -DeviceId $WorkerDeviceId
	exit 0
}

$listener = New-Object System.Net.HttpListener
# 로컬 전용(보안): 127.0.0.1만 바인딩
$prefix = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix)

Write-Info "Host agent listening: $prefix"
Write-Info "Endpoints: GET /health, GET /version, GET /network-info, GET /bridge/start-host-chrome, GET /bridge/collector-background, GET/POST /collector/background/*, POST /self-update, POST /start-host-chrome, POST /collector/run-once, POST /stop-host-chrome, POST /menu-sync/export, POST /menu-sync/push, POST /menu-sync/import, POST /menu-sync/reconcile, POST /menu-sync/tracking-gap-analyze, POST /menu-sync/tracking-gap-push, POST /shutdown[?cleanup=1]"
Write-Info "Default CDP port: $CdpPort"
Write-Info "Repo root: $repoRoot"

try {
	$listener.Start()
} catch {
	Write-Host ""
	Write-Host "❌ Host agent failed to start HttpListener." -ForegroundColor Red
	Write-Host (" - prefix: {0}" -f $prefix) -ForegroundColor Red
	Write-Host (" - error: {0}" -f $_.Exception.Message) -ForegroundColor Red
	Write-Host ""
	Write-Host "가능한 원인/해결:" -ForegroundColor Yellow
	Write-Host "  1) 포트 충돌(9230 사용 중) → 다른 포트로 실행: .\tools\start-host-agent.ps1 -Port 9231" -ForegroundColor Yellow
	Write-Host "  2) URL ACL 권한 문제(Access is denied) → 관리자 PowerShell에서 URLACL 등록:" -ForegroundColor Yellow
	Write-Host ("     netsh http add urlacl url={0} user=%USERDOMAIN%\\%USERNAME%" -f $prefix) -ForegroundColor Yellow
	Write-Host "  3) 보안SW/정책 차단 → 보안 예외 필요" -ForegroundColor Yellow
	Write-Host ""
	Read-Host -Prompt "Enter 키를 누르면 종료됩니다"
	exit 1
}

try {
	while ($true) {
		$ctx = $null
		try {
			$ctx = $listener.GetContext()
			$path = ("" + $ctx.Request.Url.AbsolutePath).Trim().ToLowerInvariant()
			$method = ("" + $ctx.Request.HttpMethod).Trim().ToUpperInvariant()
			if ($method -eq "OPTIONS") {
				# preflight
				Send-Json $ctx 204 @{ ok = $true }
				continue
			}

			if ($method -eq "GET" -and $path -eq "/health") {
				Send-Json $ctx 200 @{ ok = $true; agent = "erp2-analytics-host-agent"; agentVersion = $AgentVersion; agentManageNo = $AgentManageNo; collectorVersion = $AgentVersion; collectorManageNo = $AgentManageNo; port = $Port; cdpPort = $CdpPort; installMode = $HostAgentInstallMode; menuSyncSupported = $MenuSyncSupported; capabilities = @{ collector = $true; hostChrome = $true; menuSync = $MenuSyncSupported }; chromeUserDataDir = $script:HostChromeUserDataDir; chromeProfileDir = $script:HostChromeProfileDir; chromeProfileLabel = $script:HostChromeProfileLabel; time = (Get-Date).ToString("s") }
				continue
			}

			if ($method -eq "GET" -and $path -eq "/version") {
				Send-Json $ctx 200 @{ ok = $true; agent = "erp2-analytics-host-agent"; agentVersion = $AgentVersion; agentManageNo = $AgentManageNo; collectorVersion = $AgentVersion; collectorManageNo = $AgentManageNo; port = $Port; cdpPort = $CdpPort; installMode = $HostAgentInstallMode; menuSyncSupported = $MenuSyncSupported; capabilities = @{ collector = $true; hostChrome = $true; menuSync = $MenuSyncSupported }; chromeUserDataDir = $script:HostChromeUserDataDir; chromeProfileDir = $script:HostChromeProfileDir; chromeProfileLabel = $script:HostChromeProfileLabel }
				continue
			}

			if ($method -eq "GET" -and $path -eq "/chrome/profiles") {
				$profiles = @(Get-LocalChromeProfiles)
				Send-Json $ctx 200 @{
					ok = $true
					profiles = $profiles
					count = $profiles.Count
					warning = "일반 Chrome 프로필을 직접 CDP로 쓰려면 일반 Chrome을 먼저 종료해야 합니다. 더 안전한 운영 방식은 전용 ERP2 CDP 프로필을 만들고 해당 계정으로 로그인하는 것입니다."
				}
				continue
			}

			if ($method -eq "GET" -and $path -eq "/network-info") {
				$candidates = @(Get-CandidateLocalIpv4s)
				$primaryIp = Get-PrimaryLocalIpv4
				Send-Json $ctx 200 @{
					ok = $true
					primaryIp = $primaryIp
					candidates = @($candidates | ForEach-Object { [string]$_.IPAddress })
				}
				continue
			}

			if ($method -eq "GET" -and $path -eq "/bridge/start-host-chrome") {
				Send-Html $ctx 200 (Get-StartHostChromeBridgeHtml)
				continue
			}

			if ($method -eq "GET" -and $path -eq "/bridge/collector-background") {
				Send-Html $ctx 200 (Get-CollectorBackgroundBridgeHtml)
				continue
			}

			if ($method -eq "GET" -and $path -eq "/collector/background/status") {
				Send-Json $ctx 200 (Read-BackgroundStatus)
				continue
			}

			if ($method -eq "POST" -and $path -eq "/collector/background/start") {
				try {
					$body = Read-JsonBody $ctx
					$apiBaseUrl = Get-BodyStringValue $body "apiBaseUrl" "http://localhost:5189"
					$bearerToken = Get-BodyStringValue $body "bearerToken" ""
					$collectorToken = Get-BodyStringValue $body "collectorToken" ""
					$deviceId = Get-BodyStringValue $body "deviceId" ("host-agent-" + $env:COMPUTERNAME)
					$chromeUserDataDir = Get-BodyStringValue $body "chromeUserDataDir" $UserDataDir
					$chromeProfileDir = Get-BodyStringValue $body "chromeProfileDir" "Default"
					$chromeProfileLabel = Get-BodyStringValue $body "chromeProfileLabel" ""
					if ([string]::IsNullOrWhiteSpace($chromeUserDataDir)) { $chromeUserDataDir = $UserDataDir }
					$chromeUserDataDir = [Environment]::ExpandEnvironmentVariables($chromeUserDataDir)
					if ([string]::IsNullOrWhiteSpace($chromeProfileDir)) { $chromeProfileDir = "Default" }
					Write-BackgroundConfig @{ apiBaseUrl = $apiBaseUrl; bearerToken = $bearerToken; collectorToken = $collectorToken; deviceId = $deviceId; chromeUserDataDir = $chromeUserDataDir; chromeProfileDir = $chromeProfileDir; chromeProfileLabel = $chromeProfileLabel }
					$current = Read-BackgroundStatus
					if ($current["running"] -eq $true) {
						$currentVersion = [string]($current["agentVersion"] ?? "")
						$currentManageNo = [string]($current["agentManageNo"] ?? "")
						$currentApiBaseUrl = ([string]($current["apiBaseUrl"] ?? "")).TrimEnd("/")
						$requestedApiBaseUrl = ([string]$apiBaseUrl).TrimEnd("/")
						$currentDeviceId = [string]($current["deviceId"] ?? "")
						$currentChromeUserDataDir = [string]($current["chromeUserDataDir"] ?? "")
						$currentChromeProfileDir = [string]($current["chromeProfileDir"] ?? "")
						$sameProfileTarget = ($currentChromeUserDataDir -eq $chromeUserDataDir) -and ($currentChromeProfileDir -eq $chromeProfileDir)
						$sameWorkerTarget = ($currentApiBaseUrl -eq $requestedApiBaseUrl) -and ($currentDeviceId -eq $deviceId) -and $sameProfileTarget
						$currentState = ([string]($current["state"] ?? "")).ToUpperInvariant()
						$currentUpdatedAt = [string]($current["updated_at"] ?? "")
						$isPollingState = $currentState -in @("STARTED", "POLLING", "POLLING_RETRY", "AUTH_EXPIRED", "ERROR")
						$isFreshPolling = $false
						try {
							if (-not [string]::IsNullOrWhiteSpace($currentUpdatedAt)) {
								$updatedAt = [DateTime]::Parse($currentUpdatedAt)
								$isFreshPolling = (((Get-Date) - $updatedAt).TotalSeconds -lt 60)
							}
						} catch {
							$isFreshPolling = $false
						}
						# WAITING_USER/SCRAPING_* can legitimately stay in one state for a long time.
						# Plain polling must heartbeat every loop; a stale polling timestamp means the
						# worker process is alive but no longer claiming jobs.
						$canReuseWorker = -not $isPollingState -or $isFreshPolling
						if ($currentVersion -eq $AgentVersion -and $currentManageNo -eq $AgentManageNo -and $sameWorkerTarget -and $canReuseWorker) {
							Send-Json $ctx 200 @{ ok = $true; action = "collector-background-start"; reused = $true; status = $current }
							continue
						}
						$pidText0 = [string]($current["pid"] ?? "")
						if ($pidText0) {
							try { Stop-Process -Id ([int]$pidText0) -Force -ErrorAction SilentlyContinue } catch {}
						}
					}
					$pidPath = Get-BackgroundPidPath
					$statusPath = Get-BackgroundStatusPath
					try { if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue } } catch {}
					try { if (Test-Path -LiteralPath $statusPath) { Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue } } catch {}
					$args = @(
						"-NoProfile",
						"-ExecutionPolicy", "Bypass",
						"-File", $PSCommandPath,
						"-Port", $Port,
						"-CdpPort", $CdpPort,
						"-UserDataDir", $UserDataDir,
						"-BackgroundWorker",
						"-WorkerApiBaseUrl", $apiBaseUrl,
						"-WorkerDeviceId", $deviceId,
						"-WorkerHostChromeUserDataDir", $chromeUserDataDir,
						"-WorkerChromeProfileDir", $chromeProfileDir
					)
					if (-not [string]::IsNullOrWhiteSpace($bearerToken)) { $args += @("-WorkerBearerToken", $bearerToken) }
					if (-not [string]::IsNullOrWhiteSpace($collectorToken)) { $args += @("-WorkerCollectorToken", $collectorToken) }
					if (-not [string]::IsNullOrWhiteSpace($chromeProfileLabel)) { $args += @("-WorkerChromeProfileLabel", $chromeProfileLabel) }
					$pwshExe = Resolve-PowerShellExe
					$proc = Start-Process -FilePath $pwshExe -ArgumentList (ConvertTo-ProcessArgumentLine $args) -WindowStyle Hidden -PassThru
					Start-Sleep -Milliseconds 500
					Send-Json $ctx 200 @{ ok = $true; action = "collector-background-start"; pid = $proc.Id; apiBaseUrl = $apiBaseUrl; deviceId = $deviceId; chromeUserDataDir = $chromeUserDataDir; chromeProfileDir = $chromeProfileDir; chromeProfileLabel = $chromeProfileLabel }
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "collector-background-start"; error = ($_.Exception.Message) }
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/self-update") {
				try {
					$body = Read-JsonBody $ctx
					$installerUrl = Get-BodyStringValue $body "installerUrl" ""
					$expectedVersion = Get-BodyStringValue $body "expectedVersion" ""
					$result = Start-HostAgentSelfUpdate -InstallerUrl $installerUrl -ExpectedVersion $expectedVersion -port $Port -cdpPort $CdpPort
					Send-Json $ctx 202 $result
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "self-update"; error = ($_.Exception.Message) }
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/collector/background/stop") {
				try {
					$status = Read-BackgroundStatus
					$pidText = [string]($status["pid"] ?? "")
					if ($pidText) {
						try { Stop-Process -Id ([int]$pidText) -Force -ErrorAction SilentlyContinue } catch {}
					}
					try { Remove-Item -LiteralPath (Get-BackgroundPidPath) -Force -ErrorAction SilentlyContinue } catch {}
					try { Remove-Item -LiteralPath (Get-BackgroundConfigPath) -Force -ErrorAction SilentlyContinue } catch {}
					Write-BackgroundStatus @{ running = $false; state = "STOPPED" }
					Send-Json $ctx 200 @{ ok = $true; action = "collector-background-stop"; previous = $status }
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "collector-background-stop"; error = ($_.Exception.Message) }
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/start-host-chrome") {
				$q = Get-QueryMap $ctx
				$body = @{}
				try { $body = Read-JsonBody $ctx } catch { $body = @{} }
				$targetCdpPort = $CdpPort
				try {
					if ($q.ContainsKey("port") -and $q["port"]) { $targetCdpPort = [int]$q["port"] }
				} catch {}
				$startUrl = ""
				try {
					if ($q.ContainsKey("start_url")) { $startUrl = "" + ($q["start_url"] ?? "") }
				} catch {}
				if ([string]::IsNullOrWhiteSpace($startUrl)) { $startUrl = Get-BodyStringValue $body "startUrl" "" }
				$profileDir = "Default"
				try {
					if ($q.ContainsKey("profile_dir") -and $q["profile_dir"]) { $profileDir = "" + ($q["profile_dir"] ?? "Default") }
				} catch {}
				$profileDir = Get-BodyStringValue $body "chromeProfileDir" $profileDir
				$chromeUserDataDir = Get-BodyStringValue $body "chromeUserDataDir" $script:HostChromeUserDataDir
				$chromeProfileLabel = Get-BodyStringValue $body "chromeProfileLabel" $script:HostChromeProfileLabel
				if ([string]::IsNullOrWhiteSpace($chromeUserDataDir)) { $chromeUserDataDir = $UserDataDir }
				$chromeUserDataDir = [Environment]::ExpandEnvironmentVariables($chromeUserDataDir)
				if ([string]::IsNullOrWhiteSpace($profileDir)) { $profileDir = "Default" }
				$previousUserDataDir = $script:HostChromeUserDataDir
				$previousProfileDir = $script:HostChromeProfileDir
				$previousProfileLabel = $script:HostChromeProfileLabel
				try {
					$script:HostChromeUserDataDir = $chromeUserDataDir
					$script:HostChromeProfileDir = $profileDir
					$script:HostChromeProfileLabel = $chromeProfileLabel
					$chromeAction = Start-HostChrome -port $targetCdpPort -startUrl $startUrl -profileDir $profileDir -Background $false
					$ready = Wait-CdpReady -port $targetCdpPort -timeoutMs 7000
					if (-not $ready) {
						Send-Json $ctx 500 @{
							ok = $false
							action = "start-host-chrome"
							port = $targetCdpPort
							error = "cdp_port_not_open"
							hint = "Chrome은 실행됐을 수 있으나 CDP 포트가 열리지 않았습니다. (보안SW/정책 차단, 포트 충돌, user-data-dir 잠금 가능) 기존 Host Chrome 종료 후 재시도 또는 -Port 변경(9224) 권장"
						}
					} else {
						# Ensure manual/UI start always restores the Host Chrome window
						# (collector may have minimized it earlier).
						try { Show-HostChrome -port $targetCdpPort | Out-Null } catch {}
						Send-Json $ctx 200 @{ ok = $true; action = "start-host-chrome"; chromeAction = $chromeAction; port = $targetCdpPort; ready = $true; chromeUserDataDir = $chromeUserDataDir; chromeProfileDir = $profileDir; chromeProfileLabel = $chromeProfileLabel }
					}
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "start-host-chrome"; error = ($_.Exception.Message) }
				} finally {
					$script:HostChromeUserDataDir = $previousUserDataDir
					$script:HostChromeProfileDir = $previousProfileDir
					$script:HostChromeProfileLabel = $previousProfileLabel
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/collector/run-once") {
				try {
					$body = Read-JsonBody $ctx
					$url = ""; try { $url = [string]($body.url ?? "") } catch {}
					$nasApiBaseUrl = ""; try { $nasApiBaseUrl = [string]($body.nasApiBaseUrl ?? "") } catch {}
					$bearerToken = ""; try { $bearerToken = [string]($body.bearerToken ?? "") } catch {}
					$jobId = ""; try { $jobId = [string]($body.jobId ?? "") } catch {}
					if ([string]::IsNullOrWhiteSpace($url)) { throw "url_required" }
					$chromeAction = Start-HostChrome -port $CdpPort -startUrl $url -profileDir "Default"
					$ready = Wait-CdpReady -port $CdpPort -timeoutMs 7000
					if (-not $ready) { throw "cdp_port_not_open" }
					$metricsItems = @(Invoke-LocalPageMetricsScrape -port $CdpPort -url $url)
					$metrics = if ($metricsItems.Count -gt 0) { $metricsItems[$metricsItems.Count - 1] } else { @{} }
					if ($metrics -is [array] -and $metrics.Count -gt 0) { $metrics = $metrics[$metrics.Count - 1] }
					$uploaded = Submit-CollectorResult -ApiBaseUrl $nasApiBaseUrl -JobId $jobId -BearerToken $bearerToken -Url $url -Metrics $metrics
					$result = @{
						ok = $true
						action = "collector-run-once"
						mode = "cdp_dom"
						url = $url
						jobId = $jobId
						cdpPort = $CdpPort
						chromeAction = $chromeAction
						uploaded = $uploaded
						metrics = $metrics
					}
					if ($ready -and -not $uploaded -and -not [string]::IsNullOrWhiteSpace($nasApiBaseUrl)) {
						try {
							$headers = @{ "Content-Type" = "application/json" }
							if (-not [string]::IsNullOrWhiteSpace($bearerToken)) { $headers["Authorization"] = "Bearer $bearerToken" }
							$payload = @{ url = $url; status = "READY"; note = "collector_prototype_ready" } | ConvertTo-Json -Compress
							Invoke-RestMethod -Method Post -Uri ($nasApiBaseUrl.TrimEnd("/") + "/search-rank/page-metrics/local-collector/prototype-events") -Headers $headers -Body $payload -TimeoutSec 10 | Out-Null
							$result["nasEventSent"] = $true
						} catch {
							$result["nasEventSent"] = $false
							$result["nasEventError"] = $_.Exception.Message
						}
					}
					Send-Json $ctx 200 $result
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "collector-run-once"; error = ($_.Exception.Message) }
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/stop-host-chrome") {
				$q = Get-QueryMap $ctx
				$targetCdpPort = $CdpPort
				try {
					if ($q.ContainsKey("port") -and $q["port"]) { $targetCdpPort = [int]$q["port"] }
				} catch {}
				try {
					Stop-HostChrome -port $targetCdpPort
					Send-Json $ctx 200 @{ ok = $true; action = "stop-host-chrome"; port = $targetCdpPort }
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "stop-host-chrome"; error = ($_.Exception.Message) }
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/menu-sync/push") {
				try {
					$body = Read-JsonBody $ctx
					$result = Invoke-MenuSyncPush -Body $body
					Send-Json $ctx 200 $result
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "menu-sync-push"; error = ($_.Exception.Message) }
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/menu-sync/export") {
				try {
					$body = Read-JsonBody $ctx
					$result = Invoke-MenuSyncExport -Body $body
					Send-Json $ctx 200 $result
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "menu-sync-export"; error = ($_.Exception.Message) }
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/menu-sync/import") {
				try {
					$body = Read-JsonBody $ctx
					$result = Invoke-MenuSyncImport -Body $body
					Send-Json $ctx 200 $result
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "menu-sync-import"; error = ($_.Exception.Message) }
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/menu-sync/reconcile") {
				try {
					$body = Read-JsonBody $ctx
					$result = Invoke-MenuSyncReconcile -Body $body
					Send-Json $ctx 200 $result
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "menu-sync-db-reconcile"; error = ($_.Exception.Message) }
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/menu-sync/tracking-gap-analyze") {
				try {
					$body = Read-JsonBody $ctx
					$result = Invoke-MenuSyncTrackingGapAnalyze -Body $body
					Send-Json $ctx 200 $result
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "menu-sync-tracking-gap-analyze"; error = ($_.Exception.Message) }
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/menu-sync/tracking-gap-push") {
				try {
					$body = Read-JsonBody $ctx
					$result = Invoke-MenuSyncTrackingGapPush -Body $body
					Send-Json $ctx 200 $result
				} catch {
					Send-Json $ctx 500 @{ ok = $false; action = "menu-sync-tracking-gap-push"; error = ($_.Exception.Message) }
				}
				continue
			}

			if ($method -eq "POST" -and $path -eq "/shutdown") {
				$q = Get-QueryMap $ctx
				$cleanup = $false
				try {
					$cleanup = $q.ContainsKey("cleanup") -and ("" + ($q["cleanup"] ?? "")).Trim() -in @("1", "true", "yes")
				} catch {}
				$removedTasks = @()
				if ($cleanup) { $removedTasks = @(Remove-HostAgentAutoStart) }
				$stoppedBackgroundPid = Stop-CollectorBackgroundProcess
				Send-Json $ctx 200 @{
					ok = $true
					action = "shutdown"
					port = $Port
					cleanup = $cleanup
					removedTasks = $removedTasks
					stoppedBackgroundPid = $stoppedBackgroundPid
				}
				break
			}

			Send-Json $ctx 404 @{ ok = $false; error = "not_found"; path = $path; method = $method }
		} catch {
			# 요청 처리 중 오류가 나도 에이전트 전체가 죽지 않도록 보호
			try {
				if ($ctx) { Send-Json $ctx 500 @{ ok = $false; error = "agent_error"; message = ($_.Exception.Message) } }
			} catch {
				# ignore
			}
		}
	}
} finally {
	try { $listener.Stop() } catch {}
	try { $listener.Close() } catch {}
}


