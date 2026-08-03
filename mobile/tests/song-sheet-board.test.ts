import {
  boardChordPalette,
  cloneBoardSongProject,
  duplicateBoardBar,
  ensureSongBoard,
  moveBoardBar,
  removeBoardBar,
  replaceBoardBarChord,
  replaceBoardBarPattern,
  replaceBoardBarSection,
  setBoardBeatsPerBar,
  setBoardCapo,
  songBarPattern,
} from '../services/song-sheet-board';
import { compactBarNotation, generateSongSheetDraft } from '../services/song-sheet-engine';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`악보판 V4 품질 게이트 실패: ${message}`);
}

const source = generateSongSheetDraft({
  guitarMode: 'acoustic',
  title: '악보판 테스트',
  artist: '',
  key: 'G',
  capo: 0,
  bpm: 80,
  beatsPerBar: 4,
  style: 'strum',
  barCount: 4,
});

const board = ensureSongBoard(source);
assert(songBarPattern(board.bars[0], 0) === 0, '첫 마디는 패턴 A여야 합니다.');
assert(songBarPattern(board.bars[1], 1) === 1, '두 번째 마디는 패턴 B여야 합니다.');

const patternChanged = replaceBoardBarPattern(board, board.bars[0].id, 1);
assert(songBarPattern(patternChanged.bars[0], 0) === 1, '선택 마디 패턴을 B로 바꿔야 합니다.');
assert(compactBarNotation(patternChanged.bars[0]) !== compactBarNotation(board.bars[0]), '패턴 변경은 실제 박 이벤트를 다시 만들어야 합니다.');

const sectionChanged = replaceBoardBarSection(patternChanged, patternChanged.bars[0].id, 'bridge');
assert(sectionChanged.bars[0].section === 'bridge', '선택 마디 구간을 브리지로 바꿔야 합니다.');

const palette = boardChordPalette(sectionChanged);
assert(palette.length >= 4, '명시적인 코드 팔레트를 제공해야 합니다.');
const chordChanged = replaceBoardBarChord(sectionChanged, sectionChanged.bars[0].id, palette[1]);
assert(chordChanged.bars[0].chord === palette[1], '선택한 팔레트 코드가 적용돼야 합니다.');
assert(songBarPattern(chordChanged.bars[0], 0) === 1, '코드 변경 뒤에도 선택 패턴을 유지해야 합니다.');

const duplicated = duplicateBoardBar(chordChanged, 0);
assert(duplicated.bars.length === 5, '선택 마디 복제 시 한 마디가 늘어야 합니다.');
assert(duplicated.bars[0].id !== duplicated.bars[1].id, '복제 마디 ID는 원본과 달라야 합니다.');
assert(duplicated.bars[0].events?.[0].id !== duplicated.bars[1].events?.[0].id, '복제 이벤트 ID도 원본과 달라야 합니다.');

const moved = moveBoardBar(duplicated, 1, 1);
assert(moved.bars[2].id === duplicated.bars[1].id, '선택 마디를 오른쪽으로 이동해야 합니다.');

const removed = removeBoardBar(moved, 2);
assert(removed.bars.length === 4, '선택 마디 삭제 시 최소 4마디까지 줄어야 합니다.');
const minimumProtected = removeBoardBar(removed, 0);
assert(minimumProtected.bars.length === 4, '4마디 아래로는 삭제하지 않아야 합니다.');

const tripleMeter = setBoardBeatsPerBar(removed, 3);
assert(tripleMeter.beatsPerBar === 3, '3/4 악보로 전환해야 합니다.');
assert(tripleMeter.bars.every((bar) => bar.beats === 3 && bar.events?.length === 6), '3/4 각 마디는 8분 이벤트 6개를 가져야 합니다.');

const patternBeforeCapo = songBarPattern(tripleMeter.bars[0], 0);
const capoChanged = setBoardCapo(tripleMeter, 2);
assert(capoChanged.capo === 2, '카포 값을 악보판에 적용해야 합니다.');
assert(songBarPattern(capoChanged.bars[0], 0) === patternBeforeCapo, '카포 변경 뒤에도 마디 패턴을 보존해야 합니다.');

const cloned = cloneBoardSongProject(capoChanged);
assert(cloned.id !== capoChanged.id, '악보 복사본은 새 곡 ID를 가져야 합니다.');
assert(cloned.bars.every((bar, index) => bar.id !== capoChanged.bars[index]?.id), '복사본의 모든 마디 ID를 새로 만들어야 합니다.');
assert(cloned.bars.every((bar, index) => bar.events?.[0].id !== capoChanged.bars[index]?.events?.[0].id), '복사본의 이벤트 ID도 새로 만들어야 합니다.');

console.log('song-sheet board V4 quality gate passed');
