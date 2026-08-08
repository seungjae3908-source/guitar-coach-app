import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import type { CameraCalibration } from './camera-calibration';

const STORAGE_KEY = 'guitar-coach:camera-calibrations:v1';
const MAX_CALIBRATIONS = 12;

function isCalibration(value: unknown): value is CameraCalibration {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CameraCalibration>;
  return typeof candidate.id === 'string' &&
    (candidate.guitarMode === 'acoustic' || candidate.guitarMode === 'electric') &&
    (candidate.cameraFacing === 'front' || candidate.cameraFacing === 'back') &&
    Array.isArray(candidate.strings) &&
    candidate.strings.length === 6;
}

function parseCalibrations(raw: string | null): CameraCalibration[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCalibration);
  } catch {
    return [];
  }
}

export async function loadCameraCalibrations() {
  return parseCalibrations(await AsyncStorage.getItem(STORAGE_KEY));
}

export async function saveCameraCalibration(calibration: CameraCalibration) {
  const current = await loadCameraCalibrations();
  const next = [
    calibration,
    ...current.filter((item) => item.id !== calibration.id && !(
      item.guitarMode === calibration.guitarMode &&
      item.cameraFacing === calibration.cameraFacing &&
      item.mirrored === calibration.mirrored
    )),
  ].slice(0, MAX_CALIBRATIONS);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function deleteCameraCalibration(id: string) {
  const current = await loadCameraCalibrations();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter((item) => item.id !== id)));
}

export async function loadBestCameraCalibration(options: {
  guitarMode: GuitarModeId;
  cameraFacing?: 'front' | 'back';
  mirrored?: boolean;
}) {
  const calibrations = await loadCameraCalibrations();
  return calibrations
    .filter((item) => item.guitarMode === options.guitarMode)
    .filter((item) => options.cameraFacing == null || item.cameraFacing === options.cameraFacing)
    .filter((item) => options.mirrored == null || item.mirrored === options.mirrored)
    .sort((a, b) => {
      const confidenceDifference = b.confidencePercent - a.confidencePercent;
      if (confidenceDifference !== 0) return confidenceDifference;
      return b.createdAt.localeCompare(a.createdAt);
    })[0] ?? null;
}
