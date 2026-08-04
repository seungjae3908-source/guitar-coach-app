import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx'), 'utf8');
const lines = source.split('\n');
const terms = [
  '@mediapipe/tasks-vision',
  'modelRef',
  'detectForVideo',
  'adaptiveLiveStrumRef',
  'rightHandTechnique',
  'EvidencePill',
  '스트럼 손',
  '줄 신뢰도',
  '타격점',
  '최근 스트럼',
  '진단',
  'currentVision',
  'setVision(',
  'return (',
];
const indices = new Set();
for (let index = 0; index < lines.length; index += 1) {
  if (terms.some((term) => lines[index].includes(term))) {
    for (let offset = -5; offset <= 12; offset += 1) {
      const selected = index + offset;
      if (selected >= 0 && selected < lines.length) indices.add(selected);
    }
  }
}
console.log('--- ADAPTIVE FINAL SOURCE STRUCTURE BEGIN ---');
for (const index of [...indices].sort((left, right) => left - right)) {
  console.log(`${String(index + 1).padStart(4, '0')}: ${lines[index]}`);
}
console.log('--- ADAPTIVE FINAL SOURCE STRUCTURE END ---');
