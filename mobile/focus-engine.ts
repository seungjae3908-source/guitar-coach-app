export type FocusMode = '코드' | '핑거링' | '아르페지오' | '스트럼' | '피킹';

export type FocusDrill = {
  title: string;
  pattern: string;
  instruction: string;
  subdivision: number;
  defaultBpm: number;
};

export type FocusSessionMetrics = {
  overallScore: number;
  timingScore: number;
  consistencyScore: number;
  volumeScore: number;
  activityScore: number;
  detectedHits: number;
  expectedHits: number;
  averageTimingErrorMs: number;
  averageLevel: number;
};

export type FocusSession = {
  id: string;
  createdAt: string;
  mode: FocusMode;
  bpm: number;
  durationSeconds: number;
  metrics: FocusSessionMetrics;
  feedback: string[];
  analysisKind: 'device-rule-engine-v1';
};

export const FOCUS_DRILLS: Record<FocusMode, FocusDrill> = {
  코드: {
    title: '코드 전환 박자 훈련',
    pattern: 'G  ·  D  ·  Em  ·  C',
    instruction: '한 박마다 코드를 바꾸고 첫 음이 뭉개지지 않게 눌러 주세요.',
    subdivision: 1,
    defaultBpm: 60,
  },
  핑거링: {
    title: '1-2-3-4 독립 훈련',
    pattern: '1  ·  2  ·  3  ·  4',
    instruction: '손가락을 높이 들지 말고 두 번의 입력을 한 박 안에 고르게 배치하세요.',
    subdivision: 2,
    defaultBpm: 55,
  },
  아르페지오: {
    title: '검지 복귀 집중 훈련',
    pattern: 'P  ·  I  ·  P  ·  M',
    instruction: '엄지는 일정하게, 검지는 앞으로 밀지 말고 관절을 접어 복귀하세요.',
    subdivision: 2,
    defaultBpm: 60,
  },
  스트럼: {
    title: '다운·업 균형 훈련',
    pattern: '↓  ·  ↓↑  ·  ↑↓↑',
    instruction: '업스트로크에서 피크를 깊게 넣지 말고 손목 힘을 유지하지 마세요.',
    subdivision: 2,
    defaultBpm: 70,
  },
  피킹: {
    title: '얼터네이트 피킹 훈련',
    pattern: 'D  ·  U  ·  D  ·  U',
    instruction: '줄을 통과하는 깊이를 일정하게 하고 다운·업 음량을 맞추세요.',
    subdivision: 2,
    defaultBpm: 65,
  },
};

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function nearestGridError(timeMs: number, intervalMs: number) {
  if (intervalMs <= 0) return 0;
  const nearest = Math.round(timeMs / intervalMs) * intervalMs;
  return Math.abs(timeMs - nearest);
}

export function analyzeFocusSession(input: {
  mode: FocusMode;
  bpm: number;
  durationSeconds: number;
  hitTimesMs: number[];
  hitLevels: number[];
}): { metrics: FocusSessionMetrics; feedback: string[] } {
  const drill = FOCUS_DRILLS[input.mode];
  const expectedIntervalMs = 60000 / (input.bpm * drill.subdivision);
  const expectedHits = Math.max(1, Math.round((input.durationSeconds * 1000) / expectedIntervalMs));
  const detectedHits = input.hitTimesMs.length;

  const timingErrors = input.hitTimesMs.map((time) => nearestGridError(time, expectedIntervalMs));
  const averageTimingErrorMs = Math.round(average(timingErrors));
  const timingScore = clamp(100 - (averageTimingErrorMs / Math.max(80, expectedIntervalMs * 0.42)) * 100);

  const intervals = input.hitTimesMs.slice(1).map((time, index) => time - input.hitTimesMs[index]);
  const intervalDeviation = standardDeviation(intervals);
  const consistencyScore = intervals.length < 2
    ? 0
    : clamp(100 - (intervalDeviation / Math.max(80, expectedIntervalMs * 0.38)) * 100);

  const averageLevel = average(input.hitLevels);
  const levelDeviation = standardDeviation(input.hitLevels);
  const volumeScore = input.hitLevels.length < 2
    ? 0
    : clamp(100 - (levelDeviation / Math.max(0.08, averageLevel * 0.8)) * 100);

  const activityRatio = detectedHits / expectedHits;
  const activityScore = clamp(100 - Math.abs(1 - activityRatio) * 115);

  const dataWeight = clamp(detectedHits / Math.max(6, expectedHits * 0.25), 0, 1);
  const rawOverall = timingScore * 0.42 + consistencyScore * 0.25 + volumeScore * 0.18 + activityScore * 0.15;
  const overallScore = Math.round(clamp(rawOverall * dataWeight));

  const metrics: FocusSessionMetrics = {
    overallScore,
    timingScore: Math.round(timingScore),
    consistencyScore: Math.round(consistencyScore),
    volumeScore: Math.round(volumeScore),
    activityScore: Math.round(activityScore),
    detectedHits,
    expectedHits,
    averageTimingErrorMs,
    averageLevel: Math.round(averageLevel * 100),
  };

  const feedback: string[] = [];
  if (detectedHits < Math.max(4, expectedHits * 0.25)) {
    feedback.push('입력이 충분히 감지되지 않았어요. 휴대폰을 기타에 조금 더 가까이 두거나 마이크 감도를 높여 보세요.');
  } else {
    if (timingScore < 62) feedback.push(`박자 오차가 평균 ${averageTimingErrorMs}ms예요. BPM을 5~10 낮추고 클릭 직후가 아니라 클릭과 동시에 소리 내는 데 집중하세요.`);
    if (consistencyScore < 62) feedback.push('연주 간격이 흔들려요. 한 번 빠르게 치기보다 같은 간격을 8회 연속 유지하세요.');
    if (volumeScore < 58) feedback.push('음량 차이가 커요. 손가락이나 피크가 줄 안으로 들어가는 깊이를 일정하게 맞추세요.');
    if (activityScore < 55) feedback.push(detectedHits < expectedHits ? '몇 번의 입력이 빠졌어요. 동작을 작게 줄이고 다음 타격을 미리 준비하세요.' : '목표 박자 사이에 추가 소리가 감지됐어요. 불필요한 줄 접촉과 잡음을 줄여 보세요.');
  }

  if (feedback.length === 0) {
    feedback.push('박자와 음량이 안정적이에요. 같은 정확도를 유지한 채 BPM을 5 올려도 됩니다.');
  }

  const modeTip: Record<FocusMode, string> = {
    코드: '코드 전환 직전 손가락을 한꺼번에 들지 말고 공통 손가락과 기준 손가락을 먼저 찾으세요.',
    핑거링: '누르지 않는 손가락도 지판 가까이에 두고 손목을 꺾어 속도를 만들지 마세요.',
    아르페지오: '검지가 줄을 친 뒤 앞으로 뻗지 않게 첫 관절을 접어 손바닥 쪽으로 바로 복귀하세요.',
    스트럼: '업스트로크는 다운과 같은 깊이로 파고들지 말고 줄 표면을 스치듯 통과하세요.',
    피킹: '피크 끝이 줄 안으로 2~3mm 이상 들어가지 않도록 노출 길이를 고정하세요.',
  };
  feedback.push(modeTip[input.mode]);

  return { metrics, feedback: feedback.slice(0, 2) };
}
