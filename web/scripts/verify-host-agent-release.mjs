import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '..');

function read(relPath) {
	const candidates = [
		path.join(repoRoot, relPath),
		relPath.startsWith('web/') ? path.join(webRoot, relPath.slice(4)) : path.join(webRoot, relPath),
	];
	for (const abs of candidates) {
		if (fs.existsSync(abs)) return fs.readFileSync(abs, 'utf8');
	}
	throw new Error(`[verify-host-agent-release] Missing file: ${relPath}`);
}

function extract(label, text, pattern) {
	const match = text.match(pattern);
	if (!match) throw new Error(`[verify-host-agent-release] Missing ${label}`);
	return String(match[1] || '').trim();
}

const releaseText = read('web/src/modules/hostAgentRelease.ts');
const uiVersion = extract('REQUIRED_HOST_AGENT_VERSION', releaseText, /REQUIRED_HOST_AGENT_VERSION\s*=\s*['"]([^'"]+)['"]/);
const uiManageNo = extract('REQUIRED_HOST_AGENT_MANAGE_NO', releaseText, /REQUIRED_HOST_AGENT_MANAGE_NO\s*=\s*['"]([^'"]+)['"]/);

const installerText = read('web/public/nas/Install-Analytics-HostAgent.ps1');
const bundledVersion = extract('NAS installer $bundledAgentVersion', installerText, /^\$bundledAgentVersion\s*=\s*"([^"]+)"/m);
const bundledManageNo = extract('NAS installer $bundledAgentManageNo', installerText, /^\$bundledAgentManageNo\s*=\s*"([^"]+)"/m);

const checks = [
	['NAS installer bundled version', bundledVersion, uiVersion],
	['NAS installer bundled manageNo', bundledManageNo, uiManageNo],
];

let agentVersion = bundledVersion;
let agentManageNo = bundledManageNo;
try {
	const agentText = read('tools/host-agent.ps1');
	agentVersion = extract('tools/host-agent.ps1 $AgentVersion', agentText, /^\$AgentVersion\s*=\s*"([^"]+)"/m);
	agentManageNo = extract('tools/host-agent.ps1 $AgentManageNo', agentText, /^\$AgentManageNo\s*=\s*"([^"]+)"/m);
	checks.push(
		['UI required version', uiVersion, agentVersion],
		['UI required manageNo', uiManageNo, agentManageNo],
		['NAS installer bundled version vs agent', bundledVersion, agentVersion],
		['NAS installer bundled manageNo vs agent', bundledManageNo, agentManageNo],
	);
} catch (e) {
	console.warn(`[verify-host-agent-release] tools/host-agent.ps1 unavailable; checked UI and bundled NAS installer only. ${e.message}`);
}

const failures = checks.filter(([, actual, expected]) => actual !== expected);
if (failures.length > 0) {
	for (const [label, actual, expected] of failures) {
		console.error(`[verify-host-agent-release] ${label} mismatch: actual=${actual} expected=${expected}`);
	}
	process.exit(1);
}

for (const relPath of ['web/src/modules/layout/AppShell.tsx', 'web/src/modules/settings/DataCollectionView.tsx']) {
	const text = read(relPath);
	if (/REQUIRED_HOST_AGENT_VERSION\s*=\s*['"]/.test(text) || /REQUIRED_HOST_AGENT_MANAGE_NO\s*=\s*['"]/.test(text)) {
		console.error(`[verify-host-agent-release] ${relPath} must import hostAgentRelease constants instead of hardcoding them.`);
		process.exit(1);
	}
}

console.log(`[verify-host-agent-release] ok version=${agentVersion} manageNo=${agentManageNo}`);
