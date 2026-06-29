import { describe, expect, it } from 'vitest';
import { getHostSetupDownloads } from './hostSetupDownloads';

describe('getHostSetupDownloads', () => {
	it('keeps local host setup downloads split by step', () => {
		expect(getHostSetupDownloads('local')).toEqual([
			{
				path: '/local/Run-Install-Analytics-HostAgent.cmd',
				downloadName: 'Run-Install-Analytics-HostAgent-LOCAL.cmd',
				label: 'Host Agent 설치 실행기(cmd)',
			},
			{
				path: '/local/Run-Start-Analytics-HostAgent.cmd',
				downloadName: 'Run-Start-Analytics-HostAgent-LOCAL.cmd',
				label: 'Host Agent 실행기(cmd)',
			},
			{
				path: '/local/Run-Start-Analytics-HostChrome.cmd',
				downloadName: 'Run-Start-Analytics-HostChrome-LOCAL.cmd',
				label: 'Host Chrome 실행기(cmd)',
			},
		]);
	});

	it('nas 는 zip 패키지 + 개별 스크립트를 함께 제공한다', () => {
		expect(getHostSetupDownloads('nas')).toEqual([
			{
				path: '/nas/Analytics-NAS-Host-bundle.zip',
				downloadName: 'Analytics-NAS-Host-bundle.zip',
				label: 'NAS 호스트 패키지(zip·권장)',
			},
			{
				path: '/nas/Run-Setup-Analytics-NAS-Host.cmd',
				downloadName: 'Run-Setup-Analytics-NAS-Host.cmd',
				label: '통합 Setup 실행기(cmd)',
			},
			{
				path: '/nas/Run-Start-Analytics-HostChrome.cmd',
				downloadName: 'Run-Start-Analytics-HostChrome-NAS.cmd',
				label: 'Host Chrome 실행기(cmd)',
			},
		]);
	});
});
