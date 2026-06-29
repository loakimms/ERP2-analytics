import { describe, expect, it } from 'vitest';
import { getNasHostSetupCommands } from './hostSetupCommands';

describe('getNasHostSetupCommands', () => {
	it('레포 루트가 주어지면 레포 기준 직접 실행 문자열을 만든다', () => {
		const commands = getNasHostSetupCommands('d:\\dev\\ERP2-analytics');
		expect(commands.repoScriptPath).toBe('d:\\dev\\ERP2-analytics\\web\\public\\nas\\Setup-Analytics-NAS-Host.ps1');
		expect(commands.repoDirectRun).toBe(
			'& "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File "d:\\dev\\ERP2-analytics\\web\\public\\nas\\Setup-Analytics-NAS-Host.ps1"',
		);
	});

	it('레포 루트가 없으면 repoDirectRun 은 비어 있다(일반 PC는 zip 경로 안내)', () => {
		const commands = getNasHostSetupCommands('');
		expect(commands.repoDirectRun).toBeNull();
		expect(commands.repoScriptPath).toBeNull();
	});

	it('zip 풀기 권장 경로와 Downloads 단일 파일 경로를 모두 제공한다', () => {
		const commands = getNasHostSetupCommands('');
		expect(commands.downloadedScriptPathSingleFile).toBe('$env:USERPROFILE\\Downloads\\Setup-Analytics-NAS-Host.ps1');
		expect(commands.downloadedRunExtractedBundle).toBe(
			'& "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\Analytics-NAS-Host\\Setup-Analytics-NAS-Host.ps1"',
		);
		expect(commands.downloadedRunSingleFileInDownloads).toBe(
			'& "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\Setup-Analytics-NAS-Host.ps1"',
		);
	});
});
