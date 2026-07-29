import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import type { GuitarModeId } from '../config/guitar-mode-profiles';

const STORAGE_KEY = 'guitar-coach:selected-guitar-mode:v1';

function isGuitarModeId(value: string | null): value is GuitarModeId {
  return value === 'acoustic' || value === 'electric';
}

export function useGuitarModePreference() {
  const [mode, setModeState] = useState<GuitarModeId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && isGuitarModeId(saved)) setModeState(saved);
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
    };
  }, []);

  const setMode = useCallback(async (next: GuitarModeId) => {
    setError('');
    setModeState(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '기타 모드 설정을 저장하지 못했습니다.');
      throw caught;
    }
  }, []);

  const clearMode = useCallback(async () => {
    setError('');
    setModeState(null);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '기타 모드 설정을 초기화하지 못했습니다.');
      throw caught;
    }
  }, []);

  return {
    mode,
    loading,
    error,
    setMode,
    clearMode,
  };
}
