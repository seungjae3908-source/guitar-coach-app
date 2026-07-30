import {
  ChordTransitionTracker,
  parseChordTransitionTarget,
} from '../services/chord-transition-engine';
import type { ChordRecognitionResult } from '../services/fretboard-chord-engine';

let checks = 0;
function assert(condition: unknown, message: string) {
  checks += 1;
  if (!condition) throw new Error(message);
}

function confirmed(chordName: string, confidencePercent = 90): ChordRecognitionResult {
  return {
    status: 'confirmed',
    chordName,
    aliases: [],
    score: 90,
    confidencePercent,
    evidence: [],
    positions: [],
    corrections: [],
    positives: [],
    expectedStrings: [0, 0, 0, 0, 0, 0],
  };
}

{
  const target = parseChordTransitionTarget('D→G');
  assert(target?.from === 'D' && target.to === 'G', 'D→G 패턴을 전환 목표로 읽어야 합니다.');
  assert(parseChordTransitionTarget('P i m') == null, '아르페지오 패턴을 코드 전환으로 오해하면 안 됩니다.');
}

{
  const tracker = new ChordTransitionTracker();
  const waiting = tracker.process(confirmed('D'), 'D→G', 1_000);
  const fast = tracker.process(confirmed('G'), 'D→G', 1_420);
  assert(waiting?.status === 'waiting', '첫 코드는 다음 코드 대기 상태여야 합니다.');
  assert(fast?.status === 'success', '420ms의 정확한 D→G는 성공이어야 합니다.');
  assert(fast?.transitionMs === 420, '전환 시간을 실제 확인 시각 차이로 계산해야 합니다.');
}

{
  const tracker = new ChordTransitionTracker();
  tracker.process(confirmed('D'), 'D→G', 2_000);
  const slow = tracker.process(confirmed('G'), 'D→G', 2_980);
  assert(slow?.status === 'correction', '느린 D→G는 교정이어야 합니다.');
  assert(slow?.instruction.includes('한 번에'), '느린 코드 전환에는 동시 착지 방법을 제시해야 합니다.');
}

{
  const tracker = new ChordTransitionTracker();
  tracker.process(confirmed('D'), 'D→G', 3_000);
  const wrong = tracker.process(confirmed('A'), 'D→G', 3_430);
  assert(wrong?.status === 'correction', 'D 다음에 A가 확인되면 잘못된 다음 코드여야 합니다.');
  assert(wrong?.instruction.includes('G'), '잘못된 다음 코드 교정에는 목표 G를 명시해야 합니다.');
}

console.log(`chord-transition quality gate: ${checks} checks passed`);
