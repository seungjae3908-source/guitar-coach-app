import type { GuitarModeId, PracticeCategoryId } from './guitar-mode-profiles';
import type { MasteryGradeId, MasteryProfile } from '../services/mastery-skill-engine';

export type TrainingSongSection = {
  id: string;
  label: string;
  startRatio: number;
  endRatio: number;
  technique: string;
  rhythm: string;
  rightHand: string;
  leftHand: string;
  coachCue: string;
  toneHint: string;
};

export type TrainingSong = {
  id: string;
  guitarMode: GuitarModeId;
  title: string;
  artist: string;
  level: MasteryGradeId;
  targetCategories: PracticeCategoryId[];
  baseBpm: number;
  youtubeQuery: string;
  whyItHelps: string;
  sections: TrainingSongSection[];
};

const COMMON_SECTIONS = {
  intro: {
    id: 'intro',
    label: '인트로',
    startRatio: 0,
    endRatio: 0.13,
  },
  verse: {
    id: 'verse',
    label: '벌스',
    startRatio: 0.13,
    endRatio: 0.42,
  },
  chorus: {
    id: 'chorus',
    label: '후렴',
    startRatio: 0.42,
    endRatio: 0.68,
  },
  bridge: {
    id: 'bridge',
    label: '브리지·간주',
    startRatio: 0.68,
    endRatio: 0.84,
  },
  outro: {
    id: 'outro',
    label: '마무리',
    startRatio: 0.84,
    endRatio: 1,
  },
};

