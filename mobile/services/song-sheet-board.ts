import {
  buildSongBarEvents,
  ensureStructuredSongSheet,
  replaceSongBarChord,
  setSongSheetCapo,
  songChordPalette,
  type SongBar,
  type SongSheetDraft,
} from './song-sheet-engine';

export type SongBoardMode = 'edit' | 'play';
export type SongBoardPattern = 0 | 1;
export type SongBoardSection = SongBar['section'];

export const SONG_BOARD_SECTIONS: Array<{ id: SongBoardSection; label: string }> = [
  { id: 'intro', label: '인트로' },
  { id: 'verse', label: '벌스' },
  { id: 'chorus', label: '후렴' },
  { id: 'bridge', label: '브리지' },
];

export const SONG_BOARD_METERS = [3, 4] as const;

const MINIMUM_BARS = 4;
const MAXIMUM_BARS = 64;

type BoardBar = SongBar & { patternVariant?: SongBoardPattern };
type BoardDraft = SongSheetDraft & { boardVersion?: 4 };

function nowIso() {
  return new Date().toISOString();
}

function safePattern(value: unknown, fallback: number): SongBoardPattern {
  return value === 0 || value === 1 ? value : fallback % 2 === 0 ? 0 : 1;
}

function withBoardMetadata(draft: SongSheetDraft, bars = draft.bars): SongSheetDraft {
  return {
    ...draft,
    bars,
    updatedAt: nowIso(),
    boardVersion: 4,
  } as BoardDraft;
}

function rebuildBar(
  draft: SongSheetDraft,
  bar: SongBar,
  index: number,
  patternVariant = songBarPattern(bar, index),
): SongBar {
  return {
    ...bar,
    beats: draft.beatsPerBar,
    patternVariant,
    events: buildSongBarEvents({
      barId: bar.id,
      chord: bar.chord,
      beats: draft.beatsPerBar,
      style: draft.style,
      guitarMode: draft.guitarMode,
      variation: patternVariant,
    }),
  } as BoardBar;
}

export function songBarPattern(bar: SongBar | null | undefined, index = 0): SongBoardPattern {
  return safePattern((bar as BoardBar | null | undefined)?.patternVariant, index);
}

export function ensureSongBoard(draft: SongSheetDraft): SongSheetDraft {
  const structured = ensureStructuredSongSheet(draft);
  const bars = structured.bars.map((bar, index) => rebuildBar(
    structured,
    bar,
    index,
    songBarPattern(bar, index),
  ));
  return withBoardMetadata(structured, bars);
}

export function boardChordPalette(draft: SongSheetDraft) {
  return songChordPalette(draft.key, draft.guitarMode, draft.style, draft.capo);
}

export function replaceBoardBarChord(
  draft: SongSheetDraft,
  barId: string,
  chord: string,
): SongSheetDraft {
  const board = ensureSongBoard(draft);
  const patterns = new Map(board.bars.map((bar, index) => [bar.id, songBarPattern(bar, index)]));
  const replaced = replaceSongBarChord(board, barId, chord);
  const bars = replaced.bars.map((bar, index) => rebuildBar(
    replaced,
    bar,
    index,
    patterns.get(bar.id) ?? songBarPattern(bar, index),
  ));
  return withBoardMetadata(replaced, bars);
}

export function replaceBoardBarSection(
  draft: SongSheetDraft,
  barId: string,
  section: SongBoardSection,
): SongSheetDraft {
  const board = ensureSongBoard(draft);
  return withBoardMetadata(board, board.bars.map((bar) => (
    bar.id === barId ? { ...bar, section } : bar
  )));
}

export function replaceBoardBarPattern(
  draft: SongSheetDraft,
  barId: string,
  patternVariant: SongBoardPattern,
): SongSheetDraft {
  const board = ensureSongBoard(draft);
  const bars = board.bars.map((bar, index) => (
    bar.id === barId ? rebuildBar(board, bar, index, patternVariant) : bar
  ));
  return withBoardMetadata(board, bars);
}

