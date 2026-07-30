import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import type { FretboardCalibration } from './fretboard-chord-engine';
import { validateFretboardCalibration } from './fretboard-chord-engine';

const STORAGE_KEY = 'guitar-coach:fretboard-calibrations:v1';
const MAX_CALIBRATIONS = 8;

function isCalibration(value: unknown): value is FretboardCalibration {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FretboardCalibration>;
  if (
    typeof candidate.id !== 'string'
    || (candidate.guitarMode !== 'acoustic' && candidate.guitarMode !== 'electric')
    || (candidate.cameraFacing !== 'front' && candidate.cameraFacing !== 'back')
    || !candidate.nutSixth
    || !candidate.nutFirst
    || !candidate.referenceSixth
    || !candidate.referenceFirst
  ) return false;
  return validateFretboardCalibration(candidate as FretboardCalibration).valid;
}

function parse(raw: string | null) {
  if (!raw) return [] as FretboardCalibration[];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isCalibration) : [];
  } catch {
    return [];
  }
}

export async function loadFretboardCalibrations() {
  return parse(await AsyncStorage.getItem(STORAGE_KEY));
}

export async function saveFretboardCalibration(calibration: FretboardCalibration) {
  if (!validateFretboardCalibration(calibration).valid) {
    throw new Error('지판 보정 좌표가 코드 인식 기준을 통과하지 못했습니다.');
  }
  const current = await loadFretboardCalibrations();
  const next = [
    calibration,
    ...current.filter((item) => !(
      item.guitarMode === calibration.guitarMode
      && item.cameraFacing === calibration.cameraFacing
      && item.mirrored === calibration.mirrored
    )),
  ].slice(0, MAX_CALIBRATIONS);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function loadBestFretboardCalibration(options: {
  guitarMode: GuitarModeId;
  cameraFacing?: 'front' | 'back';
  mirrored?: boolean;
}) {
  const calibrations = await loadFretboardCalibrations();
  return calibrations
    .filter((item) => item.guitarMode === options.guitarMode)
    .filter((item) => options.cameraFacing == null || item.cameraFacing === options.cameraFacing)
    .filter((item) => options.mirrored == null || item.mirrored === options.mirrored)
    .sort((left, right) => right.confidencePercent - left.confidencePercent || right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}
