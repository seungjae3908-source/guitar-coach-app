"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSongBarEvents = buildSongBarEvents;
exports.songChordPalette = songChordPalette;
exports.generateSongSheetDraft = generateSongSheetDraft;
exports.replaceSongBarChord = replaceSongBarChord;
exports.ensureStructuredSongSheet = ensureStructuredSongSheet;
exports.eventsAtBeat = eventsAtBeat;
exports.compactBarNotation = compactBarNotation;
exports.nextChordInPalette = nextChordInPalette;
const PROGRESSIONS = {
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
const ROOT_POSITIONS = {
    E: { string: 6, fret: 0 },
    F: { string: 6, fret: 1 },
    'F#': { string: 6, fret: 2 },
    Gb: { string: 6, fret: 2 },
    G: { string: 6, fret: 3 },
    'G#': { string: 6, fret: 4 },
    Ab: { string: 6, fret: 4 },
    A: { string: 5, fret: 0 },
    'A#': { string: 5, fret: 1 },
    Bb: { string: 5, fret: 1 },
    B: { string: 5, fret: 2 },
    C: { string: 5, fret: 3 },
    'C#': { string: 5, fret: 4 },
    Db: { string: 5, fret: 4 },
    D: { string: 5, fret: 5 },
    'D#': { string: 5, fret: 6 },
    Eb: { string: 5, fret: 6 },
};
function chordRoot(chord) {
    const match = chord.match(/^[A-G](?:#|b)?/);
    return match?.[0] ?? 'E';
}
function rootPosition(chord) {
    return ROOT_POSITIONS[chordRoot(chord)] ?? ROOT_POSITIONS.E;
}
function instructionFor(style, mode, index) {
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
function chordForMode(chord, mode, style) {
    if (mode !== 'electric' || style !== 'riff')
        return chord;
    if (chord.endsWith('m'))
        return `${chord.slice(0, -1)}5`;
    if (chord.endsWith('7'))
        return `${chord.replace('7', '')}5`;
    return chord.includes('#') || chord.includes('b') ? `${chord}5` : `${chord}5`;
}
function eventPosition(slot) {
    return {
        beat: Math.floor(slot / 2) + 1,
        subdivision: (slot % 2 + 1),
    };
}
function buildSongBarEvents(input) {
    const totalSlots = Math.max(2, input.beats * 2);
    const root = rootPosition(input.chord);
    if (input.style === 'arpeggio') {
        const pattern = input.variation && input.variation % 2 === 1
            ? [
                { label: 'P', string: root.string },
                { label: 'i', string: 3 },
                { label: 'P', string: root.string },
                { label: 'm', string: 2 },
                { label: 'P', string: root.string },
                { label: 'i', string: 3 },
                { label: 'm', string: 2 },
                { label: 'i', string: 3 },
            ]
            : [
                { label: 'P', string: root.string },
                { label: 'i', string: 3 },
                { label: 'm', string: 2 },
                { label: 'i', string: 3 },
                { label: 'P', string: root.string },
                { label: 'i', string: 3 },
                { label: 'm', string: 2 },
                { label: 'i', string: 3 },
            ];
        return Array.from({ length: totalSlots }, (_, slot) => {
            const patternEvent = pattern[slot % pattern.length];
            return {
                id: `${input.barId}-event-${slot + 1}`,
                ...eventPosition(slot),
                kind: 'finger',
                label: patternEvent.label,
                strings: [patternEvent.string],
                frets: [],
                accent: slot === 0,
            };
        });
    }
    if (input.style === 'riff') {
        const relativeFrets = input.variation && input.variation % 2 === 1
            ? [0, 0, 3, 2, 0, 5, 3, 2]
            : [0, 0, 2, 3, 0, 0, 3, 2];
        return Array.from({ length: totalSlots }, (_, slot) => {
            const relative = relativeFrets[slot % relativeFrets.length];
            const fret = Math.max(0, root.fret + relative);
            return {
                id: `${input.barId}-event-${slot + 1}`,
                ...eventPosition(slot),
                kind: 'tab',
                label: `${root.string}번-${fret}프렛`,
                strings: [root.string],
                frets: [fret],
                accent: slot === 0 || slot === totalSlots - 1,
            };
        });
    }
    const pattern = input.variation && input.variation % 2 === 1
        ? ['D', '-', 'D', 'U', 'D', 'U', 'D', 'U']
        : ['D', '-', 'D', 'U', '-', 'U', 'D', 'U'];
    return Array.from({ length: totalSlots }, (_, slot) => {
        const label = pattern[slot % pattern.length];
        const down = label === 'D';
        const up = label === 'U';
        return {
            id: `${input.barId}-event-${slot + 1}`,
            ...eventPosition(slot),
            kind: label === '-' ? 'hold' : 'strum',
            label,
            strings: down ? [6, 5, 4, 3, 2, 1] : up ? [1, 2, 3] : [],
            frets: [],
            accent: slot === 0,
        };
    });
}
function songChordPalette(key, mode, style) {
    return PROGRESSIONS[key].palette.map((chord) => chordForMode(chord, mode, style));
}
function generateSongSheetDraft(input) {
    const now = new Date().toISOString();
    const safeBarCount = Math.min(32, Math.max(4, Math.round(input.barCount)));
    const beatsPerBar = Math.min(12, Math.max(2, Math.round(input.beatsPerBar ?? 4)));
    const progression = PROGRESSIONS[input.key];
    const bars = Array.from({ length: safeBarCount }, (_, index) => {
        const chorus = index >= Math.floor(safeBarCount / 2);
        const source = chorus ? progression.alternate : progression.primary;
        const section = index < Math.min(2, safeBarCount)
            ? 'intro'
            : chorus
                ? 'chorus'
                : 'verse';
        const id = `bar-${index + 1}`;
        const chord = chordForMode(source[index % source.length], input.guitarMode, input.style);
        return {
            id,
            chord,
            beats: beatsPerBar,
            instruction: instructionFor(input.style, input.guitarMode, index),
            section,
            events: buildSongBarEvents({
                barId: id,
                chord,
                beats: beatsPerBar,
                style: input.style,
                guitarMode: input.guitarMode,
                variation: index,
            }),
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
        notationVersion: 2,
        source: 'offline-draft',
        createdAt: now,
        updatedAt: now,
    };
}
function replaceSongBarChord(draft, barId, chord) {
    return {
        ...draft,
        bars: draft.bars.map((bar, index) => bar.id === barId ? {
            ...bar,
            chord,
            events: buildSongBarEvents({
                barId: bar.id,
                chord,
                beats: bar.beats,
                style: draft.style,
                guitarMode: draft.guitarMode,
                variation: index,
            }),
        } : bar),
        notationVersion: 2,
        updatedAt: new Date().toISOString(),
    };
}
function ensureStructuredSongSheet(draft) {
    if (draft.notationVersion === 2 && draft.bars.every((bar) => bar.events?.length))
        return draft;
    return {
        ...draft,
        notationVersion: 2,
        bars: draft.bars.map((bar, index) => ({
            ...bar,
            events: buildSongBarEvents({
                barId: bar.id,
                chord: bar.chord,
                beats: bar.beats,
                style: draft.style,
                guitarMode: draft.guitarMode,
                variation: index,
            }),
        })),
    };
}
function eventsAtBeat(bar, beat) {
    return (bar?.events ?? []).filter((event) => event.beat === beat);
}
function compactBarNotation(bar) {
    const events = bar.events ?? [];
    if (!events.length)
        return bar.instruction;
    return events.map((event) => event.kind === 'tab'
        ? `${event.strings[0]}-${event.frets[0]}`
        : event.label).join(' ');
}
function nextChordInPalette(draft, currentChord) {
    const palette = songChordPalette(draft.key, draft.guitarMode, draft.style);
    const currentIndex = palette.indexOf(currentChord);
    return palette[(currentIndex + 1 + palette.length) % palette.length] ?? currentChord;
}
