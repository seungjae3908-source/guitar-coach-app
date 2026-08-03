import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateGuitarPresence,
  validateGuitarPresence,
} from './guitar-presence-policy.js';

const matchingBand = {
  top: 0.46,
  bottom: 0.54,
  center: 0.5,
  normalX: 0,
  normalY: 1,
  tangentX: 1,
  tangentY: 0,
  angle: 0,
  supportMin: 0.1,
  supportMax: 0.9,
  supportLength: 0.8,
};

const pose = {
  mode: 'full',
  confidence: 0.84,
  soundhole: { x: 0.32, y: 0.5, radius: 0.09 },
  neck: { leftEdge: { start: { x: 0.4, y: 0.47 } } },
  lines: [
    { start: { x: 0.1, y: 0.47 }, end: { x: 0.9, y: 0.47 } },
    { start: { x: 0.1, y: 0.53 }, end: { x: 0.9, y: 0.53 } },
  ],
  stringBand: matchingBand,
  axis: { tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } },
  zones: {
    strum: { center: { x: 0.35, y: 0.5 }, alongRadius: 0.2, acrossRadius: 0.1 },
  },
};

function observed(overrides = {}) {
  const lines = Array.from({ length: 6 }, (_, index) => ({
    start: { x: 0.1, y: 0.47 + index * 0.012 },
    end: { x: 0.9, y: 0.47 + index * 0.012 },
  }));
  return {
    count: 6,
    confidence: 0.72,
    lines,
    band: matchingBand,
    ...overrides,
  };
}

test('accepts a pose only when localized observed strings agree with it', () => {
  const result = evaluateGuitarPresence({ pose, observedStrings: observed() });
  assert.equal(result.valid, true);
  assert.equal(result.reason, '실제 기타 줄 확인');
});

test('rejects a guitar-shaped false positive without observed strings', () => {
  const result = evaluateGuitarPresence({
    pose,
    observedStrings: { count: 0, confidence: 0, lines: [], band: null },
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, '실제 기타 줄 미확인');
});

test('rejects parallel texture whose direction disagrees with the guitar pose', () => {
  const mismatchedBand = {
    ...matchingBand,
    angle: 55,
    normalX: -0.819152,
    normalY: 0.573576,
  };
  const result = evaluateGuitarPresence({
    pose,
    observedStrings: observed({ band: mismatchedBand }),
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, '기타 방향과 실제 줄 불일치');
});

test('treats reversed line direction as the same physical string direction', () => {
  const reversed = {
    ...matchingBand,
    top: -0.54,
    bottom: -0.46,
    center: -0.5,
    normalX: 0,
    normalY: -1,
    tangentX: -1,
    tangentY: 0,
    angle: 180,
  };
  const result = evaluateGuitarPresence({
    pose,
    observedStrings: observed({ band: reversed }),
  });
  assert.equal(result.valid, true);
});

test('uses independently observed lines in the validated pose', () => {
  const strings = observed();
  const validated = validateGuitarPresence({ pose, observedStrings: strings, timestamp: 1000 });
  assert.equal(validated.guitarValidated, true);
  assert.equal(validated.lines, strings.lines);
  assert.equal(validated.stringBand, strings.band);
  assert.equal(validated.validatedAt, 1000);
});

test('holds the last validated guitar briefly through hand occlusion', () => {
  const previous = validateGuitarPresence({ pose, observedStrings: observed(), timestamp: 1000 });
  const held = validateGuitarPresence({
    pose: { ...pose, mode: 'tracking' },
    observedStrings: { count: 0, confidence: 0, lines: [], band: null },
    previous,
    timestamp: 1500,
    holdMs: 900,
  });
  assert.equal(held.guitarValidated, true);
  assert.equal(held.mode, 'tracking');
});

test('expires the retained guitar after the bounded hold window', () => {
  const previous = validateGuitarPresence({ pose, observedStrings: observed(), timestamp: 1000 });
  const expired = validateGuitarPresence({
    pose: { ...pose, mode: 'tracking' },
    observedStrings: { count: 0, confidence: 0, lines: [], band: null },
    previous,
    timestamp: 2100,
    holdMs: 900,
  });
  assert.equal(expired.guitarValidated, false);
  assert.equal(expired.mode, 'none');
  assert.equal(expired.confidence, 0);
});
