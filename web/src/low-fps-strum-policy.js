export const LOW_FPS_HAND_HOLD_MS = 2200;
export const RELAXED_STRUM_DISTANCE = 2.65;

function asHands(roles) {
  return Array.isArray(roles) ? roles.filter(Boolean) : [];
}

function hasPickPoint(hand) {
  return Boolean(hand?.pickPoint && Number.isFinite(hand.pickPoint.x) && Number.isFinite(hand.pickPoint.y));
}

function roleConfidence(hand) {
  return Number.isFinite(hand?.roleConfidence) ? hand.roleConfidence : 0;
}

function strumDistance(hand) {
  return Number.isFinite(hand?.strumDistance) ? hand.strumDistance : Number.POSITIVE_INFINITY;
}

function sameStableIdentity(hand, cached) {
  if (!hand || !cached) return false;
  if (hand.trackId != null && cached.trackId != null && hand.trackId === cached.trackId) return true;
  const handedness = String(hand.handedness || '');
  const cachedHandedness = String(cached.handedness || '');
  return Boolean(
    handedness &&
      cachedHandedness &&
      handedness !== 'Unknown' &&
      handedness !== '미선택' &&
      handedness === cachedHandedness,
  );
}

function markRecovered(hand, recoverySource, inferred = false) {
  return hand ? { ...hand, recoverySource, inferred } : null;
}

export function selectRecoveredStrumHand({
  roles = [],
  cached = null,
  now = 0,
  lastSeenAt = 0,
  holdMs = LOW_FPS_HAND_HOLD_MS,
} = {}) {
  const candidates = asHands(roles).filter(hasPickPoint);

  const explicit = candidates
    .filter((hand) => hand.role === 'strum')
    .sort((a, b) => roleConfidence(b) - roleConfidence(a))[0];
  if (explicit) return markRecovered(explicit, 'explicit');

  const identityMatch = candidates.find((hand) => sameStableIdentity(hand, cached));
  if (identityMatch) return markRecovered(identityMatch, 'identity');

  const nearest = [...candidates].sort((a, b) => strumDistance(a) - strumDistance(b))[0];
  if (nearest && strumDistance(nearest) <= RELAXED_STRUM_DISTANCE) {
    return markRecovered(nearest, 'nearest-zone');
  }

  const nonFret = candidates
    .filter((hand) => hand.role !== 'fret')
    .sort((a, b) => roleConfidence(b) - roleConfidence(a))[0];
  if (nonFret) return markRecovered(nonFret, 'non-fret');

  if (candidates.length === 1) return markRecovered(candidates[0], 'single-hand');

  const age = Number(now) - Number(lastSeenAt || 0);
  if (hasPickPoint(cached) && age >= 0 && age <= holdMs) {
    return markRecovered(cached, 'sticky-cache', true);
  }

  return null;
}

export function preserveDetectedHands({
  current = [],
  cached = [],
  now = 0,
  lastSeenAt = 0,
  holdMs = LOW_FPS_HAND_HOLD_MS,
} = {}) {
  const visible = asHands(current);
  if (visible.length > 0) {
    return {
      hands: visible,
      cached: visible.map((hand) => ({ ...hand, lastSeenAt: now })),
      lastSeenAt: now,
      retained: false,
    };
  }

  const age = Number(now) - Number(lastSeenAt || 0);
  const remembered = asHands(cached);
  if (remembered.length > 0 && age >= 0 && age <= holdMs) {
    return {
      hands: remembered.map((hand) => ({ ...hand, inferred: true, recoverySource: 'low-fps-hold' })),
      cached: remembered,
      lastSeenAt,
      retained: true,
    };
  }

  return { hands: [], cached: [], lastSeenAt: 0, retained: false };
}
