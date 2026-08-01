import type { GuitarModeId } from './guitar-mode-profiles';
import { normalizeCapo, transposeChord } from '../services/song-sheet-engine';

export type SongChordGuide = {
  chords: string[];
  soundingChords: string[];
  beatWeights: number[];
  capo: number;
  defaultCapo: number;
  shapeKey: string;
  soundingKey: string;
  strumPattern: string;
  tuning: string;
  note: string;
};

type GuidePreset = {
  sections: Record<string, string[]>;
  defaultCapo: number;
  shapeKey: string;
  soundingKey: string;
  tuning: string;
  patterns: Record<string, string>;
  beatWeights?: Record<string, number[]>;
};

const ACOUSTIC_8_BEAT = '1 & 2 & 3 & 4 & · D - D U - U D U';
const DOWN_EIGHTHS = '1 & 2 & 3 & 4 & · D D D D D D D D';

const GUIDES: Record<string, GuidePreset> = {
  'acoustic-stand-by-me': {
    defaultCapo: 2, shapeKey: 'G', soundingKey: 'A', tuning: '표준 튜닝 E A D G B E',
    sections: { intro: ['G', 'Em', 'C', 'D'], verse: ['G', 'Em', 'C', 'D'], chorus: ['G', 'Em', 'C', 'D'], bridge: ['C', 'D', 'G', 'Em'], outro: ['G', 'Em', 'C', 'D'] },
    patterns: { intro: '1 2 3 4 · D D D D', verse: ACOUSTIC_8_BEAT, chorus: '1 & 2 & 3 & 4 & · D - D U D U D U', bridge: '코드당 4박 다운', outro: ACOUSTIC_8_BEAT },
  },
  'acoustic-photograph': {
    defaultCapo: 2, shapeKey: 'D', soundingKey: 'E', tuning: '표준 튜닝 E A D G B E',
    sections: { intro: ['D', 'Bm', 'G', 'A'], verse: ['D', 'Bm', 'G', 'A'], chorus: ['D', 'A', 'Bm', 'G'], bridge: ['Bm', 'G', 'D', 'A'], outro: ['D', 'Bm', 'G', 'A'] },
    patterns: { intro: 'P-i-m-i · P-i-m-i', verse: ACOUSTIC_8_BEAT, chorus: '1 & 2 & 3 & 4 & · D D U U D U D U', bridge: 'P-i-P-m · P-i-m-i', outro: '1 2 3 4 · 느린 다운' },
  },
  'acoustic-fast-car': {
    defaultCapo: 2, shapeKey: 'C', soundingKey: 'D', tuning: '표준 튜닝 E A D G B E',
    sections: { intro: ['C', 'G', 'Em', 'D'], verse: ['C', 'G', 'Em', 'D'], chorus: ['C', 'G', 'Em', 'D'], bridge: ['Em', 'D', 'C', 'G'], outro: ['C', 'G', 'Em', 'D'] },
    patterns: { intro: 'P-i-m-i · 베이스/상성부 교대', verse: '1 e & a · 일정한 16분 분할', chorus: ACOUSTIC_8_BEAT, bridge: 'P-i-m-i 반복', outro: 'P-i-m-i 반복' },
  },
  'acoustic-dust-in-the-wind': {
    defaultCapo: 0, shapeKey: 'C', soundingKey: 'C', tuning: '표준 튜닝 E A D G B E',
    sections: { intro: ['C', 'Cmaj7', 'Cadd9', 'C'], verse: ['C', 'G/B', 'Am', 'G'], chorus: ['F', 'C/E', 'Dm', 'G'], bridge: ['Am', 'G', 'F', 'G'], outro: ['C', 'Cmaj7', 'Cadd9', 'C'] },
    patterns: { intro: 'P-i-m-a-m-i · 6음 패턴', verse: 'P-i-m-a-m-i 반복', chorus: 'P-i-m-a-m-i · 멜로디 강조', bridge: 'P-i-m-a-m-i 반복', outro: 'P-i-m-a-m-i 반복' },
  },
  'electric-seven-nation-army': {
    defaultCapo: 0, shapeKey: 'E', soundingKey: 'E', tuning: '표준 튜닝 E A D G B E',
    sections: { intro: ['E5', 'G5', 'E5', 'D5'], verse: ['E5', 'G5', 'A5', 'G5'], chorus: ['E5', 'G5', 'A5', 'B5'], bridge: ['A5', 'G5', 'E5', 'D5'], outro: ['E5', 'G5', 'E5', 'D5'] },
    patterns: { intro: DOWN_EIGHTHS, verse: DOWN_EIGHTHS, chorus: DOWN_EIGHTHS, bridge: '다운피킹 · 마지막 박 열기', outro: DOWN_EIGHTHS },
  },
  'electric-back-in-black': {
    defaultCapo: 0, shapeKey: 'E', soundingKey: 'E', tuning: '표준 튜닝 E A D G B E',
    sections: { intro: ['E5', 'D5', 'A5', 'E5'], verse: ['E5', 'D5', 'A5', 'E5'], chorus: ['A5', 'E5', 'B5', 'A5'], bridge: ['G5', 'D5', 'A5', 'E5'], outro: ['E5', 'D5', 'A5', 'E5'] },
    patterns: { intro: '리프 악센트 · 쉼표 유지', verse: '다운/업 교대 · 코드 사이 뮤트', chorus: DOWN_EIGHTHS, bridge: '리프 단위 반복', outro: '리프 악센트 유지' },
  },
  'electric-sweet-child': {
    defaultCapo: 0, shapeKey: 'D', soundingKey: 'Db', tuning: '원곡 계열은 반음 다운 튜닝을 사용하므로 앱의 표준 튜닝 표기와 실제 울림이 다를 수 있음',
    sections: { intro: ['D', 'C', 'G', 'D'], verse: ['D', 'C', 'G', 'D'], chorus: ['A', 'C', 'D', 'D'], bridge: ['Em', 'C', 'B7', 'Am'], outro: ['D', 'C', 'G', 'D'] },
    patterns: { intro: '아르페지오 리프 · 음마다 교대 피킹', verse: '8분 스트럼과 리프 교대', chorus: '다운 중심 강세', bridge: '리드 프레이즈', outro: '리프 반복' },
  },
  'electric-sultans-of-swing': {
    defaultCapo: 0, shapeKey: 'Dm', soundingKey: 'Dm', tuning: '표준 튜닝 E A D G B E',
    sections: { intro: ['Dm', 'C', 'Bb', 'A'], verse: ['Dm', 'C', 'Bb', 'A'], chorus: ['F', 'C', 'Bb', 'Dm'], bridge: ['Gm', 'Bb', 'C', 'Dm'], outro: ['Dm', 'C', 'Bb', 'A'] },
    patterns: { intro: '핑거/피크 혼합 · 약박 살리기', verse: '16분 고스트 노트 포함', chorus: '코드 스탭 강조', bridge: '리드 프레이즈', outro: '약박 유지' },
  },
};

