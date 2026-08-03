import http from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.PORT || 8787);
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
const deviceSecret = process.env.DEVICE_SHARED_SECRET || '';
const adminSecret = process.env.ADMIN_SHARED_SECRET || '';
const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function json(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-headers': 'content-type, authorization, x-device-secret, x-admin-secret',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('payload too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    request.on('error', reject);
  });
}

function cleanCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
}

function sessionFor(code) {
  const normalized = cleanCode(code);
  if (!normalized) return null;
  if (!sessions.has(normalized)) {
    sessions.set(normalized, {
      code: normalized,
      createdAt: Date.now(),
      lastSeenAt: 0,
      telemetry: null,
      history: [],
      settings: {
        thresholds: { minBrightness: 10, motionThreshold: 8 },
        instruction: '',
        updatedAt: 0,
      },
    });
  }
  return sessions.get(normalized);
}

function authorized(request, secret, header) {
  if (!secret) return true;
  return request.headers[header] === secret;
}

function routeParts(pathname) {
  return pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

setInterval(() => {
  const now = Date.now();
  for (const [code, session] of sessions) {
    const activityAt = Math.max(session.createdAt, session.lastSeenAt, session.settings.updatedAt || 0);
    if (now - activityAt > SESSION_TTL_MS) sessions.delete(code);
  }
}, 10 * 60 * 1000).unref();

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    json(response, 204, {});
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const parts = routeParts(url.pathname);

  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { ok: true, sessions: sessions.size, now: Date.now() });
    return;
  }

  if (parts[0] !== 'api' || parts[1] !== 'sessions' || !parts[2]) {
    json(response, 404, { error: 'not found' });
    return;
  }

  const session = sessionFor(parts[2]);
  if (!session) {
    json(response, 400, { error: 'invalid session code' });
    return;
  }

  try {
    if (request.method === 'POST' && parts[3] === 'telemetry') {
      if (!authorized(request, deviceSecret, 'x-device-secret')) {
        json(response, 401, { error: 'device unauthorized' });
        return;
      }
      const payload = await readJson(request);
      const receivedAt = Date.now();
      session.lastSeenAt = receivedAt;
      session.telemetry = { ...payload, receivedAt };
      session.history.unshift(session.telemetry);
      session.history = session.history.slice(0, 120);
      json(response, 202, { ok: true, receivedAt });
      return;
    }

    if (request.method === 'GET' && parts[3] === 'state') {
      if (!authorized(request, adminSecret, 'x-admin-secret')) {
        json(response, 401, { error: 'admin unauthorized' });
        return;
      }
      json(response, 200, {
        code: session.code,
        online: Date.now() - session.lastSeenAt < 4_000,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        telemetry: session.telemetry,
        settings: session.settings,
        history: session.history.slice(0, 20),
      });
      return;
    }

    if (request.method === 'GET' && parts[3] === 'settings') {
      if (!authorized(request, deviceSecret, 'x-device-secret')) {
        json(response, 401, { error: 'device unauthorized' });
        return;
      }
      json(response, 200, session.settings);
      return;
    }

    if (request.method === 'POST' && parts[3] === 'settings') {
      if (!authorized(request, adminSecret, 'x-admin-secret')) {
        json(response, 401, { error: 'admin unauthorized' });
        return;
      }
      const payload = await readJson(request);
      const thresholds = payload.thresholds && typeof payload.thresholds === 'object'
        ? {
            minBrightness: Math.max(3, Math.min(35, Number(payload.thresholds.minBrightness || 10))),
            motionThreshold: Math.max(2, Math.min(25, Number(payload.thresholds.motionThreshold || 8))),
          }
        : session.settings.thresholds;
      session.settings = {
        thresholds,
        instruction: String(payload.instruction || '').trim().slice(0, 240),
        updatedAt: Date.now(),
      };
      json(response, 200, { ok: true, settings: session.settings });
      return;
    }

    json(response, 404, { error: 'not found' });
  } catch (error) {
    json(response, error.message === 'payload too large' ? 413 : 400, { error: error.message || 'request failed' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Guitar Coach diagnostic relay listening on ${port}`);
  if (!deviceSecret || !adminSecret) {
    console.warn('DEVICE_SHARED_SECRET and ADMIN_SHARED_SECRET are not set. Do not expose this server publicly without them.');
  }
});
