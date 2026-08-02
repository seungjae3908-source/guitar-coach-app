"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const song_chord_guides_1 = require("../config/song-chord-guides");
let checks = 0;
function assert(condition, message) { checks += 1; if (!condition)
    throw new Error(message); }
const guide = (0, song_chord_guides_1.getSongChordGuide)('acoustic-stand-by-me', 'verse', 'acoustic');
assert(guide.chords.join('-') === 'G-Em-C-D', '카포 기준 연주 폼 코드를 반환해야 합니다.');
assert(guide.capo === 2, '추천 카포를 반환해야 합니다.');
assert(guide.soundingChords.join('-') === 'A-F#m-D-E', '카포 적용 후 실제 울림 코드를 반환해야 합니다.');
assert((0, song_chord_guides_1.chordAtSectionProgress)(guide.chords, 0, guide.beatWeights).current === 'G', '구간 시작 코드를 반환해야 합니다.');
assert((0, song_chord_guides_1.chordAtSectionProgress)(guide.chords, 0.3, guide.beatWeights).current === 'Em', '진행률과 박 길이에 맞는 현재 코드를 반환해야 합니다.');
assert((0, song_chord_guides_1.chordAtSectionProgress)(guide.chords, 0.99, guide.beatWeights).next === 'G', '마지막 코드 다음은 반복 첫 코드여야 합니다.');
assert((0, song_chord_guides_1.getSongChordGuide)('unknown', 'verse', 'electric').chords[0] === 'E5', '미등록곡도 모드별 안전한 연습 진행이 있어야 합니다.');
const noCapo = (0, song_chord_guides_1.getSongChordGuide)('acoustic-stand-by-me', 'verse', 'acoustic', 0);
assert(noCapo.soundingChords[0] === 'G', '사용자가 카포를 바꾸면 실제 울림도 즉시 다시 계산해야 합니다.');
assert(guide.strumPattern.includes('1 & 2 & 3 & 4 &'), '스트럼을 박·앤드 단위로 표시해야 합니다.');
console.log(`Song chord guide tests passed: ${checks}`);
