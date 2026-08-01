"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.feedbackTtlMs = feedbackTtlMs;
exports.isFeedbackActive = isFeedbackActive;
exports.sortFeedbackStack = sortFeedbackStack;
exports.mergeFeedbackStack = mergeFeedbackStack;
exports.pruneFeedbackStack = pruneFeedbackStack;
const DEFAULT_OPTIONS = {
    maxItems: 6,
    warningTtlMs: 9_000,
    correctionTtlMs: 8_000,
    cannotJudgeTtlMs: 5_000,
    successTtlMs: 3_500,
};
function statusRank(status) {
    if (status === 'warning')
        return 5;
    if (status === 'correction')
        return 4;
    if (status === 'cannot-judge')
        return 3;
    if (status === 'success')
        return 2;
    return 1;
}
function feedbackTtlMs(status, options = {}) {
    const resolved = { ...DEFAULT_OPTIONS, ...options };
    if (status === 'warning')
        return resolved.warningTtlMs;
    if (status === 'correction')
        return resolved.correctionTtlMs;
    if (status === 'cannot-judge')
        return resolved.cannotJudgeTtlMs;
    if (status === 'success')
        return resolved.successTtlMs;
    return 0;
}
function isFeedbackActive(item, now, options = {}) {
    const ttl = feedbackTtlMs(item.status, options);
    return ttl > 0 && now - item.capturedAt <= ttl;
}
function sortFeedbackStack(items) {
    return [...items].sort((left, right) => {
        const statusDifference = statusRank(right.status) - statusRank(left.status);
        if (statusDifference !== 0)
            return statusDifference;
        const priorityDifference = right.priority - left.priority;
        if (priorityDifference !== 0)
            return priorityDifference;
        const confidenceDifference = right.confidencePercent - left.confidencePercent;
        if (confidenceDifference !== 0)
            return confidenceDifference;
        return right.capturedAt - left.capturedAt;
    });
}
function limitWithPositiveEvidence(items, maxItems) {
    const problems = sortFeedbackStack(items.filter((item) => (item.status === 'warning'
        || item.status === 'correction'
        || item.status === 'cannot-judge')));
    const successes = sortFeedbackStack(items.filter((item) => item.status === 'success'));
    const waiting = sortFeedbackStack(items.filter((item) => item.status === 'waiting'));
    if (!problems.length)
        return sortFeedbackStack([...successes, ...waiting]).slice(0, maxItems);
    if (!successes.length || maxItems <= 1)
        return problems.slice(0, maxItems);
    // 교정은 항상 주 피드백으로 유지하되, 사용자가 잘하고 있는지도 알 수 있게
    // 가장 최근의 근거 있는 성공 한 항목을 위해 마지막 슬롯을 예약합니다.
    return sortFeedbackStack([
        ...problems.slice(0, Math.max(1, maxItems - 1)),
        successes[0],
    ]).slice(0, maxItems);
}
function mergeFeedbackStack(current, next, now = next.capturedAt, options = {}) {
    const resolved = { ...DEFAULT_OPTIONS, ...options };
    const active = current.filter((item) => item.id !== next.id && isFeedbackActive(item, now, resolved));
    if (next.status !== 'waiting')
        active.push(next);
    return limitWithPositiveEvidence(active, resolved.maxItems);
}
function pruneFeedbackStack(current, now, options = {}) {
    const resolved = { ...DEFAULT_OPTIONS, ...options };
    const active = current.filter((item) => isFeedbackActive(item, now, resolved));
    return limitWithPositiveEvidence(active, resolved.maxItems);
}
