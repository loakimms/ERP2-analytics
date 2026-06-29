# Analytics Host Agent 자동 시작(최초 1회 설치)
# - 목적: 웹 UI에서 "로컬 세션 준비"를 눌렀을 때 PowerShell을 매번 실행하지 않도록,
#   host-agent(127.0.0.1:9230)를 "로그온 시 자동 실행"으로 등록한다.
# - 사용: 이 파일 다운로드 → 우클릭 → PowerShell로 실행
param(
	[int]$Port = 9230,
	[int]$CdpPort = 9223,
	[string]$InstallDir = "$env:LOCALAPPDATA\\ERP2-Analytics-HostAgent",
	[switch]$NoPause = $false
)

$ErrorActionPreference = "Stop"

function Add-UniquePath([System.Collections.Generic.List[string]]$Items, [string]$Value) {
	if ([string]::IsNullOrWhiteSpace($Value)) { return }
	$normalized = $Value.Trim()
	if (-not $Items.Contains($normalized)) { $Items.Add($normalized) }
}

function Add-ParentCandidates([System.Collections.Generic.List[string]]$Items, [string]$StartPath) {
	if ([string]::IsNullOrWhiteSpace($StartPath)) { return }

	$current = $StartPath
	while (-not [string]::IsNullOrWhiteSpace($current)) {
		Add-UniquePath $Items $current

		$canonicalFile = Join-Path $current "CANONICAL_ROOT.txt"
		if (Test-Path -LiteralPath $canonicalFile) {
			try {
				$canonicalRoot = (Get-Content -LiteralPath $canonicalFile -TotalCount 1 -ErrorAction Stop | Select-Object -First 1).Trim()
				Add-UniquePath $Items $canonicalRoot
			} catch {}
		}

		$parent = Split-Path -Parent $current
		if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) { break }
		$current = $parent
	}
}

function Resolve-AnalyticsRepoRoot {
	$candidates = New-Object 'System.Collections.Generic.List[string]'

	Add-UniquePath $candidates $env:ERP2_ANALYTICS_ROOT
	Add-ParentCandidates $candidates $PSScriptRoot

	try {
		Add-ParentCandidates $candidates ((Get-Location).Path)
	} catch {}

	try {
		foreach ($driveRoot in (Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root)) {
			Add-UniquePath $candidates (Join-Path $driveRoot "dev\ERP2-analytics")
		}
	} catch {}

	Add-UniquePath $candidates "D:\dev\ERP2-analytics"
	Add-UniquePath $candidates "C:\dev\ERP2-analytics"

	foreach ($root in $candidates) {
		$agentPath = Join-Path $root "tools\host-agent.ps1"
		$ensurePath = Join-Path $root "tools\ensure-host-agent.ps1"
		if ((Test-Path -LiteralPath $agentPath) -and (Test-Path -LiteralPath $ensurePath)) {
			return $root
		}
	}

	return $null
}

# (재발 방지) "우클릭 → PowerShell로 실행"은 보통 Windows PowerShell 5.1(powershell.exe)로 뜬다.
# 이 스크립트는 UTF-8/한글 출력과 동작 안정성을 위해 pwsh(PowerShell 7+)로 실행되도록 유도한다.
if ($PSVersionTable.PSVersion.Major -lt 7) {
	$pwshCmd0 = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1
	if ($pwshCmd0 -and $pwshCmd0.Source) {
		Start-Process -FilePath $pwshCmd0.Source -ArgumentList @(
			"-NoProfile",
			"-ExecutionPolicy", "Bypass",
			"-File", $PSCommandPath,
			"-Port", $Port,
			"-CdpPort", $CdpPort,
			"-NoPause:$NoPause"
		) -WindowStyle Normal | Out-Null
		exit 0
	}
}

