import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const file of ['src/AdaptiveDebugCenter.jsx', 'src/adaptive-guitar-vision.js']) {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8');
  const lines = source.split(/\r?\n/);
  const needles = [
    'assignHandRoles',
    'strumHandSelected',
    'recentHandAt',
    'LocalMotionTracker',
    'motionTracker',
    'lockReason',
    'handsRef',
    'lastHand',
    'handRole',
    'roles =',
  ];
  console.log(`\n===== ${file} =====`);
  const shown = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    if (!needles.some((needle) => lines[index].includes(needle))) continue;
    const start = Math.max(0, index - 4);
    const end = Math.min(lines.length, index + 8);
    const key = `${start}:${end}`;
    if (shown.has(key)) continue;
    shown.add(key);
    console.log(`--- lines ${start + 1}-${end} ---`);
    for (let cursor = start; cursor < end; cursor += 1) {
      console.log(`${String(cursor + 1).padStart(4, ' ')} ${lines[cursor]}`);
    }
  }
}
