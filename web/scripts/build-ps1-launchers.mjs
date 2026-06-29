import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

const MARKER = '###__POWERSHELL__###';

const targets = [
	['local/Install-Analytics-HostAgent.ps1', 'local/Run-Install-Analytics-HostAgent.cmd'],
	['local/Start-Analytics-HostAgent.ps1', 'local/Run-Start-Analytics-HostAgent.cmd'],
	['local/Start-Analytics-HostChrome.ps1', 'local/Run-Start-Analytics-HostChrome.cmd'],
	['nas/Install-Analytics-HostAgent.ps1', 'nas/Run-Install-Analytics-HostAgent.cmd'],
	['nas/Start-Analytics-HostAgent.ps1', 'nas/Run-Start-Analytics-HostAgent.cmd'],
	['nas/Start-Analytics-HostChrome.ps1', 'nas/Run-Start-Analytics-HostChrome.cmd'],
];

function buildLauncherBody(ps1Text) {
	return [
		'@echo off',
		'setlocal',
		'set "POWERSHELL_EXE=%ProgramFiles%\\PowerShell\\7\\pwsh.exe"',
		'if not exist "%POWERSHELL_EXE%" set "POWERSHELL_EXE=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
		'if not exist "%POWERSHELL_EXE%" (',
		'  echo PowerShell executable was not found.',
		'  pause',
		'  exit /b 1',
		')',
		'set "ANALYTICS_LAUNCHER_SELF=%~f0"',
		`"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $self = $env:ANALYTICS_LAUNCHER_SELF; $lines = Get-Content -LiteralPath $self -Encoding UTF8; $start = [Array]::IndexOf($lines, '${MARKER}'); if ($start -lt 0) { throw 'launcher_marker_not_found' }; $body = $lines | Select-Object -Skip ($start + 1); $tmp = Join-Path $env:TEMP ('analytics-launch-' + [guid]::NewGuid().ToString('N') + '.ps1'); [System.IO.File]::WriteAllLines($tmp, $body, [System.Text.UTF8Encoding]::new($false)); try { & $tmp; $code = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }; exit $code } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }"`,
		'exit /b %ERRORLEVEL%',
		MARKER,
		ps1Text.replace(/\r?\n/g, '\r\n'),
		'',
	].join('\r\n');
}

for (const [sourceRelative, targetRelative] of targets) {
	const sourcePath = path.join(publicDir, sourceRelative);
	const targetPath = path.join(publicDir, targetRelative);
	const ps1Text = fs.readFileSync(sourcePath, 'utf8');
	const launcherText = buildLauncherBody(ps1Text);
	fs.writeFileSync(targetPath, launcherText, 'utf8');
	console.log(`[build-ps1-launchers] wrote ${path.relative(publicDir, targetPath)}`);
}
