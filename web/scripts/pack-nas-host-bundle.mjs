/**
 * web/public/nas 의 실행 스크립트(.ps1/.cmd)를 묶어 Analytics-NAS-Host-bundle.zip 을 만든다.
 * 통합 Setup 스크립트와 .cmd 런처가 같은 폴더의 형제 파일을 찾으므로, 사용자는 zip 을 풀고 실행하면 된다.
 */
import archiver from 'archiver';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const nasDir = path.resolve(__dirname, '../public/nas');
	const outName = 'Analytics-NAS-Host-bundle.zip';
	const outPath = path.join(nasDir, outName);

	const files = fs
		.readdirSync(nasDir)
		.filter((f) => /\.(ps1|cmd)$/i.test(f))
		.sort();

	if (files.length === 0) {
		throw new Error(`[pack-nas-host-bundle] No .ps1 files under ${nasDir}`);
	}

	await fs.promises.rm(outPath, { force: true });

	const output = fs.createWriteStream(outPath);
	const archive = archiver('zip', { zlib: { level: 9 } });
	archive.pipe(output);

	archive.on('warning', (err) => {
		if ((err && err.code) === 'ENOENT') {
			console.warn(err);
		} else {
			throw err;
		}
	});
	archive.on('error', (err) => {
		throw err;
	});

	for (const name of files) {
		archive.file(path.join(nasDir, name), { name });
	}

	await new Promise((resolve, reject) => {
		output.on('close', resolve);
		output.on('error', reject);
		archive.on('error', reject);
		archive.finalize();
	});

	console.log(`[pack-nas-host-bundle] Wrote ${outPath} (${files.length} scripts: ${files.join(', ')})`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
