import crypto from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { URL } from 'node:url';

const CHECK_IDS = ['camera', 'screen', 'feed', 'fps', 'brightness', 'hand', 'guitar', 'strings', 'down', 'up', 'tts', 'reconnect', 'privacy'];
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const cleanCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
const token = () => crypto.randomBytes(24).toString('base64url');
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const safe = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

function same(value, expected) {
  if (!expected) return false;
  const left = Buffer.from(String(value || ''));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function newChecklist() {
  return Object.fromEntries(CHECK_IDS.map((id) => [id, { id, status: 'pending', note: '', updatedAt: 0 }]));
}

function newSession(code) {
  return {
    code,
    createdAt: Date.now(),
    lastSeenAt: 0,
    adminTokenHash: '',
    deviceTokenHash: '',
    telemetry: null,
    history: [],
    errors: [],
    checklist: newChecklist(),
    settings: {
      thresholds: {
        minBrightness: 12,
        minFps: 12,
        motionThreshold: 8,
        handConfidence: 0.55,
        guitarConfidence: 0.55,
        stringConfidence: 0.45,
      },
      instruction: '',
      instructionRevision: 0,
      privacy: { allowFrameUpload: false, retainTelemetryHours: 24 },
      updatedAt: 0,
    },
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > 1_000_000) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error('invalid json'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function bearer(request) {
  const authorization = String(request.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
}

function normalizeTelemetry(payload) {
  return {
    sequence: Math.floor(clamp(payload.sequence, 0, Number.MAX_SAFE_INTEGER, 0)),
    clientAt: clamp(payload.clientAt, 0, Number.MAX_SAFE_INTEGER, 0),
    mode: ['camera', 'screen', 'app'].includes(payload.mode) ? payload.mode : 'camera',
    currentTest: safe(payload.currentTest, 40),
    camera: {
      active: Boolean(payload.camera?.active), facing: safe(payload.camera?.facing, 20),
      width: Math.floor(clamp(payload.camera?.width, 0, 7680, 0)), height: Math.floor(clamp(payload.camera?.height, 0, 4320, 0)),
      fps: clamp(payload.camera?.fps, 0, 240, 0), brightness: clamp(payload.camera?.brightness, 0, 255, 0),
      motion: clamp(payload.camera?.motion, 0, 255, 0), blackFrame: Boolean(payload.camera?.blackFrame),
    },
    detection: {
      handCount: Math.floor(clamp(payload.detection?.handCount, 0, 4, 0)),
      handLandmarks: Math.floor(clamp(payload.detection?.handLandmarks, 0, 42, 0)),
      guitarVisible: Boolean(payload.detection?.guitarVisible),
      stringCount: Math.floor(clamp(payload.detection?.stringCount, 0, 12, 0)),
      strokeDirection: ['down', 'up', 'none'].includes(payload.detection?.strokeDirection) ? payload.detection.strokeDirection : 'none',
      strokeCount: Math.floor(clamp(payload.detection?.strokeCount, 0, 100000, 0)),
    },
    confidence: {
      hand: clamp(payload.confidence?.hand, 0, 1, 0), guitar: clamp(payload.confidence?.guitar, 0, 1, 0),
      strings: clamp(payload.confidence?.strings, 0, 1, 0), stroke: clamp(payload.confidence?.stroke, 0, 1, 0),
    },
    tts: { supported: Boolean(payload.tts?.supported), speaking: Boolean(payload.tts?.speaking), lastResult: safe(payload.tts?.lastResult, 80) },
    network: { online: payload.network?.online !== false, reconnects: Math.floor(clamp(payload.network?.reconnects, 0, 100000, 0)), queueDepth: Math.floor(clamp(payload.network?.queueDepth, 0, 10000, 0)) },
    error: payload.error ? { code: safe(payload.error.code, 80), message: safe(payload.error.message, 500) } : null,
    frame: typeof payload.frame === 'string' ? payload.frame.slice(0, 700000) : null,
    receivedAt: Date.now(),
  };
}

export function createDiagnosticServer(options = {}) {
  const adminSecret = options.adminSecret ?? process.env.ADMIN_SHARED_SECRET ?? '';
  const deviceSecret = options.deviceSecret ?? process.env.DEVICE_SHARED_SECRET ?? '';
  const allowedOrigin = options.allowedOrigin ?? process.env.ALLOWED_ORIGIN ?? '';
  const production = options.production ?? process.env.NODE_ENV === 'production';
  if (production && (!adminSecret || !deviceSecret || !allowedOrigin)) throw new Error('Production requires ADMIN_SHARED_SECRET, DEVICE_SHARED_SECRET, and ALLOWED_ORIGIN.');

  const sessions = new Map();
  const clients = new Map();

  const headers = (request) => {
    const origin = String(request.headers.origin || '');
    return {
      ...(origin && origin === allowedOrigin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
      'access-control-allow-headers': 'content-type, authorization, x-device-secret, x-admin-secret',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    };
  };

  const reply = (request, response, status, payload) => {
    response.writeHead(status, { ...headers(request), 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
  };

  const authorized = (request, session, role) => {
    const legacy = role === 'admin' ? same(request.headers['x-admin-secret'], adminSecret) : same(request.headers['x-device-secret'], deviceSecret);
    if (legacy) return true;
    return same(hash(bearer(request)), role === 'admin' ? session.adminTokenHash : session.deviceTokenHash);
  };

  const emit = (code, event, payload) => {
    for (const response of clients.get(code) || []) response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const exported = (session) => ({
    version: 1, exportedAt: Date.now(), code: session.code, createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt, checklist: session.checklist, settings: session.settings,
    telemetry: session.telemetry, history: session.history, errors: session.errors,
  });

  const server = http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') { response.writeHead(204, headers(request)); response.end(); return; }
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        reply(request, response, 200, { ok: true, sessions: sessions.size, now: Date.now() }); return;
      }

      if (request.method === 'POST' && url.pathname === '/api/sessions') {
        if (!same(request.headers['x-admin-secret'], adminSecret)) { reply(request, response, 401, { error: 'admin unauthorized' }); return; }
        const payload = await readJson(request);
        const code = cleanCode(payload.code || crypto.randomBytes(4).toString('hex'));
        if (!code) { reply(request, response, 400, { error: 'invalid session code' }); return; }
        const session = newSession(code);
        const adminToken = token(); const deviceToken = token();
        session.adminTokenHash = hash(adminToken); session.deviceTokenHash = hash(deviceToken);
        sessions.set(code, session);
        reply(request, response, 201, { code, adminToken, deviceToken, createdAt: session.createdAt }); return;
      }

      if (parts[0] !== 'api' || parts[1] !== 'sessions' || !parts[2]) { reply(request, response, 404, { error: 'not found' }); return; }
      const session = sessions.get(cleanCode(parts[2]));
      if (!session) { reply(request, response, 404, { error: 'session not found' }); return; }
      const action = parts[3] || '';

      if (request.method === 'POST' && action === 'telemetry') {
        if (!authorized(request, session, 'device')) { reply(request, response, 401, { error: 'device unauthorized' }); return; }
        const telemetry = normalizeTelemetry(await readJson(request));
        if (!session.settings.privacy.allowFrameUpload) telemetry.frame = null;
        session.lastSeenAt = telemetry.receivedAt; session.telemetry = telemetry;
        session.history.unshift(telemetry); session.history = session.history.slice(0, 600);
        if (telemetry.error) { session.errors.unshift({ ...telemetry.error, at: telemetry.receivedAt }); session.errors = session.errors.slice(0, 100); }
        emit(session.code, 'telemetry', telemetry);
        reply(request, response, 202, { ok: true, receivedAt: telemetry.receivedAt, settingsRevision: session.settings.instructionRevision }); return;
      }

      if (request.method === 'GET' && action === 'state') {
        if (!authorized(request, session, 'admin')) { reply(request, response, 401, { error: 'admin unauthorized' }); return; }
        reply(request, response, 200, { ...exported(session), online: Date.now() - session.lastSeenAt < 7000, history: session.history.slice(0, 120) }); return;
      }

      if (request.method === 'GET' && action === 'settings') {
        if (!authorized(request, session, 'device')) { reply(request, response, 401, { error: 'device unauthorized' }); return; }
        reply(request, response, 200, session.settings); return;
      }

      if (request.method === 'POST' && action === 'settings') {
        if (!authorized(request, session, 'admin')) { reply(request, response, 401, { error: 'admin unauthorized' }); return; }
        const payload = await readJson(request); const previous = session.settings;
        session.settings = {
          thresholds: {
            minBrightness: clamp(payload.thresholds?.minBrightness, 3, 80, previous.thresholds.minBrightness),
            minFps: clamp(payload.thresholds?.minFps, 1, 60, previous.thresholds.minFps),
            motionThreshold: clamp(payload.thresholds?.motionThreshold, 1, 80, previous.thresholds.motionThreshold),
            handConfidence: clamp(payload.thresholds?.handConfidence, 0.1, 0.99, previous.thresholds.handConfidence),
            guitarConfidence: clamp(payload.thresholds?.guitarConfidence, 0.1, 0.99, previous.thresholds.guitarConfidence),
            stringConfidence: clamp(payload.thresholds?.stringConfidence, 0.1, 0.99, previous.thresholds.stringConfidence),
          },
          instruction: safe(payload.instruction, 500), instructionRevision: previous.instructionRevision + 1,
          privacy: { allowFrameUpload: Boolean(payload.privacy?.allowFrameUpload), retainTelemetryHours: clamp(payload.privacy?.retainTelemetryHours, 1, 168, previous.privacy.retainTelemetryHours) },
          updatedAt: Date.now(),
        };
        emit(session.code, 'settings', session.settings);
        reply(request, response, 200, { ok: true, settings: session.settings }); return;
      }

      if (request.method === 'POST' && action === 'checklist') {
        if (!authorized(request, session, 'admin') && !authorized(request, session, 'device')) { reply(request, response, 401, { error: 'unauthorized' }); return; }
        const payload = await readJson(request); const id = safe(payload.id, 40);
        if (!CHECK_IDS.includes(id)) { reply(request, response, 400, { error: 'unknown checklist id' }); return; }
        const status = ['pending', 'active', 'pass', 'fail', 'blocked'].includes(payload.status) ? payload.status : 'pending';
        session.checklist[id] = { id, status, note: safe(payload.note, 500), updatedAt: Date.now() };
        emit(session.code, 'checklist', session.checklist[id]);
        reply(request, response, 200, { ok: true, item: session.checklist[id] }); return;
      }

      if (request.method === 'GET' && action === 'events') {
        if (!authorized(request, session, 'admin')) { reply(request, response, 401, { error: 'admin unauthorized' }); return; }
        response.writeHead(200, { ...headers(request), 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' });
        response.write(`event: state\ndata: ${JSON.stringify(exported(session))}\n\n`);
        const set = clients.get(session.code) || new Set(); set.add(response); clients.set(session.code, set);
        const heartbeat = setInterval(() => response.write(`: heartbeat ${Date.now()}\n\n`), 15000);
        request.on('close', () => { clearInterval(heartbeat); set.delete(response); if (!set.size) clients.delete(session.code); }); return;
      }

      if (request.method === 'GET' && action === 'export') {
        if (!authorized(request, session, 'admin')) { reply(request, response, 401, { error: 'admin unauthorized' }); return; }
        reply(request, response, 200, exported(session)); return;
      }

      if (request.method === 'DELETE' && !action) {
        if (!authorized(request, session, 'admin')) { reply(request, response, 401, { error: 'admin unauthorized' }); return; }
        sessions.delete(session.code); emit(session.code, 'deleted', { at: Date.now() });
        reply(request, response, 200, { ok: true }); return;
      }

      reply(request, response, 404, { error: 'not found' });
    } catch (error) {
      reply(request, response, error.status || 400, { error: error.message || 'request failed' });
    }
  });

  const cleanup = setInterval(() => {
    const current = Date.now();
    for (const [code, session] of sessions) {
      const retention = session.settings.privacy.retainTelemetryHours * 3600000;
      session.history = session.history.filter((entry) => current - entry.receivedAt <= retention);
      if (current - Math.max(session.createdAt, session.lastSeenAt, session.settings.updatedAt) > SESSION_TTL_MS && !(clients.get(code)?.size)) sessions.delete(code);
    }
  }, 600000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  return { server, sessions };
}

export function startDiagnosticServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 8787);
  const instance = createDiagnosticServer(options);
  instance.server.listen(port, '0.0.0.0', () => console.log(`Guitar Coach diagnostic relay listening on ${port}`));
  return instance;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startDiagnosticServer();