const FALLBACK: Record<GuitarModeId, GuidePreset> = {
  acoustic: { defaultCapo: 0, shapeKey: 'G', soundingKey: 'G', tuning: '표준 튜닝 E A D G B E', sections: { verse: ['G', 'Em', 'C', 'D'] }, patterns: { verse: ACOUSTIC_8_BEAT } },
  electric: { defaultCapo: 0, shapeKey: 'E', soundingKey: 'E', tuning: '표준 튜닝 E A D G B E', sections: { verse: ['E5', 'G5', 'A5', 'B5'] }, patterns: { verse: DOWN_EIGHTHS } },
};

export function getSongChordGuide(songId: string, sectionId: string, mode: GuitarModeId, capoOverride?: number): SongChordGuide {
  const preset = GUIDES[songId] ?? FALLBACK[mode];
  const section = preset.sections[sectionId] ? sectionId : 'verse';
  const chords = preset.sections[section] ?? FALLBACK[mode].sections.verse;
  const capo = capoOverride == null ? preset.defaultCapo : normalizeCapo(capoOverride);
  const soundingChords = chords.map((chord) => transposeChord(chord, capo));
  const beatWeights = preset.beatWeights?.[section] ?? chords.map(() => 4);
  return {
    chords, soundingChords, beatWeights, capo, defaultCapo: preset.defaultCapo,
    shapeKey: preset.shapeKey, soundingKey: capo === preset.defaultCapo ? preset.soundingKey : transposeChord(preset.shapeKey, capo),
    strumPattern: preset.patterns[section] ?? preset.patterns.verse ?? (mode === 'acoustic' ? ACOUSTIC_8_BEAT : DOWN_EIGHTHS),
    tuning: preset.tuning,
    note: '연주 폼 코드와 실제 울림 코드를 분리한 구간 연습 가이드입니다. 원곡 전체 채보가 아니므로 영상 구간 보정과 귀 확인을 함께 사용하세요.',
  };
}

export function chordAtSectionProgress(chords: string[], progress: number, beatWeights?: number[]) {
  if (!chords.length) return { index: 0, current: '-', next: '-' };
  const safe = Math.max(0, Math.min(0.999999, Number.isFinite(progress) ? progress : 0));
  const weights = chords.map((_, index) => Math.max(0.01, beatWeights?.[index] ?? 1));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const target = safe * total;
  let elapsed = 0;
  let index = chords.length - 1;
  for (let cursor = 0; cursor < chords.length; cursor += 1) {
    elapsed += weights[cursor];
    if (target < elapsed) { index = cursor; break; }
  }
  return { index, current: chords[index], next: chords[(index + 1) % chords.length] };
}
