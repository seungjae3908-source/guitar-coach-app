import type { GuitarModeId, PracticeCategoryId } from './guitar-mode-profiles';

export type PracticePreset = {
  id: string;
  guitarMode: GuitarModeId;
  category: PracticeCategoryId;
  title: string;
  goal: string;
  startBpm: number;
  targetBpm: number;
  durationSeconds: number;
  pattern?: string;
  cameraFocus: 'full-body' | 'right-hand' | 'left-hand' | 'none';
  checkpoints: string[];
  automaticFeedbackRules: string[];
};

export const PERSONAL_PRACTICE_PRESETS: PracticePreset[] = [
  {
    id: 'acoustic-pim-return',
    guitarMode: 'acoustic',
    category: 'arpeggio',
    title: 'P-i-m 검지 복귀 교정',
    goal: '검지가 앞으로 과하게 나간 뒤 늦게 돌아오는 움직임을 줄이고 P-i-m 간격을 일정하게 유지합니다.',
    startBpm: 60,
    targetBpm: 100,
    durationSeconds: 180,
    pattern: 'P i m · P i m',
    cameraFocus: 'right-hand',
    checkpoints: [
      '검지 끝이 탄현 뒤 손바닥 쪽으로 짧게 복귀하는지',
      '중지가 검지 움직임을 따라 올라가지 않는지',
      '손목이 손가락과 함께 흔들리지 않는지',
      '세 음의 시간 간격이 일정한지',
    ],
    automaticFeedbackRules: [
      '검지 복귀 시간이 중지보다 25% 이상 길면 속도 유지 안내',
      '손목 이동량이 손가락 이동량 대비 과하면 손목 고정 안내',
      '3회 연속 안정 구간이면 BPM 2 증가 제안',
    ],
  },
  {
    id: 'acoustic-pip-thumb-flow',
    guitarMode: 'acoustic',
    category: 'arpeggio',
    title: 'P-i-p 엄지 흐름 연결',
    goal: 'P-i-p에서 두 번째 엄지가 끊기지 않고 같은 궤적으로 이어지게 합니다.',
    startBpm: 55,
    targetBpm: 90,
    durationSeconds: 180,
    pattern: 'P i P m · P i P m',
    cameraFocus: 'right-hand',
    checkpoints: [
      '첫 번째 P와 두 번째 P의 이동 폭이 비슷한지',
      '검지가 앞으로 남아 두 번째 P를 방해하지 않는지',
      '엄지가 아래로 눌러 멈추지 않고 다음 줄로 자연스럽게 이동하는지',
    ],
    automaticFeedbackRules: [
      '두 번째 P 시작 지연이 첫 P 대비 20% 이상이면 패턴 분리 연습 안내',
      '검지 복귀가 늦으면 P-i만 30초 반복 안내',
    ],
  },
  {
    id: 'acoustic-pami-independence',
    guitarMode: 'acoustic',
    category: 'arpeggio',
    title: 'p-a-m-i 독립성 훈련',
    goal: '약지를 움직일 때 중지와 새끼손가락이 불필요하게 따라 움직이는 현상을 줄입니다.',
    startBpm: 45,
    targetBpm: 80,
    durationSeconds: 180,
    pattern: 'p a m i',
    cameraFocus: 'right-hand',
    checkpoints: [
      'A 탄현 시 M이 과하게 들리지 않는지',
      '사용하지 않는 손가락이 줄에 닿지 않는지',
      '각 손가락이 손바닥 안쪽으로 비슷하게 복귀하는지',
    ],
    automaticFeedbackRules: [
      'A 이동과 M 이동의 상관이 높으면 동반 움직임 경고',
      '새끼손가락 움직임은 점수에서 제외하고 참고 지표로만 표시',
    ],
  },
  {
    id: 'acoustic-strum-80-relax',
    guitarMode: 'acoustic',
    category: 'strumming',
    title: '80 BPM 손목 이완 스트럼',
    goal: '손목에 힘이 들어가고 부자연스러운 스트럼을 줄이며 다운·업 깊이를 일정하게 만듭니다.',
    startBpm: 60,
    targetBpm: 80,
    durationSeconds: 240,
    pattern: 'D U D U',
    cameraFocus: 'right-hand',
    checkpoints: [
      '피크 끝 2~3mm만 줄에 닿는지',
      '다운은 5~6줄, 업은 2~3줄만 스치는지',
      '손목이 과하게 꺾이지 않는지',
      '피크를 잡는 힘이 과하지 않은지',
    ],
    automaticFeedbackRules: [
      '업스트로크 경로가 다운보다 40% 이상 깊으면 범위 축소 안내',
      '손목 각도 변화가 급격하면 BPM 5 감소 안내',
      '피크 노출량이 너무 작거나 크면 그립 조정 안내',
    ],
  },
  {
    id: 'acoustic-left-chromatic-1234',
    guitarMode: 'acoustic',
    category: 'fingering',
    title: '왼손 1-2-3-4 줄·프렛 인식',
    goal: '검지·중지·약지·새끼를 한 줄의 연속 네 프렛에 정확히 놓고 실제 울린 음과 손가락 순서를 일치시킵니다.',
    startBpm: 40,
    targetBpm: 80,
    durationSeconds: 180,
    pattern: '1-2-3-4',
    cameraFocus: 'left-hand',
    checkpoints: [
      '한 줄에서 네 프렛이 연속으로 올라가는지',
      '1=검지, 2=중지, 3=약지, 4=새끼 순서를 지키는지',
      '다른 줄을 건드리지 않고 한 음씩 깨끗하게 울리는지',
      '새끼손가락이 빠지거나 늦게 내려오지 않는지',
    ],
    automaticFeedbackRules: [
      '마이크 음정과 지판 좌표가 일치한 음만 줄·프렛 이벤트로 확정',
      '새끼손가락 누락 시 점수를 확정하지 않고 4번 손가락 단독 반복 안내',
      '잘못된 줄·프렛은 실제 감지 위치와 목표 위치를 함께 표시',
    ],
  },
  {
    id: 'acoustic-chord-simultaneous-landing',
    guitarMode: 'acoustic',
    category: 'chords',
    title: '코드 한 번에 착지',
    goal: '코드 손가락이 차례대로 늦게 내려오는 대신 가능한 한 동시에 자리 잡게 합니다.',
    startBpm: 45,
    targetBpm: 80,
    durationSeconds: 180,
    cameraFocus: 'left-hand',
    checkpoints: [
      '첫 손가락과 마지막 손가락의 착지 시간 차이',
      '착지 직전 불필요하게 높이 드는 손가락',
      '손목과 엄지에 힘이 몰리는지',
    ],
    automaticFeedbackRules: [
      '착지 시간 차이가 180ms를 넘으면 느린 무박자 반복 안내',
      '새끼손가락만 반복 지연되면 해당 손가락 선행 배치 훈련 제안',
    ],
  },
  {
    id: 'acoustic-d-to-g',
    guitarMode: 'acoustic',
    category: 'chords',
    title: 'D→G 전환',
    goal: 'D에서 G로 이동할 때 손 전체가 흩어지지 않고 최소 이동으로 전환합니다.',
    startBpm: 40,
    targetBpm: 75,
    durationSeconds: 180,
    cameraFocus: 'left-hand',
    checkpoints: [
      '공통 축이 되는 손목 위치 유지',
      '새끼손가락을 사용할 때 과도하게 높이 들지 않는지',
      '코드 전환 후 첫 스트럼 전에 모양이 안정되는지',
    ],
    automaticFeedbackRules: [
      '전환 안정화 시간이 500ms를 넘으면 BPM 유지',
      '3회 연속 350ms 이하이면 BPM 2 증가 제안',
    ],
  },
  {
    id: 'electric-alternate-pick-smooth',
    guitarMode: 'electric',
    category: 'alternatePicking',
    title: '부드러운 얼터네이트 피킹',
    goal: '피크가 줄에 걸리고 소리가 거칠어지는 문제를 줄이며 업·다운 깊이를 맞춥니다.',
    startBpm: 60,
    targetBpm: 120,
    durationSeconds: 240,
    pattern: 'D U D U',
    cameraFocus: 'right-hand',
    checkpoints: [
      '업·다운 피크 노출량이 비슷한지',
      '손목이 굳어 팔 전체 움직임으로 바뀌지 않는지',
      '줄을 통과한 뒤 피크가 과하게 멀어지지 않는지',
    ],
    automaticFeedbackRules: [
      '업·다운 이동 폭 차이가 30%를 넘으면 깊이 균형 안내',
      '속도 증가 후 손목 이동량이 급증하면 직전 BPM으로 복귀',
    ],
  },
  {
    id: 'electric-down-pick-control',
    guitarMode: 'electric',
    category: 'downPicking',
    title: '다운피킹 방향·복귀 고정',
    goal: '모든 음을 다운으로 시작하고 업 방향이 섞이지 않도록 짧고 조용한 복귀를 만듭니다.',
    startBpm: 55,
    targetBpm: 110,
    durationSeconds: 180,
    pattern: 'D D D D',
    cameraFocus: 'right-hand',
    checkpoints: [
      '모든 탄현이 다운 방향인지',
      '탄현 뒤 피크가 줄 위로 짧게 복귀하는지',
      '줄을 바꿀 때 피크 폭이 커지지 않는지',
    ],
    automaticFeedbackRules: [
      '업 방향이 18% 이상 섞이면 다운만 8회 반복 안내',
      '다운 방향이 안정되면 현재 방향 성공 피드백 표시',
    ],
  },
  {
    id: 'electric-left-chromatic-1234',
    guitarMode: 'electric',
    category: 'fingering',
    title: '일렉 1-2-3-4 크로매틱',
    goal: '왼손 네 손가락을 연속 프렛에 배치하고 피킹된 음정과 실제 손가락 위치를 정확히 맞춥니다.',
    startBpm: 50,
    targetBpm: 120,
    durationSeconds: 180,
    pattern: '1-2-3-4',
    cameraFocus: 'left-hand',
    checkpoints: [
      '검지·중지·약지·새끼 순서',
      '한 줄의 연속 네 프렛 유지',
      '탄현 순간의 음정과 누른 프렛 일치',
      '새끼손가락 누락과 손 전체 위치 이동 방지',
    ],
    automaticFeedbackRules: [
      '영상과 음정이 일치한 8음 이상에서만 점수 확정',
      '잘못 사용한 손가락과 목표 손가락을 프렛별로 안내',
      '음 사이 간격 흔들림이 크면 BPM 유지',
    ],
  },
  {
    id: 'electric-a-minor-position-scale',
    guitarMode: 'electric',
    category: 'scales',
    title: 'A 마이너 포지션 줄 이동',
    goal: '6번 줄과 5번 줄의 지정 음을 검지·약지·새끼로 정확히 연결하며 줄 이동 시 포지션을 유지합니다.',
    startBpm: 45,
    targetBpm: 100,
    durationSeconds: 180,
    pattern: 'S6-5-i S6-7-r S6-8-k S5-5-i S5-7-r S5-8-k',
    cameraFocus: 'left-hand',
    checkpoints: [
      '6번 줄 5·7·8프렛 순서',
      '5번 줄 5·7·8프렛 순서',
      '검지·약지·새끼 손가락 배정',
      '줄 이동 뒤에도 5프렛 포지션 유지',
    ],
    automaticFeedbackRules: [
      '지정 줄·프렛·손가락과 실제 음정이 모두 맞을 때만 이벤트 확정',
      '줄 이동 또는 프렛 오류 시 실제 위치와 목표 위치를 함께 표시',
      '한 사이클을 두 번 이상 정확히 연주해야 점수 확정',
    ],
  },
  {
    id: 'electric-palm-mute-stability',
    guitarMode: 'electric',
    category: 'palmMute',
    title: '팜뮤트 위치 안정화',
    goal: '브리지 근처 손날 위치를 유지하면서 피킹 속도와 음량을 일정하게 만듭니다.',
    startBpm: 70,
    targetBpm: 130,
    durationSeconds: 240,
    pattern: '8분음표 연속 다운 또는 얼터네이트',
    cameraFocus: 'right-hand',
    checkpoints: [
      '손날 중심이 브리지에서 일정한 거리를 유지하는지',
      '피킹 때 손목이 위아래로 크게 들리지 않는지',
      '마이크 신뢰도가 충분할 때 어택 음량이 일정한지',
    ],
    automaticFeedbackRules: [
      '손날 위치 흔들림이 커지면 속도보다 위치 고정 우선 안내',
      '앰프 잔향 또는 노이즈가 크면 소리 점수를 제외하고 영상 점수만 표시',
    ],
  },
];

export function getPracticePresetsForMode(mode: GuitarModeId): PracticePreset[] {
  return PERSONAL_PRACTICE_PRESETS.filter((preset) => preset.guitarMode === mode);
}
