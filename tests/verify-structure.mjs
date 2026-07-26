import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

const requiredPaths = [
  'README.md',
  'package.json',
  '.gitignore',
  'mobile/README.md',
  'web/README.md',
  'server/README.md',
  'ai/README.md',
  'database/README.md',
  'docs/ARCHITECTURE.md',
  'docs/WORK_STATUS.md',
  'tests/README.md',
  'tests/verify-structure.mjs',
];

const missing = [];

for (const path of requiredPaths) {
  try {
    await access(path, constants.F_OK);
  } catch {
    missing.push(path);
  }
}

if (missing.length > 0) {
  console.error('Structure check failed. Missing paths:');
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

console.log(`Structure check passed: ${requiredPaths.length} required paths found.`);
