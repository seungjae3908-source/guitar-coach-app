"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const song_sheet_engine_1 = require("../services/song-sheet-engine");
function assert(condition, message) {
    if (!condition)
        throw new Error(`악보 품질 게이트 실패: ${message}`);
}
const strum = (0, song_sheet_engine_1.generateSongSheetDraft)({
    guitarMode: 'acoustic',
    title: '스트럼 테스트',
    artist: '',
    key: 'G',
    bpm: 80,
    beatsPerBar: 4,
    style: 'strum',
    barCount: 4,
});
const firstStrumBar = strum.bars[0];
assert(firstStrumBar?.events?.length === 8, '4박 마디에는 8분음표 이벤트 8개가 있어야 합니다.');
assert(firstStrumBar.events[0]?.label === 'D', '첫 이벤트는 다운 스트럼이어야 합니다.');
assert(firstStrumBar.events.some((event) => event.label === 'U' && event.strings.join(',') === '1,2,3'), '업 스트럼은 고음 1~3번 줄 목표를 가져야 합니다.');
assert(firstStrumBar.events.some((event) => event.kind === 'hold'), '쉼·유지 위치를 별도 이벤트로 저장해야 합니다.');
const arpeggio = (0, song_sheet_engine_1.generateSongSheetDraft)({
    guitarMode: 'acoustic',
    title: '아르페지오 테스트',
    artist: '',
    key: 'C',
    bpm: 70,
    style: 'arpeggio',
    barCount: 4,
});
const arpEvents = arpeggio.bars[0]?.events ?? [];
assert(arpEvents.length === 8, '아르페지오 마디에도 8개 이벤트가 있어야 합니다.');
assert(arpEvents[0]?.label === 'P' && arpEvents[0]?.strings.length === 1, '첫 베이스음은 P와 실제 목표 줄을 가져야 합니다.');
assert(arpEvents.some((event) => event.label === 'i') && arpEvents.some((event) => event.label === 'm'), 'i와 m 손가락 이벤트가 모두 있어야 합니다.');
const riff = (0, song_sheet_engine_1.generateSongSheetDraft)({
    guitarMode: 'electric',
    title: '리프 테스트',
    artist: '',
    key: 'E',
    bpm: 100,
    style: 'riff',
    barCount: 4,
});
const riffEvents = riff.bars[0]?.events ?? [];
assert(riffEvents.every((event) => event.kind === 'tab'), '리프 악보 이벤트는 TAB 형식이어야 합니다.');
assert(riffEvents.every((event) => event.strings.length === 1 && event.frets.length === 1), '각 TAB 이벤트는 줄과 프렛을 하나씩 가져야 합니다.');
const beforeNotation = (0, song_sheet_engine_1.compactBarNotation)(strum.bars[0]);
const replaced = (0, song_sheet_engine_1.replaceSongBarChord)(strum, strum.bars[0].id, 'C');
const afterNotation = (0, song_sheet_engine_1.compactBarNotation)(replaced.bars[0]);
assert(replaced.bars[0]?.chord === 'C', '선택한 코드로 마디가 변경돼야 합니다.');
assert(replaced.bars[0]?.events?.length === 8, '코드 변경 후에도 구조 이벤트가 유지돼야 합니다.');
assert(beforeNotation.length > 0 && afterNotation.length > 0, '마디 축약 악보를 표시할 수 있어야 합니다.');
const legacy = {
    ...strum,
    notationVersion: undefined,
    bars: strum.bars.map(({ events: _events, ...bar }) => bar),
};
const upgraded = (0, song_sheet_engine_1.ensureStructuredSongSheet)(legacy);
assert(upgraded.notationVersion === 2, '기존 저장 악보를 V2로 변환해야 합니다.');
assert(upgraded.bars.every((bar) => bar.events?.length === 8), '기존 모든 마디에 구조 이벤트를 복원해야 합니다.');
console.log('song-sheet quality gate: 13 checks passed');