export const MASTERY_SONG_CATALOG: TrainingSong[] = [
  {
    id: 'acoustic-stand-by-me',
    guitarMode: 'acoustic',
    title: 'Stand by Me',
    artist: 'Ben E. King',
    level: 'foundation',
    targetCategories: ['chords', 'strumming'],
    baseBpm: 120,
    youtubeQuery: 'Ben E King Stand by Me official audio',
    whyItHelps: '반복되는 코드 흐름에서 코드 동시 착지와 일정한 8비트 스트럼을 만들기 좋습니다.',
    sections: [
      { ...COMMON_SECTIONS.intro, technique: '코드 준비', rhythm: '4분음표로 코드당 한 번', rightHand: '피크 끝을 작게 내고 다운만 일정하게', leftHand: '다음 코드 모양을 미리 공중에서 준비', coachCue: '코드가 바뀌는 순간 손가락을 따로 놓지 말고 한 덩어리로 착지하세요.', toneHint: '통기타 생톤 또는 낮은 리버브' },
      { ...COMMON_SECTIONS.verse, technique: '8비트 스트럼', rhythm: 'D D U U D U', rightHand: '다운은 넓게, 업은 1~3번 줄만 가볍게', leftHand: '공통 손가락과 손목 축 유지', coachCue: '업스트로크가 걸리면 업 범위를 절반으로 줄이세요.', toneHint: '중역이 선명한 클린' },
      { ...COMMON_SECTIONS.chorus, technique: '강약 표현', rhythm: '2·4박을 조금 강조', rightHand: '손목 힘을 빼고 악센트만 이동 폭 증가', leftHand: '코드 버징 없는지 첫 박 확인', coachCue: '세게 치는 것이 아니라 2박과 4박만 조금 더 또렷하게 만드세요.', toneHint: '리버브 10~15%' },
      { ...COMMON_SECTIONS.bridge, technique: '전환 안정', rhythm: '메트로놈 절반 속도로 무음 전환', rightHand: '오른손 멈추고 왼손 전환만 확인', leftHand: '첫 손가락과 마지막 손가락 도착 차이 축소', coachCue: '소리보다 착지 시간을 먼저 맞추세요.', toneHint: '생톤 점검' },
      { ...COMMON_SECTIONS.outro, technique: '완주', rhythm: '원래 패턴 유지', rightHand: '마지막까지 이동 폭 유지', leftHand: '마지막 코드 울림 유지', coachCue: '끝부분에서 빨라지지 않게 클릭 뒤를 따라가세요.', toneHint: '동일 설정 유지' },
    ],
  },
  {
    id: 'acoustic-photograph',
    guitarMode: 'acoustic',
    title: 'Photograph',
    artist: 'Ed Sheeran',
    level: 'developing',
    targetCategories: ['chords', 'strumming', 'fingerstyle'],
    baseBpm: 108,
    youtubeQuery: 'Ed Sheeran Photograph official audio',
    whyItHelps: '부드러운 코드 전환, 다이내믹 스트럼과 아르페지오 연결을 한 곡에서 연습할 수 있습니다.',
    sections: [
      { ...COMMON_SECTIONS.intro, technique: '잔잔한 아르페지오', rhythm: 'P-i-m-i', rightHand: '엄지는 베이스 뒤 다음 줄로 자연스럽게 이동', leftHand: '코드 모양을 유지하며 필요한 손가락만 이동', coachCue: '검지가 탄현 뒤 앞으로 남지 않고 손바닥 쪽으로 짧게 돌아오게 하세요.', toneHint: 'THR30 Acoustic · 낮은 Gain' },
      { ...COMMON_SECTIONS.verse, technique: '약한 스트럼', rhythm: 'D · D U · U D U', rightHand: '피크를 깊게 넣지 않고 손목으로 작은 원', leftHand: '전환 직전 손을 과하게 들지 않기', coachCue: '소리가 거칠면 세기보다 피크 깊이를 먼저 줄이세요.', toneHint: 'Treble 약간 감소' },
      { ...COMMON_SECTIONS.chorus, technique: '다이내믹 확대', rhythm: '8비트 연속', rightHand: '다운 5~6줄, 업 2~3줄', leftHand: '첫 박 전에 코드 안정', coachCue: '후렴에서 팔 전체가 커지지 않게 손목 이동 폭만 조금 늘리세요.', toneHint: 'Reverb 12~18%' },
      { ...COMMON_SECTIONS.bridge, technique: '아르페지오 복귀', rhythm: 'P-i-p-m', rightHand: '두 번째 엄지가 끊기지 않게 연결', leftHand: '코드 압력 최소화', coachCue: '두 번째 P가 늦으면 P-i만 20초 분리 연습하세요.', toneHint: '공간계 유지' },
      { ...COMMON_SECTIONS.outro, technique: '감정 유지', rhythm: '느린 스트럼', rightHand: '마지막 박을 서두르지 않기', leftHand: '코드 울림 방해하지 않기', coachCue: '마지막까지 박을 유지하고 소리를 자연스럽게 남기세요.', toneHint: '리버브 꼬리 확인' },
    ],
  },
  {
    id: 'acoustic-fast-car',
    guitarMode: 'acoustic',
    title: 'Fast Car',
    artist: 'Tracy Chapman',
    level: 'solid',
    targetCategories: ['fingerstyle', 'fingering', 'chords'],
    baseBpm: 104,
    youtubeQuery: 'Tracy Chapman Fast Car official audio',
    whyItHelps: '반복 핑거스타일 패턴에서 오른손 독립성과 왼손 최소 이동을 동시에 훈련하기 좋습니다.',
    sections: [
      { ...COMMON_SECTIONS.intro, technique: '고정 핑거스타일 패턴', rhythm: '베이스-상성부 교대', rightHand: 'P와 i·m의 역할을 분리', leftHand: '손가락을 프렛 가까이에 낮게 유지', coachCue: '오른손 패턴이 흔들리면 왼손을 뮤트하고 오른손만 반복하세요.', toneHint: '통기타 생톤 · Compressor 아주 약하게' },
      { ...COMMON_SECTIONS.verse, technique: '패턴 유지와 코드 이동', rhythm: '16분 느낌의 일정한 분할', rightHand: '각 손가락 복귀 거리 동일', leftHand: '공통 축 유지', coachCue: '코드가 바뀌어도 오른손 간격을 바꾸지 마세요.', toneHint: 'Bass 48 · Treble 46 시작' },
      { ...COMMON_SECTIONS.chorus, technique: '스트럼 전환', rhythm: '8비트 스트럼', rightHand: '패턴에서 스트럼으로 자연스럽게 전환', leftHand: '전환 직전 모양 완성', coachCue: '오른손 방식이 바뀌어도 템포는 그대로 유지하세요.', toneHint: '약한 리버브' },
      { ...COMMON_SECTIONS.bridge, technique: '지구력', rhythm: '원패턴 반복', rightHand: '손목과 손가락 힘 점검', leftHand: '불필요한 압력 줄이기', coachCue: '손에 힘이 들어가면 속도를 낮추고 30초간 작은 동작으로 재설정하세요.', toneHint: '생톤으로 잡음 확인' },
      { ...COMMON_SECTIONS.outro, technique: '일관성', rhythm: '패턴 유지', rightHand: '마지막까지 베이스 음량 일정', leftHand: '프렛 버징 방지', coachCue: '끝까지 같은 패턴 크기를 유지하세요.', toneHint: '동일 설정' },
    ],
  },
  {
    id: 'acoustic-dust-in-the-wind',
    guitarMode: 'acoustic',
    title: 'Dust in the Wind',
    artist: 'Kansas',
    level: 'advanced',
    targetCategories: ['arpeggio', 'fingerstyle', 'fingering'],
    baseBpm: 94,
    youtubeQuery: 'Kansas Dust in the Wind official audio',
    whyItHelps: '연속 아르페지오에서 손가락 독립성, 복귀 속도와 왼손 변화의 정확도를 상급 수준으로 끌어올립니다.',
    sections: [
      { ...COMMON_SECTIONS.intro, technique: '연속 분산화음', rhythm: 'P-i-m-a-m-i 계열', rightHand: '손가락별 줄 담당 고정', leftHand: '필요한 음만 최소 이동', coachCue: 'a를 움직일 때 m이 같이 들리면 속도를 낮추고 a만 단독 반복하세요.', toneHint: '자연스러운 통기타 톤' },
      { ...COMMON_SECTIONS.verse, technique: '독립성 유지', rhythm: '16분 일정', rightHand: '손목 고정, 손가락 복귀 짧게', leftHand: '코드 전환 중 음 끊김 최소화', coachCue: '검지 복귀가 늦으면 한 마디를 멈추고 P-i만 다시 맞추세요.', toneHint: 'Compressor 10~15%' },
      { ...COMMON_SECTIONS.chorus, technique: '음량 균형', rhythm: '베이스와 상성부 균형', rightHand: '엄지 과도한 강조 방지', leftHand: '멜로디 음 유지', coachCue: '베이스가 튀면 엄지 힘을 줄이고 상성부를 더 또렷하게 만드세요.', toneHint: '중역 약간 강조' },
      { ...COMMON_SECTIONS.bridge, technique: '집중 유지', rhythm: '연속 패턴', rightHand: '불필요한 손목 회전 제거', leftHand: '전환 전 손가락 높이 축소', coachCue: '속도보다 한 음도 빠지지 않는 패턴을 우선하세요.', toneHint: '생톤 점검' },
      { ...COMMON_SECTIONS.outro, technique: '완성도', rhythm: '감속 없이 유지', rightHand: '동작 크기 일정', leftHand: '마지막 음 분리', coachCue: '끝에서 지치더라도 손목을 흔들지 말고 손가락만 움직이세요.', toneHint: '리버브 최소' },
    ],
  },
  {
    id: 'electric-seven-nation-army',
    guitarMode: 'electric',
    title: 'Seven Nation Army',
    artist: 'The White Stripes',
    level: 'foundation',
    targetCategories: ['downPicking', 'powerChords', 'palmMute'],
    baseBpm: 124,
    youtubeQuery: 'The White Stripes Seven Nation Army official video',
    whyItHelps: '단순한 리프에서 정확한 다운피킹, 박자와 뮤트 기본기를 재미있게 만들 수 있습니다.',
    sections: [
      { ...COMMON_SECTIONS.intro, technique: '한 줄 리프', rhythm: '8분음표 중심', rightHand: '피크 끝 2~3mm, 다운 이동 작게', leftHand: '프렛 바로 뒤를 정확히 누르기', coachCue: '피크가 줄을 통과한 뒤 멀리 나가지 않게 하세요.', toneHint: 'THR30 Crunch · Gain 35~45' },
      { ...COMMON_SECTIONS.verse, technique: '리프 반복', rhythm: '클릭과 어택 일치', rightHand: '같은 깊이로 다운피킹', leftHand: '손가락을 줄 가까이 유지', coachCue: '소리가 거칠면 게인보다 피킹 깊이를 먼저 줄이세요.', toneHint: 'Mid 55 전후' },
      { ...COMMON_SECTIONS.chorus, technique: '파워코드', rhythm: '강한 4분·8분', rightHand: '필요한 줄만 타격', leftHand: '사용하지 않는 줄 뮤트', coachCue: '파워코드가 커져도 팔 전체 대신 손목 중심으로 치세요.', toneHint: 'Rhythm 톤 · Reverb 낮게' },
      { ...COMMON_SECTIONS.bridge, technique: '정지와 뮤트', rhythm: '쉼표 정확히', rightHand: '손바닥과 피크로 동시에 정지', leftHand: '압력만 풀어 잡음 차단', coachCue: '음을 끊을 때 손을 떼지 말고 압력만 풀어 잡음을 막으세요.', toneHint: 'NS 최소 필요량' },
      { ...COMMON_SECTIONS.outro, technique: '완주', rhythm: '리프 반복', rightHand: '마지막까지 박 유지', leftHand: '프렛 이동 최소화', coachCue: '마지막 반복에서 빨라지지 않게 메트로놈 뒤를 따라가세요.', toneHint: '동일 톤' },
    ],
  },
  {
    id: 'electric-back-in-black',
    guitarMode: 'electric',
    title: 'Back in Black',
    artist: 'AC/DC',
    level: 'developing',
    targetCategories: ['powerChords', 'downPicking', 'palmMute'],
    baseBpm: 94,
    youtubeQuery: 'ACDC Back in Black official audio',
    whyItHelps: '리듬의 빈 공간, 파워코드 전환과 강한 어택을 정확하게 만드는 대표적인 록 리듬 훈련곡입니다.',
    sections: [
      { ...COMMON_SECTIONS.intro, technique: '록 리듬 리프', rhythm: '쉼표 포함 8비트', rightHand: '피크 깊이 일정, 쉼표에서 즉시 정지', leftHand: '코드 이동 전 손 모양 유지', coachCue: '음을 많이 치는 것보다 쉼표를 정확하게 비우는 것이 핵심입니다.', toneHint: 'THR30 Crunch Classic · Gain 40~50' },
      { ...COMMON_SECTIONS.verse, technique: '파워코드 그루브', rhythm: '뒤로 기대는 8비트', rightHand: '클릭보다 앞서지 않기', leftHand: '불필요한 줄 뮤트', coachCue: '흥분해서 빨라지지 말고 클릭 뒤쪽에 어택을 놓으세요.', toneHint: 'Bass 48 · Mid 58 · Treble 52' },
      { ...COMMON_SECTIONS.chorus, technique: '강약 대비', rhythm: '강한 다운 스트로크', rightHand: '힘이 아니라 이동 속도로 악센트', leftHand: '코드 울림 후 정확히 뮤트', coachCue: '피크를 세게 쥐지 말고 손목 속도로 강한 어택을 만드세요.', toneHint: 'Reverb 5~10%' },
      { ...COMMON_SECTIONS.bridge, technique: '리프 연결', rhythm: '짧은 구간 반복', rightHand: '다운·업 선택 고정', leftHand: '포지션 이동 최소화', coachCue: '한 번에 완주하지 말고 2마디를 완벽하게 만든 뒤 연결하세요.', toneHint: '생톤에 가까운 드라이브' },
      { ...COMMON_SECTIONS.outro, technique: '지구력', rhythm: '리듬 유지', rightHand: '손목 굳음 확인', leftHand: '압력 최소화', coachCue: '손목이 굳으면 즉시 5 BPM 낮추고 작은 동작으로 돌아가세요.', toneHint: '동일 톤' },
    ],
  },
  {
    id: 'electric-sweet-child',
    guitarMode: 'electric',
    title: "Sweet Child O' Mine",
    artist: 'Guns N’ Roses',
    level: 'solid',
    targetCategories: ['alternatePicking', 'fingering', 'scales'],
    baseBpm: 125,
    youtubeQuery: "Guns N Roses Sweet Child O Mine official video",
    whyItHelps: '줄 이동과 왼손 핑거링, 얼터네이트 피킹의 동기화를 중급 이상으로 끌어올릴 수 있습니다.',
    sections: [
      { ...COMMON_SECTIONS.intro, technique: '크로스 스트링 리프', rhythm: '8분음표 일정', rightHand: '업·다운 순서 고정, 줄 이동 최소', leftHand: '손가락을 프렛 가까이 낮게 유지', coachCue: '줄을 바꿀 때 팔 전체가 움직이지 않게 손목과 피크 경로를 작게 하세요.', toneHint: 'GT-1 Natural Clean/Crunch · Delay 소량' },
      { ...COMMON_SECTIONS.verse, technique: '리듬 코드', rhythm: '8비트 록 스트럼', rightHand: '피크 노출 일정', leftHand: '코드와 뮤트 동시 제어', coachCue: '리프 뒤 리듬으로 넘어가도 피크 그립을 바꾸지 마세요.', toneHint: 'Rhythm 패치' },
      { ...COMMON_SECTIONS.chorus, technique: '강한 리듬', rhythm: '다운 중심', rightHand: '악센트와 쉼표 구분', leftHand: '파워코드 이동', coachCue: '강한 부분에서도 사용하지 않는 줄을 왼손으로 눕혀 막으세요.', toneHint: 'Gain 50~60 · Mid 유지' },
      { ...COMMON_SECTIONS.bridge, technique: '리드 준비', rhythm: '느린 분할 연습', rightHand: '피킹과 왼손 착지 동시', leftHand: '포지션 이동 후 기준 손가락 고정', coachCue: '속도를 낮춰 피크와 왼손이 같은 순간에 움직이는지 확인하세요.', toneHint: 'Lead 패치 · Delay 12~18%' },
      { ...COMMON_SECTIONS.outro, technique: '정확도 유지', rhythm: '원템포 도전', rightHand: '줄 이동 폭 일정', leftHand: '불필요한 손가락 들림 축소', coachCue: '틀린 채 반복하지 말고 오류가 난 두 음만 분리하세요.', toneHint: '리드 톤 유지' },
    ],
  },
  {
    id: 'electric-sultans-of-swing',
    guitarMode: 'electric',
    title: 'Sultans of Swing',
    artist: 'Dire Straits',
    level: 'advanced',
    targetCategories: ['leadTechnique', 'alternatePicking', 'scales'],
    baseBpm: 148,
    youtubeQuery: 'Dire Straits Sultans of Swing official video',
    whyItHelps: '다이내믹, 뮤트, 프레이징과 빠른 포지션 이동을 상급 수준으로 통합하는 데 좋습니다.',
    sections: [
      { ...COMMON_SECTIONS.intro, technique: '클린 프레이징', rhythm: '16분 셔플 감각', rightHand: '작은 피킹 또는 손가락 어택', leftHand: '짧은 음과 긴 음 구분', coachCue: '모든 음을 같은 크기로 치지 말고 문장 끝 음을 남기세요.', toneHint: 'THR30 Clean Boutique · Gain 낮게' },
      { ...COMMON_SECTIONS.verse, technique: '리듬과 필인', rhythm: '쉼표가 있는 그루브', rightHand: '뮤트와 어택 교대', leftHand: '코드 조각과 필인 전환', coachCue: '필인을 넣기 전에 리듬의 빈 공간을 먼저 정확히 만드세요.', toneHint: 'Compressor 약하게' },
      { ...COMMON_SECTIONS.chorus, technique: '프레이즈 강조', rhythm: '강약 대비', rightHand: '어택 위치 일정', leftHand: '슬라이드·해머온 후 음정 유지', coachCue: '기교보다 시작음과 끝음의 타이밍을 먼저 맞추세요.', toneHint: 'Mid 55~62' },
      { ...COMMON_SECTIONS.bridge, technique: '빠른 리드', rhythm: '느린 속도에서 묶음 연습', rightHand: '4음 또는 6음 단위로 피킹', leftHand: '포지션 이동 기준 손가락 설정', coachCue: '긴 구간을 반복하지 말고 4음 묶음이 3회 성공하면 다음 묶음으로 이동하세요.', toneHint: 'Delay 매우 소량' },
      { ...COMMON_SECTIONS.outro, technique: '표현과 완주', rhythm: '프레이즈 호흡', rightHand: '강약 유지', leftHand: '비브라토 속도 일정', coachCue: '마지막에는 속도보다 음 하나하나의 길이와 강약을 지키세요.', toneHint: '클린 리드 톤' },
    ],
  },
];

