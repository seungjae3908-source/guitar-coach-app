import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const selections = {
  'src/AdaptiveDebugCenter.jsx': [[118, 132], [360, 414], [462, 482], [658, 690]],
  'src/adaptive-guitar-vision.js': [[510, 560], [600, 652]],
};

for (const [file, ranges] of Object.entries(selections)) {
  const lines = readFileSync(resolve(process.cwd(), file), 'utf8').split(/\r?\n/);
  console.log(`\n===== ${file} =====`);
  for (const [from, to] of ranges) {
    console.log(`--- lines ${from}-${to} ---`);
    for (let number = from; number <= Math.min(to, lines.length); number += 1) {
      console.log(`${String(number).padStart(4, ' ')} ${lines[number - 1]}`);
    }
  }
}
