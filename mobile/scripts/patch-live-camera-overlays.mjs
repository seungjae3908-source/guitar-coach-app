import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cameraPath = resolve(process.cwd(), 'components/LiveLocalCoachCamera.tsx');
let source = readFileSync(cameraPath, 'utf8');

if (!source.includes("from './LiveMeasurementOverlay'")) {
  const importTarget = "import FocusCoachCameraV7 from './FocusCoachCameraV7';";
  if (!source.includes(importTarget)) {
    throw new Error('Live camera overlay import target not found.');
  }
  source = source.replace(
    importTarget,
    `${importTarget}\nimport LiveMeasurementOverlay from './LiveMeasurementOverlay';`,
  );
}

if (!source.includes('<LiveMeasurementOverlay result={result} size={size} category={category} />')) {
  const overlayTarget = [
    '      <GuitarOverlay result={result} size={size} />',
    '      <HandOverlay result={result} size={size} />',
  ].join('\n');
  if (!source.includes(overlayTarget)) {
    throw new Error('Live camera overlay render target not found.');
  }
  source = source.replace(
    overlayTarget,
    `${overlayTarget}\n      <LiveMeasurementOverlay result={result} size={size} category={category} />`,
  );
}

writeFileSync(cameraPath, source);
console.log('Live camera angle, radius, and chord overlays are connected.');
