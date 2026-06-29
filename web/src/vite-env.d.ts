/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** 로컬 개발 시 레포 절대 경로(예: C:\\dev\\ERP2-analytics). 설정 시 수집 모달에 레포 직접 실행 한 줄이 표시된다. */
	readonly VITE_ANALYTICS_REPO_ROOT?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}






















