import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createDiagnosticServer } from './server.mjs';

let instance;
let baseUrl;

before(async () => {
  instance = createDiagnosticServer({
    adminSecret: 'admin-bootstrap-secret',
    deviceSecret: 'device-bootstrap-secret',
    allowedOrigin: 'https://debug.example.test',
    production: true,
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const address = instance.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => instance.server.close((error) => error ? reject(error) : resolve()));
});

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

test('health endpoint is available without exposing session data', async () => {
  const { response, body } = await json('/health');
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.sessions, 'number');
});

test('secure session lifecycle, telemetry privacy, settings, checklist, and export', async () => {
  const unauthorized = await json('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'ABC-123' }),
  });
  assert.equal(unauthorized.response.status, 401);

  const created = await json('/api/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-secret': 'admin-bootstrap-secret',
      origin: 'https://debug.example.test',
    },
    body: JSON.stringify({ code: 'ABC-123' }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.code, 'ABC-123');
  assert.ok(created.body.adminToken);
  assert.ok(created.body.deviceToken);
  assert.equal(created.response.headers.get('access-control-allow-origin'), 'https://debug.example.test');

  const { adminToken, deviceToken } = created.body;
  const telemetry = await json('/api/sessions/ABC-123/telemetry', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${deviceToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sequence: 1,
      mode: 'camera',
      currentTest: 'hand',
      camera: { active: true, width: 1280, height: 720, fps: 29.7, brightness: 44, motion: 10 },
      detection: { handCount: 1, handLandmarks: 21, guitarVisible: true, stringCount: 6, strokeDirection: 'down', strokeCount: 2 },
      confidence: { hand: 0.91, guitar: 0.86, strings: 0.77, stroke: 0.72 },
      tts: { supported: true, speaking: false, lastResult: 'ok' },
      network: { online: true, reconnects: 1, queueDepth: 0 },
      frame: 'data:image/jpeg;base64,PRIVATE_FRAME',
    }),
  });
  assert.equal(telemetry.response.status, 202);

  const state = await json('/api/sessions/ABC-123/state', {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(state.response.status, 200);
  assert.equal(state.body.online, true);
  assert.equal(state.body.telemetry.camera.fps, 29.7);
  assert.equal(state.body.telemetry.detection.stringCount, 6);
  assert.equal(state.body.telemetry.frame, null, 'frames must be discarded until admin explicitly enables uploads');

  const settings = await json('/api/sessions/ABC-123/settings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      thresholds: { minBrightness: 18, minFps: 20, motionThreshold: 12, handConfidence: 0.7, guitarConfidence: 0.68, stringConfidence: 0.6 },
      instruction: '오른손과 브리지가 함께 보일 때까지 휴대폰 각도를 조정하세요.',
      privacy: { allowFrameUpload: true, retainTelemetryHours: 12 },
    }),
  });
  assert.equal(settings.response.status, 200);
  assert.equal(settings.body.settings.thresholds.minFps, 20);
  assert.equal(settings.body.settings.privacy.allowFrameUpload, true);
  assert.equal(settings.body.settings.instructionRevision, 1);

  const checklist = await json('/api/sessions/ABC-123/checklist', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${deviceToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id: 'hand', status: 'pass', note: '21개 랜드마크 감지' }),
  });
  assert.equal(checklist.response.status, 200);
  assert.equal(checklist.body.item.status, 'pass');

  const exported = await json('/api/sessions/ABC-123/export', {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(exported.response.status, 200);
  assert.equal(exported.body.checklist.hand.status, 'pass');
  assert.equal(exported.body.history.length, 1);

  const deleted = await json('/api/sessions/ABC-123', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(deleted.response.status, 200);

  const missing = await json('/api/sessions/ABC-123/state', {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(missing.response.status, 404);
});
