export const LOW_FPS_HAND_HOLD_MS = 650;
export const STRUM_EVENT_HOLD_MS = 420;
export const MAX_STRUM_ZONE_DISTANCE = 1.55;
export const MIN_STRUM_FRET_MARGIN = 0.18;

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

function fretDistance(hand) {
  return Number.isFinite(hand?.fretDistance) ? hand.fretDistance : Number.POSITIVE_INFINITY;
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

function spatiallyLooksLikeStrum(hand) {
  const strum = strumDistance(hand);
  const fret = fretDistance(hand);
  return strum <= MAX_STRUM_ZONE_DISTANCE && fret - strum >= MIN_STRUM_FRET_MARGIN;
}

export function isCountableStrumHand(hand) {
  if (!hasPickPoint(hand) || hand?.inferred || hand?.role === 'fret') return false;
  if (hand.role === 'strum') {
    return roleConfidence(hand) >= 0.12 && strumDistance(hand) <= MAX_STRUM_ZONE_DISTANCE;
  }
  return hand.recoverySource === 'identity' && spatiallyLooksLikeStrum(hand);
}

export function selectRecoveredStrumHand({
  roles = [],
  cached = null,
  now = 0,
  lastSeenAt = 0,
  holdMs = STRUM_EVENT_HOLD_MS,
} = {}) {
  const candidates = asHands(roles).filter(hasPickPoint);

  const explicit = candidates
    .filter((hand) => hand.role === 'strum' && spatiallyLooksLikeStrum(hand))
    .sort((a, b) => roleConfidence(b) - roleConfidence(a))[0];
  if (explicit) return markRecovered(explicit, 'explicit');

  const cachedWasVerifiedStrum = cached?.role === 'strum' && !cached?.inferred;
  const identityMatch = cachedWasVerifiedStrum
    ? candidates.find((hand) => (
      hand.role !== 'fret' &&
      sameStableIdentity(hand, cached) &&
      spatiallyLooksLikeStrum(hand)
    ))
    : null;
  if (identityMatch) return markRecovered(identityMatch, 'identity');

  // A cached hand is used only when the detector returned no visible hand at all.
  // If a hand is visible but is now on the fret side or outside the strum zone,
  // stale coordinates must never override the current frame.
  const age = Number(now) - Number(lastSeenAt || 0);
  if (
    candidates.length === 0 &&
    cachedWasVerifiedStrum &&
    hasPickPoint(cached) &&
    age >= 0 &&
    age <= holdMs
  ) {
    return markRecovered(cached, 'sticky-cache', true);
  }

  return null;
}

export function chooseDistinctFretHand(roles = [], strumHand = null) {
  return asHands(roles)
    .filter((hand) => (
      hand.role === 'fret' &&
      (strumHand?.trackId == null || hand.trackId !== strumHand.trackId)
    ))
    .sort((a, b) => roleConfidence(b) - roleConfidence(a))[0] || null;
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