function uniqueBarId(draft: SongSheetDraft, sourceId: string) {
  const prefix = `${sourceId}-copy`;
  let suffix = 1;
  let candidate = `${prefix}-${suffix}`;
  const existing = new Set(draft.bars.map((bar) => bar.id));
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `${prefix}-${suffix}`;
  }
  return candidate;
}

export function duplicateBoardBar(draft: SongSheetDraft, index: number): SongSheetDraft {
  const board = ensureSongBoard(draft);
  if (board.bars.length >= MAXIMUM_BARS) return board;
  const safeIndex = Math.max(0, Math.min(board.bars.length - 1, Math.round(index)));
  const source = board.bars[safeIndex];
  if (!source) return board;
  const id = uniqueBarId(board, source.id);
  const clone = rebuildBar(
    board,
    { ...source, id },
    safeIndex + 1,
    songBarPattern(source, safeIndex),
  );
  const bars = [...board.bars];
  bars.splice(safeIndex + 1, 0, clone);
  return withBoardMetadata(board, bars);
}

export function removeBoardBar(draft: SongSheetDraft, index: number): SongSheetDraft {
  const board = ensureSongBoard(draft);
  if (board.bars.length <= MINIMUM_BARS) return board;
  const safeIndex = Math.max(0, Math.min(board.bars.length - 1, Math.round(index)));
  return withBoardMetadata(board, board.bars.filter((_bar, barIndex) => barIndex !== safeIndex));
}

export function moveBoardBar(
  draft: SongSheetDraft,
  index: number,
  direction: -1 | 1,
): SongSheetDraft {
  const board = ensureSongBoard(draft);
  const from = Math.max(0, Math.min(board.bars.length - 1, Math.round(index)));
  const to = from + direction;
  if (to < 0 || to >= board.bars.length) return board;
  const bars = [...board.bars];
  const [moved] = bars.splice(from, 1);
  if (!moved) return board;
  bars.splice(to, 0, moved);
  return withBoardMetadata(board, bars);
}

export function setBoardBeatsPerBar(
  draft: SongSheetDraft,
  beatsPerBar: number,
): SongSheetDraft {
  const board = ensureSongBoard(draft);
  const beats = Math.max(3, Math.min(4, Math.round(beatsPerBar)));
  const next = { ...board, beatsPerBar: beats };
  const bars = board.bars.map((bar, index) => rebuildBar(
    next,
    { ...bar, beats },
    index,
    songBarPattern(bar, index),
  ));
  return withBoardMetadata(next, bars);
}

export function setBoardCapo(draft: SongSheetDraft, capo: number): SongSheetDraft {
  const board = ensureSongBoard(draft);
  const patterns = board.bars.map((bar, index) => songBarPattern(bar, index));
  const changed = setSongSheetCapo(board, capo);
  const bars = changed.bars.map((bar, index) => rebuildBar(
    changed,
    bar,
    index,
    patterns[index] ?? songBarPattern(bar, index),
  ));
  return withBoardMetadata(changed, bars);
}

export function cloneBoardSongProject(draft: SongSheetDraft): SongSheetDraft {
  const board = ensureSongBoard(draft);
  const createdAt = nowIso();
  const id = `song-${Date.now()}`;
  const next: SongSheetDraft = {
    ...board,
    id,
    title: `${board.title} 복사본`,
    createdAt,
    updatedAt: createdAt,
    bars: board.bars.map((bar, index) => {
      const nextId = `bar-${index + 1}-${id}`;
      return rebuildBar(
        board,
        { ...bar, id: nextId },
        index,
        songBarPattern(bar, index),
      );
    }),
  };
  return next;
}

export function clampBoardIndex(draft: SongSheetDraft | null, index: number) {
  if (!draft?.bars.length) return 0;
  return Math.max(0, Math.min(draft.bars.length - 1, Math.round(index)));
}
