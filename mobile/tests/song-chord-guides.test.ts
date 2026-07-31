import { chordAtSectionProgress, getSongChordGuide } from '../config/song-chord-guides';

let checks = 0;
function assert(condition: unknown, message: string) {
  checks += 1;
  if (!condition) throw new Error(message);
}

const guide = getSongChordGuide('acoustic-stand-by-me', 'verse', 'acoustic');
assert(guide.chords.join('-') === 'A-F#m-D-E', '등록곡의 구간 코드 진행을 반환해야 합니다.');
assert(chordAtSectionProgress(guide.chords, 0).current === 'A', '구간 시작 코드를 반환해야 합니다.');
assert(chordAtSectionProgress(guide.chords, 0.3).current === 'F#m', '진행률에 맞는 현재 코드를 반환해야 합니다.');
assert(chordAtSectionProgress(guide.chords, 0.99).next === 'A', '마지막 코드 다음은 반복 첫 코드여야 합니다.');
assert(getSongChordGuide('unknown', 'verse', 'electric').chords[0] === 'E5', '미등록곡도 모드별 안전한 연습 진행이 있어야 합니다.');

console.log(`Song chord guide tests passed: ${checks}`);
