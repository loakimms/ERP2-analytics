import { describe, expect, it } from 'vitest';
import { buildHostSetupDownloadName } from './downloadNames';

describe('buildHostSetupDownloadName', () => {
	it('adds LOCAL suffix for local downloads', () => {
		expect(buildHostSetupDownloadName('local', 'Install-Analytics-HostAgent.ps1')).toBe(
			'Install-Analytics-HostAgent-LOCAL.ps1',
		);
	});

	it('adds NAS suffix for nas downloads', () => {
		expect(buildHostSetupDownloadName('nas', 'Start-Analytics-HostChrome.ps1')).toBe(
			'Start-Analytics-HostChrome-NAS.ps1',
		);
	});

	it('preserves non-ps1 extensions like cmd launchers', () => {
		expect(buildHostSetupDownloadName('local', 'Run-Start-Analytics-HostChrome.cmd')).toBe(
			'Run-Start-Analytics-HostChrome-LOCAL.cmd',
		);
	});

	it('keeps extensionless names readable', () => {
		expect(buildHostSetupDownloadName('nas', 'HostAgent')).toBe('HostAgent-NAS');
	});
});
