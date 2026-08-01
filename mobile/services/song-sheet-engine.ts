import type { GuitarModeId } from '../config/guitar-mode-profiles';

export type SongKey =
  | 'C' | 'C#' | 'D' | 'Eb' | 'E' | 'F' | 'F#' | 'G' | 'Ab' | 'A' | 'Bb' | 'B'
  | 'Cm' | 'C#m' | 'Dm' | 'Ebm' | 'Em' | 'Fm' | 'F#m' | 'Gm' | 'G#m' | 'Am' | 'Bbm' | 'Bm';
export type SongPracticeStyle = 'strum' | 'arpeggio' | 'riff';
export type SongEventKind = 'strum' | 'finger' | 'tab' | 'hold';

export const SONG_KEYS: SongKey[] = [
  'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm',
];

export type SongBeatEvent = {
  id: string;
  beat: number;
  subdivision: 1 | 2;
  kind: SongEventKind;
  label: string;
  strings: number[];
  frets: number[];
  accent: boolean;
};

export type SongBar = {
  id: string;
  chord: string;
  soundingChord?: string;
  beats: number;
  instruction: string;
  section: 'intro' | 'verse' | 'chorus' | 'bridge';
  events?: SongBeatEvent[];
};

export type SongSheetDraft = {
  id: string;
  guitarMode: GuitarModeId;
  title: string;
  artist: string;
  key: SongKey;
  shapeKey?: SongKey;
  capo?: number;
  bpm: number;
  beatsPerBar: number;
  style: SongPracticeStyle;
  bars: SongBar[];
  notationVersion?: 1 | 2 | 3;
  source: 'offline-draft';
  createdAt: string;
  updatedAt: string;
};

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const ROOT_INDEX: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

