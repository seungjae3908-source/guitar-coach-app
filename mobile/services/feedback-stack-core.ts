export type FeedbackStackStatus =
  | 'waiting'
  | 'cannot-judge'
  | 'correction'
  | 'warning'
  | 'success';

export type FeedbackStackEntry = {
  id: string;
  capturedAt: number;
  status: FeedbackStackStatus;
  priority: number;
  confidencePercent: number;
};

export type FeedbackStackOptions = {
  maxItems?: number;
  warningTtlMs?: number;
  correctionTtlMs?: number;
  cannotJudgeTtlMs?: number;
  successTtlMs?: number;
};

const DEFAULT_OPTIONS: Required<FeedbackStackOptions> = {
  maxItems: 6,
  warningTtlMs: 9_000,
  correctionTtlMs: 8_000,
  cannotJudgeTtlMs: 5_000,
  successTtlMs: 3_500,
};

function statusRank(status: FeedbackStackStatus) {
  if (status === 'warning') return 5;
  if (status === 'correction') return 4;
  if (status === 'cannot-judge') return 3;
  if (status === 'success') return 2;
  return 1;
}

export function feedbackTtlMs(
  status: FeedbackStackStatus,
  options: FeedbackStackOptions = {},
) {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  if (status === 'warning') return resolved.warningTtlMs;
  if (status === 'correction') return resolved.correctionTtlMs;
  if (status === 'cannot-judge') return resolved.cannotJudgeTtlMs;
  if (status === 'success') return resolved.successTtlMs;
  return 0;
}

export function isFeedbackActive<T extends FeedbackStackEntry>(
  item: T,
  now: number,
  options: FeedbackStackOptions = {},
) {
  const ttl = feedbackTtlMs(item.status, options);
  return ttl > 0 && now - item.capturedAt <= ttl;
}

export function sortFeedbackStack<T extends FeedbackStackEntry>(items: T[]) {
  return [...items].sort((left, right) => {
    const statusDifference = statusRank(right.status) - statusRank(left.status);
    if (statusDifference !== 0) return statusDifference;
    const priorityDifference = right.priority - left.priority;
    if (priorityDifference !== 0) return priorityDifference;
    const confidenceDifference = right.confidencePercent - left.confidencePercent;
    if (confidenceDifference !== 0) return confidenceDifference;
    return right.capturedAt - left.capturedAt;
  });
}

export function mergeFeedbackStack<T extends FeedbackStackEntry>(
  current: T[],
  next: T,
  now = next.capturedAt,
  options: FeedbackStackOptions = {},
) {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const active = current.filter((item) => item.id !== next.id && isFeedbackActive(item, now, resolved));

  if (next.status !== 'waiting') active.push(next);

  const hasUnresolvedProblem = active.some(
    (item) => item.status === 'warning' || item.status === 'correction' || item.status === 'cannot-judge',
  );
  const withoutPrematureSuccess = hasUnresolvedProblem
    ? active.filter((item) => item.status !== 'success')
    : active;

  return sortFeedbackStack(withoutPrematureSuccess).slice(0, resolved.maxItems);
}

export function pruneFeedbackStack<T extends FeedbackStackEntry>(
  current: T[],
  now: number,
  options: FeedbackStackOptions = {},
) {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  return sortFeedbackStack(current.filter((item) => isFeedbackActive(item, now, resolved)))
    .slice(0, resolved.maxItems);
}
