"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const feedback_stack_core_1 = require("../services/feedback-stack-core");
function assert(condition, message) {
    if (!condition)
        throw new Error(`품질 게이트 실패: ${message}`);
}
function item(id, capturedAt, status, priority, confidencePercent = 80) {
    return { id, capturedAt, status, priority, confidencePercent };
}
let checks = 0;
function check(condition, message) {
    checks += 1;
    assert(condition, message);
}
let stack = [];
stack = (0, feedback_stack_core_1.mergeFeedbackStack)(stack, item('wrist-angle', 1_000, 'correction', 8));
stack = (0, feedback_stack_core_1.mergeFeedbackStack)(stack, item('pick-depth', 1_100, 'warning', 10));
stack = (0, feedback_stack_core_1.mergeFeedbackStack)(stack, item('attack-jitter', 1_200, 'correction', 9));
check(stack.length === 3, '손목·피크·리듬 피드백이 동시에 유지돼야 합니다.');
check(stack[0]?.id === 'pick-depth', '경고가 교정보다 먼저 표시돼야 합니다.');
check(stack.some((entry) => entry.id === 'wrist-angle'), '손목 피드백이 다른 판정에 덮어써지면 안 됩니다.');
stack = (0, feedback_stack_core_1.mergeFeedbackStack)(stack, item('wrist-angle', 1_400, 'correction', 11, 92));
const updatedWrist = stack.find((entry) => entry.id === 'wrist-angle');
check(stack.filter((entry) => entry.id === 'wrist-angle').length === 1, '같은 문제는 중복 카드로 쌓이면 안 됩니다.');
check(stack[0]?.id === 'pick-depth', '경고 우선 정책은 높은 교정 우선순위보다 앞서야 합니다.');
check(stack[1]?.id === 'wrist-angle', '같은 상태 안에서는 높은 우선순위 교정이 먼저 와야 합니다.');
check(updatedWrist?.confidencePercent === 92, '같은 문제의 최신 측정값이 반영돼야 합니다.');
stack = (0, feedback_stack_core_1.mergeFeedbackStack)(stack, item('stable-picking', 1_500, 'success', 2));
check(stack.some((entry) => entry.id === 'stable-picking'), '교정 중에도 최근에 잘한 동작 한 가지는 보여줘야 합니다.');
check(stack[0]?.status !== 'success', '성공 메시지가 가장 중요한 교정 항목을 가리면 안 됩니다.');
check(stack.at(-1)?.status === 'success', '성공 피드백은 교정 뒤의 보조 항목으로 표시돼야 합니다.');
const prunedEarly = (0, feedback_stack_core_1.pruneFeedbackStack)(stack, 5_000);
check(prunedEarly.length === 4, 'TTL 안의 세 문제와 한 성공 피드백은 함께 유지돼야 합니다.');
const prunedLate = (0, feedback_stack_core_1.pruneFeedbackStack)(stack, 11_000);
check(prunedLate.length === 0, 'TTL이 지난 피드백은 남아 있으면 안 됩니다.');
let capped = [];
for (let index = 0; index < 10; index += 1) {
    capped = (0, feedback_stack_core_1.mergeFeedbackStack)(capped, item(`issue-${index}`, 20_000 + index, 'correction', index));
}
check(capped.length === 6, '동시 표시 항목은 최대 6개로 제한돼야 합니다.');
check(capped[0]?.id === 'issue-9', '제한 시 높은 우선순위 항목이 보존돼야 합니다.');
check(!capped.some((entry) => entry.id === 'issue-0'), '낮은 우선순위 항목부터 제거돼야 합니다.');
capped = (0, feedback_stack_core_1.mergeFeedbackStack)(capped, item('good-axis', 20_100, 'success', 4, 90));
check(capped.length === 6, '성공 피드백을 추가해도 최대 표시 수를 넘으면 안 됩니다.');
check(capped.some((entry) => entry.id === 'good-axis'), '문제가 많아도 잘한 점 한 항목을 위한 슬롯을 보존해야 합니다.');
check(capped.filter((entry) => entry.status === 'correction').length === 5, '성공 한 항목과 가장 중요한 교정 다섯 항목을 유지해야 합니다.');
let successOnly = [];
successOnly = (0, feedback_stack_core_1.mergeFeedbackStack)(successOnly, item('stable', 30_000, 'success', 2));
successOnly = (0, feedback_stack_core_1.mergeFeedbackStack)(successOnly, item('even-tone', 30_100, 'success', 3));
check(successOnly.length === 2 && successOnly.every((entry) => entry.status === 'success'), '문제가 없을 때는 여러 성공 피드백을 표시할 수 있어야 합니다.');
console.log(`feedback-stack quality gate: ${checks} checks passed`);
