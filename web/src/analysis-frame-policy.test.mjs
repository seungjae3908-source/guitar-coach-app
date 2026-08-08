import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analysisFrameDimensions,
  restoreAnalysisAspect,
} from './analysis-frame-policy.js';

test('keeps landscape analysis dimensions unchanged', () => {
  assert.deepEqual(analysisFrameDimensions(1280, 720), {
    width: 240,
    height: 135,
    orientation: 'landscape',
  });
});

test('rotates the analysis shape for portrait camera input', () => {
  assert.deepEqual(analysisFrameDimensions(720, 1280), {
    width: 135,
    height: 240,
    orientation: 'portrait',
  });
});

test('restores a stretched portrait frame to portrait geometry', () => {
  const width = 4;
  const height = 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = index * 10;
    data[index * 4 + 1] = index * 10;
    data[index * 4 + 2] = index * 10;
    data[index * 4 + 3] = 255;
  }

  const restored = restoreAnalysisAspect(
    { data, width, height },
    width,
    height,
    720,
    1280,
  );

  assert.equal(restored.restored, true);
  assert.equal(restored.orientation, 'portrait');
  assert.equal(restored.width, 2);
  assert.equal(restored.height, 4);
  assert.equal(restored.imageData.data.length, 2 * 4 * 4);
  assert.ok(restored.imageData.data.every((value, index) => index % 4 === 3 ? value === 255 : value >= 0));
});

test('does not resample an already landscape frame', () => {
  const data = new Uint8ClampedArray(4 * 2 * 4);
  const imageData = { data, width: 4, height: 2 };
  const restored = restoreAnalysisAspect(imageData, 4, 2, 1280, 720);

  assert.equal(restored.restored, false);
  assert.equal(restored.imageData, imageData);
  assert.equal(restored.width, 4);
  assert.equal(restored.height, 2);
});
