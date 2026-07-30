import {
  mergeFeedbackStack,
  pruneFeedbackStack,
  type FeedbackStackEntry,
} from '../services/feedback-stack-core';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`품질 게이트 실패: ${message}`);
}

function item(
  id: string,
  capturedAt: number,
  status: FeedbackStackEntry['status'],
  priority: number,
  confidencePercent = 80,
): FeedbackStackEntry {
  return { id, capturedAt, status, priority, confidencePercent };
}

let stack: FeedbackStackEntry[] = [];
stack = mergeFeedbackStack(stack, item('wrist-angle', 1_000, 'correction', 8));
stack = mergeFeedbackStack(stack, item('pick-depth', 1_100, 'warning', 10));
stack = mergeFeedbackStack(stack, item('attack-jitter', 1_200, 'correction', 9));

assert(stack.length === 3, '손목·피크·리듬 피드백이 동시에 유지돼야 합니다.');
assert(stack[0]?.id === 'pick-depth', '경고가 교정보다 먼저 표시돼야 합니다.');
assert(stack.some((entry) => entry.id === 'wrist-angle'), '손목 피드백이 다른 판정에 덮어써지면 안 됩니다.');

stack = mergeFeedbackStack(stack, item('wrist-angle', 1_400, 'correction', 11, 92));
assert(stack.filter((entry) => entry.id === 'wrist-angle').length === 1, '같은 문제는 중복 카드로 쌓이면 안 됩니다.');
assert(stack[0]?.id === 'wrist-angle', '갱신된 높은 우선순위 교정이 최상단에 와야 합니다.');
assert(stack[0]?.confidencePercent === 92, '같은 문제의 최신 측정값이 반영돼야 합니다.');

stack = mergeFeedbackStack(stack, item('stable-picking', 1_500, 'success', 2));
assert(!stack.some((entry) => entry.status === 'success'), '해결되지 않은 문제가 있으면 성공 메시지가 문제를 가리면 안 됩니다.');

const prunedEarly = pruneFeedbackStack(stack, 5_000);
assert(prunedEarly.length === 3, 'TTL 안의 동시 피드백은 유지돼야 합니다.');

const prunedLate = pruneFeedbackStack(stack, 11_000);
assert(prunedLate.length === 0, 'TTL이 지난 피드백은 남아 있으면 안 됩니다.');

let capped: FeedbackStackEntry[] = [];
for (let index = 0; index < 10; index += 1) {
  capped = mergeFeedbackStack(capped, item(`issue-${index}`, 20_000 + index, 'correction', index));
}
assert(capped.length === 6, '동시 표시 항목은 최대 6개로 제한돼야 합니다.');
assert(capped[0]?.id === 'issue-9', '제한 시 높은 우선순위 항목이 보존돼야 합니다.');
assert(!capped.some((entry) => entry.id === 'issue-0'), '낮은 우선순위 항목부터 제거돼야 합니다.');

let successOnly: FeedbackStackEntry[] = [];
successOnly = mergeFeedbackStack(successOnly, item('stable', 30_000, 'success', 2));
assert(successOnly.length === 1 && successOnly[0]?.status === 'success', '문제가 없을 때는 성공 피드백을 표시해야 합니다.');

console.log('feedback-stack quality gate: 8 checks passed');
