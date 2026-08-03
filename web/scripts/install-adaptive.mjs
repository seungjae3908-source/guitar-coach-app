import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'bootstrap-adaptive-vision.yml');
const workflow = readFileSync(workflowPath, 'utf8');
const parts = [...workflow.matchAll(/<<'B64[A-E]'\n([A-Za-z0-9+/=\n]+)\nB64[A-E]/g)].map((match) => match[1].replace(/\s+/g, ''));
if (parts.length !== 5) throw new Error(`Adaptive bundle parts missing: ${parts.length}/5`);

const archive = Buffer.from(parts.join(''), 'base64');
const digest = createHash('sha256').update(archive).digest('hex');
const expected = '47a669e3a02f2cc3b1c74f9641c37594847dd9a9b0722960bd9b584b7e298c97';
if (digest !== expected) throw new Error(`Adaptive bundle checksum mismatch: ${digest}`);

const temp = mkdtempSync(resolve(tmpdir(), 'guitar-adaptive-'));
const archivePath = resolve(temp, 'adaptive.tar.gz');
try {
  writeFileSync(archivePath, archive);
  execFileSync('tar', ['-xzf', archivePath, '-C', repoRoot], { stdio: 'inherit' });
  console.log('Adaptive guitar vision sources installed.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
