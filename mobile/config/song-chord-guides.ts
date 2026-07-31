import type { GuitarModeId } from './guitar-mode-profiles';

export type SongChordGuide = {
  chords: string[];
  note: string;
};

const GUIDES: Record<string, Record<string, string[]>> = {
  'acoustic-stand-by-me': {
    intro: ['A', 'F#m', 'D', 'E'],
    verse: ['A', 'F#m', 'D', 'E'],
    chorus: ['A', 'F#m', 'D', 'E'],
    bridge: ['D', 'E', 'A', 'F#m'],
    outro: ['A', 'F#m', 'D', 'E'],
  },
  'acoustic-photograph': {
    intro: ['G', 'Em', 'C', 'D'],
    verse: ['G', 'Em', 'C', 'D'],
    chorus: ['G', 'D', 'Em', 'C'],
    bridge: ['Em', 'C', 'G', 'D'],
    outro: ['G', 'Em', 'C', 'D'],
  },
  'acoustic-fast-car': {
    intro: ['C', 'G', 'Em', 'D'],
    verse: ['C', 'G', 'Em', 'D'],
    chorus: ['C', 'G', 'Em', 'D'],
    bridge: ['Em', 'D', 'C', 'G'],
    outro: ['C', 'G', 'Em', 'D'],
  },
  'acoustic-dust-in-the-wind': {
    intro: ['C', 'Cmaj7', 'Cadd9', 'C'],
    verse: ['C', 'G/B', 'Am', 'G'],
    chorus: ['F', 'C/E', 'Dm', 'G'],
    bridge: ['Am', 'G', 'F', 'G'],
    outro: ['C', 'Cmaj7', 'Cadd9', 'C'],
  },
  'electric-seven-nation-army': {
    intro: ['E5', 'G5', 'E5', 'D5'],
    verse: ['E5', 'G5', 'A5', 'G5'],
    chorus: ['E5', 'G5', 'A5', 'B5'],
    bridge: ['A5', 'G5', 'E5', 'D5'],
    outro: ['E5', 'G5', 'E5', 'D5'],
  },
  'electric-back-in-black': {
    intro: ['E5', 'D5', 'A5', 'E5'],
    verse: ['E5', 'D5', 'A5', 'E5'],
    chorus: ['A5', 'E5', 'B5', 'A5'],
    bridge: ['G5', 'D5', 'A5', 'E5'],
    outro: ['E5', 'D5', 'A5', 'E5'],
  },
  'electric-sweet-child': {
    intro: ['D', 'C', 'G', 'D'],
    verse: ['D', 'C', 'G', 'D'],
    chorus: ['A', 'C', 'D', 'D'],
    bridge: ['Em', 'C', 'B7', 'Am'],
    outro: ['D', 'C', 'G', 'D'],
  },
  'electric-sultans-of-swing': {
    intro: ['Dm', 'C', 'Bb', 'A'],
    verse: ['Dm', 'C', 'Bb', 'A'],
    chorus: ['F', 'C', 'Bb', 'Dm'],
    bridge: ['Gm', 'Bb', 'C', 'Dm'],
    outro: ['Dm', 'C', 'Bb', 'A'],
  },
};

const FALLBACK: Record<GuitarModeId, string[]> = {
  acoustic: ['G', 'Em', 'C', 'D'],
  electric: ['E5', 'G5', 'A5', 'B5'],
};

export function getSongChordGuide(songId: string, sectionId: string, mode: GuitarModeId): SongChordGuide {
  const chords = GUIDES[songId]?.[sectionId] ?? GUIDES[songId]?.verse ?? FALLBACK[mode];
  return {
    chords,
    note: '구간 연습용 코드 가이드입니다. 원곡의 완전한 채보가 아니라 자세·전환·리듬 훈련을 위한 단순화 진행입니다.',
  };
}

export function chordAtSectionProgress(chords: string[], progress: number) {
  if (!chords.length) return { index: 0, current: '-', next: '-' };
  const safe = Math.max(0, Math.min(0.999999, Number.isFinite(progress) ? progress : 0));
  const index = Math.min(chords.length - 1, Math.floor(safe * chords.length));
  return {
    index,
    current: chords[index],
    next: chords[(index + 1) % chords.length],
  };
}
