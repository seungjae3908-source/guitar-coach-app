import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

const STORAGE_KEY = '@guitar-coach/runtime-diagnostics/v1';
const MAX_EVENTS = 300;

export type DiagnosticLevel = 'info' | 'warning' | 'error';

export type RuntimeDiagnosticEvent = {
  id: string;
  timestamp: string;
  area: string;
  action: string;
  level: DiagnosticLevel;
  data: Record<string, unknown>;
};

export type RuntimeDiagnosticState = {
  startedAt: string;
  cameraPermission: 'unknown' | 'granted' | 'denied';
  cameraPermissionCanAskAgain: boolean | null;
  activeCameraMode: 'none' | 'right-hand' | 'left-hand' | 'full';
  cameraFacing: 'unknown' | 'front' | 'back';
  cameraPreviewReady: boolean;
  cameraPreviewReadyCount: number;
  capturedFrameCount: number;
  analyzedFrameCount: number;
  lastFrameAt: string | null;
  lastCameraError: string | null;
  lastAnalysisError: string | null;
  lastScreen: string | null;
};

type StoredDiagnostics = {
  state: RuntimeDiagnosticState;
  events: RuntimeDiagnosticEvent[];
};

let loaded = false;
let loadPromise: Promise<void> | null = null;
let writeChain: Promise<void> = Promise.resolve();
let events: RuntimeDiagnosticEvent[] = [];
let state: RuntimeDiagnosticState = createInitialState();

function createInitialState(): RuntimeDiagnosticState {
  return {
    startedAt: new Date().toISOString(),
    cameraPermission: 'unknown',
    cameraPermissionCanAskAgain: null,
    activeCameraMode: 'none',
    cameraFacing: 'unknown',
    cameraPreviewReady: false,
    cameraPreviewReadyCount: 0,
    capturedFrameCount: 0,
    analyzedFrameCount: 0,
    lastFrameAt: null,
    lastCameraError: null,
    lastAnalysisError: null,
    lastScreen: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value };
  return value as Record<string, unknown>;
}

function queuePersist() {
  const payload: StoredDiagnostics = { state, events };
  writeChain = writeChain
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)));
}

async function ensureLoaded() {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredDiagnostics>;
        if (parsed.state && typeof parsed.state === 'object') state = { ...createInitialState(), ...parsed.state };
        if (Array.isArray(parsed.events)) events = parsed.events.slice(-MAX_EVENTS);
      }
    } catch {
      state = createInitialState();
      events = [];
    } finally {
      loaded = true;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

export async function recordRuntimeDiagnostic(
  area: string,
  action: string,
  data: unknown = {},
  level: DiagnosticLevel = 'info',
) {
  await ensureLoaded();
  const now = Date.now();
  events = [
    ...events,
    {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(now).toISOString(),
      area,
      action,
      level,
      data: asRecord(data),
    },
  ].slice(-MAX_EVENTS);
  queuePersist();
}

export async function updateRuntimeDiagnosticState(patch: Partial<RuntimeDiagnosticState>) {
  await ensureLoaded();
  state = { ...state, ...patch };
  queuePersist();
}

export async function clearRuntimeDiagnostics() {
  await ensureLoaded();
  state = createInitialState();
  events = [];
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function getRuntimeDiagnosticSnapshot(): Promise<StoredDiagnostics> {
  await ensureLoaded();
  await writeChain.catch(() => undefined);
  return {
    state: { ...state },
    events: events.map((event) => ({ ...event, data: { ...event.data } })),
  };
}

function deviceSummary() {
  const constants = (NativeModules.PlatformConstants ?? Platform.constants ?? {}) as Record<string, unknown>;
  return {
    os: Platform.OS,
    osVersion: String(Platform.Version),
    manufacturer: constants.Manufacturer ?? null,
    brand: constants.Brand ?? null,
    model: constants.Model ?? null,
  };
}

export async function buildRuntimeDiagnosticReport(extra: Record<string, unknown> = {}) {
  const snapshot = await getRuntimeDiagnosticSnapshot();
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: {
      name: '기타 코치 AI 완성형 베타',
      version: '0.6.0',
      versionCode: 12,
      packageName: 'com.seungjae.guitarcoach.livetest',
      branch: 'agent/live-coach-compat-v055',
    },
    device: deviceSummary(),
    runtime: snapshot.state,
    events: snapshot.events,
    extra,
  };
}