const GRADE_RANK: Record<MasteryGradeId, number> = {
  unmeasured: 0,
  foundation: 1,
  developing: 2,
  solid: 3,
  advanced: 4,
  master: 5,
};

export function recommendTrainingSongs(profile: MasteryProfile, limit = 4) {
  const weakCategory = profile.priority?.category;
  const levelRank = GRADE_RANK[profile.overallGrade] || GRADE_RANK[profile.priority?.grade ?? 'foundation'];
  return MASTERY_SONG_CATALOG
    .filter((song) => song.guitarMode === profile.guitarMode)
    .map((song) => {
      const songRank = GRADE_RANK[song.level];
      const categoryMatch = weakCategory && song.targetCategories.includes(weakCategory) ? 30 : 0;
      const levelDistance = Math.abs(songRank - Math.max(1, levelRank));
      const levelFit = Math.max(0, 24 - levelDistance * 9);
      const stretchBonus = songRank === Math.max(1, levelRank) + 1 ? 6 : 0;
      return {
        song,
        fitScore: categoryMatch + levelFit + stretchBonus,
        reason: categoryMatch
          ? `${profile.priority?.title ?? '현재 약점'}을 곡 안에서 반복하기 좋은 난이도입니다.`
          : `${song.level} 단계의 완주력과 음악성을 키우는 보조곡입니다.`,
      };
    })
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, limit);
}

export function getTrainingSong(id: string | null | undefined) {
  return MASTERY_SONG_CATALOG.find((song) => song.id === id) ?? null;
}
