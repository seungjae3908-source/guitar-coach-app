import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SongSheetDraft } from './song-sheet-engine';

const STORAGE_KEY = 'guitar-coach:song-projects:v1';
const MAX_PROJECTS = 50;

function isSongDraft(value: unknown): value is SongSheetDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SongSheetDraft>;
  return typeof candidate.id === 'string' &&
    (candidate.guitarMode === 'acoustic' || candidate.guitarMode === 'electric') &&
    typeof candidate.title === 'string' &&
    typeof candidate.bpm === 'number' &&
    Array.isArray(candidate.bars);
}

function parseProjects(raw: string | null): SongSheetDraft[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSongDraft);
  } catch {
    return [];
  }
}

export async function loadSongProjects() {
  const projects = parseProjects(await AsyncStorage.getItem(STORAGE_KEY));
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveSongProject(project: SongSheetDraft) {
  const current = await loadSongProjects();
  const next = [project, ...current.filter((item) => item.id !== project.id)].slice(0, MAX_PROJECTS);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function deleteSongProject(id: string) {
  const current = await loadSongProjects();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter((item) => item.id !== id)));
}

export async function duplicateSongProject(project: SongSheetDraft) {
  const now = new Date().toISOString();
  const copy: SongSheetDraft = {
    ...project,
    id: `song-${Date.now()}`,
    title: `${project.title} 복사본`,
    createdAt: now,
    updatedAt: now,
    bars: project.bars.map((bar, index) => ({ ...bar, id: `bar-${index + 1}` })),
  };
  await saveSongProject(copy);
  return copy;
}
