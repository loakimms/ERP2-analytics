import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentPath = path.join(root, 'tools', 'host-agent.ps1');
const installerPath = path.join(root, 'web', 'public', 'nas', 'Install-Analytics-HostAgent.ps1');

const agentBytes = fs.readFileSync(agentPath);
const b64 = agentBytes.toString('base64').replace(/(.{120})/g, '$1\r\n').replace(/\r\n$/, '');
let text = fs.readFileSync(installerPath, 'utf8');

const pattern = /\$agentScript(?:\$agentScript)?\s*=\s*\[Text\.Encoding\]::UTF8\.GetString\(\[Convert\]::FromBase64String\(@'\r?\n[\s\S]*?\r?\n'@\)\)/;
if (!pattern.test(text)) {
  console.error('embed block not found');
  process.exit(1);
}

const replacement = `$agentScript = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(@'\r\n${b64}\r\n'@))`;
text = text.replace(pattern, replacement);
if (text.includes('$agentScript$agentScript')) {
  console.error('broken duplicate still present');
  process.exit(1);
}
fs.writeFileSync(installerPath, text, 'utf8');

const m = text.match(/\$agentScript = \[Text\.Encoding\]::UTF8\.GetString\(\[Convert\]::FromBase64String\(@'\r?\n([\s\S]*?)\r?\n'@\)\)/);
if (!m) {
  console.error('verify embed failed');
  process.exit(1);
}
const decoded = Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8');
const ver = decoded.match(/^\$AgentVersion = "([^"]+)"/m)?.[1];
const manage = decoded.match(/^\$AgentManageNo = "([^"]+)"/m)?.[1];
console.log(`embedded AgentVersion=${ver}`);
console.log(`embedded AgentManageNo=${manage}`);
if (!decoded.includes('installer_exit_')) {
  console.error('embedded agent missing hardened self-update');
  process.exit(1);
}
