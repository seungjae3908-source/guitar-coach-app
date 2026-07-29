import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKUP_VERSION = 1;

const BACKUP_KEYS = {
  guitarMode: 'guitar-coach:selected-guitar-mode:v1',
  practiceSessions: 'guitar-coach:practice-sessions:v1',
  songProjects: 'guitar-coach:song-projects:v1',
  cameraCalibrations: 'guitar-coach:camera-calibrations:v1',
  recordingMetadata: 'guitar-coach:practice-recordings:v1',
} as const;

type BackupKey = keyof typeof BACKUP_KEYS;

export type GuitarCoachBackup = {
  app: 'guitar-coach-ai';
  schemaVersion: number;
  exportedAt: string;
  appVersion: '0.6.0';
  data: Partial<Record<BackupKey, unknown>>;
  notes: string[];
};

export type BackupSummary = {
  guitarMode: string;
  practiceSessionCount: number;
  songProjectCount: number;
  cameraCalibrationCount: number;
  recordingMetadataCount: number;
  exportedAt: string;
};

function safeParse(raw: string | null): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function isBackup(value: unknown): value is GuitarCoachBackup {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GuitarCoachBackup>;
  return candidate.app === 'guitar-coach-ai' &&
    typeof candidate.schemaVersion === 'number' &&
    typeof candidate.exportedAt === 'string' &&
    Boolean(candidate.data && typeof candidate.data === 'object');
}

export async function createGuitarCoachBackup(): Promise<GuitarCoachBackup> {
  const entries = await AsyncStorage.multiGet(Object.values(BACKUP_KEYS));
  const byStorageKey = new Map(entries);
  const data: Partial<Record<BackupKey, unknown>> = {};
  (Object.entries(BACKUP_KEYS) as Array<[BackupKey, string]>).forEach(([name, storageKey]) => {
    const value = safeParse(byStorageKey.get(storageKey) ?? null);
    if (value !== undefined) data[name] = value;
  });
  return {
    app: 'guitar-coach-ai',
    schemaVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: '0.6.0',
    data,
    notes: [
      '연습 기록, 곡 악보, 촬영 보정과 설정을 포함합니다.',
      '갤러리에 저장된 영상 파일 자체는 포함하지 않고 최근 영상 메타데이터만 포함합니다.',
      '보안 키나 서버 계정 정보는 포함하지 않습니다.',
    ],
  };
}

export function stringifyGuitarCoachBackup(backup: GuitarCoachBackup) {
  return JSON.stringify(backup, null, 2);
}

export function parseGuitarCoachBackup(text: string): GuitarCoachBackup {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('백업 JSON 형식이 올바르지 않습니다.');
  }
  if (!isBackup(value)) throw new Error('기타 코치 AI 백업 파일이 아닙니다.');
  if (value.schemaVersion > BACKUP_VERSION) {
    throw new Error('현재 앱보다 새로운 백업 형식입니다. 앱 업데이트 후 다시 시도하세요.');
  }
  return value;
}

export function summarizeGuitarCoachBackup(backup: GuitarCoachBackup): BackupSummary {
  return {
    guitarMode: typeof backup.data.guitarMode === 'string' ? backup.data.guitarMode : '미설정',
    practiceSessionCount: arrayLength(backup.data.practiceSessions),
    songProjectCount: arrayLength(backup.data.songProjects),
    cameraCalibrationCount: arrayLength(backup.data.cameraCalibrations),
    recordingMetadataCount: arrayLength(backup.data.recordingMetadata),
    exportedAt: backup.exportedAt,
  };
}

function normalizeForStorage(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export async function restoreGuitarCoachBackup(
  backup: GuitarCoachBackup,
  options: { clearMissing?: boolean } = {},
) {
  const writes: Array<[string, string]> = [];
  const removes: string[] = [];
  (Object.entries(BACKUP_KEYS) as Array<[BackupKey, string]>).forEach(([name, storageKey]) => {
    if (Object.prototype.hasOwnProperty.call(backup.data, name)) {
      const value = backup.data[name];
      if (value !== undefined) writes.push([storageKey, normalizeForStorage(value)]);
    } else if (options.clearMissing) {
      removes.push(storageKey);
    }
  });
  if (writes.length) await AsyncStorage.multiSet(writes);
  if (removes.length) await AsyncStorage.multiRemove(removes);
  return summarizeGuitarCoachBackup(backup);
}

export async function clearGuitarCoachLocalData() {
  await AsyncStorage.multiRemove(Object.values(BACKUP_KEYS));
}
