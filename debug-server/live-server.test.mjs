import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createLiveDiagnosticServer } from './live-server.mjs';

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  return { response, body };
}

test('live session accepts telemetry and exposes privacy-safe state', async (t) => {
  const origin = 'https://example.test';
  const instance = createLiveDiagnosticServer({
    adminSecret: 'admin-secret',
    deviceSecret: 'device-secret',
    allowedOrigin: origin,
    allowedOrigins: [origin],
    production: true,
  });
  instance.server.listen(0, '127.0.0.1');
  await once(instance.server, 'listening');
  t.after(() => instance.server.close());

  const address = instance.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const created = await requestJson(`${base}/api/live-sessions`, {
    method: 'POST',
    headers: { Origin: origin },
  });
  assert.equal(created.response.status, 201);
  assert.match(created.body.code, /^[A-Z0-9]{10,12}$/);
  assert.equal(created.body.privacy.frameUpload, false);

  const telemetry = await requestJson(`${base}/api/sessions/${created.body.code}/telemetry`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Authorization: `Bearer ${created.body.deviceToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sequence: 1,
      clientAt: Date.now(),
      mode: 'camera',
      currentTest: 'down',
      camera: { active: true, facing: 'user', width: 720, height: 1280, fps: 30, brightness: 140, motion: 12 },
      detection: { handCount: 2, handLandmarks: 42, guitarVisible: true, stringCount: 6, strokeDirection: 'none', strokeCount: 0 },
      confidence: { hand: 0.8, guitar: 0.7, strings: 0.75, stroke: 0.4 },
      frame: 'data:image/jpeg;base64,never-store-this',
    }),
  });
  assert.equal(telemetry.response.status, 202);

  const state = await requestJson(`${base}/api/live-sessions/${created.body.code}`);
  assert.equal(state.response.status, 200);
  assert.equal(state.body.telemetry.currentTest, 'down');
  assert.equal(state.body.telemetry.detection.handCount, 2);
  assert.equal(state.body.telemetry.frame, null);
  assert.equal(state.body.history[0].frame, null);
});

test('live session creation rejects unknown browser origins', async (t) => {
  const origin = 'https://allowed.test';
  const instance = createLiveDiagnosticServer({
    adminSecret: 'admin-secret',
    deviceSecret: 'device-secret',
    allowedOrigin: origin,
    allowedOrigins: [origin],
    production: true,
  });
  instance.server.listen(0, '127.0.0.1');
  await once(instance.server, 'listening');
  t.after(() => instance.server.close());

  const address = instance.server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/live-sessions`, {
    method: 'POST',
    headers: { Origin: 'https://blocked.test' },
  });
  assert.equal(response.status, 403);
});