const ROOT_POSITIONS: Record<string, { string: number; fret: number }> = {
  E: { string: 6, fret: 0 }, F: { string: 6, fret: 1 }, 'F#': { string: 6, fret: 2 }, Gb: { string: 6, fret: 2 },
  G: { string: 6, fret: 3 }, 'G#': { string: 6, fret: 4 }, Ab: { string: 6, fret: 4 },
  A: { string: 5, fret: 0 }, 'A#': { string: 5, fret: 1 }, Bb: { string: 5, fret: 1 }, B: { string: 5, fret: 2 },
  C: { string: 5, fret: 3 }, 'C#': { string: 5, fret: 4 }, Db: { string: 5, fret: 4 },
  D: { string: 4, fret: 0 }, 'D#': { string: 4, fret: 1 }, Eb: { string: 4, fret: 1 },
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function normalizeCapo(value: number | null | undefined) {
  return clamp(Number.isFinite(value) ? Math.round(value ?? 0) : 0, 0, 11);
}

function preferFlatsFor(value: string) {
  return value.includes('b') || /^(F|Bb|Eb|Ab|Dm|Gm|Cm|Fm|Bbm|Ebm)$/.test(value);
}

function noteName(index: number, preferFlats: boolean) {
  const normalized = ((index % 12) + 12) % 12;
  return (preferFlats ? FLATS : SHARPS)[normalized];
}

function parseChord(chord: string) {
  const match = chord.trim().match(/^([A-G](?:#|b)?)([^/]*?)(?:\/([A-G](?:#|b)?))?$/);
  if (!match) return null;
  return { root: match[1], suffix: match[2] ?? '', bass: match[3] ?? '' };
}

export function transposeChord(chord: string, semitones: number, preferFlats = preferFlatsFor(chord)) {
  if (chord === 'N.C.' || chord === '-') return chord;
  const parsed = parseChord(chord);
  if (!parsed || ROOT_INDEX[parsed.root] == null) return chord;
  const root = noteName(ROOT_INDEX[parsed.root] + semitones, preferFlats);
  const bass = parsed.bass && ROOT_INDEX[parsed.bass] != null
    ? `/${noteName(ROOT_INDEX[parsed.bass] + semitones, preferFlats)}`
    : '';
  return `${root}${parsed.suffix}${bass}`;
}

export function transposeSongKey(key: SongKey, semitones: number): SongKey {
  const minor = key.endsWith('m');
  const root = minor ? key.slice(0, -1) : key;
  const name = noteName((ROOT_INDEX[root] ?? 0) + semitones, preferFlatsFor(key));
  const candidate = `${name}${minor ? 'm' : ''}`;
  if (SONG_KEYS.includes(candidate as SongKey)) return candidate as SongKey;
  const enharmonic = candidate
    .replace(/^D#/, 'Eb')
    .replace(/^G#/, 'Ab')
    .replace(/^A#/, 'Bb')
    .replace(/^Gb/, 'F#')
    .replace(/^Db/, 'C#');
  return SONG_KEYS.includes(enharmonic as SongKey) ? enharmonic as SongKey : key;
}

export function detectedKeyToSongKey(detected: string): SongKey {
  const normalized = detected.trim();
  const rawRoot = normalized.split(/\s+/)[0] ?? 'C';
  const root = rawRoot.replace(/^D#$/, 'Eb').replace(/^G#$/, 'Ab').replace(/^A#$/, 'Bb').replace(/^Gb$/, 'F#').replace(/^Db$/, 'C#');
  const minor = /minor|\bm\b/i.test(normalized);
  const candidate = `${root}${minor ? 'm' : ''}` as SongKey;
  return SONG_KEYS.includes(candidate) ? candidate : minor ? 'Am' : 'C';
}

function scaleChord(key: SongKey, degree: number, overrideSuffix?: string) {
  const minorKey = key.endsWith('m');
  const rootText = minorKey ? key.slice(0, -1) : key;
  const root = ROOT_INDEX[rootText] ?? 0;
  const intervals = minorKey ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const qualities = minorKey ? ['m', 'dim', '', 'm', 'm', '', ''] : ['', 'm', 'm', '', '', 'm', 'dim'];
  const index = clamp(degree, 1, 7) - 1;
  return `${noteName(root + intervals[index], preferFlatsFor(key))}${overrideSuffix ?? qualities[index]}`;
}

function progressionForKey(key: SongKey) {
  const minor = key.endsWith('m');
  if (minor) {
    return {
      primary: [scaleChord(key, 1), scaleChord(key, 6), scaleChord(key, 3), scaleChord(key, 7)],
      alternate: [scaleChord(key, 1), scaleChord(key, 7), scaleChord(key, 6), scaleChord(key, 5, '')],
      palette: [scaleChord(key, 1), scaleChord(key, 3), scaleChord(key, 4), scaleChord(key, 5, ''), scaleChord(key, 6), scaleChord(key, 7)],
    };
  }
  return {
    primary: [scaleChord(key, 1), scaleChord(key, 5), scaleChord(key, 6), scaleChord(key, 4)],
    alternate: [scaleChord(key, 6), scaleChord(key, 4), scaleChord(key, 1), scaleChord(key, 5)],
    palette: [scaleChord(key, 1), scaleChord(key, 2), scaleChord(key, 3), scaleChord(key, 4), scaleChord(key, 5), scaleChord(key, 6)],
  };
}

function chordBass(chord: string) {
  const parsed = parseChord(chord);
  return parsed?.bass || parsed?.root || 'E';
}

function rootPosition(chord: string) {
  return ROOT_POSITIONS[chordBass(chord)] ?? ROOT_POSITIONS.E;
}

function lowestPlayableString(chord: string) {
  return rootPosition(chord).string;
}

function instructionFor(style: SongPracticeStyle, mode: GuitarModeId, index: number) {
  if (style === 'arpeggio') return index % 2 === 0 ? 'P-i-m-i · P-i-m-i' : 'P-i-P-m · P-i-m-i';
  if (style === 'riff') {
    return mode === 'electric'
      ? index % 2 === 0 ? '1 & 2 & 3 & 4 & · 전부 다운 · 팜뮤트' : '1 & 2 & 3 & 4 & · 다운/업 교대 · 마지막 열기'
      : '베이스음 + 짧은 코드 스트럼';
  }
  return index % 2 === 0 ? '1 & 2 & 3 & 4 & · D - D U - U D U' : '1 & 2 & 3 & 4 & · D - D U D U D U';
}

function chordForMode(chord: string, mode: GuitarModeId, style: SongPracticeStyle) {
  if (mode !== 'electric' || style !== 'riff') return chord;
  const parsed = parseChord(chord);
  return parsed ? `${parsed.root}5${parsed.bass ? `/${parsed.bass}` : ''}` : chord;
}

function eventPosition(slot: number) {
  return { beat: Math.floor(slot / 2) + 1, subdivision: (slot % 2 + 1) as 1 | 2 };
}

export function buildSongBarEvents(input: {
  barId: string;
  chord: string;
  beats: number;
  style: SongPracticeStyle;
  guitarMode: GuitarModeId;
  variation?: number;
}): SongBeatEvent[] {
  const totalSlots = Math.max(2, input.beats * 2);
  const root = rootPosition(input.chord);

  if (input.style === 'arpeggio') {
    const pattern = input.variation && input.variation % 2 === 1
      ? [
        { label: 'P', string: root.string }, { label: 'i', string: 3 }, { label: 'P', string: root.string }, { label: 'm', string: 2 },
        { label: 'P', string: root.string }, { label: 'i', string: 3 }, { label: 'm', string: 2 }, { label: 'i', string: 3 },
      ]
      : [
        { label: 'P', string: root.string }, { label: 'i', string: 3 }, { label: 'm', string: 2 }, { label: 'i', string: 3 },
        { label: 'P', string: root.string }, { label: 'i', string: 3 }, { label: 'm', string: 2 }, { label: 'i', string: 3 },
      ];
    return Array.from({ length: totalSlots }, (_, slot) => {
      const patternEvent = pattern[slot % pattern.length];
      return {
        id: `${input.barId}-event-${slot + 1}`, ...eventPosition(slot), kind: 'finger' as const,
        label: patternEvent.label, strings: [patternEvent.string], frets: [], accent: slot === 0,
      };
    });
  }

  if (input.style === 'riff') {
    const relativeFrets = input.variation && input.variation % 2 === 1 ? [0, 0, 3, 2, 0, 5, 3, 2] : [0, 0, 2, 3, 0, 0, 3, 2];
    return Array.from({ length: totalSlots }, (_, slot) => {
      const fret = Math.max(0, root.fret + relativeFrets[slot % relativeFrets.length]);
      return {
        id: `${input.barId}-event-${slot + 1}`, ...eventPosition(slot), kind: 'tab' as const,
        label: `${root.string}번-${fret}프렛`, strings: [root.string], frets: [fret], accent: slot === 0 || slot === totalSlots - 1,
      };
    });
  }

  const pattern = input.variation && input.variation % 2 === 1
    ? ['D', '-', 'D', 'U', 'D', 'U', 'D', 'U']
    : ['D', '-', 'D', 'U', '-', 'U', 'D', 'U'];
  const lowest = lowestPlayableString(input.chord);
  const downStrings = Array.from({ length: lowest }, (_, index) => lowest - index);
  return Array.from({ length: totalSlots }, (_, slot) => {
    const label = pattern[slot % pattern.length];
    return {
      id: `${input.barId}-event-${slot + 1}`, ...eventPosition(slot),
      kind: label === '-' ? 'hold' as const : 'strum' as const,
      label,
      strings: label === 'D' ? downStrings : label === 'U' ? [1, 2, 3] : [],
      frets: [],
      accent: slot === 0 || slot === 4,
    };
  });
}

export function songChordPalette(key: SongKey, mode: GuitarModeId, style: SongPracticeStyle, capo = 0) {
  const safeCapo = normalizeCapo(capo);
  return progressionForKey(key).palette
    .map((chord) => transposeChord(chord, -safeCapo, preferFlatsFor(key)))
    .map((chord) => chordForMode(chord, mode, style));
}

export function generateSongSheetDraft(input: {
  guitarMode: GuitarModeId;
  title: string;
  artist: string;
  key: SongKey;
  capo?: number;
  bpm: number;
  beatsPerBar?: number;
  style: SongPracticeStyle;
  barCount: number;
}): SongSheetDraft {
  const now = new Date().toISOString();
  const safeCapo = normalizeCapo(input.capo);
  const safeBarCount = clamp(Math.round(input.barCount), 4, 32);
  const beatsPerBar = clamp(Math.round(input.beatsPerBar ?? 4), 2, 12);
  const progression = progressionForKey(input.key);
  const bars = Array.from({ length: safeBarCount }, (_, index): SongBar => {
    const chorus = index >= Math.floor(safeBarCount / 2);
    const source = chorus ? progression.alternate : progression.primary;
    const section = index < Math.min(2, safeBarCount) ? 'intro' : chorus ? 'chorus' : 'verse';
    const id = `bar-${index + 1}`;
    const soundingChord = chordForMode(source[index % source.length], input.guitarMode, input.style);
    const chord = transposeChord(soundingChord, -safeCapo, preferFlatsFor(input.key));
    return {
      id, chord, soundingChord, beats: beatsPerBar,
      instruction: instructionFor(input.style, input.guitarMode, index), section,
      events: buildSongBarEvents({ barId: id, chord, beats: beatsPerBar, style: input.style, guitarMode: input.guitarMode, variation: index }),
    };
  });
  return {
    id: `song-${Date.now()}`, guitarMode: input.guitarMode,
    title: input.title.trim() || '제목 없는 연습곡', artist: input.artist.trim(),
    key: input.key, shapeKey: transposeSongKey(input.key, -safeCapo), capo: safeCapo,
    bpm: clamp(Math.round(input.bpm), 35, 220), beatsPerBar, style: input.style,
    bars, notationVersion: 3, source: 'offline-draft', createdAt: now, updatedAt: now,
  };
}

export function replaceSongBarChord(draft: SongSheetDraft, barId: string, chord: string): SongSheetDraft {
  const capo = normalizeCapo(draft.capo);
  return {
    ...draft,
    bars: draft.bars.map((bar, index) => bar.id === barId ? {
      ...bar,
      chord,
      soundingChord: transposeChord(chord, capo, preferFlatsFor(draft.key)),
      events: buildSongBarEvents({ barId: bar.id, chord, beats: bar.beats, style: draft.style, guitarMode: draft.guitarMode, variation: index }),
    } : bar),
    notationVersion: 3,
    updatedAt: new Date().toISOString(),
  };
}

export function setSongSheetCapo(draft: SongSheetDraft, nextCapo: number): SongSheetDraft {
  const oldCapo = normalizeCapo(draft.capo);
  const capo = normalizeCapo(nextCapo);
  return {
    ...draft,
    capo,
    shapeKey: transposeSongKey(draft.key, -capo),
    bars: draft.bars.map((bar, index) => {
      const soundingChord = bar.soundingChord ?? transposeChord(bar.chord, oldCapo, preferFlatsFor(draft.key));
      const chord = transposeChord(soundingChord, -capo, preferFlatsFor(draft.key));
      return {
        ...bar,
        chord,
        soundingChord,
        events: buildSongBarEvents({ barId: bar.id, chord, beats: bar.beats, style: draft.style, guitarMode: draft.guitarMode, variation: index }),
      };
    }),
    notationVersion: 3,
    updatedAt: new Date().toISOString(),
  };
}

export function ensureStructuredSongSheet(draft: SongSheetDraft): SongSheetDraft {
  const capo = normalizeCapo(draft.capo);
  const oldVersion = draft.notationVersion;
  const bars = draft.bars.map((bar, index) => {
    const soundingChord = bar.soundingChord ?? transposeChord(bar.chord, capo, preferFlatsFor(draft.key));
    return {
      ...bar,
      soundingChord,
      events: oldVersion === 3 && bar.events?.length ? bar.events : buildSongBarEvents({
        barId: bar.id, chord: bar.chord, beats: bar.beats, style: draft.style, guitarMode: draft.guitarMode, variation: index,
      }),
    };
  });
  return {
    ...draft,
    capo,
    shapeKey: draft.shapeKey ?? transposeSongKey(draft.key, -capo),
    notationVersion: 3,
    bars,
  };
}

export function eventsAtBeat(bar: SongBar | null | undefined, beat: number) {
  return (bar?.events ?? []).filter((event) => event.beat === beat);
}

export function compactBarNotation(bar: SongBar) {
  const events = bar.events ?? [];
  if (!events.length) return bar.instruction;
  return events.map((event) => event.kind === 'tab' ? `${event.strings[0]}-${event.frets[0]}` : event.label).join(' ');
}

export function nextChordInPalette(draft: SongSheetDraft, currentChord: string) {
  const palette = songChordPalette(draft.key, draft.guitarMode, draft.style, draft.capo);
  const currentIndex = palette.indexOf(currentChord);
  return palette[(currentIndex + 1 + palette.length) % palette.length] ?? currentChord;
}
