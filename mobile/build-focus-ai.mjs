import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const parts = ['part00.txt', 'part01.txt', 'part02.txt', 'part03.txt', 'part04.txt', 'part05.txt'];
const content = (
  await Promise.all(parts.map((name) => readFile(join(root, 'focus-ai-parts', name), 'utf8')))
).join('');

await writeFile(join(root, 'FocusAiPracticeScreen.tsx'), content, 'utf8');
console.log(`Generated FocusAiPracticeScreen.tsx (${content.length} chars)`);
