export type StringVisionRefreshInput = {
  requested?: boolean;
  cachedAt?: number | null;
  now: number;
  reuseMs: number;
};

export function shouldRefreshStringVision(input: StringVisionRefreshInput) {
  if (input.requested === true) return true;
  if (input.requested === false) return false;
  if (input.cachedAt == null) return true;
  return input.now - input.cachedAt > input.reuseMs;
}
