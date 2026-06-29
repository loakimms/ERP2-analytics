import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BUILD_TIME = process.env.BUILD_TIME || new Date().toISOString();
const GIT_SHA = process.env.GIT_SHA || '';
const APP_VERSION = process.env.VITE_APP_VERSION || process.env.APP_VERSION || '';
const IMAGE_TAG = process.env.VITE_IMAGE_TAG || process.env.IMAGE_TAG || '';
const API_BASE_URL = process.env.VITE_ANALYTICS_API_BASE_URL || '';

function writeVersionJson(): Plugin {
	let outDir = path.resolve(process.cwd(), 'dist');
	return {
		name: 'analytics-write-version-json',
		apply: 'build',
		configResolved(config: any) {
			const resolvedOutDir = config?.build?.outDir ? String(config.build.outDir) : 'dist';
			outDir = path.isAbsolute(resolvedOutDir) ? resolvedOutDir : path.resolve(process.cwd(), resolvedOutDir);
		},
		closeBundle() {
			const payload = {
				appVersion: APP_VERSION || undefined,
				imageTag: IMAGE_TAG || undefined,
				gitSha: GIT_SHA || undefined,
				buildTime: BUILD_TIME || undefined,
				apiBaseUrl: API_BASE_URL || undefined,
			};
			fs.mkdirSync(outDir, { recursive: true });
			fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(payload, null, 2), 'utf8');
		},
	};
}

export default defineConfig({
	plugins: [react(), writeVersionJson()],
	resolve: {
		// React 중복 로딩 방지:
		// - monorepo/상위 폴더에 node_modules가 있을 때 react/react-dom이 서로 다른 경로에서 로드되면
		//   "Invalid hook call"이 발생할 수 있음
		// - analytics/web의 node_modules로 고정해 한 벌로 로드되게 한다
		alias: {
			react: path.resolve(__dirname, 'node_modules', 'react'),
			'react-dom': path.resolve(__dirname, 'node_modules', 'react-dom'),
		},
		dedupe: ['react', 'react-dom'],
	},
	server: {
		host: true,
		port: 5188,
		strictPort: true,
		hmr: { clientPort: 5188, port: 5188 },
	},
	build: {
		chunkSizeWarningLimit: 1400,
	},
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/test/setup-tests.ts'],
	},
});
