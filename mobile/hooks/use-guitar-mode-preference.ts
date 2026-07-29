import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import type { GuitarModeId } from '../config/guitar-mode-profiles';

const STORAGE_KEY = 'guitar-coach:selected-guitar-mode:v1';
const listeners = new Set<(mode: GuitarModeId | null) => void>();
let cachedMode: GuitarModeId | null | undefined;

function isGuitarModeId(value: string | null): value is GuitarModeId {
  return value === 'acoustic' || value === 'electric';
}

function publishMode(mode: GuitarModeId | null) {
  cachedMode = mode;
  listeners.forEach((listener) => listener(mode));
}

async function readStoredMode() {
  if (cachedMode !== undefined) return cachedMode;
  const saved = await AsyncStorage.getItem(STORAGE_KEY);
  const mode = isGuitarModeId(saved) ? saved : null;
  cachedMode = mode;
  return mode;
}

export async function getSavedGuitarMode() {
  return readStoredMode();
}

export function useGuitarModePreference() {
  const [mode, setModeState] = useState<GuitarModeId | null>(cachedMode ?? null);
  const [loading, setLoading] = useState(cachedMode === undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const listener = (next: GuitarModeId | null) => {
      if (!cancelled) setModeState(next);
    };
    listeners.add(listener);

    const restore = async () => {
      try {
        const saved = await readStoredMode();
        if (!cancelled) setModeState(saved);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : '기타 모드 설정을 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void restore();
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  const setMode = useCallback(async (next: GuitarModeId) => {
    setError('');
    publishMode(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '기타 모드 설정을 저장하지 못했습니다.');
      throw caught;
    }
  }, []);

  const clearMode = useCallback(async () => {
    setError('');
    publishMode(null);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '기타 모드 설정을 초기화하지 못했습니다.');
      throw caught;
    }
  }, []);

  const refreshMode = useCallback(async () => {
    cachedMode = undefined;
    setLoading(true);
    try {
      const restored = await readStoredMode();
      publishMode(restored);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '기타 모드 설정을 다시 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    mode,
    loading,
    error,
    setMode,
    clearMode,
    refreshMode,
  };
}
