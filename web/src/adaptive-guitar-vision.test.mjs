import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalMotionTracker,
  SimpleDirectionalTracker,
  assignHandRoles,
  detectAdaptiveGuitarPose,
} from './adaptive-guitar-vision.js';

function makeImage(width, height, painter) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 185;
    data[index * 4 + 1] = 145;
    data[index * 4 + 2] = 92;
    data[index * 4 + 3] = 255;
  }
  const set = (x, y, value) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const index = (y * width + x) * 4;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  };
  painter({ set, width, height });
  return { data };
}

function drawFullGuitar({ set, width, height, includeHole = true, includeNeck = true }) {
  const angle = -14 * Math.PI / 180;
  const tangent = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -tangent.y, y: tangent.x };
  const center = { x: width * 0.56, y: height * 0.56 };
  if (includeHole) {
    const radius = 16;
    for (let y = -radius * 2; y <= radius * 2; y += 1) {
      for (let x = -radius * 2; x <= radius * 2; x += 1) {
        const distance = Math.hypot(x, y);
        if (distance <= radius * 0.75) set(Math.round(center.x + x), Math.round(center.y + y), 25);
        else if (distance <= radius * 1.15) set(Math.round(center.x + x), Math.round(center.y + y), 218);
      }
    }
  }
  if (includeNeck) {
    for (let along = -120; along <= 5; along += 1) {
      for (const across of [-10, 10]) {
        for (let thickness = -1; thickness <= 1; thickness += 1) {
          const x = center.x + tangent.x * along + normal.x * (across + thickness);
          const y = center.y + tangent.y * along + normal.y * (across + thickness);
          set(Math.round(x), Math.round(y), 35);
        }
      }
    }
  }
}

test('adaptive pose chooses full mode when soundhole and neck are visible', () => {
  const image = makeImage(320, 180, (ctx) => drawFullGuitar(ctx));
  const pose = detectAdaptiveGuitarPose(image, 320, 180, { timestamp: 1000 });
  assert.equal(pose.mode, 'full');
  assert.ok(pose.soundhole);
  assert.ok(pose.neck);
  assert.equal(pose.lines.length, 6);
  assert.ok(pose.confidence > 0.2);
});

test('adaptive pose falls back to soundhole partial mode', () => {
  const image = makeImage(320, 180, (ctx) => drawFullGuitar({ ...ctx, includeNeck: false }));
  const pose = detectAdaptiveGuitarPose(image, 320, 180, { timestamp: 1000 });
  assert.equal(pose.mode, 'soundhole-partial');
  assert.ok(pose.zones.strum);
  assert.equal(pose.lines.length, 6);
});

test('adaptive pose keeps recent coordinates when the guitar is briefly occluded', () => {
  const image = makeImage(320, 180, (ctx) => drawFullGuitar(ctx));
  const first = detectAdaptiveGuitarPose(image, 320, 180, { timestamp: 1000 });
  const blank = makeImage(320, 180, () => {});
  const tracked = detectAdaptiveGuitarPose(blank, 320, 180, { previousPose: first, timestamp: 1700 });
  assert.equal(tracked.mode, 'tracking');
  assert.equal(tracked.lines.length, 6);
});

test('hand roles use soundhole for strum and neck for fret', () => {
  const image = makeImage(320, 180, (ctx) => drawFullGuitar(ctx));
  const pose = detectAdaptiveGuitarPose(image, 320, 180, { timestamp: 1000 });
  const hands = [
    { trackId: 1, pickPoint: pose.zones.strum.center, wrist: pose.zones.strum.center },
    { trackId: 2, pickPoint: pose.zones.fret.center, wrist: pose.zones.fret.center },
  ];
  const roles = assignHandRoles(hands, pose);
  assert.equal(roles.find((hand) => hand.trackId === 1).role, 'strum');
  assert.equal(roles.find((hand) => hand.trackId === 2).role, 'fret');
});

test('direction tracker catches a fast crossing without requiring every intermediate point', () => {
  const tracker = new SimpleDirectionalTracker();
  const band = { top: 0.45, bottom: 0.55, center: 0.5, normalX: 0, normalY: 1 };
  assert.equal(tracker.sample({ point: { x: 0.5, y: 0.38 }, band, timestamp: 0, ready: true }), null);
  assert.equal(tracker.sample({ point: { x: 0.5, y: 0.63 }, band, timestamp: 80, ready: true }), 'down');
});

test('local motion tracker rejects motion when there was no recent hand', () => {
  const tracker = new LocalMotionTracker();
  const pose = {
    confidence: 0.8,
    axis: { tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } },
    zones: { strum: { center: { x: 0.5, y: 0.5 }, alongRadius: 0.3, acrossRadius: 0.3 } },
    stringBand: { top: 0.45, bottom: 0.55, center: 0.5, normalX: 0, normalY: 1 },
  };
  const first = makeImage(80, 60, () => {});
  tracker.update({ imageData: first, width: 80, height: 60, pose, timestamp: 0, recentHandAt: 0 });
  const second = makeImage(80, 60, ({ set }) => {
    for (let y = 35; y < 48; y += 1) for (let x = 35; x < 45; x += 1) set(x, y, 20);
  });
  const result = tracker.update({ imageData: second, width: 80, height: 60, pose, timestamp: 1000, recentHandAt: 0 });
  assert.equal(result.event, null);
});

test('manual soundhole hint overrides a false automatic candidate', () => {
  const image = makeImage(320, 180, () => {});
  const pose = detectAdaptiveGuitarPose(image, 320, 180, {
    timestamp: 1000,
    soundholeHint: { x: 0.72, y: 0.62, radius: 0.09 },
  });
  assert.equal(pose.mode, 'soundhole-partial');
  assert.equal(pose.soundhole.manual, true);
  assert.ok(Math.abs(pose.soundhole.x - 0.72) < 0.001);
  assert.equal(pose.lines.length, 6);
});
