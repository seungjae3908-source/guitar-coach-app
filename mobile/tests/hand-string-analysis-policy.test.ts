import { shouldRefreshStringVision } from '../services/hand-string-analysis-policy';

let checks = 0;

function assert(condition: unknown, message: string) {
  checks += 1;
  if (!condition) throw new Error(message);
}

assert(
  shouldRefreshStringVision({ requested: true, cachedAt: null, now: 2_000, reuseMs: 1_250 }),
  '명시적 새로고침 프레임은 기타 줄 캐시가 없어도 실행해야 합니다.',
);
assert(
  !shouldRefreshStringVision({ requested: false, cachedAt: null, now: 2_000, reuseMs: 1_250 }),
  '손 단독 프레임은 기타가 없어 캐시가 비어 있어도 줄 분석을 강제로 실행하면 안 됩니다.',
);
assert(
  shouldRefreshStringVision({ cachedAt: null, now: 2_000, reuseMs: 1_250 }),
  '자동 정책에서 캐시가 없으면 줄 분석을 한 번 시도해야 합니다.',
);
assert(
  !shouldRefreshStringVision({ cachedAt: 1_300, now: 2_000, reuseMs: 1_250 }),
  '신선한 줄 캐시는 재사용해야 합니다.',
);
assert(
  shouldRefreshStringVision({ cachedAt: 600, now: 2_000, reuseMs: 1_250 }),
  '오래된 줄 캐시는 갱신해야 합니다.',
);

console.log(`hand/string analysis policy tests passed: ${checks}`);
