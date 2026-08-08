import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceRegexOnce(source, pattern, replacement, label) {
  pattern.lastIndex = 0;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length === 0) throw new Error(`Visible-overlay patch target missing: ${label}`);
  if (matches.length > 1) throw new Error(`Visible-overlay patch target is ambiguous: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');

center = replaceRegexOnce(
  center,
  /<video\s+ref=\{videoRef\}\s+playsInline\s+muted\s+style=\{\{\s*transform:\s*['"]scaleX\(-1\)['"]\s*\}\}\s*\/>/,
  `<video
            ref={videoRef}
            playsInline
            muted
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
              zIndex: 1,
            }}
          />`,
  'camera video layer',
);

center = replaceRegexOnce(
  center,
  /<canvas\s+ref=\{overlayRef\}\s+style=\{\{\s*transform:\s*['"]scaleX\(-1\)['"]\s*\}\}\s*\/>/,
  `<canvas
            ref={overlayRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none',
              transform: 'scaleX(-1)',
              zIndex: 2,
            }}
          />`,
  'visible landmark canvas layer',
);

writeFileSync(centerPath, center);
console.log('Applied visible hand-landmark canvas stacking above the camera feed.');
