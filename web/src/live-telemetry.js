const DEFAULT_API_URL = 'https://seungjae3908-guitar-coach-debug-api.onrender.com';
const API_URL = String(import.meta.env.VITE_DIAGNOSTIC_API_URL || DEFAULT_API_URL).replace(/\/$/, '');
const STORAGE_KEY = 'gc-live-diagnostic-session-v1';
const SEND_INTERVAL_MS = 900;

let pendingSession = null;
let lastSentAt = 0;
let sequence = 0;

function readStoredSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (!value?.code || !value?.deviceToken || Number(value.expiresAt) <= Date.now() + 30_000) return null;
    return value;
  } catch {
    return null;
  }
}

function storeSession(value) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  return value;
}

function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY);
  pendingSession = null;
}

export async function ensureLiveSession() {
  const stored = readStoredSession();
  if (stored) return stored;
  if (pendingSession) return pendingSession;

  pendingSession = fetch(`${API_URL}/api/live-sessions`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `원격 로그 세션 생성 실패 (${response.status})`);
    return storeSession(body);
  }).finally(() => {
    pendingSession = null;
  });

  return pendingSession;
}

function blockReasons(currentTest, vision, modelStatus) {
  const reasons = [];
  const hands = Array.isArray(vision?.hands) ? vision.hands : [];
  const landmarkCount = hands.length
    ? hands.reduce((sum, hand) => sum + Number(hand?.landmarks?.length || hand?.landmarkCount || 0), 0)
    : Number(vision?.handLandmarks?.length || 0);

  if (modelStatus?.error) reasons.push(`모델 오류: ${modelStatus.error}`);
  if (landmarkCount < 21) reasons.push(`손 관절 ${landmarkCount}/21`);
  if (Number(vision?.guitarConfidence || 0) < 0.3) reasons.push(`기타 신뢰도 ${Math.round(Number(vision?.guitarConfidence || 0) * 100)}%`);
  if (Number(vision?.stringCount || 0) < 4) reasons.push(`줄 ${Number(vision?.stringCount || 0)}개`);
  if (Number(vision?.stringConfidence || 0) < 0.32) reasons.push(`줄 신뢰도 ${Math.round(Number(vision?.stringConfidence || 0) * 100)}%`);
  if (!['down', 'up'].includes(currentTest) && !reasons.length) return '';
  return reasons.join(' · ');
}

function handDiagnostics(vision) {
  if (Array.isArray(vision?.hands) && vision.hands.length) {
    return vision.hands.slice(0, 2).map((hand) => ({
      handedness: hand.handedness || 'Unknown',
      confidence: hand.confidence || 0,
      landmarks: hand.landmarks?.length || hand.landmarkCount || 0,
      wrist: hand.wrist || hand.landmarks?.[0] || null,
      pickPoint: hand.pickPoint || null,
    }));
  }

  const landmarks = vision?.handLandmarks || [];
  return landmarks.length ? [{
    handedness: vision?.handedness || 'Unknown',
    confidence: vision?.handConfidence || 0,
    landmarks: landmarks.length,
    wrist: landmarks[0] || null,
    pickPoint: vision?.pickPoint || null,
  }] : [];
}

function payloadFrom(snapshot) {
  const { report, currentTest, vision, strokeCounts, modelStatus, evidenceReady, lastDirection = 'none' } = snapshot;
  const stats = report?.stats || {};
  return {
    sequence: ++sequence,
    clientAt: Date.now(),
    currentTest,
    blockedReason: evidenceReady ? '' : blockReasons(currentTest, vision, modelStatus),
    camera: {
      width: stats.width || 0,
      height: stats.height || 0,
      fps: stats.fps || 0,
      brightness: stats.brightness || 0,
      facing: 'user',
    },
    hands: handDiagnostics(vision),
    guitar: {
      visible: Number(vision?.guitarConfidence || 0) >= 0.3,
      confidence: vision?.guitarConfidence || 0,
      modelScore: vision?.guitarModelScore || 0,
      label: vision?.guitarLabel || '',
      angle: vision?.guitarAngle || 0,
      center: vision?.guitarCenter || null,
    },
    strings: {
      count: vision?.stringCount || 0,
      confidence: vision?.stringConfidence || 0,
      angle: vision?.stringAngle || 0,
      band: vision?.stringBand || null,
    },
    strokes: {
      down: strokeCounts?.down || 0,
      up: strokeCounts?.up || 0,
      lastDirection,
      ready: Boolean(evidenceReady),
    },
    model: {
      hand: modelStatus?.hand || '',
      guitar: modelStatus?.guitar || '',
      error: modelStatus?.error || '',
    },
  };
}

async function postDiagnostics(session, payload) {
  return fetch(`${API_URL}/api/live-sessions/${encodeURIComponent(session.code)}/diagnostics`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.deviceToken}`,
    },
    cache: 'no-store',
    body: JSON.stringify(payload),
  });
}

export async function sendLiveDiagnostics(snapshot, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastSentAt < SEND_INTERVAL_MS) return null;
  lastSentAt = now;

  let session = await ensureLiveSession();
  let response = await postDiagnostics(session, payloadFrom(snapshot));
  if (response.status === 401 || response.status === 404) {
    clearSession();
    session = await ensureLiveSession();
    response = await postDiagnostics(session, payloadFrom(snapshot));
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `원격 로그 전송 실패 (${response.status})`);
  }
  return session;
}

export function liveStateUrl(code) {
  return `${API_URL}/api/live-sessions/${encodeURIComponent(code)}`;
}
