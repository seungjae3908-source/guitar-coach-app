import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import type { MetronomeSoundPreset } from '../modules/guitar-coach-metronome';

export const APP_SETTINGS_STORAGE_KEY = 'guitar-coach:app-settings:v1';

export type GuitarCoachAppSettings = {
  voiceCoachEnabled: boolean;
  lowPowerMode: boolean;
  defaultReferenceA4: number;
  defaultMetronomeSound: MetronomeSoundPreset;
  keepScreenAwakeDuringPractice: boolean;
};

const DEFAULT_SETTINGS: GuitarCoachAppSettings = {
  voiceCoachEnabled: true,
  lowPowerMode: false,
  defaultReferenceA4: 440,
  defaultMetronomeSound: 0,
  keepScreenAwakeDuringPractice: false,
};

const listeners = new Set<(settings: GuitarCoachAppSettings) => void>();
let cachedSettings: GuitarCoachAppSettings | undefined;

function normalize(value: unknown): GuitarCoachAppSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const candidate = value as Partial<GuitarCoachAppSettings>;
  const sound = Number(candidate.defaultMetronomeSound);
  return {
    voiceCoachEnabled: candidate.voiceCoachEnabled !== false,
    lowPowerMode: candidate.lowPowerMode === true,
    defaultReferenceA4: Math.min(450, Math.max(430, Math.round(Number(candidate.defaultReferenceA4) || 440))),
    defaultMetronomeSound: ([0, 1, 2, 3, 4].includes(sound) ? sound : 0) as MetronomeSoundPreset,
    keepScreenAwakeDuringPractice: candidate.keepScreenAwakeDuringPractice === true,
  };
}

async function readSettings() {
  if (cachedSettings) return cachedSettings;
  try {
    const raw = await AsyncStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    cachedSettings = raw ? normalize(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS };
  }
  return cachedSettings;
}

function publish(settings: GuitarCoachAppSettings) {
  cachedSettings = settings;
  listeners.forEach((listener) => listener(settings));
}

export async function getGuitarCoachAppSettings() {
  return readSettings();
}

export async function saveGuitarCoachAppSettings(settings: GuitarCoachAppSettings) {
  const normalized = normalize(settings);
  await AsyncStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  publish(normalized);
  return normalized;
}

export function useGuitarCoachAppSettings() {
  const [settings, setSettings] = useState<GuitarCoachAppSettings>(cachedSettings ?? DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(cachedSettings == null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const listener = (next: GuitarCoachAppSettings) => {
      if (!cancelled) setSettings(next);
    };
    listeners.add(listener);
    void readSettings()
      .then((next) => {
        if (!cancelled) setSettings(next);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '설정을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  const updateSettings = useCallback(async (patch: Partial<GuitarCoachAppSettings>) => {
    setError('');
    const current = await readSettings();
    const next = normalize({ ...current, ...patch });
    setSettings(next);
    try {
      await saveGuitarCoachAppSettings(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '설정을 저장하지 못했습니다.');
      throw caught;
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    cachedSettings = undefined;
    setLoading(true);
    const next = await readSettings();
    publish(next);
    setLoading(false);
  }, []);

  const resetSettings = useCallback(async () => {
    await saveGuitarCoachAppSettings({ ...DEFAULT_SETTINGS });
  }, []);

  return {
    settings,
    loading,
    error,
    updateSettings,
    refreshSettings,
    resetSettings,
  };
}