$taskName = "ERP2-Analytics Host Agent"
$taskNameEnsure = "ERP2-Analytics Host Agent (ensure)"
# Windows PowerShell 5.1 호환: null-conditional(?.) 문법을 쓰지 않는다.
# - PowerShell 7(pwsh)이 설치되어 있으면 그 경로를 사용
# - 없으면 "pwsh"로 실행을 시도(사용자에게 설치 안내가 더 명확하게 뜸)
$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1
$pwsh = if ($pwshCmd -and $pwshCmd.Source) { $pwshCmd.Source } else { "pwsh" }

function Write-TextFileUtf8([string] $path, [string] $content) {
	$dir = Split-Path -Parent $path
	if ($dir -and (-not (Test-Path -LiteralPath $dir))) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
	Set-Content -LiteralPath $path -Value $content -Encoding UTF8
}

function Register-HostAgentStartProtocol([string]$StartScriptPath) {
	$protocolRoot = "HKCU:\Software\Classes\erp2-analytics-host-agent"
	$commandKey = Join-Path $protocolRoot "shell\open\command"
	New-Item -Path $commandKey -Force | Out-Null
	New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
	Set-Item -Path $protocolRoot -Value "URL:ERP2 Analytics Host Agent"
	# 브라우저의 "상태확인/재시작"에서 띄우는 PowerShell 창은
	# 성공/실패 안내를 사용자가 읽을 수 있어야 하므로 NoPause를 강제하지 않는다.
	$command = "`"$pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$StartScriptPath`" -Port $Port -CdpPort $CdpPort"
	Set-Item -Path $commandKey -Value $command
}

function Ensure-StandaloneFiles([string] $rootDir) {
	New-Item -ItemType Directory -Force -Path $rootDir | Out-Null

	$hostAgentPath = Join-Path $rootDir "host-agent.ps1"
	$ensurePath = Join-Path $rootDir "ensure-host-agent.ps1"
	$startPath = Join-Path $rootDir "start-host-agent.ps1"

	# host-agent.ps1 (standalone)
	$hostAgent = @'
param(
  [int]$Port = 9230,
  [int]$CdpPort = 9223,
  [string]$UserDataDir = "$env:LOCALAPPDATA\ERP2-Analytics-HostChrome"
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$m) { Write-Host ("[INFO] " + $m) -ForegroundColor Cyan }
function Write-Warn([string]$m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }

function Test-HostAgentTaskExists([string]$TaskName) {
	$null = & schtasks.exe /Query /TN "$TaskName" 2>$null
	return ($LASTEXITCODE -eq 0)
}

function Register-HostAgentTask([string]$TaskName, [string]$TaskRunCommand) {
	$output = @(& schtasks.exe /Create /TN "$TaskName" /TR "$TaskRunCommand" /SC ONLOGON /RL LIMITED /F 2>&1)
	$exitCode = $LASTEXITCODE
	if ($exitCode -eq 0) { return @{ reusedExisting = $false } }

	$detail = (($output | ForEach-Object { "$_" }) -join [Environment]::NewLine).Trim()
	if ([string]::IsNullOrWhiteSpace($detail)) {
		$detail = "schtasks.exe exited with code $exitCode"
	}

	if ($detail -match "액세스가 거부|Access is denied") {
		if (Test-HostAgentTaskExists -TaskName $TaskName) {
			Write-Warn ("기존 작업 '{0}'이 이미 등록되어 있어 재사용합니다. (작업 덮어쓰기는 권한상 생략)" -f $TaskName)
			return @{ reusedExisting = $true; detail = $detail }
		}
		throw ("작업 스케줄러 등록이 거부되었습니다. 기존 '{0}' 작업이 관리자 권한/구버전 설치본으로 남아 있을 수 있습니다.`n해결: 작업 스케줄러에서 같은 이름의 작업을 삭제한 뒤 다시 실행하거나, 관리자 PowerShell에서 schtasks /Delete /TN `"{0}`" /F 후 다시 설치하세요.`n원본 메시지: {1}" -f $TaskName, $detail)
	}

	throw ("작업 스케줄러 등록에 실패했습니다: {0}" -f $detail)
}

