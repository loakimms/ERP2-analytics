import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

/**
 * 전역 axios(기본 인스턴스)에 Firebase ID token을 자동으로 붙인다.
 *
 * - 기존 코드가 `import axios from 'axios'`를 곳곳에서 사용하므로,
 *   중앙에서 interceptor 1개로 해결한다.
 * - token이 없으면 헤더를 붙이지 않는다(로그인 전 화면에서도 안전).
 *
 * @returns eject 함수(정리용)
 */
export function installAxiosBearerToken(getToken: () => Promise<string | null>): () => void {
	const id = axios.interceptors.request.use(async (cfg: InternalAxiosRequestConfig) => {
		try {
			const t = await getToken();
			if (!t) return cfg;
			const headers = AxiosHeaders.from(cfg.headers);
			headers.set('Authorization', `Bearer ${t}`);
			cfg.headers = headers;
			return cfg;
		} catch {
			return cfg;
		}
	});
	return () => {
		try {
			axios.interceptors.request.eject(id);
		} catch {
			// ignore
		}
	};
}

