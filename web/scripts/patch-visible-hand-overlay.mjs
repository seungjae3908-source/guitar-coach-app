import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Visible-overlay patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Visible-overlay patch target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');

center = replaceOnce(
  center,
  "          <video ref={videoRef} playsInline muted style={{ transform: 'scaleX(-1)' }} />\n          <canvas ref={overlayRef} style={{ transform: 'scaleX(-1)' }} />",
  `          <video\n            ref={videoRef}\n            playsInline\n            muted\n            style={{\n              position: 'absolute',\n              inset: 0,\n              width: '100%',\n              height: '100%',\n              objectFit: 'cover',\n              transform: 'scaleX(-1)',\n              zIndex: 1,\n            }}\n          />\n          <canvas\n            ref={overlayRef}\n            style={{\n              position: 'absolute',\n              inset: 0,\n              width: '100%',\n              height: '100%',\n              objectFit: 'cover',\n              pointerEvents: 'none',\n              transform: 'scaleX(-1)',\n              zIndex: 2,\n            }}\n          />`,
  'camera video and visible landmark canvas stacking',
);

writeFileSync(centerPath, center);
console.log('Applied visible hand-landmark canvas stacking above the camera feed.');