function Send-Json($ctx, [int]$code, $obj) {
  try { $ctx.Response.StatusCode = $code } catch {}
  try { $ctx.Response.ContentType = "application/json; charset=utf-8" } catch {}
  try { $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*") } catch {}
  try { $ctx.Response.Headers.Add("Access-Control-Allow-Headers", "*") } catch {}
  try { $ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET,POST,OPTIONS") } catch {}
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

function Find-ChromePath {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($candidates) { return ($candidates | Select-Object -First 1) }
  try {
    $reg = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue
    if ($reg -and $reg.'(default)' -and (Test-Path $reg.'(default)')) { return $reg.'(default)' }
  } catch {}
  try {
    $reg2 = Get-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue
    if ($reg2 -and $reg2.'(default)' -and (Test-Path $reg2.'(default)')) { return $reg2.'(default)' }
  } catch {}
  return $null
}

function Start-HostChrome([int]$port, [string]$startUrl, [string]$profileDir) {
  $chrome = Find-ChromePath
  if (-not $chrome) { throw "chrome_not_found" }

  if (-not $startUrl) { $startUrl = "https://search.shopping.naver.com/" }
  if (-not $profileDir) { $profileDir = "Default" }

  New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null
  $chromePath = (Resolve-Path -LiteralPath $chrome).ProviderPath
  $pidFile = Join-Path $UserDataDir "host-chrome.pid"

  $args = @(
    "--new-window",
    "--remote-debugging-port=$port",
    "--remote-debugging-address=0.0.0.0",
    "--remote-allow-origins=*",
    ("--user-data-dir=`"$UserDataDir`""),
    ("--profile-directory=`"$profileDir`""),
    "--no-first-run",
    "--no-default-browser-check",
    "--start-maximized",
    ("`"$startUrl`"")
  ) -join " "

  $p = Start-Process -FilePath $chromePath -ArgumentList $args -PassThru
  try { Set-Content -LiteralPath $pidFile -Value $p.Id -Encoding ASCII } catch {}
}

function Wait-CdpReady([int]$port, [int]$timeoutMs = 7000) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/version" -f $port) -TimeoutSec 1
      if ($r -and $r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Stop-HostChrome([int]$port) {
  $pidFile = Join-Path $UserDataDir "host-chrome.pid"
  $stopped = $false
  try {
    if (Test-Path -LiteralPath $pidFile) {
      $pidText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
      if ($pidText) {
        $pid = [int]$pidText
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue; $stopped = $true }
      }
    }
  } catch {}

  if (-not $stopped) {
    $needlePort = "--remote-debugging-port=$port"
    $needleUserData = "--user-data-dir=`"$UserDataDir`""
    try {
      $targets = @(
        Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
          Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$needlePort*") -and ($_.CommandLine -like "*$needleUserData*") }
      )
      foreach ($t in $targets) { try { Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
      if ($targets.Count -gt 0) { $stopped = $true }
    } catch {}
  }

  try { if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue } } catch {}
}

function Remove-HostAgentAutoStart {
  $removed = New-Object 'System.Collections.Generic.List[string]'
  foreach ($taskName in @("ERP2-Analytics Host Agent (ensure)", "ERP2-Analytics Host Agent")) {
    try {
      & schtasks.exe /Query /TN "$taskName" | Out-Null
      if ($LASTEXITCODE -eq 0) {
        & schtasks.exe /Delete /TN "$taskName" /F | Out-Null
        if ($LASTEXITCODE -eq 0) { $removed.Add($taskName) | Out-Null }
      }
    } catch {}
  }
  return @($removed)
}

function Get-StartHostChromeBridgeHtml {
  return @(
    '<!doctype html>',
    '<html lang="ko">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <title>ERP2 Analytics Host Bridge</title>',
    '  <style>',
    '    body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; }',
    '    main { max-width: 720px; margin: 48px auto; padding: 24px; line-height: 1.6; }',
    '    .card { background: rgba(15,23,42,.72); border: 1px solid rgba(148,163,184,.25); border-radius: 14px; padding: 20px; }',
    '    .muted { color: #94a3b8; font-size: 13px; }',
    '    .ok { color: #86efac; }',
    '    .err { color: #fca5a5; white-space: pre-wrap; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main>',
    '    <div class="card">',
    '      <h2 id="title">Host Chrome 준비 중...</h2>',
    '      <div id="detail" class="muted">로컬 브리지에서 Host Agent를 호출하고 있습니다.</div>',
    '    </div>',
    '  </main>',
    '  <script>',
    '    (() => {',
    "      const MESSAGE_TYPE = 'erp2-analytics-host-agent-bridge';",
    "      const titleEl = document.getElementById('title');",
    "      const detailEl = document.getElementById('detail');",
    '      const params = new URLSearchParams(window.location.search);',
    "      const port = params.get('port') || '9223';",
    "      const profileDir = params.get('profile_dir') || 'Default';",
    "      const startUrl = params.get('start_url') || 'https://search.shopping.naver.com/';",
    "      const openerOrigin = params.get('opener_origin') || '*';",
    '      const render = (title, detail, cls) => {',
    '        if (titleEl) {',
    '          titleEl.textContent = title;',
    "          titleEl.className = cls || '';",
    '        }',
    '        if (detailEl) {',
    '          detailEl.textContent = detail;',
    "          detailEl.className = cls === 'err' ? 'err' : 'muted';",
    '        }',
    '      };',
    '      const send = (payload) => {',
    '        try {',
    '          if (window.opener && !window.opener.closed) {',
    "            window.opener.postMessage(Object.assign({ type: MESSAGE_TYPE, action: 'start-host-chrome' }, payload), openerOrigin === '*' ? '*' : openerOrigin);",
    '          }',
    '        } catch {',
    '          try {',
    '            if (window.opener && !window.opener.closed) {',
    "              window.opener.postMessage(Object.assign({ type: MESSAGE_TYPE, action: 'start-host-chrome' }, payload), '*');",
    '            }',
    '          } catch {}',
    '        }',
    '      };',
    '      const qs = new URLSearchParams({ port: port, profile_dir: profileDir, start_url: startUrl });',
    "      fetch('/start-host-chrome?' + qs.toString(), { method: 'POST', cache: 'no-store' })",
    '        .then(async (res) => {',
    '          const data = await res.json().catch(() => ({}));',
    '          if (!res.ok || data.ready !== true) {',
    "            const detail = String(data.error || data.hint || ('HTTP ' + res.status)).trim();",
    "            render('Host Chrome 준비 실패', detail || 'localhost 브리지에서 Host Chrome 준비 완료를 확인하지 못했습니다.', 'err');",
    "            send({ ok: false, ready: false, error: detail || ('HTTP ' + res.status) });",
    '            return;',
    '          }',
    "          render('Host Chrome 준비 완료', '원래 페이지가 이어서 이 창을 사용합니다. 잠시만 기다려 주세요.', 'ok');",
    '          send({ ok: true, ready: true, port: Number(port) || 9223 });',
    '        })',
    '        .catch((error) => {',
    "          const detail = String(error && error.message ? error.message : error || '').trim();",
    "          render('Host Chrome 준비 실패', detail || 'localhost 브리지에서 Host Agent 호출에 실패했습니다.', 'err');",
    "          send({ ok: false, ready: false, error: detail || 'bridge_fetch_failed' });",
    '        });',
    '    })();',
    '  </script>',
    '</body>',
    '</html>'
  ) -join [Environment]::NewLine
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix)

Write-Info "Host agent listening: $prefix"
Write-Info "Endpoints: GET /health, GET /bridge/start-host-chrome, POST /start-host-chrome, POST /stop-host-chrome, POST /shutdown[?cleanup=1]"
Write-Info "Default CDP port: $CdpPort"

try { $listener.Start() } catch {
  Write-Host ""
  Write-Host "❌ Host agent failed to start HttpListener: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host ""
  Write-Host "가능한 해결:" -ForegroundColor Yellow
  Write-Host (" - 포트 충돌 시 다른 포트로 실행: pwsh -File `"{0}`" -Port 9231" -f $PSCommandPath) -ForegroundColor Yellow
  Write-Host (" - URL ACL(Access denied) 시 관리자에서: netsh http add urlacl url={0} user=%USERDOMAIN%\%USERNAME%" -f $prefix) -ForegroundColor Yellow
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

      if ($method -eq "OPTIONS") { Send-Json $ctx 204 @{ ok = $true }; continue }
      if ($method -eq "GET" -and $path -eq "/health") {
        Send-Json $ctx 200 @{ ok = $true; agent = "erp2-analytics-host-agent"; port = $Port; time = (Get-Date).ToString("s") }
        continue
      }

      if ($method -eq "GET" -and $path -eq "/bridge/start-host-chrome") {
        Send-Html $ctx 200 (Get-StartHostChromeBridgeHtml)
        continue
      }

      if ($method -eq "POST" -and $path -eq "/start-host-chrome") {
        $q = Get-QueryMap $ctx
        $port = $CdpPort
        try { if ($q.ContainsKey("port") -and $q["port"]) { $port = [int]$q["port"] } } catch {}
        $startUrl = ""; try { if ($q.ContainsKey("start_url")) { $startUrl = "" + ($q["start_url"] ?? "") } } catch {}
        $profileDir = "Default"; try { if ($q.ContainsKey("profile_dir") -and $q["profile_dir"]) { $profileDir = "" + ($q["profile_dir"] ?? "Default") } } catch {}

        try {
          Start-HostChrome -port $port -startUrl $startUrl -profileDir $profileDir
          $ready = Wait-CdpReady -port $port -timeoutMs 7000
          if (-not $ready) {
            Send-Json $ctx 500 @{ ok = $false; action = "start-host-chrome"; port = $port; error = "cdp_port_not_open" }
          } else {
            Send-Json $ctx 200 @{ ok = $true; action = "start-host-chrome"; port = $port; ready = $true }
          }
        } catch {
          Send-Json $ctx 500 @{ ok = $false; action = "start-host-chrome"; error = ($_.Exception.Message) }
        }
        continue
      }

      if ($method -eq "POST" -and $path -eq "/stop-host-chrome") {
        $q = Get-QueryMap $ctx
        $port = $CdpPort
        try { if ($q.ContainsKey("port") -and $q["port"]) { $port = [int]$q["port"] } } catch {}
        try { Stop-HostChrome -port $port; Send-Json $ctx 200 @{ ok = $true; action = "stop-host-chrome"; port = $port } }
        catch { Send-Json $ctx 500 @{ ok = $false; action = "stop-host-chrome"; error = ($_.Exception.Message) } }
        continue
      }

      if ($method -eq "POST" -and $path -eq "/shutdown") {
        $q = Get-QueryMap $ctx
        $cleanup = $false
        try { $cleanup = $q.ContainsKey("cleanup") -and ("" + ($q["cleanup"] ?? "")).Trim() -in @("1", "true", "yes") } catch {}
        $removedTasks = @()
        if ($cleanup) { $removedTasks = @(Remove-HostAgentAutoStart) }
        Send-Json $ctx 200 @{ ok = $true; action = "shutdown"; port = $Port; cleanup = $cleanup; removedTasks = $removedTasks }
        break
      }

      Send-Json $ctx 404 @{ ok = $false; error = "not_found"; path = $path; method = $method }
    } catch {
      try { if ($ctx) { Send-Json $ctx 500 @{ ok = $false; error = "agent_error"; message = ($_.Exception.Message) } } } catch {}
    }
  }
} finally {
  try { $listener.Stop() } catch {}
  try { $listener.Close() } catch {}
}
'@

	$ensure = @'
param(
  [int]$Port = 9230,
  [int]$CdpPort = 9223
)
$ErrorActionPreference = "Stop"

function Test-AgentHealthy([int]$port) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $port) -TimeoutSec 1
    return ($r -and $r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
  } catch { return $false }
}

if (Test-AgentHealthy -port $Port) { exit 0 }

$agent = Join-Path $PSScriptRoot "host-agent.ps1"
Start-Process -FilePath "pwsh" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $agent,
  "-Port", $Port,
  "-CdpPort", $CdpPort
) -WindowStyle Hidden | Out-Null
'@

	$start = @'
param(
  [int]$Port = 9230,
  [int]$CdpPort = 9223,
  [switch]$NoPause = $false
)
$ErrorActionPreference = "Stop"
$agent = Join-Path $PSScriptRoot "host-agent.ps1"

function Test-AgentHealthy([int]$port) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $port) -TimeoutSec 1
    return ($r -and $r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
  } catch { return $false }
}

Start-Process -FilePath "pwsh" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $agent,
  "-Port", $Port,
  "-CdpPort", $CdpPort
) -WindowStyle Hidden | Out-Null
for ($i = 0; $i -lt 20; $i++) {
  if (Test-AgentHealthy -port $Port) { break }
  Start-Sleep -Milliseconds 500
}
if (Test-AgentHealthy -port $Port) {
  Write-Host "✅ Host agent started in background: http://127.0.0.1:$Port/health"
} else {
  Write-Host "⚠️ Host agent start requested, but health check is not ready: http://127.0.0.1:$Port/health" -ForegroundColor Yellow
}
Write-Host "   - 상태 확인/수집 제어는 웹 수집 모달에서 진행합니다."
if (-not $NoPause) {
  Read-Host -Prompt "위 내용을 확인한 뒤 Enter 키를 누르면 이 창이 닫힙니다"
}
'@

	Write-TextFileUtf8 -path $hostAgentPath -content $hostAgent
	Write-TextFileUtf8 -path $ensurePath -content $ensure
	Write-TextFileUtf8 -path $startPath -content $start

	return @{
		agent = $hostAgentPath
		ensure = $ensurePath
		start = $startPath
	}
}

$repoRoot = Resolve-AnalyticsRepoRoot
$repoAgent = if ($repoRoot) { Join-Path $repoRoot "tools\host-agent.ps1" } else { $null }
$repoEnsure = if ($repoRoot) { Join-Path $repoRoot "tools\ensure-host-agent.ps1" } else { $null }
$repoStart = if ($repoRoot) { Join-Path $repoRoot "tools\start-host-agent.ps1" } else { $null }

$agent = $repoAgent
$ensure = $repoEnsure
$start = $repoStart
if (-not (Test-Path -LiteralPath $agent) -or -not (Test-Path -LiteralPath $ensure) -or -not (Test-Path -LiteralPath $start)) {
	$files = Ensure-StandaloneFiles -rootDir $InstallDir
	$agent = $files.agent
	$ensure = $files.ensure
	$start = $files.start
}

try {
	# 사용자 권한으로도 충분(127.0.0.1 바인딩). 관리자 권한을 강제하지 않는다.
	$tr = "`"$pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$agent`" -Port $Port -CdpPort $CdpPort"

	# /F: overwrite, /SC ONLOGON: user logon trigger, /RL LIMITED: non-admin
	$taskResult = Register-HostAgentTask -TaskName $taskName -TaskRunCommand $tr
	Register-HostAgentStartProtocol -StartScriptPath $start

	Write-Host ""
	Write-Host "✅ 설치 완료: 로그온 시 Host Agent가 자동 실행됩니다." -ForegroundColor Green
	if ($repoRoot) { Write-Host " - repo: $repoRoot" }
	Write-Host " - task: $taskName"
	Write-Host " - protocol: erp2-analytics-host-agent://start"
	if ($taskResult.reusedExisting) { Write-Host " - task-status: 기존 작업 재사용" -ForegroundColor Yellow }
	Write-Host " - health: http://127.0.0.1:$Port/health"
	Write-Host ""
} catch {
	Write-Host ""
	Write-Host "설치 중 오류가 발생했습니다:" -ForegroundColor Red
	Write-Host $_.Exception.Message -ForegroundColor Red
	Write-Host ""
}

if (-not $NoPause) {
	Read-Host -Prompt "위 내용을 확인한 뒤 Enter 키를 누르면 종료됩니다"
}

