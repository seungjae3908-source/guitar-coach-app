import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const center = readFileSync(resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx'), 'utf8');

function styleBlockFor(refName) {
  const marker = `ref={${refName}}`;
  const markerAt = center.indexOf(marker);
  assert.notEqual(markerAt, -1, `${refName} should exist`);
  const styleAt = center.indexOf('style={{', markerAt);
  assert.notEqual(styleAt, -1, `${refName} should have an inline style`);
  const styleEnd = center.indexOf('}}', styleAt);
  assert.notEqual(styleEnd, -1, `${refName} style should close`);
  return center.slice(styleAt, styleEnd + 2);
}

test('visible landmark canvas is stacked over the camera video', () => {
  const videoStyle = styleBlockFor('videoRef');
  const overlayStyle = styleBlockFor('overlayRef');

  assert.match(videoStyle, /position:\s*'absolute'/);
  assert.match(videoStyle, /objectFit:\s*'cover'/);
  assert.match(videoStyle, /zIndex:\s*1/);

  assert.match(overlayStyle, /position:\s*'absolute'/);
  assert.match(overlayStyle, /objectFit:\s*'cover'/);
  assert.match(
    overlayStyle,
    /pointerEvents:\s*manualGuitarCalibration\.active\s*\?\s*'auto'\s*:\s*'none'/,
  );
  assert.match(
    overlayStyle,
    /touchAction:\s*manualGuitarCalibration\.active\s*\?\s*'none'\s*:\s*'auto'/,
  );
  assert.match(overlayStyle, /zIndex:\s*2/);
});

test('hand landmarks remain displayable without a detected guitar pose', () => {
  assert.match(center, /for \(const hand of visionRef\.current\.hands \|\| \[\]\)/);
  assert.doesNotMatch(center, /if \([^\n]*poseRef\.current[^\n]*\)\s*\{\s*for \(const hand of visionRef\.current\.hands/);
});
