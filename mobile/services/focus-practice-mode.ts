import type { PracticeCategoryId } from '../config/guitar-mode-profiles';

export type FocusPracticeMode = 'picking' | 'strumming' | 'arpeggio' | 'left-hand';

export type FocusModeOption = {
  id: FocusPracticeMode;
  label: string;
  detail: string;
};

export type CameraAnalysisProfile = {
  focusMode: FocusPracticeMode;
  label: string;
  captureIntervalMs: number;
  photoQuality: number;
  stringVisionEveryFrames: number;
  pickColor: 'auto' | 'none';
  requiredEvidence: string[];
};

export const FOCUS_MODE_OPTIONS: FocusModeOption[] = [
  {
    id: 'picking',
    label: '피킹 모드',
    detail: '피크 깊이·다운/업·한 줄 왕복·줄 이동·손목 중심',
  },
  {
    id: 'strumming',
    label: '스트럼 모드',
    detail: '손목 회전·피크 걸림·다운/업 범위·스트로크 축',
  },
  {
    id: 'arpeggio',
    label: '아르페지오 모드',
    detail: 'P/i/m/a 역할·복귀·관절각·독립성·줄 순서',
  },
  {
    id: 'left-hand',
    label: '왼손·코드',
    detail: '손가락·줄·프렛·코드 착지·스케일 이동',
  },
];

const PICKING_CATEGORIES = new Set<PracticeCategoryId>([
  'downPicking',
  'alternatePicking',
  'palmMute',
]);
const ARPEGGIO_CATEGORIES = new Set<PracticeCategoryId>(['arpeggio', 'fingerstyle']);

export function focusModeForCategory(category: PracticeCategoryId | null | undefined): FocusPracticeMode {
  if (category === 'strumming') return 'strumming';
  if (category && PICKING_CATEGORIES.has(category)) return 'picking';
  if (category && ARPEGGIO_CATEGORIES.has(category)) return 'arpeggio';
  return 'left-hand';
}

export function cameraAnalysisProfile(category: PracticeCategoryId): CameraAnalysisProfile {
  const focusMode = focusModeForCategory(category);
  if (focusMode === 'picking') {
    return {
      focusMode,
      label: '피킹 고속 추적',
      captureIntervalMs: 185,
      photoQuality: 0.22,
      stringVisionEveryFrames: 3,
      pickColor: 'auto',
      requiredEvidence: ['손목 관절점', '피크 끝', '기타줄 기준면', '연속 이동 방향'],
    };
  }
  if (focusMode === 'strumming') {
    return {
      focusMode,
      label: '스트럼 고속 추적',
      captureIntervalMs: 170,
      photoQuality: 0.20,
      stringVisionEveryFrames: 3,
      pickColor: 'auto',
      requiredEvidence: ['손목 관절점', '피크 끝', '5개 이상 기타줄', '다운·업 연속 궤적'],
    };
  }
  if (focusMode === 'arpeggio') {
    return {
      focusMode,
      label: 'P/i/m/a 정밀 추적',
      captureIntervalMs: 210,
      photoQuality: 0.24,
      stringVisionEveryFrames: 4,
      pickColor: 'none',
      requiredEvidence: ['손목 관절점', 'P/i/m/a 끝점', '기타줄 기준면', '손가락별 복귀 궤적'],
    };
  }
  return {
    focusMode,
    label: '왼손 정밀 추적',
    captureIntervalMs: 280,
    photoQuality: 0.28,
    stringVisionEveryFrames: 4,
    pickColor: 'none',
    requiredEvidence: ['손목 관절점', '네 손가락 끝점', '지판 보정', '마이크 음정 확인'],
  };
}

export function categoryMatchesFocusMode(category: PracticeCategoryId, focusMode: FocusPracticeMode) {
  return focusModeForCategory(category) === focusMode;
}
