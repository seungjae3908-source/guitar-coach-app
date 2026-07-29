import type { GuitarModeId } from './guitar-mode-profiles';

export type FeatureStatus = 'implemented' | 'integration' | 'native-required' | 'blocked';
export type FeatureArea =
  | 'core'
  | 'metronome'
  | 'camera-ai'
  | 'audio-ai'
  | 'tuner'
  | 'practice'
  | 'sheet'
  | 'tone'
  | 'records'
  | 'safety';

export type FeatureDefinition = {
  id: string;
  title: string;
  area: FeatureArea;
  modes: Array<GuitarModeId | 'shared'>;
  status: FeatureStatus;
  visibleWhenReady: boolean;
  requires: string[];
  releaseGate: string;
  offlineFirst: boolean;
};

export const COMPLETE_BETA_FEATURES: FeatureDefinition[] = [
  {
    id: 'mode-select',
    title: '통기타·일렉기타 모드 선택과 저장',
    area: 'core',
    modes: ['shared'],
    status: 'implemented',
    visibleWhenReady: true,
    requires: [],
    releaseGate: '선택값이 재실행 후 유지되고 모드별 메뉴가 정확히 변경됨',
    offlineFirst: true,
  },
  {
    id: 'advanced-metronome',
    title: '네이티브 고급 메트로놈과 음성 카운트',
    area: 'metronome',
    modes: ['shared'],
    status: 'integration',
    visibleWhenReady: true,
    requires: [],
    releaseGate: '10분 연속 실행, BPM 변경, 정지, 음원 5종, 음성 카운트 통과',
    offlineFirst: true,
  },
  {
    id: 'metronome-programs',
    title: '카운트인·타이머·자동 BPM 증가·악센트 편집',
    area: 'metronome',
    modes: ['shared'],
    status: 'integration',
    visibleWhenReady: true,
    requires: ['advanced-metronome'],
    releaseGate: '일시정지·재개 후 카운트와 자동 증속 상태가 보존됨',
    offlineFirst: true,
  },
  {
    id: 'full-body-ai',
    title: '전신 자세와 상체 안정성 AI',
    area: 'camera-ai',
    modes: ['shared'],
    status: 'implemented',
    visibleWhenReady: true,
    requires: [],
    releaseGate: '얼굴·어깨·팔꿈치·손목·골반 변화가 실제 자세와 일치함',
    offlineFirst: true,
  },
  {
    id: 'hand-ai',
    title: '손 21개 관절과 손가락 독립성 AI',
    area: 'camera-ai',
    modes: ['shared'],
    status: 'implemented',
    visibleWhenReady: true,
    requires: [],
    releaseGate: '손가락 관절점이 실제 손과 맞고 작거나 흐린 손은 판정 중단',
    offlineFirst: true,
  },
  {
    id: 'pick-ai',
    title: '피크 색상·각도·노출량·경로 분석',
    area: 'camera-ai',
    modes: ['shared'],
    status: 'integration',
    visibleWhenReady: true,
    requires: ['hand-ai', 'camera-calibration'],
    releaseGate: '피크 색상과 배경을 바꿔도 신뢰도 표시가 정직하게 변함',
    offlineFirst: true,
  },
  {
    id: 'camera-calibration',
    title: '손·줄·브리지·피크 촬영 보정 마법사',
    area: 'camera-ai',
    modes: ['shared'],
    status: 'integration',
    visibleWhenReady: true,
    requires: [],
    releaseGate: '6개 줄 가이드와 브리지 기준이 회전·미러링 후에도 일치함',
    offlineFirst: true,
  },
  {
    id: 'quality-gate',
    title: '밝기·선명도·손 크기·FPS·오디오 품질 게이트',
    area: 'safety',
    modes: ['shared'],
    status: 'implemented',
    visibleWhenReady: true,
    requires: [],
    releaseGate: '품질이 낮으면 점수 대신 판정 불가와 개선 안내를 표시함',
    offlineFirst: true,
  },
  {
    id: 'audio-attack-analysis',
    title: '마이크 어택 시점·간격·음량 균일성 분석',
    area: 'audio-ai',
    modes: ['shared'],
    status: 'native-required',
    visibleWhenReady: false,
    requires: ['quality-gate'],
    releaseGate: '주변 소음·클리핑을 분리하고 카메라 박자와 동기화됨',
    offlineFirst: true,
  },
  {
    id: 'chromatic-tuner',
    title: '크로매틱 기타 튜너와 대체 튜닝',
    area: 'tuner',
    modes: ['shared'],
    status: 'native-required',
    visibleWhenReady: false,
    requires: [],
    releaseGate: '표준·Drop D·반음 다운에서 기준 튜너와 ±3센트 이내',
    offlineFirst: true,
  },
  {
    id: 'adaptive-practice',
    title: '개인 문제 기반 자동 난이도와 주간 커리큘럼',
    area: 'practice',
    modes: ['shared'],
    status: 'implemented',
    visibleWhenReady: true,
    requires: ['practice-records', 'quality-gate'],
    releaseGate: '낮은 신뢰도에서는 BPM을 올리지 않고 긴장 보고 시 즉시 중단',
    offlineFirst: true,
  },
  {
    id: 'acoustic-techniques',
    title: '통기타 코드·아르페지오·스트럼·핑거스타일',
    area: 'practice',
    modes: ['acoustic'],
    status: 'integration',
    visibleWhenReady: true,
    requires: ['hand-ai', 'full-body-ai'],
    releaseGate: 'P-i-m·P-i-p-m·p-a-m-i와 코드 전환별 지표가 분리됨',
    offlineFirst: true,
  },
  {
    id: 'electric-techniques',
    title: '일렉 피킹·팜뮤트·리프·리드 테크닉',
    area: 'practice',
    modes: ['electric'],
    status: 'integration',
    visibleWhenReady: true,
    requires: ['hand-ai', 'pick-ai'],
    releaseGate: '다운·업·줄 이동·팜뮤트 지표가 통기타 스트럼과 섞이지 않음',
    offlineFirst: true,
  },
  {
    id: 'local-sheet-analysis',
    title: 'MP3·WAV 로컬 BPM·Key·코드 후보 분석',
    area: 'sheet',
    modes: ['shared'],
    status: 'native-required',
    visibleWhenReady: false,
    requires: ['audio-attack-analysis'],
    releaseGate: '최대 120초 처리 중 메모리 폭증이 없고 낮은 신뢰도 구간 수정 가능',
    offlineFirst: true,
  },
  {
    id: 'song-practice',
    title: '악보 자동 진행·A-B 반복·속도 조절·다음 코드 음성',
    area: 'sheet',
    modes: ['shared'],
    status: 'integration',
    visibleWhenReady: true,
    requires: ['advanced-metronome'],
    releaseGate: '재생 위치·악보 강조·메트로놈이 장시간 어긋나지 않음',
    offlineFirst: true,
  },
  {
    id: 'tone-lab',
    title: 'THR30·GT-1 중심 장비 톤 연구실',
    area: 'tone',
    modes: ['electric'],
    status: 'implemented',
    visibleWhenReady: true,
    requires: [],
    releaseGate: 'Clean·Rhythm·Lead 생성, 수정, 저장, 비교, 공유 텍스트가 동작함',
    offlineFirst: true,
  },
  {
    id: 'practice-records',
    title: '세션 저장·비교·BPM 성장·반복 문제·백업',
    area: 'records',
    modes: ['shared'],
    status: 'implemented',
    visibleWhenReady: true,
    requires: [],
    releaseGate: '앱 업데이트와 재실행 후 기록이 유지되고 통기타·일렉 기록이 분리됨',
    offlineFirst: true,
  },
  {
    id: 'long-session-safety',
    title: '발열·저전력·백그라운드·임시 파일 안전장치',
    area: 'safety',
    modes: ['shared'],
    status: 'integration',
    visibleWhenReady: true,
    requires: ['quality-gate'],
    releaseGate: '10분 연속 실행과 백그라운드 복귀에서 종료·중복 분석이 없음',
    offlineFirst: true,
  },
];

export function visibleFeaturesForMode(mode: GuitarModeId) {
  return COMPLETE_BETA_FEATURES.filter((feature) =>
    feature.visibleWhenReady &&
    feature.status !== 'blocked' &&
    (feature.modes.includes('shared') || feature.modes.includes(mode)),
  );
}

export function unresolvedReleaseGates() {
  return COMPLETE_BETA_FEATURES.filter((feature) => feature.status !== 'implemented');
}
