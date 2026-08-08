import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GuitarModeId } from '../config/guitar-mode-profiles';

const STORAGE_KEY = 'guitar-coach:practice-recordings:v1';
const MAX_RECORDINGS = 30;

export type PracticeRecording = {
  id: string;
  assetId: string;
  uri: string;
  filename: string;
  guitarMode: GuitarModeId | null;
  facing: 'front' | 'back';
  durationSeconds: number;
  createdAt: string;
  note: string;
};

function isRecording(value: unknown): value is PracticeRecording {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PracticeRecording>;
  return typeof candidate.id === 'string' &&
    typeof candidate.uri === 'string' &&
    typeof candidate.filename === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.durationSeconds === 'number';
}

function parse(raw: string | null) {
  if (!raw) return [] as PracticeRecording[];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isRecording) : [];
  } catch {
    return [] as PracticeRecording[];
  }
}

export async function loadPracticeRecordings() {
  return parse(await AsyncStorage.getItem(STORAGE_KEY))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function savePracticeRecording(recording: PracticeRecording) {
  const current = await loadPracticeRecordings();
  const next = [recording, ...current.filter((item) => item.id !== recording.id)].slice(0, MAX_RECORDINGS);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function deletePracticeRecordingMetadata(id: string) {
  const current = await loadPracticeRecordings();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter((item) => item.id !== id)));
}
