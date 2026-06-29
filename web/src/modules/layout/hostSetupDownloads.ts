import { buildHostSetupDownloadName } from './downloadNames';

export type HostSetupDownload = {
	path: string;
	downloadName: string;
	label: string;
};

export function getHostSetupDownloads(target: 'local' | 'nas'): HostSetupDownload[] {
	if (target === 'nas') {
		return [
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
				path: '/nas/Run-Start-Analytics-HostAgent.cmd',
				downloadName: buildHostSetupDownloadName('nas', 'Run-Start-Analytics-HostAgent.cmd'),
				label: 'Host Agent 실행기(cmd)',
			},
			{
				path: '/nas/Run-Start-Analytics-HostChrome.cmd',
				downloadName: buildHostSetupDownloadName('nas', 'Run-Start-Analytics-HostChrome.cmd'),
				label: 'Host Chrome 실행기(cmd)',
			},
		];
	}

	return [
		{
			path: '/local/Run-Install-Analytics-HostAgent.cmd',
			downloadName: buildHostSetupDownloadName('local', 'Run-Install-Analytics-HostAgent.cmd'),
			label: 'Host Agent 설치 실행기(cmd)',
		},
		{
			path: '/local/Run-Start-Analytics-HostAgent.cmd',
			downloadName: buildHostSetupDownloadName('local', 'Run-Start-Analytics-HostAgent.cmd'),
			label: 'Host Agent 실행기(cmd)',
		},
		{
			path: '/local/Run-Start-Analytics-HostChrome.cmd',
			downloadName: buildHostSetupDownloadName('local', 'Run-Start-Analytics-HostChrome.cmd'),
			label: 'Host Chrome 실행기(cmd)',
		},
	];
}
