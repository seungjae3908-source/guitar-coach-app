export const STRUM_ROLE_HOLD_MS = 1100;

export function isStrumHandRecent(now, lastSeenAt, holdMs = STRUM_ROLE_HOLD_MS) {
  const current = Number(now);
  const previous = Number(lastSeenAt);
  return Number.isFinite(current) && Number.isFinite(previous) && previous > 0 && current - previous <= holdMs;
}

export function selectStickyStrumHand({ current = null, cached = null, now = 0, lastSeenAt = 0, holdMs = STRUM_ROLE_HOLD_MS } = {}) {
  if (current) return current;
  if (cached && isStrumHandRecent(now, lastSeenAt, holdMs)) return { ...cached, inferred: true };
  return null;
}
