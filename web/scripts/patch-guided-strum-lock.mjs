import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const centerPath = resolve(process.cwd(), 'src/DebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');
const before = '{ force: Boolean(role.event) })';
const after = '{ force: Boolean(role.event) && !preliminaryGuide?.calibrated })';

if (center.includes(after)) {
  console.log('Guided strum corridor lock already applied.');
  process.exit(0);
}
const first = center.indexOf(before);
if (first < 0) throw new Error('Guided strum corridor lock target missing.');
if (center.indexOf(before, first + before.length) >= 0) throw new Error('Guided strum corridor lock target is ambiguous.');
center = center.slice(0, first) + after + center.slice(first + before.length);
writeFileSync(centerPath, center);
console.log('Locked the coaching corridor after the first valid strum calibration.');
