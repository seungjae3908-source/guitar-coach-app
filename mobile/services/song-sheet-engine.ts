import type { GuitarModeId } from '../config/guitar-mode-profiles';

export type SongKey = 'C' | 'G' | 'D' | 'A' | 'E' | 'F' | 'Am' | 'Em' | 'Dm';
export type SongPracticeStyle = 'strum' | 'arpeggio' | 'riff';

export type SongBar = {
  id: string;
  chord: string;
  beats: number;
  instruction: string;
  section: 'intro' | 'verse' | 'chorus' | 'bridge';
};

export type SongSheetDraft = {
  id: string;
  guitarMode: GuitarModeId;
  title: string;
  artist: string;
  key: SongKey;
  bpm: number;
  beatsPerBar: number;
  style: SongPracticeStyle;
  bars: SongBar[];
  source: 'offline-draft';
  createdAt: string;
  updatedAt: string;
};

const PROGRESSIONS: Record<SongKey, { primary: string[]; alternate: string[]; palette: string[] }> = {
  C: { primary: ['C', 'G', 'Am', 'F'], alternate: ['Am', 'F', 'C', 'G'], palette: ['C', 'Dm', 'Em', 'F', 'G', 'Am'] },
  G: { primary: ['G', 'D', 'Em', 'C'], alternate: ['Em', 'C', 'G', 'D'], palette: ['G', 'Am', 'Bm', 'C', 'D', 'Em'] },
  D: { primary: ['D', 'A', 'Bm', 'G'], alternate: ['Bm', 'G', 'D', 'A'], palette: ['D', 'Em', 'F#m', 'G', 'A', 'Bm'] },
  A: { primary: ['A', 'E', 'F#m', 'D'], alternate: ['F#m', 'D', 'A', 'E'], palette: ['A', 'Bm', 'C#m', 'D', 'E', 'F#m'] },
  E: { primary: ['E', 'B', 'C#m', 'A'], alternate: ['C#m', 'A', 'E', 'B'], palette: ['E', 'F#m', 'G#m', 'A', 'B', 'C#m'] },
  F: { primary: ['F', 'C', 'Dm', 'Bb'], alternate: ['Dm', 'Bb', 'F', 'C'], palette: ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm'] },
  Am: { primary: ['Am', 'F', 'C', 'G'], alternate: ['Am', 'G', 'F', 'E'], palette: ['Am', 'C', 'Dm', 'E', 'F', 'G'] },
  Em: { primary: ['Em', 'C', 'G', 'D'], alternate: ['Em', 'D', 'C', 'B7'], palette: ['Em', 'G', 'Am', 'B7', 'C', 'D'] },
  Dm: { primary: ['Dm', 'Bb', 'F', 'C'], alternate: ['Dm', 'C', 'Bb', 'A'], palette: ['Dm', 'F', 'Gm', 'A', 'Bb', 'C'] },
};

function instructionFor(style: SongPracticeStyle, mode: GuitarModeId, index: number) {
  if (style === 'arpeggio') {
    return index % 2 === 0 ? 'P-i-m-i · P-i-m-i' : 'P-i-p-m · P-i-p-m';
  }
  if (style === 'riff') {
    return mode === 'electric'
      ? index % 2 === 0 ? '8분음표 다운피킹 · 팜뮤트' : '얼터네이트 피킹 · 끝 박 열기'
      : '베이스음 + 코드 스트럼';
  }
  return index % 2 === 0 ? 'D · D U · U D U' : 'D · D U · D U D U';
}

function chordForMode(chord: string, mode: GuitarModeId, style: SongPracticeStyle) {
  if (mode !== 'electric' || style !== 'riff') return chord;
  if (chord.endsWith('m')) return `${chord.slice(0, -1)}5`;
  if (chord.endsWith('7')) return `${chord.replace('7', '')}5`;
  return chord.includes('#') || chord.includes('b') ? `${chord}5` : `${chord}5`;
}

export function songChordPalette(key: SongKey, mode: GuitarModeId, style: SongPracticeStyle) {
  return PROGRESSIONS[key].palette.map((chord) => chordForMode(chord, mode, style));
}

export function generateSongSheetDraft(input: {
  guitarMode: GuitarModeId;
  title: string;
  artist: string;
  key: SongKey;
  bpm: number;
  beatsPerBar?: number;
  style: SongPracticeStyle;
  barCount: number;
}): SongSheetDraft {
  const now = new Date().toISOString();
  const safeBarCount = Math.min(32, Math.max(4, Math.round(input.barCount)));
  const beatsPerBar = Math.min(12, Math.max(2, Math.round(input.beatsPerBar ?? 4)));
  const progression = PROGRESSIONS[input.key];
  const bars = Array.from({ length: safeBarCount }, (_, index): SongBar => {
    const chorus = index >= Math.floor(safeBarCount / 2);
    const source = chorus ? progression.alternate : progression.primary;
    const section = index < Math.min(2, safeBarCount)
      ? 'intro'
      : chorus
        ? 'chorus'
        : 'verse';
    return {
      id: `bar-${index + 1}`,
      chord: chordForMode(source[index % source.length], input.guitarMode, input.style),
      beats: beatsPerBar,
      instruction: instructionFor(input.style, input.guitarMode, index),
      section,
    };
  });

  return {
    id: `song-${Date.now()}`,
    guitarMode: input.guitarMode,
    title: input.title.trim() || '제목 없는 연습곡',
    artist: input.artist.trim(),
    key: input.key,
    bpm: Math.min(220, Math.max(35, Math.round(input.bpm))),
    beatsPerBar,
    style: input.style,
    bars,
    source: 'offline-draft',
    createdAt: now,
    updatedAt: now,
  };
}

export function replaceSongBarChord(
  draft: SongSheetDraft,
  barId: string,
  chord: string,
): SongSheetDraft {
  return {
    ...draft,
    bars: draft.bars.map((bar) => bar.id === barId ? { ...bar, chord } : bar),
    updatedAt: new Date().toISOString(),
  };
}

export function nextChordInPalette(
  draft: SongSheetDraft,
  currentChord: string,
) {
  const palette = songChordPalette(draft.key, draft.guitarMode, draft.style);
  const currentIndex = palette.indexOf(currentChord);
  return palette[(currentIndex + 1 + palette.length) % palette.length] ?? currentChord;
}
