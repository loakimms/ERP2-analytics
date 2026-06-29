export type NasHostSetupCommands = {
	/** 레포 루트(VITE_ANALYTICS_REPO_ROOT 또는 인자)가 있을 때만 */
	repoDirectRun: string | null;
	repoScriptPath: string | null;
	/**
	 * zip 을 받아 `Downloads\\Analytics-NAS-Host` 에 풀었다고 가정한 한 줄 실행(권장).
	 * 통합 스크립트가 같은 폴더의 형제 .ps1 을 찾을 수 있다.
	 */
	downloadedRunExtractedBundle: string;
	/**
	 * 통합 ps1 만 다운로드 폴더에 둔 경우(비권장). 형제 스크립트가 없으면 Setup 이 실패한다.
	 */
	downloadedRunSingleFileInDownloads: string;
	downloadedScriptPathSingleFile: string;
	downloadedExtractFolderExample: string;
};

const POWERSHELL_7_EXE = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const NAS_SETUP_SCRIPT_NAME = 'Setup-Analytics-NAS-Host.ps1';
/** 수집 모달에서 안내하는 zip 압축 해제 폴더명(사용자가 바꿔도 됨) */
const DOWNLOADS_EXTRACT_FOLDER_NAME = 'Analytics-NAS-Host';

function resolveRepoRoot(repoRootOverride?: string): string {
	const fromEnv =
		typeof import.meta.env.VITE_ANALYTICS_REPO_ROOT === 'string' ? import.meta.env.VITE_ANALYTICS_REPO_ROOT.trim() : '';
	const o = String(repoRootOverride ?? fromEnv).trim();
	return o;
}

export function getNasHostSetupCommands(repoRootOverride?: string): NasHostSetupCommands {
	const normalizedRoot = resolveRepoRoot(repoRootOverride);
	const repoScriptPath = normalizedRoot ? `${normalizedRoot}\\web\\public\\nas\\${NAS_SETUP_SCRIPT_NAME}` : null;
	const repoDirectRun = repoScriptPath
		? `& "${POWERSHELL_7_EXE}" -NoProfile -ExecutionPolicy Bypass -File "${repoScriptPath}"`
		: null;

	const downloadedScriptPathSingleFile = `$env:USERPROFILE\\Downloads\\${NAS_SETUP_SCRIPT_NAME}`;
	const downloadedExtractFolderExample = `$env:USERPROFILE\\Downloads\\${DOWNLOADS_EXTRACT_FOLDER_NAME}`;

	const downloadedRunSingleFileInDownloads = `& "${POWERSHELL_7_EXE}" -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\${NAS_SETUP_SCRIPT_NAME}"`;

	const downloadedRunExtractedBundle = `& "${POWERSHELL_7_EXE}" -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\${DOWNLOADS_EXTRACT_FOLDER_NAME}\\${NAS_SETUP_SCRIPT_NAME}"`;

	return {
		repoDirectRun,
		repoScriptPath,
		downloadedRunExtractedBundle,
		downloadedRunSingleFileInDownloads,
		downloadedScriptPathSingleFile,
		downloadedExtractFolderExample,
	};
}
