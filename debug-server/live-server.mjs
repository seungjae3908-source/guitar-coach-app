import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createDiagnosticServer } from './server.mjs';

const LIVE_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const CREATE_WINDOW_MS = 60 * 60 * 1000;
const CREATE_LIMIT_PER_IP = 30;
const MAX_BODY_BYTES = 200_000;

const cleanCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const token = () => crypto.randomBytes(24).toString('base64url');
const sessionCode = () => crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
const text = (value, max = 160) => String(value ?? '').slice(0, max);
const number = (value, min = 0, max = 1, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

function checklist() {
  const ids = ['camera', 'screen', 'feed', 'fps', 'brightness', 'hand', 'guitar', 'strings', 'down', 'up', 'tts', 'reconnect', 'privacy'];
  return Object.fromEntries(ids.map((id) => [id, { id, status: 'pending', note: '', updatedAt: 0 }]));
}

function liveSession(code, deviceToken) {
  const now = Date.now();
  return {
    code,
    createdAt: now,
    lastSeenAt: 0,
    adminTokenHash: hash(token()),
    deviceTokenHash: hash(deviceToken),
    telemetry: null,
    history: [],
    errors: [],
    checklist: checklist(),
    liveDiagnostics: null,
    liveDiagnosticsHistory: [],
    settings: {
      thresholds: {
        minBrightness: 12,
        minFps: 12,
        motionThreshold: 8,
        handConfidence: 0.45,
        guitarConfidence: 0.3,
        stringConfidence: 0.32,
      },
      instruction: '',
      instructionRevision: 0,
      privacy: { allowFrameUpload: false, retainTelemetryHours: 2 },
      updatedAt: now,
    },
  };
}

function parseOrigins(options = {}) {
  const supplied = options.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? process.env.ALLOWED_ORIGIN ?? '';
  const values = Array.isArray(supplied) ? supplied : String(supplied).split(',');
  return new Set(values.map((value) => value.trim()).filter(Boolean));
}

function liveHeaders(request, origins) {
  const origin = String(request.headers.origin || '');
  return {
    ...(origin && origins.has(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };
}

function sendJson(request, response, origins, status, payload) {
  response.writeHead(status, { ...liveHeaders(request, origins), 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function remoteAddress(request) {
  return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim();
}

function bearer(request) {
  const authorization = String(request.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
}

function secureHashEqual(value, expectedHash) {
  const left = Buffer.from(hash(value));
  const right = Buffer.from(String(expectedHash || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
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

function sanitizePoint(point) {
  if (!point) return null;
  return { x: number(point.x), y: number(point.y) };
}

function sanitizeDiagnostics(payload = {}) {
  const hands = Array.isArray(payload.hands) ? payload.hands.slice(0, 2).map((hand) => ({
    handedness: ['Left', 'Right', 'Unknown'].includes(hand?.handedness) ? hand.handedness : 'Unknown',
    confidence: number(hand?.confidence),
    landmarks: Math.floor(number(hand?.landmarks, 0, 21, 0)),
    wrist: sanitizePoint(hand?.wrist),
    pickPoint: sanitizePoint(hand?.pickPoint),
  })) : [];
  return {
    sequence: Math.floor(number(payload.sequence, 0, Number.MAX_SAFE_INTEGER, 0)),
    clientAt: number(payload.clientAt, 0, Number.MAX_SAFE_INTEGER, 0),
    receivedAt: Date.now(),
    currentTest: text(payload.currentTest, 40),
    blockedReason: text(payload.blockedReason, 300),
    camera: {
      width: Math.floor(number(payload.camera?.width, 0, 7680, 0)),
      height: Math.floor(number(payload.camera?.height, 0, 4320, 0)),
      fps: number(payload.camera?.fps, 0, 240, 0),
      brightness: number(payload.camera?.brightness, 0, 255, 0),
      facing: text(payload.camera?.facing, 20),
    },
    hands,
    guitar: {
      visible: Boolean(payload.guitar?.visible),
      confidence: number(payload.guitar?.confidence),
      modelScore: number(payload.guitar?.modelScore),
      label: text(payload.guitar?.label, 120),
      angle: number(payload.guitar?.angle, -90, 90, 0),
      center: sanitizePoint(payload.guitar?.center),
    },
    strings: {
      count: Math.floor(number(payload.strings?.count, 0, 12, 0)),
      confidence: number(payload.strings?.confidence),
      angle: number(payload.strings?.angle, -90, 90, 0),
      band: payload.strings?.band ? {
        top: number(payload.strings.band.top),
        bottom: number(payload.strings.band.bottom),
        center: number(payload.strings.band.center),
      } : null,
    },
    strokes: {
      down: Math.floor(number(payload.strokes?.down, 0, 100000, 0)),
      up: Math.floor(number(payload.strokes?.up, 0, 100000, 0)),
      lastDirection: ['down', 'up', 'none'].includes(payload.strokes?.lastDirection) ? payload.strokes.lastDirection : 'none',
      ready: Boolean(payload.strokes?.ready),
    },
    model: {
      hand: text(payload.model?.hand, 80),
      guitar: text(payload.model?.guitar, 80),
      error: text(payload.model?.error, 500),
    },
  };
}

function publicState(session) {
  const sanitize = (entry) => entry ? { ...entry, frame: null } : null;
  return {
    version: 2,
    code: session.code,
    createdAt: session.createdAt,
    expiresAt: session.createdAt + LIVE_SESSION_TTL_MS,
    lastSeenAt: session.lastSeenAt,
    online: Date.now() - session.lastSeenAt < 7000,
    telemetry: sanitize(session.telemetry),
    history: session.history.slice(0, 120).map(sanitize),
    diagnostics: session.liveDiagnostics,
    diagnosticsHistory: session.liveDiagnosticsHistory.slice(0, 120),
    errors: session.errors.slice(0, 100),
    checklist: session.checklist,
  };
}

export function createLiveDiagnosticServer(options = {}) {
  const instance = createDiagnosticServer(options);
  const { server, sessions } = instance;
  const originalListeners = server.listeners('request');
  if (originalListeners.length !== 1) throw new Error('Expected exactly one diagnostic request handler.');
  const original = originalListeners[0];
  const origins = parseOrigins(options);
  const creates = new Map();

  server.removeAllListeners('request');
  server.on('request', async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const isLiveRoute = url.pathname === '/api/live-sessions' || url.pathname.startsWith('/api/live-sessions/');
    if (!isLiveRoute) {
      await original.call(server, request, response);
      return;
    }

    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, liveHeaders(request, origins));
        response.end();
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/live-sessions') {
        const origin = String(request.headers.origin || '');
        if (!origins.has(origin)) {
          sendJson(request, response, origins, 403, { error: 'origin not allowed' });
          return;
        }
        const ip = remoteAddress(request);
        const now = Date.now();
        const recent = (creates.get(ip) || []).filter((at) => now - at < CREATE_WINDOW_MS);
        if (recent.length >= CREATE_LIMIT_PER_IP) {
          sendJson(request, response, origins, 429, { error: 'session creation rate limit exceeded' });
          return;
        }
        recent.push(now);
        creates.set(ip, recent);

        let code = sessionCode();
        while (sessions.has(code)) code = sessionCode();
        const deviceToken = token();
        sessions.set(code, liveSession(code, deviceToken));
        sendJson(request, response, origins, 201, {
          code,
          deviceToken,
          expiresAt: now + LIVE_SESSION_TTL_MS,
          privacy: { frameUpload: false, telemetryOnly: true },
        });
        return;
      }

      const parts = url.pathname.split('/').filter(Boolean);
      const code = cleanCode(parts[2]);
      const action = parts[3] || '';
      const session = sessions.get(code);
      if (!session || Date.now() - session.createdAt > LIVE_SESSION_TTL_MS) {
        if (session) sessions.delete(code);
        sendJson(request, response, origins, 404, { error: 'live session not found or expired' });
        return;
      }

      if (request.method === 'POST' && action === 'diagnostics') {
        const origin = String(request.headers.origin || '');
        if (!origins.has(origin)) {
          sendJson(request, response, origins, 403, { error: 'origin not allowed' });
          return;
        }
        if (!secureHashEqual(bearer(request), session.deviceTokenHash)) {
          sendJson(request, response, origins, 401, { error: 'device unauthorized' });
          return;
        }
        const diagnostics = sanitizeDiagnostics(await readJson(request));
        session.lastSeenAt = diagnostics.receivedAt;
        session.liveDiagnostics = diagnostics;
        session.liveDiagnosticsHistory.unshift(diagnostics);
        session.liveDiagnosticsHistory = session.liveDiagnosticsHistory.slice(0, 600);
        sendJson(request, response, origins, 202, { ok: true, receivedAt: diagnostics.receivedAt });
        return;
      }

      if (request.method === 'GET' && !action) {
        sendJson(request, response, origins, 200, publicState(session));
        return;
      }

      sendJson(request, response, origins, 405, { error: 'method not allowed' });
    } catch (error) {
      sendJson(request, response, origins, error.status || 400, { error: error.message || 'request failed' });
    }
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [code, session] of sessions) {
      if (now - session.createdAt > LIVE_SESSION_TTL_MS) sessions.delete(code);
    }
    for (const [ip, times] of creates) {
      const recent = times.filter((at) => now - at < CREATE_WINDOW_MS);
      if (recent.length) creates.set(ip, recent);
      else creates.delete(ip);
    }
  }, 5 * 60 * 1000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));

  return instance;
}

export function startLiveDiagnosticServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 8787);
  const instance = createLiveDiagnosticServer(options);
  instance.server.listen(port, '0.0.0.0', () => console.log(`Guitar Coach live diagnostic relay listening on ${port}`));
  return instance;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startLiveDiagnosticServer();
